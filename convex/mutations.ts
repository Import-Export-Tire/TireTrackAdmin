import { mutation } from "./_generated/server";
import { v } from "convex/values";

const VENDOR_ACCOUNTS = [
  { account: "12182316", vendor: "Simple Tire" },
  { account: "10476E", vendor: "Simple Tire" },
  { account: "956335570", vendor: "Priority Tires" },
  { account: "699590177", vendor: "Tire Easy" },
  { account: "4475664", vendor: "Fastlane" },
  { account: "693242410", vendor: "United Tires" },
  { account: "9556328", vendor: "Autoplicity" },
  { account: "200733892", vendor: "Tire Depot Co" },
  { account: "9791484", vendor: "Tire Agent" },
  { account: "8016150", vendor: "Atturo Tires" },
  { account: "9943973", vendor: "Huantian" },
  { account: "208536660", vendor: "WTD" },
  { account: "9785933", vendor: "WTD" },
  { account: "878898850", vendor: "WTD" },
  { account: "200729671", vendor: "WTD" },
  { account: "7655055", vendor: "WTD" },
  { account: "9598934", vendor: "Turn 5" },
  { account: "XH0456", vendor: "Amazon" },
  { account: "0J469X", vendor: "WTD" },
];

export const openTruck = mutation({
  args: {
    truckNumber: v.string(),
    carrier: v.string(),
    locationId: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Auto-detect carrier from truck number
    const carrier = /ups/i.test(args.truckNumber) ? "UPS" : args.carrier;
    const truckId = await ctx.db.insert("trucks", {
      truckNumber: args.truckNumber,
      carrier,
      status: "open",
      locationId: args.locationId,
      openedBy: args.userId,
      openedAt: Date.now(),
    });
    return { success: true, truckId };
  },
});

// Helper to detect FedEx miscans (scanned 1D barcode instead of 2D)
function detectFedExMiscan(trackingNumber: string, rawBarcode: string, carrier?: string): boolean {
  // FedEx tracking numbers typically:
  // - Ground/Home: 12-22 digits, often starting with specific patterns
  // - Express: 12 digits
  // - SmartPost: 22 digits (often starts with 92, 93, 94)

  const isFedExTracking =
    /^\d{12,22}$/.test(trackingNumber) || // Pure numeric FedEx tracking
    /^(DT|61|96|79|92|93|94)\d+$/.test(trackingNumber) || // FedEx patterns
    (carrier?.toLowerCase().includes("fedex") ?? false);

  // Check if the rawBarcode has proper 2D FedEx format (contains delimiters and account info)
  const has2DFormat =
    rawBarcode.includes("[)>") || // GS1-128 format header
    rawBarcode.includes("FDEG") || // FedEx Ground marker
    rawBarcode.includes("\x1d") || // GS (Group Separator) character - indicates 2D
    rawBarcode.includes("\x1e"); // RS (Record Separator) character

  // If it looks like FedEx but doesn't have 2D format = miscan (they scanned wrong barcode)
  return Boolean(isFedExTracking && !has2DFormat);
}

// Helper to check if barcode has valid 2D format (not a miscan)
function hasValid2DFormat(rawBarcode: string): boolean {
  return (
    rawBarcode.includes("[)>") || // GS1-128 format header
    rawBarcode.includes("FDEG") || // FedEx Ground marker
    rawBarcode.includes("\x1d") || // GS (Group Separator) character
    rawBarcode.includes("\x1e") // RS (Record Separator) character
  );
}

// Helper to extract potential account number from rawBarcode for pattern grouping
function extractPotentialAccountNumber(rawBarcode: string): string | undefined {
  // Look for 7-9 digit numbers in the barcode that could be vendor account numbers
  const matches = rawBarcode.match(/\d{7,9}/g);
  if (!matches || matches.length === 0) return undefined;

  // Return the first match that isn't the tracking number (typically longer)
  // Account numbers are usually shorter than tracking numbers
  for (const match of matches) {
    // Skip if it looks like a tracking number (12+ digits would be caught by the match anyway)
    // Return the first 7-9 digit number found
    return match;
  }
  return undefined;
}

