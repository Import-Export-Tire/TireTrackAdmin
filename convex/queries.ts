import { query, internalQuery } from "./_generated/server";
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

    // Use stored scanCount — maintained by addScan and markScanAsDouble mutations
    return trucks.map((truck) => ({
      ...truck,
      scanCount: truck.scanCount ?? 0,
    }));
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

    // Pre-fetch unique users
    const userIds = [...new Set(scans.map((s) => s.scannedBy))];
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    const userMap = new Map(userIds.map((id, i) => [id, users[i]]));

    return scans.map((scan) => ({
      ...scan,
      scannedByName: userMap.get(scan.scannedBy)?.name ?? "Unknown",
    }));
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
      scanCount: scans.reduce((sum, s) => sum + (s.quantity ?? 1), 0),
      openedByName: openedByUser?.name ?? "Unknown",
      closedByName: closedByUser?.name ?? null,
    };
  },
});

// Get all locations
export const getLocations = query({
  args: {},
  handler: async (ctx) => {
    // Limit to 100 locations max
    const locations = await ctx.db.query("locations").take(100);
    return locations.filter((l) => l.isActive);
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

    const userIds = [...new Set(scans.map((s) => s.scannedBy))];
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    const userMap = new Map(userIds.map((id, i) => [id, users[i]]));

    return scans.map((scan) => ({
      ...scan,
      scannedByName: userMap.get(scan.scannedBy)?.name ?? "Unknown",
    }));
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

    // Pre-fetch unique users
    const userIds = [...new Set(batches.map((b) => b.openedBy))];
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    const userMap = new Map(userIds.map((id, i) => [id, users[i]]));

    // Use stored itemCount — maintained by addReturnItem/deleteReturnItem mutations
    return batches.map((batch) => ({
      ...batch,
      itemCount: batch.itemCount ?? 0,
      openedByName: userMap.get(batch.openedBy)?.name ?? "Unknown",
    }));
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

    const userIds = [...new Set(items.map((i) => i.scannedBy))];
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    const userMap = new Map(userIds.map((id, i) => [id, users[i]]));

    return items.map((item) => ({
      ...item,
      scannedByName: userMap.get(item.scannedBy)?.name ?? "Unknown",
    }));
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
    // Use truck-level data for efficiency instead of loading all scans
    const trucks = await ctx.db.query("trucks").order("desc").take(500);
    const nonArchivedTrucks = trucks.filter(t => !t.archived);

    let total = 0;
    let known = 0;

    for (const truck of nonArchivedTrucks) {
      total += truck.scanCount ?? 0;
      // If truck has vendors other than Unknown, count those scans as known
      if (truck.vendors && truck.vendors.length > 0) {
        const hasKnownVendor = truck.vendors.some(v => v !== "Unknown");
        if (hasKnownVendor) {
          known += truck.scanCount ?? 0;
        }
      }
    }

    return {
      total,
      known,
      unknown: total - known,
      patterns: {} // Patterns require loading scans, skip for efficiency
    };
  },
});

export const getScanByTracking = query({
  args: { trackingNumber: v.string() },
  handler: async (ctx, args) => {
    // Use index for efficient lookup
    return await ctx.db
      .query("scans")
      .withIndex("by_tracking", (q) => q.eq("trackingNumber", args.trackingNumber))
      .first();
  },
});

