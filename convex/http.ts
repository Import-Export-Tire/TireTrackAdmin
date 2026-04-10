import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

// Helper to check migration endpoint auth
function checkMigrationAuth(request: Request): Response | null {
  const authHeader = request.headers.get("Authorization");
  const expectedKey = process.env.MIGRATION_API_KEY;
  if (!expectedKey || !authHeader || authHeader !== `Bearer ${expectedKey}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

http.route({
  path: "/api/health",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(JSON.stringify({ status: "ok", timestamp: Date.now() }), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// Migration endpoint to detect FedEx miscans
http.route({
  path: "/api/migrate/detect-miscans",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authError = checkMigrationAuth(request);
    if (authError) return authError;

    try {
      const scans = await ctx.runQuery(api.queries.getAllScans);
      let updated = 0;
      let detected = 0;

      for (const scan of scans) {
        if (scan.isMiscan === true) continue;

        const raw = scan.rawBarcode || "";
        const trackingNumber = scan.trackingNumber || "";
        const carrier = scan.carrier || "";

        // Check if this looks like a FedEx tracking number
        const isFedExTracking =
          /^\d{12,22}$/.test(trackingNumber) ||
          /^(DT|61|96|79|92|93|94)\d+$/.test(trackingNumber) ||
          carrier?.toLowerCase().includes("fedex");

        // Check if the raw barcode has 2D format markers
        const has2DFormat =
          raw.includes("[)>") ||
          raw.includes("FDEG") ||
          raw.includes("\x1d") ||
          raw.includes("\x1e");

        // If it's a FedEx tracking number but doesn't have 2D format, it's a miscan
        if (isFedExTracking && !has2DFormat) {
          await ctx.runMutation(api.mutations.markScanAsMiscan, {
            scanId: scan._id,
            isMiscan: true,
          });
          detected++;
          updated++;
        }
      }

      return new Response(JSON.stringify({
        success: true,
        totalScans: scans.length,
        miscansDetected: detected,
        updated
      }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
});

// Migration: Backfill vendors on trucks from their scans
http.route({
  path: "/api/migrate/backfill-truck-vendors",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authError = checkMigrationAuth(request);
    if (authError) return authError;

    try {
      const trucks = await ctx.runQuery(api.queries.getAllTrucks);
      let updated = 0;

      for (const truck of trucks) {
        // Get all scans for this truck to extract vendors
        const scans = await ctx.runQuery(api.queries.getTruckScans, {
          truckId: truck._id,
          includeDuplicates: true,
        });

        const vendors = [...new Set(
          scans
            .map((s: any) => s.vendor)
            .filter((v: string | undefined) => v && v !== "Unknown")
        )];

        if (vendors.length > 0 || (truck.vendors?.length ?? 0) === 0) {
          await ctx.runMutation(api.mutations.updateTruckVendors, {
            truckId: truck._id,
            vendors,
          });
          updated++;
        }
      }

      return new Response(JSON.stringify({
        success: true,
        message: `Updated vendors on ${updated} trucks`,
      }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
});

export default http;