export const addScan = mutation({
  args: {
    truckId: v.id("trucks"),
    trackingNumber: v.string(),
    carrier: v.optional(v.string()),
    destination: v.string(),
    recipientName: v.optional(v.string()),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    rawBarcode: v.string(),
    userId: v.id("users"),
    scanType: v.optional(v.string()),
    forceCrossTruckMove: v.optional(v.boolean()),
    movedFromScanId: v.optional(v.id("scans")),
  },
  handler: async (ctx, args) => {
    // Cross-truck duplicate check: was this tracking number scanned on another OPEN truck?
    // Only checks open trucks — closed trucks are no longer relevant
    if (!args.forceCrossTruckMove) {
      const existingScans = await ctx.db
        .query("scans")
        .withIndex("by_tracking", (q) => q.eq("trackingNumber", args.trackingNumber))
        .collect();

      const otherTruckScans = existingScans.filter(
        (scan) => scan.truckId !== args.truckId && !scan.isDuplicate
      );

      // Only flag if the other truck is still open
      for (const scan of otherTruckScans) {
        const otherTruck = await ctx.db.get(scan.truckId);
        if (otherTruck && otherTruck.status === "open") {
          return {
            needsCrossTruckConfirmation: true as const,
            existingScanId: scan._id,
            existingTruckNumber: otherTruck.truckNumber || "Unknown",
            existingTruckId: scan.truckId,
            existingScannedAt: scan.scannedAt,
          };
        }
      }
    }

    let vendor = "Unknown";
    let vendorAccount = "";
    const raw = args.rawBarcode || "";

    // Server-side UPS tracking correction: old clients send routing codes (96...)
    // as tracking numbers. Re-extract the 1Z from the raw barcode for uniqueness.
    let correctedTracking = args.trackingNumber;
    if (/upsn/i.test(raw)) {
      const match1Z = raw.match(/(?<!\d)1Z([A-Z0-9]+)/i);
      if (match1Z) {
        let raw1Z = match1Z[1].toUpperCase();
        const markerIdx = raw1Z.indexOf("UPSN");
        if (markerIdx > 0) raw1Z = raw1Z.substring(0, markerIdx);
        if (raw1Z.length >= 16) {
          // Full 1Z tracking
          correctedTracking = "1Z" + raw1Z.substring(0, 16);
        } else {
          // Truncated 1Z — use as-is (still unique per shipper)
          correctedTracking = "1Z" + raw1Z;
        }
      }
    }

    for (const va of VENDOR_ACCOUNTS) {
      if (raw.includes(va.account)) {
        vendor = va.vendor;
        vendorAccount = va.account;
        break;
      }
    }

    // Vendor context inheritance: if vendor is still Unknown on a valid 2D scan,
    // inherit from a recent scan on the same truck (within 30s, same state)
    if (vendor === "Unknown" && hasValid2DFormat(raw)) {
      const thirtySecondsAgo = Date.now() - 30000;
      const recentScans = await ctx.db
        .query("scans")
        .withIndex("by_truck", (q) => q.eq("truckId", args.truckId))
        .order("desc")
        .take(5);

      for (const recent of recentScans) {
        if (
          recent.scannedAt >= thirtySecondsAgo &&
          recent.vendor &&
          recent.vendor !== "Unknown" &&
          args.state && recent.state && args.state === recent.state
        ) {
          vendor = recent.vendor;
          vendorAccount = recent.vendorAccount || "";
          break;
        }
      }
    }

    // Auto-detect FedEx miscans (scanned 1D instead of 2D barcode)
    const isMiscan = detectFedExMiscan(args.trackingNumber, raw, args.carrier);

    // Detect "No Vendor Known" - valid 2D scan but no vendor match
    // Only mark as noVendorKnown if it's NOT a miscan (valid 2D format) and vendor is still Unknown
    const isValid2D = hasValid2DFormat(raw);
    const noVendorKnown = !isMiscan && isValid2D && vendor === "Unknown";

    // Extract potential account number for pattern grouping (only if noVendorKnown)
    const potentialAccountNumber = noVendorKnown ? extractPotentialAccountNumber(raw) : undefined;

    // Get the truck for carrier fallback and mismatch detection
    const truck = await ctx.db.get(args.truckId);

    // Server-side carrier correction: FedEx 2D barcodes contain FDEG/FDEX markers.
    // Older clients may misparse these as UPS due to field codes like 31Z containing "1Z".
    let correctedCarrier = args.carrier;
    if (raw.includes("FDEG") || raw.includes("FDEX")) {
      correctedCarrier = "FedEx";
    } else if (/upsn/i.test(raw)) {
      correctedCarrier = "UPS";
    }

    // Fall back to the truck's carrier if the barcode parser returned Unknown/empty
    const scanCarrier = (!correctedCarrier || correctedCarrier === "Unknown" || correctedCarrier === "Unrecognized")
      ? truck?.carrier
      : correctedCarrier;

    // Detect carrier mismatch: package carrier differs from truck carrier
    const carrierMismatch = !!(
      correctedCarrier &&
      correctedCarrier !== "Unknown" &&
      correctedCarrier !== "Unrecognized" &&
      truck?.carrier &&
      !correctedCarrier.toLowerCase().includes(truck.carrier.toLowerCase()) &&
      !truck.carrier.toLowerCase().includes(correctedCarrier.toLowerCase())
    );

    const scanId = await ctx.db.insert("scans", {
      truckId: args.truckId,
      trackingNumber: correctedTracking,
      carrier: scanCarrier,
      destination: args.destination,
      recipientName: args.recipientName,
      address: args.address,
      city: args.city,
      state: args.state,
      rawBarcode: args.rawBarcode,
      scannedBy: args.userId,
      scannedAt: Date.now(),
      scanType: args.scanType || "auto",
      vendor,
      vendorAccount,
      isMiscan,
      noVendorKnown,
      potentialAccountNumber,
      ...(carrierMismatch && { carrierMismatch }),
      // Cross-truck move tracking
      ...(args.forceCrossTruckMove && args.movedFromScanId && {
        movedFromTruckId: (await ctx.db.get(args.movedFromScanId))?.truckId,
        movedFromScanId: args.movedFromScanId,
      }),
    });
    // Update truck's scanCount and vendors list efficiently
    if (truck) {
      const newScanCount = (truck.scanCount ?? 0) + 1;
      const currentVendors = truck.vendors ?? [];
      // Add vendor to list if not already present
      const newVendors = vendor && !currentVendors.includes(vendor)
        ? [...currentVendors, vendor]
        : currentVendors;
      await ctx.db.patch(args.truckId, {
        scanCount: newScanCount,
        vendors: newVendors,
      });
    }
    return { success: true as const, scanId };
  },
});

