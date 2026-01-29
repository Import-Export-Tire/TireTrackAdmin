import { NextRequest, NextResponse } from "next/server";
import * as ftp from "basic-ftp";

// Simple Tire FTP Configuration - read at runtime
function getFtpConfig() {
  return {
    host: process.env.SIMPLETIRE_FTP_HOST || "ftp.simpletire.com",
    user: process.env.SIMPLETIRE_FTP_USER || "",
    password: process.env.SIMPLETIRE_FTP_PASSWORD || "",
    folder: process.env.SIMPLETIRE_FTP_FOLDER || "/Labels",
  };
}

export async function GET(request: NextRequest) {
  // Vercel cron jobs are automatically authenticated via internal mechanisms
  // No manual CRON_SECRET check needed - Vercel handles this

  // Get the dry_run parameter - if true, don't actually upload
  const isDryRun = request.nextUrl.searchParams.get("dry_run") === "true";

  try {
    // Fetch today's Simple Tire scans from Convex
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) {
      return NextResponse.json(
        { error: "Convex URL not configured" },
        { status: 500 }
      );
    }

    // Get today's date range (midnight to midnight EST)
    const now = new Date();
    // Convert to EST (UTC-5, or UTC-4 during DST)
    const estOffset = -5 * 60; // EST offset in minutes
    const localOffset = now.getTimezoneOffset();
    const estTime = new Date(now.getTime() + (localOffset - estOffset) * 60000);

    const startOfDay = new Date(estTime);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(estTime);
    endOfDay.setHours(23, 59, 59, 999);

    // Query Convex for today's scans filtered by vendor
    const response = await fetch(`${convexUrl}/api/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path: "queries:getVendorDateRangeReport",
        args: {
          startDate: startOfDay.getTime(),
          endDate: endOfDay.getTime(),
          vendor: "Simple Tire",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Convex query failed:", errorText);
      return NextResponse.json(
        { error: "Failed to fetch scans from database", details: errorText },
        { status: 500 }
      );
    }

    const data = await response.json();
    const simpleTireScans = data.value?.byVendor?.["Simple Tire"] || [];

    if (simpleTireScans.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No Simple Tire scans found for today",
        date: estTime.toISOString().split("T")[0],
        scanCount: 0,
        uploaded: false,
        isDryRun,
      });
    }

    // Format the data for export (CSV format)
    const dateStr = estTime.toISOString().split("T")[0];
    const csvRows = [
      // Header row
      [
        "Tracking Number",
        "Carrier",
        "Truck Number",
        "Trailer Number",
        "Recipient Name",
        "Address",
        "City",
        "State",
        "Destination",
        "Scanned At",
        "Vendor Account",
      ].join(","),
    ];

    // Data rows
    for (const scan of simpleTireScans) {
      const scannedAt = new Date(scan.scannedAt).toISOString();
      csvRows.push(
        [
          `"${scan.trackingNumber || ""}"`,
          `"${scan.carrier || ""}"`,
          `"${scan.truckNumber || ""}"`,
          `"${scan.truckNumber || ""}"`,
          `"${scan.recipientName || ""}"`,
          `"${scan.address || ""}"`,
          `"${scan.city || ""}"`,
          `"${scan.state || ""}"`,
          `"${scan.destination || ""}"`,
          `"${scannedAt}"`,
          `"${scan.vendorAccount || ""}"`,
        ].join(",")
      );
    }

    const csvContent = csvRows.join("\n");
    const fileName = `simpletire_manifest_${dateStr}.csv`;

    // Get FTP config at runtime
    const ftpConfig = getFtpConfig();

    if (isDryRun) {
      return NextResponse.json({
        success: true,
        message: "Dry run - no upload performed",
        date: dateStr,
        scanCount: simpleTireScans.length,
        fileName,
        preview: csvRows.slice(0, 6).join("\n"), // Show header + first 5 rows
        uploaded: false,
        isDryRun: true,
      });
    }

    // Check FTP credentials
    if (!ftpConfig.user || !ftpConfig.password) {
      return NextResponse.json(
        {
          error: "FTP credentials not configured",
          hint: "Set SIMPLETIRE_FTP_USER and SIMPLETIRE_FTP_PASSWORD environment variables",
        },
        { status: 500 }
      );
    }

    // Upload to FTP
    const client = new ftp.Client();
    client.ftp.verbose = false;

    try {
      await client.access({
        host: ftpConfig.host,
        user: ftpConfig.user,
        password: ftpConfig.password,
        secure: false, // Set to true if FTP server supports FTPS
      });

      // Navigate to the labels folder
      // Navigate to the Labels folder (skip ensureDir as server may not support MLSD)
      await client.cd(ftpConfig.folder);

      // Upload the CSV file
      const buffer = Buffer.from(csvContent, "utf-8");
      const { Readable } = await import("stream");
      const readableStream = Readable.from(buffer);
      await client.uploadFrom(readableStream, fileName);

      return NextResponse.json({
        success: true,
        message: `Successfully uploaded ${fileName} to Simple Tire FTP`,
        date: dateStr,
        scanCount: simpleTireScans.length,
        fileName,
        ftpPath: `${ftpConfig.folder}/${fileName}`,
        uploaded: true,
        isDryRun: false,
      });
    } finally {
      client.close();
    }
  } catch (error) {
    console.error("Simple Tire export error:", error);
    return NextResponse.json(
      {
        error: "Export failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// POST endpoint for manual testing - skips cron auth
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const isDryRun = body.dry_run !== false; // Default to dry run for safety

  try {
    // Fetch today's Simple Tire scans from Convex
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) {
      return NextResponse.json(
        { error: "Convex URL not configured" },
        { status: 500 }
      );
    }

    // Get today's date range (midnight to midnight EST)
    const now = new Date();
    const estOffset = -5 * 60;
    const localOffset = now.getTimezoneOffset();
    const estTime = new Date(now.getTime() + (localOffset - estOffset) * 60000);

    const startOfDay = new Date(estTime);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(estTime);
    endOfDay.setHours(23, 59, 59, 999);

    // Query Convex for today's scans filtered by vendor
    const response = await fetch(`${convexUrl}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "queries:getVendorDateRangeReport",
        args: {
          startDate: startOfDay.getTime(),
          endDate: endOfDay.getTime(),
          vendor: "Simple Tire",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: "Failed to fetch scans from database", details: errorText },
        { status: 500 }
      );
    }

    const data = await response.json();
    const simpleTireScans = data.value?.byVendor?.["Simple Tire"] || [];

    if (simpleTireScans.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No Simple Tire scans found for today",
        date: estTime.toISOString().split("T")[0],
        scanCount: 0,
        uploaded: false,
        isDryRun,
      });
    }

    // Format CSV
    const dateStr = estTime.toISOString().split("T")[0];
    const csvRows = [
      ["Tracking Number", "Carrier", "Truck Number", "Trailer Number", "Recipient Name", "Address", "City", "State", "Destination", "Scanned At", "Vendor Account"].join(","),
    ];

    for (const scan of simpleTireScans) {
      const scannedAt = new Date(scan.scannedAt).toISOString();
      csvRows.push(
        [
          `"${scan.trackingNumber || ""}"`,
          `"${scan.carrier || ""}"`,
          `"${scan.truckNumber || ""}"`,
          `"${scan.truckNumber || ""}"`,
          `"${scan.recipientName || ""}"`,
          `"${scan.address || ""}"`,
          `"${scan.city || ""}"`,
          `"${scan.state || ""}"`,
          `"${scan.destination || ""}"`,
          `"${scannedAt}"`,
          `"${scan.vendorAccount || ""}"`,
        ].join(",")
      );
    }

    const csvContent = csvRows.join("\n");
    const fileName = `simpletire_manifest_${dateStr}.csv`;

    // Get FTP config at runtime
    const ftpConfig = getFtpConfig();

    if (isDryRun) {
      return NextResponse.json({
        success: true,
        message: "Dry run - no upload performed",
        date: dateStr,
        scanCount: simpleTireScans.length,
        fileName,
        preview: csvRows.slice(0, 6).join("\n"),
        uploaded: false,
        isDryRun: true,
        debug: {
          ftpHost: ftpConfig.host,
          ftpFolder: ftpConfig.folder,
          hasUser: !!ftpConfig.user,
          hasPassword: !!ftpConfig.password,
        },
      });
    }

    // Check FTP credentials
    if (!ftpConfig.user || !ftpConfig.password) {
      return NextResponse.json(
        { error: "FTP credentials not configured", debug: { host: ftpConfig.host, hasUser: !!ftpConfig.user, hasPassword: !!ftpConfig.password } },
        { status: 500 }
      );
    }

    // Upload to FTP
    const client = new ftp.Client();
    client.ftp.verbose = false;

    try {
      await client.access({
        host: ftpConfig.host,
        user: ftpConfig.user,
        password: ftpConfig.password,
        secure: false,
      });

      // Navigate to the Labels folder (skip ensureDir as server may not support MLSD)
      await client.cd(ftpConfig.folder);

      const buffer = Buffer.from(csvContent, "utf-8");
      const { Readable } = await import("stream");
      const readableStream = Readable.from(buffer);
      await client.uploadFrom(readableStream, fileName);

      return NextResponse.json({
        success: true,
        message: `Successfully uploaded ${fileName} to Simple Tire FTP`,
        date: dateStr,
        scanCount: simpleTireScans.length,
        fileName,
        ftpPath: `${ftpConfig.folder}/${fileName}`,
        uploaded: true,
        isDryRun: false,
      });
    } finally {
      client.close();
    }
  } catch (error) {
    console.error("Simple Tire export error:", error);
    return NextResponse.json(
      { error: "Export failed", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
