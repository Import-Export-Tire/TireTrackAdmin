import { query } from "./_generated/server";
import { v } from "convex/values";

// Get return items for export (with optional filters)
export const getReturnItemsForExport = query({
  args: {
    status: v.optional(v.string()), // "processed", "pending", "not_processed", or undefined for all
    batchId: v.optional(v.id("returnBatches")), // Filter by specific batch
    startDate: v.optional(v.number()), // Filter by date range
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Get return items based on filters
    let items;
    if (args.batchId) {
      // Filter by batch
      items = await ctx.db
        .query("returnItems")
        .withIndex("by_batch", (q) => q.eq("returnBatchId", args.batchId!))
        .collect();
    } else if (args.status) {
      // Filter by status
      items = await ctx.db
        .query("returnItems")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    } else {
      // Limit to 10000 items max when no filter (return items are small documents)
      items = await ctx.db.query("returnItems").order("desc").take(10000);
    }

    // Apply date filter if provided
    if (args.startDate !== undefined && args.endDate !== undefined) {
      items = items.filter(
        (item) => item.scannedAt >= args.startDate! && item.scannedAt <= args.endDate!
      );
    }

    // Apply status filter even when filtering by batch or date
    if (args.status && (args.batchId || args.startDate !== undefined)) {
      items = items.filter((item) => item.status === args.status);
    }

    // Limit final results for export
    items = items.slice(0, 5000);

    // Get batches, users, locations for enrichment (with limits)
    const batches = await ctx.db.query("returnBatches").take(500);
    const users = await ctx.db.query("users").take(500);
    const locations = await ctx.db.query("locations").take(100);

    // Enrich items with batch and user info
    const enriched = items.map((item) => {
      const batch = batches.find((b) => b._id === item.returnBatchId);
      const scanner = users.find((u) => u._id === item.scannedBy);
      const location = batch ? locations.find((l) => l.base44Id === batch.locationId) : null;

      return {
        _id: item._id,
        batchId: item.returnBatchId,
        batchNumber: batch?.batchNumber || String(batch?._id).slice(-6) || "N/A",
        locationName: location?.name || batch?.locationId || "Unknown",
        poNumber: item.poNumber || "",
        invNumber: item.invNumber || "",
        fromAddress: item.fromAddress || "",
        upcCode: item.upcCode || "",
        tireBrand: item.tireBrand || "",
        tireModel: item.tireModel || "",
        tireSize: item.tireSize || "",
        tirePartNumber: item.tirePartNumber || "",
        quantity: item.quantity || 1,
        status: item.status,
        notes: item.notes || "",
        scannedByName: scanner?.name || "Unknown",
        scannedAt: item.scannedAt,
        aiConfidence: item.aiConfidence || "",
      };
    });

    // Sort by scannedAt descending (most recent first)
    enriched.sort((a, b) => b.scannedAt - a.scannedAt);

    return {
      items: enriched,
      totalCount: enriched.length,
      statusCounts: {
        processed: items.filter((i) => i.status === "processed").length,
        pending: items.filter((i) => i.status === "pending").length,
        not_processed: items.filter((i) => i.status === "not_processed").length,
      },
    };
  },
});

// Search return items across all batches
export const searchReturnItems = query({
  args: {
    search: v.string(),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.search.length < 2) return { items: [], totalMatches: 0 };

    const limit = args.limit || 50;
    const searchLower = args.search.toLowerCase();

    // Get return items (limit to 20000 - return items are small documents)
    let items = await ctx.db.query("returnItems").order("desc").take(20000);

    // Apply status filter if provided
    if (args.status && args.status !== "all") {
      items = items.filter((item) => item.status === args.status);
    }

    // Search across multiple fields
    const matchingItems = items.filter((item) => {
      const brand = (item.tireBrand || "").toLowerCase();
      const model = (item.tireModel || "").toLowerCase();
      const size = (item.tireSize || "").toLowerCase();
      const partNumber = (item.tirePartNumber || "").toLowerCase();
      const upc = (item.upcCode || "").toLowerCase();
      const poNumber = (item.poNumber || "").toLowerCase();
      const invNumber = (item.invNumber || "").toLowerCase();
      const fromAddress = (item.fromAddress || "").toLowerCase();

      return (
        brand.includes(searchLower) ||
        model.includes(searchLower) ||
        size.includes(searchLower) ||
        partNumber.includes(searchLower) ||
        upc.includes(searchLower) ||
        poNumber.includes(searchLower) ||
        invNumber.includes(searchLower) ||
        fromAddress.includes(searchLower)
      );
    });

    // Get batches, users, locations for enrichment (with limits)
    const batches = await ctx.db.query("returnBatches").take(500);
    const users = await ctx.db.query("users").take(500);
    const locations = await ctx.db.query("locations").take(100);

    // Enrich and limit results
    const enriched = matchingItems.slice(0, limit).map((item) => {
      const batch = batches.find((b) => b._id === item.returnBatchId);
      const scanner = users.find((u) => u._id === item.scannedBy);
      const location = batch ? locations.find((l) => l.base44Id === batch.locationId) : null;

      return {
        ...item,
        batchNumber: batch?.batchNumber || String(batch?._id).slice(-6) || "N/A",
        batchStatus: batch?.status || "unknown",
        locationName: location?.name || batch?.locationId || "Unknown",
        scannedByName: scanner?.name || "Unknown",
      };
    });

    // Sort by scannedAt descending
    enriched.sort((a, b) => b.scannedAt - a.scannedAt);

    return {
      items: enriched,
      totalMatches: matchingItems.length,
    };
  },
});

// Get return batches list for export filter dropdown
export const getReturnBatchesForExport = query({
  args: {},
  handler: async (ctx) => {
    const batches = await ctx.db.query("returnBatches").order("desc").take(100);
    const locations = await ctx.db.query("locations").take(100);

    return batches.map((batch) => {
      const location = locations.find((l) => l.base44Id === batch.locationId);
      return {
        _id: batch._id,
        batchNumber: batch.batchNumber || String(batch._id).slice(-6),
        locationName: location?.name || batch.locationId || "Unknown",
        status: batch.status,
        openedAt: batch.openedAt,
        itemCount: batch.itemCount,
      };
    });
  },
});