export const closeTruck = mutation({
  args: {
    truckId: v.id("trucks"),
    userId: v.id("users"),
    securityTag: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.truckId, {
      status: "closed",
      closedAt: Date.now(),
      closedBy: args.userId,
      securityTag: args.securityTag,
    });
    return { success: true };
  },
});

export const openReturnBatch = mutation({
  args: {
    locationId: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const batchNumber = `RET-${Date.now()}`;
    const batchId = await ctx.db.insert("returnBatches", {
      batchNumber,
      status: "open",
      locationId: args.locationId,
      openedBy: args.userId,
      openedAt: Date.now(),
      itemCount: 0,
    });
    return { success: true, batchId, batchNumber };
  },
});

export const addReturnItem = mutation({
  args: {
    batchId: v.id("returnBatches"),
    userId: v.id("users"),
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
    partNumber: v.optional(v.string()),
    quantity: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) {
      return { success: false, error: "Batch not found" };
    }

    // Auto-fill tire info from UPC lookup if UPC provided and tire info missing
    let tireBrand = args.tireBrand;
    let tireModel = args.tireModel;
    let tireSize = args.tireSize;
    let tirePartNumber = args.partNumber;
    if (args.upcCode && (!tireBrand || !tireModel || !tireSize)) {
      // Try direct UPC match first
      let upcMatch = await ctx.db
        .query("tireUPCs")
        .withIndex("by_upc", (q) => q.eq("upc", args.upcCode!))
        .first();

      // If no UPC match, try inventory number (scanned barcode may be
      // an inventory# with a check digit appended — strip last digit)
      if (!upcMatch && args.upcCode!.length >= 5 && args.upcCode!.length <= 8) {
        const possibleInv = args.upcCode!.slice(0, -1);
        upcMatch = await ctx.db
          .query("tireUPCs")
          .withIndex("by_inventoryNumber", (q) => q.eq("inventoryNumber", possibleInv))
          .first();
      }

      if (upcMatch) {
        tireBrand = tireBrand || upcMatch.brand;
        tireModel = tireModel || upcMatch.model;
        tireSize = tireSize || upcMatch.size;
        tirePartNumber = tirePartNumber || upcMatch.inventoryNumber;
      }
    }

    const itemId = await ctx.db.insert("returnItems", {
      returnBatchId: args.batchId,
      poNumber: args.poNumber,
      invNumber: args.invNumber,
      partNumber: tirePartNumber,
      tirePartNumber: tirePartNumber,
      fromAddress: args.fromAddress,
      imageUrl: args.imageUrl,
      rawText: args.rawText,
      aiConfidence: args.aiConfidence,
      upcCode: args.upcCode,
      tireBrand,
      tireModel,
      tireSize,
      quantity: args.quantity || 1,
      scannedBy: args.userId,
      scannedAt: Date.now(),
      status: "pending",
    });
    await ctx.db.patch(args.batchId, {
      itemCount: batch.itemCount + (args.quantity || 1),
    });
    return { success: true, itemId };
  },
});

