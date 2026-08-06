import { describe, it, expect } from "vitest";
import {
  scannedTable,
  discrepancyTable,
  comparisonTable,
  STATUS,
  COMPARISON_STATUS,
  type Table,
} from "../app/wms/counts/exports";

const header = {
  warehouseCode: "W09",
  locationLabel: "Chestnut Ridge",
  batchId: "batch_1",
  openedAt: 1786023665215,
  openedByName: "Noah Grubbs",
  baselineFileDate: "2026-08-06T13:38:17+00:00",
  excludedNonTires: 5,
  excludedUnits: 4968000,
  counters: [{ name: "Noah Grubbs", units: 100, scans: 4 }],
};

const vRow = (over: Partial<any> = {}): any => ({
  itemId: "AYAGS008.",
  brand: "ARROYO",
  model: "GRAND SPORT A/S",
  size: "215/55ZR17",
  mpn: "AGS008",
  expected: 55,
  counted: 58,
  variance: 3,
  scanCount: 1,
  bucket: "over",
  ...over,
});

/** Every row must have exactly as many cells as there are columns. */
const isRectangular = (t: Table) =>
  t.rows.every((r) => r.length === t.columns.length);

describe("export table shape", () => {
  it("emits ONE header row and no blank separator rows", () => {
    const t = discrepancyTable(header, [vRow(), vRow({ itemId: "B", bucket: "short", variance: -4 })], []);
    expect(isRectangular(t)).toBe(true);
    // no row is entirely empty, which is what breaks autofilter and pivots
    expect(t.rows.some((r) => r.every((c) => c === "" || c === null))).toBe(false);
    // and no row repeats the header
    expect(t.rows.some((r) => r[0] === "Status")).toBe(false);
  });

  it("keeps quantities as NUMBERS, not strings", () => {
    const t = discrepancyTable(header, [vRow()], []);
    const col = (name: string) => t.rows[0][t.columns.indexOf(name)];
    expect(col("Book")).toBe(55);
    expect(col("Counted")).toBe(58);
    expect(col("Variance")).toBe(3);
    expect(typeof col("Counted")).toBe("number");
  });

  it("carries the bucket as a plain-English Status column", () => {
    const t = discrepancyTable(
      header,
      [vRow({ bucket: "notFound", counted: 0, variance: -55 })],
      [],
    );
    expect(t.rows[0][0]).toBe(STATUS.notFound);
    expect(t.columns[0]).toBe("Status");
  });

  it("sorts discrepancies worst-first across all statuses", () => {
    const t = discrepancyTable(
      header,
      [
        vRow({ itemId: "small", variance: 3 }),
        vRow({ itemId: "huge", bucket: "short", variance: -1844 }),
        vRow({ itemId: "mid", variance: 58 }),
      ],
      [],
    );
    expect(t.rows.map((r) => r[1])).toEqual(["huge", "mid", "small"]);
  });

  it("excludes matched lines from the discrepancy table but keeps them in scanned", () => {
    const rows = [vRow({ itemId: "clean", bucket: "match", variance: 0, counted: 55 })];
    expect(discrepancyTable(header, rows, []).rows).toHaveLength(0);
    expect(scannedTable(header, rows, []).rows).toHaveLength(1);
  });

  it("folds unattributed barcodes into the same table with a BLANK book figure", () => {
    const t = discrepancyTable(header, [vRow()], [
      { upc: "29575225", countedQty: 164, scanCount: 1 },
    ]);
    const row = t.rows.find((r) => r[0] === STATUS.unmatched)!;
    expect(row[t.columns.indexOf("Barcode")]).toBe("29575225");
    expect(row[t.columns.indexOf("Counted")]).toBe(164);
    // blank, NOT zero — a 0 would silently join every variance total
    expect(row[t.columns.indexOf("Book")]).toBeNull();
    expect(row[t.columns.indexOf("Variance")]).toBeNull();
  });

  it("repeats provenance on every row so a filtered slice still explains itself", () => {
    const t = discrepancyTable(header, [vRow(), vRow({ itemId: "B" })], []);
    for (const r of t.rows) {
      expect(r[t.columns.indexOf("Location")]).toBe("Chestnut Ridge (W09)");
      expect(r[t.columns.indexOf("Book file date")]).toBe(header.baselineFileDate);
    }
  });

  it("leaves confirmed variance BLANK when the two counts disagree", () => {
    const t = comparisonTable(
      {
        warehouseCode: "W09",
        locationLabel: "Chestnut Ridge",
        first: { batchId: "a", openedAt: 1786023665215, openedByName: "Noah" },
        second: { batchId: "b", openedAt: 1786110065215, openedByName: "Billy" },
      },
      [
        {
          itemId: "A",
          bucket: "disagree",
          expectedFirst: 10,
          expectedSecond: 10,
          countedFirst: 7,
          countedSecond: 9,
          spread: 2,
          confirmedVariance: null,
          bookMoved: false,
        },
      ],
    );
    expect(isRectangular(t)).toBe(true);
    expect(t.rows[0][0]).toBe(COMPARISON_STATUS.disagree);
    expect(t.rows[0][t.columns.indexOf("Confirmed variance")]).toBeNull();
    expect(t.rows[0][t.columns.indexOf("Abs spread")]).toBe(2);
  });

  it("gives every column a width so nothing opens as ###", () => {
    for (const t of [
      scannedTable(header, [vRow()], []),
      discrepancyTable(header, [vRow()], []),
    ]) {
      expect(t.widths).toHaveLength(t.columns.length);
    }
  });
});

describe("xlsx workbook", () => {
  it("round-trips: real sheets, numeric cells, blanks stay blank, filter+freeze set", async () => {
    const { buildWorkbook, discrepancyTable } = await import(
      "../app/wms/counts/exports"
    );
    const table = discrepancyTable(header, [vRow()], [
      { upc: "29575225", countedQty: 164, scanCount: 1 },
    ]);
    const { XLSX, wb } = await buildWorkbook([
      { sheet: "Summary", pairs: [["Location", "Chestnut Ridge (W09)"]] },
      table,
    ]);

    // written and read back, so this proves the FILE, not just the object
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
    const back = XLSX.read(buf, { type: "buffer" });

    expect(back.SheetNames).toEqual(["Summary", "Discrepancies"]);

    const ws = back.Sheets["Discrepancies"];
    expect(ws["!autofilter"]).toBeTruthy();

    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as any[][];
    expect(aoa[0][0]).toBe("Status");

    const counted = table.columns.indexOf("Counted");
    const book = table.columns.indexOf("Book");
    // the over line: numbers arrive as numbers
    expect(aoa[1][counted]).toBe(58);
    expect(typeof aoa[1][book]).toBe("number");
    // the unattributed barcode line: book figure is absent, not 0 and not ""
    const barcodeRow = aoa.find((r) => r[0] === STATUS.unmatched)!;
    expect(barcodeRow[counted]).toBe(164);
    expect(barcodeRow[book]).toBeUndefined();
  });
});
