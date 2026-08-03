/**
 * Physical count vs frozen IECentral baseline.
 *
 * Pure and dependency-free on purpose: this is the one place where a silent
 * bug yields a confidently wrong report that somebody then acts on. Lives
 * inside convex/ because convex/ is copied verbatim into TireTrackLite and
 * therefore cannot import the repo's top-level lib/.
 */

export type BaselineRow = {
  itemId: string;
  qtyOnHand: number;
  brand?: string;
  model?: string;
  size?: string;
  mpn?: string;
  upc?: string;
  ean?: string;
};

export type TotalRow = {
  itemId?: string;
  upc?: string;
  countedQty: number;
  scanCount: number;
};

export type Bucket = "match" | "short" | "over" | "notFound" | "unexpected";

export type VarianceRow = {
  itemId: string;
  /**
   * Present when this line covers more than one SKU sharing a barcode. JMK
   * d-class variants (AYAEP031^ and AYAEP031.) are the same physical tire, and a
   * scanner cannot tell them apart, so they are counted and reported as one.
   */
  variantItemIds?: string[];
  brand?: string;
  model?: string;
  size?: string;
  mpn?: string;
  expected: number;
  counted: number;
  variance: number;
  scanCount: number;
  bucket: Bucket;
};

export type UnmatchedRow = { upc: string; countedQty: number; scanCount: number };

export type VarianceSummary = {
  baselineItems: number;
  countedItems: number;
  matched: number;
  short: number;
  over: number;
  notFound: number;
  unexpected: number;
  unmatchedUpcs: number;
  expectedUnits: number;
  countedUnits: number;
  netUnitVariance: number;
};

const key = (s: string) => String(s ?? "").trim().toUpperCase();

function bucketFor(expected: number, counted: number): Bucket {
  // notFound is separated from short deliberately: "in the book, never seen on
  // the floor" is where real shrink shows up, and merging it into short buries it.
  if (expected > 0 && counted === 0) return "notFound";
  if (expected === 0) return "unexpected";
  if (counted === expected) return "match";
  return counted < expected ? "short" : "over";
}

export function computeVariance(
  baseline: BaselineRow[],
  totals: TotalRow[],
): { rows: VarianceRow[]; unmatched: UnmatchedRow[]; summary: VarianceSummary } {
  /**
   * Group baseline rows by BARCODE, not by itemId.
   *
   * JMK carries the same physical tire under several d-class variants
   * (AYAEP031^ = Caret, AYAEP031. = Dot) which share one printed barcode. At W08
   * that is 353 barcodes covering 709 SKUs and 32,602 tires. Because the barcode
   * is what the scanner reads, those SKUs cannot be distinguished on the floor —
   * so counting them separately invents a precision the data does not have, and
   * produces a fictional short on one variant plus a fictional over on the other.
   *
   * A line is therefore keyed on upc, else ean, else the itemId. Rows with no
   * barcode stay separate: absent a shared barcode there is no evidence they are
   * the same tire.
   */
  const groupKeyOf = (r: BaselineRow) =>
    (r.upc ?? "").trim() || (r.ean ?? "").trim() || key(r.itemId);

  const groups = new Map<string, BaselineRow[]>();
  const itemToGroup = new Map<string, string>();
  for (const row of baseline) {
    const g = groupKeyOf(row);
    const list = groups.get(g);
    if (list) list.push(row);
    else groups.set(g, [row]);
    itemToGroup.set(key(row.itemId), g);
  }

  // Counted quantities, folded onto the group each itemId belongs to.
  const countedByGroup = new Map<string, { qty: number; scans: number }>();
  const unmatched: UnmatchedRow[] = [];
  const unexpected = new Map<string, { qty: number; scans: number }>();

  for (const t of totals) {
    if (t.itemId) {
      const k = key(t.itemId);
      const g = itemToGroup.get(k);
      const target = g ? countedByGroup : unexpected;
      const bucketKey = g ?? k;
      const prev = target.get(bucketKey) ?? { qty: 0, scans: 0 };
      target.set(bucketKey, {
        qty: prev.qty + t.countedQty,
        scans: prev.scans + t.scanCount,
      });
    } else if (t.upc) {
      // Never folded into variance — an unknown UPC cannot be attributed to an
      // item without inventing a number.
      unmatched.push({
        upc: t.upc,
        countedQty: t.countedQty,
        scanCount: t.scanCount,
      });
    }
  }

  const rows: VarianceRow[] = [];

  for (const [g, members] of groups) {
    const c = countedByGroup.get(g);
    const expected = members.reduce((n, m) => n + m.qtyOnHand, 0);
    const counted = c?.qty ?? 0;
    // Deepest-stocked member represents the line, and its description is the one
    // an operator recognises.
    const lead = members.reduce((a, b) => (b.qtyOnHand > a.qtyOnHand ? b : a));
    rows.push({
      itemId: lead.itemId,
      variantItemIds:
        members.length > 1 ? members.map((m) => m.itemId) : undefined,
      brand: lead.brand,
      model: lead.model,
      size: lead.size,
      mpn: lead.mpn,
      expected,
      counted,
      variance: counted - expected,
      scanCount: c?.scans ?? 0,
      bucket: bucketFor(expected, counted),
    });
  }

  for (const [k, c] of unexpected) {
    rows.push({
      itemId: k,
      expected: 0,
      counted: c.qty,
      variance: c.qty,
      scanCount: c.scans,
      bucket: "unexpected",
    });
  }

  // Worst variance first — a report is read top-down.
  rows.sort((a, z) => Math.abs(z.variance) - Math.abs(a.variance));

  const count = (bkt: Bucket) => rows.filter((r) => r.bucket === bkt).length;
  const expectedUnits = rows.reduce((n, r) => n + r.expected, 0);
  const countedUnits = rows.reduce((n, r) => n + r.counted, 0);

  return {
    rows,
    unmatched,
    summary: {
      baselineItems: groups.size,
      countedItems: countedByGroup.size,
      matched: count("match"),
      short: count("short"),
      over: count("over"),
      notFound: count("notFound"),
      unexpected: count("unexpected"),
      unmatchedUpcs: unmatched.length,
      expectedUnits,
      countedUnits,
      netUnitVariance: countedUnits - expectedUnits,
    },
  };
}
