import { query } from "./_generated/server";
import { v } from "convex/values";

// Get user by Employee ID (for login)
export const getUserByEmpId = query({
  args: { empId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_empId", (q) => q.eq("empId", args.empId.toUpperCase()))
      .first();
  },
});

// Validate user PIN
export const validateUserPin = query({
  args: { empId: v.string(), pin: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_empId", (q) => q.eq("empId", args.empId.toUpperCase()))
      .first();

    if (!user) {
      return { valid: false, error: "User not found", user: null };
    }

    if (!user.isActive) {
      return { valid: false, error: "Account disabled", user: null };
    }

    if (user.pin !== args.pin) {
      return { valid: false, error: "Invalid PIN", user: null };
    }

    return { valid: true, error: null, user };
  },
});

// Get open trucks for a location
export const getOpenTrucks = query({
  args: { locationId: v.string() },
  handler: async (ctx, args) => {
    const trucks = await ctx.db
      .query("trucks")
      .withIndex("by_location_status", (q) =>
        q.eq("locationId", args.locationId).eq("status", "open")
      )
      .collect();

    // Enrich with scan counts
    const enrichedTrucks = await Promise.all(
      trucks.map(async (truck) => {
        const scans = await ctx.db
          .query("scans")
          .withIndex("by_truck", (q) => q.eq("truckId", truck._id))
          .collect();
        return {
          ...truck,
          scanCount: scans.length,
        };
      })
    );

    return enrichedTrucks;
  },
});

// Get all scans for a truck (excludes duplicates by default)
export const getTruckScans = query({
  args: { truckId: v.id("trucks"), includeDuplicates: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    let scans = await ctx.db
      .query("scans")
      .withIndex("by_truck", (q) => q.eq("truckId", args.truckId))
      .collect();

    // Filter out duplicates unless explicitly requested
    if (!args.includeDuplicates) {
      scans = scans.filter((scan) => !scan.isDuplicate);
    }

    // Enrich with user names
    const enrichedScans = await Promise.all(
      scans.map(async (scan) => {
        const user = await ctx.db.get(scan.scannedBy);
        return {
          ...scan,
          scannedByName: user?.name ?? "Unknown",
        };
      })
    );

    return enrichedScans;
  },
});

// Get truck by ID with scan count (excludes duplicates from count)
export const getTruck = query({
  args: { truckId: v.id("trucks") },
  handler: async (ctx, args) => {
    const truck = await ctx.db.get(args.truckId);
    if (!truck) return null;

    const allScans = await ctx.db
      .query("scans")
      .withIndex("by_truck", (q) => q.eq("truckId", args.truckId))
      .collect();

    // Only count non-duplicate scans
    const scans = allScans.filter((scan) => !scan.isDuplicate);

    const openedByUser = await ctx.db.get(truck.openedBy);
    const closedByUser = truck.closedBy ? await ctx.db.get(truck.closedBy) : null;

    return {
      ...truck,
      scanCount: scans.length,
      openedByName: openedByUser?.name ?? "Unknown",
      closedByName: closedByUser?.name ?? null,
    };
  },
});

// Get all locations
export const getLocations = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("locations")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

// Get recent scans for a truck (with limit)
export const getRecentTruckScans = query({
  args: { truckId: v.id("trucks"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const scans = await ctx.db
      .query("scans")
      .withIndex("by_truck", (q) => q.eq("truckId", args.truckId))
      .order("desc")
      .take(args.limit ?? 10);

    const enrichedScans = await Promise.all(
      scans.map(async (scan) => {
        const user = await ctx.db.get(scan.scannedBy);
        return {
          ...scan,
          scannedByName: user?.name ?? "Unknown",
        };
      })
    );

    return enrichedScans;
  },
});

// Get open return batches for a location
export const getOpenReturnBatches = query({
  args: { locationId: v.string() },
  handler: async (ctx, args) => {
    const batches = await ctx.db
      .query("returnBatches")
      .withIndex("by_location_status", (q) =>
        q.eq("locationId", args.locationId).eq("status", "open")
      )
      .collect();

    const enrichedBatches = await Promise.all(
      batches.map(async (batch) => {
        const items = await ctx.db
          .query("returnItems")
          .withIndex("by_batch", (q) => q.eq("returnBatchId", batch._id))
          .collect();
        const openedByUser = await ctx.db.get(batch.openedBy);
        return {
          ...batch,
          itemCount: items.length,
          openedByName: openedByUser?.name ?? "Unknown",
        };
      })
    );

    return enrichedBatches;
  },
});

// Get return batch by ID with item count
export const getReturnBatch = query({
  args: { batchId: v.id("returnBatches") },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) return null;

    const items = await ctx.db
      .query("returnItems")
      .withIndex("by_batch", (q) => q.eq("returnBatchId", args.batchId))
      .collect();

    const openedByUser = await ctx.db.get(batch.openedBy);

    return {
      ...batch,
      itemCount: items.length,
      openedByName: openedByUser?.name ?? "Unknown",
    };
  },
});

