"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

export const sendDailyManifestEmail = internalAction({
  args: {},
  handler: async (ctx) => {
    // Calculate previous day's date range (midnight-to-midnight Eastern)
    // Uses Intl API to handle EST/EDT automatically
    const now = new Date();
    const eastern = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now);
    const etYear = Number(eastern.find(p => p.type === "year")!.value);
    const etMonth = Number(eastern.find(p => p.type === "month")!.value) - 1;
    const etDay = Number(eastern.find(p => p.type === "day")!.value);

    // Build today midnight and yesterday midnight in Eastern, then convert to UTC
    // by finding the UTC time that corresponds to midnight Eastern
    const todayMidnightET = new Date(
      new Date(etYear, etMonth, etDay).toLocaleString("en-US", { timeZone: "America/New_York" })
    );
    // Use a reliable approach: compute offset by comparing formatted date parts
    const utcMidnightGuess = new Date(Date.UTC(etYear, etMonth, etDay));
    // Determine the actual UTC offset for Eastern at this date
    const etOffsetMs = (() => {
      const jan = new Date(etYear, 0, 1).getTimezoneOffset();
      const jul = new Date(etYear, 6, 1).getTimezoneOffset();
      // Use the formatted date to determine if we're in DST
      const formatted = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        timeZoneName: "short",
      }).format(now);
      const isDST = formatted.includes("EDT");
      return isDST ? 4 * 60 * 60 * 1000 : 5 * 60 * 60 * 1000;
    })();

    const todayMidnightUTC = Date.UTC(etYear, etMonth, etDay) + etOffsetMs;
    const startDate = todayMidnightUTC - 24 * 60 * 60 * 1000; // yesterday midnight ET in UTC
    const endDate = todayMidnightUTC; // today midnight ET in UTC

    const yesterdayDate = new Date(startDate);
    const dateStr = yesterdayDate.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "America/New_York",
    });

    // Fetch truck data
    const trucks = await ctx.runQuery(
      internal.queries.getTrucksForManifestEmail,
      { startDate, endDate }
    );

    if (trucks.length === 0) {
      console.log(`[Manifest Email] No trucks found for ${dateStr}. Skipping email.`);
      return;
    }

    // Calculate summary stats
    const totalScans = trucks.reduce((sum, t) => sum + t.scanCount, 0);
    const allVendors = new Set<string>();
    for (const truck of trucks) {
      for (const vendor of Object.keys(truck.byVendor)) {
        allVendors.add(vendor);
      }
    }

    // Build HTML email
    const html = buildEmailHtml(dateStr, trucks, totalScans, allVendors.size);

    // Send via Resend
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("[Manifest Email] RESEND_API_KEY not configured");
      return;
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: "TireTrack <onboarding@resend.dev>",
        to: ["terry@ietires.com"],
        subject: `Truck Manifest - ${dateStr}`,
        html,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Manifest Email] Resend API error:", response.status, errorText);
      return;
    }

    const result = await response.json();
    console.log(`[Manifest Email] Sent successfully for ${dateStr}. ID: ${result.id}`);
  },
});

type TruckData = {
  truckNumber: string;
  carrier: string;
  status: string;
  openedAt: number;
  closedAt?: number;
  openedByName: string;
  scanCount: number;
  byVendor: Record<
    string,
    Array<{
      trackingNumber: string;
      carrier: string;
      destination: string;
      scannedByName: string;
      quantity?: number;
    }>
  >;
};

