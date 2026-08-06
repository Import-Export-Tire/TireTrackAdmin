"use client";

import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import Link from "next/link";
import { Protected } from "../../protected";
import { useAuth } from "../../auth-context";

function CountsDashboard() {
  const { admin, canEdit } = useAuth();

  // Enabled locations come from convex/wms_count_locations.ts — the one place a
  // location code is named. Today that's W09 alone; the dropdown appears once a
  // second location is enabled, so no UI change is needed then.
  const locations = useQuery(api.wms_count.getCountLocations, {});
  const [location, setLocation] = useState<string | null>(null);
  const active = location ?? locations?.[0]?.code ?? null;
  const activeLabel = locations?.find((l) => l.code === active)?.label ?? "";

  const batches = useQuery(
    api.wms_count.getCountBatches,
    active ? { warehouseCode: active } : "skip",
  );
  const openBatch = useQuery(
    api.wms_count.getOpenCountBatch,
    active ? { warehouseCode: active } : "skip",
  );
  // Live detail for the open batch drives the who's-counting panel below.
  const openDetail = useQuery(
    api.wms_count.getCountBatch,
    openBatch?._id ? { batchId: openBatch._id } : "skip",
  );
  const openCountBatch = useAction(api.wms_count.openCountBatch);
  const closeCountBatch = useMutation(api.wms_count.closeCountBatch);
  const deleteCountBatch = useAction(api.wms_count.deleteCountBatch);
  const [busy, setBusy] = useState(false);

  const actor = admin?.id
    ? ({ kind: "admin" as const, adminId: admin.id as any })
    : null;

  const fmt = (n?: number | null) =>
    typeof n === "number" ? n.toLocaleString() : "—";

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <Link href="/" className="text-ios-blue text-sm font-medium hover:underline">
          ‹ Dashboard
        </Link>
      </div>

      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-[#1c1c1e]">
              Inventory Counts{activeLabel ? ` — ${activeLabel}` : ""}
            </h1>
            <Link
              href="/wms/counts/compare"
              className="text-ios-blue text-sm font-medium hover:underline"
            >
              Compare two counts →
            </Link>
          </div>
          <p className="text-ios-gray1 text-sm max-w-2xl">
            A batch takes a snapshot of what the books say is on hand right now and
            freezes it. Everything counted is compared against that moment — not
            against the books as they change afterwards. Tires only; non-tire
            product types are excluded from the baseline.
          </p>
          <div className="mt-3 max-w-2xl border-l-[3px] border-ios-blue bg-ios-blue/5 rounded-r-lg px-4 py-3">
            <p className="text-sm font-semibold text-[#1c1c1e]">
              One batch per count — and leave it open
            </p>
            <ul className="mt-1 text-sm text-ios-gray1 space-y-1 list-disc pl-5">
              <li>
                Every counter joins the same batch. Don&apos;t open one per person.
              </li>
              <li>
                Don&apos;t close it daily. Leave it open until the whole warehouse
                is counted, even across several days — progress is saved as you go.
              </li>
              <li>
                Closing early reports every tire not yet scanned as missing, so
                real shrink can&apos;t be told apart from what simply
                hasn&apos;t been reached.
              </li>
              <li>Freeze shipping and receiving while the count is open.</li>
            </ul>
          </div>
          {(locations?.length ?? 0) > 1 && (
            <select
              value={active ?? ""}
              onChange={(e) => setLocation(e.target.value)}
              className="mt-3 px-3 py-2 bg-white border border-ios-gray5 rounded-xl"
            >
              {(locations ?? []).map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label} ({l.code})
                </option>
              ))}
            </select>
          )}
        </div>
        {canEdit && actor && active && !openBatch && (
          <button
            onClick={async () => {
              setBusy(true);
              try {
                await openCountBatch({ warehouseCode: active, actor });
              } catch (e: any) {
                alert(e?.message ?? "Could not open batch");
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="px-4 py-2 bg-ios-blue text-white rounded-xl font-medium disabled:opacity-50 whitespace-nowrap"
          >
            {busy ? "Opening…" : "Open count batch"}
          </button>
        )}
      </div>

      {/* Live per-counter view. Everyone scans into ONE batch so the location
          gets a single variance figure; this is how you see who is doing what
          without splitting the baseline. */}
      {openBatch && openDetail && (
        <div className="bg-white rounded-2xl shadow-ios p-5 mb-5">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <h2 className="font-semibold text-[#1c1c1e]">
              Counting now — live
            </h2>
            <div className="text-sm text-ios-gray1">
              {openDetail.countedUnits.toLocaleString()} tires ·{" "}
              {openDetail.countedItems.toLocaleString()} items ·{" "}
              {openDetail.scanCount.toLocaleString()} scans
              {openDetail.voidedCount
                ? ` · ${openDetail.voidedCount} voided`
                : ""}
              {openDetail.unmatchedUpcs
                ? ` · ${openDetail.unmatchedUpcs} unmatched UPCs`
                : ""}
            </div>
          </div>
          {openDetail.counters.length === 0 ? (
            <p className="text-ios-gray1 text-sm mt-2">
              Batch is open but nobody has scanned yet.
            </p>
          ) : (
            <table className="w-full text-sm mt-3">
              <thead className="text-ios-gray1 text-left">
                <tr>
                  <th className="py-1 font-semibold">Counter</th>
                  <th className="py-1 font-semibold text-right">Tires</th>
                  <th className="py-1 font-semibold text-right">Scans</th>
                  <th className="py-1 font-semibold text-right">Share</th>
                </tr>
              </thead>
              <tbody>
                {openDetail.counters.map((c) => (
                  <tr key={c.by} className="border-t border-ios-gray5">
                    <td className="py-2 text-[#1c1c1e]">{c.name}</td>
                    <td className="py-2 text-right text-[#1c1c1e] font-semibold">
                      {c.units.toLocaleString()}
                    </td>
                    <td className="py-2 text-right text-ios-gray1">{c.scans}</td>
                    <td className="py-2 text-right text-ios-gray1">
                      {openDetail.countedUnits > 0
                        ? `${Math.round((c.units / openDetail.countedUnits) * 100)}%`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {batches === undefined ? (
        <div className="text-ios-gray1">Loading…</div>
      ) : batches.length === 0 ? (
        <div className="p-8 text-center text-ios-gray1 bg-white rounded-2xl shadow-ios">
          No counts yet. Open a batch to begin.
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-ios overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-ios-gray6 text-ios-gray1 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">Opened</th>
                <th className="px-4 py-3 font-semibold">By</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Baseline</th>
                <th className="px-4 py-3 font-semibold text-right">In book</th>
                <th className="px-4 py-3 font-semibold text-right"></th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b._id} className="border-t border-ios-gray5">
                  <td className="px-4 py-3 text-[#1c1c1e] whitespace-nowrap">
                    {new Date(b.openedAt).toLocaleString()}
                    {b.closedAt && (
                      <div className="text-xs text-ios-gray1">
                        closed {new Date(b.closedAt).toLocaleString()}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ios-gray1">
                    {b.openedByName}
                    {b.closedByName && (
                      <div className="text-xs">closed by {b.closedByName}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        b.status === "open"
                          ? "bg-ios-green/15 text-ios-green"
                          : "bg-ios-gray5 text-ios-gray1"
                      }`}
                    >
                      {b.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {b.baselineStatus === "ready" ? (
                      <span className="text-ios-gray1">
                        OEIVAL {String(b.baselineFileDate ?? "").slice(0, 10)}
                        {b.baselineExcludedNonTires
                          ? ` · ${b.baselineExcludedNonTires} non-tire rows excluded`
                          : ""}
                      </span>
                    ) : b.baselineStatus === "pending" ? (
                      <span className="text-ios-orange">loading…</span>
                    ) : (
                      <span className="text-ios-red" title={b.baselineError}>
                        failed — {String(b.baselineError ?? "").slice(0, 60)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-[#1c1c1e] whitespace-nowrap">
                    {fmt(b.baselineUnitCount)} tires
                    <div className="text-xs text-ios-gray1">
                      {fmt(b.baselineItemCount)} items
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Link
                      href={`/wms/counts/${b._id}`}
                      className="text-ios-blue font-medium hover:underline"
                    >
                      Reports
                    </Link>
                    {b.status === "open" && canEdit && actor && (
                      <button
                        onClick={async () => {
                          if (
                            !confirm(
                              "Close this count batch?\n\nOnly close once the WHOLE warehouse has been counted. Anything not yet scanned will be reported as missing.",
                            )
                          )
                            return;
                          try {
                            await closeCountBatch({ batchId: b._id, actor });
                          } catch (e: any) {
                            alert(e?.message ?? "Could not close");
                          }
                        }}
                        className="ml-4 text-ios-orange font-medium hover:underline"
                      >
                        Close
                      </button>
                    )}
                    {canEdit && admin?.id && (
                      <button
                        onClick={async () => {
                          if (
                            !confirm(
                              "Delete this batch and every scan in it? This cannot be undone.",
                            )
                          )
                            return;
                          try {
                            await deleteCountBatch({
                              batchId: b._id,
                              callerAdminId: admin.id as any,
                            });
                          } catch (e: any) {
                            alert(e?.message ?? "Could not delete");
                          }
                        }}
                        className="ml-4 text-ios-red font-medium hover:underline"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function CountsPage() {
  return (
    <Protected>
      <CountsDashboard />
    </Protected>
  );
}
