"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useState, useMemo } from "react";
import { Protected } from "../protected";
import Link from "next/link";

const LOCATION_OPTIONS = [
  { id: "kj7q0v1qxbf6z1b1h2cjhf4m8h74vjbe", name: "Latrobe", shortId: "latrobe" },
  { id: "kj74zfr66q23wgv5xc3qdc0a6s74vvtr", name: "Everson", shortId: "everson" },
  { id: "kj70r8fvdeg83dhapvp91kqs2574vqng", name: "Chestnut", shortId: "chestnut" },
];

function getLocationName(locationId: string): string {
  const loc = LOCATION_OPTIONS.find((l) => l.id === locationId);
  return loc?.name ?? locationId;
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function printBonusReport(
  data: any[],
  dateRange: { start: string; end: string },
  locationLabel: string,
  stats: { shipping: number; outbound: number; receiving: number; earned: number; missed: number; totalBonus: number }
) {
  const fmtDate = (ts: number) =>
    new Date(ts).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const fmtDur = (ms: number) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };
  const locName = (id: string) => LOCATION_OPTIONS.find((l) => l.id === id)?.name ?? id;

  const shipping = data.filter((t) => t.type === "shipping");
  const outbound = data.filter((t) => t.type === "outbound");
  const receiving = data.filter((t) => t.type === "receiving");
  const recEarned = [...receiving, ...outbound].filter((t) => t.bonusEarned === true).length;
  const recMissed = [...receiving, ...outbound].filter((t) => t.bonusEarned === false).length;

  // Collect unique helper names across all entries for the helpers summary
  const helperMap: Record<string, { shipping: number; outbound: number; receiving: number; earned: number; totalAmount: number }> = {};
  data.forEach((t) => {
    t.helpers.forEach((name: string) => {
      if (!helperMap[name]) helperMap[name] = { shipping: 0, outbound: 0, receiving: 0, earned: 0, totalAmount: 0 };
      if (t.type === "shipping") {
        helperMap[name].shipping++;
        if (t.bonusEarned === true) {
          helperMap[name].earned++;
          helperMap[name].totalAmount += (t.bonusAmount ?? 0) / Math.max(1, t.helpers.length);
        }
      } else if (t.type === "outbound") {
        helperMap[name].outbound++;
        if (t.bonusEarned === true) {
          helperMap[name].earned++;
          helperMap[name].totalAmount += (t.bonusAmount ?? 0) / Math.max(1, t.helpers.length);
        }
      } else {
        helperMap[name].receiving++;
        if (t.bonusEarned === true) {
          helperMap[name].earned++;
          helperMap[name].totalAmount += (t.bonusAmount ?? 0) / Math.max(1, t.helpers.length);
        }
      }
    });
  });
  const helperNames = Object.keys(helperMap).sort();

  const shippingRows = shipping.map((t: any) => `<tr>
    <td>${fmtDate(t.openedAt)}</td>
    <td>${t.truckNumber}</td>
    <td>${t.truckLength ?? "-"}</td>
    <td>${t.helpers.length > 0 ? t.helpers.join(", ") : "-"}</td>
    <td>${t.duration ? fmtDur(t.duration) : "In progress"}</td>
    <td>${locName(t.locationId)}</td>
    <td style="text-align:right">$${t.bonusAmount ?? 0}</td>
  </tr>`).join("");

  const outboundRows = outbound.map((t: any) => `<tr>
    <td>${fmtDate(t.openedAt)}</td>
    <td>${t.truckNumber}</td>
    <td>${t.truckLength ?? "-"}</td>
    <td>${t.helpers.length > 0 ? t.helpers.join(", ") : "-"}</td>
    <td>${t.duration ? fmtDur(t.duration) : "In progress"}</td>
    <td>${locName(t.locationId)}</td>
    <td style="text-align:center;font-weight:700;${t.bonusEarned === true ? "color:#16a34a" : t.bonusEarned === false ? "color:#dc2626" : ""}">${t.bonusEarned === true ? "YES" : t.bonusEarned === false ? "NO" : "-"}</td>
    <td style="text-align:right">$${t.bonusAmount ?? 0}</td>
  </tr>`).join("");

  const receivingRows = receiving.map((t: any) => `<tr>
    <td>${fmtDate(t.openedAt)}</td>
    <td>${t.truckNumber}</td>
    <td>${t.truckLength ?? "-"}</td>
    <td>${t.helpers.length > 0 ? t.helpers.join(", ") : "-"}</td>
    <td>${t.duration ? fmtDur(t.duration) : "In progress"}</td>
    <td>${locName(t.locationId)}</td>
    <td style="text-align:center;font-weight:700;${t.bonusEarned === true ? "color:#16a34a" : t.bonusEarned === false ? "color:#dc2626" : ""}">${t.bonusEarned === true ? "YES" : t.bonusEarned === false ? "NO" : "-"}</td>
    <td style="text-align:right">$${t.bonusAmount ?? 0}</td>
  </tr>`).join("");

  const helperRows = helperNames.map((name) => {
    const h = helperMap[name];
    return `<tr>
      <td style="font-weight:600">${name}</td>
      <td style="text-align:center">${h.shipping}</td>
      <td style="text-align:center">${h.outbound}</td>
      <td style="text-align:center">${h.receiving}</td>
      <td style="text-align:center;font-weight:700;color:#16a34a">${h.earned}</td>
      <td style="text-align:right;font-weight:700">$${Math.round(h.totalAmount)}</td>
    </tr>`;
  }).join("");

  const grandTotal = data.reduce((sum: number, t: any) => sum + (t.bonusAmount ?? 0), 0);

  const html = `<!DOCTYPE html>
<html><head><title>Bonus Report</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; padding: 40px; font-size: 12px; }
  .header { text-align: center; margin-bottom: 24px; border-bottom: 2px solid #111; padding-bottom: 16px; }
  .header h1 { font-size: 22px; font-weight: 700; margin-bottom: 2px; }
  .header h2 { font-size: 14px; font-weight: 400; color: #555; margin-bottom: 8px; }
  .header .meta { font-size: 12px; color: #666; }
  .stats { display: flex; justify-content: space-between; margin-bottom: 24px; border: 1px solid #ccc; border-radius: 4px; }
  .stat { flex: 1; text-align: center; padding: 12px 8px; }
  .stat:not(:last-child) { border-right: 1px solid #ccc; }
  .stat .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; margin-bottom: 4px; }
  .stat .value { font-size: 20px; font-weight: 700; }
  .section { margin-bottom: 28px; }
  .section-title { font-size: 15px; font-weight: 700; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 2px solid #111; display: flex; justify-content: space-between; align-items: baseline; }
  .section-title .count { font-size: 12px; font-weight: 400; color: #666; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { background: #f3f4f6; text-align: left; padding: 8px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #d1d5db; }
  td { padding: 7px 10px; border-bottom: 1px solid #e5e7eb; }
  tr:nth-child(even) { background: #f9fafb; }
  .empty { text-align: center; padding: 20px; color: #999; font-style: italic; }
  .footer { margin-top: 24px; text-align: center; font-size: 10px; color: #999; border-top: 1px solid #ddd; padding-top: 12px; }
  .grand-total { text-align: right; font-size: 16px; font-weight: 700; margin-top: 16px; padding: 12px; border: 2px solid #111; border-radius: 4px; }
  @media print { body { padding: 20px; } .section { page-break-inside: avoid; } }
</style></head><body>
<div class="header">
  <h1>Import Export Tire Company</h1>
  <h2>Bonus Report</h2>
  <div class="meta">${dateRange.start} &mdash; ${dateRange.end} &nbsp;|&nbsp; Location: ${locationLabel}</div>
</div>
<div class="stats">
  <div class="stat"><div class="label">Shipping</div><div class="value">${stats.shipping}</div></div>
  <div class="stat"><div class="label">Outbound</div><div class="value">${stats.outbound}</div></div>
  <div class="stat"><div class="label">Receiving</div><div class="value">${stats.receiving}</div></div>
  <div class="stat"><div class="label">Earned</div><div class="value" style="color:#16a34a">${stats.earned}</div></div>
  <div class="stat"><div class="label">Missed</div><div class="value" style="color:#dc2626">${stats.missed}</div></div>
  <div class="stat"><div class="label">Total $</div><div class="value" style="color:#0d9488">$${stats.totalBonus}</div></div>
</div>

<div class="section">
  <div class="section-title">Shipping <span class="count">${shipping.length} truck${shipping.length !== 1 ? "s" : ""}</span></div>
  ${shipping.length > 0 ? `<table>
    <thead><tr>
      <th>Date</th><th>Truck #</th><th>Length</th><th>Helpers</th><th>Duration</th><th>Location</th><th style="text-align:right">Bonus $</th>
    </tr></thead>
    <tbody>${shippingRows}</tbody>
  </table>` : `<div class="empty">No shipping trucks in this period</div>`}
</div>

<div class="section">
  <div class="section-title">Outbound <span class="count">${outbound.length} truck${outbound.length !== 1 ? "s" : ""}</span></div>
  ${outbound.length > 0 ? `<table>
    <thead><tr>
      <th>Date</th><th>Truck #</th><th>Length</th><th>Helpers</th><th>Duration</th><th>Location</th><th style="text-align:center">Bonus</th><th style="text-align:right">Bonus $</th>
    </tr></thead>
    <tbody>${outboundRows}</tbody>
  </table>` : `<div class="empty">No outbound trucks in this period</div>`}
</div>

<div class="section">
  <div class="section-title">Receiving <span class="count">${receiving.length} truck${receiving.length !== 1 ? "s" : ""} &nbsp;&bull;&nbsp; ${recEarned} earned &nbsp;&bull;&nbsp; ${recMissed} missed</span></div>
  ${receiving.length > 0 ? `<table>
    <thead><tr>
      <th>Date</th><th>Truck #</th><th>Length</th><th>Helpers</th><th>Duration</th><th>Location</th><th style="text-align:center">Bonus</th><th style="text-align:right">Bonus $</th>
    </tr></thead>
    <tbody>${receivingRows}</tbody>
  </table>` : `<div class="empty">No receiving trucks in this period</div>`}
</div>

${helperNames.length > 0 ? `<div class="section">
  <div class="section-title">Helper Summary <span class="count">${helperNames.length} helper${helperNames.length !== 1 ? "s" : ""}</span></div>
  <table>
    <thead><tr>
      <th>Name</th><th style="text-align:center">Shipping</th><th style="text-align:center">Outbound</th><th style="text-align:center">Receiving</th><th style="text-align:center">Earned</th><th style="text-align:right">Total $</th>
    </tr></thead>
    <tbody>${helperRows}</tbody>
  </table>
</div>` : ""}

<div class="grand-total">Grand Total Bonus: $${grandTotal}</div>

<div class="footer">Generated ${new Date().toLocaleString()} &nbsp;|&nbsp; TireTrack Admin</div>
</body></html>`;

  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
    w.onload = () => w.print();
  }
}

