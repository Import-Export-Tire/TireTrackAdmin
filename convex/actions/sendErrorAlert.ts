"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";

export const sendErrorAlert = internalAction({
  args: {
    errors: v.array(
      v.object({
        source: v.string(),
        errorType: v.string(),
        message: v.string(),
        details: v.optional(v.string()),
        timestamp: v.number(),
      })
    ),
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("[Error Alert] RESEND_API_KEY not configured");
      return;
    }

    const errorCount = args.errors.length;
    const sources = [...new Set(args.errors.map((e) => e.source))];

    const errorRows = args.errors
      .map((e) => {
        const time = new Date(e.timestamp).toLocaleString("en-US", {
          timeZone: "America/New_York",
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
        const details = e.details
          ? e.details.substring(0, 150)
          : "";
        return `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;">${time}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;">${e.source}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;"><code>${e.errorType}</code></td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;">${e.message}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:12px;color:#666;max-width:200px;overflow:hidden;text-overflow:ellipsis;">${details}</td>
        </tr>`;
      })
      .join("");

    const html = `
    <div style="max-width:800px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#333;">
      <div style="background:#991b1b;color:white;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h1 style="margin:0;font-size:22px;">TireTrack Error Alert</h1>
        <p style="margin:4px 0 0;opacity:0.9;font-size:15px;">${errorCount} unresolved error${errorCount !== 1 ? "s" : ""} in the last 15 minutes</p>
      </div>
      <div style="background:#fef2f2;padding:16px 24px;">
        <p style="margin:0;font-size:14px;color:#991b1b;font-weight:600;">
          Sources: ${sources.join(", ")}
        </p>
      </div>
      <div style="padding:8px 24px 24px;">
        <table style="width:100%;border-collapse:collapse;margin-top:8px;">
          <thead>
            <tr style="background:#f8f9fa;">
              <th style="padding:6px 10px;text-align:left;font-size:12px;color:#666;">Time</th>
              <th style="padding:6px 10px;text-align:left;font-size:12px;color:#666;">Source</th>
              <th style="padding:6px 10px;text-align:left;font-size:12px;color:#666;">Type</th>
              <th style="padding:6px 10px;text-align:left;font-size:12px;color:#666;">Message</th>
              <th style="padding:6px 10px;text-align:left;font-size:12px;color:#666;">Details</th>
            </tr>
          </thead>
          <tbody>${errorRows}</tbody>
        </table>
      </div>
      <div style="padding:16px 24px;background:#f8f9fa;border-radius:0 0 8px 8px;font-size:12px;color:#999;text-align:center;">
        TireTrack &bull; Automated error alert &bull; Check the admin dashboard to resolve
      </div>
    </div>`;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: "TireTrack <onboarding@resend.dev>",
        to: ["andy@ietires.com"],
        subject: `TireTrack Alert: ${errorCount} error${errorCount !== 1 ? "s" : ""} detected`,
        html,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Error Alert] Resend API error:", response.status, errorText);
      return;
    }

    const result = await response.json();
    console.log(`[Error Alert] Sent alert for ${errorCount} errors. Email ID: ${result.id}`);
  },
});
