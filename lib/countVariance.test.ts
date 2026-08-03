import { describe, it, expect } from "vitest";
import { computeVariance } from "../convex/wms_count_variance";

const b = (itemId: string, qtyOnHand: number) => ({ itemId, qtyOnHand });
const t = (itemId: string, countedQty: number, scanCount = 1) => ({
  itemId,
  countedQty,
  scanCount,
});

describe("computeVariance", () => {
  it("buckets an exact match and excludes it from discrepancies", () => {
    const r = computeVariance([b("A", 10)], [t("A", 10)]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].bucket).toBe("match");
    expect(r.rows[0].variance).toBe(0);
    expect(r.summary.matched).toBe(1);
    expect(r.summary.short).toBe(0);
  });

  it("buckets fewer-on-floor as short with a negative variance", () => {
    const r = computeVariance([b("A", 10)], [t("A", 7)]);
    expect(r.rows[0].bucket).toBe("short");
    expect(r.rows[0].variance).toBe(-3);
  });

  it("buckets more-on-floor as over with a positive variance", () => {
    const r = computeVariance([b("A", 10)], [t("A", 14)]);
    expect(r.rows[0].bucket).toBe("over");
    expect(r.rows[0].variance).toBe(4);
  });

  it("buckets expected-but-never-scanned as notFound, not short", () => {
    // The bucket a naive implementation misses, and where real shrink shows up.
    const r = computeVariance([b("A", 10)], []);
    expect(r.rows[0].bucket).toBe("notFound");
    expect(r.rows[0].counted).toBe(0);
    expect(r.rows[0].variance).toBe(-10);
    expect(r.summary.notFound).toBe(1);
    expect(r.summary.short).toBe(0);
  });

  it("buckets counted-with-no-baseline-row as unexpected", () => {
    const r = computeVariance([], [t("Z", 6)]);
    expect(r.rows[0].bucket).toBe("unexpected");
    expect(r.rows[0].expected).toBe(0);
    expect(r.rows[0].variance).toBe(6);
  });

  it("keeps unmatched UPCs out of variance entirely", () => {
    // Attributing an unknown UPC to an item would fabricate a number.
    const r = computeVariance(
      [b("A", 10)],
      [t("A", 10), { upc: "0123456789012", countedQty: 4, scanCount: 2 }],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.unmatched).toEqual([
      { upc: "0123456789012", countedQty: 4, scanCount: 2 },
    ]);
    expect(r.summary.unmatchedUpcs).toBe(1);
    expect(r.summary.countedUnits).toBe(10); // the 4 unmatched units are NOT counted in
  });

  it("is case-insensitive when joining baseline to totals", () => {
    const r = computeVariance([b("abc123", 5)], [t("ABC123", 5)]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].bucket).toBe("match");
  });

  it("handles an empty baseline and empty totals", () => {
    const r = computeVariance([], []);
    expect(r.rows).toEqual([]);
    expect(r.unmatched).toEqual([]);
    expect(r.summary.baselineItems).toBe(0);
    expect(r.summary.netUnitVariance).toBe(0);
  });

  it("sums a mixed fixture correctly", () => {
    const r = computeVariance(
      [b("A", 10), b("B", 5), b("C", 8), b("D", 3)],
      [t("A", 10), t("B", 2), t("C", 12), t("Z", 7)],
    );
    expect(r.summary.matched).toBe(1); // A
    expect(r.summary.short).toBe(1); // B
    expect(r.summary.over).toBe(1); // C
    expect(r.summary.notFound).toBe(1); // D
    expect(r.summary.unexpected).toBe(1); // Z
    expect(r.summary.baselineItems).toBe(4);
    expect(r.summary.expectedUnits).toBe(26);
    expect(r.summary.countedUnits).toBe(31);
    expect(r.summary.netUnitVariance).toBe(5);
  });

  it("orders rows by descending absolute variance so the worst read first", () => {
    const r = computeVariance(
      [b("A", 100), b("B", 10), b("C", 50)],
      [t("A", 98), t("B", 0), t("C", 20)],
    );
    expect(r.rows.map((x) => x.itemId)).toEqual(["C", "B", "A"]);
  });

  it("sums duplicate totals rows for the same item", () => {
    // resolveUnmatchedUpc can leave two rows keyed on the same itemId.
    const r = computeVariance([b("A", 10)], [t("A", 4, 1), t("A", 6, 2)]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].counted).toBe(10);
    expect(r.rows[0].scanCount).toBe(3);
    expect(r.rows[0].bucket).toBe("match");
  });
});
