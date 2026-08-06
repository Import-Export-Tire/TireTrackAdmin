import type {
  VarianceRow,
  UnmatchedRow,
  VarianceSummary,
} from "../../../convex/wms_count_variance";

export type ReportHeader = {
  warehouseCode: string;
  locationLabel: string;
  batchId: string;
  openedAt: number;
  openedByName: string;
  closedAt?: number;
  closedByName?: string;
  baselineFileDate?: string;
  excludedNonTires?: number;
  excludedUnits?: number;
  counters: Array<{ name: string; units: number; scans: number }>;
};

const stamp = (h: ReportHeader) =>
  `${h.warehouseCode}_count_${new Date(h.openedAt).toISOString().slice(0, 10)}`;

function download(name: string, body: string, mime: string) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const csv = (rows: unknown[][]) =>
  rows.map((r) => r.map(csvCell).join(",")).join("\n");

/**
 * Provenance repeated on every export so a file explains itself once it has
 * left the app — which OEIVAL the book figures came from above all, since that
 * is what makes the variance reproducible.
 */
function provenance(h: ReportHeader): string[][] {
  return [
    ["Location", `${h.locationLabel} (${h.warehouseCode})`],
    ["Batch", h.batchId],
    [
      "Opened",
      `${new Date(h.openedAt).toLocaleString()} by ${h.openedByName}`,
    ],
    [
      "Closed",
      h.closedAt
        ? `${new Date(h.closedAt).toLocaleString()} by ${h.closedByName ?? ""}`
        : "still open",
    ],
    ["Baseline (OEIVAL file date)", h.baselineFileDate ?? "unknown"],
    [
      "Non-tire rows excluded",
      `${h.excludedNonTires ?? 0} items / ${(h.excludedUnits ?? 0).toLocaleString()} units`,
    ],
    [
      "Counters",
      h.counters.map((c) => `${c.name} (${c.units}u/${c.scans}s)`).join("; ") ||
        "none",
    ],
  ];
}

export const BUCKET_LABEL: Record<string, string> = {
  short: "Short — fewer on the floor than the book",
  over: "Over — more on the floor than the book",
  notFound: "Not found on the floor — in the book, never scanned",
  unexpected: "Unexpected — counted, not in the book",
};

export function downloadScannedCsv(
  h: ReportHeader,
  rows: VarianceRow[],
  unmatched: UnmatchedRow[],
) {
  const body: unknown[][] = [
    ...provenance(h),
    [],
    ["Item ID", "Brand", "Model", "Size", "MPN", "Counted Qty", "Scans"],
    ...rows
      .filter((r) => r.counted > 0)
      .map((r) => [
        r.itemId,
        r.brand,
        r.model,
        r.size,
        r.mpn,
        r.counted,
        r.scanCount,
      ]),
  ];
  if (unmatched.length) {
    body.push([], ["Unmatched UPC", "Counted Qty", "Scans"]);
    for (const u of unmatched) body.push([u.upc, u.countedQty, u.scanCount]);
  }
  download(`${stamp(h)}_scanned.csv`, csv(body), "text/csv");
}

export function downloadDiscrepancyCsv(
  h: ReportHeader,
  rows: VarianceRow[],
  unmatched: UnmatchedRow[],
  summary: VarianceSummary,
) {
  const body: unknown[][] = [
    ...provenance(h),
    [],
    ["SUMMARY"],
    ["Item lines in book", summary.baselineItems],
    ["Items counted", summary.countedItems],
    ["Matched", summary.matched],
    ["Short", summary.short],
    ["Over", summary.over],
    ["Not found on floor", summary.notFound],
    ["Unexpected", summary.unexpected],
    ["Unmatched UPCs", summary.unmatchedUpcs],
    ["Expected units", summary.expectedUnits],
    ["Counted units", summary.countedUnits],
    ["Net unit variance", summary.netUnitVariance],
    [],
  ];

  for (const bucket of ["short", "over", "notFound", "unexpected"] as const) {
    const group = rows.filter((r) => r.bucket === bucket);
    if (group.length === 0) continue;
    body.push([BUCKET_LABEL[bucket]]);
    body.push([
      "Item ID",
      "Brand",
      "Model",
      "Size",
      "MPN",
      "Expected",
      "Counted",
      "Variance",
    ]);
    for (const r of group) {
      body.push([
        r.itemId,
        r.brand,
        r.model,
        r.size,
        r.mpn,
        r.expected,
        r.counted,
        r.variance,
      ]);
    }
    body.push([
      "Subtotal",
      "",
      "",
      "",
      "",
      group.reduce((n, r) => n + r.expected, 0),
      group.reduce((n, r) => n + r.counted, 0),
      group.reduce((n, r) => n + r.variance, 0),
    ]);
    body.push([]);
  }

  if (unmatched.length) {
    body.push(["Unmatched UPCs — NOT included in variance"]);
    body.push(["UPC", "Counted Qty", "Scans"]);
    for (const u of unmatched) body.push([u.upc, u.countedQty, u.scanCount]);
  }

  download(`${stamp(h)}_discrepancy.csv`, csv(body), "text/csv");
}

