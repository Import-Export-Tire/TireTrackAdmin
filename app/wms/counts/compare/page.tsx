"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Protected } from "../../../protected";
import { useAuth } from "../../../auth-context";
import {
  downloadComparisonCsv,
  downloadComparisonExcel,
  COMPARISON_LABEL,
} from "../exports";

type Bucket =
  | "disagree"
  | "missed-in-second"
  | "missed-in-first"
  | "agreed-variance"
  | "not-recounted"
  | "agreed-clean";

/**
 * Second-count comparison.
 *
 * The order of the blocks is the point: a disagreement between two counts is not
 * a variance, it is a counting problem, and it has to be dealt with before any
 * number here is used to adjust stock. Confirmed variances — both passes landing
 * on the same figure — come after, because those are the ones worth acting on.
 */
const ORDER: Bucket[] = [
  "disagree",
  "missed-in-second",
  "missed-in-first",
  "agreed-variance",
  "not-recounted",
  "agreed-clean",
];

const TONE: Record<Bucket, string> = {
  disagree: "text-ios-red",
  "missed-in-second": "text-ios-orange",
  "missed-in-first": "text-ios-orange",
  "agreed-variance": "text-[#1c1c1e]",
  "not-recounted": "text-ios-gray1",
  "agreed-clean": "text-ios-gray1",
};

