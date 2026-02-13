import { internalMutation, mutation } from "./_generated/server";
import { internal } from "./_generated/api";

// Auto-close all open trucks at midnight
export const autoCloseTrucksNightly = internalMutation({
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

    console.log(`[Nightly Auto-Close] Closed ${closed} trucks at ${new Date().toISOString()}`);
    return { closed };
  },
});

// Detect if a scan is a FedEx miscan (scanned 1D barcode instead of 2D)
function isFedExMiscan(trackingNumber: string, rawBarcode: string, carrier?: string): boolean {
  const isFedExTracking =
    /^\d{12,22}$/.test(trackingNumber) ||
    /^(DT|61|96|79|92|93|94)\d+$/.test(trackingNumber) ||
    (carrier?.toLowerCase().includes("fedex") ?? false);

  const has2DFormat =
    rawBarcode.includes("[)>") ||
    rawBarcode.includes("FDEG") ||
    rawBarcode.includes("\x1d") ||
    rawBarcode.includes("\x1e");

  return Boolean(isFedExTracking && !has2DFormat);
}

// One-time migration to detect FedEx miscans
export const detectFedExMiscans = mutation({
  args: {},
  handler: async (ctx) => {
    const scans = await ctx.db.query("scans").collect();
    let updated = 0;
    let detected = 0;

    for (const scan of scans) {
      if (scan.isMiscan === true) continue;

      const raw = scan.rawBarcode || "";
      const trackingNumber = scan.trackingNumber || "";
      const carrier = scan.carrier || "";

      if (isFedExMiscan(trackingNumber, raw, carrier)) {
        await ctx.db.patch(scan._id, { isMiscan: true });
        detected++;
        updated++;
      }
    }

    console.log(`[FedEx Miscan Detection] Detected ${detected} miscans out of ${scans.length} total scans`);
    return { success: true, totalScans: scans.length, miscansDetected: detected, updated };
  },
});

// Health check: count unresolved errors from last 15 minutes, send alert if any
export const checkHealthAndAlert = internalMutation({
  args: {},
  handler: async (ctx) => {
    const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;

    // Get unresolved errors from the last 15 minutes
    const recentErrors = await ctx.db
      .query("errorLogs")
      .withIndex("by_resolved", (q) => q.eq("resolved", false))
      .collect();

    const recentUnresolved = recentErrors.filter(
      (e) => e.timestamp >= fifteenMinutesAgo
    );

    if (recentUnresolved.length === 0) {
      console.log(`[Health Check] No recent errors. All clear.`);
      return { alertSent: false, errorCount: 0 };
    }

    // Schedule the email alert action
    await ctx.scheduler.runAfter(0, internal.actions.sendErrorAlert.sendErrorAlert, {
      errors: recentUnresolved.map((e) => ({
        source: e.source,
        errorType: e.errorType,
        message: e.message,
        details: e.details,
        timestamp: e.timestamp,
      })),
    });

    console.log(`[Health Check] Found ${recentUnresolved.length} recent errors. Alert scheduled.`);
    return { alertSent: true, errorCount: recentUnresolved.length };
  },
});
