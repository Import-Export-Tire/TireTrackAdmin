import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import {
  optimizePickRoute,
  scorePutAwayLocations,
  type RoutingLocation,
  type RoutingInventory,
} from "./wms_routing";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function sumQuantityAtLocation(
  ctx: { db: any },
  locationId: Id<"wms_locations">,
): Promise<number> {
  const rows = await ctx.db
    .query("wms_inventory")
    .withIndex("by_location", (q: any) => q.eq("locationId", locationId))
    .collect();
  return rows.reduce((acc: number, r: any) => acc + r.quantity, 0);
}

async function getOrThrowLocation(
  ctx: { db: any },
  locationId: Id<"wms_locations">,
) {
  const loc = await ctx.db.get(locationId);
  if (!loc) throw new Error(`Location ${locationId} not found`);
  return loc;
}

async function findInventoryRow(
  ctx: { db: any },
  locationId: Id<"wms_locations">,
  upc: string,
) {
  const rows = await ctx.db
    .query("wms_inventory")
    .withIndex("by_location", (q: any) => q.eq("locationId", locationId))
    .collect();
  return rows.find((r: any) => r.upc === upc) ?? null;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const putAway = mutation({
  args: {
    upc: v.string(),
    locationId: v.id("wms_locations"),
    quantity: v.number(),
    description: v.string(),
    brand: v.optional(v.string()),
    size: v.optional(v.string()),
    userId: v.string(),
    userName: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.quantity <= 0) throw new Error("Quantity must be positive");
    const loc = await getOrThrowLocation(ctx, args.locationId);
    if (!loc.isActive) throw new Error("Location is not active");

    const current = await sumQuantityAtLocation(ctx, args.locationId);
    if (current + args.quantity > loc.maxCapacity) {
      throw new Error(
        `Capacity exceeded: ${loc.label} has ${current}/${loc.maxCapacity}, ` +
          `cannot add ${args.quantity}`,
      );
    }

    const now = Date.now();
    const existing = await findInventoryRow(ctx, args.locationId, args.upc);
    if (existing) {
      await ctx.db.patch(existing._id, {
        quantity: existing.quantity + args.quantity,
        lastMovedAt: now,
        lastMovedBy: args.userId,
      });
    } else {
      await ctx.db.insert("wms_inventory", {
        locationId: args.locationId,
        warehouseCode: loc.warehouseCode,
        upc: args.upc,
        quantity: args.quantity,
        description: args.description,
        brand: args.brand,
        size: args.size,
        receivedAt: now,
        receivedBy: args.userId,
        lastMovedAt: now,
        lastMovedBy: args.userId,
      });
    }

    await ctx.db.insert("wms_transactions", {
      type: "PUT_AWAY",
      warehouseCode: loc.warehouseCode,
      upc: args.upc,
      toLocationId: args.locationId,
      quantity: args.quantity,
      performedBy: args.userId,
      performedByName: args.userName,
      timestamp: now,
    });

    return { success: true };
  },
});