function buildEmailHtml(
  dateStr: string,
  trucks: TruckData[],
  totalScans: number,
  vendorCount: number
): string {
  const truckSections = trucks
    .map((truck) => {
      const openedTime = new Date(truck.openedAt).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      });
      const closedTime = truck.closedAt
        ? new Date(truck.closedAt).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: "America/New_York",
          })
        : "Not closed";

      const vendorSections = Object.entries(truck.byVendor)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([vendor, scans]) => {
          const scanRows = scans
            .map(
              (s) => `
              <tr>
                <td style="padding:4px 8px;border-bottom:1px solid #eee;font-family:monospace;font-size:13px;">${s.trackingNumber}${(s.quantity ?? 1) >= 2 ? ' <span style="background:#f59e0b;color:#fff;padding:1px 4px;border-radius:3px;font-size:10px;font-weight:bold;">x2</span>' : ''}</td>
                <td style="padding:4px 8px;border-bottom:1px solid #eee;font-size:13px;">${s.carrier}</td>
                <td style="padding:4px 8px;border-bottom:1px solid #eee;font-size:13px;">${s.destination}</td>
                <td style="padding:4px 8px;border-bottom:1px solid #eee;font-size:13px;">${s.scannedByName}</td>
              </tr>`
            )
            .join("");

          return `
          <div style="margin:8px 0;">
            <div style="background:#f0f4f8;padding:6px 12px;border-radius:4px;font-weight:600;font-size:14px;">
              ${vendor} <span style="color:#666;font-weight:400;">(${scans.length} scan${scans.length !== 1 ? "s" : ""})</span>
            </div>
            <table style="width:100%;border-collapse:collapse;margin-top:4px;">
              <thead>
                <tr style="background:#f8f9fa;">
                  <th style="padding:4px 8px;text-align:left;font-size:12px;color:#666;">Tracking</th>
                  <th style="padding:4px 8px;text-align:left;font-size:12px;color:#666;">Carrier</th>
                  <th style="padding:4px 8px;text-align:left;font-size:12px;color:#666;">Destination</th>
                  <th style="padding:4px 8px;text-align:left;font-size:12px;color:#666;">Scanned By</th>
                </tr>
              </thead>
              <tbody>${scanRows}</tbody>
            </table>
          </div>`;
        })
        .join("");

      return `
      <div style="margin:20px 0;border:1px solid #ddd;border-radius:8px;overflow:hidden;">
        <div style="background:#1a365d;color:white;padding:12px 16px;">
          <strong style="font-size:16px;">Truck ${truck.truckNumber}</strong>
          <span style="float:right;font-size:14px;">${truck.scanCount} scan${truck.scanCount !== 1 ? "s" : ""}</span>
        </div>
        <div style="padding:8px 16px;background:#f8f9fa;font-size:13px;color:#555;">
          Carrier: ${truck.carrier} &bull; Opened: ${openedTime} by ${truck.openedByName} &bull; Closed: ${closedTime} &bull; Status: ${truck.status}
        </div>
        <div style="padding:8px 16px;">
          ${vendorSections}
        </div>
      </div>`;
    })
    .join("");

  return `
  <div style="max-width:800px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#333;">
    <div style="background:#1a365d;color:white;padding:20px 24px;border-radius:8px 8px 0 0;">
      <h1 style="margin:0;font-size:22px;">Daily Truck Manifest</h1>
      <p style="margin:4px 0 0;opacity:0.9;font-size:15px;">${dateStr}</p>
    </div>
    <div style="background:#e8f0fe;padding:16px 24px;display:flex;gap:24px;">
      <div style="text-align:center;flex:1;">
        <div style="font-size:28px;font-weight:700;color:#1a365d;">${trucks.length}</div>
        <div style="font-size:12px;color:#666;">Truck${trucks.length !== 1 ? "s" : ""}</div>
      </div>
      <div style="text-align:center;flex:1;">
        <div style="font-size:28px;font-weight:700;color:#1a365d;">${totalScans}</div>
        <div style="font-size:12px;color:#666;">Scan${totalScans !== 1 ? "s" : ""}</div>
      </div>
      <div style="text-align:center;flex:1;">
        <div style="font-size:28px;font-weight:700;color:#1a365d;">${vendorCount}</div>
        <div style="font-size:12px;color:#666;">Vendor${vendorCount !== 1 ? "s" : ""}</div>
      </div>
    </div>
    <div style="padding:8px 24px 24px;">
      ${truckSections}
    </div>
    <div style="padding:16px 24px;background:#f8f9fa;border-radius:0 0 8px 8px;font-size:12px;color:#999;text-align:center;">
      TireTrack &bull; Automated daily manifest report
    </div>
  </div>`;
}