// Get return items for a batch
export const getReturnItems = query({
  args: { batchId: v.id("returnBatches") },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("returnItems")
      .withIndex("by_batch", (q) => q.eq("returnBatchId", args.batchId))
      .order("desc")
      .collect();

    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        const user = await ctx.db.get(item.scannedBy);
        return {
          ...item,
          scannedByName: user?.name ?? "Unknown",
        };
      })
    );

    return enrichedItems;
  },
});

export const getTireByUPC = query({
  args: { upc: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tireUPCs")
      .withIndex("by_upc", (q) => q.eq("upc", args.upc))
      .first();
  },
});

export const countUnknownVendors = query({
  args: {},
  handler: async (ctx) => {
    const scans = await ctx.db.query("scans").collect();
    const unknown = scans.filter(s => !s.vendor || s.vendor === "Unknown");
    const known = scans.filter(s => s.vendor && s.vendor !== "Unknown");
    
    // Group unknowns by rawBarcode pattern
    const patterns: Record<string, number> = {};
    for (const scan of unknown) {
      const raw = scan.rawBarcode || "";
      const isUPS = raw.includes("UPSN") || raw.startsWith("1Z");
      const isFedEx = raw.includes("FDEG") || raw.includes("[)>");
      const key = isUPS ? "UPS" : isFedEx ? "FedEx (unmapped)" : "Other";
      patterns[key] = (patterns[key] || 0) + 1;
    }
    
    return {
      total: scans.length,
      known: known.length,
      unknown: unknown.length,
      patterns
    };
  },
});

export const getScanByTracking = query({
  args: { trackingNumber: v.string() },
  handler: async (ctx, args) => {
    const scans = await ctx.db.query("scans").collect();
    return scans.find(s => s.trackingNumber === args.trackingNumber) || null;
  },
});

export const getUnmappedFedExScans = query({
  args: {},
  handler: async (ctx) => {
    const scans = await ctx.db.query("scans").collect();
    const unmapped = scans.filter(s => {
      const raw = s.rawBarcode || "";
      const isFedEx = raw.includes("FDEG") || raw.includes("[)>");
      const noVendor = !s.vendor || s.vendor === "Unknown";
      return isFedEx && noVendor;
    });
    
    return unmapped.map(s => ({
      _id: s._id,
      trackingNumber: s.trackingNumber,
      truckId: s.truckId,
      rawBarcode: s.rawBarcode,
    }));
  },
});
export const findUnknownAccounts = query({
  args: {},
  handler: async (ctx) => {
    const scans = await ctx.db.query("scans").collect();
    const unknown = scans.filter(s => !s.vendor || s.vendor === "Unknown");
    const accounts: Record<string, { count: number, sample: string }> = {};
    for (const scan of unknown) {
      const raw = scan.rawBarcode || "";
      const fdegMatch = raw.match(/FDEG\x1d(\d{7,9})/);
      if (fdegMatch) {
        const acct = fdegMatch[1];
        if (!accounts[acct]) {
          accounts[acct] = { count: 0, sample: scan.trackingNumber };
        }
        accounts[acct].count++;
      }
    }
    return Object.entries(accounts)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([account, data]) => ({ account, count: data.count, sampleTracking: data.sample }));
  },
});

export const getAllTrucks = query({
  args: {},
  handler: async (ctx) => {
    // Get non-archived trucks, limit to 200 most recent
    const allTrucks = await ctx.db
      .query("trucks")
      .order("desc")
      .take(300); // Take extra to account for archived ones

    const trucks = allTrucks
      .filter(t => !t.archived)
      .slice(0, 200);

    const enrichedTrucks = await Promise.all(
      trucks.map(async (truck) => {
        const openedByUser = await ctx.db.get(truck.openedBy);
        const closedByUser = truck.closedBy ? await ctx.db.get(truck.closedBy) : null;

        return {
          ...truck,
          // Use stored scanCount and vendors instead of loading all scans
          scanCount: truck.scanCount ?? 0,
          openedByName: openedByUser?.name ?? "Unknown",
          closedByName: closedByUser?.name ?? null,
          vendors: truck.vendors ?? [],
          trackingNumbers: [], // Empty for backward compatibility
        };
      })
    );

    return enrichedTrucks;
  },
});

export const getAllUsers = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("users").collect();
  },
});

