import { describe, it, expect } from "vitest";
import {
  compareCounts,
  detectComparisonMode,
} from "../convex/wms_count_variance";

const b = (itemId: string, qtyOnHand: number, extra: Record<string, any> = {}) => ({
  itemId,
  qtyOnHand,
  ...extra,
});
const t = (itemId: string, countedQty: number, scanCount = 1) => ({
  itemId,
  countedQty,
  scanCount,
});
const side = (baseline: any[], totals: any[]) => ({ baseline, totals });
const row = (r: any, itemId: string) => r.rows.find((x: any) => x.itemId === itemId)!;

describe("compareCounts", () => {
  it("calls a line clean when both passes match the book", () => {
    const r = compareCounts(
      side([b("A", 10)], [t("A", 10)]),
      side([b("A", 10)], [t("A", 10)]),
    );
    expect(row(r, "A").bucket).toBe("agreed-clean");
    expect(row(r, "A").confirmedVariance).toBe(0);
    expect(r.summary.unitsInDispute).toBe(0);
  });

  it("CONFIRMS a variance both passes agree on — the number you can act on", () => {
    const r = compareCounts(
      side([b("A", 10)], [t("A", 7)]),
      side([b("A", 10)], [t("A", 7)]),
    );
    expect(row(r, "A").bucket).toBe("agreed-variance");
    expect(row(r, "A").confirmedVariance).toBe(-3);
    expect(r.summary.confirmedNetVariance).toBe(-3);
    expect(r.summary.confirmedShortUnits).toBe(-3);
    expect(r.summary.unitsInDispute).toBe(0);
  });

  it("confirms shrink when a tire is missing from BOTH counts", () => {
    const r = compareCounts(side([b("A", 8)], []), side([b("A", 8)], []));
    expect(row(r, "A").bucket).toBe("agreed-variance");
    expect(row(r, "A").confirmedVariance).toBe(-8);
  });

  it("withholds a variance when the two passes disagree with each other", () => {
    const r = compareCounts(
      side([b("A", 10)], [t("A", 7)]),
      side([b("A", 10)], [t("A", 9)]),
    );
    const x = row(r, "A");
    expect(x.bucket).toBe("disagree");
    expect(x.confirmedVariance).toBeNull();
    expect(x.spread).toBe(2);
    expect(r.summary.confirmedNetVariance).toBe(0);
    expect(r.summary.unitsInDispute).toBe(2);
  });

  it("separates a line missed by the first pass from one missed by the second", () => {
    const r = compareCounts(
      side([b("A", 5), b("B", 5)], [t("A", 5)]),
      side([b("A", 5), b("B", 5)], [t("B", 5)]),
    );
    expect(row(r, "A").bucket).toBe("missed-in-second");
    expect(row(r, "B").bucket).toBe("missed-in-first");
    expect(r.summary.missedInFirst).toBe(1);
    expect(r.summary.missedInSecond).toBe(1);
  });

  it("flags a book that moved between the two freezes, and judges against the newer one", () => {
    const r = compareCounts(
      side([b("A", 10)], [t("A", 12)]),
      side([b("A", 12)], [t("A", 12)]),
    );
    const x = row(r, "A");
    expect(x.bookMoved).toBe(true);
    expect(x.expectedFirst).toBe(10);
    expect(x.expectedSecond).toBe(12);
    // judged against the second book, so this is clean rather than a phantom over
    expect(x.bucket).toBe("agreed-clean");
    expect(r.summary.bookMovedLines).toBe(1);
  });

  it("keeps a tire that only exists in the second baseline", () => {
    const r = compareCounts(side([b("A", 5)], [t("A", 5)]), side([b("A", 5), b("B", 3)], [t("B", 3)]));
    expect(row(r, "B").bucket).toBe("missed-in-first");
    expect(row(r, "B").expectedFirst).toBe(0);
    expect(row(r, "B").expectedSecond).toBe(3);
  });

  it("joins d-class variants sharing a barcode into ONE line in both passes", () => {
    const first = side(
      [b("X.", 6, { upc: "111" }), b("X^", 4, { upc: "111" })],
      [t("X.", 10)],
    );
    const second = side(
      [b("X.", 6, { upc: "111" }), b("X^", 4, { upc: "111" })],
      [t("X^", 10)],
    );
    const r = compareCounts(first, second);
    expect(r.rows).toHaveLength(1);
    // counted on different variants of one barcode is still agreement
    expect(r.rows[0].bucket).toBe("agreed-clean");
    expect(r.rows[0].variantItemIds).toEqual(["X.", "X^"]);
    expect(r.summary.unitsInDispute).toBe(0);
  });

  it("ignores unmatched barcodes — they belong to no line in either pass", () => {
    const r = compareCounts(
      side([b("A", 5)], [t("A", 5), { upc: "9999", countedQty: 40, scanCount: 1 }]),
      side([b("A", 5)], [t("A", 5)]),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.summary.countedUnitsFirst).toBe(5);
  });

  it("carries an off-book find through as a real line, not a dropped one", () => {
    // counted in both passes, in neither book: 3 tires that are physically there
    const r = compareCounts(side([], [t("Z", 3)]), side([], [t("Z", 3)]));
    const x = row(r, "Z");
    expect(x.bucket).toBe("agreed-variance");
    expect(x.confirmedVariance).toBe(3);
    expect(r.summary.confirmedOverUnits).toBe(3);
  });

  it("sorts the worst disagreement to the top", () => {
    const r = compareCounts(
      side([b("A", 10), b("B", 10)], [t("A", 10), t("B", 2)]),
      side([b("A", 10), b("B", 10)], [t("A", 9), t("B", 10)]),
    );
    expect(r.rows[0].itemId).toBe("B");
    expect(Math.abs(r.rows[0].spread)).toBe(8);
  });
});