export const closeReturnBatch = mutation({
  args: {
    batchId: v.id("returnBatches"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.batchId, {
      status: "closed",
      closedAt: Date.now(),
      closedBy: args.userId,
    });
    return { success: true };
  },
});

export const bulkInsertTireUPCs = mutation({
  args: {
    tires: v.array(v.object({
      upc: v.string(),
      brand: v.string(),
      model: v.string(),
      size: v.string(),
      inventoryNumber: v.optional(v.string()),
      auctionTitle: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    for (const tire of args.tires) {
      const existing = await ctx.db
        .query("tireUPCs")
        .withIndex("by_upc", (q) => q.eq("upc", tire.upc))
        .first();
      if (!existing) {
        await ctx.db.insert("tireUPCs", tire);
        inserted++;
      }
    }
    return { inserted, total: args.tires.length };
  },
});

export const backfillVendors = mutation({
  args: {
    detectMiscans: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Only query scans with Unknown vendor to avoid hitting byte limits
    const scans = await ctx.db.query("scans").withIndex("by_vendor", (q) => q.eq("vendor", "Unknown")).collect();
    let updated = 0;
    let miscansDetected = 0;
    for (const scan of scans) {
      const raw = scan.rawBarcode || "";
      const trackingNumber = scan.trackingNumber || "";
      const carrier = scan.carrier || "";
      let vendor = "Unknown";
      let vendorAccount = "";
      let shouldUpdate = false;

      // Match vendor accounts
      for (const va of VENDOR_ACCOUNTS) {
        if (raw.includes(va.account)) {
          vendor = va.vendor;
          vendorAccount = va.account;
          break;
        }
      }
      if (vendor !== "Unknown" && scan.vendor !== vendor) {
        shouldUpdate = true;
      }

      // Detect FedEx miscans if requested
      let isMiscan = scan.isMiscan;
      if (args.detectMiscans && !scan.isMiscan) {
        const isFedExTracking =
          /^\d{12,22}$/.test(trackingNumber) ||
          /^(DT|61|96|79|92|93|94)\d+$/.test(trackingNumber) ||
          (carrier?.toLowerCase().includes("fedex") ?? false);

        const has2DFormat =
          raw.includes("[)>") ||
          raw.includes("FDEG") ||
          raw.includes("\x1d") ||
          raw.includes("\x1e");

        if (isFedExTracking && !has2DFormat) {
          isMiscan = true;
          miscansDetected++;
          shouldUpdate = true;
        }
      }

      if (shouldUpdate) {
        await ctx.db.patch(scan._id, {
          ...(vendor !== "Unknown" && { vendor, vendorAccount }),
          ...(isMiscan !== undefined && { isMiscan }),
        });
        updated++;
      }
    }
    return { updated, total: scans.length, miscansDetected };
  },
});

// Backfill carrier on scans from the past N days:
// 1. If rawBarcode contains UPSN or 1Z → carrier = "UPS"
// 2. If rawBarcode contains FDEG or FDEX → carrier = "FedEx"
// 3. Otherwise fall back to the truck's carrier
export const backfillCarriers = mutation({
  args: { daysBack: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const daysBack = args.daysBack ?? 7;
    const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

    const scans = await ctx.db
      .query("scans")
      .withIndex("by_scannedAt", (q) => q.gte("scannedAt", cutoff))
      .collect();

    // Cache truck carriers to avoid repeated lookups
    const truckCarriers = new Map<string, string>();

    let updated = 0;
    let upsFixed = 0;
    let fedexFixed = 0;
    let truckFallback = 0;

    for (const scan of scans) {
      if (scan.carrier && scan.carrier !== "Unknown") continue;

      const raw = scan.rawBarcode || "";
      let newCarrier: string | null = null;

      // Detect UPS from barcode markers
      if (raw.includes("UPSN") || raw.includes("1Z")) {
        newCarrier = "UPS";
        upsFixed++;
      }
      // Detect FedEx from barcode markers
      else if (raw.includes("FDEG") || raw.includes("FDEX")) {
        newCarrier = "FedEx";
        fedexFixed++;
      }
      // Fall back to truck carrier
      else {
        let truckCarrier = truckCarriers.get(scan.truckId);
        if (truckCarrier === undefined) {
          const truck = await ctx.db.get(scan.truckId);
          truckCarrier = truck?.carrier || "";
          truckCarriers.set(scan.truckId, truckCarrier);
        }
        if (truckCarrier) {
          newCarrier = truckCarrier;
          truckFallback++;
        }
      }

      if (newCarrier) {
        await ctx.db.patch(scan._id, { carrier: newCarrier });
        updated++;
      }
    }

    return {
      total: scans.length,
      alreadyHadCarrier: scans.length - updated - scans.filter(s => !s.carrier || s.carrier === "Unknown").length + updated,
      updated,
      upsFixed,
      fedexFixed,
      truckFallback,
    };
  },
});

export const analyzeVendorAccounts = mutation({
  args: {},
  handler: async (ctx) => {
    const scans = await ctx.db.query("scans").collect();
    const accountCounts: Record<string, number> = {};
    for (const scan of scans) {
      const raw = scan.rawBarcode || "";
      const matches = raw.match(/\d{7,9}/g) || [];
      for (const match of matches) {
        if (!accountCounts[match]) accountCounts[match] = 0;
        accountCounts[match]++;
      }
    }
    const sorted = Object.entries(accountCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([account, count]) => ({ account, count }));
    return sorted;
  },
});
export const deleteTruck = mutation({
  args: { truckId: v.id("trucks") },
  handler: async (ctx, args) => {
    // Delete all scans for this truck first
    const scans = await ctx.db
      .query("scans")
      .withIndex("by_truck", (q) => q.eq("truckId", args.truckId))
      .collect();
    
    for (const scan of scans) {
      await ctx.db.delete(scan._id);
    }
    
    // Delete the truck
    await ctx.db.delete(args.truckId);
    
    return { deleted: true, scansRemoved: scans.length };
  },
});

export const updateUser = mutation({
  args: {
    userId: v.id("users"),
    name: v.optional(v.string()),
    pin: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    role: v.optional(v.string()),
    locationId: v.optional(v.string()),
    locationName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined)
    );
    await ctx.db.patch(userId, filteredUpdates);
    return { success: true };
  },
});

export const deleteUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.userId);
    return { success: true };
  },
});

