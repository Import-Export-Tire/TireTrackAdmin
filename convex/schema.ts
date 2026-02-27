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
    openedBy: v.id("users"),
    openedAt: v.number(),
    closedAt: v.optional(v.number()),
    closedBy: v.optional(v.id("users")),
    bonusEarned: v.optional(v.boolean()),
    notes: v.optional(v.string()),
    archived: v.optional(v.boolean()),
    archivedAt: v.optional(v.number()),
    type: v.optional(v.string()), // "receiving" | "outbound" (undefined = "receiving" for backward compat)
    truckLength: v.optional(v.string()), // "40ft" | "53ft"
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
    quantity: v.optional(v.number()),
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
});
