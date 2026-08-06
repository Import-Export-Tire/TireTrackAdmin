import { describe, it, expect } from "vitest";
import { compareCounts } from "../convex/wms_count_variance";

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