export const moveTire = mutation({
  args: {
    upc: v.string(),
    fromLocationId: v.id("wms_locations"),
    toLocationId: v.id("wms_locations"),
    quantity: v.number(),
    userId: v.string(),
    userName: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.quantity <= 0) throw new Error("Quantity must be positive");
    if (args.fromLocationId === args.toLocationId) {
      throw new Error("FROM and TO locations are the same");
    }
    const toLoc = await getOrThrowLocation(ctx, args.toLocationId);
    if (!toLoc.isActive) throw new Error("Destination is not active");

    const fromRow = await findInventoryRow(ctx, args.fromLocationId, args.upc);
    if (!fromRow || fromRow.quantity < args.quantity) {
      throw new Error("Insufficient quantity at source");
    }

    const toCurrent = await sumQuantityAtLocation(ctx, args.toLocationId);
    if (toCurrent + args.quantity > toLoc.maxCapacity) {
      throw new Error(
        `Capacity exceeded at ${toLoc.label}: ${toCurrent}/${toLoc.maxCapacity}`,
      );
    }

    const now = Date.now();
    // Decrement source.
    if (fromRow.quantity === args.quantity) {
      await ctx.db.delete(fromRow._id);
    } else {
      await ctx.db.patch(fromRow._id, {
        quantity: fromRow.quantity - args.quantity,
        lastMovedAt: now,
        lastMovedBy: args.userId,
      });
    }
    // Increment destination.
    const toRow = await findInventoryRow(ctx, args.toLocationId, args.upc);
    if (toRow) {
      await ctx.db.patch(toRow._id, {
        quantity: toRow.quantity + args.quantity,
        lastMovedAt: now,
        lastMovedBy: args.userId,
      });
    } else {
      await ctx.db.insert("wms_inventory", {
        locationId: args.toLocationId,
        warehouseCode: toLoc.warehouseCode,
        upc: args.upc,
        quantity: args.quantity,
        description: fromRow.description,
        brand: fromRow.brand,
        size: fromRow.size,
        receivedAt: fromRow.receivedAt,
        receivedBy: fromRow.receivedBy,
        lastMovedAt: now,
        lastMovedBy: args.userId,
      });
    }

    await ctx.db.insert("wms_transactions", {
      type: "MOVE",
      warehouseCode: toLoc.warehouseCode,
      upc: args.upc,
      fromLocationId: args.fromLocationId,
      toLocationId: args.toLocationId,
      quantity: args.quantity,
      performedBy: args.userId,
      performedByName: args.userName,
      timestamp: now,
    });

    return { success: true };
  },
});

export const pickTire = mutation({
  args: {
    upc: v.string(),
    locationId: v.id("wms_locations"),
    quantity: v.number(),
    userId: v.string(),
    userName: v.string(),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.quantity <= 0) throw new Error("Quantity must be positive");
    const loc = await getOrThrowLocation(ctx, args.locationId);
    const row = await findInventoryRow(ctx, args.locationId, args.upc);
    if (!row || row.quantity < args.quantity) {
      throw new Error("Insufficient quantity at location");
    }

    const now = Date.now();
    if (row.quantity === args.quantity) {
      await ctx.db.delete(row._id);
    } else {
      await ctx.db.patch(row._id, {
        quantity: row.quantity - args.quantity,
        lastMovedAt: now,
        lastMovedBy: args.userId,
      });
    }

    await ctx.db.insert("wms_transactions", {
      type: "PICK",
      warehouseCode: loc.warehouseCode,
      upc: args.upc,
      fromLocationId: args.locationId,
      quantity: args.quantity,
      performedBy: args.userId,
      performedByName: args.userName,
      timestamp: now,
      sessionId: args.sessionId,
    });

    return { success: true };
  },
});

export const adjustInventory = mutation({
  args: {
    upc: v.string(),
    locationId: v.id("wms_locations"),
    newQuantity: v.number(),
    reason: v.string(),
    userId: v.string(),
    userName: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.newQuantity < 0) throw new Error("Quantity cannot be negative");
    const loc = await getOrThrowLocation(ctx, args.locationId);

    // Capacity check across the whole location (sum of all UPCs at this
    // location must not exceed maxCapacity after the adjustment).
    const row = await findInventoryRow(ctx, args.locationId, args.upc);
    const oldQty = row?.quantity ?? 0;
    const currentTotal = await sumQuantityAtLocation(ctx, args.locationId);
    const projectedTotal = currentTotal - oldQty + args.newQuantity;
    if (projectedTotal > loc.maxCapacity) {
      throw new Error(
        `Capacity exceeded at ${loc.label}: would be ${projectedTotal}/${loc.maxCapacity}`,
      );
    }

    const now = Date.now();
    const delta = args.newQuantity - oldQty;
    if (row) {
      if (args.newQuantity === 0) {
        await ctx.db.delete(row._id);
      } else {
        await ctx.db.patch(row._id, {
          quantity: args.newQuantity,
          lastMovedAt: now,
          lastMovedBy: args.userId,
        });
      }
    } else if (args.newQuantity > 0) {
      // Adjusting up from zero requires we know enough to create the row.
      throw new Error(
        "Cannot adjust a UPC that doesn't exist at this location — use putAway",
      );
    }

    await ctx.db.insert("wms_transactions", {
      type: "ADJUST",
      warehouseCode: loc.warehouseCode,
      upc: args.upc,
      toLocationId: args.locationId,
      quantity: delta,
      performedBy: args.userId,
      performedByName: args.userName,
      timestamp: now,
      notes: args.reason,
    });

    return { success: true };
  },
});