/**
 * jspdf is imported dynamically so its ~150KB never lands in the initial bundle
 * for a page that may not export anything.
 */
async function newPdf(landscape: boolean) {
  // NAMED imports on purpose. In jspdf 4.x the default export is an object, not
  // the constructor — `new (await import("jspdf")).default(...)` throws
  // "jsPDF is not a constructor" at runtime while typechecking clean, because
  // the shipped .d.ts still declares a default. Same for autoTable.
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  return {
    doc: new jsPDF({ orientation: landscape ? "landscape" : "portrait" }),
    autoTable,
  };
}

function pdfHeader(doc: any, h: ReportHeader, title: string): number {
  doc.setFontSize(15);
  doc.text(`${title} — ${h.locationLabel} (${h.warehouseCode})`, 14, 16);
  doc.setFontSize(8);
  const lines = provenance(h).map(([k, v]) => `${k}: ${v}`);
  doc.text(lines, 14, 23);
  return 23 + lines.length * 4 + 4;
}

export async function downloadScannedPdf(
  h: ReportHeader,
  rows: VarianceRow[],
  unmatched: UnmatchedRow[],
) {
  const { doc, autoTable } = await newPdf(false);
  const y = pdfHeader(doc, h, "Scanned Report");
  autoTable(doc, {
    startY: y,
    head: [["Item ID", "Brand", "Model", "Size", "Counted", "Scans"]],
    body: rows
      .filter((r) => r.counted > 0)
      .map((r) => [
        r.itemId,
        r.brand ?? "",
        r.model ?? "",
        r.size ?? "",
        r.counted,
        r.scanCount,
      ]),
    styles: { fontSize: 7 },
    headStyles: { fillColor: [0, 122, 255] },
  });
  if (unmatched.length) {
    autoTable(doc, {
      head: [["Unmatched UPC", "Counted", "Scans"]],
      body: unmatched.map((u) => [u.upc, u.countedQty, u.scanCount]),
      styles: { fontSize: 7 },
      headStyles: { fillColor: [255, 149, 0] },
    });
  }
  doc.save(`${stamp(h)}_scanned.pdf`);
}

export async function downloadDiscrepancyPdf(
  h: ReportHeader,
  rows: VarianceRow[],
  unmatched: UnmatchedRow[],
  summary: VarianceSummary,
) {
  const { doc, autoTable } = await newPdf(true);
  const y = pdfHeader(doc, h, "Discrepancy Report");

  autoTable(doc, {
    startY: y,
    head: [
      [
        "Matched",
        "Short",
        "Over",
        "Not found",
        "Unexpected",
        "Unmatched UPCs",
        "Expected u",
        "Counted u",
        "Net u",
      ],
    ],
    body: [
      [
        summary.matched,
        summary.short,
        summary.over,
        summary.notFound,
        summary.unexpected,
        summary.unmatchedUpcs,
        summary.expectedUnits,
        summary.countedUnits,
        summary.netUnitVariance,
      ],
    ],
    styles: { fontSize: 8 },
    headStyles: { fillColor: [0, 122, 255] },
  });

  for (const bucket of ["short", "over", "notFound", "unexpected"] as const) {
    const group = rows.filter((r) => r.bucket === bucket);
    if (group.length === 0) continue;
    autoTable(doc, {
      head: [
        [
          {
            content: `${BUCKET_LABEL[bucket]}  (${group.length})`,
            colSpan: 8,
            styles: { halign: "left" as const },
          },
        ],
        [
          "Item ID",
          "Brand",
          "Model",
          "Size",
          "MPN",
          "Expected",
          "Counted",
          "Variance",
        ],
      ],
      body: [
        ...group.map((r) => [
          r.itemId,
          r.brand ?? "",
          r.model ?? "",
          r.size ?? "",
          r.mpn ?? "",
          r.expected,
          r.counted,
          r.variance,
        ]),
        [
          "Subtotal",
          "",
          "",
          "",
          "",
          group.reduce((n, r) => n + r.expected, 0),
          group.reduce((n, r) => n + r.counted, 0),
          group.reduce((n, r) => n + r.variance, 0),
        ],
      ],
      styles: { fontSize: 7 },
      headStyles: { fillColor: [88, 86, 214] },
    });
  }

  if (unmatched.length) {
    autoTable(doc, {
      head: [
        [
          {
            content: "Unmatched UPCs — NOT included in variance",
            colSpan: 3,
            styles: { halign: "left" as const },
          },
        ],
        ["UPC", "Counted", "Scans"],
      ],
      body: unmatched.map((u) => [u.upc, u.countedQty, u.scanCount]),
      styles: { fontSize: 7 },
      headStyles: { fillColor: [255, 149, 0] },
    });
  }

  doc.save(`${stamp(h)}_discrepancy.pdf`);
}

