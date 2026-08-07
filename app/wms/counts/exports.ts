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

function download(name: string, body: BlobPart, mime: string) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Quote only when the value actually needs it.
 *
 * Quoting every cell — which this used to do — makes Excel import every number as
 * TEXT. The column then can't be summed, sorted numerically, or pivoted, and
 * "Counted" sorts 1, 10, 100, 2. That is the single biggest thing wrong with a
 * spreadsheet export, and it is invisible until somebody tries to use the file.
 */
const csvCell = (v: Cell) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: Cell[][]) =>
  rows.map((r) => r.map(csvCell).join(",")).join("\r\n");

export type Cell = string | number | null | undefined;

/**
 * A report as a real dataset: one header row, one record per row, nothing else.
 *
 * The old exports stacked a provenance block, a summary block and four separate
 * bucket tables into one sheet, each with its own header row and blank-line
 * separators. That reads fine to a human and is useless as data — Excel can't
 * autofilter, sort or pivot a sheet with five header rows in it. So the bucket
 * becomes a Status COLUMN, every record lives in one table, and the narrative
 * moves to its own sheet in the workbook.
 */
export type Table = {
  sheet: string;
  columns: string[];
  rows: Cell[][];
  /** Column widths in characters, by index. */
  widths?: number[];
};

/** Label/value narrative — the summary and provenance, kept OUT of the data table. */
export type KeyValues = { sheet: string; pairs: Array<[string, Cell]> };

function downloadTableCsv(filename: string, table: Table) {
  download(
    filename,
    csv([table.columns, ...table.rows]),
    "text/csv;charset=utf-8",
  );
}

/**
 * Multi-sheet workbook: the narrative on its own sheet, each dataset on its own
 * sheet with the header frozen and an autofilter already applied, so the file is
 * usable the moment it opens instead of after five minutes of setup.
 *
 * xlsx is imported dynamically — it is ~400KB and most visits to this page never
 * export anything.
 */
export async function buildWorkbook(sheets: Array<Table | KeyValues>) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  for (const s of sheets) {
    if ("pairs" in s) {
      const ws = XLSX.utils.aoa_to_sheet(s.pairs.map(([k, v]) => [k, v]));
      ws["!cols"] = [{ wch: 34 }, { wch: 60 }];
      XLSX.utils.book_append_sheet(wb, ws, s.sheet.slice(0, 31));
      continue;
    }
    // Blank cells must stay BLANK, not become the string "" or a 0 — a book
    // figure that is genuinely unknown has to not participate in a SUM.
    const ws = XLSX.utils.aoa_to_sheet(
      [s.columns as Cell[], ...s.rows].map((r) =>
        r.map((c) => (c === null || c === undefined ? undefined : c)),
      ),
    );
    ws["!cols"] = (s.widths ?? s.columns.map(() => 14)).map((wch) => ({ wch }));
    ws["!freeze"] = { xSplit: "0", ySplit: "1" };
    // Header row + data, so the filter dropdowns cover the real extent.
    const last = XLSX.utils.encode_cell({
      r: s.rows.length,
      c: Math.max(0, s.columns.length - 1),
    });
    ws["!autofilter"] = { ref: `A1:${last}` };
    XLSX.utils.book_append_sheet(wb, ws, s.sheet.slice(0, 31));
  }
  return { XLSX, wb };
}

