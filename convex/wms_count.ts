import {
  action,
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  computeVariance,
  canonicalItemIdFrom,
  compareCounts,
  detectComparisonMode,
  applyResolutions,
} from "./wms_count_variance";
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
        upc: v.optional(v.string()),
        ean: v.optional(v.string()),
        avgCost: v.optional(v.number()),
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
      withBarcode?: number;
      items: Array<{
        itemId: string;
        qtyOnHand: number;
        brand?: string;
        model?: string;
        size?: string;
        mpn?: string;
        upc?: string;
        ean?: string;
        avgCost?: number;
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

export const patchBaselineCostChunk = internalMutation({
  args: {
    batchId: v.id("wms_count_batches"),
    costs: v.array(v.object({ itemId: v.string(), avgCost: v.number() })),
  },
  handler: async (ctx, args) => {
    let patched = 0;
    for (const c of args.costs) {
      const row = await ctx.db
        .query("wms_count_baseline")
        .withIndex("by_batch_item", (q) =>
          q.eq("batchId", args.batchId).eq("itemId", c.itemId),
        )
        .first();
      if (!row || c.avgCost <= 0) continue;
      await ctx.db.patch(row._id, { avgCost: c.avgCost });
      patched += 1;
    }
    return patched;
  },
});

/**
 * Attach costs to a baseline frozen before cost was carried, so a completed count
 * can still be valued.
 *
 * Costs come from the CURRENT OEIVAL rather than the file the batch froze, which
 * is a real approximation and the reason this is separate from the freeze rather
 * than folded into it: avgCost moves slowly, quantities do not. Any batch frozen
 * from now on carries its own cost and never needs this.
 */
export const backfillBaselineCost = action({
  args: { batchId: v.id("wms_count_batches") },
  handler: async (
    ctx,
    args,
  ): Promise<{ patched: number; withCost: number; missing: number }> => {
    const batch = await ctx.runQuery(internal.wms_count.getBatchInternal, {
      batchId: args.batchId,
    });
    if (!batch) throw new Error("Batch not found");

    const base = process.env.IECENTRAL_SNAPSHOT_URL;
    const token = process.env.IECENTRAL_SNAPSHOT_TOKEN;
    if (!base || !token) throw new Error("Snapshot is not configured");

    const res = await fetch(
      `${base}/api/inventory/snapshot?location=${encodeURIComponent(batch.warehouseCode)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`Snapshot returned ${res.status}`);
    const snap = (await res.json()) as {
      items: Array<{ itemId: string; avgCost?: number }>;
    };

    const costs = snap.items
      .map((i) => ({ itemId: i.itemId, avgCost: Number(i.avgCost ?? 0) || 0 }))
      .filter((c) => c.avgCost > 0);

    let patched = 0;
    for (let i = 0; i < costs.length; i += 300) {
      patched += await ctx.runMutation(internal.wms_count.patchBaselineCostChunk, {
        batchId: args.batchId,
        costs: costs.slice(i, i + 300),
      });
    }
    return {
      patched,
      withCost: costs.length,
      missing: snap.items.length - costs.length,
    };
  },
});

export const markScoped = internalMutation({
  args: {
    batchId: v.id("wms_count_batches"),
    scopeLabel: v.string(),
    scopeMissing: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.batchId, {
      scoped: true,
      scopeLabel: args.scopeLabel,
      scopeMissing: args.scopeMissing,
    });
  },
});

/**
 * Open a count batch scoped to a named list of items — a recount of the lines a
 * previous count could not settle.
 *
 * The point is not convenience, it is that the scope becomes RECORDED. A normal
 * batch freezes the whole location, so a line that ends up never scanned is
 * ambiguous forever: shrink, or nobody walked that aisle. Nothing in the data can
 * tell those apart, which is why the two-count comparison has to withhold a
 * verdict on them. Here the scope is declared up front, so inside it an un-scanned
 * line means the tires are genuinely not there, and the variance can be trusted.
 *
 * Item numbers are matched suffix-insensitively (AYAGS008 finds AYAGS008.) so a
 * list pasted out of a report works, and every barcode-sharing sibling of a
 * matched item is pulled in too — the scanner cannot tell d-class variants apart,
 * so freezing one without the other would invent a short and an over.
 */
export const openScopedCountBatch = action({
  args: {
    warehouseCode: v.string(),
    itemIds: v.array(v.string()),
    scopeLabel: v.string(),
    actor: actorValidator,
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    batchId: Id<"wms_count_batches">;
    alreadyOpen: boolean;
    frozenItems?: number;
    frozenUnits?: number;
    missing?: string[];
  }> => {
    if (args.itemIds.length === 0) throw new Error("No items to recount");

    const created: { batchId: Id<"wms_count_batches">; alreadyOpen: boolean } =
      await ctx.runMutation(internal.wms_count.createBatchInternal, {
        warehouseCode: args.warehouseCode,
        actor: args.actor,
      });
    if (created.alreadyOpen) return created;

    const base = process.env.IECENTRAL_SNAPSHOT_URL;
    const token = process.env.IECENTRAL_SNAPSHOT_TOKEN;
    if (!base || !token) {
      await ctx.runMutation(internal.wms_count.finishBaseline, {
        batchId: created.batchId,
        status: "failed",
        error: "IECENTRAL_SNAPSHOT_URL / IECENTRAL_SNAPSHOT_TOKEN not set.",
      });
      return created;
    }

    try {
      const res = await fetch(
        `${base}/api/inventory/snapshot?location=${encodeURIComponent(args.warehouseCode)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`Snapshot returned ${res.status}`);
      const snap = (await res.json()) as {
        fileDate: string | null;
        generatedAt: string | null;
        items: Array<{
          itemId: string;
          qtyOnHand: number;
          upc?: string;
          ean?: string;
          [k: string]: unknown;
        }>;
      };

      const norm = (x: string) =>
        String(x ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      const wanted = new Set(args.itemIds.map(norm).filter(Boolean));

      const direct = snap.items.filter((i) => wanted.has(norm(i.itemId)));

      // Pull in every sibling sharing a matched item's barcode. Freezing one
      // d-class variant without the other guarantees a fictional short on one and
      // an over on the other, because the scanner reads only the barcode.
      const codes = new Set(
        direct.flatMap((i) =>
          [String(i.upc ?? "").trim(), String(i.ean ?? "").trim()].filter(Boolean),
        ),
      );
      const chosen = snap.items.filter(
        (i) =>
          wanted.has(norm(i.itemId)) ||
          codes.has(String(i.upc ?? "").trim()) ||
          codes.has(String(i.ean ?? "").trim()),
      );

      const found = new Set(chosen.map((i) => norm(i.itemId)));
      const missing = args.itemIds.filter((id) => !found.has(norm(id)));

      if (chosen.length === 0) {
        throw new Error(
          "None of those item numbers are in this location's book right now.",
        );
      }

      for (let i = 0; i < chosen.length; i += 500) {
        await ctx.runMutation(internal.wms_count.insertBaselineChunk, {
          batchId: created.batchId,
          items: chosen.slice(i, i + 500) as any,
        });
      }

      await ctx.runMutation(internal.wms_count.markScoped, {
        batchId: created.batchId,
        scopeLabel: args.scopeLabel,
        scopeMissing: missing,
      });

      const units = chosen.reduce((n, i) => n + Number(i.qtyOnHand ?? 0), 0);
      await ctx.runMutation(internal.wms_count.finishBaseline, {
        batchId: created.batchId,
        status: "ready",
        fileDate: snap.fileDate ?? undefined,
        generatedAt: snap.generatedAt ?? undefined,
        itemCount: chosen.length,
        unitCount: units,
        // Nothing was excluded as a non-tire here: the scope is an explicit list,
        // and the snapshot has already dropped placeholders before we see it.
        excludedNonTires: 0,
        excludedUnits: 0,
      });

      return {
        ...created,
        frozenItems: chosen.length,
        frozenUnits: units,
        missing,
      };
    } catch (err: any) {
      await ctx.runMutation(internal.wms_count.clearBaseline, {
        batchId: created.batchId,
      });
      await ctx.runMutation(internal.wms_count.finishBaseline, {
        batchId: created.batchId,
        status: "failed",
        error: err?.message ?? "Scoped snapshot failed",
      });
      throw err;
    }
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
  opts: {
    itemId?: string;
    upc?: string;
    qtyDelta: number;
    scanDelta: number;
    onBook?: boolean;
  },
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
      onBook: opts.onBook ?? false,
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
    ...(opts.onBook !== undefined ? { onBook: opts.onBook } : {}),
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

    const raw = String(args.rawBarcode ?? "").trim();
    const upc = normalizeUpc(args.rawBarcode);
    let itemId: string | undefined;
    let matchSource: "upc" | "manual-search" | "unmatched" = "unmatched";
    let brand: string | undefined;
    let model: string | undefined;
    let size: string | undefined;
    // True when the scan resolved to a row in THIS batch's baseline. Recorded on
    // the totals row so progress needs no baseline read.
    let matchedInBook = false;

    /**
     * Resolve the scan to an item in THIS BATCH'S BOOK.
     *
     * tireUPCs.inventoryNumber does NOT hold the OEIVAL itemId — measured 0 of
     * 3,873 matches against itemId versus ~25% against mfgItemId. It holds the
     * manufacturer part number. So a UPC gives us a part number, and that part
     * number is resolved against the baseline by itemId first, then by mpn.
     *
     * Resolving against the BASELINE rather than the whole catalog is deliberate:
     * catalog-wide, 21,119 mfgItemIds map to more than one itemId (variant
     * suffixes like BS011457 vs "BS011457["), but within the in-stock set every
     * mfgItemId is unique — verified 0 collisions across W09's 480. So this
     * cannot silently attach a scan to the wrong tire, and a match is always to
     * something the book says is actually in stock.
     */
    const resolveInBaseline = async (key: string) => {
      if (!key) return null;
      // Barcode first — JMK's own upcCode/ean, keyed by this itemId, is the
      // authoritative scan key (99% populated at W09). Then itemId and the
      // manufacturer part number, for labels that carry those instead.
      // A barcode can match SEVERAL baseline rows: JMK carries the same tire under
      // d-class variants (AYAEP031^ / AYAEP031.) that share one printed barcode —
      // 353 such barcodes at W08. Pick deterministically (deepest stock, then
      // itemId) so repeat scans of one tire always land on the same row and the
      // running total is stable. The variance report then reunites the variants
      // into a single line, so the choice cannot skew the result either way.
      const pick = (rows: any[]) =>
        rows.length === 0
          ? null
          : rows.slice().sort(
              (a, b) =>
                b.qtyOnHand - a.qtyOnHand || a.itemId.localeCompare(b.itemId),
            )[0];

      const byUpc = pick(
        await ctx.db
          .query("wms_count_baseline")
          .withIndex("by_batch_upc", (q) =>
            q.eq("batchId", args.batchId).eq("upc", key),
          )
          .collect(),
      );
      if (byUpc) return byUpc;
      const byEan = pick(
        await ctx.db
          .query("wms_count_baseline")
          .withIndex("by_batch_ean", (q) =>
            q.eq("batchId", args.batchId).eq("ean", key),
          )
          .collect(),
      );
      if (byEan) return byEan;
      const byItem = await ctx.db
        .query("wms_count_baseline")
        .withIndex("by_batch_item", (q) =>
          q.eq("batchId", args.batchId).eq("itemId", key),
        )
        .first();
      if (byItem) return byItem;
      return await ctx.db
        .query("wms_count_baseline")
        .withIndex("by_batch_mpn", (q) =>
          q.eq("batchId", args.batchId).eq("mpn", key),
        )
        .first();
    };

    if (args.itemIdOverride) {
      itemId = args.itemIdOverride;
      matchSource = "manual-search";
      const base = await resolveInBaseline(args.itemIdOverride);
      if (base) {
        matchedInBook = true;
        itemId = base.itemId;
        brand = base.brand;
        model = base.model;
        size = base.size;
      }
    } else if (raw) {
      /**
       * Barcode -> tireUPCs, mirroring queries.getTireByUPC, which is already
       * proven against these scanners in the Returns flow. Order matters:
       *
       *   1. exact UPC on the RAW code (never the digit-stripped one — part
       *      numbers are alphanumeric, so stripping turns AEP044 into 044)
       *   2. exact UPC on the digits-only form, for formatted barcodes
       *   3. exact inventory/part number on the raw code
       *   4. part number with a trailing check digit stripped
       *
       * A warehouse label may also carry the itemId or part number itself, so
       * the raw code is finally tried straight against the book.
       */
      // 0. The scanned code straight against the book. JMK's barcode lives there
      //    now, so this is the common path and needs no bridge table at all.
      const direct0 = (await resolveInBaseline(raw)) ?? (upc && upc !== raw ? await resolveInBaseline(upc) : null);
      if (direct0) {
        matchedInBook = true;
        itemId = direct0.itemId;
        matchSource = "upc";
        brand = direct0.brand;
        model = direct0.model;
        size = direct0.size;
      }

      let tire =
        itemId ? null :
        (await ctx.db
          .query("tireUPCs")
          .withIndex("by_upc", (q) => q.eq("upc", raw))
          .first()) ??
        (upc && upc !== raw
          ? await ctx.db
              .query("tireUPCs")
              .withIndex("by_upc", (q) => q.eq("upc", upc))
              .first()
          : null) ??
        (await ctx.db
          .query("tireUPCs")
          .withIndex("by_inventoryNumber", (q) => q.eq("inventoryNumber", raw))
          .first());

      if (!itemId && !tire && raw.length >= 5 && raw.length <= 8) {
        tire = await ctx.db
          .query("tireUPCs")
          .withIndex("by_inventoryNumber", (q) =>
            q.eq("inventoryNumber", raw.slice(0, -1)),
          )
          .first();
      }

      if (!itemId && tire?.inventoryNumber) {
        const base = await resolveInBaseline(tire.inventoryNumber);
        if (base) {
          // Canonical itemId comes from the book, so totals and variance join.
          matchedInBook = true;
          itemId = base.itemId;
          matchSource = "upc";
          brand = base.brand ?? tire.brand;
          model = base.model ?? tire.model;
          size = base.size ?? tire.size;
        } else {
          // Known barcode, but the tire is not in this location's book. Keep it
          // unmatched rather than inventing an itemId the baseline never had —
          // it will surface as an unexpected/unmatched line, which is the truth.
          brand = tire.brand;
          model = tire.model;
          size = tire.size;
        }
      }
    }

    /**
     * Duplicate guard.
     *
     * The failure it catches, measured on W09's first count: a counter scans a
     * stack, the confirmation is missed or the barcode is unknown so nothing
     * visibly lands, and they scan the same stack again. Both copies count. One
     * such pair put 204 extra tires on a 261-tire line (+197) and another put 121
     * on a 177-tire line — 345 phantom units between them, indistinguishable from
     * a real overage once the batch is closed.
     *
     * It WARNS rather than refuses. "I found 20 more of these" is ordinary
     * counting, and a hard block would either lose that stock or teach counters
     * to work around the tool. So the scan is recorded, the pair is flagged, and
     * both the scanner and the Admin review panel can surface it while the people
     * who were on the floor are still standing there.
     */
    const now = Date.now();
    let duplicateOf: Id<"wms_count_scans"> | undefined;
    let duplicatePrior:
      | { quantity: number; minutesAgo: number; scannedByName: string }
      | undefined;
    {
      const priors = itemId
        ? await ctx.db
            .query("wms_count_scans")
            .withIndex("by_batch_item", (q) =>
              q.eq("batchId", args.batchId).eq("itemId", itemId),
            )
            .collect()
        : await ctx.db
            .query("wms_count_scans")
            .withIndex("by_batch_upc", (q) =>
              q.eq("batchId", args.batchId).eq("upc", upc || args.rawBarcode),
            )
            .collect();
      const twin = priors
        .filter(
          (p) =>
            !p.voided &&
            p.quantity === args.quantity &&
            now - p.scannedAt <= DUPLICATE_WINDOW_MS,
        )
        .sort((a, b) => b.scannedAt - a.scannedAt)[0];
      if (twin) {
        duplicateOf = twin._id;
        duplicatePrior = {
          quantity: twin.quantity,
          minutesAgo: Math.round((now - twin.scannedAt) / 60000),
          scannedByName: twin.scannedByName,
        };
      }
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
      scannedAt: now,
      suspectedDuplicateOf: duplicateOf,
    });

    await applyTotalsDelta(ctx, args.batchId, {
      itemId,
      upc: upc || args.rawBarcode,
      qtyDelta: args.quantity,
      scanDelta: 1,
      onBook: matchedInBook,
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

/**
 * How long after a scan an identical quantity on the same tire counts as a
 * suspected re-scan. Measured against W09's real duplicates: every confirmed pair
 * was under 40 seconds apart, and the widest same-quantity pair that turned out
 * LEGITIMATE was 37 minutes. 15 minutes sits between the two.
 */
const DUPLICATE_WINDOW_MS = 15 * 60 * 1000;

/**
 * Scans flagged as a suspected re-scan, with the earlier scan they duplicate.
 *
 * Review queue, not a verdict — the point is to put the pair in front of somebody
 * while the count is still open and the counters are still on the floor.
 */
export const listSuspectedDuplicates = query({
  args: { batchId: v.id("wms_count_batches") },
  handler: async (ctx, args) => {
    const scans = await ctx.db
      .query("wms_count_scans")
      .withIndex("by_batch_scannedAt", (q) => q.eq("batchId", args.batchId))
      .collect();
    const byId = new Map(scans.map((s) => [s._id, s]));

    const pairs = [];
    for (const s of scans) {
      if (!s.suspectedDuplicateOf || s.voided) continue;
      const prior = byId.get(s.suspectedDuplicateOf);
      if (!prior || prior.voided) continue;
      pairs.push({
        scanId: s._id,
        priorScanId: prior._id,
        itemId: s.itemId,
        brand: s.brand,
        model: s.model,
        size: s.size,
        quantity: s.quantity,
        rawBarcode: s.rawBarcode,
        scannedAt: s.scannedAt,
        priorScannedAt: prior.scannedAt,
        secondsApart: Math.round((s.scannedAt - prior.scannedAt) / 1000),
        scannedByName: s.scannedByName,
        priorScannedByName: prior.scannedByName,
        sameCounter: s.scannedBy === prior.scannedBy,
      });
    }
    return pairs.sort((a, z) => z.quantity - a.quantity);
  },
});

/**
 * Fold off-book count totals back onto the book row they actually belong to.
 *
 * A hand-resolve stores whatever itemId the sidewall search returned, and that
 * search drops the book's d-class suffix (AYAGS008 where the book holds
 * AYAGS008.). resolveUnmatchedUpc canonicalises onto the book to prevent this,
 * but anything filed before that guard existed — or through any path that ever
 * misses — leaves one correct count producing two wrong numbers: an "unexpected"
 * over of the full counted quantity, plus the real book row reported as shrink.
 *
 * This is the repair, and it is deliberately a REPAIR rather than a report fix:
 * the stored data is what a closed batch is judged on, so it has to be right in
 * the table, not just in one query. The scans move with the units so the audit
 * trail names the book's own item, and the tireUPCs mapping a bad resolve wrote
 * is repointed at the manufacturer part number, per that table's convention —
 * otherwise the same sidewall barcode comes up unknown on the next scan.
 *
 * Internal, and dryRun-first, because it rewrites counted quantities on a live
 * inventory. Run with dryRun true, read the plan, then run it for real.
 */
export const repairOffBookTotals = internalMutation({
  args: { batchId: v.id("wms_count_batches"), dryRun: v.boolean() },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) throw new Error("Batch not found");

    const baseline = await ctx.db
      .query("wms_count_baseline")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .collect();
    const totals = await ctx.db
      .query("wms_count_totals")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .collect();
    const scans = await ctx.db
      .query("wms_count_scans")
      .withIndex("by_batch_scannedAt", (q) => q.eq("batchId", args.batchId))
      .collect();

    const moves: Array<{
      from: string;
      to: string;
      qty: number;
      scans: number;
      bookQty: number;
      mappingsFixed: string[];
    }> = [];

    for (const t of totals) {
      if (!t.itemId || t.onBook) continue;
      const base = canonicalItemIdFrom(t.itemId, undefined, baseline);
      // No book row in any spelling means the count is a genuine off-book find —
      // stock the book says this location does not have. Leave it alone.
      if (!base || base.itemId === t.itemId) continue;

      const mine = scans.filter((s) => s.itemId === t.itemId && !s.voided);
      const mappingsFixed: string[] = [];

      if (!args.dryRun) {
        for (const s of mine) {
          await ctx.db.patch(s._id, {
            itemId: base.itemId,
            brand: base.brand ?? s.brand,
            model: base.model ?? s.model,
            size: base.size ?? s.size,
          });
        }
        await ctx.db.delete(t._id);
        await applyTotalsDelta(ctx, args.batchId, {
          itemId: base.itemId,
          qtyDelta: t.countedQty,
          scanDelta: t.scanCount,
          onBook: true,
        });
      }

      // Repoint only the mappings these scans actually created — a sweep by
      // inventoryNumber alone could rewrite rows belonging to another location.
      for (const code of new Set(mine.map((s) => s.upc || s.rawBarcode))) {
        if (!code) continue;
        const row = await ctx.db
          .query("tireUPCs")
          .withIndex("by_upc", (q) => q.eq("upc", code))
          .first();
        if (!row || row.inventoryNumber !== t.itemId || !base.mpn) continue;
        mappingsFixed.push(`${code} -> ${base.mpn}`);
        if (args.dryRun) continue;
        await ctx.db.patch(row._id, {
          inventoryNumber: base.mpn,
          brand: row.brand || base.brand || "",
          model: row.model || base.model || "",
          size: row.size || base.size || "",
        });
      }

      moves.push({
        from: t.itemId,
        to: base.itemId,
        qty: t.countedQty,
        scans: t.scanCount,
        bookQty: base.qtyOnHand,
        mappingsFixed,
      });
    }

    return { dryRun: args.dryRun, moved: moves.length, moves };
  },
});

/**
 * Void scans by id, reversing their totals — the same effect as the scanner's
 * undo, without an actor, for cleaning up a duplicate a counter could not undo
 * themselves (a retry of a stack that was later attached by a batch-scope
 * resolve, so both copies ended up counted).
 *
 * dryRun-first for the same reason as above.
 */
export const voidCountScansById = internalMutation({
  args: {
    scanIds: v.array(v.id("wms_count_scans")),
    dryRun: v.boolean(),
    note: v.optional(v.string()),
    /**
     * Correct a batch that is already CLOSED. Off by default: a closed batch is
     * the figure the business has been given, so changing it has to be a decision
     * somebody made on purpose, not a side effect of running a repair script.
     */
    allowClosed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const done: Array<{
      scanId: string;
      itemId?: string;
      qty: number;
      scannedByName: string;
      skipped?: string;
    }> = [];

    for (const scanId of args.scanIds) {
      const scan = await ctx.db.get(scanId);
      if (!scan) {
        done.push({ scanId, qty: 0, scannedByName: "", skipped: "not found" });
        continue;
      }
      const row = {
        scanId,
        itemId: scan.itemId,
        qty: scan.quantity,
        scannedByName: scan.scannedByName,
      };
      if (scan.voided) {
        done.push({ ...row, skipped: "already voided" });
        continue;
      }
      const batch = await ctx.db.get(scan.batchId);
      if (!batch || (batch.status !== "open" && !args.allowClosed)) {
        done.push({ ...row, skipped: "batch closed — pass allowClosed to correct it" });
        continue;
      }
      done.push(row);
      if (args.dryRun) continue;

      await ctx.db.patch(scanId, {
        voided: true,
        voidedBy: args.note ?? "repair:duplicate",
        voidedAt: Date.now(),
      });
      await applyTotalsDelta(ctx, scan.batchId, {
        itemId: scan.itemId,
        upc: scan.upc || scan.rawBarcode,
        qtyDelta: -scan.quantity,
        scanDelta: -1,
      });
    }

    return { dryRun: args.dryRun, scans: done };
  },
});

/**
 * Put a voided scan back, restoring its units — the inverse of the above, because
 * a correction made from a report can itself be wrong, and the only safe repair
 * tool is one that goes both ways.
 */
export const unvoidCountScansById = internalMutation({
  args: {
    scanIds: v.array(v.id("wms_count_scans")),
    dryRun: v.boolean(),
    allowClosed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const done: Array<{
      scanId: string;
      itemId?: string;
      qty: number;
      skipped?: string;
    }> = [];

    for (const scanId of args.scanIds) {
      const scan = await ctx.db.get(scanId);
      if (!scan) {
        done.push({ scanId, qty: 0, skipped: "not found" });
        continue;
      }
      const row = { scanId, itemId: scan.itemId, qty: scan.quantity };
      if (!scan.voided) {
        done.push({ ...row, skipped: "not voided" });
        continue;
      }
      const batch = await ctx.db.get(scan.batchId);
      if (!batch || (batch.status !== "open" && !args.allowClosed)) {
        done.push({ ...row, skipped: "batch closed — pass allowClosed" });
        continue;
      }
      done.push(row);
      if (args.dryRun) continue;

      await ctx.db.patch(scanId, {
        voided: undefined,
        voidedBy: undefined,
        voidedAt: undefined,
      });
      await applyTotalsDelta(ctx, scan.batchId, {
        itemId: scan.itemId,
        upc: scan.upc || scan.rawBarcode,
        qtyDelta: scan.quantity,
        scanDelta: 1,
      });
    }

    return { dryRun: args.dryRun, scans: done };
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

    // An empty batch CAN be closed. Blocking it was a mistake: only one batch
    // may be open per location and the scanner cannot delete, so a batch opened
    // by accident left the location permanently stuck with no way out from the
    // floor. The scanner confirms with the actual counts before calling this, so
    // closing an empty one is a visible, deliberate act rather than a slip.
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
 * Reopen a batch that was closed by accident. Admin-only from Admin — an
 * inventory-role scanner shouldn't be able to un-close a finished count.
 *
 * The location constraint (one open batch per warehouseCode) is enforced by
 * refusing to reopen when another batch at that warehouse is already open —
 * whichever should stand has to be resolved deliberately before this call.
 * closedBy/closedByName/closedAt are cleared; the reopen itself is written to
 * auditLogs so the forensic trail is preserved.
 */
export const reopenCountBatch = mutation({
  args: { batchId: v.id("wms_count_batches"), actor: actorValidator },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) throw new Error("Batch not found");
    if (batch.status === "open") return { success: true };

    if (args.actor.kind !== "admin") {
      throw new Error("Only admins can reopen a closed count batch");
    }
    const admin = await ctx.db.get(args.actor.adminId);
    if (!admin || !admin.isActive) throw new Error("Not authorized");
    if (admin.role !== "admin" && admin.role !== "superadmin") {
      throw new Error("Not authorized");
    }

    const existingOpen = await ctx.db
      .query("wms_count_batches")
      .withIndex("by_warehouse_status", (q) =>
        q.eq("warehouseCode", batch.warehouseCode).eq("status", "open"),
      )
      .first();
    if (existingOpen) {
      throw new Error(
        `Cannot reopen — ${batch.warehouseCode} already has an open batch (${existingOpen._id}). Close or delete that batch first.`,
      );
    }

    const closedAt = batch.closedAt;
    const closedByName = batch.closedByName;
    await ctx.db.patch(args.batchId, {
      status: "open",
      closedBy: undefined,
      closedByName: undefined,
      closedAt: undefined,
    });

    await ctx.db.insert("auditLogs", {
      action: `Reopened count batch ${args.batchId}`,
      actionType: "count.batch.reopen",
      resourceType: "wms_count_batch",
      resourceId: String(args.batchId),
      adminId: args.actor.adminId,
      adminEmail: admin.email,
      adminName: admin.name,
      details: JSON.stringify({
        warehouseCode: batch.warehouseCode,
        previouslyClosedAt: closedAt,
        previouslyClosedByName: closedByName,
      }),
      timestamp: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Delete a count batch and everything belonging to it.
 *
 * Needed because a batch opened by mistake would otherwise block the location
 * forever — only one batch may be open per location, and an empty batch cannot
 * be closed... but the real reason this is an ACTION that pages is scale: a
 * single mutation deleting a whole baseline blew Convex's 4,096-read limit at
 * W08 (6,837 rows). W09's 479 rows hid that entirely.
 */
export const deleteCountBatchPage = internalMutation({
  args: { batchId: v.id("wms_count_batches"), limit: v.number() },
  handler: async (ctx, args) => {
    let budget = args.limit;
    let baseline = 0;
    let totals = 0;
    let scans = 0;

    const bl = await ctx.db
      .query("wms_count_baseline")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .take(budget);
    for (const r of bl) await ctx.db.delete(r._id);
    baseline = bl.length;
    budget -= baseline;

    if (budget > 0) {
      const tl = await ctx.db
        .query("wms_count_totals")
        .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
        .take(budget);
      for (const r of tl) await ctx.db.delete(r._id);
      totals = tl.length;
      budget -= totals;
    }

    if (budget > 0) {
      const sc = await ctx.db
        .query("wms_count_scans")
        .withIndex("by_batch_scannedAt", (q) => q.eq("batchId", args.batchId))
        .take(budget);
      for (const r of sc) await ctx.db.delete(r._id);
      scans = sc.length;
      budget -= scans;
    }

    const done = baseline + totals + scans === 0;
    if (done) await ctx.db.delete(args.batchId);
    return { baseline, totals, scans, done };
  },
});

export const authorizeDelete = internalMutation({
  args: { callerAdminId: v.id("adminUsers") },
  handler: async (ctx, args) => {
    const admin = await ctx.db.get(args.callerAdminId);
    if (!admin || !admin.isActive) throw new Error("Not authorized");
    if (admin.role !== "admin" && admin.role !== "superadmin") {
      throw new Error("Not authorized");
    }
    return true;
  },
});

export const deleteCountBatch = action({
  args: {
    batchId: v.id("wms_count_batches"),
    callerAdminId: v.id("adminUsers"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    success: true;
    deleted: { baseline: number; totals: number; scans: number };
  }> => {
    await ctx.runMutation(internal.wms_count.authorizeDelete, {
      callerAdminId: args.callerAdminId,
    });

    const tally = { baseline: 0, totals: 0, scans: 0 };
    // 1,000 deletes per call keeps each mutation well inside the read limit;
    // the loop bound is generous headroom over the largest location.
    for (let i = 0; i < 200; i++) {
      const page: { baseline: number; totals: number; scans: number; done: boolean } =
        await ctx.runMutation(internal.wms_count.deleteCountBatchPage, {
          batchId: args.batchId,
          limit: 1000,
        });
      tally.baseline += page.baseline;
      tally.totals += page.totals;
      tally.scans += page.scans;
      if (page.done) break;
    }
    return { success: true as const, deleted: tally };
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
    /** Manufacturer part number from the search result, when the client sends it. */
    mpn: v.optional(v.string()),
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

    /**
     * The canonical itemId comes from the BOOK, never from the catalog search.
     * The search returns AYAGS089 where the book holds AYAGS089. (461 of W09's
     * 478 itemIds carry that d-class suffix), so storing the search's spelling
     * files a correctly-counted tire as an off-book "unexpected" line AND leaves
     * its real book row reported as shrink — two wrong numbers from one right count.
     *
     * Indexed lookups first; the whole-baseline scan is the last resort and only
     * runs on a genuine miss, since manual resolves are rare.
     */
    let base = await ctx.db
      .query("wms_count_baseline")
      .withIndex("by_batch_item", (q) =>
        q.eq("batchId", args.batchId).eq("itemId", args.itemId),
      )
      .first();
    if (!base && args.mpn) {
      base = await ctx.db
        .query("wms_count_baseline")
        .withIndex("by_batch_mpn", (q) =>
          q.eq("batchId", args.batchId).eq("mpn", args.mpn!),
        )
        .first();
    }
    if (!base) {
      const allBaseline = await ctx.db
        .query("wms_count_baseline")
        .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
        .collect();
      base = canonicalItemIdFrom(args.itemId, args.mpn, allBaseline);
    }
    const itemId = base?.itemId ?? args.itemId;

    let moved = 0;
    for (const scan of candidates as any[]) {
      if (!scan || scan.voided || scan.itemId) continue;
      await ctx.db.patch(scan._id, {
        itemId,
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
        itemId,
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
      /**
       * inventoryNumber holds the manufacturer PART NUMBER, per the schema note
       * on tireUPCs — not the itemId. Prefer the book's mpn, then the search's;
       * either resolves, since the barcode ladder tries itemId and mpn both.
       * The old code stored args.itemId here, which matched neither key once the
       * search's spelling diverged from the book's, so the mapping was dead on
       * arrival and the same barcode came up unknown again on the next scan.
       */
      const partNumber = base?.mpn || args.mpn || args.itemId;
      if (existing) {
        await ctx.db.patch(existing._id, { inventoryNumber: partNumber });
      } else {
        await ctx.db.insert("tireUPCs", {
          upc: args.upc,
          brand: base?.brand ?? "",
          model: base?.model ?? "",
          size: base?.size ?? "",
          inventoryNumber: partNumber,
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
    // `by` is the stringified id, included so a client can identify ITSELF
    // reliably — two counters can share a display name.
    const byCounter = new Map<
      string,
      { by: string; name: string; units: number; scans: number }
    >();
    for (const s of live) {
      const e = byCounter.get(s.scannedBy) ?? {
        by: s.scannedBy,
        name: s.scannedByName,
        units: 0,
        scans: 0,
      };
      e.units += s.quantity;
      e.scans += 1;
      byCounter.set(s.scannedBy, e);
    }

    // Progress is measured against the BOOK. Denominators come off the batch
    // record and the on/off-book split comes off the totals rows, so this does
    // NOT read the baseline — doing so cost 6,837 document reads per reactive
    // call at W08, on a query the scanner subscribes to.
    let onBookItemsSeen = 0;
    let onBookUnits = 0;
    let unexpectedItems = 0;
    let unexpectedUnits = 0;
    for (const t of totals) {
      if (!t.itemId) continue;
      if (t.onBook) {
        onBookItemsSeen += 1;
        onBookUnits += t.countedQty;
      } else {
        unexpectedItems += 1;
        unexpectedUnits += t.countedQty;
      }
    }

    const bookItemCount = batch.baselineItemCount ?? 0;
    const bookUnitCount = batch.baselineUnitCount ?? 0;
    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

    return {
      batch,
      countedItems: totals.filter((t) => !!t.itemId).length,
      countedUnits: totals.reduce((n, t) => n + t.countedQty, 0),
      unmatchedUpcs: totals.filter((t) => !t.itemId).length,
      scanCount: live.length,
      voidedCount: scans.length - live.length,
      counters: [...byCounter.values()].sort((a, b) => b.units - a.units),

      // Progress vs the book
      bookItemCount,
      bookUnitCount,
      onBookItemsSeen,
      onBookUnits,
      itemCoveragePct: pct(onBookItemsSeen, bookItemCount),
      unitProgressPct: pct(onBookUnits, bookUnitCount),
      unexpectedItems,
      unexpectedUnits,
    };
  },
});

/**
 * How much of a batch's book is actually SCANNABLE.
 *
 * A tire can only be matched by barcode if some row in tireUPCs carries its
 * itemId as inventoryNumber. Anything without one will scan as an unmatched UPC
 * and need resolving by hand — so knowing this number BEFORE a count starts is
 * the difference between a smooth day and a pile of manual attribution.
 *
 * Uses the by_inventoryNumber index, one lookup per baseline item.
 */
export const getUpcCoverage = query({
  args: { batchId: v.id("wms_count_batches") },
  handler: async (ctx, args) => {
    const baseline = await ctx.db
      .query("wms_count_baseline")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .collect();

    let withUpc = 0;
    let viaOeival = 0;
    let viaItemId = 0;
    let viaMpn = 0;
    let unitsWithUpc = 0;
    let unitsWithout = 0;
    const missing: Array<{
      itemId: string;
      qtyOnHand: number;
      brand?: string;
      size?: string;
    }> = [];

    for (const row of baseline) {
      // JMK's own barcode on the baseline row is the authoritative key and needs
      // no bridge table at all — count it first.
      if (row.upc || row.ean) {
        viaOeival += 1;
        withUpc += 1;
        unitsWithUpc += row.qtyOnHand;
        continue;
      }

      // Otherwise fall back to tireUPCs. Two candidate keys, because
      // tireUPCs.inventoryNumber is NOT the OEIVAL itemId — measured 0/3873
      // against itemId but ~25% against mfgItemId.
      let hit = await ctx.db
        .query("tireUPCs")
        .withIndex("by_inventoryNumber", (q) =>
          q.eq("inventoryNumber", row.itemId),
        )
        .first();
      let via: "itemId" | "mpn" | null = hit ? "itemId" : null;
      if (!hit && row.mpn) {
        hit = await ctx.db
          .query("tireUPCs")
          .withIndex("by_inventoryNumber", (q) =>
            q.eq("inventoryNumber", row.mpn!),
          )
          .first();
        if (hit) via = "mpn";
      }
      if (via === "itemId") viaItemId += 1;
      if (via === "mpn") viaMpn += 1;
      if (hit) {
        withUpc += 1;
        unitsWithUpc += row.qtyOnHand;
      } else {
        unitsWithout += row.qtyOnHand;
        if (missing.length < 200) {
          missing.push({
            itemId: row.itemId,
            qtyOnHand: row.qtyOnHand,
            brand: row.brand,
            size: row.size,
          });
        }
      }
    }

    missing.sort((a, b) => b.qtyOnHand - a.qtyOnHand);
    const total = baseline.length;
    return {
      totalItems: total,
      withUpc,
      withoutUpc: total - withUpc,
      itemCoveragePct: total > 0 ? Math.round((withUpc / total) * 100) : 0,
      viaOeival,
      viaItemId,
      viaMpn,
      unitsWithUpc,
      unitsWithout,
      unitCoveragePct:
        unitsWithUpc + unitsWithout > 0
          ? Math.round((unitsWithUpc / (unitsWithUpc + unitsWithout)) * 100)
          : 0,
      // Biggest gaps first — these are the tires worth mapping before a count.
      missingTopItems: missing.slice(0, 25),
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

/**
 * Compare two counts of the same location — the second-count report.
 *
 * One count cannot separate a real shortage from a miscount. Two can: where both
 * passes land on the same number, that number is worth adjusting on even when it
 * disagrees with JMK; where they disagree with each other, the only honest output
 * is "go look again". This query produces exactly that split.
 *
 * Both batches must be the same warehouse — comparing two locations would produce
 * a report that looks meaningful and is not.
 *
 * Scale ceiling is real and deliberate rather than hidden: this reads BOTH
 * baselines in one query, so it is bounded by Convex's per-query document limit.
 * W09 (477 lines a side) is nowhere near it; W08 Latrobe at 6,837 a side is, so
 * the guard refuses loudly instead of failing halfway through a report somebody
 * is about to act on.
 */
export const compareCountBatches = query({
  args: {
    firstBatchId: v.id("wms_count_batches"),
    secondBatchId: v.id("wms_count_batches"),
    /**
     * Omit to infer from how much the second pass covered. Only set it to
     * override a wrong guess — see ComparisonMode for why this changes what the
     * report may conclude, not just how it looks.
     */
    mode: v.optional(v.union(v.literal("full"), v.literal("partial"))),
  },
  handler: async (ctx, args) => {
    if (args.firstBatchId === args.secondBatchId) {
      throw new Error("Pick two different count batches");
    }
    const first = await ctx.db.get(args.firstBatchId);
    const second = await ctx.db.get(args.secondBatchId);
    if (!first || !second) throw new Error("Batch not found");
    if (first.warehouseCode !== second.warehouseCode) {
      throw new Error(
        `Those batches are different locations (${first.warehouseCode} vs ${second.warehouseCode})`,
      );
    }
    if (first.baselineStatus !== "ready" || second.baselineStatus !== "ready") {
      return {
        ready: false as const,
        reason: "One of these counts has no frozen book to judge against yet.",
      };
    }
    const size = (first.baselineItemCount ?? 0) + (second.baselineItemCount ?? 0);
    if (size > 12000) {
      throw new Error(
        `These two books total ${size} lines, too many to compare in one query. ` +
          `This location needs the paged comparison (not built yet) — ask before relying on a partial answer.`,
      );
    }

    // Order by open time, so "first" and "second" mean what an operator expects
    // however the two ids were passed in.
    const [a, z] =
      first.openedAt <= second.openedAt ? [first, second] : [second, first];

    const load = async (batchId: Id<"wms_count_batches">) => ({
      baseline: await ctx.db
        .query("wms_count_baseline")
        .withIndex("by_batch", (q) => q.eq("batchId", batchId))
        .collect(),
      totals: await ctx.db
        .query("wms_count_totals")
        .withIndex("by_batch", (q) => q.eq("batchId", batchId))
        .collect(),
    });

    const loadedFirst = await load(a._id);
    const loadedSecond = await load(z._id);

    // Defaults to partial and is never inferred from coverage — see
    // detectComparisonMode for why that ratio cannot tell a complete count from
    // an abandoned one. Claiming "full" is the caller's assertion to make.
    const mode = args.mode ?? detectComparisonMode();

    const result = compareCounts(loadedFirst, loadedSecond, { mode });

    return {
      ready: true as const,
      mode,
      modeWasInferred: args.mode === undefined,
      warehouseCode: a.warehouseCode,
      first: {
        batchId: a._id,
        openedAt: a.openedAt,
        closedAt: a.closedAt,
        baselineFileDate: a.baselineFileDate,
        openedByName: a.openedByName,
      },
      second: {
        batchId: z._id,
        openedAt: z.openedAt,
        closedAt: z.closedAt,
        baselineFileDate: z.baselineFileDate,
        openedByName: z.openedByName,
      },
      ...result,
    };
  },
});

/**
 * The signed-off inventory for a pair of counts: one actual quantity per line.
 *
 * Deliberately a separate query from the comparison rather than a flag on it. The
 * comparison answers "what do these two counts say", which is evidence; this
 * answers "what do we have", which is a decision, and conflating them would let a
 * report be read as verified when it is really somebody's judgement call.
 */
export const getFinalInventory = query({
  args: {
    firstBatchId: v.id("wms_count_batches"),
    secondBatchId: v.id("wms_count_batches"),
  },
  handler: async (ctx, args) => {
    const first = await ctx.db.get(args.firstBatchId);
    const second = await ctx.db.get(args.secondBatchId);
    if (!first || !second) throw new Error("Batch not found");
    if (first.warehouseCode !== second.warehouseCode) {
      throw new Error("Those batches are different locations");
    }
    if (first.baselineStatus !== "ready" || second.baselineStatus !== "ready") {
      return { ready: false as const, reason: "A frozen book is missing." };
    }
    const [a, z] =
      first.openedAt <= second.openedAt ? [first, second] : [second, first];

    const load = async (batchId: Id<"wms_count_batches">) => ({
      baseline: await ctx.db
        .query("wms_count_baseline")
        .withIndex("by_batch", (q) => q.eq("batchId", batchId))
        .collect(),
      totals: await ctx.db
        .query("wms_count_totals")
        .withIndex("by_batch", (q) => q.eq("batchId", batchId))
        .collect(),
    });

    // Partial: the final inventory must never turn an un-walked line into a
    // confirmed shortage on its own. Resolutions carry the decisions instead.
    const cmp = compareCounts(await load(a._id), await load(z._id), {
      mode: "partial",
    });

    const resolutions = await ctx.db
      .query("wms_count_resolutions")
      .withIndex("by_pair", (q) =>
        q.eq("firstBatchId", a._id).eq("secondBatchId", z._id),
      )
      .collect();

    const applied = applyResolutions(
      cmp.rows,
      resolutions.map((r) => ({
        itemId: r.itemId,
        finalQty: r.finalQty,
        source: r.source,
      })),
    );

    return {
      ready: true as const,
      warehouseCode: a.warehouseCode,
      first: {
        batchId: a._id,
        openedAt: a.openedAt,
        closedAt: a.closedAt,
        baselineFileDate: a.baselineFileDate,
        openedByName: a.openedByName,
      },
      second: {
        batchId: z._id,
        openedAt: z.openedAt,
        closedAt: z.closedAt,
        baselineFileDate: z.baselineFileDate,
        openedByName: z.openedByName,
      },
      resolutionCount: resolutions.length,
      ...applied,
    };
  },
});

/** Record how one disagreement was settled. Upsert, so a decision can be changed. */
export const resolveCountLine = mutation({
  args: {
    firstBatchId: v.id("wms_count_batches"),
    secondBatchId: v.id("wms_count_batches"),
    itemId: v.string(),
    finalQty: v.number(),
    source: v.union(
      v.literal("jmk"),
      v.literal("first"),
      v.literal("second"),
      v.literal("adjusted"),
    ),
    note: v.optional(v.string()),
    actor: actorValidator,
  },
  handler: async (ctx, args) => {
    const first = await ctx.db.get(args.firstBatchId);
    if (!first) throw new Error("Batch not found");
    const { performedBy, performedByName } = await authorizeCountActor(
      ctx,
      args.actor as Actor,
      first.warehouseCode,
    );
    if (!Number.isInteger(args.finalQty) || args.finalQty < 0) {
      throw new Error("Final quantity must be a whole number, zero or more");
    }

    const existing = await ctx.db
      .query("wms_count_resolutions")
      .withIndex("by_pair_item", (q) =>
        q
          .eq("firstBatchId", args.firstBatchId)
          .eq("secondBatchId", args.secondBatchId)
          .eq("itemId", args.itemId),
      )
      .first();

    const row = {
      warehouseCode: first.warehouseCode,
      firstBatchId: args.firstBatchId,
      secondBatchId: args.secondBatchId,
      itemId: args.itemId,
      finalQty: args.finalQty,
      source: args.source,
      note: args.note,
      resolvedBy: performedBy,
      resolvedByName: performedByName,
      resolvedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("wms_count_resolutions", row);
    return { success: true };
  },
});

/** Bulk load of decisions already made on paper. */
export const seedResolutions = internalMutation({
  args: {
    firstBatchId: v.id("wms_count_batches"),
    secondBatchId: v.id("wms_count_batches"),
    resolvedByName: v.string(),
    rows: v.array(
      v.object({
        itemId: v.string(),
        finalQty: v.number(),
        source: v.union(
          v.literal("jmk"),
          v.literal("first"),
          v.literal("second"),
          v.literal("adjusted"),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const first = await ctx.db.get(args.firstBatchId);
    if (!first) throw new Error("Batch not found");
    let inserted = 0;
    let updated = 0;
    for (const r of args.rows) {
      const existing = await ctx.db
        .query("wms_count_resolutions")
        .withIndex("by_pair_item", (q) =>
          q
            .eq("firstBatchId", args.firstBatchId)
            .eq("secondBatchId", args.secondBatchId)
            .eq("itemId", r.itemId),
        )
        .first();
      const row = {
        warehouseCode: first.warehouseCode,
        firstBatchId: args.firstBatchId,
        secondBatchId: args.secondBatchId,
        itemId: r.itemId,
        finalQty: r.finalQty,
        source: r.source,
        resolvedBy: "paper",
        resolvedByName: args.resolvedByName,
        resolvedAt: Date.now(),
      };
      if (existing) {
        await ctx.db.patch(existing._id, row);
        updated += 1;
      } else {
        await ctx.db.insert("wms_count_resolutions", row);
        inserted += 1;
      }
    }
    return { inserted, updated };
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
