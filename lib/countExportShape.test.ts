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

describe("recount list", () => {
  const cmp = async () => await import("../app/wms/counts/exports");
  const r = (over: any) => ({
    itemId: "X",
    expectedFirst: 10,
    expectedSecond: 10,
    countedFirst: 0,
    countedSecond: 0,
    firstVariance: 0,
    spread: 0,
    recounted: false,
    avgCost: 100,
    confirmedVariance: null,
    bucket: "agreed-clean",
    ...over,
  });

  it("collects every unsettled category and nothing else", async () => {
    const { recountRows } = await cmp();
    const rows = [
      r({ itemId: "DISAGREE", bucket: "disagree", countedFirst: 7, countedSecond: 9, spread: 2 }),
      r({ itemId: "ONLY1ST", bucket: "missed-in-second", countedFirst: 10 }),
      r({ itemId: "ONLY2ND", bucket: "missed-in-first", countedSecond: 10, recounted: true }),
      r({ itemId: "NEVER", bucket: "not-recounted" }),
      r({ itemId: "CLEAN", bucket: "agreed-clean", countedFirst: 10, countedSecond: 10, recounted: true }),
      r({ itemId: "CONFIRMED", bucket: "agreed-variance", countedFirst: 7, countedSecond: 7, recounted: true, confirmedVariance: -3 }),
    ];
    const got = (await cmp()).recountRows(rows).map((x) => x.row.itemId);
    expect(got).toContain("DISAGREE");
    expect(got).toContain("ONLY1ST");
    expect(got).toContain("ONLY2ND");
    expect(got).toContain("NEVER");
    // a settled line is not work
    expect(got).not.toContain("CLEAN");
    // a confirmed variance where tires WERE seen is settled too
    expect(got).not.toContain("CONFIRMED");
    void recountRows;
  });

  it("treats a full-mode zero-zero confirmed line as unwalked, same as partial mode", async () => {
    const { recountRows } = await cmp();
    // Under "full" the neither-pass-found line is agreed-variance, not
    // not-recounted. It is still the shrink claim and still needs walking.
    const asFull = r({ itemId: "NEVER", bucket: "agreed-variance", confirmedVariance: -10 });
    const asPartial = r({ itemId: "NEVER", bucket: "not-recounted" });
    expect(recountRows([asFull])).toHaveLength(1);
    expect(recountRows([asPartial])).toHaveLength(1);
    expect(recountRows([asFull])[0].reason).toBe(recountRows([asPartial])[0].reason);
  });

  it("skips lines with no book row — nothing to recount against", async () => {
    const { recountRows } = await cmp();
    const offBook = r({
      itemId: "OFFBOOK",
      bucket: "agreed-variance",
      expectedFirst: 0,
      expectedSecond: 0,
      countedFirst: 4,
      countedSecond: 4,
      recounted: true,
      confirmedVariance: 4,
    });
    expect(recountRows([offBook])).toHaveLength(0);
  });

  it("values what is at stake, and sorts by reason then money", async () => {
    const { recountRows } = await cmp();
    const rows = [
      r({ itemId: "SMALL", bucket: "disagree", countedFirst: 1, countedSecond: 3, spread: 2, avgCost: 10 }),
      r({ itemId: "BIG", bucket: "disagree", countedFirst: 1, countedSecond: 21, spread: 20, avgCost: 10 }),
      r({ itemId: "NEVER", bucket: "not-recounted", expectedSecond: 5, avgCost: 1000 }),
    ];
    const got = recountRows(rows);
    // disagreements first even though NEVER is worth far more
    expect(got.map((x) => x.row.itemId)).toEqual(["BIG", "SMALL", "NEVER"]);
    expect(got[0].valueAtStake).toBe(200);
    expect(got[2].valueAtStake).toBe(5000);
  });

  it("the batch scope and the list cover the SAME lines, siblings included", async () => {
    const { recountRows, recountItemIds } = await cmp();
    const rows = [
      r({ itemId: "A.", variantItemIds: ["A.", "A^"], bucket: "disagree", countedFirst: 1, countedSecond: 2, spread: 1 }),
      r({ itemId: "B", bucket: "not-recounted" }),
      r({ itemId: "SETTLED", bucket: "agreed-clean", countedFirst: 10, countedSecond: 10, recounted: true }),
    ];
    expect(recountRows(rows)).toHaveLength(2);
    // one line expands to both barcode siblings, and the settled line is absent
    expect(recountItemIds(rows).sort()).toEqual(["A.", "A^", "B"]);
  });

  it("leaves the write-in columns blank on the sheet", async () => {
    const { recountTable } = await cmp();
    const meta = {
      warehouseCode: "W09",
      locationLabel: "Chestnut Ridge",
      first: { batchId: "a", openedAt: 1786023665215, openedByName: "N" },
      second: { batchId: "b", openedAt: 1786110065215, openedByName: "B" },
    };
    const t = recountTable(meta, [
      r({ itemId: "X", bucket: "disagree", countedFirst: 1, countedSecond: 2, spread: 1 }),
    ]);
    expect(t.rows[0][t.columns.indexOf("Recounted qty")]).toBeNull();
    expect(t.rows[0][t.columns.indexOf("Counted by")]).toBeNull();
    expect(t.widths).toHaveLength(t.columns.length);
  });
});

describe("recount list — mode independence", () => {
  /**
   * The same physical line is bucketed differently in the two reading modes. The
   * work list must not change because of that: the crew walks the same tires
   * either way.
   */
  it("REGRESSION: selects the same lines whether the report is read partial or full", async () => {
    const { recountRows, recountItemIds } = await import("../app/wms/counts/exports");
    const base = {
      itemId: "SEEN_ONCE",
      expectedFirst: 274,
      expectedSecond: 274,
      countedFirst: 274,
      countedSecond: 0,
      firstVariance: 0,
      spread: 0,
      recounted: false,
      avgCost: 58.38,
      confirmedVariance: null,
    };
    // partial mode names it not-recounted; full mode names it missed-in-second
    const partial = { ...base, bucket: "not-recounted" };
    const full = { ...base, bucket: "missed-in-second" };

    expect(recountRows([partial])).toHaveLength(1);
    expect(recountRows([full])).toHaveLength(1);
    expect(recountRows([partial])[0].reason).toBe(recountRows([full])[0].reason);
    expect(recountItemIds([partial])).toEqual(recountItemIds([full]));
    // and it is worth what pass 1 saw, not zero
    expect(recountRows([partial])[0].tiresAtStake).toBe(274);
  });

  it("still separates a line nobody saw from one seen once", async () => {
    const { recountRows } = await import("../app/wms/counts/exports");
    const mk = (o: any) => ({
      itemId: "X",
      expectedFirst: 10,
      expectedSecond: 10,
      countedFirst: 0,
      countedSecond: 0,
      firstVariance: 0,
      spread: 0,
      recounted: false,
      avgCost: 10,
      confirmedVariance: null,
      bucket: "not-recounted",
      ...o,
    });
    expect(recountRows([mk({})])[0].reason).toBe("Neither count found any");
    expect(recountRows([mk({ countedFirst: 5 })])[0].reason).toBe(
      "Only the 1st count reached it",
    );
    expect(
      recountRows([mk({ countedSecond: 5, recounted: true })])[0].reason,
    ).toBe("Only the 2nd count reached it");
  });
});
