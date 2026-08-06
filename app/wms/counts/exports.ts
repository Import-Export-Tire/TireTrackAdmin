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
