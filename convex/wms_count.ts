import {
  action,
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { computeVariance } from "./wms_count_variance";
import { COUNT_LOCATIONS, isCountLocationEnabled } from "./wms_count_locations";
import { Id } from "./_generated/dataModel";

/**
 * Count batches are opened and closed from BOTH the scanner (users) and
 * TireTrackAdmin (adminUsers), which are separate identity tables. Every
 * mutation therefore takes a discriminated actor rather than a bare user id.
 */
export const actorValidator = v.union(
  v.object({ kind: v.literal("user"), userId: v.id("users") }),
  v.object({ kind: v.literal("admin"), adminId: v.id("adminUsers") }),
);

type Actor =
  | { kind: "user"; userId: Id<"users"> }
  | { kind: "admin"; adminId: Id<"adminUsers"> };

/**
 * Resolve and authorise an actor. Throws otherwise — client gating is
 * convenience, this is the boundary.
 */
async function authorizeCountActor(
  ctx: { db: any },
  actor: Actor,
  locationCode: string,
): Promise<{ performedBy: string; performedByName: string }> {
  if (actor.kind === "user") {
    const user = await ctx.db.get(actor.userId);
    if (!user || !user.isActive) throw new Error("Not authorized");
    if (user.role !== "inventory") {
      throw new Error("Inventory role required to count");
    }
    // wms_count_assignments, NOT wms_user_assignments — counting is not the WMS
    // pilot. A counter at a retail store never touches warehouse management.
    const assignment = await ctx.db
      .query("wms_count_assignments")
      .withIndex("by_user_location", (q: any) =>
        q.eq("userId", actor.userId).eq("locationCode", locationCode),
      )
      .first();
    if (!assignment) throw new Error(`Not assigned to count at ${locationCode}`);
    return { performedBy: String(actor.userId), performedByName: user.name };
  }

  const admin = await ctx.db.get(actor.adminId);
  if (!admin || !admin.isActive) throw new Error("Not authorized");
  if (admin.role !== "admin" && admin.role !== "superadmin") {
    throw new Error("Not authorized");
  }
  // adminUsers.allowedLocations is deliberately NOT consulted here.
  //
  // It is stored but enforced nowhere in this codebase, and its values are
  // human-readable names, not location codes: real rows hold ["all"],
  // ["latrobe"], ["chestnut"]. Note "chestnut" IS W09 (Chestnut Ridge) — so a
  // code comparison rejects every admin, and a fuzzy name→code match is the
  // kind of guess that silently locks the right person out. Gating on
  // role + isActive matches how every other admin action in this app behaves.
  //
  // If per-location admin restriction is ever wanted, allowedLocations needs to
  // become code-keyed first; that is a separate, app-wide change.
  return { performedBy: String(actor.adminId), performedByName: admin.name };
}

const normalizeUpc = (raw: string) => String(raw ?? "").replace(/\D/g, "");

// ---------------------------------------------------------------- batch open

export const createBatchInternal = internalMutation({
  args: { warehouseCode: v.string(), actor: actorValidator },
  handler: async (ctx, args) => {
    if (!isCountLocationEnabled(args.warehouseCode)) {
      // Explicit error rather than an empty baseline, which would read as
      // "this location has zero inventory".
      throw new Error(`${args.warehouseCode} is not enabled for counting`);
    }

    const { performedBy, performedByName } = await authorizeCountActor(
      ctx,
      args.actor as Actor,
      args.warehouseCode,
    );

    const existing = await ctx.db
      .query("wms_count_batches")
      .withIndex("by_warehouse_status", (q) =>
        q.eq("warehouseCode", args.warehouseCode).eq("status", "open"),
      )
      .first();
    if (existing) return { batchId: existing._id, alreadyOpen: true };

    const batchId = await ctx.db.insert("wms_count_batches", {
      warehouseCode: args.warehouseCode,
      status: "open",
      openedBy: performedBy,
      openedByName: performedByName,
      openedAt: Date.now(),
      baselineStatus: "pending",
    });
    return { batchId, alreadyOpen: false };
  },
});

export const insertBaselineChunk = internalMutation({
  args: {
    batchId: v.id("wms_count_batches"),
    items: v.array(
      v.object({
        itemId: v.string(),
        qtyOnHand: v.number(),
        brand: v.optional(v.string()),
        model: v.optional(v.string()),
        size: v.optional(v.string()),
        mpn: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const it of args.items) {
      await ctx.db.insert("wms_count_baseline", { batchId: args.batchId, ...it });
    }
  },
});

export const finishBaseline = internalMutation({
  args: {
    batchId: v.id("wms_count_batches"),
    status: v.union(v.literal("ready"), v.literal("failed")),
    error: v.optional(v.string()),
    fileDate: v.optional(v.string()),
    generatedAt: v.optional(v.string()),
    itemCount: v.optional(v.number()),
    unitCount: v.optional(v.number()),
    excludedNonTires: v.optional(v.number()),
    excludedUnits: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.batchId, {
      baselineStatus: args.status,
      baselineError: args.error,
      baselineFileDate: args.fileDate,
      baselineGeneratedAt: args.generatedAt,
      baselineItemCount: args.itemCount,
      baselineUnitCount: args.unitCount,
      baselineExcludedNonTires: args.excludedNonTires,
      baselineExcludedUnits: args.excludedUnits,
    });
  },
});

export const clearBaseline = internalMutation({
  args: { batchId: v.id("wms_count_batches") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("wms_count_baseline")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
  },
});

export const getBatchInternal = internalQuery({
  args: { batchId: v.id("wms_count_batches") },
  handler: async (ctx, args) => await ctx.db.get(args.batchId),
});

/**
 * Fetch IECentral's on-hand snapshot and freeze it as this batch's baseline.
 *
 * IECENTRAL_SNAPSHOT_URL must be the www host: the apex 301s to www and clients
 * drop the Authorization header across a cross-host redirect, which surfaces as
 * a baffling 401 with a perfectly valid token.
 */
async function loadBaseline(
  ctx: any,
  batchId: Id<"wms_count_batches">,
  warehouseCode: string,
) {
  const base = process.env.IECENTRAL_SNAPSHOT_URL;
  const token = process.env.IECENTRAL_SNAPSHOT_TOKEN;
  if (!base || !token) {
    await ctx.runMutation(internal.wms_count.finishBaseline, {
      batchId,
      status: "failed",
      error:
        "IECENTRAL_SNAPSHOT_URL / IECENTRAL_SNAPSHOT_TOKEN not set on the Convex deployment.",
    });
    return;
  }

  try {
    const res = await fetch(
      `${base}/api/inventory/snapshot?location=${encodeURIComponent(warehouseCode)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Snapshot returned ${res.status}. ${body.slice(0, 200)}` +
          (res.status === 401
            ? " (check IECENTRAL_SNAPSHOT_TOKEN, and that the URL is the www host)"
            : ""),
      );
    }
    const snap = (await res.json()) as {
      fileDate: string | null;
      generatedAt: string | null;
      count: number;
      excludedNonTires: number;
      excludedUnits: number;
      items: Array<{
        itemId: string;
        qtyOnHand: number;
        brand?: string;
        model?: string;
        size?: string;
        mpn?: string;
      }>;
    };

    // 500-row chunks keep each transaction well inside Convex limits. W09
    // measured 480 items, so this is one chunk in practice — the loop is
    // headroom for a larger location, not a current need.
    for (let i = 0; i < snap.items.length; i += 500) {
      await ctx.runMutation(internal.wms_count.insertBaselineChunk, {
        batchId,
        items: snap.items.slice(i, i + 500),
      });
    }

    await ctx.runMutation(internal.wms_count.finishBaseline, {
      batchId,
      status: "ready",
      fileDate: snap.fileDate ?? undefined,
      generatedAt: snap.generatedAt ?? undefined,
      itemCount: snap.items.length,
      unitCount: snap.items.reduce((n, i) => n + i.qtyOnHand, 0),
      excludedNonTires: snap.excludedNonTires,
      excludedUnits: snap.excludedUnits,
    });
  } catch (err: any) {
    await ctx.runMutation(internal.wms_count.clearBaseline, { batchId });
    await ctx.runMutation(internal.wms_count.finishBaseline, {
      batchId,
      status: "failed",
      error: err?.message ?? "Snapshot fetch failed",
    });
  }
}

/**
 * Open a count batch and freeze the IECentral baseline into it.
 *
 * Scanning is permitted while the baseline is pending or failed — the floor
 * must never wait on S3. Only variance reporting requires "ready".
 */
export const openCountBatch = action({
  args: { warehouseCode: v.string(), actor: actorValidator },
  handler: async (
    ctx,
    args,
  ): Promise<{ batchId: Id<"wms_count_batches">; alreadyOpen: boolean }> => {
    const created: { batchId: Id<"wms_count_batches">; alreadyOpen: boolean } =
      await ctx.runMutation(internal.wms_count.createBatchInternal, args);
    if (created.alreadyOpen) return created;
    await loadBaseline(ctx, created.batchId, args.warehouseCode);
    return created;
  },
});

export const retryBaseline = action({
  args: { batchId: v.id("wms_count_batches"), actor: actorValidator },
  handler: async (ctx, args): Promise<{ success: true }> => {
    const batch = await ctx.runQuery(internal.wms_count.getBatchInternal, {
      batchId: args.batchId,
    });
    if (!batch) throw new Error("Batch not found");
    await ctx.runMutation(internal.wms_count.clearBaseline, {
      batchId: args.batchId,
    });
    await ctx.runMutation(internal.wms_count.finishBaseline, {
      batchId: args.batchId,
      status: "failed",
      error: "Retrying…",
    });
    await loadBaseline(ctx, args.batchId, batch.warehouseCode);
    return { success: true };
  },
});

// -------------------------------------------------------------------- scans

/** Upsert the rollup for one scan delta. Keeps reports off the raw scan table. */
async function applyTotalsDelta(
  ctx: any,
  batchId: Id<"wms_count_batches">,
  opts: { itemId?: string; upc?: string; qtyDelta: number; scanDelta: number },
) {
  const existing = opts.itemId
    ? await ctx.db
        .query("wms_count_totals")
        .withIndex("by_batch_item", (q: any) =>
          q.eq("batchId", batchId).eq("itemId", opts.itemId),
        )
        .first()
    : await ctx.db
        .query("wms_count_totals")
        .withIndex("by_batch_upc", (q: any) =>
          q.eq("batchId", batchId).eq("upc", opts.upc),
        )
        .first();

  if (!existing) {
    if (opts.qtyDelta === 0 && opts.scanDelta === 0) return;
    await ctx.db.insert("wms_count_totals", {
      batchId,
      itemId: opts.itemId,
      upc: opts.itemId ? undefined : opts.upc,
      countedQty: opts.qtyDelta,
      scanCount: opts.scanDelta,
      lastScannedAt: Date.now(),
    });
    return;
  }

  const countedQty = existing.countedQty + opts.qtyDelta;
  const scanCount = existing.scanCount + opts.scanDelta;
  if (scanCount <= 0 && countedQty <= 0) {
    await ctx.db.delete(existing._id);
    return;
  }
  await ctx.db.patch(existing._id, {
    countedQty,
    scanCount,
    lastScannedAt: Date.now(),
  });
}

export const recordCountScan = mutation({
  args: {
    batchId: v.id("wms_count_batches"),
    rawBarcode: v.string(),
    quantity: v.number(),
    actor: actorValidator,
    itemIdOverride: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) throw new Error("Batch not found");
    if (batch.status !== "open") throw new Error("This batch is closed");

    const { performedBy, performedByName } = await authorizeCountActor(
      ctx,
      args.actor as Actor,
      batch.warehouseCode,
    );

    if (
      !Number.isInteger(args.quantity) ||
      args.quantity < 1 ||
      args.quantity > 999
    ) {
      throw new Error("Quantity must be a whole number between 1 and 999");
    }

    const upc = normalizeUpc(args.rawBarcode);
    let itemId: string | undefined;
    let matchSource: "upc" | "manual-search" | "unmatched" = "unmatched";
    let brand: string | undefined;
    let model: string | undefined;
    let size: string | undefined;

    if (args.itemIdOverride) {
      itemId = args.itemIdOverride;
      matchSource = "manual-search";
    } else if (upc) {
      const tire = await ctx.db
        .query("tireUPCs")
        .withIndex("by_upc", (q) => q.eq("upc", upc))
        .first();
      if (tire?.inventoryNumber) {
        itemId = tire.inventoryNumber;
        matchSource = "upc";
        brand = tire.brand;
        model = tire.model;
        size = tire.size;
      }
    }

    if (itemId && !brand) {
      const base = await ctx.db
        .query("wms_count_baseline")
        .withIndex("by_batch_item", (q) =>
          q.eq("batchId", args.batchId).eq("itemId", itemId!),
        )
        .first();
      brand = base?.brand;
      model = base?.model;
      size = base?.size;
    }

    const scanId = await ctx.db.insert("wms_count_scans", {
      batchId: args.batchId,
      warehouseCode: batch.warehouseCode,
      rawBarcode: args.rawBarcode,
      upc: upc || undefined,
      itemId,
      quantity: args.quantity,
      matchSource,
      brand,
      model,
      size,
      scannedBy: performedBy,
      scannedByName: performedByName,
      scannedAt: Date.now(),
    });

    await applyTotalsDelta(ctx, args.batchId, {
      itemId,
      upc: upc || args.rawBarcode,
      qtyDelta: args.quantity,
      scanDelta: 1,
    });

    // Read back the rollup so the scanner can show the ACCUMULATED count, not
    // just this scan. The same barcode gets scanned again later ("found 4 more"),
    // and showing only the latest quantity makes a counter think the earlier
    // scan was lost and re-scan it. Unmatched UPCs need this just as much as
    // matched items, so look up whichever key this scan used.
    const totals = itemId
      ? await ctx.db
          .query("wms_count_totals")
          .withIndex("by_batch_item", (q) =>
            q.eq("batchId", args.batchId).eq("itemId", itemId!),
          )
          .first()
      : await ctx.db
          .query("wms_count_totals")
          .withIndex("by_batch_upc", (q) =>
            q.eq("batchId", args.batchId).eq("upc", upc || args.rawBarcode),
          )
          .first();

    return {
      scanId,
      itemId,
      upc: upc || undefined,
      matched: !!itemId,
      brand,
      model,
      size,
      runningQty: totals?.countedQty ?? args.quantity,
      runningScans: totals?.scanCount ?? 1,
    };
  },
});

