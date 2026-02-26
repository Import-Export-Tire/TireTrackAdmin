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

function BonusesDashboard() {
  const overrideBonus = useMutation(api.mutations.overrideReceivingBonus);
  const [locationFilter, setLocationFilter] = useState("all");
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
  });

  const filteredData = useMemo(() => {
    if (!bonusData) return [];
    if (locationFilter === "all") return bonusData;
    const loc = LOCATION_OPTIONS.find((l) => l.shortId === locationFilter);
    if (!loc) return bonusData;
    return bonusData.filter((t) => t.locationId === loc.id);
  }, [bonusData, locationFilter]);

  const stats = useMemo(() => {
    if (!filteredData) return { shipping: 0, receiving: 0, earned: 0, missed: 0 };
    return {
      shipping: filteredData.filter((t) => t.type === "shipping").length,
      receiving: filteredData.filter((t) => t.type === "receiving").length,
      earned: filteredData.filter((t) => t.bonusEarned === true).length,
      missed: filteredData.filter((t) => t.bonusEarned === false).length,
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
                <p className="text-xs text-slate-500">Shipping &amp; Receiving Bonus Reports</p>
              </div>
            </div>
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
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Shipping Trucks</p>
            <p className="text-2xl font-bold text-blue-400 mt-1">{stats.shipping}</p>
          </div>
          <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Receiving Trucks</p>
            <p className="text-2xl font-bold text-purple-400 mt-1">{stats.receiving}</p>
          </div>
          <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Bonuses Earned</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{stats.earned}</p>
          </div>
          <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Bonuses Missed</p>
            <p className="text-2xl font-bold text-red-400 mt-1">{stats.missed}</p>
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
                  <th className="text-left px-4 py-3 text-xs text-slate-500 uppercase tracking-wider font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {!bonusData && (
                  <tr>
                    <td colSpan={9} className="text-center py-12 text-slate-500">
                      Loading...
                    </td>
                  </tr>
                )}
                {filteredData?.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center py-12 text-slate-500">
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
                          : "bg-purple-500/20 text-purple-400 border border-purple-500/20"
                      }`}>
                        {truck.type === "shipping" ? "Shipping" : "Receiving"}
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
                          {truck.type === "receiving" && (
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
                          {truck.type === "receiving" && (
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
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        truck.status === "open"
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/20"
                          : "bg-slate-600/20 text-slate-400 border border-slate-600/20"
                      }`}>
                        {truck.status}
                      </span>
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
