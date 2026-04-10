"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useState, useMemo, useEffect, useRef } from "react";
import { Protected } from "../protected";
import { useAuth } from "../auth-context";
import Link from "next/link";

const LOCATION_OPTIONS = [
  { id: "kj7q0v1qxbf6z1b1h2cjhf4m8h74vjbe", name: "Latrobe", shortId: "latrobe", bonusEnabled: false },
  { id: "kj74zfr66q23wgv5xc3qdc0a6s74vvtr", name: "Everson", shortId: "everson", bonusEnabled: true },
  { id: "kj70r8fvdeg83dhapvp91kqs2574vqng", name: "Chestnut", shortId: "chestnut", bonusEnabled: false },
];

function locationHasBonus(locationId: string): boolean {
  return LOCATION_OPTIONS.find((l) => l.id === locationId)?.bonusEnabled ?? false;
}

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
  const bonusEligible = [...receiving, ...outbound].filter((t) => locationHasBonus(t.locationId));
  const recEarned = bonusEligible.filter((t) => t.bonusEarned === true).length;
  const recMissed = bonusEligible.filter((t) => t.bonusEarned === false).length;
  const hasBonusData = data.some((t) => locationHasBonus(t.locationId));

  // Collect unique helper names across all entries for the helpers summary
  const helperMap: Record<string, { shipping: number; outbound: number; receiving: number; earned: number; totalAmount: number }> = {};
  data.forEach((t) => {
    const hasBonus = locationHasBonus(t.locationId);
    t.helpers.forEach((name: string) => {
      if (!helperMap[name]) helperMap[name] = { shipping: 0, outbound: 0, receiving: 0, earned: 0, totalAmount: 0 };
      if (t.type === "shipping") {
        helperMap[name].shipping++;
        if (hasBonus && t.bonusEarned === true) {
          helperMap[name].earned++;
          helperMap[name].totalAmount += (t.bonusAmount ?? 0) / Math.max(1, t.helpers.length);
        }
      } else if (t.type === "outbound") {
        helperMap[name].outbound++;
        if (hasBonus && t.bonusEarned === true) {
          helperMap[name].earned++;
          helperMap[name].totalAmount += (t.bonusAmount ?? 0) / Math.max(1, t.helpers.length);
        }
      } else {
        helperMap[name].receiving++;
        if (hasBonus && t.bonusEarned === true) {
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
    ${hasBonusData ? `<td style="text-align:right">$${locationHasBonus(t.locationId) ? (t.bonusAmount ?? 0) : "-"}</td>` : ""}
  </tr>`).join("");

  const outboundRows = outbound.map((t: any) => {
    const hasBonus = locationHasBonus(t.locationId);
    return `<tr>
    <td>${fmtDate(t.openedAt)}</td>
    <td>${t.truckNumber}</td>
    <td>${t.truckLength ?? "-"}</td>
    <td>${t.helpers.length > 0 ? t.helpers.join(", ") : "-"}</td>
    <td>${t.duration ? fmtDur(t.duration) : "In progress"}</td>
    <td>${locName(t.locationId)}</td>
    ${hasBonusData ? `<td style="text-align:center;font-weight:700;${hasBonus && t.bonusEarned === true ? "color:#16a34a" : hasBonus && t.bonusEarned === false ? "color:#dc2626" : ""}">${!hasBonus ? "-" : t.bonusEarned === true ? "YES" : t.bonusEarned === false ? "NO" : "-"}</td>
    <td style="text-align:right">${hasBonus ? "$" + (t.bonusAmount ?? 0) : "-"}</td>` : ""}
  </tr>`;
  }).join("");

  const receivingRows = receiving.map((t: any) => {
    const hasBonus = locationHasBonus(t.locationId);
    return `<tr>
    <td>${fmtDate(t.openedAt)}</td>
    <td>${t.truckNumber}</td>
    <td>${t.truckLength ?? "-"}</td>
    <td>${t.helpers.length > 0 ? t.helpers.join(", ") : "-"}</td>
    <td>${t.duration ? fmtDur(t.duration) : "In progress"}</td>
    <td>${locName(t.locationId)}</td>
    ${hasBonusData ? `<td style="text-align:center;font-weight:700;${hasBonus && t.bonusEarned === true ? "color:#16a34a" : hasBonus && t.bonusEarned === false ? "color:#dc2626" : ""}">${!hasBonus ? "-" : t.bonusEarned === true ? "YES" : t.bonusEarned === false ? "NO" : "-"}</td>
    <td style="text-align:right">${hasBonus ? "$" + (t.bonusAmount ?? 0) : "-"}</td>` : ""}
  </tr>`;
  }).join("");

  const helperRows = helperNames.map((name) => {
    const h = helperMap[name];
    return `<tr>
      <td style="font-weight:600">${name}</td>
      <td style="text-align:center">${h.shipping}</td>
      <td style="text-align:center">${h.outbound}</td>
      <td style="text-align:center">${h.receiving}</td>
      ${hasBonusData ? `<td style="text-align:center;font-weight:700;color:#16a34a">${h.earned}</td>
      <td style="text-align:right;font-weight:700">$${Math.round(h.totalAmount)}</td>` : ""}
    </tr>`;
  }).join("");

  const grandTotal = data.filter((t: any) => locationHasBonus(t.locationId)).reduce((sum: number, t: any) => sum + (t.bonusAmount ?? 0), 0);

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
  ${hasBonusData ? `<div class="stat"><div class="label">Earned</div><div class="value" style="color:#16a34a">${stats.earned}</div></div>
  <div class="stat"><div class="label">Missed</div><div class="value" style="color:#dc2626">${stats.missed}</div></div>
  <div class="stat"><div class="label">Total $</div><div class="value" style="color:#0d9488">$${stats.totalBonus}</div></div>` : ""}
</div>

<div class="section">
  <div class="section-title">Shipping <span class="count">${shipping.length} truck${shipping.length !== 1 ? "s" : ""}</span></div>
  ${shipping.length > 0 ? `<table>
    <thead><tr>
      <th>Date</th><th>Truck #</th><th>Length</th><th>Helpers</th><th>Duration</th><th>Location</th>${hasBonusData ? `<th style="text-align:right">Bonus $</th>` : ""}
    </tr></thead>
    <tbody>${shippingRows}</tbody>
  </table>` : `<div class="empty">No shipping trucks in this period</div>`}
</div>

<div class="section">
  <div class="section-title">Outbound <span class="count">${outbound.length} truck${outbound.length !== 1 ? "s" : ""}</span></div>
  ${outbound.length > 0 ? `<table>
    <thead><tr>
      <th>Date</th><th>Truck #</th><th>Length</th><th>Helpers</th><th>Duration</th><th>Location</th>${hasBonusData ? `<th style="text-align:center">Bonus</th><th style="text-align:right">Bonus $</th>` : ""}
    </tr></thead>
    <tbody>${outboundRows}</tbody>
  </table>` : `<div class="empty">No outbound trucks in this period</div>`}
</div>

<div class="section">
  <div class="section-title">Receiving <span class="count">${receiving.length} truck${receiving.length !== 1 ? "s" : ""} &nbsp;&bull;&nbsp; ${recEarned} earned &nbsp;&bull;&nbsp; ${recMissed} missed</span></div>
  ${receiving.length > 0 ? `<table>
    <thead><tr>
      <th>Date</th><th>Truck #</th><th>Length</th><th>Helpers</th><th>Duration</th><th>Location</th>${hasBonusData ? `<th style="text-align:center">Bonus</th><th style="text-align:right">Bonus $</th>` : ""}
    </tr></thead>
    <tbody>${receivingRows}</tbody>
  </table>` : `<div class="empty">No receiving trucks in this period</div>`}
</div>

${helperNames.length > 0 ? `<div class="section">
  <div class="section-title">Helper Summary <span class="count">${helperNames.length} helper${helperNames.length !== 1 ? "s" : ""}</span></div>
  <table>
    <thead><tr>
      <th>Name</th><th style="text-align:center">Shipping</th><th style="text-align:center">Outbound</th><th style="text-align:center">Receiving</th>${hasBonusData ? `<th style="text-align:center">Earned</th><th style="text-align:right">Total $</th>` : ""}
    </tr></thead>
    <tbody>${helperRows}</tbody>
  </table>
</div>` : ""}

${hasBonusData ? `<div class="grand-total">Grand Total Bonus: $${grandTotal}</div>` : ""}

<div class="footer">Generated ${new Date().toLocaleString()} &nbsp;|&nbsp; TireTrack Admin</div>
</body></html>`;

  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
    w.onload = () => w.print();
  }
}

function OpenTruckModal({
  onClose,
  adminName,
  knownHelpers,
}: {
  onClose: () => void;
  adminName: string;
  knownHelpers: { _id: any; name: string; locationId: string }[];
}) {
  const adminOpen = useMutation(api.mutations.adminOpenReceivingTruck);
  const [truckNumber, setTruckNumber] = useState("");
  const [type, setType] = useState<"receiving" | "outbound">("receiving");
  const [truckLength, setTruckLength] = useState("53ft");
  const [locationId, setLocationId] = useState(LOCATION_OPTIONS[0].id);
  const [notes, setNotes] = useState("");
  const [helperInput, setHelperInput] = useState("");
  const [helpers, setHelpers] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredSuggestions = knownHelpers
    .filter(
      (h) =>
        h.locationId === locationId &&
        h.name.toLowerCase().includes(helperInput.toLowerCase()) &&
        !helpers.some((added) => added.toLowerCase() === h.name.toLowerCase())
    )
    .slice(0, 8);

  const addHelper = (name: string) => {
    const trimmed = name.trim();
    if (trimmed && !helpers.some((h) => h.toLowerCase() === trimmed.toLowerCase())) {
      setHelpers([...helpers, trimmed]);
    }
    setHelperInput("");
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleSubmit = async () => {
    if (!truckNumber.trim() || helpers.length === 0) return;
    setSubmitting(true);
    try {
      await adminOpen({
        truckNumber: truckNumber.trim(),
        helpers,
        locationId,
        adminName,
        notes: notes.trim() || undefined,
        type,
        truckLength,
      });
      onClose();
    } catch (e) {
      alert("Failed to open truck: " + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-lg font-bold">Open Truck</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors text-xl">&times;</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Truck #</label>
              <input
                type="text"
                value={truckNumber}
                onChange={(e) => setTruckNumber(e.target.value)}
                placeholder="e.g. 12345"
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as any)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
              >
                <option value="receiving">Receiving</option>
                <option value="outbound">Outbound</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Truck Length</label>
              <select
                value={truckLength}
                onChange={(e) => setTruckLength(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
              >
                <option value="Pup">Pup</option>
                <option value="40ft">40ft</option>
                <option value="53ft">53ft</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Location</label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
              >
                {LOCATION_OPTIONS.map((loc) => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>
            </div>
          </div>
          {/* Helpers */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">Helpers</label>
            {helpers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {helpers.map((h, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-cyan-500/20 text-cyan-300 border border-cyan-500/20">
                    {h}
                    <button onClick={() => setHelpers(helpers.filter((_, idx) => idx !== i))} className="text-cyan-400 hover:text-red-400 ml-0.5">&times;</button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={helperInput}
                onChange={(e) => { setHelperInput(e.target.value); setShowSuggestions(true); }}
                onFocus={() => setShowSuggestions(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && helperInput.trim()) {
                    e.preventDefault();
                    addHelper(helperInput);
                  }
                }}
                placeholder="Type name and press Enter..."
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
              />
              {showSuggestions && helperInput && filteredSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-slate-700 border border-slate-600 rounded-lg shadow-xl z-10 max-h-40 overflow-y-auto">
                  {filteredSuggestions.map((h) => (
                    <button
                      key={h._id}
                      onClick={() => addHelper(h.name)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-600 transition-colors text-white"
                    >
                      {h.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
            />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-700 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-slate-700 hover:bg-slate-600 text-white transition-colors">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={!truckNumber.trim() || helpers.length === 0 || submitting}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? "Opening..." : "Open Truck & Start Timer"}
          </button>
        </div>
      </div>
    </div>
  );
}

function tsToLocalInput(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToTs(val: string): number | null {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function parseDurationInput(val: string): number | null {
  // Accept formats like "1:30", "1h30m", "1h 30m", "90m", "1.5h", "90"
  val = val.trim().toLowerCase();
  if (!val) return null;

  // "1:30" format
  const colonMatch = val.match(/^(\d+):(\d{1,2})$/);
  if (colonMatch) return (parseInt(colonMatch[1]) * 60 + parseInt(colonMatch[2])) * 60000;

  // "1h30m" or "1h 30m" format
  const hmMatch = val.match(/^(\d+)\s*h\s*(\d+)\s*m?$/);
  if (hmMatch) return (parseInt(hmMatch[1]) * 60 + parseInt(hmMatch[2])) * 60000;

  // "1h" format
  const hMatch = val.match(/^(\d+)\s*h$/);
  if (hMatch) return parseInt(hMatch[1]) * 3600000;

  // "1.5h" format
  const decMatch = val.match(/^(\d+\.?\d*)\s*h$/);
  if (decMatch) return Math.round(parseFloat(decMatch[1]) * 3600000);

  // "90m" or "90" (minutes)
  const mMatch = val.match(/^(\d+)\s*m?$/);
  if (mMatch) return parseInt(mMatch[1]) * 60000;

  return null;
}

function formatDurationInput(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}:${minutes.toString().padStart(2, "0")}`;
}

function EditEntryModal({
  entry,
  onClose,
  knownHelpers,
}: {
  entry: any;
  onClose: () => void;
  knownHelpers: { _id: any; name: string; locationId: string }[];
}) {
  const editEntry = useMutation(api.mutations.adminEditBonusEntry);
  const [truckNumber, setTruckNumber] = useState(entry.truckNumber ?? "");
  const [truckLength, setTruckLength] = useState(entry.truckLength ?? "");
  const [helpers, setHelpers] = useState<string[]>(entry.helpers ?? []);
  const [helperInput, setHelperInput] = useState("");
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [openedAtStr, setOpenedAtStr] = useState(tsToLocalInput(entry.openedAt));
  const [closedAtStr, setClosedAtStr] = useState(entry.closedAt ? tsToLocalInput(entry.closedAt) : "");
  const [durationInput, setDurationInput] = useState(
    entry.closedAt ? formatDurationInput(entry.closedAt - entry.openedAt) : ""
  );
  const [submitting, setSubmitting] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredSuggestions = knownHelpers
    .filter(
      (h) =>
        h.locationId === entry.locationId &&
        h.name.toLowerCase().includes(helperInput.toLowerCase()) &&
        !helpers.some((added) => added.toLowerCase() === h.name.toLowerCase())
    )
    .slice(0, 8);

  const addHelper = (name: string) => {
    const trimmed = name.trim();
    if (trimmed && !helpers.some((h) => h.toLowerCase() === trimmed.toLowerCase())) {
      setHelpers([...helpers, trimmed]);
    }
    setHelperInput("");
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  // When duration input changes, update closedAt
  const handleDurationChange = (val: string) => {
    setDurationInput(val);
    const ms = parseDurationInput(val);
    const openTs = localInputToTs(openedAtStr);
    if (ms !== null && openTs) {
      setClosedAtStr(tsToLocalInput(openTs + ms));
    }
  };

  // When closedAt changes directly, update duration display
  const handleClosedAtChange = (val: string) => {
    setClosedAtStr(val);
    const openTs = localInputToTs(openedAtStr);
    const closeTs = localInputToTs(val);
    if (openTs && closeTs && closeTs > openTs) {
      setDurationInput(formatDurationInput(closeTs - openTs));
    }
  };

  // When openedAt changes, recalculate closedAt from duration
  const handleOpenedAtChange = (val: string) => {
    setOpenedAtStr(val);
    const ms = parseDurationInput(durationInput);
    const openTs = localInputToTs(val);
    if (ms !== null && openTs) {
      setClosedAtStr(tsToLocalInput(openTs + ms));
    }
  };

  // Preview duration based on current input values
  const previewDuration = useMemo(() => {
    const openTs = localInputToTs(openedAtStr);
    const closeTs = localInputToTs(closedAtStr);
    if (!openTs || !closeTs) return null;
    const ms = closeTs - openTs;
    if (ms < 0) return "Invalid (closed before opened)";
    return formatDuration(ms);
  }, [openedAtStr, closedAtStr]);

  const previewBonusEligible = useMemo(() => {
    if (!locationHasBonus(entry.locationId)) return null;
    const openTs = localInputToTs(openedAtStr);
    const closeTs = localInputToTs(closedAtStr);
    if (!openTs || !closeTs || entry.type === "shipping") return null;
    const ms = closeTs - openTs;
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    return ms <= TWO_HOURS;
  }, [openedAtStr, closedAtStr, entry.type, entry.locationId]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const newOpenedAt = localInputToTs(openedAtStr);
      const newClosedAt = localInputToTs(closedAtStr);

      await editEntry({
        entryId: entry._id,
        type: entry.type,
        helpers,
        truckNumber: truckNumber !== entry.truckNumber ? truckNumber : undefined,
        truckLength: truckLength || undefined,
        notes: notes !== (entry.notes ?? "") ? notes : undefined,
        openedAt: newOpenedAt !== entry.openedAt ? (newOpenedAt ?? undefined) : undefined,
        closedAt: newClosedAt !== (entry.closedAt ?? null) ? (newClosedAt ?? undefined) : undefined,
      });
      onClose();
    } catch (e) {
      alert("Failed to update: " + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const lengthOptions = entry.type === "shipping"
    ? ["28ft", "40ft", "48ft", "53ft"]
    : ["Pup", "40ft", "53ft"];

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between sticky top-0 bg-slate-800 z-10">
          <div>
            <h2 className="text-lg font-bold">Edit Truck</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                entry.type === "shipping"
                  ? "bg-blue-500/20 text-blue-400"
                  : entry.type === "outbound"
                    ? "bg-amber-500/20 text-amber-400"
                    : "bg-purple-500/20 text-purple-400"
              }`}>
                {entry.type === "shipping" ? "Shipping" : entry.type === "outbound" ? "Outbound" : "Receiving"}
              </span>
              <span className="text-xs text-slate-500">{getLocationName(entry.locationId)}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors text-xl">&times;</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {/* Truck Number */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">Truck Number</label>
            <input
              type="text"
              value={truckNumber}
              onChange={(e) => setTruckNumber(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
            />
          </div>

          {/* Truck Length */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">Truck Length</label>
            <select
              value={truckLength}
              onChange={(e) => setTruckLength(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
            >
              <option value="">Not set</option>
              {lengthOptions.map((len) => (
                <option key={len} value={len}>{len}</option>
              ))}
            </select>
          </div>

          {/* Times */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Opened At</label>
              <input
                type="datetime-local"
                value={openedAtStr}
                onChange={(e) => handleOpenedAtChange(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Closed At</label>
              <input
                type="datetime-local"
                value={closedAtStr}
                onChange={(e) => handleClosedAtChange(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Duration input */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">Duration (adjusts closed time)</label>
            <input
              type="text"
              value={durationInput}
              onChange={(e) => handleDurationChange(e.target.value)}
              placeholder="e.g. 1:30, 90m, 1h30m, 1.5h"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
            />
          </div>

          {/* Duration preview */}
          {previewDuration && (
            <div className="flex items-center gap-3 px-3 py-2 bg-slate-900/50 rounded-lg text-sm">
              <span className="text-slate-500">Duration:</span>
              <span className="text-white font-medium">{previewDuration}</span>
              {previewBonusEligible !== null && (
                <>
                  <span className="text-slate-600">|</span>
                  <span className={previewBonusEligible ? "text-emerald-400" : "text-red-400"}>
                    {previewBonusEligible ? "Within 2hr window" : "Exceeds 2hr window"}
                  </span>
                </>
              )}
            </div>
          )}

          {/* Helpers */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">Helpers</label>
            {helpers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {helpers.map((h, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-cyan-500/20 text-cyan-300 border border-cyan-500/20">
                    {h}
                    <button onClick={() => setHelpers(helpers.filter((_, idx) => idx !== i))} className="text-cyan-400 hover:text-red-400 ml-0.5">&times;</button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={helperInput}
                onChange={(e) => { setHelperInput(e.target.value); setShowSuggestions(true); }}
                onFocus={() => setShowSuggestions(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && helperInput.trim()) {
                    e.preventDefault();
                    addHelper(helperInput);
                  }
                }}
                placeholder="Type name and press Enter..."
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
              />
              {showSuggestions && helperInput && filteredSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-slate-700 border border-slate-600 rounded-lg shadow-xl z-10 max-h-40 overflow-y-auto">
                  {filteredSuggestions.map((h) => (
                    <button
                      key={h._id}
                      onClick={() => addHelper(h.name)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-600 transition-colors text-white"
                    >
                      {h.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Notes (receiving/outbound only) */}
          {entry.type !== "shipping" && (
            <div>
              <label className="block text-xs text-slate-500 mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Optional notes..."
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 resize-none"
              />
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-700 flex justify-end gap-3 sticky bottom-0 bg-slate-800">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-slate-700 hover:bg-slate-600 text-white transition-colors">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function HelperManagementModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const [locationId, setLocationId] = useState(LOCATION_OPTIONS[0].id);
  const knownHelpers = useQuery(api.queries.getKnownHelpers, { locationId });
  const addHelper = useMutation(api.mutations.addKnownHelper);
  const removeHelper = useMutation(api.mutations.removeKnownHelper);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      const result = await addHelper({ name: newName.trim(), locationId });
      if (result.success) {
        setNewName("");
      } else {
        alert(result.error ?? "Failed to add helper");
      }
    } catch (e) {
      alert("Error: " + (e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-lg font-bold">Manage Helper Names</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors text-xl">&times;</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Location</label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
            >
              {LOCATION_OPTIONS.map((loc) => (
                <option key={loc.id} value={loc.id}>{loc.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Add New Helper</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                placeholder="Helper name..."
                className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500"
              />
              <button
                onClick={handleAdd}
                disabled={!newName.trim() || adding}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-2">Current Helpers ({knownHelpers?.length ?? 0})</label>
            <div className="max-h-60 overflow-y-auto space-y-1">
              {knownHelpers?.map((h) => (
                <div key={h._id} className="flex items-center justify-between px-3 py-2 bg-slate-900/50 rounded-lg">
                  <span className="text-sm text-white">{h.name}</span>
                  <button
                    onClick={() => {
                      if (confirm(`Remove ${h.name}?`)) removeHelper({ helperId: h._id });
                    }}
                    className="text-slate-500 hover:text-red-400 transition-colors text-xs"
                  >
                    Remove
                  </button>
                </div>
              ))}
              {knownHelpers?.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-4">No helpers for this location</p>
              )}
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-700 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-slate-700 hover:bg-slate-600 text-white transition-colors">Done</button>
        </div>
      </div>
    </div>
  );
}

function LiveTimer({ openedAt }: { openedAt: number }) {
  const [elapsed, setElapsed] = useState(Date.now() - openedAt);
  useEffect(() => {
    const interval = setInterval(() => setElapsed(Date.now() - openedAt), 1000);
    return () => clearInterval(interval);
  }, [openedAt]);
  const hours = Math.floor(elapsed / 3600000);
  const minutes = Math.floor((elapsed % 3600000) / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const isOverTime = elapsed > TWO_HOURS;
  return (
    <span className={`font-mono text-sm ${isOverTime ? "text-red-400" : "text-cyan-400"}`}>
      {hours > 0 && `${hours}h `}{minutes}m {seconds}s
    </span>
  );
}

function BonusesDashboard() {
  const { admin } = useAuth();
  const overrideBonus = useMutation(api.mutations.overrideReceivingBonus);
  const deleteBonusEntry = useMutation(api.mutations.deleteBonusEntry);
  const adminClose = useMutation(api.mutations.adminCloseReceivingTruck);
  const [locationFilter, setLocationFilter] = useState("all");
  const [helperFilter, setHelperFilter] = useState("all");
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<any>(null);
  const [showHelperMgmt, setShowHelperMgmt] = useState(false);
  const [dateRange, setDateRange] = useState(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 7);
    return {
      start: start.toISOString().split("T")[0],
      end: end.toISOString().split("T")[0],
    };
  });

  // Fetch known helpers for all locations (for modals)
  const helpersLatrobe = useQuery(api.queries.getKnownHelpers, { locationId: LOCATION_OPTIONS[0].id });
  const helpersEverson = useQuery(api.queries.getKnownHelpers, { locationId: LOCATION_OPTIONS[1].id });
  const helpersChestnut = useQuery(api.queries.getKnownHelpers, { locationId: LOCATION_OPTIONS[2].id });
  const allKnownHelpers = useMemo(
    () => [...(helpersLatrobe ?? []), ...(helpersEverson ?? []), ...(helpersChestnut ?? [])],
    [helpersLatrobe, helpersEverson, helpersChestnut]
  );

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

  // Whether the current filter view shows any bonus-enabled locations
  const showBonusColumns = useMemo(() => {
    if (locationFilter === "all") return true;
    const loc = LOCATION_OPTIONS.find((l) => l.shortId === locationFilter);
    return loc?.bonusEnabled ?? false;
  }, [locationFilter]);

  const stats = useMemo(() => {
    if (!filteredData) return { shipping: 0, outbound: 0, receiving: 0, earned: 0, missed: 0, totalBonus: 0 };
    const bonusData = filteredData.filter((t) => locationHasBonus(t.locationId));
    return {
      shipping: filteredData.filter((t) => t.type === "shipping").length,
      outbound: filteredData.filter((t) => t.type === "outbound").length,
      receiving: filteredData.filter((t) => t.type === "receiving").length,
      earned: bonusData.filter((t) => t.bonusEarned === true).length,
      missed: bonusData.filter((t) => t.bonusEarned === false).length,
      totalBonus: bonusData.reduce((sum, t) => sum + (t.bonusAmount ?? 0), 0),
    };
  }, [filteredData]);

  const handleCloseTruck = async (truckId: string) => {
    if (!admin) return;
    if (!confirm("Close this truck and stop the timer?")) return;
    try {
      const result = await adminClose({ receivingTruckId: truckId as any, adminName: admin.name });
      if (result.success) {
        alert(`Truck closed. Bonus ${result.bonusEarned ? "EARNED" : "NOT earned"} — $${result.bonusAmount}`);
      } else {
        alert("Failed to close truck: " + (result as any).error);
      }
    } catch (e) {
      alert("Error: " + (e as Error).message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Modals */}
      {showOpenModal && (
        <OpenTruckModal
          onClose={() => setShowOpenModal(false)}
          adminName={admin?.name ?? "Admin"}
          knownHelpers={allKnownHelpers}
        />
      )}
      {editingEntry && (
        <EditEntryModal
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
          knownHelpers={allKnownHelpers}
        />
      )}
      {showHelperMgmt && (
        <HelperManagementModal onClose={() => setShowHelperMgmt(false)} />
      )}

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
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowHelperMgmt(true)}
                className="px-3 py-2 text-sm font-medium rounded-lg bg-slate-700 hover:bg-slate-600 text-white transition-colors border border-slate-600"
              >
                Manage Helpers
              </button>
              <button
                onClick={() => setShowOpenModal(true)}
                className="px-3 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
              >
                + Open Truck
              </button>
              <button
                onClick={() => {
                  const locLabel = locationFilter === "all" ? "All Locations" : (LOCATION_OPTIONS.find((l) => l.shortId === locationFilter)?.name ?? "All");
                  printBonusReport(filteredData, dateRange, locLabel, stats);
                }}
                disabled={!filteredData || filteredData.length === 0}
                className="px-3 py-2 text-sm font-medium rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Print Report
              </button>
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
        <div className={`grid grid-cols-2 ${showBonusColumns ? "md:grid-cols-6" : "md:grid-cols-3"} gap-3`}>
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
          {showBonusColumns && (
            <>
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
            </>
          )}
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
                  {showBonusColumns && (
                    <>
                      <th className="text-left px-4 py-3 text-xs text-slate-500 uppercase tracking-wider font-medium">Bonus</th>
                      <th className="text-right px-4 py-3 text-xs text-slate-500 uppercase tracking-wider font-medium">Bonus $</th>
                    </>
                  )}
                  <th className="text-left px-4 py-3 text-xs text-slate-500 uppercase tracking-wider font-medium">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {!bonusData && (
                  <tr>
                    <td colSpan={showBonusColumns ? 11 : 9} className="text-center py-12 text-slate-500">
                      Loading...
                    </td>
                  </tr>
                )}
                {filteredData?.length === 0 && (
                  <tr>
                    <td colSpan={showBonusColumns ? 11 : 9} className="text-center py-12 text-slate-500">
                      No data for the selected date range
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
                        <LiveTimer openedAt={truck.openedAt} />
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {getLocationName(truck.locationId)}
                    </td>
                    {showBonusColumns && (
                      <>
                        <td className="px-4 py-3">
                          {!locationHasBonus(truck.locationId) ? (
                            <span className="text-slate-600">-</span>
                          ) : truck.bonusEarned === true ? (
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
                          ) : truck.bonusEarned === false ? (
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
                          ) : (
                            <span className="text-slate-600">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {!locationHasBonus(truck.locationId) ? (
                            <span className="text-slate-600">-</span>
                          ) : (truck.bonusAmount ?? 0) > 0 ? (
                            <span className="text-emerald-400 font-medium">${truck.bonusAmount}</span>
                          ) : (
                            <span className="text-slate-600">$0</span>
                          )}
                        </td>
                      </>
                    )}
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
                      <div className="flex items-center gap-1.5">
                        {/* Close button for open receiving/outbound trucks */}
                        {truck.status === "open" && truck.type !== "shipping" && (
                          <button
                            onClick={() => handleCloseTruck(truck._id)}
                            className="px-2 py-1 text-xs font-medium rounded bg-red-500/20 text-red-400 border border-red-500/20 hover:bg-red-500/30 transition-colors"
                            title="Close truck & stop timer"
                          >
                            Close
                          </button>
                        )}
                        {/* Edit button */}
                        <button
                          onClick={() => setEditingEntry(truck)}
                          className="px-2 py-1 text-xs font-medium rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/30 transition-colors"
                          title="Edit entry"
                        >
                          Edit
                        </button>
                        {/* Delete button */}
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
                      </div>
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