export const voidCountScan = mutation({
  args: { scanId: v.id("wms_count_scans"), actor: actorValidator },
  handler: async (ctx, args) => {
    const scan = await ctx.db.get(args.scanId);
    if (!scan) throw new Error("Scan not found");
    if (scan.voided) return { success: true };

    const batch = await ctx.db.get(scan.batchId);
    if (!batch) throw new Error("Batch not found");
    if (batch.status !== "open") throw new Error("This batch is closed");

    const { performedBy } = await authorizeCountActor(
      ctx,
      args.actor as Actor,
      batch.warehouseCode,
    );

    await ctx.db.patch(args.scanId, {
      voided: true,
      voidedBy: performedBy,
      voidedAt: Date.now(),
    });
    await applyTotalsDelta(ctx, scan.batchId, {
      itemId: scan.itemId,
      upc: scan.upc || scan.rawBarcode,
      qtyDelta: -scan.quantity,
      scanDelta: -1,
    });
    return { success: true };
  },
});

export const closeCountBatch = mutation({
  args: { batchId: v.id("wms_count_batches"), actor: actorValidator },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) throw new Error("Batch not found");
    if (batch.status === "closed") return { success: true };

    const { performedBy, performedByName } = await authorizeCountActor(
      ctx,
      args.actor as Actor,
      batch.warehouseCode,
    );

    const anyScan = await ctx.db
      .query("wms_count_scans")
      .withIndex("by_batch_scannedAt", (q) => q.eq("batchId", args.batchId))
      .filter((q) => q.neq(q.field("voided"), true))
      .first();
    if (!anyScan) {
      throw new Error(
        "Nothing has been counted yet — cannot close an empty batch",
      );
    }

    await ctx.db.patch(args.batchId, {
      status: "closed",
      closedBy: performedBy,
      closedByName: performedByName,
      closedAt: Date.now(),
    });
    return { success: true };
  },
});

