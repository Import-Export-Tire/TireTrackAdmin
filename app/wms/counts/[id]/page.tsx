"use client";

import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Protected } from "../../../protected";
import { useAuth } from "../../../auth-context";
import {
  BUCKET_LABEL,
  downloadScannedCsv,
  downloadScannedPdf,
  downloadDiscrepancyCsv,
  downloadDiscrepancyPdf,
  type ReportHeader,
} from "../exports";

type Tab = "scanned" | "discrepancy";

const PAGE_SIZE = 100;

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

function Pager({
  page,
  pageCount,
  total,
  start,
  shown,
  onChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  start: number;
  shown: number;
  onChange: (next: number) => void;
}) {
  const rangeStart = total === 0 ? 0 : start + 1;
  const rangeEnd = start + shown;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-t border-ios-gray5 text-xs text-ios-gray1">
      <span>
        {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of{" "}
        {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="px-2 py-1 rounded-lg border border-ios-gray5 disabled:opacity-40 text-[#1c1c1e]"
        >
          ‹ Prev
        </button>
        <span className="px-2">
          Page {page} of {pageCount}
        </span>
        <button
          onClick={() => onChange(Math.min(pageCount, page + 1))}
          disabled={page >= pageCount}
          className="px-2 py-1 rounded-lg border border-ios-gray5 disabled:opacity-40 text-[#1c1c1e]"
        >
          Next ›
        </button>
      </div>
    </div>
  );
}

function CountReport() {
  const params = useParams();
  const batchId = (params?.id as string) ?? "";
  const { admin, canEdit } = useAuth();
  const [tab, setTab] = useState<Tab>("discrepancy");

  const detail = useQuery(api.wms_count.getCountBatch, { batchId: batchId as any });
  const variance = useQuery(api.wms_count.getCountVariance, {
    batchId: batchId as any,
  });
  const scans = useQuery(api.wms_count.listCountScans, {
    batchId: batchId as any,
    limit: 300,
  });
  const locations = useQuery(api.wms_count.getCountLocations, {});
  const resolveUpc = useMutation(api.wms_count.resolveUnmatchedUpc);
  const searchTires = useAction(api.wms_count.searchIECentralTires);

  // Inline resolver state, keyed by the UPC being resolved.
  const [resolving, setResolving] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [saveMapping, setSaveMapping] = useState(true);

  // Report-level search across itemId / brand / model / size / MPN / UPC / EAN
  // — the four ways a counter identifies a tire on the floor. Resets pagination
  // whenever the query changes so the user lands on page 1 of the filtered set.
  const [filter, setFilter] = useState("");
  const [pageByBucket, setPageByBucket] = useState<Record<string, number>>({});
  const [scannedItemsPage, setScannedItemsPage] = useState(1);
  const [scanEventsPage, setScanEventsPage] = useState(1);
  const [unmatchedPage, setUnmatchedPage] = useState(1);

  const activeFilter = norm(filter);
  const matchesRow = (r: {
    itemId: string;
    variantItemIds?: string[];
    brand?: string;
    model?: string;
    size?: string;
    mpn?: string;
    upc?: string;
    ean?: string;
  }) => {
    if (!activeFilter) return true;
    const haystack = [
      r.itemId,
      ...(r.variantItemIds ?? []),
      r.brand,
      r.model,
      r.size,
      r.mpn,
      r.upc,
      r.ean,
    ]
      .map(norm)
      .join(" ");
    return haystack.includes(activeFilter);
  };
  const matchesUpc = (u: { upc: string }) =>
    !activeFilter || norm(u.upc).includes(activeFilter);
  const matchesScan = (s: {
    itemId?: string;
    upc?: string;
    rawBarcode?: string;
    scannedByName?: string;
  }) => {
    if (!activeFilter) return true;
    return [s.itemId, s.upc, s.rawBarcode, s.scannedByName]
      .map(norm)
      .join(" ")
      .includes(activeFilter);
  };
  const resetPagination = (v: string) => {
    setFilter(v);
    setPageByBucket({});
    setScannedItemsPage(1);
    setScanEventsPage(1);
    setUnmatchedPage(1);
  };

  if (detail === undefined) return <div className="p-6 text-ios-gray1">Loading…</div>;
  if (detail === null) return <div className="p-6 text-ios-red">Batch not found.</div>;

  const b = detail.batch;
  const locationLabel =
    locations?.find((l) => l.code === b.warehouseCode)?.label ?? b.warehouseCode;
  const ready = variance && "rows" in variance;
  const rows = ready ? variance.rows : [];
  const unmatched = ready ? variance.unmatched : [];
  const summary = ready ? variance.summary : null;

  const header: ReportHeader = {
    warehouseCode: b.warehouseCode,
    locationLabel,
    batchId,
    openedAt: b.openedAt,
    openedByName: b.openedByName,
    closedAt: b.closedAt,
    closedByName: b.closedByName,
    baselineFileDate: b.baselineFileDate,
    excludedNonTires: b.baselineExcludedNonTires,
    excludedUnits: b.baselineExcludedUnits,
    counters: detail.counters,
  };

  const runSearch = async () => {
    if (q.trim().length < 2) return;
    setSearching(true);
    try {
      const res = await searchTires({ q });
      setResults(res.results ?? []);
      if (res.error) alert(res.error);
    } finally {
      setSearching(false);
    }
  };

  const attach = async (upc: string, itemId: string) => {
    if (!admin?.id) return;
    try {
      // scope "batch": Admin is cleaning up every unmatched scan of this UPC,
      // unlike the scanner which resolves only the tire in the counter's hand.
      await resolveUpc({
        batchId: batchId as any,
        upc,
        itemId,
        alsoSaveMapping: saveMapping,
        scope: "batch",
        actor: { kind: "admin", adminId: admin.id as any },
      });
      setResolving(null);
      setResults([]);
      setQ("");
    } catch (e: any) {
      alert(e?.message ?? "Could not attach");
    }
  };

  const Btn = ({
    onClick,
    children,
    tone = "blue",
  }: {
    onClick: () => void;
    children: React.ReactNode;
    tone?: "blue" | "gray";
  }) => (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded-xl text-sm font-medium ${
        tone === "blue"
          ? "bg-ios-blue text-white"
          : "bg-white border border-ios-gray5 text-[#1c1c1e]"
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-4">
        <Link
          href="/wms/counts"
          className="text-ios-blue text-sm font-medium hover:underline"
        >
          ‹ Inventory Counts
        </Link>
      </div>

      {/* Provenance — a report has to explain itself, above all which OEIVAL
          the book figures came from. */}
      <div className="bg-white rounded-2xl shadow-ios p-5 mb-5">
        <h1 className="text-2xl font-bold text-[#1c1c1e]">
          Count — {locationLabel} ({b.warehouseCode})
        </h1>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-1 mt-3 text-sm">
          <div>
            <span className="text-ios-gray1">Opened </span>
            {new Date(b.openedAt).toLocaleString()} by {b.openedByName}
          </div>
          <div>
            <span className="text-ios-gray1">Closed </span>
            {b.closedAt
              ? `${new Date(b.closedAt).toLocaleString()} by ${b.closedByName ?? ""}`
              : "still open"}
          </div>
          <div>
            <span className="text-ios-gray1">Baseline </span>
            OEIVAL {String(b.baselineFileDate ?? "unknown").slice(0, 10)}
          </div>
          <div>
            <span className="text-ios-gray1">In book </span>
            {(b.baselineUnitCount ?? 0).toLocaleString()} tires across{" "}
            {(b.baselineItemCount ?? 0).toLocaleString()} items
          </div>
          <div>
            <span className="text-ios-gray1">Excluded </span>
            {b.baselineExcludedNonTires ?? 0} non-tire rows /{" "}
            {(b.baselineExcludedUnits ?? 0).toLocaleString()} units
          </div>
          <div>
            <span className="text-ios-gray1">Scans </span>
            {detail.scanCount}
            {detail.voidedCount ? ` (+${detail.voidedCount} voided)` : ""}
          </div>
        </div>
        {detail.counters.length > 0 && (
          <div className="mt-3 text-sm">
            <span className="text-ios-gray1">Counters: </span>
            {detail.counters
              .map((c) => `${c.name} — ${c.units} units / ${c.scans} scans`)
              .join(" · ")}
          </div>
        )}
      </div>

      {ready && (
        <div className="bg-white rounded-2xl shadow-ios p-4 mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={filter}
              onChange={(e) => resetPagination(e.target.value)}
              placeholder="Search tire, UPC, or manufacturer code"
              className="flex-1 min-w-[260px] px-3 py-2 border border-ios-gray5 rounded-xl text-sm"
            />
            {filter && (
              <button
                onClick={() => resetPagination("")}
                className="text-ios-blue text-sm font-medium hover:underline"
              >
                Clear
              </button>
            )}
          </div>
          <p className="text-xs text-ios-gray1 mt-2">
            Matches item ID, brand, model, size, MPN, UPC, or EAN. Filter applies
            to the tables below; export buttons still export the full report.
          </p>
        </div>
      )}

      <div className="flex gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setTab("discrepancy")}
          className={`px-4 py-2 rounded-xl text-sm font-medium ${
            tab === "discrepancy"
              ? "bg-ios-blue text-white"
              : "bg-white border border-ios-gray5 text-ios-gray1"
          }`}
        >
          Discrepancy
        </button>
        <button
          onClick={() => setTab("scanned")}
          className={`px-4 py-2 rounded-xl text-sm font-medium ${
            tab === "scanned"
              ? "bg-ios-blue text-white"
              : "bg-white border border-ios-gray5 text-ios-gray1"
          }`}
        >
          Scanned
        </button>
        <div className="flex-1" />
        {ready && tab === "discrepancy" && summary && (
          <>
            <Btn tone="gray" onClick={() => downloadDiscrepancyCsv(header, rows, unmatched, summary)}>
              CSV
            </Btn>
            <Btn onClick={() => downloadDiscrepancyPdf(header, rows, unmatched, summary)}>
              PDF
            </Btn>
          </>
        )}
        {ready && tab === "scanned" && (
          <>
            <Btn tone="gray" onClick={() => downloadScannedCsv(header, rows, unmatched)}>
              CSV
            </Btn>
            <Btn onClick={() => downloadScannedPdf(header, rows, unmatched)}>PDF</Btn>
          </>
        )}
      </div>

      {/* Baseline not ready — show the state rather than misleading zeros. */}
      {!ready && (
        <div className="bg-white rounded-2xl shadow-ios p-8 text-center">
          {variance && "baselineStatus" in variance && variance.baselineStatus === "pending" ? (
            <p className="text-ios-orange font-medium">
              Baseline still loading from IECentral…
            </p>
          ) : (
            <>
              <p className="text-ios-red font-medium">Baseline failed</p>
              <p className="text-ios-gray1 text-sm mt-1">
                {variance && "baselineError" in variance
                  ? variance.baselineError
                  : "Unknown error"}
              </p>
              <p className="text-ios-gray1 text-sm mt-3">
                Scans are still recorded. Variance needs the baseline — reopen a
                batch once IECentral is reachable.
              </p>
            </>
          )}
        </div>
      )}

      {ready && tab === "discrepancy" && summary && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl shadow-ios p-5 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4 text-center">
            {[
              ["Matched", summary.matched, "text-ios-gray1"],
              ["Short", summary.short, "text-ios-red"],
              ["Over", summary.over, "text-ios-blue"],
              ["Not found", summary.notFound, "text-ios-red"],
              ["Unexpected", summary.unexpected, "text-ios-orange"],
              ["Unmatched UPCs", summary.unmatchedUpcs, "text-ios-orange"],
            ].map(([label, n, tone]) => (
              <div key={String(label)}>
                <div className={`text-2xl font-bold ${tone}`}>{String(n)}</div>
                <div className="text-xs text-ios-gray1 uppercase tracking-wider">
                  {String(label)}
                </div>
              </div>
            ))}
            <div className="col-span-2 sm:col-span-4 lg:col-span-6 border-t border-ios-gray5 pt-3 text-sm text-ios-gray1">
              Book {summary.expectedUnits.toLocaleString()} tires · counted{" "}
              {summary.countedUnits.toLocaleString()}
              {summary.expectedUnits > 0 && (
                <>
                  {" "}
                  <span className="font-semibold text-[#1c1c1e]">
                    ({(
                      (summary.countedUnits / summary.expectedUnits) * 100
                    ).toFixed(1)}
                    % of book)
                  </span>
                </>
              )}{" "}
              · net{" "}
              <span
                className={
                  summary.netUnitVariance < 0 ? "text-ios-red" : "text-ios-blue"
                }
              >
                {summary.netUnitVariance > 0 ? "+" : ""}
                {summary.netUnitVariance.toLocaleString()}
              </span>
            </div>
          </div>

          {(["short", "over", "notFound", "unexpected"] as const).map((bucket) => {
            const bucketRows = rows.filter((r) => r.bucket === bucket);
            const group = bucketRows.filter(matchesRow);
            if (bucketRows.length === 0) return null;
            const page = pageByBucket[bucket] ?? 1;
            const pageCount = Math.max(1, Math.ceil(group.length / PAGE_SIZE));
            const currentPage = Math.min(page, pageCount);
            const start = (currentPage - 1) * PAGE_SIZE;
            const visible = group.slice(start, start + PAGE_SIZE);
            return (
              <div key={bucket} className="bg-white rounded-2xl shadow-ios overflow-x-auto">
                <div className="px-5 py-3 border-b border-ios-gray5 font-semibold text-[#1c1c1e] flex flex-wrap items-baseline gap-x-2">
                  <span>{BUCKET_LABEL[bucket]}</span>
                  <span className="text-ios-gray1 font-normal">
                    ({group.length}
                    {activeFilter && group.length !== bucketRows.length
                      ? ` of ${bucketRows.length}`
                      : ""}
                    )
                  </span>
                </div>
                {group.length === 0 ? (
                  <div className="px-5 py-6 text-sm text-ios-gray1">
                    No matches in this bucket.
                  </div>
                ) : (
                  <table className="w-full text-sm min-w-[760px]">
                    <thead className="bg-ios-gray6 text-ios-gray1 text-left">
                      <tr>
                        <th className="px-4 py-2 font-semibold">Item ID</th>
                        <th className="px-4 py-2 font-semibold">Brand</th>
                        <th className="px-4 py-2 font-semibold">Model</th>
                        <th className="px-4 py-2 font-semibold">Size</th>
                        <th className="px-4 py-2 font-semibold text-right">Book</th>
                        <th className="px-4 py-2 font-semibold text-right">Counted</th>
                        <th className="px-4 py-2 font-semibold text-right">Variance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((r) => (
                        <tr key={r.itemId} className="border-t border-ios-gray5">
                          <td className="px-4 py-2 font-mono text-xs text-[#1c1c1e]">{r.itemId}</td>
                          <td className="px-4 py-2 text-[#1c1c1e]">{r.brand ?? "—"}</td>
                          <td className="px-4 py-2 text-ios-gray1">{r.model ?? "—"}</td>
                          <td className="px-4 py-2 text-ios-gray1">{r.size ?? "—"}</td>
                          <td className="px-4 py-2 text-right text-[#1c1c1e]">{r.expected}</td>
                          <td className="px-4 py-2 text-right text-[#1c1c1e]">{r.counted}</td>
                          <td
                            className={`px-4 py-2 text-right font-semibold ${
                              r.variance < 0 ? "text-ios-red" : "text-ios-blue"
                            }`}
                          >
                            {r.variance > 0 ? "+" : ""}
                            {r.variance}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-ios-gray5 bg-ios-gray6/50 font-semibold">
                        <td className="px-4 py-2 text-ios-gray1" colSpan={4}>
                          Subtotal
                        </td>
                        <td className="px-4 py-2 text-right">
                          {group.reduce((n, r) => n + r.expected, 0)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {group.reduce((n, r) => n + r.counted, 0)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {group.reduce((n, r) => n + r.variance, 0)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                )}
                {pageCount > 1 && (
                  <Pager
                    page={currentPage}
                    pageCount={pageCount}
                    total={group.length}
                    start={start}
                    shown={visible.length}
                    onChange={(next) =>
                      setPageByBucket((prev) => ({ ...prev, [bucket]: next }))
                    }
                  />
                )}
              </div>
            );
          })}

          {unmatched.length > 0 && (() => {
            const filtered = unmatched.filter(matchesUpc);
            const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
            const currentPage = Math.min(unmatchedPage, pageCount);
            const start = (currentPage - 1) * PAGE_SIZE;
            const visible = filtered.slice(start, start + PAGE_SIZE);
            return (
            <div className="bg-white rounded-2xl shadow-ios overflow-hidden">
              <div className="px-5 py-3 border-b border-ios-gray5 font-semibold text-[#1c1c1e]">
                Unmatched UPCs{" "}
                <span className="text-ios-gray1 font-normal">
                  ({filtered.length}
                  {activeFilter && filtered.length !== unmatched.length
                    ? ` of ${unmatched.length}`
                    : ""}
                  ) — not included in variance
                </span>
              </div>
              <div className="px-5 py-2 text-xs text-ios-gray1">
                These barcodes aren&apos;t in the UPC table, so they can&apos;t be
                attributed to an item. Attaching one here also teaches the UPC
                table so it matches automatically next time.
              </div>
              {filtered.length === 0 ? (
                <div className="px-5 py-6 text-sm text-ios-gray1">
                  No unmatched UPCs match the search.
                </div>
              ) : (
              <table className="w-full text-sm">
                <tbody>
                  {visible.map((u) => (
                    <tr key={u.upc} className="border-t border-ios-gray5 align-top">
                      <td className="px-4 py-3 font-mono text-xs text-[#1c1c1e]">{u.upc}</td>
                      <td className="px-4 py-3 text-[#1c1c1e]">
                        {u.countedQty} units
                        <span className="text-ios-gray1"> / {u.scanCount} scans</span>
                      </td>
                      <td className="px-4 py-3">
                        {!canEdit ? null : resolving === u.upc ? (
                          <div className="space-y-2">
                            <div className="flex gap-2">
                              <input
                                value={q}
                                onChange={(e) => setQ(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                                placeholder="e.g. 245/40R18 Michelin"
                                className="px-3 py-2 border border-ios-gray5 rounded-xl text-sm flex-1"
                              />
                              <Btn onClick={runSearch}>
                                {searching ? "…" : "Search"}
                              </Btn>
                              <Btn tone="gray" onClick={() => setResolving(null)}>
                                Cancel
                              </Btn>
                            </div>
                            <label className="flex items-center gap-2 text-xs text-ios-gray1">
                              <input
                                type="checkbox"
                                checked={saveMapping}
                                onChange={(e) => setSaveMapping(e.target.checked)}
                              />
                              Also save this UPC → item mapping for next time
                            </label>
                            <div className="max-h-56 overflow-y-auto divide-y divide-ios-gray5">
                              {results.map((r) => (
                                <button
                                  key={r.itemId}
                                  onClick={() => attach(u.upc, r.itemId)}
                                  className="block w-full text-left py-2 hover:bg-ios-gray6"
                                >
                                  <div className="text-[#1c1c1e] text-sm font-medium">
                                    {r.brand} {r.model}
                                  </div>
                                  <div className="text-xs text-ios-gray1">
                                    {r.sizeDesc} · {r.itemId}
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <Btn
                            tone="gray"
                            onClick={() => {
                              setResolving(u.upc);
                              setResults([]);
                              setQ("");
                            }}
                          >
                            Attach to an item
                          </Btn>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              )}
              {pageCount > 1 && (
                <Pager
                  page={currentPage}
                  pageCount={pageCount}
                  total={filtered.length}
                  start={start}
                  shown={visible.length}
                  onChange={setUnmatchedPage}
                />
              )}
            </div>
            );
          })()}
        </div>
      )}

      {ready && tab === "scanned" && (() => {
        const countedRows = rows.filter((r) => r.counted > 0);
        const filteredCounted = countedRows.filter(matchesRow);
        const countedPageCount = Math.max(1, Math.ceil(filteredCounted.length / PAGE_SIZE));
        const countedCurrentPage = Math.min(scannedItemsPage, countedPageCount);
        const countedStart = (countedCurrentPage - 1) * PAGE_SIZE;
        const countedVisible = filteredCounted.slice(countedStart, countedStart + PAGE_SIZE);

        const scanList = scans ?? [];
        const filteredScans = scanList.filter(matchesScan);
        const scansPageCount = Math.max(1, Math.ceil(filteredScans.length / PAGE_SIZE));
        const scansCurrentPage = Math.min(scanEventsPage, scansPageCount);
        const scansStart = (scansCurrentPage - 1) * PAGE_SIZE;
        const scansVisible = filteredScans.slice(scansStart, scansStart + PAGE_SIZE);

        // "Last 10 scanned" = the 10 most recently scanned distinct items, joined
        // to their variance row so the counter sees book / counted / variance for
        // whatever just crossed the scanner. Voided scans are excluded — a voided
        // scan wasn't really counted, so leading with it would mislead.
        const rowByItemId = new Map(rows.map((r) => [r.itemId.toUpperCase(), r]));
        const recent: Array<{
          itemId: string;
          brand?: string;
          size?: string;
          expected: number;
          counted: number;
          variance: number;
          scannedAt: number;
        }> = [];
        const seen = new Set<string>();
        for (const s of scanList) {
          if (s.voided) continue;
          if (!s.itemId) continue;
          const k = s.itemId.toUpperCase();
          if (seen.has(k)) continue;
          const r = rowByItemId.get(k);
          if (!r) continue;
          seen.add(k);
          recent.push({
            itemId: r.itemId,
            brand: r.brand,
            size: r.size,
            expected: r.expected,
            counted: r.counted,
            variance: r.variance,
            scannedAt: s.scannedAt,
          });
          if (recent.length >= 10) break;
        }

        return (
        <div className="space-y-5">
          {recent.length > 0 && (
            <div className="bg-white rounded-2xl shadow-ios overflow-x-auto">
              <div className="px-5 py-3 border-b border-ios-gray5 font-semibold text-[#1c1c1e]">
                Last 10 scanned{" "}
                <span className="text-ios-gray1 font-normal">
                  — most recent items with their book / counted / variance
                </span>
              </div>
              <table className="w-full text-sm min-w-[700px]">
                <thead className="bg-ios-gray6 text-ios-gray1 text-left">
                  <tr>
                    <th className="px-4 py-2 font-semibold">When</th>
                    <th className="px-4 py-2 font-semibold">Item ID</th>
                    <th className="px-4 py-2 font-semibold">Brand</th>
                    <th className="px-4 py-2 font-semibold">Size</th>
                    <th className="px-4 py-2 font-semibold text-right">Book</th>
                    <th className="px-4 py-2 font-semibold text-right">Scanned</th>
                    <th className="px-4 py-2 font-semibold text-right">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.itemId} className="border-t border-ios-gray5">
                      <td className="px-4 py-2 text-ios-gray1 text-xs whitespace-nowrap">
                        {new Date(r.scannedAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-[#1c1c1e]">{r.itemId}</td>
                      <td className="px-4 py-2 text-[#1c1c1e]">{r.brand ?? "—"}</td>
                      <td className="px-4 py-2 text-ios-gray1">{r.size ?? "—"}</td>
                      <td className="px-4 py-2 text-right text-[#1c1c1e]">{r.expected}</td>
                      <td className="px-4 py-2 text-right text-[#1c1c1e]">{r.counted}</td>
                      <td
                        className={`px-4 py-2 text-right font-semibold ${
                          r.variance < 0
                            ? "text-ios-red"
                            : r.variance > 0
                              ? "text-ios-blue"
                              : "text-ios-gray1"
                        }`}
                      >
                        {r.variance > 0 ? "+" : ""}
                        {r.variance}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-ios overflow-x-auto">
            <div className="px-5 py-3 border-b border-ios-gray5 font-semibold text-[#1c1c1e]">
              Items counted{" "}
              <span className="text-ios-gray1 font-normal">
                ({filteredCounted.length}
                {activeFilter && filteredCounted.length !== countedRows.length
                  ? ` of ${countedRows.length}`
                  : ""}
                )
              </span>
            </div>
            {filteredCounted.length === 0 ? (
              <div className="px-5 py-6 text-sm text-ios-gray1">
                No items match the search.
              </div>
            ) : (
              <table className="w-full text-sm min-w-[700px]">
                <thead className="bg-ios-gray6 text-ios-gray1 text-left">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Item ID</th>
                    <th className="px-4 py-2 font-semibold">Brand</th>
                    <th className="px-4 py-2 font-semibold">Size</th>
                    <th className="px-4 py-2 font-semibold text-right">Counted</th>
                    <th className="px-4 py-2 font-semibold text-right">Scans</th>
                  </tr>
                </thead>
                <tbody>
                  {countedVisible.map((r) => (
                    <tr key={r.itemId} className="border-t border-ios-gray5">
                      <td className="px-4 py-2 font-mono text-xs text-[#1c1c1e]">{r.itemId}</td>
                      <td className="px-4 py-2 text-[#1c1c1e]">{r.brand ?? "—"}</td>
                      <td className="px-4 py-2 text-ios-gray1">{r.size ?? "—"}</td>
                      <td className="px-4 py-2 text-right text-[#1c1c1e]">{r.counted}</td>
                      <td className="px-4 py-2 text-right text-ios-gray1">{r.scanCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {countedPageCount > 1 && (
              <Pager
                page={countedCurrentPage}
                pageCount={countedPageCount}
                total={filteredCounted.length}
                start={countedStart}
                shown={countedVisible.length}
                onChange={setScannedItemsPage}
              />
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-ios overflow-x-auto">
            <div className="px-5 py-3 border-b border-ios-gray5 font-semibold text-[#1c1c1e]">
              Scan events{" "}
              <span className="text-ios-gray1 font-normal">
                ({filteredScans.length}
                {activeFilter && filteredScans.length !== scanList.length
                  ? ` of ${scanList.length}`
                  : ""}
                ) — most recent first, voided scans kept struck through
              </span>
            </div>
            {filteredScans.length === 0 ? (
              <div className="px-5 py-6 text-sm text-ios-gray1">
                No scans match the search.
              </div>
            ) : (
              <table className="w-full text-sm min-w-[700px]">
                <thead className="bg-ios-gray6 text-ios-gray1 text-left">
                  <tr>
                    <th className="px-4 py-2 font-semibold">When</th>
                    <th className="px-4 py-2 font-semibold">Barcode / Item</th>
                    <th className="px-4 py-2 font-semibold">By</th>
                    <th className="px-4 py-2 font-semibold">Match</th>
                    <th className="px-4 py-2 font-semibold text-right">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {scansVisible.map((s) => (
                    <tr
                      key={s._id}
                      className={`border-t border-ios-gray5 ${
                        s.voided ? "line-through text-ios-gray1 opacity-60" : ""
                      }`}
                    >
                      <td className="px-4 py-2 text-ios-gray1 text-xs whitespace-nowrap">
                        {new Date(s.scannedAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-[#1c1c1e]">
                        {s.itemId ?? s.upc ?? s.rawBarcode}
                      </td>
                      <td className="px-4 py-2 text-ios-gray1">{s.scannedByName}</td>
                      <td className="px-4 py-2 text-xs text-ios-gray1">{s.matchSource}</td>
                      <td className="px-4 py-2 text-right text-[#1c1c1e]">{s.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {scansPageCount > 1 && (
              <Pager
                page={scansCurrentPage}
                pageCount={scansPageCount}
                total={filteredScans.length}
                start={scansStart}
                shown={scansVisible.length}
                onChange={setScanEventsPage}
              />
            )}
          </div>
        </div>
        );
      })()}
    </div>
  );
}

export default function CountReportPage() {
  return (
    <Protected>
      <CountReport />
    </Protected>
  );
}