export const searchUPCs = query({
  args: { 
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;
    
    if (!args.search || args.search.length < 2) {
      return await ctx.db.query("tireUPCs").take(limit);
    }
    
    const search = args.search.toLowerCase();
    const all = await ctx.db.query("tireUPCs").collect();
    
    return all
      .filter((t) => 
        t.upc.toLowerCase().includes(search) ||
        t.brand.toLowerCase().includes(search) ||
        t.size.toLowerCase().includes(search) ||
        (t.inventoryNumber && t.inventoryNumber.toLowerCase().includes(search))
      )
      .slice(0, limit);
  },
});

export const getUPCCount = query({
  args: {},
  handler: async (ctx) => {
    // Use take() with a high limit to avoid collecting all at once
    // This is still not ideal but prevents byte limit issues
    const upcs = await ctx.db.query("tireUPCs").take(50000);
    return upcs.length;
  },
});

export const getUPCByCode = query({
  args: { upc: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tireUPCs")
      .withIndex("by_upc", (q) => q.eq("upc", args.upc))
      .first();
  },
});

export const getAllReturnBatches = query({
  args: {},
  handler: async (ctx) => {
    const allBatches = await ctx.db.query("returnBatches").order("desc").collect();
    const batches = allBatches.filter(b => !b.archived);

    const enrichedBatches = await Promise.all(
      batches.map(async (batch) => {
        const opener = await ctx.db.get(batch.openedBy);
        const closer = batch.closedBy ? await ctx.db.get(batch.closedBy) : null;
        return {
          ...batch,
          openedByName: opener?.name || "Unknown",
          closedByName: closer?.name || undefined,
        };
      })
    );

    return enrichedBatches;
  },
});

export const getReturnBatchItems = query({
  args: { batchId: v.id("returnBatches") },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("returnItems")
      .withIndex("by_batch", (q) => q.eq("returnBatchId", args.batchId))
      .collect();

    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        const scanner = await ctx.db.get(item.scannedBy);

        // Resolve image URL if it's a storage ID
        let resolvedImageUrl = item.imageUrl;
        if (item.imageUrl && !item.imageUrl.startsWith("http")) {
          // It might be a Convex storage ID - try to resolve it
          try {
            const url = await ctx.storage.getUrl(item.imageUrl as any);
            if (url) {
              resolvedImageUrl = url;
            }
          } catch {
            // If it fails, keep the original value
          }
        }

        return {
          ...item,
          imageUrl: resolvedImageUrl,
          scannedByName: scanner?.name || "Unknown",
        };
      })
    );

    return enrichedItems;
  },
});

export const getReturnStats = query({
  args: {},
  handler: async (ctx) => {
    const batches = await ctx.db.query("returnBatches").collect();
    const items = await ctx.db.query("returnItems").collect();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime();

    const openBatches = batches.filter(b => b.status === "open").length;
    const batchesToday = batches.filter(b => b.openedAt >= todayTimestamp).length;
    const itemsToday = items.filter(i => i.scannedAt >= todayTimestamp).length;

    const processed = items.filter(i => i.status === "processed").length;
    const notProcessed = items.filter(i => i.status === "not_processed").length;
    const pending = items.filter(i => i.status === "pending").length;

    return {
      totalBatches: batches.length,
      openBatches,
      batchesToday,
      totalItems: items.length,
      itemsToday,
      processed,
      notProcessed,
      pending,
    };
  },
});

// Note: This returns all scans - use with caution on large datasets
// For paginated access, use searchTrackingNumber or getTruckScans
export const getAllScans = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("scans").collect();
  },
});

export const getScansToday = query({
  args: { midnightTimestamp: v.number() },
  handler: async (ctx, args) => {
    // Get today's trucks and sum their scanCounts for efficiency
    // This avoids loading all scan documents
    const trucks = await ctx.db
      .query("trucks")
      .filter((q) => q.gte(q.field("openedAt"), args.midnightTimestamp))
      .collect();

    return trucks.reduce((sum, truck) => sum + (truck.scanCount ?? 0), 0);
  },
});

// Get trucks for report (with date filter)
export const getTrucksForReport = query({
  args: {
    startDate: v.number(),
    endDate: v.number(),
  },
  handler: async (ctx, args) => {
    const trucks = await ctx.db.query("trucks").collect();
    const filtered = trucks.filter(t =>
      t.openedAt >= args.startDate && t.openedAt <= args.endDate
    );

    const enriched = await Promise.all(
      filtered.map(async (truck) => {
        const scans = await ctx.db
          .query("scans")
          .withIndex("by_truck", (q) => q.eq("truckId", truck._id))
          .collect();

        // Group by vendor
        const byVendor: Record<string, typeof scans> = {};
        for (const scan of scans) {
          const vendor = scan.vendor || "Unknown";
          if (!byVendor[vendor]) byVendor[vendor] = [];
          byVendor[vendor].push(scan);
        }

        return {
          ...truck,
          scans,
          scanCount: scans.length,
          byVendor,
          vendors: Object.keys(byVendor),
        };
      })
    );

    return enriched;
  },
});