export const createLocation = mutation({
  args: {
    warehouseCode: v.string(),
    zone: v.string(),
    position: v.string(),
    x: v.number(),
    y: v.number(),
    maxCapacity: v.number(),
    notes: v.optional(v.string()),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const label = `${args.zone}-${args.position}`;
    const existing = await ctx.db
      .query("wms_locations")
      .withIndex("by_warehouse_label", (q: any) =>
        q.eq("warehouseCode", args.warehouseCode).eq("label", label),
      )
      .first();
    if (existing) throw new Error(`Location ${label} already exists`);

    const id = await ctx.db.insert("wms_locations", {
      warehouseCode: args.warehouseCode,
      zone: args.zone,
      position: args.position,
      label,
      x: args.x,
      y: args.y,
      maxCapacity: args.maxCapacity,
      isActive: true,
      notes: args.notes,
      createdAt: Date.now(),
      createdBy: args.userId,
    });
    return { locationId: id, label };
  },
});

export const updateLocation = mutation({
  args: {
    locationId: v.id("wms_locations"),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
    maxCapacity: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { locationId, ...patch } = args;
    const filtered = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(filtered).length === 0) return { success: true };
    await ctx.db.patch(locationId, filtered);
    return { success: true };
  },
});

export const updateFloorConfig = mutation({
  args: {
    warehouseCode: v.string(),
    gridWidth: v.number(),
    gridHeight: v.number(),
    dockX: v.number(),
    dockY: v.number(),
    feetPerCell: v.optional(v.number()),
    aisles: v.array(
      v.object({
        x1: v.number(),
        y1: v.number(),
        x2: v.number(),
        y2: v.number(),
      }),
    ),
    outline: v.optional(v.array(v.object({ x: v.number(), y: v.number() }))),
    floorPlanImageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("wms_floor_config")
      .withIndex("by_warehouse", (q: any) =>
        q.eq("warehouseCode", args.warehouseCode),
      )
      .first();
    const payload = {
      warehouseCode: args.warehouseCode,
      gridWidth: args.gridWidth,
      gridHeight: args.gridHeight,
      dockX: args.dockX,
      dockY: args.dockY,
      feetPerCell: args.feetPerCell,
      aisles: args.aisles,
      outline: args.outline,
      floorPlanImageUrl: args.floorPlanImageUrl,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return { configId: existing._id };
    }
    const id = await ctx.db.insert("wms_floor_config", payload);
    return { configId: id };
  },
});