/**
 * Delete a count batch and everything belonging to it.
 *
 * Needed because a batch opened by mistake would otherwise block the location
 * forever — only one batch may be open per location, and an empty batch cannot
 * be closed. Admin only, and it says how much it destroyed.
 */
export const deleteCountBatch = mutation({
  args: {
    batchId: v.id("wms_count_batches"),
    callerAdminId: v.id("adminUsers"),
  },
  handler: async (ctx, args) => {
    const admin = await ctx.db.get(args.callerAdminId);
    if (!admin || !admin.isActive) throw new Error("Not authorized");
    if (admin.role !== "admin" && admin.role !== "superadmin") {
      throw new Error("Not authorized");
    }

    const baseline = await ctx.db
      .query("wms_count_baseline")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .collect();
    for (const r of baseline) await ctx.db.delete(r._id);

    const totals = await ctx.db
      .query("wms_count_totals")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .collect();
    for (const r of totals) await ctx.db.delete(r._id);

    const scans = await ctx.db
      .query("wms_count_scans")
      .withIndex("by_batch_scannedAt", (q) => q.eq("batchId", args.batchId))
      .collect();
    for (const r of scans) await ctx.db.delete(r._id);

    await ctx.db.delete(args.batchId);
    return {
      success: true,
      deleted: {
        baseline: baseline.length,
        totals: totals.length,
        scans: scans.length,
      },
    };
  },
});