export const batchImportUPCs = mutation({
  args: {
    upcs: v.array(v.object({
      upc: v.string(),
      brand: v.string(),
      model: v.string(),
      size: v.string(),
      inventoryNumber: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    let skipped = 0;
    
    for (const tire of args.upcs) {
      // Skip if UPC already exists
      const existing = await ctx.db
        .query("tireUPCs")
        .withIndex("by_upc", (q) => q.eq("upc", tire.upc))
        .first();
      
      if (existing) {
        skipped++;
        continue;
      }
      
      await ctx.db.insert("tireUPCs", {
        upc: tire.upc,
        brand: tire.brand,
        model: tire.model,
        size: tire.size,
        inventoryNumber: tire.inventoryNumber,
      });
      inserted++;
    }
    
    return { inserted, skipped };
  },
});

export const addSingleUPC = mutation({
  args: {
    upc: v.string(),
    brand: v.string(),
    model: v.string(),
    size: v.string(),
    inventoryNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("tireUPCs")
      .withIndex("by_upc", (q) => q.eq("upc", args.upc))
      .first();
    
    if (existing) {
      return { success: false, error: "UPC already exists" };
    }
    
    const id = await ctx.db.insert("tireUPCs", args);
    return { success: true, id };
  },
});

export const updateUPC = mutation({
  args: {
    id: v.id("tireUPCs"),
    upc: v.optional(v.string()),
    brand: v.optional(v.string()),
    model: v.optional(v.string()),
    size: v.optional(v.string()),
    inventoryNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined)
    );
    await ctx.db.patch(id, filteredUpdates);
    return { success: true };
  },
});

export const deleteUPC = mutation({
  args: { id: v.id("tireUPCs") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return { success: true };
  },
});

export const updateReturnItemStatus = mutation({
  args: {
    itemId: v.id("returnItems"),
    status: v.union(v.literal("pending"), v.literal("processed"), v.literal("not_processed")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.itemId, {
      status: args.status,
      ...(args.notes !== undefined && { notes: args.notes }),
    });
    return { success: true };
  },
});

export const updateReturnItem = mutation({
  args: {
    itemId: v.id("returnItems"),
    poNumber: v.optional(v.string()),
    invNumber: v.optional(v.string()),
    partNumber: v.optional(v.string()),
    tireBrand: v.optional(v.string()),
    tireModel: v.optional(v.string()),
    tireSize: v.optional(v.string()),
    tirePartNumber: v.optional(v.string()),
    quantity: v.optional(v.number()),
    status: v.optional(v.union(v.literal("pending"), v.literal("processed"), v.literal("not_processed"))),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { itemId, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined)
    );

    // Sync batch itemCount when quantity changes
    if (args.quantity !== undefined) {
      const item = await ctx.db.get(itemId);
      if (item) {
        const oldQty = item.quantity || 1;
        const diff = args.quantity - oldQty;
        if (diff !== 0) {
          const batch = await ctx.db.get(item.returnBatchId);
          if (batch) {
            await ctx.db.patch(item.returnBatchId, {
              itemCount: Math.max(0, batch.itemCount + diff),
            });
          }
        }
      }
    }

    await ctx.db.patch(itemId, filteredUpdates);
    return { success: true };
  },
});