describe("compareCounts — PARTIAL second count", () => {
  // W09's real shape: the second pass is a spot check, not a recount of the
  // location, and whoever runs it does not declare a scope.
  const bookOf = (...pairs: Array<[string, number]>) =>
    pairs.map(([id, q]) => b(id, q));

  it("REGRESSION: does not confirm shrink on a line the recount never visited", () => {
    const book = bookOf(["A", 10], ["NEVER_VISITED", 55]);
    const full = compareCounts(
      side(book, [t("A", 10)]),
      side(book, [t("A", 10)]),
    );
    // full mode: absent from both passes genuinely confirms shrink
    expect(row(full, "NEVER_VISITED").bucket).toBe("agreed-variance");
    expect(row(full, "NEVER_VISITED").confirmedVariance).toBe(-55);

    const partial = compareCounts(
      side(book, [t("A", 10)]),
      side(book, [t("A", 10)]),
      { mode: "partial" },
    );
    const x = row(partial, "NEVER_VISITED");
    expect(x.bucket).toBe("not-recounted");
    expect(x.confirmedVariance).toBeNull();
    expect(x.recounted).toBe(false);
    expect(partial.summary.confirmedNetVariance).toBe(0);
  });

  it("keeps out-of-scope lines out of units-in-dispute", () => {
    const book = bookOf(["IN", 10], ["OUT", 400]);
    const r = compareCounts(
      side(book, [t("IN", 10), t("OUT", 400)]),
      side(book, [t("IN", 8)]),
      { mode: "partial" },
    );
    expect(row(r, "OUT").bucket).toBe("not-recounted");
    expect(row(r, "OUT").spread).toBe(0);
    // only the recounted line disputes anything
    expect(r.summary.unitsInDispute).toBe(2);
  });

  it("still confirms a variance the recount DID reach", () => {
    const book = bookOf(["A", 10], ["OUT", 400]);
    const r = compareCounts(
      side(book, [t("A", 7)]),
      side(book, [t("A", 7)]),
      { mode: "partial" },
    );
    expect(row(r, "A").bucket).toBe("agreed-variance");
    expect(row(r, "A").confirmedVariance).toBe(-3);
    expect(r.summary.confirmedNetVariance).toBe(-3);
  });

  it("carries the first pass's own variance so an un-recounted line still says something", () => {
    const book = bookOf(["OUT", 400]);
    const r = compareCounts(
      side(book, [t("OUT", 380)]),
      side(book, []),
      { mode: "partial" },
    );
    const x = row(r, "OUT");
    expect(x.bucket).toBe("not-recounted");
    expect(x.firstVariance).toBe(-20);
    expect(x.confirmedVariance).toBeNull();
  });

  it("reports the scope it actually covered", () => {
    const book = bookOf(["A", 10], ["B", 10], ["C", 80]);
    const r = compareCounts(
      side(book, [t("A", 10), t("B", 10), t("C", 80)]),
      side(book, [t("A", 10)]),
      { mode: "partial" },
    );
    expect(r.summary.mode).toBe("partial");
    expect(r.summary.recountedLines).toBe(1);
    expect(r.summary.bookLines).toBe(3);
    expect(r.summary.coverageLinesPct).toBe(33);
    expect(r.summary.coverageUnitsPct).toBe(10); // 10 of 100 book units
    expect(r.summary.notRecounted).toBe(2);
  });

  it("sorts what was recounted above what wasn't, however big the old variance", () => {
    const book = bookOf(["RECOUNTED", 10], ["HUGE_BUT_SKIPPED", 2000]);
    const r = compareCounts(
      side(book, [t("RECOUNTED", 10), t("HUGE_BUT_SKIPPED", 100)]),
      side(book, [t("RECOUNTED", 4)]),
      { mode: "partial" },
    );
    expect(r.rows[0].itemId).toBe("RECOUNTED");
  });

  it("defaults to partial and never infers full from coverage", () => {
    // A complete count of a location that IS 64 lines short shows the same
    // coverage as an incomplete one that skipped 64 lines. The ratio cannot
    // distinguish them, so nothing is inferred from it.
    expect(detectComparisonMode()).toBe("partial");
  });

  it("REGRESSION: neither-pass-scanned stays unconfirmed unless full is asserted", () => {
    const book = bookOf(["NEITHER", 55]);
    const dflt = compareCounts(side(book, []), side(book, []), {
      mode: detectComparisonMode(),
    });
    expect(row(dflt, "NEITHER").bucket).toBe("not-recounted");
    expect(dflt.summary.confirmedNetVariance).toBe(0);

    // asserting full is what licenses reading absence as shrink
    const asserted = compareCounts(side(book, []), side(book, []), { mode: "full" });
    expect(asserted.summary.confirmedNetVariance).toBe(-55);
  });
});