function Compare() {
  const { admin } = useAuth();
  // Deep-linked from a count's own report screen, so "compare this with…" lands
  // here with both passes already chosen.
  const search = useSearchParams();
  const [loc, setLoc] = useState(search?.get("loc") ?? "W09");
  const [firstId, setFirstId] = useState(search?.get("first") ?? "");
  const [secondId, setSecondId] = useState(search?.get("second") ?? "");
  const [showClean, setShowClean] = useState(false);
  // Left undefined so the server infers it from coverage; set only to override.
  const [modeOverride, setModeOverride] = useState<"full" | "partial" | undefined>(
    undefined,
  );

  const locations = useQuery(api.wms_count.getCountLocations, {});
  const batches = useQuery(api.wms_count.getCountBatches, {
    warehouseCode: loc,
  });
  const result = useQuery(
    api.wms_count.compareCountBatches,
    firstId && secondId && firstId !== secondId
      ? {
          firstBatchId: firstId as any,
          secondBatchId: secondId as any,
          ...(modeOverride ? { mode: modeOverride } : {}),
        }
      : "skip",
  );

  if (!admin) return <div className="p-6 text-ios-gray1">Sign in required.</div>;

  const locationLabel =
    locations?.find((l) => l.code === loc)?.label ?? loc;
  const label = (b: any) =>
    `${new Date(b.openedAt).toLocaleDateString()} ${new Date(b.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${b.status} · ${b.baselineItemCount ?? "?"} lines`;

  const ready = result && "rows" in result && result.ready;
  const rows: any[] = ready ? (result as any).rows : [];
  const summary: any = ready ? (result as any).summary : null;
  const meta = ready
    ? {
        warehouseCode: (result as any).warehouseCode,
        locationLabel,
        first: (result as any).first,
        second: (result as any).second,
      }
    : null!;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="mb-2">
        <Link
          href="/wms/counts"
          className="text-ios-blue text-sm font-medium hover:underline"
        >
          ‹ Inventory Counts
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-semibold text-[#1c1c1e]">
          Compare two counts
        </h1>
        <p className="text-sm text-ios-gray1 mt-1">
          One count can&apos;t tell a real shortage from a miscount. Two can —
          where both passes agree, the number is worth acting on; where they
          disagree with each other, somebody needs to go look again.
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-ios p-5 space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-sm">
            <div className="text-ios-gray1 mb-1">Location</div>
            <select
              value={loc}
              onChange={(e) => {
                setLoc(e.target.value);
                setFirstId("");
                setSecondId("");
              }}
              className="px-3 py-2 border border-ios-gray5 rounded-xl text-sm"
            >
              {(locations ?? [{ code: loc, label: loc }]).map((l: any) => (
                <option key={l.code} value={l.code}>
                  {l.label} ({l.code})
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm flex-1 min-w-[220px]">
            <div className="text-ios-gray1 mb-1">First count</div>
            <select
              value={firstId}
              onChange={(e) => setFirstId(e.target.value)}
              className="w-full px-3 py-2 border border-ios-gray5 rounded-xl text-sm"
            >
              <option value="">Choose…</option>
              {(batches ?? []).map((b: any) => (
                <option key={b._id} value={b._id}>
                  {label(b)}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm flex-1 min-w-[220px]">
            <div className="text-ios-gray1 mb-1">Second count</div>
            <select
              value={secondId}
              onChange={(e) => setSecondId(e.target.value)}
              className="w-full px-3 py-2 border border-ios-gray5 rounded-xl text-sm"
            >
              <option value="">Choose…</option>
              {(batches ?? []).map((b: any) => (
                <option key={b._id} value={b._id}>
                  {label(b)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {(batches ?? []).length < 2 && (
          <div className="text-xs text-ios-orange">
            {locationLabel} has only {(batches ?? []).length} count so far —
            there&apos;s nothing to compare until the second one is open.
          </div>
        )}
      </div>

      {result && "ready" in result && !result.ready && (
        <div className="bg-white rounded-2xl shadow-ios p-5 text-sm text-ios-orange">
          {(result as any).reason}
        </div>
      )}

      {ready && summary && (
        <>
          {/* Scope banner. This governs what the report is ALLOWED to conclude,
              so it goes above the numbers rather than in a footnote. */}
          <div
            className={`rounded-2xl p-4 border-l-[3px] ${
              summary.mode === "partial"
                ? "bg-ios-orange/5 border-ios-orange"
                : "bg-ios-blue/5 border-ios-blue"
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-[#1c1c1e]">
                {summary.mode === "partial"
                  ? `Partial second count — ${summary.recountedLines} of ${summary.bookLines} book lines recounted (${summary.coverageLinesPct}%, ${summary.coverageUnitsPct}% of units)`
                  : `Full second count — ${summary.recountedLines} of ${summary.bookLines} book lines recounted (${summary.coverageLinesPct}%)`}
              </p>
              <label className="text-xs text-ios-gray1 flex items-center gap-2">
                Treat as
                <select
                  value={modeOverride ?? "auto"}
                  onChange={(e) =>
                    setModeOverride(
                      e.target.value === "auto"
                        ? undefined
                        : (e.target.value as "full" | "partial"),
                    )
                  }
                  className="px-2 py-1 border border-ios-gray5 rounded-lg bg-white"
                >
                  <option value="auto">
                    auto ({(result as any).mode})
                  </option>
                  <option value="partial">partial</option>
                  <option value="full">full</option>
                </select>
              </label>
            </div>
            {summary.mode === "partial" ? (
              <p className="mt-1 text-sm text-ios-gray1">
                Lines the second pass never reached carry{" "}
                <strong>no confirmed variance</strong> — only the first
                count&apos;s own figure, unverified. Scope is inferred from what
                was scanned, so a line that was recounted and genuinely came up
                empty can&apos;t be told apart from one nobody visited: a partial
                count can confirm an overage, never a shortage to zero.
              </p>
            ) : (
              <p className="mt-1 text-sm text-ios-gray1">
                Both passes covered the location, so a tire absent from both
                confirms shrink.
              </p>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-ios p-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              {[
                ["Lines compared", summary.lines, ""],
                ["Disagree — recount", summary.disagree, "text-ios-red"],
                [
                  "Confirmed variance lines",
                  summary.agreedVariance,
                  "text-[#1c1c1e]",
                ],
                ["Agreed and clean", summary.agreedClean, "text-ios-gray1"],
                ["Units in dispute", summary.unitsInDispute, "text-ios-red"],
                [
                  "CONFIRMED net variance",
                  summary.confirmedNetVariance > 0
                    ? `+${summary.confirmedNetVariance}`
                    : summary.confirmedNetVariance,
                  "text-[#1c1c1e] font-semibold",
                ],
                summary.mode === "partial"
                  ? ["Not recounted", summary.notRecounted, "text-ios-gray1"]
                  : [
                      "Missed in 1st / 2nd",
                      `${summary.missedInFirst} / ${summary.missedInSecond}`,
                      "text-ios-orange",
                    ],
                ["Book moved between", summary.bookMovedLines, "text-ios-gray1"],
              ].map(([k, v, tone]) => (
                <div key={String(k)}>
                  <div className="text-ios-gray1 text-xs">{k}</div>
                  <div className={`text-xl ${tone}`}>{String(v)}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2 items-center">
              <button
                onClick={() => downloadComparisonExcel(meta, rows, summary)}
                className="px-4 py-2 rounded-xl bg-[#007AFF] text-white text-sm"
              >
                Download Excel
              </button>
              <button
                onClick={() => downloadComparisonCsv(meta, rows, summary)}
                className="px-4 py-2 rounded-xl bg-white border border-ios-gray5 text-[#1c1c1e] text-sm"
              >
                CSV
              </button>
              <label className="text-xs text-ios-gray1 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showClean}
                  onChange={(e) => setShowClean(e.target.checked)}
                />
                also show clean lines and lines that weren&apos;t recounted
              </label>
            </div>
          </div>

          {ORDER.filter(
            (bk) =>
              (bk !== "agreed-clean" && bk !== "not-recounted") || showClean,
          ).map((bk) => {
            const group = rows.filter((r) => r.bucket === bk);
            if (!group.length) return null;
            return (
              <div
                key={bk}
                className="bg-white rounded-2xl shadow-ios overflow-hidden"
              >
                <div
                  className={`px-5 py-3 border-b border-ios-gray5 font-semibold ${TONE[bk]}`}
                >
                  {COMPARISON_LABEL[bk]}{" "}
                  <span className="font-normal text-ios-gray1">
                    ({group.length})
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-ios-gray1">
                      <tr>
                        <th className="px-4 py-2 text-left">Item</th>
                        <th className="px-4 py-2 text-right">Book</th>
                        <th className="px-4 py-2 text-right">1st count</th>
                        <th className="px-4 py-2 text-right">2nd count</th>
                        <th className="px-4 py-2 text-right">1st var</th>
                        <th className="px-4 py-2 text-right">Spread</th>
                        <th className="px-4 py-2 text-right">Confirmed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.map((r) => (
                        <tr
                          key={r.itemId}
                          className="border-t border-ios-gray5 align-top"
                        >
                          <td className="px-4 py-2">
                            <div className="text-[#1c1c1e]">{r.itemId}</div>
                            <div className="text-xs text-ios-gray1">
                              {[r.brand, r.model, r.size]
                                .filter(Boolean)
                                .join(" ")}
                              {r.variantItemIds && (
                                <> · {r.variantItemIds.join(" + ")}</>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right">
                            {r.expectedSecond}
                            {r.bookMoved && (
                              <div className="text-xs text-ios-orange">
                                was {r.expectedFirst}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right">{r.countedFirst}</td>
                          <td className="px-4 py-2 text-right">
                            {r.recounted ? r.countedSecond : "—"}
                          </td>
                          <td
                            className={`px-4 py-2 text-right ${r.firstVariance ? "text-[#1c1c1e]" : "text-ios-gray1"}`}
                          >
                            {r.firstVariance > 0 ? `+${r.firstVariance}` : r.firstVariance}
                          </td>
                          <td
                            className={`px-4 py-2 text-right ${r.spread ? "text-ios-red" : "text-ios-gray1"}`}
                          >
                            {r.spread > 0 ? `+${r.spread}` : r.spread}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {r.confirmedVariance === null
                              ? "—"
                              : r.confirmedVariance > 0
                                ? `+${r.confirmedVariance}`
                                : r.confirmedVariance}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

export default function ComparePage() {
  return (
    <Protected>
      <Compare />
    </Protected>
  );
}
