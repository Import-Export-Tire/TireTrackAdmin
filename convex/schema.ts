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
    vendors: v.optional(v.array(v.string())), // Cached list of unique vendors
    archived: v.optional(v.boolean()),
    archivedAt: v.optional(v.number()),
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
    potentialAccountNumber: v.optional(v.string()), // Extracted account number for pattern matching
    // Duplicate tracking - when user adds a scan they know is a duplicate
    isDuplicate: v.optional(v.boolean()),
    duplicateOfScanId: v.optional(v.id("scans")), // Original scan this is a duplicate of
    duplicateAddedAt: v.optional(v.number()), // When they clicked "add anyway"
  }).index("by_truck", ["truckId"])
    .index("by_vendor", ["vendor"])
    .index("by_tracking", ["trackingNumber"])
    .index("by_scannedAt", ["scannedAt"])
    .index("by_noVendorKnown", ["noVendorKnown"]),

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
    .index("by_base44Id", ["base44Id"])
    .index("by_archived", ["archived"]),

  returnItems: defineTable({
    returnBatchId: v.id("returnBatches"),
    base44Id: v.optional(v.string()),
    poNumber: v.optional(v.string()),
    invNumber: v.optional(v.string()),
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
  }).index("by_upc", ["upc"]),

  // Audit log for tracking admin actions
  auditLogs: defineTable({
    action: v.string(), // e.g., "truck.delete", "user.create", "admin.login"
    actionType: v.string(), // "create", "update", "delete", "login", "export"
    resourceType: v.string(), // "truck", "user", "admin", "scan", "batch"
    resourceId: v.optional(v.string()),
    adminId: v.optional(v.id("adminUsers")),
    adminEmail: v.optional(v.string()),
    adminName: v.optional(v.string()),
    details: v.optional(v.string()), // JSON string with additional details
    ipAddress: v.optional(v.string()),
    timestamp: v.number(),
  }).index("by_timestamp", ["timestamp"])
    .index("by_admin", ["adminId"])
    .index("by_action", ["action"])
    .index("by_resource", ["resourceType", "resourceId"]),
});