/**
 * Attach an unmatched UPC to an itemId.
 *
 * scope "scan" is the scanner resolving the tire in the counter's hand; scope
 * "batch" is Admin cleaning up every unmatched scan of that UPC wholesale.
 * They are genuinely different intents, hence the explicit argument.
 */
export const resolveUnmatchedUpc = mutation({
  args: {
    batchId: v.id("wms_count_batches"),
    upc: v.string(),
    itemId: v.string(),
    alsoSaveMapping: v.boolean(),
    scope: v.union(v.literal("batch"), v.literal("scan")),
    scanId: v.optional(v.id("wms_count_scans")),
    actor: actorValidator,
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) throw new Error("Batch not found");
    await authorizeCountActor(ctx, args.actor as Actor, batch.warehouseCode);

    if (args.scope === "scan" && !args.scanId) {
      throw new Error("scanId is required when scope is 'scan'");
    }

    const candidates =
      args.scope === "scan"
        ? [await ctx.db.get(args.scanId!)].filter(Boolean)
        : await ctx.db
            .query("wms_count_scans")
            .withIndex("by_batch_upc", (q) =>
              q.eq("batchId", args.batchId).eq("upc", args.upc),
            )
            .collect();

    const base = await ctx.db
      .query("wms_count_baseline")
      .withIndex("by_batch_item", (q) =>
        q.eq("batchId", args.batchId).eq("itemId", args.itemId),
      )
      .first();

    let moved = 0;
    for (const scan of candidates as any[]) {
      if (!scan || scan.voided || scan.itemId) continue;
      await ctx.db.patch(scan._id, {
        itemId: args.itemId,
        matchSource: "resolved" as const,
        brand: base?.brand ?? scan.brand,
        model: base?.model ?? scan.model,
        size: base?.size ?? scan.size,
      });
      await applyTotalsDelta(ctx, args.batchId, {
        upc: scan.upc || scan.rawBarcode,
        qtyDelta: -scan.quantity,
        scanDelta: -1,
      });
      await applyTotalsDelta(ctx, args.batchId, {
        itemId: args.itemId,
        qtyDelta: scan.quantity,
        scanDelta: 1,
      });
      moved += 1;
    }

    if (args.alsoSaveMapping && args.upc) {
      const existing = await ctx.db
        .query("tireUPCs")
        .withIndex("by_upc", (q) => q.eq("upc", args.upc))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, { inventoryNumber: args.itemId });
      } else {
        await ctx.db.insert("tireUPCs", {
          upc: args.upc,
          brand: base?.brand ?? "",
          model: base?.model ?? "",
          size: base?.size ?? "",
          inventoryNumber: args.itemId,
        });
      }
    }

    return { success: true, scansMoved: moved };
  },
});