async function downloadWorkbook(
  filename: string,
  sheets: Array<Table | KeyValues>,
) {
  const { XLSX, wb } = await buildWorkbook(sheets);
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  download(
    filename,
    buf,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}

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

/**
 * Status values. Deliberately plain English rather than the internal bucket names:
 * these end up in a filter dropdown in front of people who never see this code.
 */
export const STATUS: Record<string, string> = {
  match: "Matched",
  short: "Short",
  over: "Over",
  notFound: "Not found on floor",
  unexpected: "Not in book",
  unmatched: "Unattributed barcode",
};

/**
 * Provenance carried as trailing columns rather than a preamble block.
 *
 * Constant down the file, which looks redundant and is the point: a filtered
 * slice pasted into an email still says which location and which OEIVAL file it
 * came from. The old preamble was the thing that made the sheet unfilterable.
 */
const PROV_COLUMNS = ["Location", "Batch", "Book file date"];
const provCells = (h: ReportHeader): Cell[] => [
  `${h.locationLabel} (${h.warehouseCode})`,
  h.batchId,
  h.baselineFileDate ?? "unknown",
];

function summarySheet(h: ReportHeader, extra: Array<[string, Cell]>): KeyValues {
  return {
    sheet: "Summary",
    pairs: [
      ["Location", `${h.locationLabel} (${h.warehouseCode})`],
      ["Batch", h.batchId],
      ["Opened", `${new Date(h.openedAt).toLocaleString()} by ${h.openedByName}`],
      [
        "Closed",
        h.closedAt
          ? `${new Date(h.closedAt).toLocaleString()} by ${h.closedByName ?? ""}`
          : "still open",
      ],
      ["Book (OEIVAL file date)", h.baselineFileDate ?? "unknown"],
      [
        "Non-tire rows excluded",
        `${h.excludedNonTires ?? 0} items / ${(h.excludedUnits ?? 0).toLocaleString()} units`,
      ],
      [
        "Counters",
        h.counters.map((c) => `${c.name} (${c.units}u/${c.scans}s)`).join("; ") ||
          "none",
      ],
      ["", ""],
      ...extra,
    ],
  };
}

export function scannedTable(
  h: ReportHeader,
  rows: VarianceRow[],
  unmatched: UnmatchedRow[],
): Table {
  const data: Cell[][] = rows
    .filter((r) => r.counted > 0)
    .map((r) => [
      STATUS[r.bucket] ?? r.bucket,
      r.itemId,
      (r.variantItemIds ?? []).join(" + "),
      r.brand ?? "",
      r.model ?? "",
      r.size ?? "",
      r.mpn ?? "",
      "",
      r.counted,
      r.scanCount,
      ...provCells(h),
    ]);

  // Unattributed barcodes belong in the same table, not a stapled-on second one:
  // one Status filter then separates them, and nothing gets lost when somebody
  // sorts the sheet. Expected stays BLANK rather than 0 — it is unknown, and a 0
  // would quietly join every total.
  for (const u of unmatched) {
    data.push([
      STATUS.unmatched,
      "",
      "",
      "",
      "",
      "",
      "",
      u.upc,
      u.countedQty,
      u.scanCount,
      ...provCells(h),
    ]);
  }

  return {
    sheet: "Counted",
    columns: [
      "Status",
      "Item ID",
      "Variant item IDs",
      "Brand",
      "Model",
      "Size",
      "MPN",
      "Barcode",
      "Counted",
      "Scans",
      ...PROV_COLUMNS,
    ],
    rows: data,
    widths: [20, 16, 20, 18, 22, 30, 14, 16, 10, 8, 26, 34, 22],
  };
}

export function downloadScannedCsv(
  h: ReportHeader,
  rows: VarianceRow[],
  unmatched: UnmatchedRow[],
) {
  downloadTableCsv(`${stamp(h)}_scanned.csv`, scannedTable(h, rows, unmatched));
}

export function downloadScannedExcel(
  h: ReportHeader,
  rows: VarianceRow[],
  unmatched: UnmatchedRow[],
) {
  const counted = rows.filter((r) => r.counted > 0);
  return downloadWorkbook(`${stamp(h)}_scanned.xlsx`, [
    summarySheet(h, [
      ["Item lines counted", counted.length],
      ["Units counted", counted.reduce((n, r) => n + r.counted, 0)],
      ["Scans", counted.reduce((n, r) => n + r.scanCount, 0)],
      ["Unattributed barcodes", unmatched.length],
      [
        "Units on unattributed barcodes",
        unmatched.reduce((n, u) => n + u.countedQty, 0),
      ],
    ]),
    scannedTable(h, rows, unmatched),
  ]);
}

/**
 * Discrepancy lines as one table.
 *
 * Sorted worst-variance-first across ALL statuses rather than grouped into
 * per-bucket blocks: the biggest number in the building is the thing to look at
 * first, and it does not matter which bucket it happens to sit in. Excel can
 * regroup by Status in two clicks; it cannot ungroup a sheet full of subtotal rows.
 */
export function discrepancyTable(
  h: ReportHeader,
  rows: VarianceRow[],
  unmatched: UnmatchedRow[],
): Table {
  const data: Cell[][] = rows
    .filter((r) => r.bucket !== "match")
    .slice()
    .sort((a, z) => Math.abs(z.variance) - Math.abs(a.variance))
    .map((r) => [
      STATUS[r.bucket] ?? r.bucket,
      r.itemId,
      (r.variantItemIds ?? []).join(" + "),
      r.brand ?? "",
      r.model ?? "",
      r.size ?? "",
      r.mpn ?? "",
      "",
      r.expected,
      r.counted,
      r.variance,
      Math.abs(r.variance),
      r.scanCount,
      ...provCells(h),
    ]);

  for (const u of unmatched) {
    data.push([
      STATUS.unmatched,
      "",
      "",
      "",
      "",
      "",
      "",
      u.upc,
      null,
      u.countedQty,
      null,
      null,
      u.scanCount,
      ...provCells(h),
    ]);
  }

  return {
    sheet: "Discrepancies",
    columns: [
      "Status",
      "Item ID",
      "Variant item IDs",
      "Brand",
      "Model",
      "Size",
      "MPN",
      "Barcode",
      "Book",
      "Counted",
      "Variance",
      "Abs variance",
      "Scans",
      ...PROV_COLUMNS,
    ],
    rows: data,
    widths: [20, 16, 20, 18, 22, 30, 14, 16, 9, 9, 10, 12, 8, 26, 34, 22],
  };
}

export function downloadDiscrepancyCsv(
  h: ReportHeader,
  rows: VarianceRow[],
  unmatched: UnmatchedRow[],
  _summary: VarianceSummary,
) {
  downloadTableCsv(
    `${stamp(h)}_discrepancy.csv`,
    discrepancyTable(h, rows, unmatched),
  );
}

export function downloadDiscrepancyExcel(
  h: ReportHeader,
  rows: VarianceRow[],
  unmatched: UnmatchedRow[],
  summary: VarianceSummary,
) {
  return downloadWorkbook(`${stamp(h)}_discrepancy.xlsx`, [
    summarySheet(h, [
      ["Item lines in book", summary.baselineItems],
      ["Item lines counted", summary.countedItems],
      ["Matched", summary.matched],
      ["Short", summary.short],
      ["Over", summary.over],
      ["Not found on floor", summary.notFound],
      ["Not in book", summary.unexpected],
      ["Unattributed barcodes", summary.unmatchedUpcs],
      ["", ""],
      ["Book units", summary.expectedUnits],
      ["Counted units", summary.countedUnits],
      ["NET UNIT VARIANCE", summary.netUnitVariance],
      ["", ""],
      [
        "Note",
        "Unattributed barcodes are counted but belong to no item, so they are excluded from every variance figure above.",
      ],
      [
        "Note",
        "'Not found on floor' only means shrink if the count is complete. An unfinished count reports every un-reached line that way.",
      ],
    ]),
    discrepancyTable(h, rows, unmatched),
  ]);
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

// -------------------------------------------------- second-count comparison

export type ComparisonMeta = {
  warehouseCode: string;
  locationLabel: string;
  first: {
    batchId: string;
    openedAt: number;
    closedAt?: number;
    baselineFileDate?: string;
    openedByName: string;
  };
  second: ComparisonMeta["first"];
};

/**
 * Status wording chosen so the action is in the word itself. "Disagree" is not a
 * variance and must not be read as one — the first column of every row says so.
 */
export const COMPARISON_STATUS: Record<string, string> = {
  disagree: "RECOUNT — counts disagree",
  "not-recounted": "Not recounted (1st count only)",
  "missed-in-second": "Missed in 2nd count",
  "missed-in-first": "Missed in 1st count",
  "agreed-variance": "CONFIRMED variance",
  "agreed-clean": "Agreed, matches book",
};

/** Kept for the on-screen headings, which want the full sentence. */
export const COMPARISON_LABEL: Record<string, string> = {
  disagree:
    "DISAGREE — the two counts got different numbers. Recount before adjusting anything.",
  "not-recounted":
    "NOT RECOUNTED — outside the second pass. The first count's figure stands unverified.",
  "missed-in-second": "Counted in the first pass, never scanned in the second",
  "missed-in-first": "Counted in the second pass, never scanned in the first",
  "agreed-variance":
    "CONFIRMED variance — both counts agree, and both disagree with the book",
  "agreed-clean": "Agreed and matching the book",
};

const COMPARISON_PROV = [
  "Location",
  "1st count opened",
  "1st book file date",
  "2nd count opened",
  "2nd book file date",
];

export function comparisonTable(meta: ComparisonMeta, rows: any[]): Table {
  const prov: Cell[] = [
    `${meta.locationLabel} (${meta.warehouseCode})`,
    new Date(meta.first.openedAt).toLocaleString(),
    meta.first.baselineFileDate ?? "unknown",
    new Date(meta.second.openedAt).toLocaleString(),
    meta.second.baselineFileDate ?? "unknown",
  ];

  return {
    sheet: "Comparison",
    columns: [
      "Status",
      "Item ID",
      "Variant item IDs",
      "Brand",
      "Model",
      "Size",
      "MPN",
      "Book (1st)",
      "Book (2nd)",
      "Book moved",
      "Counted 1st",
      "Counted 2nd",
      "Recounted",
      "1st count variance",
      "Spread",
      "Abs spread",
      "Confirmed variance",
      ...COMPARISON_PROV,
    ],
    // Already sorted worst-disagreement-first by compareCounts; keep that order so
    // the sheet opens on the work rather than on the clean lines.
    rows: rows.map((r) => [
      COMPARISON_STATUS[r.bucket] ?? r.bucket,
      r.itemId,
      (r.variantItemIds ?? []).join(" + "),
      r.brand ?? "",
      r.model ?? "",
      r.size ?? "",
      r.mpn ?? "",
      r.expectedFirst,
      r.expectedSecond,
      r.bookMoved ? "yes" : "",
      r.countedFirst,
      r.countedSecond,
      r.recounted ? "yes" : "no",
      r.firstVariance,
      r.spread,
      Math.abs(r.spread),
      // BLANK, not 0, when the passes disagree: there is no variance to report,
      // and a 0 here would be summed as "no discrepancy" by anyone building a
      // total off this column.
      r.confirmedVariance === null || r.confirmedVariance === undefined
        ? null
        : r.confirmedVariance,
      ...prov,
    ]),
    widths: [26, 16, 20, 18, 22, 30, 14, 11, 11, 11, 12, 12, 11, 17, 9, 11, 18, 26, 20, 18, 20, 18],
  };
}

function comparisonSummary(meta: ComparisonMeta, summary: any): KeyValues {
  const pass = (label: string, p: ComparisonMeta["first"]): Array<[string, Cell]> => [
    [label, p.batchId],
    ["  opened", `${new Date(p.openedAt).toLocaleString()} by ${p.openedByName}`],
    ["  closed", p.closedAt ? new Date(p.closedAt).toLocaleString() : "still open"],
    ["  book (OEIVAL file date)", p.baselineFileDate ?? "unknown"],
  ];
  return {
    sheet: "Summary",
    pairs: [
      ["Location", `${meta.locationLabel} (${meta.warehouseCode})`],
      ["", ""],
      ...pass("FIRST COUNT", meta.first),
      ["", ""],
      ...pass("SECOND COUNT", meta.second),
      ["", ""],
      [
        "Second pass covered",
        summary.mode === "partial"
          ? `PART of the location — ${summary.recountedLines} of ${summary.bookLines} book lines (${summary.coverageLinesPct}%), ${summary.coverageUnitsPct}% of book units`
          : `the whole location — ${summary.recountedLines} of ${summary.bookLines} book lines (${summary.coverageLinesPct}%)`,
      ],
      ["Lines compared", summary.lines],
      ["Not recounted", summary.notRecounted],
      ["Agreed, matches book", summary.agreedClean],
      ["CONFIRMED variance lines", summary.agreedVariance],
      ["Recount — counts disagree", summary.disagree],
      ["Missed in 1st count", summary.missedInFirst],
      ["Missed in 2nd count", summary.missedInSecond],
      ["Book moved between counts", summary.bookMovedLines],
      ["", ""],
      ["Units in dispute", summary.unitsInDispute],
      ["CONFIRMED NET VARIANCE", summary.confirmedNetVariance],
      ["  confirmed short units", summary.confirmedShortUnits],
      ["  confirmed over units", summary.confirmedOverUnits],
      ["Counted units, 1st pass", summary.countedUnitsFirst],
      ["Counted units, 2nd pass", summary.countedUnitsSecond],
      ["", ""],
      [
        "Note",
        "Only CONFIRMED variance lines are safe to adjust against — both passes reached the same figure.",
      ],
      ...(summary.mode === "partial"
        ? ([
            [
              "PARTIAL COUNT",
              "The second pass covered only part of the location. Lines it never reached carry NO confirmed variance — their '1st count variance' is the first pass's own figure, unverified.",
            ],
            [
              "PARTIAL COUNT",
              "Scope is inferred from what the second pass scanned, so a line that WAS recounted and genuinely came up empty cannot be told apart from one nobody visited. A partial count can confirm an overage; it cannot confirm a shortage to zero.",
            ],
          ] as Array<[string, Cell]>)
        : []),
      [
        "Note",
        "RECOUNT lines carry no variance. The two passes disagree, so the discrepancy is in the counting, not the stock.",
      ],
    ],
  };
}

const comparisonStamp = (meta: ComparisonMeta) =>
  `${meta.warehouseCode}_count_comparison_${new Date(meta.second.openedAt).toISOString().slice(0, 10)}`;

export function downloadComparisonCsv(
  meta: ComparisonMeta,
  rows: any[],
  _summary: any,
) {
  downloadTableCsv(`${comparisonStamp(meta)}.csv`, comparisonTable(meta, rows));
}

export function downloadComparisonExcel(
  meta: ComparisonMeta,
  rows: any[],
  summary: any,
) {
  const recount = rows.filter((r) => r.bucket === "disagree");
  const confirmed = rows.filter((r) => r.bucket === "agreed-variance");
  return downloadWorkbook(`${comparisonStamp(meta)}.xlsx`, [
    comparisonSummary(meta, summary),
    // The two action lists get their own sheets as well as living in the full
    // table: "what do I recount" and "what do I adjust" are the two questions
    // this report exists to answer, and neither should need a filter first.
    { ...comparisonTable(meta, recount), sheet: "Recount list" },
    { ...comparisonTable(meta, confirmed), sheet: "Confirmed variance" },
    { ...comparisonTable(meta, rows), sheet: "All lines" },
  ]);
}

const usd = (n: number | null | undefined) =>
  n === null || n === undefined
    ? ""
    : (n < 0 ? "-$" : "$") +
      Math.abs(n).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

const signed = (n: number) => (n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString());

/**
 * Second-count comparison as a PDF for signing off, rather than for working in.
 *
 * Structured around what a reader has to take away and in what order: the scope
 * of the two passes, then the ONE number that is defensible (confirmed variance,
 * in tires and in money), then explicitly what is NOT settled, then the lists.
 * The recount list comes before the confirmed list because it is the work, and
 * the un-recounted lines come last because they carry no verified figure at all.
 *
 * Landscape, because 8 numeric columns plus a tire description does not fit
 * portrait without wrapping the description into uselessness.
 */
export async function downloadComparisonPdf(
  meta: ComparisonMeta,
  rows: any[],
  summary: any,
) {
  const { doc, autoTable } = await newPdf(true);
  const W = doc.internal.pageSize.getWidth();

  doc.setFontSize(16);
  doc.text(
    `Second-Count Comparison — ${meta.locationLabel} (${meta.warehouseCode})`,
    14,
    15,
  );

  doc.setFontSize(8);
  const when = (p: ComparisonMeta["first"]) =>
    `${new Date(p.openedAt).toLocaleString()} → ${p.closedAt ? new Date(p.closedAt).toLocaleString() : "still open"}`;
  doc.text(
    [
      `First count:  ${when(meta.first)}   opened by ${meta.first.openedByName}   book file ${meta.first.baselineFileDate ?? "unknown"}`,
      `Second count: ${when(meta.second)}   opened by ${meta.second.openedByName}   book file ${meta.second.baselineFileDate ?? "unknown"}`,
      `Second pass reached ${summary.recountedLines} of ${summary.bookLines} book lines — ${summary.coverageLinesPct}% of lines, ${summary.coverageUnitsPct}% of units${summary.mode === "partial" ? "   (PARTIAL — see note below)" : ""}`,
    ],
    14,
    22,
  );

  // ---- the headline. One box, one number, stated with its qualifier.
  let y = 37;
  doc.setDrawColor(0, 122, 255);
  doc.setLineWidth(0.6);
  doc.rect(14, y, W - 28, 20);
  doc.setFontSize(9);
  doc.text("CONFIRMED VARIANCE — both passes independently reached the same figure", 18, y + 6);
  doc.setFontSize(13);
  doc.text(
    `${signed(summary.confirmedNetVariance)} tires` +
      (summary.confirmedNetValue ? `        ${usd(summary.confirmedNetValue)}` : ""),
    18,
    y + 15,
  );
  doc.setFontSize(8);
  doc.text(
    `across ${summary.agreedVariance} lines   ` +
      `(short ${summary.confirmedShortUnits} / ${usd(summary.confirmedShortValue)}   ·   ` +
      `over +${summary.confirmedOverUnits} / ${usd(summary.confirmedOverValue)})`,
    18,
    y + 19.5 - 0.5,
  );
  y += 26;

  autoTable(doc, {
    startY: y,
    head: [["", "Lines", "Tires", "Value", "Status"]],
    body: [
      [
        "Agreed, matches book",
        summary.agreedClean,
        "0",
        usd(0),
        "nothing to do",
      ],
      [
        "CONFIRMED variance",
        summary.agreedVariance,
        signed(summary.confirmedNetVariance),
        usd(summary.confirmedNetValue),
        "safe to adjust against",
      ],
      [
        "Counts disagree",
        summary.disagree,
        `${summary.unitsInDispute} apart`,
        "—",
        "RECOUNT — no variance issued",
      ],
      [
        "Not recounted by 2nd pass",
        summary.notRecounted,
        "—",
        "—",
        "1st count figure only, unverified",
      ],
      [
        "Found only by 2nd pass",
        summary.missedInFirst,
        "—",
        "—",
        "missed by the 1st count",
      ],
    ],
    styles: { fontSize: 8, cellPadding: 1.6 },
    headStyles: { fillColor: [0, 122, 255] },
    columnStyles: {
      0: { cellWidth: 60 },
      1: { halign: "right", cellWidth: 18 },
      2: { halign: "right", cellWidth: 26 },
      3: { halign: "right", cellWidth: 28 },
    },
  });

  const section = (
    title: string,
    subset: any[],
    cols: string[],
    body: any[][],
    widths: Record<number, any>,
  ) => {
    if (!subset.length) return;
    doc.addPage();
    doc.setFontSize(12);
    doc.text(title, 14, 15);
    autoTable(doc, {
      startY: 20,
      head: [cols],
      body,
      styles: { fontSize: 7.5, cellPadding: 1.3 },
      headStyles: { fillColor: [0, 122, 255] },
      columnStyles: widths,
      didDrawPage: () => {
        doc.setFontSize(7);
        doc.setTextColor(120);
        doc.text(
          `${meta.locationLabel} (${meta.warehouseCode}) — second-count comparison`,
          14,
          doc.internal.pageSize.getHeight() - 8,
        );
        doc.setTextColor(0);
      },
    });
  };

  const desc = (r: any) =>
    [r.brand, r.model, r.size].filter(Boolean).join(" ").slice(0, 46);
  const numeric = { halign: "right" as const, cellWidth: 17 };

  section(
    `Recount list — ${summary.disagree} lines the two counts disagree on (${summary.unitsInDispute} tires apart)`,
    rows.filter((r) => r.bucket === "disagree"),
    ["Item ID", "Description", "Book", "1st", "2nd", "Apart"],
    rows
      .filter((r) => r.bucket === "disagree")
      .map((r) => [
        r.itemId,
        desc(r),
        r.expectedSecond,
        r.countedFirst,
        r.countedSecond,
        Math.abs(r.spread),
      ]),
    { 0: { cellWidth: 30 }, 2: numeric, 3: numeric, 4: numeric, 5: numeric },
  );

  const conf = rows
    .filter((r) => r.bucket === "agreed-variance")
    .slice()
    .sort((a, b) => Math.abs(b.confirmedVariance) - Math.abs(a.confirmedVariance));
  section(
    `Confirmed variance — ${conf.length} lines both counts agreed on`,
    conf,
    ["Item ID", "Description", "Book", "Counted", "Variance", "Cost ea", "Value"],
    conf.map((r) => [
      r.itemId,
      desc(r),
      r.expectedSecond,
      r.countedSecond,
      signed(r.confirmedVariance),
      r.avgCost ? usd(r.avgCost) : "—",
      r.confirmedValue === null ? "not priced" : usd(r.confirmedValue),
    ]),
    {
      0: { cellWidth: 30 },
      2: numeric,
      3: numeric,
      4: numeric,
      5: { halign: "right", cellWidth: 22 },
      6: { halign: "right", cellWidth: 26 },
    },
  );

  const nr = rows
    .filter((r) => r.bucket === "not-recounted" && r.firstVariance !== 0)
    .slice()
    .sort((a, b) => Math.abs(b.firstVariance) - Math.abs(a.firstVariance));
  section(
    `Not recounted — ${nr.length} lines with a 1st-count variance the 2nd pass never checked`,
    nr,
    ["Item ID", "Description", "Book", "1st count", "1st variance"],
    nr.map((r) => [
      r.itemId,
      desc(r),
      r.expectedFirst,
      r.countedFirst,
      signed(r.firstVariance),
    ]),
    { 0: { cellWidth: 30 }, 2: numeric, 3: numeric, 4: numeric },
  );

  // ---- the caveats, last, on their own page so they cannot be cropped off a table
  doc.addPage();
  doc.setFontSize(12);
  doc.text("How to read this report", 14, 15);
  doc.setFontSize(9);
  const notes = [
    "CONFIRMED VARIANCE is the only figure backed by two independent counts. Both passes reached the",
    "same number and that number disagrees with JMK. This is what is safe to adjust against.",
    "",
    "RECOUNT lines carry no variance at all. The two passes disagree with each other, so the discrepancy",
    "is in the counting rather than in the stock, and no figure from either pass should be used.",
    "",
    ...(summary.mode === "partial"
      ? [
          "PARTIAL SECOND COUNT. Lines the second pass never reached are reported with the first count's own",
          "figure and no confirmation. Scope is inferred from what the second pass scanned, so a line that was",
          "recounted and genuinely came up empty cannot be told apart from one nobody visited — a partial",
          "count can confirm an overage but never a shortage to zero.",
          "",
        ]
      : []),
    ...(summary.unvaluedLines
      ? [
          `${summary.unvaluedLines} confirmed line(s) carry no cost in the OEIVAL and are shown as "not priced" rather than as $0.`,
          "Valuing an unknown cost at zero would understate a loss, so those lines are excluded from the money",
          "totals and must be priced by hand if they matter.",
          "",
        ]
      : []),
    `Book on hand: ${summary.bookUnits.toLocaleString()} tires` +
      (summary.bookValue ? ` — ${usd(summary.bookValue)} at JMK average cost.` : "."),
    `Counted: ${summary.countedUnitsFirst.toLocaleString()} tires in the first pass, ${summary.countedUnitsSecond.toLocaleString()} in the second.`,
    "Costs are JMK average cost per tire, from the OEIVAL the count was judged against.",
  ];
  doc.text(notes, 14, 24);

  doc.save(`${comparisonStamp(meta)}.pdf`);
}

// ------------------------------------------------------------ recount list

/**
 * Why a line needs walking again, in the order somebody should work them.
 *
 * Ordered by how much the recount can settle, not by size: a disagreement has two
 * contradictory observations and one more pass decides it, whereas "neither count
 * found any" is the shrink claim itself and only a declared-scope recount can turn
 * it from an assumption into a fact.
 */
export const RECOUNT_REASON = {
  disagree: { rank: 1, label: "Counts disagree" },
  "missed-in-second": { rank: 2, label: "Only the 1st count reached it" },
  "missed-in-first": { rank: 3, label: "Only the 2nd count reached it" },
  "never-found": { rank: 4, label: "Neither count found any" },
} as const;

export type RecountRow = {
  reason: string;
  rank: number;
  /** Tires the recount could move, and what they are worth. */
  tiresAtStake: number;
  valueAtStake: number | null;
  row: any;
};

/**
 * Every line two agreeing passes did not settle.
 *
 * ONE definition, used by both the downloadable list and the button that opens the
 * scoped batch — if those two ever disagreed, the list would describe a recount
 * that isn't the one running.
 */
export function recountRows(rows: any[]): RecountRow[] {
  const out: RecountRow[] = [];
  for (const r of rows) {
    let key: keyof typeof RECOUNT_REASON | null = null;
    /**
     * Deliberately keyed on OBSERVATIONS, not on the bucket name.
     *
     * The same physical situation carries different bucket names in the two
     * reading modes — a line the second pass never scanned is "not-recounted"
     * under partial and "missed-in-second" or "agreed-variance" under full — so
     * matching on bucket alone silently changes the work list depending on which
     * mode the reader happens to have selected. Measured on W09: it dropped 9 item
     * numbers including one worth $15,996, all of them lines with exactly ONE
     * observation, which is the group that most needs a second look.
     *
     * What matters is how many passes actually saw the line, and whether they
     * agreed.
     */
    const seenFirst = r.countedFirst > 0;
    const seenSecond = r.recounted;

    if (r.bucket === "disagree") key = "disagree";
    else if (!seenSecond && seenFirst) key = "missed-in-second";
    else if (!seenFirst && seenSecond) key = "missed-in-first";
    else if (!seenFirst && !seenSecond) key = "never-found";
    if (!key) continue;
    if (!(r.expectedFirst > 0 || r.expectedSecond > 0)) continue; // no book row to recount against

    const tires =
      key === "disagree"
        ? Math.abs(r.spread)
        : key === "never-found"
          ? r.expectedSecond || r.expectedFirst
          : Math.max(r.countedFirst, r.countedSecond);

    out.push({
      reason: RECOUNT_REASON[key].label,
      rank: RECOUNT_REASON[key].rank,
      tiresAtStake: tires,
      valueAtStake: r.avgCost > 0 ? Math.round(tires * r.avgCost * 100) / 100 : null,
      row: r,
    });
  }
  // Worst money first inside each reason, so a short shift spent on the top of
  // the list is the most valuable shift available.
  return out.sort(
    (a, z) => a.rank - z.rank || (z.valueAtStake ?? 0) - (a.valueAtStake ?? 0),
  );
}

/** Item numbers to freeze into a scoped batch, variant siblings included. */
export function recountItemIds(rows: any[]): string[] {
  return Array.from(
    new Set(
      recountRows(rows).flatMap((x) => x.row.variantItemIds ?? [x.row.itemId]),
    ),
  );
}

export function recountTable(meta: ComparisonMeta, rows: any[]): Table {
  const list = recountRows(rows);
  return {
    sheet: "Recount list",
    columns: [
      "Why",
      "Item ID",
      "Variant item IDs",
      "Brand",
      "Model",
      "Size",
      "MPN",
      "Book",
      "1st count",
      "2nd count",
      "Tires at stake",
      "Value at stake",
      "Recounted qty",
      "Counted by",
      "Location",
    ],
    rows: list.map((x) => {
      const r = x.row;
      return [
        x.reason,
        r.itemId,
        (r.variantItemIds ?? []).join(" + "),
        r.brand ?? "",
        r.model ?? "",
        r.size ?? "",
        r.mpn ?? "",
        r.expectedSecond || r.expectedFirst,
        r.bucket === "missed-in-first" ? null : r.countedFirst,
        r.recounted ? r.countedSecond : null,
        x.tiresAtStake,
        x.valueAtStake,
        // Left blank on purpose: the file doubles as the sheet somebody writes on.
        null,
        null,
        `${meta.locationLabel} (${meta.warehouseCode})`,
      ];
    }),
    widths: [30, 16, 20, 18, 22, 30, 14, 8, 10, 10, 13, 14, 13, 16, 26],
  };
}

const recountStamp = (meta: ComparisonMeta) =>
  `${meta.warehouseCode}_recount_list_${new Date(meta.second.openedAt).toISOString().slice(0, 10)}`;

export function downloadRecountCsv(meta: ComparisonMeta, rows: any[]) {
  downloadTableCsv(`${recountStamp(meta)}.csv`, recountTable(meta, rows));
}

export function downloadRecountExcel(meta: ComparisonMeta, rows: any[]) {
  const list = recountRows(rows);
  const byReason = new Map<string, RecountRow[]>();
  for (const x of list) {
    const g = byReason.get(x.reason) ?? [];
    g.push(x);
    byReason.set(x.reason, g);
  }
  return downloadWorkbook(`${recountStamp(meta)}.xlsx`, [
    {
      sheet: "Summary",
      pairs: [
        ["Location", `${meta.locationLabel} (${meta.warehouseCode})`],
        [
          "Counts compared",
          `${new Date(meta.first.openedAt).toLocaleDateString()} and ${new Date(meta.second.openedAt).toLocaleDateString()}`,
        ],
        ["", ""],
        ["Lines to recount", list.length],
        ["Tires at stake", list.reduce((n, x) => n + x.tiresAtStake, 0)],
        [
          "Value at stake",
          list.reduce((n, x) => n + (x.valueAtStake ?? 0), 0),
        ],
        ["", ""],
        ...[...byReason.entries()].map(
          ([reason, g]) =>
            [
              reason,
              `${g.length} lines · ${g.reduce((n, x) => n + x.tiresAtStake, 0)} tires · ${usd(g.reduce((n, x) => n + (x.valueAtStake ?? 0), 0))}`,
            ] as [string, Cell],
        ),
        ["", ""],
        [
          "Note",
          "Sorted by reason, then by value at stake, so working from the top is the most valuable order.",
        ],
        [
          "Note",
          "'Recounted qty' and 'Counted by' are blank on purpose — this file doubles as the sheet somebody writes on.",
        ],
        [
          "Note",
          "Lines with no book row (off-book finds) are not listed: there is nothing to recount them against.",
        ],
      ],
    },
    recountTable(meta, rows),
  ]);
}

/**
 * The floor sheet.
 *
 * Everything needed to FIND and identify a tire, and nothing about what it is
 * expected to be. No book quantity, no earlier count, no variance, no value: a
 * printed expectation is a number people count toward, which is the same reason
 * the scanner does not show the book figure either. What the crew hands back has
 * to be an independent observation or the recount is worth nothing.
 *
 * Ordered by brand then size, because that is how tires are stored and therefore
 * how somebody walks a building — not by money, which only matters to the person
 * reading the results afterwards.
 */
export async function downloadRecountPdf(meta: ComparisonMeta, rows: any[]) {
  const list = recountRows(rows).slice();
  const t = (x: unknown) => String(x ?? "").trim();
  list.sort(
    (a, z) =>
      t(a.row.brand).localeCompare(t(z.row.brand)) ||
      t(a.row.size).localeCompare(t(z.row.size)) ||
      t(a.row.itemId).localeCompare(t(z.row.itemId)),
  );

  const { doc, autoTable } = await newPdf(true);
  const PH = doc.internal.pageSize.getHeight();

  doc.setFontSize(15);
  doc.text(`Recount sheet — ${meta.locationLabel} (${meta.warehouseCode})`, 14, 15);
  doc.setFontSize(9);
  doc.text(
    [
      `${list.length} items to recount. Count the FULL quantity of each item — not a difference, not a spot check.`,
      "Write the number you counted and your initials. If you find none, write 0 — never leave it blank.",
      "If an item is stored in more than one place, add them together and write one total.",
    ],
    14,
    22,
  );

  autoTable(doc, {
    startY: 36,
    head: [
      ["#", "Item ID", "Part number", "Barcode", "Brand", "Model", "Size", "Counted", "Initials"],
    ],
    body: list.map((x, i) => [
      i + 1,
      t(x.row.itemId),
      t(x.row.mpn),
      t(x.row.upc) || t(x.row.ean),
      t(x.row.brand),
      t(x.row.model),
      t(x.row.size),
      "",
      "",
    ]),
    styles: {
      fontSize: 8.5,
      cellPadding: 2.4,
      minCellHeight: 8.5,
      lineColor: [200, 200, 205],
      lineWidth: 0.1,
      overflow: "linebreak",
    },
    headStyles: { fillColor: [0, 122, 255], fontSize: 9 },
    columnStyles: {
      // 12mm, not 8 — a 3-digit row number wraps at 8 and the column looks broken.
      0: { cellWidth: 12, halign: "right", textColor: [130, 130, 135] },
      1: { cellWidth: 26 },
      2: { cellWidth: 26 },
      3: { cellWidth: 28 },
      4: { cellWidth: 32 },
      7: { cellWidth: 22, fillColor: [246, 246, 248] },
      8: { cellWidth: 20, fillColor: [246, 246, 248] },
    },
    didDrawPage: () => {
      doc.setFontSize(7.5);
      doc.setTextColor(120);
      doc.text(
        `${meta.locationLabel} (${meta.warehouseCode}) recount — return completed sheets to the office`,
        14,
        PH - 8,
      );
      doc.setTextColor(0);
    },
  });

  doc.save(`${recountStamp(meta)}.pdf`);
}