export const getUnmappedFedExScans = query({
  args: {},
  handler: async (ctx) => {
    // Get recent scans only (last 30 days) to avoid loading entire database
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const recentScans = await ctx.db
      .query("scans")
      .withIndex("by_scannedAt", (q) => q.gte("scannedAt", thirtyDaysAgo))
      .collect();

    const unmapped = recentScans.filter(s => {
      const raw = s.rawBarcode || "";
      const isFedEx = raw.includes("FDEG") || raw.includes("[)>");
      const noVendor = !s.vendor || s.vendor === "Unknown";
      return isFedEx && noVendor;
    });

    return unmapped.slice(0, 200).map(s => ({
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
    // Get recent scans only (last 30 days) to avoid loading entire database
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const recentScans = await ctx.db
      .query("scans")
      .withIndex("by_scannedAt", (q) => q.gte("scannedAt", thirtyDaysAgo))
      .collect();

    const unknown = recentScans.filter(s => !s.vendor || s.vendor === "Unknown");
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
      .slice(0, 100)
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

    // Pre-fetch all unique users (openers + closers)
    const userIds = [...new Set([
      ...trucks.map((t) => t.openedBy),
      ...trucks.filter((t) => t.closedBy).map((t) => t.closedBy!),
    ])];
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    const userMap = new Map(userIds.map((id, i) => [id, users[i]]));

    return trucks.map((truck) => ({
      ...truck,
      scanCount: truck.scanCount ?? 0,
      openedByName: userMap.get(truck.openedBy)?.name ?? "Unknown",
      closedByName: truck.closedBy
        ? userMap.get(truck.closedBy)?.name ?? null
        : null,
      vendors: truck.vendors ?? [],
      trackingNumbers: [],
    }));
  },
});

export const getAllUsers = query({
  args: {},
  handler: async (ctx) => {
    // Limit to 500 users max
    return await ctx.db.query("users").take(500);
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
      return await ctx.db.query("tireUPCs").order("desc").take(limit);
    }

    const search = args.search.toLowerCase();
    // UPC records are small (~200 bytes each), safe to load all
    const all = await ctx.db.query("tireUPCs").take(50000);

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
    // Limit to 500 most recent batches
    const allBatches = await ctx.db.query("returnBatches").order("desc").take(500);
    const batches = allBatches.filter(b => !b.archived);

    // Pre-fetch all unique users (openers + closers)
    const userIds = [...new Set([
      ...batches.map((b) => b.openedBy),
      ...batches.filter((b) => b.closedBy).map((b) => b.closedBy!),
    ])];
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    const userMap = new Map(userIds.map((id, i) => [id, users[i]]));

    const KNOWN_LOCATIONS: Record<string, string> = {
      "kj7q0v1qxbf6z1b1h2cjhf4m8h74vjbe": "Latrobe",
      "kj74zfr66q23wgv5xc3qdc0a6s74vvtr": "Everson",
      "kj70r8fvdeg83dhapvp91kqs2574vqng": "Chestnut",
    };

    return batches.map((batch) => ({
      ...batch,
      openedByName: userMap.get(batch.openedBy)?.name || "Unknown",
      closedByName: batch.closedBy
        ? userMap.get(batch.closedBy)?.name || undefined
        : undefined,
      locationName: KNOWN_LOCATIONS[batch.locationId] || batch.locationId || "Unknown",
    }));
  },
});

export const getReturnBatchItems = query({
  args: { batchId: v.id("returnBatches") },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("returnItems")
      .withIndex("by_batch", (q) => q.eq("returnBatchId", args.batchId))
      .collect();

    // Pre-fetch unique users
    const userIds = [...new Set(items.map((i) => i.scannedBy))];
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    const userMap = new Map(userIds.map((id, idx) => [id, users[idx]]));

    // Storage URL resolution must stay per-item (each is a unique storage ID)
    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        let resolvedImageUrl = item.imageUrl;
        if (item.imageUrl && !item.imageUrl.startsWith("http")) {
          try {
            const url = await ctx.storage.getUrl(item.imageUrl as any);
            if (url) resolvedImageUrl = url;
          } catch {}
        }

        return {
          ...item,
          imageUrl: resolvedImageUrl,
          scannedByName: userMap.get(item.scannedBy)?.name || "Unknown",
        };
      })
    );

    return enrichedItems;
  },
});