export const deleteReturnItem = mutation({
  args: { itemId: v.id("returnItems") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (item) {
      const batch = await ctx.db.get(item.returnBatchId);
      if (batch) {
        await ctx.db.patch(item.returnBatchId, {
          itemCount: Math.max(0, batch.itemCount - (item.quantity || 1)),
        });
      }
    }
    await ctx.db.delete(args.itemId);
    return { success: true };
  },
});

export const deleteReturnBatch = mutation({
  args: { batchId: v.id("returnBatches") },
  handler: async (ctx, args) => {
    // Delete all items in the batch first
    const items = await ctx.db
      .query("returnItems")
      .withIndex("by_batch", (q) => q.eq("returnBatchId", args.batchId))
      .collect();
    
    for (const item of items) {
      await ctx.db.delete(item._id);
    }
    
    // Delete the batch
    await ctx.db.delete(args.batchId);
    return { success: true, deletedItems: items.length };
  },
});

export const createAppUser = mutation({
  args: {
    empId: v.string(),
    name: v.string(),
    pin: v.string(),
    locationId: v.string(),
    locationName: v.string(),
    role: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check if empId already exists
    const existing = await ctx.db
      .query("users")
      .withIndex("by_empId", (q) => q.eq("empId", args.empId))
      .first();
    
    if (existing) {
      return { success: false, error: "Employee ID already exists" };
    }
    
    const userId = await ctx.db.insert("users", {
      base44Id: `local_${Date.now()}`,
      empId: args.empId,
      name: args.name,
      pin: args.pin,
      locationId: args.locationId,
      locationName: args.locationName,
      role: args.role || "user",
      isActive: true,
    });

    return { success: true, userId };
  },
});

// Admin close truck (no user/security tag required)
export const adminCloseTruck = mutation({
  args: { truckId: v.id("trucks") },
  handler: async (ctx, args) => {
    const truck = await ctx.db.get(args.truckId);
    if (!truck) {
      return { success: false, error: "Truck not found" };
    }
    if (truck.status === "closed") {
      return { success: false, error: "Truck already closed" };
    }
    await ctx.db.patch(args.truckId, {
      status: "closed",
      closedAt: Date.now(),
    });
    return { success: true };
  },
});

// Auto-close all open trucks (for nightly batch)
export const autoCloseAllTrucks = mutation({
  args: {},
  handler: async (ctx) => {
    const openTrucks = await ctx.db
      .query("trucks")
      .filter((q) => q.eq(q.field("status"), "open"))
      .collect();

    let closed = 0;
    for (const truck of openTrucks) {
      await ctx.db.patch(truck._id, {
        status: "closed",
        closedAt: Date.now(),
      });
      closed++;
    }
    return { success: true, closed };
  },
});

// Migration: Normalize all truck locationIds to lowercase "latrobe" and fill empty ones
export const normalizeTruckLocations = mutation({
  args: {},
  handler: async (ctx) => {
    const trucks = await ctx.db.query("trucks").collect();
    let updated = 0;

    for (const truck of trucks) {
      const currentLocation = truck.locationId || "";
      const normalizedLocation = currentLocation.toLowerCase() || "latrobe";

      if (currentLocation !== normalizedLocation) {
        await ctx.db.patch(truck._id, { locationId: normalizedLocation });
        updated++;
      }
    }

    return { success: true, updated, total: trucks.length };
  },
});

// Mark a scan as miscan
export const markScanAsMiscan = mutation({
  args: {
    scanId: v.id("scans"),
    isMiscan: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.scanId, { isMiscan: args.isMiscan });
    return { success: true };
  },
});

// Mark a scan as "No Vendor Known"
export const markScanAsNoVendorKnown = mutation({
  args: {
    scanId: v.id("scans"),
    noVendorKnown: v.boolean(),
  },
  handler: async (ctx, args) => {
    // If marking as noVendorKnown, extract potential account number
    if (args.noVendorKnown) {
      const scan = await ctx.db.get(args.scanId);
      if (scan) {
        const potentialAccountNumber = extractPotentialAccountNumber(scan.rawBarcode || "");
        await ctx.db.patch(args.scanId, {
          noVendorKnown: true,
          potentialAccountNumber,
        });
      }
    } else {
      await ctx.db.patch(args.scanId, {
        noVendorKnown: false,
        potentialAccountNumber: undefined,
      });
    }
    return { success: true };
  },
});