// Get detailed manifest for a truck by vendor
export const getTruckManifestByVendor = query({
  args: { truckId: v.id("trucks") },
  handler: async (ctx, args) => {
    const truck = await ctx.db.get(args.truckId);
    if (!truck) return null;

    const scans = await ctx.db
      .query("scans")
      .withIndex("by_truck", (q) => q.eq("truckId", args.truckId))
      .collect();

    // Group by vendor
    const byVendor: Record<string, any[]> = {};
    for (const scan of scans) {
      const vendor = scan.vendor || "Unknown";
      if (!byVendor[vendor]) byVendor[vendor] = [];
      byVendor[vendor].push({
        trackingNumber: scan.trackingNumber,
        carrier: scan.carrier,
        destination: scan.destination,
        recipientName: scan.recipientName,
        address: scan.address,
        city: scan.city,
        state: scan.state,
        scannedAt: scan.scannedAt,
        vendorAccount: scan.vendorAccount,
      });
    }

    return {
      truck: {
        truckNumber: truck.truckNumber,
        carrier: truck.carrier,
        status: truck.status,
        openedAt: truck.openedAt,
        closedAt: truck.closedAt,
      },
      totalScans: scans.length,
      byVendor,
    };
  },
});

// Search for a tracking number across all trucks
// For exact matches, uses the by_tracking index efficiently
// For partial matches, falls back to paginated search
export const searchTrackingNumber = query({
  args: {
    trackingNumber: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.trackingNumber.length < 3) return [];

    const limit = args.limit || 50;
    const searchTerm = args.trackingNumber;

    // First, try exact match using index (very fast)
    const exactMatch = await ctx.db
      .query("scans")
      .withIndex("by_tracking", (q) => q.eq("trackingNumber", searchTerm))
      .first();

    if (exactMatch) {
      const truck = await ctx.db.get(exactMatch.truckId);
      const user = await ctx.db.get(exactMatch.scannedBy);
      return [{
        ...exactMatch,
        truckNumber: truck?.truckNumber || "Unknown",
        truckStatus: truck?.status || "unknown",
        truckCarrier: truck?.carrier || "Unknown",
        scannedByName: user?.name || "Unknown",
      }];
    }

    // For partial matches, search recent scans (last 30 days) to avoid full table scan
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const recentScans = await ctx.db
      .query("scans")
      .withIndex("by_scannedAt", (q) => q.gte("scannedAt", thirtyDaysAgo))
      .collect();

    const searchTermLower = searchTerm.toLowerCase();
    const matchingScans = recentScans
      .filter(scan => scan.trackingNumber.toLowerCase().includes(searchTermLower))
      .slice(0, limit);

    // Enrich with truck info
    const enriched = await Promise.all(
      matchingScans.map(async (scan) => {
        const truck = await ctx.db.get(scan.truckId);
        const user = await ctx.db.get(scan.scannedBy);
        return {
          ...scan,
          truckNumber: truck?.truckNumber || "Unknown",
          truckStatus: truck?.status || "unknown",
          truckCarrier: truck?.carrier || "Unknown",
          scannedByName: user?.name || "Unknown",
        };
      })
    );

    return enriched;
  },
});

// Get vendor report for a date range (all scans for a vendor across all trucks in date range)
export const getVendorDateRangeReport = query({
  args: {
    startDate: v.number(),
    endDate: v.number(),
    vendor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Get all trucks in date range
    const trucks = await ctx.db.query("trucks").collect();
    const filteredTrucks = trucks.filter(t =>
      t.openedAt >= args.startDate && t.openedAt <= args.endDate
    );

    // Get all scans for these trucks
    const allScans: any[] = [];
    for (const truck of filteredTrucks) {
      const scans = await ctx.db
        .query("scans")
        .withIndex("by_truck", (q) => q.eq("truckId", truck._id))
        .collect();

      for (const scan of scans) {
        // Filter by vendor if specified
        if (args.vendor && scan.vendor !== args.vendor) continue;

        allScans.push({
          ...scan,
          truckNumber: truck.truckNumber,
          truckCarrier: truck.carrier,
          truckOpenedAt: truck.openedAt,
          truckClosedAt: truck.closedAt,
        });
      }
    }

    // Group by vendor
    const byVendor: Record<string, typeof allScans> = {};
    for (const scan of allScans) {
      const vendor = scan.vendor || "Unknown";
      if (!byVendor[vendor]) byVendor[vendor] = [];
      byVendor[vendor].push(scan);
    }

    // Sort vendors and get stats
    const vendors = Object.keys(byVendor).sort();
    const stats = vendors.map(vendor => ({
      vendor,
      count: byVendor[vendor].length,
      trucks: [...new Set(byVendor[vendor].map(s => s.truckNumber))].length,
    }));

    return {
      startDate: args.startDate,
      endDate: args.endDate,
      totalScans: allScans.length,
      totalTrucks: filteredTrucks.length,
      vendors: stats,
      byVendor,
    };
  },
});

