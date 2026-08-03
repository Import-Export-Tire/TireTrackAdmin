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
  const openCountBatch = useAction(api.wms_count.openCountBatch);
  const closeCountBatch = useMutation(api.wms_count.closeCountBatch);
  const deleteCountBatch = useMutation(api.wms_count.deleteCountBatch);
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
          <h1 className="text-2xl font-bold text-[#1c1c1e]">
            Inventory Counts{activeLabel ? ` — ${activeLabel}` : ""}
          </h1>
          <p className="text-ios-gray1 text-sm max-w-2xl">
            Opening a batch freezes IECentral&apos;s on-hand figures, so stock
            moving during the count can&apos;t skew the variance. Tires only —
            non-tire product types are excluded from the baseline.
          </p>
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
                <th className="px-4 py-3 font-semibold text-right">Tires in book</th>
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
                  <td className="px-4 py-3 text-right text-[#1c1c1e]">
                    {fmt(b.baselineItemCount)}
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
                          if (!confirm("Close this count batch?")) return;
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