// Backfill noVendorKnown for existing scans
export const backfillNoVendorKnown = mutation({
  args: {},
  handler: async (ctx) => {
    const scans = await ctx.db.query("scans").collect();
    let updated = 0;
    let detected = 0;

    for (const scan of scans) {
      // Skip if already marked or if it's a miscan
      if (scan.noVendorKnown === true || scan.isMiscan === true) continue;

      const raw = scan.rawBarcode || "";
      const vendor = scan.vendor || "Unknown";

      // Check if this has valid 2D format
      const has2DFormat =
        raw.includes("[)>") ||
        raw.includes("FDEG") ||
        raw.includes("\x1d") ||
        raw.includes("\x1e");

      // If valid 2D but vendor is Unknown, mark as noVendorKnown
      if (has2DFormat && vendor === "Unknown") {
        const potentialAccountNumber = extractPotentialAccountNumber(raw);
        await ctx.db.patch(scan._id, {
          noVendorKnown: true,
          potentialAccountNumber,
        });
        detected++;
        updated++;
      }
    }

    return {
      success: true,
      total: scans.length,
      detected,
      updated,
    };
  },
});

// Backfill auto-detect miscans for existing FedEx scans
export const backfillFedExMiscans = mutation({
  args: {},
  handler: async (ctx) => {
    const scans = await ctx.db.query("scans").collect();
    let updated = 0;
    let detected = 0;

    for (const scan of scans) {
      // Skip if already marked as miscan manually
      if (scan.isMiscan === true) continue;

      const raw = scan.rawBarcode || "";
      const trackingNumber = scan.trackingNumber || "";
      const carrier = scan.carrier || "";

      // Check if this is a FedEx miscan
      const isFedExTracking =
        /^\d{12,22}$/.test(trackingNumber) ||
        /^(DT|61|96|79|92|93|94)\d+$/.test(trackingNumber) ||
        carrier.toLowerCase().includes("fedex");

      const has2DFormat =
        raw.includes("[)>") ||
        raw.includes("FDEG") ||
        raw.includes("\x1d") ||
        raw.includes("\x1e");

      const shouldBeMiscan = isFedExTracking && !has2DFormat;

      if (shouldBeMiscan && !scan.isMiscan) {
        await ctx.db.patch(scan._id, { isMiscan: true });
        updated++;
        detected++;
      }
    }

    return {
      success: true,
      total: scans.length,
      detected,
      updated,
    };
  },
});

// Backfill return items with correct tire data from tireUPCs table
export const backfillReturnItemsTireData = mutation({
  args: {},
  handler: async (ctx) => {
    const returnItems = await ctx.db.query("returnItems").collect();
    let updated = 0;
    let notFound = 0;
    let noUpc = 0;

    for (const item of returnItems) {
      if (!item.upcCode) {
        noUpc++;
        continue;
      }

      // Look up the tire in tireUPCs by UPC first, then by inventory number
      let tire = await ctx.db
        .query("tireUPCs")
        .withIndex("by_upc", (q) => q.eq("upc", item.upcCode!))
        .first();

      // If no UPC match, try inventory number (strip check digit)
      if (!tire && item.upcCode!.length >= 5 && item.upcCode!.length <= 8) {
        const possibleInv = item.upcCode!.slice(0, -1);
        tire = await ctx.db
          .query("tireUPCs")
          .withIndex("by_inventoryNumber", (q) => q.eq("inventoryNumber", possibleInv))
          .first();
      }

      if (tire) {
        // Update with correct data from tireUPCs
        await ctx.db.patch(item._id, {
          tireBrand: tire.brand,
          tireModel: tire.model,
          tireSize: tire.size,
          tirePartNumber: tire.inventoryNumber || undefined,
        });
        updated++;
      } else {
        notFound++;
      }
    }

    return {
      success: true,
      total: returnItems.length,
      updated,
      notFound,
      noUpc,
    };
  },
});

// Update truck vendors (for migration/backfill)
export const updateTruckVendors = mutation({
  args: {
    truckId: v.id("trucks"),
    vendors: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.truckId, { vendors: args.vendors });
  },
});

// Archive old trucks and return batches
// Log an error to the errorLogs table
export const logError = mutation({
  args: {
    source: v.string(),
    errorType: v.string(),
    message: v.string(),
    details: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    locationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const errorId = await ctx.db.insert("errorLogs", {
      source: args.source,
      errorType: args.errorType,
      message: args.message,
      details: args.details,
      userId: args.userId,
      locationId: args.locationId,
      timestamp: Date.now(),
      resolved: false,
    });
    return { success: true, errorId };
  },
});