export const getReturnStats = query({
  args: {},
  handler: async (ctx) => {
    // Limit to recent data to avoid memory issues
    const batches = await ctx.db.query("returnBatches").order("desc").take(1000);
    const items = await ctx.db.query("returnItems").order("desc").take(5000);

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

// Note: Returns recent scans only - use searchTrackingNumber or getTruckScans for specific lookups
export const getAllScans = query({
  args: {},
  handler: async (ctx) => {
    // Limit to 2000 most recent scans to stay under 16MB byte limit
    return await ctx.db.query("scans").order("desc").take(2000);
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
    // Limit to 1000 trucks max
    const trucks = await ctx.db.query("trucks").order("desc").take(1000);
    const filtered = trucks.filter(t =>
      t.openedAt >= args.startDate && t.openedAt <= args.endDate
    ).slice(0, 200); // Limit filtered results to 200

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
          scanCount: scans.reduce((sum, s) => sum + (s.quantity ?? 1), 0),
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
        quantity: scan.quantity,
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

    // Pre-fetch unique trucks and users
    const truckIds = [...new Set(matchingScans.map((s) => s.truckId))];
    const truckResults = await Promise.all(truckIds.map((id) => ctx.db.get(id)));
    const truckMap = new Map(truckIds.map((id, i) => [id, truckResults[i]]));

    const userIds = [...new Set(matchingScans.map((s) => s.scannedBy))];
    const userResults = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    const userMap = new Map(userIds.map((id, i) => [id, userResults[i]]));

    return matchingScans.map((scan) => {
      const truck = truckMap.get(scan.truckId);
      const user = userMap.get(scan.scannedBy);
      return {
        ...scan,
        truckNumber: truck?.truckNumber || "Unknown",
        truckStatus: truck?.status || "unknown",
        truckCarrier: truck?.carrier || "Unknown",
        scannedByName: user?.name || "Unknown",
      };
    });
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
    // Limit to 1000 trucks max
    const trucks = await ctx.db.query("trucks").order("desc").take(1000);
    const filteredTrucks = trucks.filter(t =>
      t.openedAt >= args.startDate && t.openedAt <= args.endDate
    ).slice(0, 200); // Limit to 200 trucks

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
          locationId: truck.locationId,
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
    const vendorAccounts = await ctx.db.query("vendorAccounts").take(200);
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
    // Scope "overall" to last 30 days — older scans predate vendor matching
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentTrucks = await ctx.db.query("trucks").order("desc").take(500);
    const trucks = recentTrucks.filter(t => !t.archived && t.openedAt >= thirtyDaysAgo);

    const overallTotal = trucks.reduce((sum, t) => sum + (t.scanCount ?? 0), 0);

    // Estimate matched based on trucks with vendors
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
    // Get only last 30 days of scans to avoid database limits
    const now = Date.now();
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

    const recentScans = await ctx.db
      .query("scans")
      .withIndex("by_scannedAt", (q) => q.gte("scannedAt", thirtyDaysAgo))
      .collect();

    const unmatched = recentScans.filter(s => !s.vendor || s.vendor === "Unknown");

    // Limit enriched results to avoid memory issues
    const unmatchedToEnrich = unmatched.slice(0, 500);

    // Pre-fetch unique trucks and users
    const truckIds = [...new Set(unmatchedToEnrich.map((s) => s.truckId))];
    const truckResults = await Promise.all(truckIds.map((id) => ctx.db.get(id)));
    const truckMap = new Map(truckIds.map((id, i) => [id, truckResults[i]]));

    const userIds = [...new Set(unmatchedToEnrich.map((s) => s.scannedBy))];
    const userResults = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    const userMap = new Map(userIds.map((id, i) => [id, userResults[i]]));

    const enriched = unmatchedToEnrich.map((scan) => {
      const truck = truckMap.get(scan.truckId);
      const user = userMap.get(scan.scannedBy);
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
    });

    // Calculate daily breakdown for last 30 days
    const dailyBreakdown: Record<string, { total: number; unmatched: number; miscan: number }> = {};

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
      totalUnmatched: unmatched.length, // Include total for context
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

// Get error logs with optional filtering
export const getErrorLogs = query({
  args: {
    unresolvedOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 100;

    let errors;
    if (args.unresolvedOnly) {
      errors = await ctx.db
        .query("errorLogs")
        .withIndex("by_resolved", (q) => q.eq("resolved", false))
        .order("desc")
        .take(limit);
    } else {
      errors = await ctx.db
        .query("errorLogs")
        .withIndex("by_timestamp")
        .order("desc")
        .take(limit);
    }

    // Pre-fetch unique users from error logs
    const userIds = [...new Set(
      errors.filter((e) => e.userId).map((e) => e.userId!)
    )];
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    const userMap = new Map(userIds.map((id, i) => [id, users[i]]));

    return errors.map((error) => {
      let userName: string | undefined;
      let userLocation: string | undefined;
      if (error.userId) {
        const user = userMap.get(error.userId);
        userName = user?.name;
        userLocation = user?.locationId || error.locationId;
      }
      let truckNumber: string | undefined;
      let rawBarcode: string | undefined;
      let trackingNumber: string | undefined;
      if (error.details) {
        try {
          const parsed = JSON.parse(error.details);
          truckNumber = parsed.truckNumber;
          rawBarcode = parsed.rawBarcode;
          trackingNumber = parsed.trackingNumber;
        } catch {}
      }
      return {
        ...error,
        userName,
        userLocation: userLocation || error.locationId,
        truckNumber,
        rawBarcode,
        trackingNumber,
      };
    });
  },
});

// Get count of unresolved errors
export const getUnresolvedErrorCount = query({
  args: {},
  handler: async (ctx) => {
    const unresolved = await ctx.db
      .query("errorLogs")
      .withIndex("by_resolved", (q) => q.eq("resolved", false))
      .collect();
    return unresolved.length;
  },
});

// Get "No Vendor Known" scans grouped by potential account number
// Helps identify patterns that suggest a new vendor to research
export const getNoVendorKnownReport = query({
  args: {},
  handler: async (ctx) => {
    // Use index for noVendorKnown scans, limit to 2000
    const noVendorScans = await ctx.db
      .query("scans")
      .withIndex("by_noVendorKnown", (q) => q.eq("noVendorKnown", true))
      .take(2000);

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
    // Limit scans to last 30 days for performance (raw barcodes are large)
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const scans = await ctx.db
      .query("scans")
      .withIndex("by_scannedAt", (q) => q.gte("scannedAt", thirtyDaysAgo))
      .collect();
    const users = await ctx.db.query("users").take(500);

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
    // Limit to last 30 days for performance
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const scans = await ctx.db
      .query("scans")
      .withIndex("by_scannedAt", (q) => q.gte("scannedAt", thirtyDaysAgo))
      .collect();
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
    // Limit to last 30 days for performance (raw barcodes are large)
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const scans = await ctx.db
      .query("scans")
      .withIndex("by_scannedAt", (q) => q.gte("scannedAt", thirtyDaysAgo))
      .collect();
    const users = await ctx.db.query("users").take(500);
    const trucks = await ctx.db.query("trucks").order("desc").take(500);

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

// Internal query for manifest email - returns trucks with scans grouped by vendor
export const getTrucksForManifestEmail = internalQuery({
  args: { startDate: v.number(), endDate: v.number() },
  handler: async (ctx, args) => {
    const trucks = await ctx.db.query("trucks").order("desc").take(500);
    const filtered = trucks.filter(
      (t) => t.openedAt >= args.startDate && t.openedAt < args.endDate
    );

    // Pre-fetch all users for efficient name lookups
    const users = await ctx.db.query("users").take(500);
    const userMap = new Map(users.map((u) => [u._id, u.name]));

    const enriched = await Promise.all(
      filtered.map(async (truck) => {
        const scans = await ctx.db
          .query("scans")
          .withIndex("by_truck", (q) => q.eq("truckId", truck._id))
          .collect();

        // Filter out duplicates
        const validScans = scans.filter((s) => !s.isDuplicate);

        // Group scans by vendor
        const byVendor: Record<
          string,
          Array<{
            trackingNumber: string;
            carrier: string;
            destination: string;
            scannedByName: string;
            quantity?: number;
          }>
        > = {};
        for (const scan of validScans) {
          const vendor = scan.vendor || "Unknown";
          if (!byVendor[vendor]) byVendor[vendor] = [];
          byVendor[vendor].push({
            trackingNumber: scan.trackingNumber,
            carrier: scan.carrier || "",
            destination: scan.destination,
            scannedByName: userMap.get(scan.scannedBy) || "Unknown",
            quantity: scan.quantity,
          });
        }

        const openedByName = userMap.get(truck.openedBy) || "Unknown";

        return {
          truckNumber: truck.truckNumber,
          carrier: truck.carrier,
          status: truck.status,
          openedAt: truck.openedAt,
          closedAt: truck.closedAt,
          openedByName,
          scanCount: validScans.reduce((sum, s) => sum + (s.quantity ?? 1), 0),
          byVendor,
        };
      })
    );

    return enriched;
  },
});

// Simple Tire UPS duplicate tracking report — finds tracking numbers
// reused across multiple scans, evidence for vendor label generation fix
export const getSimpleTireUPSDuplicates = query({
  args: {
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let trucks;
    if (args.startDate && args.endDate) {
      trucks = await ctx.db
        .query("trucks")
        .filter((q) =>
          q.and(
            q.gte(q.field("openedAt"), args.startDate!),
            q.lte(q.field("openedAt"), args.endDate!)
          )
        )
        .take(200);
    } else {
      trucks = await ctx.db.query("trucks").order("desc").take(100);
    }

    // Collect Simple Tire UPS scans across all trucks
    const trackingMap: Record<
      string,
      Array<{ truckId: string; truckNumber: string; scannedAt: number }>
    > = {};

    for (const truck of trucks) {
      const scans = await ctx.db
        .query("scans")
        .withIndex("by_truck", (q) => q.eq("truckId", truck._id))
        .collect();

      for (const scan of scans) {
        if (
          scan.vendor === "Simple Tire" &&
          scan.carrier?.toLowerCase().includes("ups")
        ) {
          if (!trackingMap[scan.trackingNumber]) {
            trackingMap[scan.trackingNumber] = [];
          }
          trackingMap[scan.trackingNumber].push({
            truckId: truck._id,
            truckNumber: truck.truckNumber,
            scannedAt: scan.scannedAt,
          });
        }
      }
    }

    // Filter to tracking numbers that appear 2+ times
    const duplicates = Object.entries(trackingMap)
      .filter(([_, appearances]) => appearances.length > 1)
      .map(([trackingNumber, appearances]) => ({
        trackingNumber,
        count: appearances.length,
        trucks: [...new Set(appearances.map((a) => a.truckNumber))],
        appearances: appearances.sort((a, b) => a.scannedAt - b.scannedAt),
      }))
      .sort((a, b) => b.count - a.count);

    return {
      totalReusedTrackingNumbers: duplicates.length,
      totalAffectedScans: duplicates.reduce((sum, d) => sum + d.count, 0),
      duplicates: duplicates.slice(0, 200),
    };
  },
});

// ==================== BONUS TRACKER ====================

export const getRecentTrucksForBonus = query({
  args: { locationId: v.string() },
  handler: async (ctx, args) => {
    const openTrucks = await ctx.db
      .query("trucks")
      .withIndex("by_location_status", (q) =>
        q.eq("locationId", args.locationId).eq("status", "open")
      )
      .collect();

    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
    const allTrucks = await ctx.db.query("trucks").order("desc").take(200);
    const recentClosed = allTrucks.filter(
      (t) =>
        t.locationId === args.locationId &&
        t.status === "closed" &&
        t.closedAt &&
        t.closedAt >= twentyFourHoursAgo
    );

    const combined = [...openTrucks, ...recentClosed];

    const userIds = [...new Set(combined.map((t) => t.openedBy))];
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    const userMap = new Map(userIds.map((id, i) => [id, users[i]]));

    return combined
      .map((truck) => ({
        ...truck,
        openedByName: userMap.get(truck.openedBy)?.name ?? "Unknown",
      }))
      .sort((a, b) => b.openedAt - a.openedAt);
  },
});

export const getReceivingTrucks = query({
  args: {
    locationId: v.string(),
    type: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const filterType = args.type ?? "receiving";
    const openTrucks = await ctx.db
      .query("receivingTrucks")
      .withIndex("by_location_status", (q) =>
        q.eq("locationId", args.locationId).eq("status", "open")
      )
      .collect();

    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recent = await ctx.db
      .query("receivingTrucks")
      .withIndex("by_openedAt")
      .order("desc")
      .take(100);
    const recentClosed = recent.filter(
      (t) =>
        t.locationId === args.locationId &&
        t.status === "closed" &&
        t.openedAt >= twentyFourHoursAgo
    );

    // Filter by type (undefined/null treated as "receiving" for backward compat)
    const typeFiltered = [...openTrucks, ...recentClosed].filter(
      (t) => (t.type ?? "receiving") === filterType
    );

    const userIds = [...new Set(typeFiltered.map((t) => t.openedBy))];
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    const userMap = new Map(userIds.map((id, i) => [id, users[i]]));

    return typeFiltered
      .map((truck) => ({
        ...truck,
        openedByName: userMap.get(truck.openedBy)?.name ?? "Unknown",
      }))
      .sort((a, b) => b.openedAt - a.openedAt);
  },
});

export const getBonusReport = query({
  args: {
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    helperName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const startDate = args.startDate ?? now - 30 * 24 * 60 * 60 * 1000;
    const endDate = args.endDate ?? now;

    // Shipping trucks with bonus data
    const allTrucks = await ctx.db.query("trucks").order("desc").take(500);
    const shippingTrucks = allTrucks
      .filter(
        (t) =>
          t.openedAt >= startDate &&
          t.openedAt <= endDate &&
          !t.archived &&
          (t.status === "open" || t.truckLength || (t.helpers && t.helpers.length > 0))
      )
      .map((t) => {
        // Shipping bonus: $10/person (max 3), all sizes, closed with security tag
        const helpers = t.helpers ?? [];
        const isBonusEligible =
          t.status === "closed" &&
          !!t.securityTag &&
          helpers.length > 0;
        const bonusAmount = isBonusEligible ? 10 * Math.min(helpers.length, 3) : 0;
        return {
          _id: t._id,
          type: "shipping" as const,
          truckNumber: t.truckNumber,
          carrier: t.carrier,
          truckLength: t.truckLength ?? null,
          helpers,
          openedAt: t.openedAt,
          closedAt: t.closedAt ?? null,
          duration: t.closedAt ? t.closedAt - t.openedAt : null,
          status: t.status,
          locationId: t.locationId,
          bonusEarned: isBonusEligible ? true : null,
          bonusAmount,
        };
      });

    // Receiving + Outbound trucks
    const allReceiving = await ctx.db
      .query("receivingTrucks")
      .order("desc")
      .take(500);
    const receivingTrucks = allReceiving
      .filter(
        (t) => t.openedAt >= startDate && t.openedAt <= endDate && !t.archived
      )
      .map((t) => ({
        _id: t._id,
        type: (t.type ?? "receiving") as "receiving" | "outbound",
        truckNumber: t.truckNumber,
        carrier: null,
        truckLength: t.truckLength ?? null,
        helpers: t.helpers,
        openedAt: t.openedAt,
        closedAt: t.closedAt ?? null,
        duration: t.closedAt ? t.closedAt - t.openedAt : null,
        status: t.status,
        locationId: t.locationId,
        bonusEarned: t.bonusEarned ?? null,
        bonusAmount: t.bonusAmount ?? 0,
      }));

    let combined = [...shippingTrucks, ...receivingTrucks].sort(
      (a, b) => b.openedAt - a.openedAt
    );

    // Filter by helper name if provided
    if (args.helperName) {
      const filterName = args.helperName.toLowerCase();
      combined = combined.filter((t) =>
        t.helpers.some((h) => h.toLowerCase() === filterName)
      );
    }

    return combined;
  },
});

export const getKnownHelpers = query({
  args: { locationId: v.string() },
  handler: async (ctx, args) => {
    const helpers = await ctx.db
      .query("knownHelpers")
      .withIndex("by_location", (q) => q.eq("locationId", args.locationId))
      .collect();
    return helpers
      .filter((h) => h.isActive)
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const getPayPeriodBonusSummary = query({
  args: { locationId: v.string() },
  handler: async (ctx, args) => {
    // Bi-weekly pay period anchored at Feb 23, 2025
    const ANCHOR = new Date("2025-02-23T00:00:00").getTime();
    const PERIOD_MS = 14 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // Find current pay period
    const elapsed = now - ANCHOR;
    const periodIndex = Math.floor(elapsed / PERIOD_MS);
    const periodStart = ANCHOR + periodIndex * PERIOD_MS;
    const periodEnd = periodStart + PERIOD_MS;

    // Get shipping trucks in this period
    const allTrucks = await ctx.db.query("trucks").order("desc").take(500);
    const shippingTrucks = allTrucks.filter(
      (t) =>
        t.openedAt >= periodStart &&
        t.openedAt < periodEnd &&
        t.locationId === args.locationId &&
        !t.archived &&
        t.helpers &&
        t.helpers.length > 0
    );

    // Get receiving + outbound trucks in this period
    const allReceiving = await ctx.db
      .query("receivingTrucks")
      .withIndex("by_openedAt")
      .order("desc")
      .take(500);
    const recvTrucks = allReceiving.filter(
      (t) =>
        t.openedAt >= periodStart &&
        t.openedAt < periodEnd &&
        t.locationId === args.locationId &&
        !t.archived
    );

    // Build per-helper summary
    const helperMap: Record<
      string,
      {
        name: string;
        shippingCount: number;
        outboundCount: number;
        receivingCount: number;
        totalAmount: number;
      }
    > = {};

    const getOrCreate = (name: string) => {
      const key = name.toLowerCase();
      if (!helperMap[key]) {
        helperMap[key] = {
          name,
          shippingCount: 0,
          outboundCount: 0,
          receivingCount: 0,
          totalAmount: 0,
        };
      }
      return helperMap[key];
    };

    // Process shipping trucks — $10/person (max 3), all sizes
    for (const t of shippingTrucks) {
      const isBonusEligible =
        t.status === "closed" && !!t.securityTag && t.helpers!.length > 0;
      const eligibleCount = Math.min(t.helpers!.length, 3);
      for (let i = 0; i < t.helpers!.length; i++) {
        const h = t.helpers![i];
        const entry = getOrCreate(h);
        entry.shippingCount++;
        // Only first 3 helpers get the $10 bonus
        if (isBonusEligible && i < 3) {
          entry.totalAmount += 10;
        }
      }
    }

    // Process receiving + outbound trucks
    for (const t of recvTrucks) {
      const truckType = t.type ?? "receiving";
      const bonusEarned = t.bonusEarned === true;
      for (const h of t.helpers) {
        const entry = getOrCreate(h);
        if (truckType === "outbound") {
          entry.outboundCount++;
        } else {
          entry.receivingCount++;
        }
        if (bonusEarned && t.helpers.length > 0) {
          const perPerson = (t.bonusAmount ?? 0) / t.helpers.length;
          entry.totalAmount += perPerson;
        }
      }
    }

    const helpers = Object.values(helperMap).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    return {
      periodStart,
      periodEnd,
      helpers,
    };
  },
});
