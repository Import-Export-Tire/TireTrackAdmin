"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import React, { useState, useMemo } from "react";
import { Protected } from "../protected";
import Link from "next/link";
import { Id } from "../../convex/_generated/dataModel";

type ReportType = "daily" | "vendor-range";

const LOCATION_OPTIONS = [
  { id: "kj7q0v1qxbf6z1b1h2cjhf4m8h74vjbe", name: "Latrobe", shortId: "latrobe" },
  { id: "kj74zfr66q23wgv5xc3qdc0a6s74vvtr", name: "Everson", shortId: "everson" },
  { id: "kj70r8fvdeg83dhapvp91kqs2574vqng", name: "Chestnut", shortId: "chestnut" },
];

const getLocationName = (locationId: string) => {
  if (!locationId) return "Unknown";
  const lower = locationId.toLowerCase();
  const match = LOCATION_OPTIONS.find(loc => loc.id === lower || loc.shortId === lower);
  if (match) return match.name;
  if (lower.includes("latrobe")) return "Latrobe";
  if (lower.includes("everson")) return "Everson";
  if (lower.includes("chestnut")) return "Chestnut";
  return locationId;
};

// No Vendor Known Modal Component
function NoVendorKnownModal({
  onClose,
  data,
}: {
  onClose: () => void;
  data: any;
}) {
  const markAsNoVendorKnown = useMutation(api.mutations.markScanAsNoVendorKnown);
  const [marking, setMarking] = useState<string | null>(null);

  const handleToggle = async (scanId: Id<"scans">, noVendorKnown: boolean) => {
    setMarking(scanId);
    await markAsNoVendorKnown({ scanId, noVendorKnown });
    setMarking(null);
  };

  const generateCSV = () => {
    if (!data?.groupedByAccount) return;
    const headers = ["Account Number", "Count", "Likely New Vendor", "Sample Tracking Numbers"];
    const rows = data.groupedByAccount.map((g: any) => [
      g.accountNumber,
      g.count,
      g.likelyNewVendor ? "Yes" : "No",
      g.sampleScans.map((s: any) => s.trackingNumber).join("; "),
    ]);
    const csv = [headers.join(","), ...rows.map((r: string[]) => r.map(v => `"${v}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `no_vendor_known_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <div>
            <h2 className="text-xl font-bold text-white">No Vendor Known Report</h2>
            <p className="text-slate-500 text-sm">{data?.totalNoVendorKnown || 0} valid 2D scans without vendor match</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={generateCSV}
              className="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-lg text-sm font-medium transition-all flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download CSV
            </button>
            <button
              onClick={onClose}
              className="w-10 h-10 bg-slate-800 hover:bg-slate-700 rounded-lg flex items-center justify-center transition-colors"
            >
              <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {!data ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-10 h-10 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Summary Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                  <p className="text-2xl font-bold text-purple-400">{data.totalNoVendorKnown}</p>
                  <p className="text-slate-500 text-xs">Total No Vendor</p>
                </div>
                <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                  <p className="text-2xl font-bold text-pink-400">{data.potentialNewVendors?.length || 0}</p>
                  <p className="text-slate-500 text-xs">Potential New Vendors (7+)</p>
                </div>
                <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                  <p className="text-2xl font-bold text-slate-400">{data.oneOffVendors || 0}</p>
                  <p className="text-slate-500 text-xs">One-Off Vendors</p>
                </div>
                <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                  <p className="text-2xl font-bold text-slate-500">{data.noAccountNumber || 0}</p>
                  <p className="text-slate-500 text-xs">No Account Number</p>
                </div>
              </div>

              {/* Potential New Vendors Section */}
              {data.potentialNewVendors?.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-medium text-pink-400 mb-3 flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    Potential New Vendors (7+ occurrences - research these!)
                  </h3>
                  <div className="bg-pink-500/10 rounded-xl p-4 border border-pink-500/30">
                    <div className="flex flex-wrap gap-3">
                      {data.potentialNewVendors.map((g: any) => (
                        <div key={g.accountNumber} className="bg-slate-800/80 rounded-lg px-4 py-3 border border-slate-700/50">
                          <div className="flex items-center gap-3">
                            <span className="text-pink-400 font-bold text-xl">{g.count}</span>
                            <div>
                              <p className="text-slate-200 font-mono text-sm">{g.accountNumber}</p>
                              <p className="text-slate-500 text-xs">scans with this account</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-slate-500 text-xs mt-3">
                      These account numbers appear frequently - consider researching to identify the vendor
                    </p>
                  </div>
                </div>
              )}

              {/* Grouped by Account Table */}
              <div className="bg-slate-800/30 rounded-xl border border-slate-700/50 overflow-hidden">
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-900">
                      <tr className="text-slate-500 text-xs">
                        <th className="text-left py-3 px-4">Account Number</th>
                        <th className="text-center py-3 px-4">Count</th>
                        <th className="text-left py-3 px-4">Sample Tracking</th>
                        <th className="text-center py-3 px-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {data.groupedByAccount?.slice(0, 100).map((group: any) => (
                        <tr key={group.accountNumber} className={`hover:bg-slate-800/50 ${group.likelyNewVendor ? "bg-pink-500/5" : ""}`}>
                          <td className="py-3 px-4 font-mono text-sm text-slate-300">{group.accountNumber}</td>
                          <td className="py-3 px-4 text-center">
                            <span className={`px-2 py-1 rounded text-xs font-bold ${
                              group.likelyNewVendor ? "bg-pink-500/20 text-pink-400" : "bg-slate-700/50 text-slate-400"
                            }`}>
                              {group.count}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap gap-1">
                              {group.sampleScans.slice(0, 3).map((scan: any, i: number) => (
                                <span key={i} className="text-xs bg-slate-700/50 px-2 py-0.5 rounded font-mono text-slate-400">
                                  {scan.trackingNumber.slice(0, 15)}...
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-center">
                            {group.likelyNewVendor ? (
                              <span className="text-xs px-2 py-1 bg-pink-500/20 text-pink-400 rounded">Research</span>
                            ) : group.count === 1 ? (
                              <span className="text-xs px-2 py-1 bg-slate-700/50 text-slate-500 rounded">One-off</span>
                            ) : (
                              <span className="text-xs px-2 py-1 bg-slate-700/50 text-slate-400 rounded">Monitor</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {data.groupedByAccount?.length > 100 && (
                    <p className="text-center text-slate-500 text-xs py-3">
                      Showing 100 of {data.groupedByAccount.length} account groups. Download CSV for full list.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Unmatched Scans Modal Component
function UnmatchedScansModal({
  onClose,
  data,
}: {
  onClose: () => void;
  data: any;
}) {
  const [filter, setFilter] = useState<"all" | "UPS" | "FedEx unmapped" | "Other">("all");
  const markAsMiscan = useMutation(api.mutations.markScanAsMiscan);
  const [marking, setMarking] = useState<string | null>(null);

  const handleMarkMiscan = async (scanId: Id<"scans">, isMiscan: boolean) => {
    setMarking(scanId);
    await markAsMiscan({ scanId, isMiscan });
    setMarking(null);
  };

  const generateCSV = () => {
    if (!data?.scans) return;
    const scans = filter === "all" ? data.scans : data.scans.filter((s: any) => s.category === filter);
    const headers = ["Tracking Number", "Category", "Truck", "Scanned By", "Emp ID", "Date", "Raw Barcode", "Is Miscan"];
    const rows = scans.map((s: any) => [
      s.trackingNumber,
      s.category,
      s.truckNumber,
      s.scannedByName,
      s.scannedByEmpId,
      new Date(s.scannedAt).toLocaleString(),
      s.rawBarcode.replace(/[\x00-\x1F]/g, " "),
      s.isMiscan ? "Yes" : "No",
    ]);
    const csv = [headers.join(","), ...rows.map((r: string[]) => r.map(v => `"${v}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `unmatched_scans_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredScans = data?.scans
    ? filter === "all"
      ? data.scans
      : data.scans.filter((s: any) => s.category === filter)
    : [];

  // Calculate max for chart scaling
  const maxUnmatched = data?.dailyData?.length
    ? Math.max(...data.dailyData.map((d: any) => d.unmatched), 1)
    : 1;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <div>
            <h2 className="text-xl font-bold text-white">Unmatched Scans Report</h2>
            <p className="text-slate-500 text-sm">{data?.scans?.length || 0} total unmatched scans</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={generateCSV}
              className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-lg text-sm font-medium transition-all flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download CSV
            </button>
            <button
              onClick={onClose}
              className="w-10 h-10 bg-slate-800 hover:bg-slate-700 rounded-lg flex items-center justify-center transition-colors"
            >
              <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {!data ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-10 h-10 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* 30-Day Chart */}
              {data.dailyData && data.dailyData.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-medium text-slate-400 mb-3">Unmatched Scans - Last 30 Days</h3>
                  <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                    <div className="flex items-end gap-1 h-32">
                      {data.dailyData.map((day: any, i: number) => {
                        // Use percentage of unmatched relative to total for that day
                        const unmatchedPercent = day.total > 0 ? (day.unmatched / day.total) * 100 : 0;
                        // Scale so even small percentages show up
                        const height = Math.max(unmatchedPercent * 2, day.unmatched > 0 ? 8 : 2);
                        const matchRate = day.matchRate.toFixed(1);
                        return (
                          <div
                            key={day.date}
                            className="flex-1 flex flex-col items-center justify-end group relative h-full"
                          >
                            <div
                              className={`w-full rounded-t transition-all cursor-pointer ${
                                day.unmatched > 0 ? "bg-red-500 hover:bg-red-400" : "bg-emerald-500/50"
                              }`}
                              style={{ height: `${height}%`, minHeight: day.total > 0 ? '4px' : '2px' }}
                            />
                            {/* Tooltip - positioned below bar if near top, above otherwise */}
                            <div className={`absolute left-1/2 -translate-x-1/2 hidden group-hover:block bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs z-10 whitespace-nowrap shadow-xl ${
                              height > 60 ? "top-full mt-2" : "bottom-full mb-2"
                            }`}>
                              <p className="text-white font-medium">{new Date(day.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
                              <p className="text-slate-400">{day.total} scans, {day.unmatched} unmatched</p>
                              <p className={day.matchRate >= 99 ? "text-emerald-400" : day.matchRate >= 95 ? "text-yellow-400" : "text-red-400"}>
                                {matchRate}% matched
                              </p>
                              {day.miscan > 0 && <p className="text-amber-400">{day.miscan} marked as miscan</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-between mt-2 text-xs text-slate-500">
                      <span>{data.dailyData[0]?.date ? new Date(data.dailyData[0].date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}</span>
                      <span>{data.dailyData[data.dailyData.length - 1]?.date ? new Date(data.dailyData[data.dailyData.length - 1].date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}</span>
                    </div>
                    <div className="flex items-center justify-center gap-4 mt-3 text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded bg-red-500" />
                        <span className="text-slate-400">Has unmatched</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded bg-emerald-500/50" />
                        <span className="text-slate-400">All matched</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Miscan Training Summary */}
              {data.scans?.some((s: any) => s.isMiscan) && (
                <div className="mb-6">
                  <h3 className="text-sm font-medium text-slate-400 mb-3">Miscan Training Report</h3>
                  <div className="bg-amber-500/10 rounded-xl p-4 border border-amber-500/30">
                    <p className="text-amber-400 text-sm mb-3">
                      Employees with marked miscans - consider for training:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(() => {
                        // Group miscans by employee
                        const byEmployee: Record<string, { name: string; empId: string; count: number }> = {};
                        for (const scan of data.scans.filter((s: any) => s.isMiscan)) {
                          const key = scan.scannedByEmpId || "unknown";
                          if (!byEmployee[key]) {
                            byEmployee[key] = { name: scan.scannedByName, empId: scan.scannedByEmpId, count: 0 };
                          }
                          byEmployee[key].count++;
                        }
                        return Object.values(byEmployee)
                          .sort((a, b) => b.count - a.count)
                          .map((emp) => (
                            <div key={emp.empId} className="flex items-center gap-2 px-3 py-2 bg-slate-800/80 rounded-lg border border-slate-700/50">
                              <span className="text-amber-400 font-bold text-lg">{emp.count}</span>
                              <div>
                                <p className="text-slate-200 text-sm font-medium">{emp.name}</p>
                                <p className="text-slate-500 text-xs">{emp.empId}</p>
                              </div>
                            </div>
                          ));
                      })()}
                    </div>
                    <p className="text-slate-500 text-xs mt-3">
                      Total miscans: {data.scans.filter((s: any) => s.isMiscan).length} |
                      Use this data to identify scanning training opportunities
                    </p>
                  </div>
                </div>
              )}

              {/* Filter Tabs */}
              <div className="flex items-center gap-2 mb-4">
                {(["all", "UPS", "FedEx unmapped", "Other"] as const).map((f) => {
                  const count = f === "all"
                    ? data.scans?.length || 0
                    : data.scans?.filter((s: any) => s.category === f).length || 0;
                  return (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                        filter === f
                          ? "bg-cyan-600 text-white"
                          : "bg-slate-800 text-slate-400 hover:text-white"
                      }`}
                    >
                      {f === "all" ? "All" : f} ({count})
                    </button>
                  );
                })}
              </div>

              {/* Scans Table */}
              <div className="bg-slate-800/30 rounded-xl border border-slate-700/50 overflow-hidden">
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-900">
                      <tr className="text-slate-500 text-xs">
                        <th className="text-left py-3 px-4">Tracking</th>
                        <th className="text-left py-3 px-4">Category</th>
                        <th className="text-left py-3 px-4">Truck</th>
                        <th className="text-left py-3 px-4">Scanned By</th>
                        <th className="text-left py-3 px-4">Date</th>
                        <th className="text-left py-3 px-4">Raw Barcode</th>
                        <th className="text-center py-3 px-4">Miscan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {filteredScans.slice(0, 200).map((scan: any) => (
                        <tr key={scan._id} className={`hover:bg-slate-800/50 ${scan.isMiscan ? "bg-amber-500/10" : ""}`}>
                          <td className="py-3 px-4 font-mono text-xs text-slate-300">{scan.trackingNumber}</td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                              scan.category === "UPS" ? "bg-yellow-500/20 text-yellow-400" :
                              scan.category === "FedEx unmapped" ? "bg-orange-500/20 text-orange-400" :
                              "bg-red-500/20 text-red-400"
                            }`}>
                              {scan.category}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-400">{scan.truckNumber}</td>
                          <td className="py-3 px-4">
                            <div>
                              <p className="text-slate-300">{scan.scannedByName}</p>
                              <p className="text-slate-500 text-xs">{scan.scannedByEmpId}</p>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-slate-500 text-xs">{new Date(scan.scannedAt).toLocaleDateString()}</td>
                          <td className="py-3 px-4 font-mono text-xs text-slate-500 max-w-[200px] truncate" title={scan.rawBarcode}>
                            {scan.rawBarcode.replace(/[\x00-\x1F]/g, " ").slice(0, 50)}...
                          </td>
                          <td className="py-3 px-4 text-center">
                            <button
                              onClick={() => handleMarkMiscan(scan._id, !scan.isMiscan)}
                              disabled={marking === scan._id}
                              className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                                scan.isMiscan
                                  ? "bg-amber-500 text-white hover:bg-amber-600"
                                  : "bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-white"
                              }`}
                            >
                              {marking === scan._id ? "..." : scan.isMiscan ? "Miscan" : "Mark"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredScans.length > 200 && (
                    <p className="text-center text-slate-500 text-xs py-3">
                      Showing 200 of {filteredScans.length} scans. Download CSV for full list.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Duplicate Offenders Modal Component
function DuplicateOffendersModal({
  onClose,
  data,
}: {
  onClose: () => void;
  data: any;
}) {
  const generateCSV = () => {
    if (!data?.users) return;
    const headers = ["User Name", "User ID", "Duplicate Count", "Sample Tracking Numbers"];
    const rows = data.users.map((u: any) => [
      u.userName,
      u.userId,
      u.duplicateCount,
      u.duplicates.slice(0, 5).map((d: any) => d.trackingNumber).join("; "),
    ]);
    const csv = [headers.join(","), ...rows.map((r: string[]) => r.map(v => `"${v}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `duplicate_offenders_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <div>
            <h2 className="text-xl font-bold text-white">Duplicate Scan Offenders</h2>
            <p className="text-slate-500 text-sm">Users who added known duplicates - training opportunities</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={generateCSV}
              className="px-4 py-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 rounded-lg text-sm font-medium transition-all flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download CSV
            </button>
            <button
              onClick={onClose}
              className="w-10 h-10 bg-slate-800 hover:bg-slate-700 rounded-lg flex items-center justify-center transition-colors"
            >
              <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {!data ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-10 h-10 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Summary Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                  <p className="text-2xl font-bold text-amber-400">{data.overall?.totalDuplicates || 0}</p>
                  <p className="text-slate-500 text-xs">Total Duplicates</p>
                </div>
                <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                  <p className="text-2xl font-bold text-slate-400">{data.overall?.totalScans?.toLocaleString() || 0}</p>
                  <p className="text-slate-500 text-xs">Total Scans</p>
                </div>
                <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                  <p className="text-2xl font-bold text-red-400">{data.overall?.duplicateRate?.toFixed(2) || 0}%</p>
                  <p className="text-slate-500 text-xs">Duplicate Rate</p>
                </div>
                <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                  <p className="text-2xl font-bold text-orange-400">{data.monthly?.totalDuplicates || 0}</p>
                  <p className="text-slate-500 text-xs">{data.monthly?.monthName || "This Month"}</p>
                </div>
              </div>

              {/* User List */}
              {data.users?.length === 0 ? (
                <div className="text-center py-10 text-slate-500">
                  <svg className="w-16 h-16 mx-auto mb-4 text-emerald-500/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-lg font-medium text-emerald-400">No duplicate offenders!</p>
                  <p className="text-sm mt-1">All users are scanning properly</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {data.users.map((user: any) => (
                    <div key={user.userId} className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-amber-500/20 rounded-lg flex items-center justify-center">
                            <span className="text-lg font-bold text-amber-400">{user.userName.charAt(0)}</span>
                          </div>
                          <div>
                            <p className="font-medium text-white">{user.userName}</p>
                            <p className="text-slate-500 text-xs">Needs Training</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold text-amber-400">{user.duplicateCount}</p>
                          <p className="text-slate-500 text-xs">duplicates added</p>
                        </div>
                      </div>
                      {/* Recent duplicates */}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {user.duplicates.slice(0, 5).map((dup: any, i: number) => (
                          <span key={i} className="text-xs bg-slate-800/80 px-2 py-1 rounded font-mono text-slate-400">
                            {dup.truckNumber}: {dup.trackingNumber.slice(0, 12)}...
                          </span>
                        ))}
                        {user.duplicates.length > 5 && (
                          <span className="text-xs text-slate-500 px-2 py-1">
                            +{user.duplicates.length - 5} more
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// User Accuracy Modal Component
function UserAccuracyModal({
  onClose,
  data,
}: {
  onClose: () => void;
  data: any;
}) {
  const getAccuracyColor = (accuracy: number) => accuracy >= 99 ? "text-emerald-400" : accuracy >= 98 ? "text-yellow-400" : "text-red-400";
  const getBgColor = (accuracy: number) => accuracy >= 99 ? "bg-emerald-500/10 border-emerald-500/20" : accuracy >= 98 ? "bg-yellow-500/10 border-yellow-500/20" : "bg-red-500/10 border-red-500/20";

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <div>
            <h2 className="text-xl font-bold text-white">User Scanning Accuracy</h2>
            <p className="text-slate-500 text-sm">Target: 99% or above</p>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 bg-slate-800 hover:bg-slate-700 rounded-lg flex items-center justify-center transition-colors"
          >
            <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {!data ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Summary Stats */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className={`rounded-xl p-4 border ${getBgColor(data.monthly?.accuracy || 100)}`}>
                  <p className="text-slate-400 text-sm mb-1">{data.monthly?.monthName || "This Month"}</p>
                  <p className={`text-3xl font-bold ${getAccuracyColor(data.monthly?.accuracy || 100)}`}>
                    {data.monthly?.accuracy?.toFixed(2)}%
                  </p>
                  <p className="text-slate-500 text-xs mt-1">
                    {data.monthly?.totalScans?.toLocaleString()} scans, {data.monthly?.totalBadScans} bad
                  </p>
                </div>
                <div className={`rounded-xl p-4 border ${getBgColor(data.overall?.accuracy || 100)}`}>
                  <p className="text-slate-400 text-sm mb-1">All Time</p>
                  <p className={`text-3xl font-bold ${getAccuracyColor(data.overall?.accuracy || 100)}`}>
                    {data.overall?.accuracy?.toFixed(2)}%
                  </p>
                  <p className="text-slate-500 text-xs mt-1">
                    {data.overall?.totalScans?.toLocaleString()} scans, {data.overall?.totalBadScans} bad
                  </p>
                </div>
              </div>

              {/* User List */}
              {data.users?.length === 0 ? (
                <div className="text-center py-10 text-slate-500">No scan data available</div>
              ) : (
                <div className="space-y-3">
                  {data.users.filter((u: any) => u.totalScans > 0 || u.monthlyScans > 0).map((user: any) => {
                    // Use monthly accuracy for coloring if they have monthly scans, otherwise all-time
                    const primaryAccuracy = user.monthlyScans > 0 ? user.monthlyAccuracy : user.accuracy;
                    return (
                      <div key={user.userId} className={`flex items-center justify-between px-4 py-3 rounded-xl border ${getBgColor(primaryAccuracy)}`}>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center">
                            <span className="text-lg font-bold text-slate-400">{user.name.charAt(0)}</span>
                          </div>
                          <div>
                            <p className="font-medium text-white">{user.name}</p>
                            <p className="text-slate-500 text-xs">ID: {user.empId}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-6">
                          {/* This Month */}
                          <div className="text-right">
                            <p className="text-slate-500 text-xs mb-0.5">This Month</p>
                            {user.monthlyScans > 0 ? (
                              <>
                                <p className={`text-lg font-bold ${getAccuracyColor(user.monthlyAccuracy)}`}>
                                  {user.monthlyAccuracy.toFixed(1)}%
                                </p>
                                <p className="text-slate-500 text-xs">
                                  {user.monthlyScans.toLocaleString()} scans
                                  {user.monthlyBadScans > 0 && <span className="text-red-400"> ({user.monthlyBadScans} bad)</span>}
                                </p>
                              </>
                            ) : (
                              <p className="text-slate-600 text-sm">No scans</p>
                            )}
                          </div>
                          {/* All Time */}
                          <div className="text-right min-w-[100px]">
                            <p className="text-slate-500 text-xs mb-0.5">All Time</p>
                            <p className={`text-lg font-bold ${getAccuracyColor(user.accuracy)}`}>
                              {user.accuracy.toFixed(1)}%
                            </p>
                            <p className="text-slate-500 text-xs">
                              {user.totalScans.toLocaleString()} scans
                              {user.badScans > 0 && <span className="text-red-400"> ({user.badScans} bad)</span>}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Returns Export Modal Component
function ReturnsExportModal({
  onClose,
  data,
  batches,
  statusFilter,
  batchFilter,
  dateFilter,
  startDate,
  endDate,
  onStatusChange,
  onBatchChange,
  onDateFilterChange,
  onStartDateChange,
  onEndDateChange,
}: {
  onClose: () => void;
  data: any;
  batches: any;
  statusFilter: string;
  batchFilter: string;
  dateFilter: string;
  startDate: string;
  endDate: string;
  onStatusChange: (status: string) => void;
  onBatchChange: (batchId: string) => void;
  onDateFilterChange: (filter: string) => void;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
}) {
  const generateCSV = () => {
    if (!data?.items) return;
    const headers = [
      "Batch #",
      "Location",
      "PO Number",
      "INV Number",
      "From Address",
      "UPC Code",
      "Brand",
      "Model",
      "Size",
      "Part #",
      "Quantity",
      "Status",
      "Notes",
      "Scanned By",
      "Scanned At",
      "AI Confidence",
    ];
    const rows = data.items.map((item: any) => [
      item.batchNumber,
      item.locationName,
      item.poNumber,
      item.invNumber,
      item.fromAddress,
      item.upcCode,
      item.tireBrand,
      item.tireModel,
      item.tireSize,
      item.tirePartNumber,
      item.quantity,
      item.status,
      item.notes,
      item.scannedByName,
      new Date(item.scannedAt).toLocaleString(),
      item.aiConfidence,
    ]);
    const csv = [headers.join(","), ...rows.map((r: string[]) => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // Build filename based on filters
    let filename = "returns";
    if (batchFilter !== "all") filename += `_batch${batchFilter.slice(-6)}`;
    if (dateFilter !== "all") filename += `_${startDate}_to_${endDate}`;
    if (statusFilter !== "all") filename += `_${statusFilter}`;
    filename += `_${new Date().toISOString().split("T")[0]}.csv`;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "processed":
        return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
      case "pending":
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "not_processed":
        return "bg-red-500/20 text-red-400 border-red-500/30";
      default:
        return "bg-slate-700/50 text-slate-400 border-slate-600/30";
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <div>
            <h2 className="text-xl font-bold text-white">Export Returns</h2>
            <p className="text-slate-500 text-sm">Download return items with filters</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={generateCSV}
              disabled={!data?.items?.length}
              className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 rounded-lg text-sm font-medium transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download CSV ({data?.items?.length || 0})
            </button>
            <button
              onClick={onClose}
              className="w-10 h-10 bg-slate-800 hover:bg-slate-700 rounded-lg flex items-center justify-center transition-colors"
            >
              <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {/* Filter Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {/* Batch Filter */}
            <div>
              <label className="text-slate-400 text-xs mb-1 block">Filter by Batch</label>
              <select
                value={batchFilter}
                onChange={(e) => onBatchChange(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500"
              >
                <option value="all">All Batches</option>
                {batches?.map((batch: any) => (
                  <option key={batch._id} value={batch._id}>
                    {batch.batchNumber} - {batch.locationName} ({batch.itemCount} items)
                  </option>
                ))}
              </select>
            </div>

            {/* Date Filter */}
            <div>
              <label className="text-slate-400 text-xs mb-1 block">Filter by Date</label>
              <div className="flex gap-2">
                <select
                  value={dateFilter}
                  onChange={(e) => onDateFilterChange(e.target.value)}
                  className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="all">All Time</option>
                  <option value="today">Today</option>
                  <option value="week">This Week</option>
                  <option value="month">This Month</option>
                  <option value="custom">Custom Range</option>
                </select>
              </div>
            </div>

            {/* Status Filter Dropdown */}
            <div>
              <label className="text-slate-400 text-xs mb-1 block">Filter by Status</label>
              <select
                value={statusFilter}
                onChange={(e) => onStatusChange(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500"
              >
                <option value="all">All Statuses</option>
                <option value="processed">Processed</option>
                <option value="pending">Pending</option>
                <option value="not_processed">Not Processed</option>
              </select>
            </div>
          </div>

          {/* Custom Date Range */}
          {dateFilter === "custom" && (
            <div className="flex gap-4 mb-6">
              <div>
                <label className="text-slate-400 text-xs mb-1 block">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => onStartDateChange(e.target.value)}
                  className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="text-slate-400 text-xs mb-1 block">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => onEndDateChange(e.target.value)}
                  className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>
          )}

          {/* Summary Stats */}
          {data?.statusCounts && (
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="bg-emerald-500/10 rounded-xl p-4 border border-emerald-500/30">
                <p className="text-2xl font-bold text-emerald-400">{data.statusCounts.processed}</p>
                <p className="text-slate-500 text-xs">Processed</p>
              </div>
              <div className="bg-yellow-500/10 rounded-xl p-4 border border-yellow-500/30">
                <p className="text-2xl font-bold text-yellow-400">{data.statusCounts.pending}</p>
                <p className="text-slate-500 text-xs">Pending</p>
              </div>
              <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/30">
                <p className="text-2xl font-bold text-red-400">{data.statusCounts.not_processed}</p>
                <p className="text-slate-500 text-xs">Not Processed</p>
              </div>
            </div>
          )}

          {/* Items Preview Table */}
          {!data ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : data.items?.length === 0 ? (
            <div className="text-center py-10 text-slate-500">
              <svg className="w-16 h-16 mx-auto mb-4 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              <p className="text-lg font-medium">No returns found</p>
              <p className="text-sm mt-1">No return items match the selected filter</p>
            </div>
          ) : (
            <div className="bg-slate-800/30 rounded-xl border border-slate-700/50 overflow-hidden">
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-900">
                    <tr className="text-slate-500 text-xs">
                      <th className="text-left py-3 px-4">Batch</th>
                      <th className="text-left py-3 px-4">Brand/Model</th>
                      <th className="text-left py-3 px-4">Size</th>
                      <th className="text-left py-3 px-4">Part #</th>
                      <th className="text-center py-3 px-4">Qty</th>
                      <th className="text-center py-3 px-4">Status</th>
                      <th className="text-left py-3 px-4">Scanned</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {data.items.slice(0, 100).map((item: any) => (
                      <tr key={item._id} className="hover:bg-slate-800/50">
                        <td className="py-3 px-4 text-slate-300 text-xs">{item.batchNumber}</td>
                        <td className="py-3 px-4">
                          <p className="text-slate-300">{item.tireBrand || "-"}</p>
                          <p className="text-slate-500 text-xs">{item.tireModel || ""}</p>
                        </td>
                        <td className="py-3 px-4 text-slate-400 text-xs">{item.tireSize || "-"}</td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-400">{item.tirePartNumber || "-"}</td>
                        <td className="py-3 px-4 text-center text-slate-300">{item.quantity}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={`px-2 py-1 rounded text-xs font-medium border ${getStatusBadge(item.status)}`}>
                            {item.status === "not_processed" ? "Not Proc" : item.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-500 text-xs">{new Date(item.scannedAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.items.length > 100 && (
                  <p className="text-center text-slate-500 text-xs py-3">
                    Showing 100 of {data.items.length} items. Download CSV for full list.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReportsPage() {
  const [reportType, setReportType] = useState<ReportType>("daily");
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });
  const [rangeStartDate, setRangeStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return date.toISOString().split("T")[0];
  });
  const [rangeEndDate, setRangeEndDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });
  const [selectedVendor, setSelectedVendor] = useState<string>("all");
  const [expandedTruck, setExpandedTruck] = useState<string | null>(null);
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null);
  const [showUnmatchedModal, setShowUnmatchedModal] = useState(false);
  const [showNoVendorKnownModal, setShowNoVendorKnownModal] = useState(false);
  const [showUserAccuracyModal, setShowUserAccuracyModal] = useState(false);
  const [showDuplicateOffendersModal, setShowDuplicateOffendersModal] = useState(false);
  const [showSimpleTireDupsModal, setShowSimpleTireDupsModal] = useState(false);
  const [showReturnsExportModal, setShowReturnsExportModal] = useState(false);
  const [returnsStatusFilter, setReturnsStatusFilter] = useState<string>("all");
  const [returnsBatchFilter, setReturnsBatchFilter] = useState<string>("all");
  const [returnsDateFilter, setReturnsDateFilter] = useState<string>("all");
  const [returnsStartDate, setReturnsStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return date.toISOString().split("T")[0];
  });
  const [returnsEndDate, setReturnsEndDate] = useState(() => {
    return new Date().toISOString().split("T")[0];
  });

  // Daily report dates
  const { startDate, endDate } = useMemo(() => {
    const date = new Date(selectedDate + "T00:00:00-05:00");
    const start = date.getTime();
    const end = start + 24 * 60 * 60 * 1000;
    return { startDate: start, endDate: end };
  }, [selectedDate]);

  // Date range for vendor reports
  const { rangeStart, rangeEnd } = useMemo(() => {
    const startDateObj = new Date(rangeStartDate + "T00:00:00-05:00");
    const endDateObj = new Date(rangeEndDate + "T23:59:59-05:00");
    return { rangeStart: startDateObj.getTime(), rangeEnd: endDateObj.getTime() };
  }, [rangeStartDate, rangeEndDate]);

  // Queries
  const trucks = useQuery(api.queries.getTrucksForReport, { startDate, endDate });
  const vendorReport = useQuery(
    api.queries.getVendorDateRangeReport,
    reportType === "vendor-range" ? { startDate: rangeStart, endDate: rangeEnd, vendor: selectedVendor === "all" ? undefined : selectedVendor } : "skip"
  );
  const allVendors = useQuery(api.queries.getAllVendors);
  const matchedStats = useQuery(api.queries.getMatchedScanStats, { startDate, endDate });
  const unmatchedScans = useQuery(
    api.queries.getUnmatchedScansReport,
    showUnmatchedModal ? {} : "skip"
  );
  const noVendorKnownReport = useQuery(
    api.queries.getNoVendorKnownReport,
    showNoVendorKnownModal ? {} : "skip"
  );
  const noVendorKnownCount = useQuery(api.queries.getNoVendorKnownCount);
  const userAccuracyStats = useQuery(
    api.queries.getUserAccuracyStats,
    showUserAccuracyModal ? {} : "skip"
  );
  const duplicateOffendersReport = useQuery(
    api.queries.getDuplicateScansReport,
    showDuplicateOffendersModal ? {} : "skip"
  );
  const simpleTireDupsReport = useQuery(
    api.queries.getSimpleTireUPSDuplicates,
    showSimpleTireDupsModal ? { startDate: rangeStart, endDate: rangeEnd } : "skip"
  );
  // Calculate date range for returns export
  const returnsDateRange = useMemo(() => {
    if (returnsDateFilter === "all") return { startDate: undefined, endDate: undefined };

    const now = new Date();
    let start: Date;
    let end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    if (returnsDateFilter === "today") {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    } else if (returnsDateFilter === "week") {
      start = new Date(now);
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
    } else if (returnsDateFilter === "month") {
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    } else if (returnsDateFilter === "custom") {
      start = new Date(returnsStartDate + "T00:00:00");
      end = new Date(returnsEndDate + "T23:59:59");
    } else {
      return { startDate: undefined, endDate: undefined };
    }

    return { startDate: start.getTime(), endDate: end.getTime() };
  }, [returnsDateFilter, returnsStartDate, returnsEndDate]);

  const returnsExportData = useQuery(
    api.exportQueries.getReturnItemsForExport,
    showReturnsExportModal ? {
      status: returnsStatusFilter === "all" ? undefined : returnsStatusFilter,
      batchId: returnsBatchFilter === "all" ? undefined : returnsBatchFilter as any,
      startDate: returnsDateRange.startDate,
      endDate: returnsDateRange.endDate,
    } : "skip"
  );

  const returnsBatchesList = useQuery(
    api.exportQueries.getReturnBatchesForExport,
    showReturnsExportModal ? {} : "skip"
  );

  const autoCloseAll = useMutation(api.mutations.autoCloseAllTrucks);
  const adminCloseTruck = useMutation(api.mutations.adminCloseTruck);

  const [closing, setClosing] = useState<string | null>(null);
  const [closingAll, setClosingAll] = useState(false);

  const handleCloseTruck = async (truckId: string) => {
    setClosing(truckId);
    await adminCloseTruck({ truckId: truckId as any });
    setClosing(null);
  };

  const handleCloseAll = async () => {
    if (!confirm("Close all open trucks? This cannot be undone.")) return;
    setClosingAll(true);
    const result = await autoCloseAll({});
    alert(`Closed ${result.closed} trucks`);
    setClosingAll(false);
  };

  const generateCSV = (truck: any, vendor: string) => {
    const scans = truck.byVendor[vendor] || [];
    if (scans.length === 0) return;

    const headers = ["Tracking Number", "Carrier", "Qty", "Location", "Scanned At", "Vendor Account"];
    const rows = scans.map((s: any) => [
      s.trackingNumber || "", s.carrier || "", String(s.quantity ?? 1), getLocationName(truck.locationId), new Date(s.scannedAt).toLocaleString(), s.vendorAccount || "",
    ]);

    const csv = [headers.join(","), ...rows.map((r: string[]) => r.map(v => `"${v}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${truck.truckNumber}_${vendor.replace(/\s+/g, "_")}_${selectedDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const generateVendorRangeCSV = (vendorName: string) => {
    if (!vendorReport?.byVendor) return;
    const scans = vendorReport.byVendor[vendorName] || [];
    const headers = ["Tracking Number", "Carrier", "Qty", "Location", "Scanned At", "Vendor Account", "Truck"];
    const rows = scans.map((s: any) => [
      s.trackingNumber || "", s.carrier || "", String(s.quantity ?? 1), getLocationName(s.locationId || ""), new Date(s.scannedAt).toLocaleString(), s.vendorAccount || "", s.truckNumber || "",
    ]);

    const csv = [headers.join(","), ...rows.map((r: string[]) => r.map(v => `"${v}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${vendorName.replace(/\s+/g, "_")}_${rangeStartDate}_to_${rangeEndDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const generateAllVendorsRangeCSV = () => {
    if (!vendorReport?.vendors || !vendorReport?.byVendor) return;

    const headers = ["Vendor", "Tracking Number", "Carrier", "Qty", "Location", "Scanned At", "Vendor Account", "Truck"];
    const rows: string[][] = [];

    for (const v of vendorReport.vendors) {
      const scans = vendorReport.byVendor[v.vendor] || [];
      for (const s of scans) {
        rows.push([
          v.vendor, s.trackingNumber || "", s.carrier || "", String(s.quantity ?? 1), getLocationName(s.locationId || ""), new Date(s.scannedAt).toLocaleString(), s.vendorAccount || "", s.truckNumber || "",
        ]);
      }
    }

    const csv = [headers.join(","), ...rows.map(r => r.map(v => `"${v}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `all_vendors_${rangeStartDate}_to_${rangeEndDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const generateAllCSVsForTruck = (truck: any) => {
    const headers = ["Vendor", "Tracking Number", "Carrier", "Qty", "Location", "Scanned At", "Vendor Account"];
    const rows: string[][] = [];

    for (const vendor of Object.keys(truck.byVendor).sort()) {
      const scans = truck.byVendor[vendor] || [];
      for (const s of scans) {
        rows.push([
          vendor, s.trackingNumber || "", s.carrier || "", String(s.quantity ?? 1), getLocationName(truck.locationId), new Date(s.scannedAt).toLocaleString(), s.vendorAccount || "",
        ]);
      }
    }

    if (rows.length === 0) return;

    const csv = [headers.join(","), ...rows.map(r => r.map(v => `"${v}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${truck.truckNumber}_all_vendors_${selectedDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  };

  const formatDateDisplay = (dateStr: string) => {
    const date = new Date(dateStr + "T12:00:00");
    return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };

  const formatDateRange = () => {
    const start = new Date(rangeStartDate + "T12:00:00");
    const end = new Date(rangeEndDate + "T12:00:00");
    return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  };

  const openTrucks = trucks?.filter((t) => t.status === "open") || [];
  const closedTrucks = (trucks?.length || 0) - openTrucks.length;
  const totalScans = trucks?.reduce((sum, t) => sum + t.scanCount, 0) || 0;

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      {/* Header */}
      <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-xl sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/"
                className="w-10 h-10 bg-slate-800/80 hover:bg-slate-700 border border-slate-700/50 rounded-xl flex items-center justify-center transition-all hover:scale-105 hover:border-slate-600"
              >
                <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
                  Reports
                </h1>
                <p className="text-slate-500 text-xs">Generate vendor manifests & reports</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Export Returns Button */}
              <button
                onClick={() => setShowReturnsExportModal(true)}
                className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 rounded-xl text-sm font-medium shadow-lg shadow-emerald-500/20 transition-all hover:scale-105 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export Returns
              </button>

              {/* Report Type Toggle */}
              <div className="flex items-center gap-2 bg-slate-800/60 p-1 rounded-xl border border-slate-700/50">
                <button
                  onClick={() => setReportType("daily")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    reportType === "daily"
                      ? "bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg"
                      : "text-slate-400 hover:text-white hover:bg-slate-700/50"
                  }`}
                >
                  Daily
                </button>
                <button
                  onClick={() => setReportType("vendor-range")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    reportType === "vendor-range"
                      ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg"
                      : "text-slate-400 hover:text-white hover:bg-slate-700/50"
                  }`}
                >
                  Vendor Range
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {reportType === "daily" ? (
          <>
            {/* Daily Report Controls */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-3">
                {/* Date Picker */}
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="pl-10 pr-4 py-2.5 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm text-white focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all cursor-pointer hover:border-slate-600"
                  />
                </div>
                <span className="text-slate-400 text-sm hidden sm:block">{formatDateDisplay(selectedDate)}</span>
              </div>

              {/* Close All Button */}
              {openTrucks.length > 0 && (
                <button
                  onClick={handleCloseAll}
                  disabled={closingAll}
                  className="px-4 py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 rounded-xl text-sm font-medium shadow-lg shadow-amber-500/20 transition-all hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 flex items-center gap-2"
                >
                  {closingAll ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  )}
                  Close All ({openTrucks.length})
                </button>
              )}
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl p-4 hover:border-slate-600/50 transition-all">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-slate-700/50 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{trucks?.length || 0}</p>
                    <p className="text-slate-500 text-xs">Trucks</p>
                  </div>
                </div>
              </div>

              <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl p-4 hover:border-yellow-500/30 transition-all">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-yellow-500/10 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-yellow-400">{openTrucks.length}</p>
                    <p className="text-slate-500 text-xs">Open</p>
                  </div>
                </div>
              </div>

              <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl p-4 hover:border-emerald-500/30 transition-all">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-emerald-400">{closedTrucks}</p>
                    <p className="text-slate-500 text-xs">Closed</p>
                  </div>
                </div>
              </div>

              <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl p-4 hover:border-cyan-500/30 transition-all">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-cyan-500/10 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-cyan-400">{totalScans.toLocaleString()}</p>
                    <p className="text-slate-500 text-xs">Scans</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Matched Scans Stats - subtle display with breakdown */}
            {matchedStats && (
              <div className="flex flex-wrap items-center gap-4 mb-6 text-xs text-slate-500">
                <span>
                  Vendor Match Rate:{" "}
                  {matchedStats.daily.total > 0 ? (
                    <span className="text-slate-400">
                      {((matchedStats.daily.matched / matchedStats.daily.total) * 100).toFixed(2)}% selected ({matchedStats.daily.matched}/{matchedStats.daily.total})
                    </span>
                  ) : (
                    <span className="text-slate-600">no scans for date</span>
                  )}
                  <span className="text-slate-600 mx-1">|</span>
                  <span className="text-slate-400">
                    {matchedStats.overall.total > 0
                      ? ((matchedStats.overall.matched / matchedStats.overall.total) * 100).toFixed(2)
                      : "0.00"}% overall ({matchedStats.overall.matched.toLocaleString()}/{matchedStats.overall.total.toLocaleString()})
                  </span>
                </span>
                {matchedStats.overall.unmatchedBreakdown && matchedStats.overall.unmatchedBreakdown.total > 0 && (
                  <button
                    onClick={() => setShowUnmatchedModal(true)}
                    className="text-slate-600 hover:text-slate-400 transition-colors underline decoration-dotted underline-offset-2"
                  >
                    (Unmatched: {matchedStats.overall.unmatchedBreakdown.ups > 0 && <span className="text-yellow-500/70">{matchedStats.overall.unmatchedBreakdown.ups} UPS</span>}
                    {matchedStats.overall.unmatchedBreakdown.ups > 0 && matchedStats.overall.unmatchedBreakdown.fedexUnmapped > 0 && ", "}
                    {matchedStats.overall.unmatchedBreakdown.fedexUnmapped > 0 && <span className="text-orange-500/70">{matchedStats.overall.unmatchedBreakdown.fedexUnmapped} FedEx unmapped</span>}
                    {(matchedStats.overall.unmatchedBreakdown.ups > 0 || matchedStats.overall.unmatchedBreakdown.fedexUnmapped > 0) && matchedStats.overall.unmatchedBreakdown.other > 0 && ", "}
                    {matchedStats.overall.unmatchedBreakdown.other > 0 && <span className="text-red-500/70">{matchedStats.overall.unmatchedBreakdown.other} other</span>})
                  </button>
                )}
                {noVendorKnownCount !== undefined && noVendorKnownCount > 0 && (
                  <button
                    onClick={() => setShowNoVendorKnownModal(true)}
                    className="text-purple-500/70 hover:text-purple-400 transition-colors underline decoration-dotted underline-offset-2"
                  >
                    | No Vendor Known: {noVendorKnownCount}
                  </button>
                )}
                <button
                  onClick={() => setShowUserAccuracyModal(true)}
                  className="text-emerald-500/70 hover:text-emerald-400 transition-colors underline decoration-dotted underline-offset-2"
                >
                  | User Accuracy
                </button>
                <button
                  onClick={() => setShowDuplicateOffendersModal(true)}
                  className="text-amber-500/70 hover:text-amber-400 transition-colors underline decoration-dotted underline-offset-2"
                >
                  | Duplicate Offenders
                </button>
                <button
                  onClick={() => setShowSimpleTireDupsModal(true)}
                  className="text-orange-500/70 hover:text-orange-400 transition-colors underline decoration-dotted underline-offset-2"
                >
                  | Simple Tire UPS Reuse
                </button>
                <button
                  onClick={() => setShowReturnsExportModal(true)}
                  className="text-teal-500/70 hover:text-teal-400 transition-colors underline decoration-dotted underline-offset-2"
                >
                  | Export Returns
                </button>
              </div>
            )}

            {/* Trucks Table */}
            <div className="bg-slate-800/30 backdrop-blur border border-slate-700/30 rounded-2xl overflow-hidden shadow-xl">
              {trucks === undefined ? (
                <div className="flex items-center justify-center py-20">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-slate-500 text-sm">Loading trucks...</p>
                  </div>
                </div>
              ) : trucks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                  <svg className="w-16 h-16 mb-4 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                  <p className="text-lg font-medium mb-1">No trucks found</p>
                  <p className="text-sm">No trucks were opened on {formatDateDisplay(selectedDate)}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-slate-900/50 border-b border-slate-700/50">
                        <th className="px-5 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Truck</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider hidden sm:table-cell">Location</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider hidden sm:table-cell">Carrier</th>
                        <th className="px-5 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                        <th className="px-5 py-4 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">Scans</th>
                        <th className="px-5 py-4 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">Vendors</th>
                        <th className="px-5 py-4 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/30">
                      {trucks.map((truck) => (
                        <React.Fragment key={truck._id}>
                          <tr className="hover:bg-slate-800/50 transition-colors group">
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-3">
                                <div className={`w-2 h-2 rounded-full ${truck.status === "open" ? "bg-yellow-400 animate-pulse" : "bg-emerald-400"}`} />
                                <div>
                                  <p className="font-semibold text-white">{truck.truckNumber}</p>
                                  <p className="text-slate-500 text-xs mt-0.5">
                                    {formatTime(truck.openedAt)}
                                    {truck.closedAt && (
                                      <span className="text-slate-600"> — {formatTime(truck.closedAt)}</span>
                                    )}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="px-5 py-4 text-slate-400 hidden sm:table-cell">{getLocationName(truck.locationId)}</td>
                            <td className="px-5 py-4 text-slate-400 hidden sm:table-cell">{truck.carrier}</td>
                            <td className="px-5 py-4">
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${
                                truck.status === "open"
                                  ? "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
                                  : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              }`}>
                                {truck.status === "open" ? (
                                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" /></svg>
                                ) : (
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                                )}
                                {truck.status}
                              </span>
                            </td>
                            <td className="px-5 py-4 text-center">
                              <span className="text-white font-medium">{truck.scanCount}</span>
                            </td>
                            <td className="px-5 py-4 text-center">
                              <button
                                onClick={() => setExpandedTruck(expandedTruck === truck._id ? null : truck._id)}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                                  expandedTruck === truck._id
                                    ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                                    : "bg-slate-700/50 text-slate-300 hover:bg-slate-700 border border-slate-600/50"
                                }`}
                              >
                                {truck.vendors.length}
                                <svg className={`w-3.5 h-3.5 transition-transform ${expandedTruck === truck._id ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex items-center justify-end gap-2">
                                {truck.status === "open" && (
                                  <button
                                    onClick={() => handleCloseTruck(truck._id)}
                                    disabled={closing === truck._id}
                                    className="px-3 py-1.5 bg-yellow-600/20 hover:bg-yellow-600 text-yellow-400 hover:text-white rounded-lg text-xs font-medium transition-all border border-yellow-600/30 hover:border-yellow-600 disabled:opacity-50"
                                  >
                                    {closing === truck._id ? (
                                      <div className="w-3 h-3 border-2 border-yellow-400/30 border-t-yellow-400 rounded-full animate-spin" />
                                    ) : (
                                      "Close"
                                    )}
                                  </button>
                                )}
                                <button
                                  onClick={() => generateAllCSVsForTruck(truck)}
                                  className="px-3 py-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-lg text-xs font-medium transition-all shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30 hover:scale-105 flex items-center gap-1.5"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                  </svg>
                                  Export
                                </button>
                              </div>
                            </td>
                          </tr>

                          {/* Expanded Vendors Row */}
                          {expandedTruck === truck._id && (
                            <tr className="bg-slate-900/30">
                              <td colSpan={7} className="px-5 py-4">
                                <div className="flex flex-wrap gap-2">
                                  {truck.vendors.map((vendor: string) => {
                                    const count = (truck.byVendor[vendor] || []).length;
                                    return (
                                      <button
                                        key={vendor}
                                        onClick={() => generateCSV(truck, vendor)}
                                        className="group/btn flex items-center gap-2 px-4 py-2 bg-slate-800/80 hover:bg-slate-700 border border-slate-700/50 hover:border-slate-600 rounded-xl transition-all hover:scale-105"
                                      >
                                        <span className="text-sm font-medium text-slate-200 group-hover/btn:text-white">{vendor}</span>
                                        <span className="text-xs text-slate-500 bg-slate-900/50 px-2 py-0.5 rounded-md">{count}</span>
                                        <svg className="w-4 h-4 text-slate-500 group-hover/btn:text-cyan-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                        </svg>
                                      </button>
                                    );
                                  })}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Vendor Date Range Report */}
            <div className="flex flex-wrap items-center gap-4 mb-6">
              {/* Date Range */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <input
                    type="date"
                    value={rangeStartDate}
                    onChange={(e) => setRangeStartDate(e.target.value)}
                    className="pl-10 pr-3 py-2.5 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm text-white focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 transition-all cursor-pointer hover:border-slate-600"
                  />
                </div>
                <span className="text-slate-500">to</span>
                <input
                  type="date"
                  value={rangeEndDate}
                  onChange={(e) => setRangeEndDate(e.target.value)}
                  className="px-3 py-2.5 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm text-white focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 transition-all cursor-pointer hover:border-slate-600"
                />
              </div>

              {/* Vendor Filter */}
              <div className="relative">
                <select
                  value={selectedVendor}
                  onChange={(e) => setSelectedVendor(e.target.value)}
                  className="px-4 py-2.5 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm text-white focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 transition-all cursor-pointer hover:border-slate-600 appearance-none pr-10"
                >
                  <option value="all">All Vendors</option>
                  {allVendors?.map((v: string) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* Export All Button */}
              {vendorReport && vendorReport.totalScans > 0 && (
                <button
                  onClick={generateAllVendorsRangeCSV}
                  className="ml-auto px-4 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-xl text-sm font-medium shadow-lg shadow-purple-500/20 transition-all hover:scale-105 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Export All
                </button>
              )}
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
              <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl p-4 hover:border-purple-500/30 transition-all">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-purple-300">{formatDateRange()}</p>
                    <p className="text-slate-500 text-xs">Date Range</p>
                  </div>
                </div>
              </div>

              <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl p-4 hover:border-pink-500/30 transition-all">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-pink-500/10 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-pink-400">{vendorReport?.vendors?.length || 0}</p>
                    <p className="text-slate-500 text-xs">Vendors</p>
                  </div>
                </div>
              </div>

              <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl p-4 hover:border-cyan-500/30 transition-all">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-cyan-500/10 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-cyan-400">{vendorReport?.totalScans?.toLocaleString() || 0}</p>
                    <p className="text-slate-500 text-xs">Total Scans</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Vendor List */}
            <div className="bg-slate-800/30 backdrop-blur border border-slate-700/30 rounded-2xl overflow-hidden shadow-xl">
              {vendorReport === undefined ? (
                <div className="flex items-center justify-center py-20">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-slate-500 text-sm">Loading vendor report...</p>
                  </div>
                </div>
              ) : !vendorReport?.vendors?.length ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                  <svg className="w-16 h-16 mb-4 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  <p className="text-lg font-medium mb-1">No vendor data found</p>
                  <p className="text-sm">No scans recorded for this date range</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-700/30">
                  {vendorReport.vendors.map((v: any) => {
                    const vendorScans = vendorReport.byVendor?.[v.vendor] || [];
                    return (
                      <div key={v.vendor} className="group">
                        <div
                          onClick={() => setExpandedVendor(expandedVendor === v.vendor ? null : v.vendor)}
                          className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-800/50 transition-colors"
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-xl flex items-center justify-center">
                              <span className="text-lg font-bold text-purple-300">{v.vendor.charAt(0)}</span>
                            </div>
                            <div>
                              <p className="font-semibold text-white">{v.vendor}</p>
                              <p className="text-slate-500 text-xs">{v.count.toLocaleString()} scans</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                generateVendorRangeCSV(v.vendor);
                              }}
                              className="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-lg text-xs font-medium transition-all hover:scale-105 flex items-center gap-1.5 opacity-0 group-hover:opacity-100"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              CSV
                            </button>
                            <svg className={`w-5 h-5 text-slate-500 transition-transform ${expandedVendor === v.vendor ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                        </div>

                        {/* Expanded Scans */}
                        {expandedVendor === v.vendor && (
                          <div className="bg-slate-900/30 border-t border-slate-700/30 px-5 py-4">
                            <div className="max-h-96 overflow-y-auto">
                              <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-slate-900">
                                  <tr className="text-slate-500 text-xs">
                                    <th className="text-left py-2 px-2">Tracking</th>
                                    <th className="text-left py-2 px-2">Location</th>
                                    <th className="text-left py-2 px-2">Truck</th>
                                    <th className="text-left py-2 px-2">Scanned</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800">
                                  {vendorScans.slice(0, 100).map((scan: any, i: number) => (
                                    <tr key={i} className="text-slate-300 hover:bg-slate-800/30">
                                      <td className="py-2 px-2 font-mono text-xs">{scan.trackingNumber}</td>
                                      <td className="py-2 px-2 text-xs">{getLocationName(scan.locationId || "")}</td>
                                      <td className="py-2 px-2">{scan.truckNumber}</td>
                                      <td className="py-2 px-2 text-slate-500 text-xs">{new Date(scan.scannedAt).toLocaleDateString()}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {vendorScans.length > 100 && (
                                <p className="text-center text-slate-500 text-xs py-3">
                                  Showing 100 of {vendorScans.length.toLocaleString()} scans. Export CSV for full list.
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* Footer Info */}
        <div className="mt-6 text-center text-slate-600 text-xs">
          <p>Trucks auto-close at midnight EST daily</p>
        </div>
      </div>

      {/* Unmatched Scans Modal */}
      {showUnmatchedModal && (
        <UnmatchedScansModal
          onClose={() => setShowUnmatchedModal(false)}
          data={unmatchedScans}
        />
      )}

      {/* No Vendor Known Modal */}
      {showNoVendorKnownModal && (
        <NoVendorKnownModal
          onClose={() => setShowNoVendorKnownModal(false)}
          data={noVendorKnownReport}
        />
      )}

      {/* User Accuracy Modal */}
      {showUserAccuracyModal && (
        <UserAccuracyModal
          onClose={() => setShowUserAccuracyModal(false)}
          data={userAccuracyStats}
        />
      )}

      {/* Duplicate Offenders Modal */}
      {showDuplicateOffendersModal && (
        <DuplicateOffendersModal
          onClose={() => setShowDuplicateOffendersModal(false)}
          data={duplicateOffendersReport}
        />
      )}

      {/* Simple Tire UPS Reuse Modal */}
      {showSimpleTireDupsModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-xl max-w-3xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <div>
                <h2 className="text-lg font-bold text-white">Simple Tire UPS Reuse Report</h2>
                <p className="text-slate-400 text-sm mt-1">
                  UPS tracking numbers reused by Simple Tire (evidence for vendor fix)
                </p>
              </div>
              <button onClick={() => setShowSimpleTireDupsModal(false)} className="text-slate-400 hover:text-white text-xl">x</button>
            </div>
            <div className="p-5 overflow-y-auto flex-1">
              {!simpleTireDupsReport ? (
                <p className="text-slate-400 text-center py-8">Loading...</p>
              ) : simpleTireDupsReport.totalReusedTrackingNumbers === 0 ? (
                <p className="text-slate-400 text-center py-8">No reused tracking numbers found in this date range.</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4 mb-5">
                    <div className="bg-slate-900/50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-orange-400">{simpleTireDupsReport.totalReusedTrackingNumbers}</div>
                      <div className="text-xs text-slate-500">Reused Tracking #s</div>
                    </div>
                    <div className="bg-slate-900/50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-orange-400">{simpleTireDupsReport.totalAffectedScans}</div>
                      <div className="text-xs text-slate-500">Total Affected Scans</div>
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-800">
                      <tr className="text-slate-500 text-xs">
                        <th className="text-left py-2 px-2">Tracking Number</th>
                        <th className="text-center py-2 px-2">Times Used</th>
                        <th className="text-left py-2 px-2">Trucks</th>
                        <th className="text-left py-2 px-2">First / Last Scan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                      {simpleTireDupsReport.duplicates.map((d: any, i: number) => (
                        <tr key={i} className="text-slate-300 hover:bg-slate-700/30">
                          <td className="py-2 px-2 font-mono text-xs">{d.trackingNumber}</td>
                          <td className="py-2 px-2 text-center font-bold text-orange-400">{d.count}</td>
                          <td className="py-2 px-2 text-xs">{d.trucks.join(", ")}</td>
                          <td className="py-2 px-2 text-xs text-slate-500">
                            {new Date(d.appearances[0]?.scannedAt).toLocaleString()} &mdash; {new Date(d.appearances[d.appearances.length - 1]?.scannedAt).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button
                    onClick={() => {
                      const headers = ["Tracking Number", "Times Used", "Trucks", "First Scan", "Last Scan"];
                      const rows = simpleTireDupsReport.duplicates.map((d: any) => [
                        d.trackingNumber, String(d.count), d.trucks.join(" / "),
                        new Date(d.appearances[0]?.scannedAt).toLocaleString(),
                        new Date(d.appearances[d.appearances.length - 1]?.scannedAt).toLocaleString(),
                      ]);
                      const csv = [headers.join(","), ...rows.map((r: string[]) => r.map(v => `"${v}"`).join(","))].join("\n");
                      const blob = new Blob([csv], { type: "text/csv" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `simple_tire_ups_reuse_${rangeStartDate}_to_${rangeEndDate}.csv`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="mt-4 px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-sm font-medium"
                  >
                    Download CSV
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Returns Export Modal */}
      {showReturnsExportModal && (
        <ReturnsExportModal
          onClose={() => setShowReturnsExportModal(false)}
          data={returnsExportData}
          batches={returnsBatchesList}
          statusFilter={returnsStatusFilter}
          batchFilter={returnsBatchFilter}
          dateFilter={returnsDateFilter}
          startDate={returnsStartDate}
          endDate={returnsEndDate}
          onStatusChange={setReturnsStatusFilter}
          onBatchChange={setReturnsBatchFilter}
          onDateFilterChange={setReturnsDateFilter}
          onStartDateChange={setReturnsStartDate}
          onEndDateChange={setReturnsEndDate}
        />
      )}
    </main>
  );
}

export default function Reports() {
  return (
    <Protected>
      <ReportsPage />
    </Protected>
  );
}
