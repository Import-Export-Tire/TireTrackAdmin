import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

const BASE44_API_URL = "https://app.base44.com/api/apps/6926084c75b23cb7613a3ee5";
const BASE44_API_KEY = "1331a4731f5a4aca8d6eeea6f7e6090b";

async function base44Fetch(endpoint: string, options: RequestInit = {}) {
  const response = await fetch(`${BASE44_API_URL}${endpoint}`, {
    ...options,
    headers: {
      "api_key": BASE44_API_KEY,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Base44 API error: ${response.status} - ${error}`);
  }

  return response.json();
}

http.route({
  path: "/api/trucks/pending",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const trucks = await ctx.runQuery(api.httpQueries.getUnsyncedTrucks);
    return new Response(JSON.stringify(trucks), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

http.route({
  path: "/api/trucks",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const truckId = url.searchParams.get("id");

    if (truckId) {
      const truck = await ctx.runQuery(api.httpQueries.getTruckWithScans, {
        truckId: truckId as any,
      });
      return new Response(JSON.stringify(truck), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const trucks = await ctx.runQuery(api.httpQueries.getUnsyncedTrucks);
    return new Response(JSON.stringify(trucks), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

http.route({
  path: "/api/trucks/sync",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { truckId } = body;

      if (!truckId) {
        return new Response(JSON.stringify({ error: "truckId required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const truck = await ctx.runQuery(api.httpQueries.getTruckWithScans, {
        truckId: truckId as any,
      });

      if (!truck) {
        return new Response(JSON.stringify({ error: "Truck not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Use existing manifest if available
      let manifestId = truck.base44Id || "";
      
      if (!manifestId) {
        const manifestData = {
          truck_number: truck.truckNumber,
          carrier: truck.carrier,
          status: truck.status,
          location_id: truck.locationId,
          opened_at: new Date(truck.openedAt).toISOString(),
          closed_at: truck.closedAt ? new Date(truck.closedAt).toISOString() : null,
          security_tag: truck.securityTag,
          opened_by: truck.openedByEmpId,
          closed_by: truck.closedByEmpId,
          scan_count: truck.scans.length,
        };

        const manifest = await base44Fetch("/entities/TruckManifest", {
          method: "POST",
          body: JSON.stringify(manifestData),
        });
        manifestId = manifestId;
        
        // Save manifest ID immediately
        await ctx.runMutation(api.mutations.markTruckSynced, {
          truckId: truckId as any,
          base44Id: manifestId,
        });
      }
      
      const manifest = { id: manifestId };

      for (const scan of truck.scans) {
        await base44Fetch("/entities/ShipmentItem", {
          method: "POST",
          body: JSON.stringify({
            truck_session_id: manifestId,
            tracking_number: scan.trackingNumber,
            destination: scan.destination,
            scanned_at: new Date(scan.scannedAt).toISOString(),
          }),
        });
      }

      await ctx.runMutation(api.mutations.markTruckSynced, {
        truckId: truckId as any,
        base44Id: manifestId,
      });

      return new Response(JSON.stringify({ success: true, manifestId: manifest.id }), {
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

http.route({
  path: "/api/users/sync",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const users = await base44Fetch("/entities/AppUser");
      const results = [];

      for (const user of users) {
        const base44Id = user.id || user._id || "base44_" + user.employee_id;
        const empId = user.employee_id || user.emp_id || "";
        const name = user.name || user.full_name || "";
        const pin = user.pin || "0000";
        const locationId = user.location || user.location_id || user.locationId || "";
        const locationName = user.location || user.location_name || user.locationName || "";
        const role = user.role || undefined;

        const userId = await ctx.runMutation(api.mutations.upsertUser, {
          base44Id,
          empId,
          name,
          pin,
          locationId,
          locationName,
          role,
          isActive: user.is_active !== false,
        });
        results.push({ base44Id, userId, success: true });
      }

      return new Response(JSON.stringify({ success: true, synced: results.length, results }), {
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

http.route({
  path: "/api/locations/sync",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const locations = await base44Fetch("/entities/Location");
      const results = [];

      for (const location of locations) {
        const base44Id = location.id || location._id || "";
        const name = location.name || "";
        const code = location.code || location.location_code || location.id || "";

        const locationId = await ctx.runMutation(api.mutations.upsertLocation, {
          base44Id,
          name,
          code,
        });
        results.push({ base44Id, locationId, success: true });
      }

      return new Response(JSON.stringify({ success: true, synced: results.length, results }), {
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
  handler: httpAction(async (ctx) => {
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
  handler: httpAction(async (ctx) => {
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