function BonusesDashboard() {
  const overrideBonus = useMutation(api.mutations.overrideReceivingBonus);
  const deleteBonusEntry = useMutation(api.mutations.deleteBonusEntry);
  const [locationFilter, setLocationFilter] = useState("all");
  const [helperFilter, setHelperFilter] = useState("all");
  const [dateRange, setDateRange] = useState(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return {
      start: start.toISOString().split("T")[0],
      end: end.toISOString().split("T")[0],
    };
  });

  const startTimestamp = new Date(dateRange.start).getTime();
  const endTimestamp = new Date(dateRange.end).setHours(23, 59, 59, 999);

  const bonusData = useQuery(api.queries.getBonusReport, {
    startDate: startTimestamp,
    endDate: endTimestamp,
    helperName: helperFilter !== "all" ? helperFilter : undefined,
  });

  const filteredData = useMemo(() => {
    if (!bonusData) return [];
    if (locationFilter === "all") return bonusData;
    const loc = LOCATION_OPTIONS.find((l) => l.shortId === locationFilter);
    if (!loc) return bonusData;
    return bonusData.filter((t) => t.locationId === loc.id);
  }, [bonusData, locationFilter]);

  // Collect unique helper names for the filter dropdown
  const uniqueHelperNames = useMemo(() => {
    if (!bonusData) return [];
    const names = new Set<string>();
    bonusData.forEach((t) => t.helpers.forEach((h: string) => names.add(h)));
    return Array.from(names).sort();
  }, [bonusData]);

  const stats = useMemo(() => {
    if (!filteredData) return { shipping: 0, outbound: 0, receiving: 0, earned: 0, missed: 0, totalBonus: 0 };
    return {
      shipping: filteredData.filter((t) => t.type === "shipping").length,
      outbound: filteredData.filter((t) => t.type === "outbound").length,
      receiving: filteredData.filter((t) => t.type === "receiving").length,
      earned: filteredData.filter((t) => t.bonusEarned === true).length,
      missed: filteredData.filter((t) => t.bonusEarned === false).length,
      totalBonus: filteredData.reduce((sum, t) => sum + (t.bonusAmount ?? 0), 0),
    };
  }, [filteredData]);

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-slate-900/95 backdrop-blur border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="w-10 h-10 min-h-[44px] min-w-[44px] bg-slate-800/80 hover:bg-slate-700 border border-slate-700/50 rounded-xl flex items-center justify-center transition-all hover:scale-105 hover:border-slate-600"
                aria-label="Back to dashboard"
              >
                <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div>
                <h1 className="text-xl font-bold">Bonus Tracker</h1>
                <p className="text-xs text-slate-500">Shipping, Outbound &amp; Receiving Bonus Reports</p>
              </div>
            </div>
            <button
              onClick={() => {
                const locLabel = locationFilter === "all" ? "All Locations" : (LOCATION_OPTIONS.find((l) => l.shortId === locationFilter)?.name ?? "All");
                printBonusReport(filteredData, dateRange, locLabel, stats);
              }}
              disabled={!filteredData || filteredData.length === 0}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Print Report
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Start Date</label>
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange((d) => ({ ...d, start: e.target.value }))}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">End Date</label>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange((d) => ({ ...d, end: e.target.value }))}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Location</label>
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
            >
              <option value="all">All Locations</option>
              {LOCATION_OPTIONS.map((loc) => (
                <option key={loc.shortId} value={loc.shortId}>{loc.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Helper</label>
            <select
              value={helperFilter}
              onChange={(e) => setHelperFilter(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
            >
              <option value="all">All Helpers</option>
              {uniqueHelperNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Shipping</p>
            <p className="text-2xl font-bold text-blue-400 mt-1">{stats.shipping}</p>
          </div>
          <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Outbound</p>
            <p className="text-2xl font-bold text-amber-400 mt-1">{stats.outbound}</p>
          </div>
          <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Receiving</p>
            <p className="text-2xl font-bold text-purple-400 mt-1">{stats.receiving}</p>
          </div>
          <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Earned</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{stats.earned}</p>
          </div>
          <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Missed</p>
            <p className="text-2xl font-bold text-red-400 mt-1">{stats.missed}</p>
          </div>
          <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Total Bonus $</p>
            <p className="text-2xl font-bold text-teal-400 mt-1">${stats.totalBonus}</p>
          </div>
        </div>

        {/* Table */}
        <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/50">
                  <th className="text-left px-4 py-3 text-xs text-slate-500 uppercase tracking-wider font-medium">Date</th>
                  <th className="text-left px-4 py-3 text-xs text-slate-500 uppercase tracking-wider font-medium">Truck #</th>
                  <th className="text-left px-4 py-3 text-xs text-slate-500 uppercase tracking-wider font-medium">Type</th>
                  <th className="text-left px-4 py-3 text-xs text-slate-500 uppercase tracking-wider font-medium">Length</th>
                  <th className="text-left px-4 py-3 text-xs text-slate-500 uppercase tracking-wider font-medium">Helpers</th>
                  <th className="text-left px-4 py-3 text-xs text-slate-500 uppercase tracking-wider font-medium">Duration</th>
                  <th className="text-left px-4 py-3 text-xs text-slate-500 uppercase tracking-wider font-medium">Location</th>
                  <th className="text-left px-4 py-3 text-xs text-slate-500 uppercase tracking-wider font-medium">Bonus</th>
                  <th className="text-right px-4 py-3 text-xs text-slate-500 uppercase tracking-wider font-medium">Bonus $</th>
                  <th className="text-left px-4 py-3 text-xs text-slate-500 uppercase tracking-wider font-medium">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {!bonusData && (
                  <tr>
                    <td colSpan={11} className="text-center py-12 text-slate-500">
                      Loading...
                    </td>
                  </tr>
                )}
                {filteredData?.length === 0 && (
                  <tr>
                    <td colSpan={11} className="text-center py-12 text-slate-500">
                      No bonus data for the selected date range
                    </td>
                  </tr>
                )}
                {filteredData?.map((truck) => (
                  <tr key={truck._id} className="border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors">
                    <td className="px-4 py-3 text-slate-300 whitespace-nowrap">
                      {formatDate(truck.openedAt)}
                    </td>
                    <td className="px-4 py-3 font-medium text-white">
                      {truck.truckNumber}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        truck.type === "shipping"
                          ? "bg-blue-500/20 text-blue-400 border border-blue-500/20"
                          : truck.type === "outbound"
                            ? "bg-amber-500/20 text-amber-400 border border-amber-500/20"
                            : "bg-purple-500/20 text-purple-400 border border-purple-500/20"
                      }`}>
                        {truck.type === "shipping" ? "Shipping" : truck.type === "outbound" ? "Outbound" : "Receiving"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {truck.truckLength ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      {truck.helpers.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {truck.helpers.map((name: string, i: number) => (
                            <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-700 text-slate-300">
                              {name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-300 whitespace-nowrap">
                      {truck.duration ? formatDuration(truck.duration) : (
                        <span className="text-cyan-400">In progress</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {getLocationName(truck.locationId)}
                    </td>
                    <td className="px-4 py-3">
                      {truck.bonusEarned === true && (
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-400 text-lg" title="Bonus earned">&#x2705;</span>
                          {(truck.type === "receiving" || truck.type === "outbound") && (
                            <button
                              onClick={() => {
                                if (confirm("Revoke this bonus override?")) {
                                  overrideBonus({ receivingTruckId: truck._id as any, bonusEarned: false });
                                }
                              }}
                              className="text-xs text-slate-500 hover:text-red-400 transition-colors"
                              title="Revoke override"
                            >
                              undo
                            </button>
                          )}
                        </div>
                      )}
                      {truck.bonusEarned === false && (
                        <div className="flex items-center gap-2">
                          <span className="text-red-400 text-lg" title="No bonus">&#x274C;</span>
                          {(truck.type === "receiving" || truck.type === "outbound") && (
                            <button
                              onClick={() => {
                                if (confirm(`Override bonus for truck ${truck.truckNumber}? This will mark the bonus as earned despite exceeding the 2-hour window.`)) {
                                  overrideBonus({ receivingTruckId: truck._id as any, bonusEarned: true });
                                }
                              }}
                              className="px-2 py-0.5 text-xs font-medium rounded bg-amber-500/20 text-amber-400 border border-amber-500/20 hover:bg-amber-500/30 transition-colors"
                            >
                              Override
                            </button>
                          )}
                        </div>
                      )}
                      {truck.bonusEarned === null && (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {(truck.bonusAmount ?? 0) > 0 ? (
                        <span className="text-emerald-400 font-medium">${truck.bonusAmount}</span>
                      ) : (
                        <span className="text-slate-600">$0</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        truck.status === "open"
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/20"
                          : "bg-slate-600/20 text-slate-400 border border-slate-600/20"
                      }`}>
                        {truck.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => {
                          if (confirm(`Delete bonus entry for truck ${truck.truckNumber}?`)) {
                            deleteBonusEntry({ entryId: truck._id, type: truck.type as any });
                          }
                        }}
                        className="text-slate-600 hover:text-red-400 transition-colors"
                        title="Delete entry"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BonusesPage() {
  return (
    <Protected>
      <BonusesDashboard />
    </Protected>
  );
}