// --------------------------------------------------- locations & assignments

/**
 * Locations this user may count at, resolved from wms_count_assignments and
 * intersected with the enabled list. The scanner reads THIS — never a constant —
 * so one assignment auto-selects and several show a picker.
 */
export const getMyCountLocations = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || !user.isActive || user.role !== "inventory") return [];
    const rows = await ctx.db
      .query("wms_count_assignments")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const enabled = new Map(COUNT_LOCATIONS.map((l) => [l.code, l.label]));
    return rows
      .filter((r) => enabled.has(r.locationCode))
      .map((r) => ({ code: r.locationCode, label: enabled.get(r.locationCode)! }));
  },
});

/** Enabled locations, for the Admin dropdown. */
export const getCountLocations = query({
  args: {},
  handler: async () => COUNT_LOCATIONS,
});

/** Grant a user the ability to count at a location. Admin only. */
export const assignCountLocation = mutation({
  args: {
    userId: v.id("users"),
    locationCode: v.string(),
    callerAdminId: v.id("adminUsers"),
  },
  handler: async (ctx, args) => {
    const admin = await ctx.db.get(args.callerAdminId);
    if (!admin || !admin.isActive) throw new Error("Not authorized");
    if (admin.role !== "admin" && admin.role !== "superadmin") {
      throw new Error("Not authorized");
    }
    if (!isCountLocationEnabled(args.locationCode)) {
      throw new Error(`${args.locationCode} is not enabled for counting`);
    }
    const existing = await ctx.db
      .query("wms_count_assignments")
      .withIndex("by_user_location", (q) =>
        q.eq("userId", args.userId).eq("locationCode", args.locationCode),
      )
      .first();
    if (existing) return { success: true };
    await ctx.db.insert("wms_count_assignments", {
      userId: args.userId,
      locationCode: args.locationCode,
      assignedAt: Date.now(),
      assignedBy: admin.name,
    });
    return { success: true };
  },
});

