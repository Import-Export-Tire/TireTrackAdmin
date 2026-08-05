import { describe, it, expect } from "vitest";
import { canonicalItemIdFrom } from "../convex/wms_count_variance";

/**
 * The sidewall search and the frozen baseline disagree on itemId format:
 * /api/inventory/search returns AYAGS089, the book returns AYAGS089. — 461 of
 * W09's 478 itemIds carry that trailing d-class dot. A resolved scan must land
 * on the BOOK's spelling, or it counts as an unexpected off-book tire while the
 * real book row is reported as shrink.
 */
const row = (itemId: string, mpn?: string, qtyOnHand = 10) => ({
  itemId,
  mpn,
  qtyOnHand,
});

describe("canonicalItemIdFrom", () => {
  it("returns the exact row when the itemId already matches the book", () => {
    const rows = [row("ARSP06.", "ARSP06")];
    expect(canonicalItemIdFrom("ARSP06.", undefined, rows)?.itemId).toBe("ARSP06.");
  });

  it("finds the book row when the search dropped the d-class suffix", () => {
    const rows = [row("AYAGS089.", "AGS089", 282)];
    expect(canonicalItemIdFrom("AYAGS089", undefined, rows)?.itemId).toBe(
      "AYAGS089.",
    );
  });

  it("matches on the manufacturer part number when one is supplied", () => {
    const rows = [row("AYAGS089.", "AGS089", 282)];
    expect(canonicalItemIdFrom("SOMETHINGELSE", "AGS089", rows)?.itemId).toBe(
      "AYAGS089.",
    );
  });

  it("prefers an exact itemId hit over an mpn hit", () => {
    const rows = [row("AAA.", "SHARED", 1), row("BBB.", "SHARED", 99)];
    expect(canonicalItemIdFrom("BBB.", "SHARED", rows)?.itemId).toBe("BBB.");
  });

  it("tolerates the caret d-class variant too", () => {
    const rows = [row("AYAEP031^", "AEP031", 40)];
    expect(canonicalItemIdFrom("AYAEP031", undefined, rows)?.itemId).toBe(
      "AYAEP031^",
    );
  });

  it("picks the deepest-stocked row when several normalize alike", () => {
    const rows = [row("AYAEP031^", "AEP031", 12), row("AYAEP031.", "AEP031", 88)];
    expect(canonicalItemIdFrom("AYAEP031", undefined, rows)?.itemId).toBe(
      "AYAEP031.",
    );
  });

  it("returns null rather than inventing a match", () => {
    const rows = [row("AYAGS089.", "AGS089", 282)];
    expect(canonicalItemIdFrom("NOTINBOOK", "NOPE", rows)).toBeNull();
    expect(canonicalItemIdFrom("", undefined, rows)).toBeNull();
  });
});