describe("compareCounts — valuation", () => {
  const bc = (id: string, qty: number, cost?: number) => ({
    itemId: id,
    qtyOnHand: qty,
    ...(cost === undefined ? {} : { avgCost: cost }),
  });

  it("values a confirmed variance at avgCost", () => {
    const book = [bc("A", 10, 82.5)];
    const r = compareCounts(side(book, [t("A", 7)]), side(book, [t("A", 7)]));
    expect(row(r, "A").confirmedVariance).toBe(-3);
    expect(row(r, "A").confirmedValue).toBe(-247.5);
    expect(r.summary.confirmedNetValue).toBe(-247.5);
    expect(r.summary.confirmedShortValue).toBe(-247.5);
    expect(r.summary.valuedLines).toBe(1);
  });

  it("treats a missing cost as UNKNOWN, never as a free tire", () => {
    const book = [bc("A", 10)]; // no avgCost
    const r = compareCounts(side(book, [t("A", 7)]), side(book, [t("A", 7)]));
    expect(row(r, "A").confirmedVariance).toBe(-3);
    // no value invented, and the line is reported as unpriced
    expect(row(r, "A").confirmedValue).toBeNull();
    expect(r.summary.confirmedNetValue).toBe(0);
    expect(r.summary.unvaluedLines).toBe(1);
    expect(r.summary.valuedLines).toBe(0);
  });

  it("puts no value on a disputed line", () => {
    const book = [bc("A", 10, 50)];
    const r = compareCounts(side(book, [t("A", 7)]), side(book, [t("A", 9)]));
    expect(row(r, "A").bucket).toBe("disagree");
    expect(row(r, "A").confirmedValue).toBeNull();
    expect(r.summary.confirmedNetValue).toBe(0);
  });

  it("separates confirmed loss from confirmed gain in money", () => {
    const book = [bc("SHORT", 10, 100), bc("OVER", 10, 20)];
    const r = compareCounts(
      side(book, [t("SHORT", 8), t("OVER", 15)]),
      side(book, [t("SHORT", 8), t("OVER", 15)]),
    );
    expect(r.summary.confirmedShortValue).toBe(-200);
    expect(r.summary.confirmedOverValue).toBe(100);
    expect(r.summary.confirmedNetValue).toBe(-100);
  });

  it("reports book value at cost", () => {
    const r = compareCounts(
      side([bc("A", 10, 10)], [t("A", 10)]),
      side([bc("A", 10, 10)], [t("A", 10)]),
    );
    expect(r.summary.bookValue).toBe(100);
  });
});