export const unassignCountLocation = mutation({
  args: {
    userId: v.id("users"),
    locationCode: v.string(),
    callerAdminId: v.id("adminUsers"),
  },
  handler: async (ctx, args) => {
    const admin = await ctx.db.get(args.callerAdminId);
    if (!admin || !admin.isActive) throw new Error("Not authorized");
    const row = await ctx.db
      .query("wms_count_assignments")
      .withIndex("by_user_location", (q) =>
        q.eq("userId", args.userId).eq("locationCode", args.locationCode),
      )
      .first();
    if (row) await ctx.db.delete(row._id);
    return { success: true };
  },
});

export const getCountAssignments = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("wms_count_assignments").take(500);
    const users = await ctx.db.query("users").take(500);
    return rows.map((r) => ({
      ...r,
      userName: users.find((u) => u._id === r.userId)?.name ?? "Unknown",
    }));
  },
});

// ------------------------------------------------------------------ queries

export const getOpenCountBatch = query({
  args: { warehouseCode: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("wms_count_batches")
      .withIndex("by_warehouse_status", (q) =>
        q.eq("warehouseCode", args.warehouseCode).eq("status", "open"),
      )
      .first(),
});

export const getCountBatches = query({
  args: { warehouseCode: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("wms_count_batches")
      .withIndex("by_warehouse_openedAt", (q) =>
        q.eq("warehouseCode", args.warehouseCode),
      )
      .order("desc")
      .take(100),
});

export const getCountBatch = query({
  args: { batchId: v.id("wms_count_batches") },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) return null;
    const totals = await ctx.db
      .query("wms_count_totals")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .collect();
    const scans = await ctx.db
      .query("wms_count_scans")
      .withIndex("by_batch_scannedAt", (q) => q.eq("batchId", args.batchId))
      .collect();
    const live = scans.filter((s) => s.voided !== true);

    // Per-counter breakdown — accountability on a multi-counter inventory day.
    const byCounter = new Map<string, { name: string; units: number; scans: number }>();
    for (const s of live) {
      const e = byCounter.get(s.scannedBy) ?? {
        name: s.scannedByName,
        units: 0,
        scans: 0,
      };
      e.units += s.quantity;
      e.scans += 1;
      byCounter.set(s.scannedBy, e);
    }

    return {
      batch,
      countedItems: totals.filter((t) => !!t.itemId).length,
      countedUnits: totals.reduce((n, t) => n + t.countedQty, 0),
      unmatchedUpcs: totals.filter((t) => !t.itemId).length,
      scanCount: live.length,
      voidedCount: scans.length - live.length,
      counters: [...byCounter.values()].sort((a, b) => b.units - a.units),
    };
  },
});

