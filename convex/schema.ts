import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Warehouse app users (mobile app login)
  users: defineTable({
    base44Id: v.string(),
    empId: v.string(),
    name: v.string(),
    pin: v.string(),
    locationId: v.string(),
    locationName: v.string(),
    role: v.optional(v.string()),
    isActive: v.boolean(),
  }).index("by_empId", ["empId"])
    .index("by_base44Id", ["base44Id"]),

  // Admin users for dashboard (separate from warehouse app users)
  adminUsers: defineTable({
    email: v.string(),
    passwordHash: v.string(),
    name: v.string(),
    role: v.union(v.literal("superadmin"), v.literal("admin"), v.literal("viewer")),
    allowedLocations: v.array(v.string()),
    isActive: v.boolean(),
    createdAt: v.number(),
    lastLoginAt: v.optional(v.number()),
    forcePasswordChange: v.optional(v.boolean()),
    tempPasswordSetAt: v.optional(v.number()),
  }).index("by_email", ["email"]),

  locations: defineTable({
    base44Id: v.string(),
    name: v.string(),
    code: v.string(),
    isActive: v.boolean(),
  }).index("by_code", ["code"]),

  trucks: defineTable({
    base44Id: v.optional(v.string()),
    truckNumber: v.string(),
    carrier: v.string(),
    status: v.string(),
    locationId: v.string(),
    openedBy: v.id("users"),
    openedAt: v.number(),
    closedAt: v.optional(v.number()),
    closedBy: v.optional(v.id("users")),
    securityTag: v.optional(v.string()),
    syncedToBase44: v.optional(v.boolean()),
    scanCount: v.optional(v.number()),
    archived: v.optional(v.boolean()),
    archivedAt: v.optional(v.number()),
    vendors: v.optional(v.array(v.string())),
    // Bonus tracking fields (set by supervisors)
    truckLength: v.optional(v.string()), // "28ft" | "40ft" | "48ft" | "53ft"
    helpers: v.optional(v.array(v.string())), // Freeform helper names
  }).index("by_location_status", ["locationId", "status"])
    .index("by_base44Id", ["base44Id"])
    .index("by_archived", ["archived"]),

  scans: defineTable({
    truckId: v.id("trucks"),
    trackingNumber: v.string(),
    carrier: v.optional(v.string()),
    destination: v.string(),
    recipientName: v.optional(v.string()),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    rawBarcode: v.string(),
    scannedBy: v.id("users"),
    scannedAt: v.number(),
    scanType: v.optional(v.string()),
    vendor: v.optional(v.string()),
    vendorAccount: v.optional(v.string()),
    isMiscan: v.optional(v.boolean()),
    noVendorKnown: v.optional(v.boolean()),
    potentialAccountNumber: v.optional(v.string()),
    // Duplicate tracking
    isDuplicate: v.optional(v.boolean()),
    duplicateOfScanId: v.optional(v.id("scans")),
    duplicateAddedAt: v.optional(v.number()),
    carrierMismatch: v.optional(v.boolean()), // Package carrier doesn't match truck carrier
    quantity: v.optional(v.number()), // 1 = single, 2 = bundled double
    // Cross-truck move tracking
    movedFromTruckId: v.optional(v.id("trucks")),
    movedFromScanId: v.optional(v.id("scans")),
  }).index("by_truck", ["truckId"])
    .index("by_vendor", ["vendor"])
    .index("by_tracking", ["trackingNumber"])
    .index("by_scannedAt", ["scannedAt"])
    .index("by_noVendorKnown", ["noVendorKnown"]),

  // Receiving trucks for bonus tracking (separate from shipping trucks)
  receivingTrucks: defineTable({
    truckNumber: v.string(),
    helpers: v.array(v.string()),
    status: v.string(), // "open" | "closed"
    locationId: v.string(),
    openedBy: v.optional(v.id("users")), // warehouse user (optional for admin-opened trucks)
    openedByAdmin: v.optional(v.string()), // admin name who opened (when opened from dashboard)
    openedAt: v.number(),
    closedAt: v.optional(v.number()),
    closedBy: v.optional(v.id("users")),
    closedByAdmin: v.optional(v.string()), // admin name who closed (when closed from dashboard)
    bonusEarned: v.optional(v.boolean()),
    notes: v.optional(v.string()),
    archived: v.optional(v.boolean()),
    archivedAt: v.optional(v.number()),
    type: v.optional(v.string()), // "receiving" | "outbound" (undefined = "receiving" for backward compat)
    truckLength: v.optional(v.string()), // "40ft" | "53ft" | "Pup"
    bonusAmount: v.optional(v.number()), // dollar amount locked in at close time
  }).index("by_location_status", ["locationId", "status"])
    .index("by_openedAt", ["openedAt"]),

  // Known helper names for autocomplete and standardization
  knownHelpers: defineTable({
    name: v.string(), // Title Case normalized
    locationId: v.string(),
    isActive: v.boolean(),
  }).index("by_location", ["locationId"]),

  vendorAccounts: defineTable({
    accountNumber: v.string(),
    vendorName: v.string(),
    carrier: v.string(),
  }).index("by_account", ["accountNumber"]),

  returnBatches: defineTable({
    base44Id: v.optional(v.string()),
    batchNumber: v.optional(v.string()),
    status: v.string(),
    locationId: v.string(),
    openedBy: v.id("users"),
    openedAt: v.number(),
    closedAt: v.optional(v.number()),
    closedBy: v.optional(v.id("users")),
    itemCount: v.number(),
    archived: v.optional(v.boolean()),
    archivedAt: v.optional(v.number()),
  }).index("by_location_status", ["locationId", "status"])
    .index("by_base44Id", ["base44Id"]),

  returnItems: defineTable({
    returnBatchId: v.id("returnBatches"),
    base44Id: v.optional(v.string()),
    poNumber: v.optional(v.string()),
    invNumber: v.optional(v.string()),
    partNumber: v.optional(v.string()),
    fromAddress: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    rawText: v.optional(v.string()),
    aiConfidence: v.optional(v.string()),
    upcCode: v.optional(v.string()),
    tireBrand: v.optional(v.string()),
    tireModel: v.optional(v.string()),
    tireSize: v.optional(v.string()),
    tirePartNumber: v.optional(v.string()), // Inventory/part number from tireUPCs
    trackingNumber: v.optional(v.string()), // Shipping label tracking number
    noTrackingNumber: v.optional(v.boolean()), // Explicitly no tracking number
    quantity: v.optional(v.number()),
    isMisship: v.optional(v.boolean()),
    isDamaged: v.optional(v.boolean()),
    damageNotes: v.optional(v.string()),
    damageImageStorageId: v.optional(v.id("_storage")),
    damageMarkedBy: v.optional(v.id("users")),
    damageMarkedAt: v.optional(v.number()),
    // Used condition — independent of isDamaged. An item can be both.
    isUsed: v.optional(v.boolean()),
    usedNotes: v.optional(v.string()),
    usedMarkedBy: v.optional(v.id("users")),
    usedMarkedAt: v.optional(v.number()),
    // Multiple condition photos, shared by the used and damaged flags.
    // Supersedes damageImageStorageId above, which is retained read-only so
    // existing records keep rendering without a backfill. Cap 6.
    conditionImageStorageIds: v.optional(v.array(v.id("_storage"))),
    scannedBy: v.id("users"),
    scannedAt: v.number(),
    status: v.string(),
    notes: v.optional(v.string()),
  }).index("by_batch", ["returnBatchId"])
    .index("by_status", ["status"]),

  tireUPCs: defineTable({
    upc: v.string(),
    brand: v.string(),
    model: v.string(),
    size: v.string(),
    inventoryNumber: v.optional(v.string()),
    auctionTitle: v.optional(v.string()),
  }).index("by_upc", ["upc"])
    .index("by_inventoryNumber", ["inventoryNumber"]),

  // Error logs for debugging issues
  errorLogs: defineTable({
    source: v.string(), // e.g., "addReturnItem", "searchTireByBrandSize"
    errorType: v.string(), // e.g., "validation", "database", "unknown"
    message: v.string(),
    details: v.optional(v.string()), // JSON stringified additional data
    userId: v.optional(v.id("users")),
    locationId: v.optional(v.string()),
    timestamp: v.number(),
    resolved: v.optional(v.boolean()),
  }).index("by_timestamp", ["timestamp"])
    .index("by_source", ["source"])
    .index("by_resolved", ["resolved"]),

  // Audit log for tracking admin actions (shared with TireTrackAdmin)
  auditLogs: defineTable({
    action: v.string(),
    actionType: v.string(),
    resourceType: v.string(),
    resourceId: v.optional(v.string()),
    adminId: v.optional(v.id("adminUsers")),
    adminEmail: v.optional(v.string()),
    adminName: v.optional(v.string()),
    details: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    timestamp: v.number(),
  }).index("by_timestamp", ["timestamp"])
    .index("by_admin", ["adminId"])
    .index("by_action", ["action"])
    .index("by_resource", ["resourceType", "resourceId"]),

  // ==========================================================================
  // WMS — Warehouse Management System (Phase 1: W09 Chestnut Ridge pilot)
  // Gated to warehouseCode === "W09" via wms_user_assignments. Additive only.
  // ==========================================================================

  wms_locations: defineTable({
    warehouseCode: v.string(),          // e.g. "W09"
    zone: v.string(),                   // "A", "B", "FRONT"
    position: v.string(),               // "01", "02"
    label: v.string(),                  // computed "A-01", unique per warehouse
    x: v.number(),                      // grid X
    y: v.number(),                      // grid Y
    maxCapacity: v.number(),            // tires; drives heat map percentFull
    isActive: v.boolean(),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    createdBy: v.string(),
  }).index("by_warehouse_label", ["warehouseCode", "label"])
    .index("by_warehouse_zone", ["warehouseCode", "zone"])
    .index("by_warehouse_active", ["warehouseCode", "isActive"]),

  wms_inventory: defineTable({
    locationId: v.id("wms_locations"),
    warehouseCode: v.string(),
    upc: v.string(),
    quantity: v.number(),
    description: v.string(),
    brand: v.optional(v.string()),
    size: v.optional(v.string()),
    receivedAt: v.number(),
    receivedBy: v.string(),
    lastMovedAt: v.number(),
    lastMovedBy: v.string(),
  }).index("by_location", ["locationId"])
    .index("by_warehouse_upc", ["warehouseCode", "upc"])
    .index("by_warehouse_location", ["warehouseCode", "locationId"]),

  wms_transactions: defineTable({
    type: v.union(
      v.literal("RECEIVE"),
      v.literal("PUT_AWAY"),
      v.literal("MOVE"),
      v.literal("PICK"),
      v.literal("ADJUST"),
      v.literal("COUNT"),
      v.literal("LABEL_CREATE"),
    ),
    warehouseCode: v.string(),
    upc: v.string(),
    fromLocationId: v.optional(v.id("wms_locations")),
    toLocationId: v.optional(v.id("wms_locations")),
    quantity: v.number(),
    performedBy: v.string(),            // stringified Id<"users"> or Id<"adminUsers">
    performedByName: v.string(),
    timestamp: v.number(),
    notes: v.optional(v.string()),
    sessionId: v.optional(v.string()),  // groups a pick run
  }).index("by_timestamp", ["timestamp"])
    .index("by_warehouse_timestamp", ["warehouseCode", "timestamp"])
    .index("by_upc", ["upc"])
    .index("by_session", ["sessionId"]),

  wms_floor_config: defineTable({
    warehouseCode: v.string(),
    gridWidth: v.number(),
    gridHeight: v.number(),
    dockX: v.number(),
    dockY: v.number(),
    feetPerCell: v.optional(v.number()),   // real-world scale; default 5 ft per cell in UI
    aisles: v.array(v.object({
      x1: v.number(),
      y1: v.number(),
      x2: v.number(),
      y2: v.number(),
    })),
    floorPlanImageUrl: v.optional(v.string()),         // legacy, unused
    floorPlanStorageId: v.optional(v.id("_storage")),  // uploaded floor plan backdrop
    floorPlanOpacity: v.optional(v.number()),           // 0..1
    floorPlanRotation: v.optional(v.number()),          // 0..360
    floorPlanScale: v.optional(v.number()),             // 1.0 = fit warehouse box
    floorPlanOffsetXFt: v.optional(v.number()),         // pan offset, feet
    floorPlanOffsetYFt: v.optional(v.number()),
    outline: v.optional(v.array(v.object({              // polygonal wall outline (grid coords)
      x: v.number(),
      y: v.number(),
    }))),
    updatedAt: v.number(),
  }).index("by_warehouse", ["warehouseCode"]),

  wms_user_assignments: defineTable({
    userId: v.id("users"),              // scanner user (warehouse worker)
    warehouseCode: v.string(),
    assignedAt: v.number(),
    assignedBy: v.string(),
  }).index("by_user", ["userId"])
    .index("by_warehouse", ["warehouseCode"])
    .index("by_user_warehouse", ["userId", "warehouseCode"]),

  // ==========================================================================
  // Inventory Count — physical tire count vs a frozen IECentral baseline.
  // Reports only; nothing is written back to IECentral or JMK.
  // W09 is the only location enabled at launch, but every table is keyed on a
  // location code — see convex/wms_count_locations.ts.
  // ==========================================================================

  wms_count_batches: defineTable({
    warehouseCode: v.string(),
    status: v.union(v.literal("open"), v.literal("closed")),
    // Stringified id from EITHER users or adminUsers — batches are opened from
    // the scanner and from Admin. Mirrors wms_transactions.performedBy.
    openedBy: v.string(),
    openedByName: v.string(),
    openedAt: v.number(),
    closedBy: v.optional(v.string()),
    closedByName: v.optional(v.string()),
    closedAt: v.optional(v.number()),
    baselineStatus: v.union(
      v.literal("pending"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    baselineError: v.optional(v.string()),
    baselineFileDate: v.optional(v.string()),      // OEIVAL fileDate — self-describing report
    baselineGeneratedAt: v.optional(v.string()),
    baselineItemCount: v.optional(v.number()),
    baselineUnitCount: v.optional(v.number()),
    baselineExcludedNonTires: v.optional(v.number()),
    baselineExcludedUnits: v.optional(v.number()),
    notes: v.optional(v.string()),
  }).index("by_warehouse_status", ["warehouseCode", "status"])
    .index("by_warehouse_openedAt", ["warehouseCode", "openedAt"]),

  // Immutable once baselineStatus flips to "ready" — this is what makes a
  // report run months later reproduce exactly what it said on the day.
  wms_count_baseline: defineTable({
    batchId: v.id("wms_count_batches"),
    itemId: v.string(),
    qtyOnHand: v.number(),
    brand: v.optional(v.string()),
    model: v.optional(v.string()),
    size: v.optional(v.string()),
    mpn: v.optional(v.string()),
  }).index("by_batch", ["batchId"])
    .index("by_batch_item", ["batchId", "itemId"]),

  // One row per scan event — the audit trail. Undo is a soft void, never a
  // delete: a miscount that vanishes is a miscount nobody can explain later.
  wms_count_scans: defineTable({
    batchId: v.id("wms_count_batches"),
    warehouseCode: v.string(),
    rawBarcode: v.string(),
    upc: v.optional(v.string()),
    itemId: v.optional(v.string()),        // absent = unmatched
    quantity: v.number(),
    matchSource: v.union(
      v.literal("upc"),
      v.literal("manual-search"),
      v.literal("resolved"),
      v.literal("unmatched"),
    ),
    brand: v.optional(v.string()),
    model: v.optional(v.string()),
    size: v.optional(v.string()),
    scannedBy: v.string(),
    scannedByName: v.string(),
    scannedAt: v.number(),
    voided: v.optional(v.boolean()),
    voidedBy: v.optional(v.string()),
    voidedAt: v.optional(v.number()),
  }).index("by_batch_scannedAt", ["batchId", "scannedAt"])
    .index("by_batch_item", ["batchId", "itemId"])
    .index("by_batch_upc", ["batchId", "upc"]),

  // Who may count, and WHERE. Deliberately separate from wms_user_assignments:
  // that table gates the Chestnut Ridge WMS pilot, and counting at a retail
  // store has nothing to do with warehouse management. The `inventory` role says
  // a person counts; this says which locations.
  wms_count_assignments: defineTable({
    userId: v.id("users"),
    locationCode: v.string(),
    assignedAt: v.number(),
    assignedBy: v.string(),
  }).index("by_user", ["userId"])
    .index("by_location", ["locationCode"])
    .index("by_user_location", ["userId", "locationCode"]),

  // Rollup maintained in the same transaction as each scan, so reports never
  // collect() thousands of raw scan rows. Exactly one of itemId / upc is set:
  // matched totals key on itemId, unmatched on upc. Deliberately not an
  // empty-string sentinel, which is one grouping typo away from merging every
  // unmatched UPC into a single phantom item.
  wms_count_totals: defineTable({
    batchId: v.id("wms_count_batches"),
    itemId: v.optional(v.string()),
    upc: v.optional(v.string()),
    countedQty: v.number(),
    scanCount: v.number(),
    lastScannedAt: v.number(),
  }).index("by_batch", ["batchId"])
    .index("by_batch_item", ["batchId", "itemId"])
    .index("by_batch_upc", ["batchId", "upc"]),
});