export const setFloorPlanImage = mutation({
  args: {
    warehouseCode: v.string(),
    storageId: v.optional(v.id("_storage")),
    opacity: v.optional(v.number()),
    rotation: v.optional(v.number()),
    scale: v.optional(v.number()),
    offsetXFt: v.optional(v.number()),
    offsetYFt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("wms_floor_config")
      .withIndex("by_warehouse", (q: any) => q.eq("warehouseCode", args.warehouseCode))
      .first();
    if (!existing) {
      throw new Error("Floor config doesn't exist yet — save the grid first");
    }
    if (existing.floorPlanStorageId && existing.floorPlanStorageId !== args.storageId) {
      try {
        await ctx.storage.delete(existing.floorPlanStorageId);
      } catch {
        // best-effort; ignore if already gone
      }
    }
    await ctx.db.patch(existing._id, {
      floorPlanStorageId: args.storageId,
      floorPlanOpacity: args.opacity,
      floorPlanRotation: args.rotation,
      floorPlanScale: args.scale,
      floorPlanOffsetXFt: args.offsetXFt,
      floorPlanOffsetYFt: args.offsetYFt,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

export const getFloorPlanImage = query({
  args: { warehouseCode: v.string() },
  handler: async (ctx, args) => {
    const cfg = await ctx.db
      .query("wms_floor_config")
      .withIndex("by_warehouse", (q: any) => q.eq("warehouseCode", args.warehouseCode))
      .first();
    if (!cfg?.floorPlanStorageId) return null;
    const url = await ctx.storage.getUrl(cfg.floorPlanStorageId);
    return {
      url,
      opacity: cfg.floorPlanOpacity ?? 0.4,
      rotation: cfg.floorPlanRotation ?? 0,
      scale: cfg.floorPlanScale ?? 1,
      offsetXFt: cfg.floorPlanOffsetXFt ?? 0,
      offsetYFt: cfg.floorPlanOffsetYFt ?? 0,
    };
  },
});

export const createLabelRecord = mutation({
  args: {
    upc: v.string(),
    description: v.string(),
    brand: v.optional(v.string()),
    size: v.optional(v.string()),
    warehouseCode: v.string(),
    userId: v.string(),
    userName: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("wms_transactions", {
      type: "LABEL_CREATE",
      warehouseCode: args.warehouseCode,
      upc: args.upc,
      quantity: 0,
      performedBy: args.userId,
      performedByName: args.userName,
      timestamp: Date.now(),
      notes: [args.brand, args.size, args.description].filter(Boolean).join(" · "),
    });
    return { success: true };
  },
});

export const assignUserToWarehouse = mutation({
  args: {
    userId: v.id("users"),
    warehouseCode: v.string(),
    assignedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("wms_user_assignments")
      .withIndex("by_user_warehouse", (q: any) =>
        q.eq("userId", args.userId).eq("warehouseCode", args.warehouseCode),
      )
      .first();
    if (existing) return { assignmentId: existing._id, alreadyExisted: true };
    const id = await ctx.db.insert("wms_user_assignments", {
      userId: args.userId,
      warehouseCode: args.warehouseCode,
      assignedAt: Date.now(),
      assignedBy: args.assignedBy,
    });
    return { assignmentId: id, alreadyExisted: false };
  },
});

export const unassignUserFromWarehouse = mutation({
  args: {
    userId: v.id("users"),
    warehouseCode: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("wms_user_assignments")
      .withIndex("by_user_warehouse", (q: any) =>
        q.eq("userId", args.userId).eq("warehouseCode", args.warehouseCode),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getLocationContents = query({
  args: { locationId: v.id("wms_locations") },
  handler: async (ctx, args) => {
    const loc = await ctx.db.get(args.locationId);
    if (!loc) return null;
    const inventory = await ctx.db
      .query("wms_inventory")
      .withIndex("by_location", (q: any) => q.eq("locationId", args.locationId))
      .collect();
    const total = inventory.reduce((acc, r) => acc + r.quantity, 0);
    return {
      location: loc,
      inventory,
      totalQuantity: total,
      percentFull: loc.maxCapacity > 0 ? total / loc.maxCapacity : 0,
    };
  },
});

export const findUPC = query({
  args: { upc: v.string(), warehouseCode: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("wms_inventory")
      .withIndex("by_warehouse_upc", (q: any) =>
        q.eq("warehouseCode", args.warehouseCode).eq("upc", args.upc),
      )
      .collect();
    const results = [];
    for (const r of rows) {
      const loc = await ctx.db.get(r.locationId);
      if (!loc) continue;
      results.push({
        locationId: r.locationId,
        label: loc.label,
        zone: loc.zone,
        position: loc.position,
        x: loc.x,
        y: loc.y,
        quantity: r.quantity,
        description: r.description,
        brand: r.brand,
        size: r.size,
      });
    }
    return results;
  },
});

export const getFloorOccupancy = query({
  args: { warehouseCode: v.string() },
  handler: async (ctx, args) => {
    const locations = await ctx.db
      .query("wms_locations")
      .withIndex("by_warehouse_active", (q: any) =>
        q.eq("warehouseCode", args.warehouseCode).eq("isActive", true),
      )
      .collect();
    const result = [];
    for (const loc of locations) {
      const inv = await ctx.db
        .query("wms_inventory")
        .withIndex("by_location", (q: any) => q.eq("locationId", loc._id))
        .collect();
      const total = inv.reduce((acc, r) => acc + r.quantity, 0);
      const skuCount = new Set(inv.map((r) => r.upc)).size;
      const lastMovedAt = inv.reduce(
        (max, r) => (r.lastMovedAt > max ? r.lastMovedAt : max),
        0,
      );
      result.push({
        locationId: loc._id,
        label: loc.label,
        zone: loc.zone,
        position: loc.position,
        x: loc.x,
        y: loc.y,
        maxCapacity: loc.maxCapacity,
        totalQuantity: total,
        percentFull: loc.maxCapacity > 0 ? total / loc.maxCapacity : 0,
        skuCount,
        lastMovedAt,
      });
    }
    return result;
  },
});

// All inventory rows in the warehouse, joined with location metadata. Used by
// the admin inventory browser. Returns one row per (location, upc) tuple.
export const getAllInventory = query({
  args: { warehouseCode: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("wms_inventory")
      .withIndex("by_warehouse_location", (q: any) =>
        q.eq("warehouseCode", args.warehouseCode),
      )
      .collect();
    const locCache = new Map<string, any>();
    const out = [];
    for (const r of rows) {
      let loc = locCache.get(r.locationId);
      if (!loc) {
        loc = await ctx.db.get(r.locationId);
        if (loc) locCache.set(r.locationId, loc);
      }
      if (!loc) continue;
      out.push({
        inventoryId: r._id,
        upc: r.upc,
        description: r.description,
        brand: r.brand,
        size: r.size,
        quantity: r.quantity,
        receivedAt: r.receivedAt,
        receivedBy: r.receivedBy,
        lastMovedAt: r.lastMovedAt,
        lastMovedBy: r.lastMovedBy,
        locationId: r.locationId,
        locationLabel: loc.label,
        zone: loc.zone,
      });
    }
    return out;
  },
});

export const getRecentTransactions = query({
  args: { warehouseCode: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    return await ctx.db
      .query("wms_transactions")
      .withIndex("by_warehouse_timestamp", (q: any) =>
        q.eq("warehouseCode", args.warehouseCode),
      )
      .order("desc")
      .take(limit);
  },
});

export const getFloorConfig = query({
  args: { warehouseCode: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("wms_floor_config")
      .withIndex("by_warehouse", (q: any) =>
        q.eq("warehouseCode", args.warehouseCode),
      )
      .first();
  },
});

export const getUserWarehouses = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("wms_user_assignments")
      .withIndex("by_user", (q: any) => q.eq("userId", args.userId))
      .collect();
    return rows.map((r) => r.warehouseCode);
  },
});

export const getSuggestedPutAway = query({
  args: {
    upc: v.string(),
    warehouseCode: v.string(),
    incomingQuantity: v.number(),
    brand: v.optional(v.string()),
    size: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const locations = await ctx.db
      .query("wms_locations")
      .withIndex("by_warehouse_active", (q: any) =>
        q.eq("warehouseCode", args.warehouseCode).eq("isActive", true),
      )
      .collect();
    const inventory = await ctx.db
      .query("wms_inventory")
      .withIndex("by_warehouse_location", (q: any) =>
        q.eq("warehouseCode", args.warehouseCode),
      )
      .collect();
    const cfg = await ctx.db
      .query("wms_floor_config")
      .withIndex("by_warehouse", (q: any) =>
        q.eq("warehouseCode", args.warehouseCode),
      )
      .first();
    const dockX = cfg?.dockX ?? 0;
    const dockY = cfg?.dockY ?? 0;

    const routingLocs: RoutingLocation[] = locations.map((l) => ({
      _id: l._id as unknown as string,
      x: l.x,
      y: l.y,
      zone: l.zone,
      label: l.label,
      maxCapacity: l.maxCapacity,
    }));
    const routingInv: RoutingInventory[] = inventory.map((i) => ({
      locationId: i.locationId as unknown as string,
      upc: i.upc,
      quantity: i.quantity,
      brand: i.brand,
      size: i.size,
    }));
    return scorePutAwayLocations(
      args.upc,
      args.incomingQuantity,
      args.brand,
      args.size,
      routingLocs,
      routingInv,
      dockX,
      dockY,
    );
  },
});

// UPC-based pick list. Resolves each UPC to one or more locations via greedy
// allocation (highest-quantity location first), then runs the TSP. Returns
// the resolved route plus any items that couldn't be fully allocated.
export const buildPickRoute = query({
  args: {
    warehouseCode: v.string(),
    items: v.array(
      v.object({
        upc: v.string(),
        quantity: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (args.items.length === 0) {
      return { route: [], estimatedDistance: 0, missing: [] };
    }
    const cfg = await ctx.db
      .query("wms_floor_config")
      .withIndex("by_warehouse", (q: any) =>
        q.eq("warehouseCode", args.warehouseCode),
      )
      .first();
    const dockX = cfg?.dockX ?? 0;
    const dockY = cfg?.dockY ?? 0;

    const stops: Array<{ locationId: string; upc: string; quantity: number }> = [];
    const missing: Array<{ upc: string; shortBy: number }> = [];
    const locationCache = new Map<string, any>();

    for (const item of args.items) {
      const rows = await ctx.db
        .query("wms_inventory")
        .withIndex("by_warehouse_upc", (q: any) =>
          q.eq("warehouseCode", args.warehouseCode).eq("upc", item.upc),
        )
        .collect();
      // Allocate greedily from highest-quantity rows first.
      const sorted = [...rows].sort((a, b) => b.quantity - a.quantity);
      let needed = item.quantity;
      for (const row of sorted) {
        if (needed <= 0) break;
        const take = Math.min(needed, row.quantity);
        stops.push({
          locationId: row.locationId as unknown as string,
          upc: item.upc,
          quantity: take,
        });
        if (!locationCache.has(row.locationId)) {
          const loc = await ctx.db.get(row.locationId);
          if (loc) locationCache.set(row.locationId, loc);
        }
        needed -= take;
      }
      if (needed > 0) missing.push({ upc: item.upc, shortBy: needed });
    }

    const routingLocs: RoutingLocation[] = Array.from(locationCache.values()).map((l: any) => ({
      _id: l._id as unknown as string,
      x: l.x,
      y: l.y,
      zone: l.zone,
      label: l.label,
      maxCapacity: l.maxCapacity,
    }));
    const result = optimizePickRoute(stops, routingLocs, dockX, dockY);
    const byId = new Map(routingLocs.map((l) => [l._id, l]));
    return {
      route: result.route.map((p) => ({
        ...p,
        label: byId.get(p.locationId)?.label ?? "?",
      })),
      estimatedDistance: result.estimatedDistance,
      missing,
    };
  },
});

export const getPickRoute = query({
  args: {
    warehouseCode: v.string(),
    pickList: v.array(
      v.object({
        locationId: v.id("wms_locations"),
        upc: v.string(),
        quantity: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (args.pickList.length === 0) {
      return { route: [], estimatedDistance: 0 };
    }
    const cfg = await ctx.db
      .query("wms_floor_config")
      .withIndex("by_warehouse", (q: any) =>
        q.eq("warehouseCode", args.warehouseCode),
      )
      .first();
    const dockX = cfg?.dockX ?? 0;
    const dockY = cfg?.dockY ?? 0;

    const uniqueIds = Array.from(new Set(args.pickList.map((p) => p.locationId)));
    const locations: RoutingLocation[] = [];
    for (const id of uniqueIds) {
      const loc = await ctx.db.get(id);
      if (loc) {
        locations.push({
          _id: loc._id as unknown as string,
          x: loc.x,
          y: loc.y,
          zone: loc.zone,
          label: loc.label,
          maxCapacity: loc.maxCapacity,
        });
      }
    }
    const result = optimizePickRoute(
      args.pickList.map((p) => ({
        locationId: p.locationId as unknown as string,
        upc: p.upc,
        quantity: p.quantity,
      })),
      locations,
      dockX,
      dockY,
    );
    // Re-attach human-readable labels for the UI.
    const byId = new Map(locations.map((l) => [l._id, l]));
    return {
      route: result.route.map((p) => ({
        ...p,
        label: byId.get(p.locationId)?.label ?? "?",
      })),
      estimatedDistance: result.estimatedDistance,
    };
  },
});