// Resolve an error log entry
export const resolveError = mutation({
  args: { errorId: v.id("errorLogs") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.errorId, { resolved: true });
    return { success: true };
  },
});

// Resolve all unresolved errors
export const resolveAllErrors = mutation({
  args: {},
  handler: async (ctx) => {
    const unresolved = await ctx.db
      .query("errorLogs")
      .withIndex("by_resolved", (q) => q.eq("resolved", false))
      .collect();
    for (const error of unresolved) {
      await ctx.db.patch(error._id, { resolved: true });
    }
    return { success: true, resolved: unresolved.length };
  },
});

export const archiveOldRecords = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

    // Archive trucks older than 30 days
    const oldTrucks = await ctx.db
      .query("trucks")
      .filter((q) =>
        q.and(
          q.lt(q.field("openedAt"), thirtyDaysAgo),
          q.or(
            q.eq(q.field("archived"), undefined),
            q.eq(q.field("archived"), false)
          )
        )
      )
      .collect();

    let trucksArchived = 0;
    for (const truck of oldTrucks) {
      await ctx.db.patch(truck._id, { archived: true, archivedAt: now });
      trucksArchived++;
    }

    // Archive return batches closed more than 30 days ago
    const oldBatches = await ctx.db
      .query("returnBatches")
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "closed"),
          q.neq(q.field("closedAt"), undefined),
          q.lt(q.field("closedAt"), thirtyDaysAgo),
          q.or(
            q.eq(q.field("archived"), undefined),
            q.eq(q.field("archived"), false)
          )
        )
      )
      .collect();

    let batchesArchived = 0;
    for (const batch of oldBatches) {
      await ctx.db.patch(batch._id, { archived: true, archivedAt: now });
      batchesArchived++;
    }

    return {
      trucksArchived,
      batchesArchived,
      timestamp: now,
    };
  },
});

// ==================== BONUS TRACKER ====================

export const updateTruckBonusInfo = mutation({
  args: {
    truckId: v.id("trucks"),
    truckLength: v.optional(v.string()),
    helpers: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, any> = {};
    if (args.truckLength !== undefined) updates.truckLength = args.truckLength;
    if (args.helpers !== undefined) updates.helpers = args.helpers;
    await ctx.db.patch(args.truckId, updates);
    return { success: true };
  },
});

export const openReceivingTruck = mutation({
  args: {
    truckNumber: v.string(),
    helpers: v.array(v.string()),
    locationId: v.string(),
    userId: v.id("users"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("receivingTrucks", {
      truckNumber: args.truckNumber,
      helpers: args.helpers,
      status: "open",
      locationId: args.locationId,
      openedBy: args.userId,
      openedAt: Date.now(),
      notes: args.notes,
    });
    return { success: true, receivingTruckId: id };
  },
});

export const closeReceivingTruck = mutation({
  args: {
    receivingTruckId: v.id("receivingTrucks"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const truck = await ctx.db.get(args.receivingTruckId);
    if (!truck) return { success: false, error: "Not found" };

    const now = Date.now();
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    const bonusEarned = (now - truck.openedAt) <= TWO_HOURS;

    await ctx.db.patch(args.receivingTruckId, {
      status: "closed",
      closedAt: now,
      closedBy: args.userId,
      bonusEarned,
    });
    return { success: true, bonusEarned };
  },
});

export const updateReceivingTruck = mutation({
  args: {
    receivingTruckId: v.id("receivingTrucks"),
    helpers: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, any> = {};
    if (args.helpers !== undefined) updates.helpers = args.helpers;
    if (args.notes !== undefined) updates.notes = args.notes;
    await ctx.db.patch(args.receivingTruckId, updates);
    return { success: true };
  },
});

export const deleteBonusEntry = mutation({
  args: {
    entryId: v.string(),
    type: v.union(v.literal("shipping"), v.literal("receiving")),
  },
  handler: async (ctx, args) => {
    if (args.type === "shipping") {
      await ctx.db.patch(args.entryId as any, {
        helpers: [],
        truckLength: undefined,
      });
    } else {
      await ctx.db.patch(args.entryId as any, {
        archived: true,
        archivedAt: Date.now(),
      });
    }
    return { success: true };
  },
});

export const overrideReceivingBonus = mutation({
  args: {
    receivingTruckId: v.id("receivingTrucks"),
    bonusEarned: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.receivingTruckId, {
      bonusEarned: args.bonusEarned,
    });
    return { success: true };
  },
});