// Get all vendors that have scans
export const getAllVendors = query({
  args: {},
  handler: async (ctx) => {
    // Get vendors from vendorAccounts table (much smaller than trucks)
    const vendorAccounts = await ctx.db.query("vendorAccounts").collect();
    const vendorSet = new Set<string>();

    for (const account of vendorAccounts) {
      if (account.vendorName) {
        vendorSet.add(account.vendorName);
      }
    }

    // Also check recent trucks (last 100) for any vendors not in accounts
    const recentTrucks = await ctx.db.query("trucks").order("desc").take(100);
    for (const truck of recentTrucks) {
      if (truck.vendors) {
        for (const v of truck.vendors) {
          vendorSet.add(v);
        }
      }
    }

    vendorSet.add("Unknown"); // Always include Unknown
    return Array.from(vendorSet).sort();
  },
});

// Get matched scan stats - uses truck-level data for efficiency
export const getMatchedScanStats = query({
  args: {
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Only get non-archived trucks to reduce data volume
    // Use take() with a reasonable limit to avoid byte limits
    const recentTrucks = await ctx.db.query("trucks").order("desc").take(500);
    const trucks = recentTrucks.filter(t => !t.archived);

    const overallTotal = trucks.reduce((sum, t) => sum + (t.scanCount ?? 0), 0);

    // Estimate matched based on trucks with vendors
    // Note: This is approximate - for exact counts, use a dedicated aggregation
    const trucksWithVendors = trucks.filter(t => t.vendors && t.vendors.length > 0 && !t.vendors.includes("Unknown"));
    const estimatedMatched = trucksWithVendors.reduce((sum, t) => sum + (t.scanCount ?? 0), 0);

    // Daily stats (if date range provided)
    let dailyTotal = 0;
    let dailyMatched = 0;

    if (args.startDate !== undefined && args.endDate !== undefined) {
      const dailyTrucks = trucks.filter(t =>
        t.openedAt >= args.startDate! && t.openedAt <= args.endDate!
      );
      dailyTotal = dailyTrucks.reduce((sum, t) => sum + (t.scanCount ?? 0), 0);
      const dailyTrucksWithVendors = dailyTrucks.filter(t => t.vendors && t.vendors.length > 0);
      dailyMatched = dailyTrucksWithVendors.reduce((sum, t) => sum + (t.scanCount ?? 0), 0);
    }

    return {
      overall: {
        total: overallTotal,
        matched: estimatedMatched,
        unmatchedBreakdown: { ups: 0, fedexUnmapped: 0, other: 0, total: overallTotal - estimatedMatched },
      },
      daily: {
        total: dailyTotal,
        matched: dailyMatched,
        unmatchedBreakdown: { ups: 0, fedexUnmapped: 0, other: 0, total: dailyTotal - dailyMatched },
      },
    };
  },
});

// Get all unmatched scans with details for report
export const getUnmatchedScansReport = query({
  args: {},
  handler: async (ctx) => {
    const allScans = await ctx.db.query("scans").collect();
    const unmatched = allScans.filter(s => !s.vendor || s.vendor === "Unknown");

    // Get truck and user info for each scan
    const enriched = await Promise.all(
      unmatched.map(async (scan) => {
        const truck = await ctx.db.get(scan.truckId);
        const user = await ctx.db.get(scan.scannedBy);
        const raw = scan.rawBarcode || "";
        const isUPS = raw.includes("UPSN") || raw.startsWith("1Z");
        const isFedEx = raw.includes("FDEG") || raw.includes("[)>");
        const category = isUPS ? "UPS" : isFedEx ? "FedEx unmapped" : "Other";

        return {
          _id: scan._id,
          trackingNumber: scan.trackingNumber,
          carrier: scan.carrier || "",
          rawBarcode: scan.rawBarcode || "",
          category,
          truckNumber: truck?.truckNumber || "Unknown",
          scannedAt: scan.scannedAt,
          recipientName: scan.recipientName || "",
          destination: scan.destination || "",
          scannedByName: user?.name || "Unknown",
          scannedByEmpId: user?.empId || "",
          isMiscan: scan.isMiscan || false,
        };
      })
    );

    // Calculate daily breakdown for last 30 days
    const now = Date.now();
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
    const dailyBreakdown: Record<string, { total: number; unmatched: number; miscan: number }> = {};

    // Get all scans for last 30 days
    const recentScans = allScans.filter(s => s.scannedAt >= thirtyDaysAgo);

    for (const scan of recentScans) {
      const date = new Date(scan.scannedAt).toISOString().split('T')[0];
      if (!dailyBreakdown[date]) {
        dailyBreakdown[date] = { total: 0, unmatched: 0, miscan: 0 };
      }
      dailyBreakdown[date].total++;
      if (!scan.vendor || scan.vendor === "Unknown") {
        dailyBreakdown[date].unmatched++;
        if (scan.isMiscan) {
          dailyBreakdown[date].miscan++;
        }
      }
    }

    // Convert to sorted array
    const dailyData = Object.entries(dailyBreakdown)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({
        date,
        ...data,
        matchRate: data.total > 0 ? ((data.total - data.unmatched) / data.total * 100) : 100,
      }));

    return {
      scans: enriched.sort((a, b) => b.scannedAt - a.scannedAt),
      dailyData,
    };
  },
});