export const getCountVariance = query({
  args: { batchId: v.id("wms_count_batches") },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) return null;
    if (batch.baselineStatus !== "ready") {
      return {
        baselineStatus: batch.baselineStatus,
        baselineError: batch.baselineError,
      };
    }
    const baseline = await ctx.db
      .query("wms_count_baseline")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .collect();
    const totals = await ctx.db
      .query("wms_count_totals")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .collect();
    return {
      baselineStatus: "ready" as const,
      baselineFileDate: batch.baselineFileDate,
      baselineExcludedNonTires: batch.baselineExcludedNonTires,
      baselineExcludedUnits: batch.baselineExcludedUnits,
      ...computeVariance(baseline, totals),
    };
  },
});

export const listCountScans = query({
  args: { batchId: v.id("wms_count_batches"), limit: v.optional(v.number()) },
  handler: async (ctx, args) =>
    await ctx.db
      .query("wms_count_scans")
      .withIndex("by_batch_scannedAt", (q) => q.eq("batchId", args.batchId))
      .order("desc")
      .take(args.limit ?? 50),
});

/**
 * Sidewall lookup. Hits IECentral's catalog rather than the frozen baseline:
 * only 480 of W09's 56,107 catalog items are in stock, and finding stock the
 * book says is zero is a core purpose of counting.
 */
export const searchIECentralTires = action({
  args: { q: v.string() },
  handler: async (
    _ctx,
    args,
  ): Promise<{ results: any[]; error?: string }> => {
    const base = process.env.IECENTRAL_SNAPSHOT_URL;
    const token = process.env.IECENTRAL_SNAPSHOT_TOKEN;
    if (!base || !token) return { results: [], error: "Search is not configured" };
    try {
      const res = await fetch(
        `${base}/api/inventory/search?q=${encodeURIComponent(args.q)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return { results: [], error: `Search returned ${res.status}` };
      return (await res.json()) as { results: any[] };
    } catch (err: any) {
      return { results: [], error: err?.message ?? "Search failed" };
    }
  },
});