export const COMPARISON_LABEL: Record<string, string> = {
  disagree:
    "DISAGREE — the two counts got different numbers. Recount before adjusting anything.",
  "missed-in-second": "Counted in the first pass, never scanned in the second",
  "missed-in-first": "Counted in the second pass, never scanned in the first",
  "agreed-variance":
    "CONFIRMED variance — both counts agree, and both disagree with the book",
  "agreed-clean": "Agreed and matching the book",
};

/**
 * Second-count comparison export.
 *
 * Ordered by what somebody has to act on: disagreements first (a counting problem
 * nobody can adjust against), then lines only one pass reached, then the confirmed
 * variances, and the clean agreement last. The clean block is included rather than
 * dropped so the file can stand as the evidence that the location was counted.
 */
export function downloadComparisonCsv(
  meta: {
    warehouseCode: string;
    locationLabel: string;
    first: { batchId: string; openedAt: number; closedAt?: number; baselineFileDate?: string; openedByName: string };
    second: { batchId: string; openedAt: number; closedAt?: number; baselineFileDate?: string; openedByName: string };
  },
  rows: any[],
  summary: any,
) {
  const pass = (label: string, p: typeof meta.first) => [
    [label, p.batchId],
    ["  opened", `${new Date(p.openedAt).toLocaleString()} by ${p.openedByName}`],
    ["  closed", p.closedAt ? new Date(p.closedAt).toLocaleString() : "still open"],
    ["  book (OEIVAL file date)", p.baselineFileDate ?? "unknown"],
  ];

  const body: unknown[][] = [
    ["Location", `${meta.locationLabel} (${meta.warehouseCode})`],
    ...pass("FIRST COUNT", meta.first),
    ...pass("SECOND COUNT", meta.second),
    [],
    ["SUMMARY"],
    ["Lines compared", summary.lines],
    ["Agreed and clean", summary.agreedClean],
    ["Agreed variance (actionable)", summary.agreedVariance],
    ["Disagree (recount)", summary.disagree],
    ["Missed in first pass", summary.missedInFirst],
    ["Missed in second pass", summary.missedInSecond],
    ["Book moved between counts", summary.bookMovedLines],
    ["Units in dispute", summary.unitsInDispute],
    ["CONFIRMED net variance", summary.confirmedNetVariance],
    ["  confirmed short units", summary.confirmedShortUnits],
    ["  confirmed over units", summary.confirmedOverUnits],
    ["Counted units, first pass", summary.countedUnitsFirst],
    ["Counted units, second pass", summary.countedUnitsSecond],
    [],
  ];

  const order = [
    "disagree",
    "missed-in-second",
    "missed-in-first",
    "agreed-variance",
    "agreed-clean",
  ];
  for (const bucket of order) {
    const group = rows.filter((r) => r.bucket === bucket);
    if (group.length === 0) continue;
    body.push([COMPARISON_LABEL[bucket]]);
    body.push([
      "Item ID",
      "Brand",
      "Model",
      "Size",
      "MPN",
      "Book (1st)",
      "Book (2nd)",
      "Counted 1st",
      "Counted 2nd",
      "Spread",
      "Confirmed variance",
      "Book moved",
      "Variants",
    ]);
    for (const r of group) {
      body.push([
        r.itemId,
        r.brand ?? "",
        r.model ?? "",
        r.size ?? "",
        r.mpn ?? "",
        r.expectedFirst,
        r.expectedSecond,
        r.countedFirst,
        r.countedSecond,
        r.spread,
        r.confirmedVariance ?? "",
        r.bookMoved ? "yes" : "",
        (r.variantItemIds ?? []).join(" + "),
      ]);
    }
    body.push([]);
  }

  download(
    `${meta.warehouseCode}_count_comparison_${new Date(meta.second.openedAt).toISOString().slice(0, 10)}.csv`,
    csv(body),
    "text/csv;charset=utf-8",
  );
}