// Debug query to check return item image URLs
export const debugReturnItemImages = query({
  args: {},
  handler: async (ctx) => {
    const items = await ctx.db.query("returnItems").take(20);

    const results = await Promise.all(
      items.map(async (item) => {
        let resolvedUrl = null;
        let storageError = null;

        if (item.imageUrl) {
          // Try to resolve as storage ID
          if (!item.imageUrl.startsWith("http")) {
            try {
              resolvedUrl = await ctx.storage.getUrl(item.imageUrl as any);
            } catch (e: any) {
              storageError = e?.message || "Failed to resolve";
            }
          } else {
            resolvedUrl = item.imageUrl;
          }
        }

        return {
          id: item._id,
          rawImageUrl: item.imageUrl || null,
          startsWithHttp: item.imageUrl?.startsWith("http") || false,
          resolvedUrl,
          storageError,
          hasImage: !!item.imageUrl,
        };
      })
    );

    return {
      totalItems: items.length,
      itemsWithImageUrl: results.filter(r => r.hasImage).length,
      itemsWithResolvedUrl: results.filter(r => r.resolvedUrl).length,
      items: results,
    };
  },
});

// Get "No Vendor Known" scans grouped by potential account number
// Helps identify patterns that suggest a new vendor to research
export const getNoVendorKnownReport = query({
  args: {},
  handler: async (ctx) => {
    const scans = await ctx.db.query("scans").collect();

    // Filter to noVendorKnown scans
    const noVendorScans = scans.filter(s => s.noVendorKnown === true);

    // Group by potential account number
    const byAccountNumber: Record<string, {
      count: number;
      scans: typeof noVendorScans;
    }> = {};

    let noAccountNumber = 0;

    for (const scan of noVendorScans) {
      const accountNum = scan.potentialAccountNumber || "no_account";
      if (accountNum === "no_account") {
        noAccountNumber++;
      }
      if (!byAccountNumber[accountNum]) {
        byAccountNumber[accountNum] = { count: 0, scans: [] };
      }
      byAccountNumber[accountNum].count++;
      byAccountNumber[accountNum].scans.push(scan);
    }

    // Convert to array and sort by count (highest first)
    const grouped = Object.entries(byAccountNumber)
      .filter(([key]) => key !== "no_account") // Exclude scans without account numbers
      .map(([accountNumber, data]) => ({
        accountNumber,
        count: data.count,
        // Include sample scan info for context
        sampleScans: data.scans.slice(0, 5).map(s => ({
          _id: s._id,
          trackingNumber: s.trackingNumber,
          destination: s.destination,
          scannedAt: s.scannedAt,
          rawBarcode: s.rawBarcode,
        })),
        // Flag if this looks like a potential new vendor (7+ occurrences)
        likelyNewVendor: data.count >= 7,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      totalNoVendorKnown: noVendorScans.length,
      noAccountNumber,
      groupedByAccount: grouped,
      // Highlight accounts with 7+ occurrences
      potentialNewVendors: grouped.filter(g => g.likelyNewVendor),
      // One-off vendors (single occurrence)
      oneOffVendors: grouped.filter(g => g.count === 1).length,
    };
  },
});

// Get count of noVendorKnown scans
export const getNoVendorKnownCount = query({
  args: {},
  handler: async (ctx) => {
    // Use index to get only noVendorKnown scans (requires by_noVendorKnown index)
    const scans = await ctx.db
      .query("scans")
      .withIndex("by_noVendorKnown", (q) => q.eq("noVendorKnown", true))
      .collect();
    return scans.length;
  },
});

// Get user scanning accuracy stats (total scans vs bad scans) - both monthly and all-time
export const getUserAccuracyStats = query({
  args: {},
  handler: async (ctx) => {
    const scans = await ctx.db.query("scans").collect();
    const users = await ctx.db.query("users").collect();

    // Get start of current month (EST timezone)
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    startOfMonth.setHours(0, 0, 0, 0);
    const monthStart = startOfMonth.getTime();

    // Create a map of user stats for both all-time and monthly
    const userStats: Record<string, {
      userId: string;
      name: string;
      empId: string;
      // All-time stats
      totalScans: number;
      badScans: number;
      accuracy: number;
      // Monthly stats
      monthlyScans: number;
      monthlyBadScans: number;
      monthlyAccuracy: number;
    }> = {};

    // Count scans per user
    for (const scan of scans) {
      const userId = scan.scannedBy;
      if (!userStats[userId]) {
        const user = users.find(u => u._id === userId);
        userStats[userId] = {
          userId,
          name: user?.name || "Unknown",
          empId: user?.empId || "N/A",
          totalScans: 0,
          badScans: 0,
          accuracy: 100,
          monthlyScans: 0,
          monthlyBadScans: 0,
          monthlyAccuracy: 100,
        };
      }

      // All-time counts
      userStats[userId].totalScans++;
      if (scan.isMiscan) {
        userStats[userId].badScans++;
      }

      // Monthly counts (check if scan is from current month)
      if (scan.scannedAt >= monthStart) {
        userStats[userId].monthlyScans++;
        if (scan.isMiscan) {
          userStats[userId].monthlyBadScans++;
        }
      }
    }

    // Calculate accuracy for each user (both all-time and monthly)
    const results = Object.values(userStats).map(user => ({
      ...user,
      accuracy: user.totalScans > 0
        ? ((user.totalScans - user.badScans) / user.totalScans) * 100
        : 100,
      monthlyAccuracy: user.monthlyScans > 0
        ? ((user.monthlyScans - user.monthlyBadScans) / user.monthlyScans) * 100
        : 100,
    }));

    // Sort by monthly scans first (most active this month), then all-time
    results.sort((a, b) => b.monthlyScans - a.monthlyScans || b.totalScans - a.totalScans);

    // Calculate overall stats (all-time)
    const totalScans = scans.length;
    const totalBadScans = scans.filter(s => s.isMiscan).length;
    const overallAccuracy = totalScans > 0
      ? ((totalScans - totalBadScans) / totalScans) * 100
      : 100;

    // Calculate overall monthly stats
    const monthlyScans = scans.filter(s => s.scannedAt >= monthStart);
    const totalMonthlyScans = monthlyScans.length;
    const totalMonthlyBadScans = monthlyScans.filter(s => s.isMiscan).length;
    const overallMonthlyAccuracy = totalMonthlyScans > 0
      ? ((totalMonthlyScans - totalMonthlyBadScans) / totalMonthlyScans) * 100
      : 100;

    // Get current month name for display
    const monthName = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    return {
      users: results,
      overall: {
        totalScans,
        totalBadScans,
        accuracy: overallAccuracy,
      },
      monthly: {
        monthName,
        totalScans: totalMonthlyScans,
        totalBadScans: totalMonthlyBadScans,
        accuracy: overallMonthlyAccuracy,
      },
    };
  },
});

export const analyzeUnknownCarrierPatterns = query({
  args: {},
  handler: async (ctx) => {
    const scans = await ctx.db.query("scans").collect();
    const unknown = scans.filter(s => !s.vendor || s.vendor === "Unknown");

    // Categorize and analyze patterns
    const results: {
      ups: { count: number; samples: Array<{ tracking: string; raw: string; carrier: string }> };
      fedex: { count: number; samples: Array<{ tracking: string; raw: string; carrier: string }> };
      usps: { count: number; samples: Array<{ tracking: string; raw: string; carrier: string }> };
      other: { count: number; samples: Array<{ tracking: string; raw: string; carrier: string }> };
      potentialUpsPatterns: string[];
    } = {
      ups: { count: 0, samples: [] },
      fedex: { count: 0, samples: [] },
      usps: { count: 0, samples: [] },
      other: { count: 0, samples: [] },
      potentialUpsPatterns: [],
    };

    // Known UPS 2D barcode markers
    const upsMarkers = [
      "UPSN", // UPS MaxiCode marker
      "[)>\\x1e06", // UPS 2D format start
      "\\x1d96", // UPS shipper number field
    ];

    for (const scan of unknown) {
      const raw = scan.rawBarcode || "";
      const tracking = scan.trackingNumber || "";
      const carrier = scan.carrier || "";

      // Check for UPS patterns
      const isUPS =
        raw.includes("UPSN") ||
        tracking.startsWith("1Z") ||
        carrier.toLowerCase().includes("ups") ||
        raw.includes("\x1e06") || // UPS 2D format
        /1Z[A-Z0-9]{16}/.test(raw); // 1Z tracking embedded in raw

      // Check for FedEx patterns
      const isFedEx =
        raw.includes("FDEG") ||
        raw.includes("[)>") ||
        carrier.toLowerCase().includes("fedex");

      // Check for USPS patterns
      const isUSPS =
        carrier.toLowerCase().includes("usps") ||
        /^(94|93|92|91|90|70|23|13)/.test(tracking) ||
        raw.includes("USPS");

      if (isUPS) {
        results.ups.count++;
        if (results.ups.samples.length < 10) {
          results.ups.samples.push({ tracking, raw: raw.substring(0, 200), carrier });
        }
      } else if (isFedEx) {
        results.fedex.count++;
        if (results.fedex.samples.length < 10) {
          results.fedex.samples.push({ tracking, raw: raw.substring(0, 200), carrier });
        }
      } else if (isUSPS) {
        results.usps.count++;
        if (results.usps.samples.length < 10) {
          results.usps.samples.push({ tracking, raw: raw.substring(0, 200), carrier });
        }
      } else {
        results.other.count++;
        if (results.other.samples.length < 20) {
          results.other.samples.push({ tracking, raw: raw.substring(0, 200), carrier });
        }
      }

      // Look for potential UPS shipper numbers in raw barcode
      // UPS shipper numbers are typically 6 characters after a control character
      const shipperMatch = raw.match(/\x1d96([A-Z0-9]{6})/);
      if (shipperMatch && !results.potentialUpsPatterns.includes(shipperMatch[1])) {
        results.potentialUpsPatterns.push(shipperMatch[1]);
      }
    }

    return results;
  },
});

// Get duplicate scans report - shows who added duplicates and when (training opportunities)
export const getDuplicateScansReport = query({
  args: {},
  handler: async (ctx) => {
    const scans = await ctx.db.query("scans").collect();
    const users = await ctx.db.query("users").collect();
    const trucks = await ctx.db.query("trucks").collect();

    // Find all scans marked as duplicates
    const duplicates = scans.filter((scan) => scan.isDuplicate === true);

    // Group by user for "needs training" report
    const byUser: Record<string, {
      userId: string;
      userName: string;
      duplicateCount: number;
      duplicates: Array<{
        trackingNumber: string;
        scannedAt: number;
        duplicateAddedAt?: number;
        truckNumber: string;
      }>;
    }> = {};

    for (const dup of duplicates) {
      const user = users.find((u) => u._id === dup.scannedBy);
      const truck = trucks.find((t) => t._id === dup.truckId);
      const userName = user?.name ?? "Unknown";
      const userId = dup.scannedBy;

      if (!byUser[userId]) {
        byUser[userId] = {
          userId,
          userName,
          duplicateCount: 0,
          duplicates: [],
        };
      }

      byUser[userId].duplicateCount++;
      byUser[userId].duplicates.push({
        trackingNumber: dup.trackingNumber,
        scannedAt: dup.scannedAt,
        duplicateAddedAt: dup.duplicateAddedAt,
        truckNumber: truck?.truckNumber ?? "Unknown",
      });
    }

    // Sort users by duplicate count (worst offenders first)
    const userList = Object.values(byUser).sort((a, b) => b.duplicateCount - a.duplicateCount);

    // Calculate overall stats
    const totalDuplicates = duplicates.length;
    const totalScans = scans.length;
    const duplicateRate = totalScans > 0 ? (totalDuplicates / totalScans) * 100 : 0;

    // Get monthly stats
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    startOfMonth.setHours(0, 0, 0, 0);
    const monthStart = startOfMonth.getTime();

    const monthlyDuplicates = duplicates.filter((d) => d.scannedAt >= monthStart);
    const monthlyScans = scans.filter((s) => s.scannedAt >= monthStart);
    const monthlyDuplicateRate = monthlyScans.length > 0
      ? (monthlyDuplicates.length / monthlyScans.length) * 100
      : 0;

    return {
      users: userList,
      overall: {
        totalDuplicates,
        totalScans,
        duplicateRate,
      },
      monthly: {
        monthName: now.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
        totalDuplicates: monthlyDuplicates.length,
        totalScans: monthlyScans.length,
        duplicateRate: monthlyDuplicateRate,
      },
    };
  },
});

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
      items = await ctx.db.query("returnItems").collect();
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

    // Get all batches and users for enrichment
    const batches = await ctx.db.query("returnBatches").collect();
    const users = await ctx.db.query("users").collect();
    const locations = await ctx.db.query("locations").collect();

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

// Get return batches list for export filter dropdown
export const getReturnBatchesForExport = query({
  args: {},
  handler: async (ctx) => {
    const batches = await ctx.db.query("returnBatches").order("desc").take(100);
    const locations = await ctx.db.query("locations").collect();

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
