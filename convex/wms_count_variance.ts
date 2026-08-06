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
  upc?: string;
  ean?: string;
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

/**
 * itemId with punctuation removed. JMK's d-class suffixes (AYAEP031^ Caret,
 * AYAEP031. Dot) are part of the book's itemId but are absent from the catalog
 * search's, so the two spellings must compare equal to canonicalise a manual
 * resolve onto the book.
 */
const normalizeId = (s: string) => key(s).replace(/[^A-Z0-9]/g, "");

/**
 * The book row a manually-resolved scan belongs to, or null.
 *
 * `/api/inventory/search` (sidewall lookup) and `/api/inventory/snapshot` (the
 * frozen book) disagree on itemId format — the search returns AYAGS089 where the
 * book holds AYAGS089. Storing the search's spelling makes the tire an
 * off-book "unexpected" line AND leaves its real book row reported as shrink,
 * so the resolve must come back to the book's own itemId.
 *
 * Order: exact itemId, then manufacturer part number, then suffix-insensitive
 * itemId. Never guesses — an unmatched code stays unmatched, which is the truth.
 */
export function canonicalItemIdFrom<
  T extends { itemId: string; mpn?: string; qtyOnHand: number },
>(requestedItemId: string, mpn: string | undefined, rows: T[]): T | null {
  const want = key(requestedItemId);
  const wantMpn = key(mpn ?? "");
  if (!want && !wantMpn) return null;

  // Deepest stock wins, then itemId — same deterministic pick the variance
  // grouping uses, so repeat resolves of one tire always land on one row.
  const pick = (matches: T[]) =>
    matches.length === 0
      ? null
      : matches
          .slice()
          .sort(
            (a, b) => b.qtyOnHand - a.qtyOnHand || a.itemId.localeCompare(b.itemId),
          )[0];

  if (want) {
    const exact = pick(rows.filter((r) => key(r.itemId) === want));
    if (exact) return exact;
  }
  if (wantMpn) {
    const byMpn = pick(rows.filter((r) => key(r.mpn ?? "") === wantMpn));
    if (byMpn) return byMpn;
  }
  if (want) {
    const wantNorm = normalizeId(requestedItemId);
    if (wantNorm) {
      const loose = pick(rows.filter((r) => normalizeId(r.itemId) === wantNorm));
      if (loose) return loose;
    }
  }
  return null;
}

function bucketFor(expected: number, counted: number): Bucket {
  // notFound is separated from short deliberately: "in the book, never seen on
  // the floor" is where real shrink shows up, and merging it into short buries it.
  if (expected > 0 && counted === 0) return "notFound";
  if (expected === 0) return "unexpected";
  if (counted === expected) return "match";
  return counted < expected ? "short" : "over";
}

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
 *
 * Shared by the variance report and the count-to-count comparison so the two can
 * never disagree about what one line is.
 */
export function groupBaseline(baseline: BaselineRow[]) {
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
  return { groups, itemToGroup };
}

export function computeVariance(
  baseline: BaselineRow[],
  totals: TotalRow[],
): { rows: VarianceRow[]; unmatched: UnmatchedRow[]; summary: VarianceSummary } {
  const { groups, itemToGroup } = groupBaseline(baseline);

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
      upc: lead.upc,
      ean: lead.ean,
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

// ------------------------------------------------- count-to-count comparison

export type ComparisonBucket =
  | "agreed-clean"
  | "agreed-variance"
  | "disagree"
  | "missed-in-first"
  | "missed-in-second";

export type ComparisonRow = {
  itemId: string;
  variantItemIds?: string[];
  brand?: string;
  model?: string;
  size?: string;
  mpn?: string;
  /** Book quantity as each count froze it — they differ if stock moved between. */
  expectedFirst: number;
  expectedSecond: number;
  bookMoved: boolean;
  countedFirst: number;
  countedSecond: number;
  /** Second minus first. The number that says how much the two passes disagree. */
  spread: number;
  /**
   * Variance you can act on: only set when both counts got the same answer, and
   * measured against the SECOND count's book, which is the newer truth.
   */
  confirmedVariance: number | null;
  bucket: ComparisonBucket;
};

export type ComparisonSummary = {
  lines: number;
  agreedClean: number;
  agreedVariance: number;
  disagree: number;
  missedInFirst: number;
  missedInSecond: number;
  bookMovedLines: number;
  /** Sum of |spread| — how many units the two counts cannot agree on. */
  unitsInDispute: number;
  /** Net variance across lines where both passes agree. The defensible number. */
  confirmedNetVariance: number;
  confirmedShortUnits: number;
  confirmedOverUnits: number;
  countedUnitsFirst: number;
  countedUnitsSecond: number;
};

/**
 * Compare two physical counts of the same location.
 *
 * A single count cannot tell a real shortage from a miscount — the whole reason
 * to count twice. So the output is built around one distinction: lines where both
 * passes got the SAME answer (believe it, even when it disagrees with the book)
 * versus lines where the passes disagree with each other (a counting problem, and
 * no basis for adjusting anything until somebody looks again).
 *
 * Lines are joined on the same barcode grouping the variance report uses, so a
 * d-class variant pair is one line in both. Items present in only one baseline
 * still appear: a tire that arrived between the two freezes is real, and silently
 * dropping it would hide it.
 */
export function compareCounts(
  first: { baseline: BaselineRow[]; totals: TotalRow[] },
  second: { baseline: BaselineRow[]; totals: TotalRow[] },
): { rows: ComparisonRow[]; summary: ComparisonSummary } {
  const side = (input: { baseline: BaselineRow[]; totals: TotalRow[] }) => {
    const { groups, itemToGroup } = groupBaseline(input.baseline);
    const counted = new Map<string, number>();
    for (const t of input.totals) {
      if (!t.itemId) continue; // unmatched barcodes belong to neither line
      const k = key(t.itemId);
      const g = itemToGroup.get(k) ?? k;
      counted.set(g, (counted.get(g) ?? 0) + t.countedQty);
    }
    return { groups, counted };
  };

  const a = side(first);
  const b = side(second);

  const keys = new Set<string>([
    ...a.groups.keys(),
    ...b.groups.keys(),
    ...a.counted.keys(),
    ...b.counted.keys(),
  ]);

  const rows: ComparisonRow[] = [];
  for (const g of keys) {
    const membersA = a.groups.get(g) ?? [];
    const membersB = b.groups.get(g) ?? [];
    // Prefer the newer book for the description — it is the one an operator will
    // look up today.
    const members = membersB.length ? membersB : membersA;
    const lead = members.length
      ? members.reduce((x, y) => (y.qtyOnHand > x.qtyOnHand ? y : x))
      : undefined;

    const expectedFirst = membersA.reduce((n, m) => n + m.qtyOnHand, 0);
    const expectedSecond = membersB.reduce((n, m) => n + m.qtyOnHand, 0);
    const countedFirst = a.counted.get(g) ?? 0;
    const countedSecond = b.counted.get(g) ?? 0;

    const scannedFirst = a.counted.has(g);
    const scannedSecond = b.counted.has(g);

    let bucket: ComparisonBucket;
    if (scannedFirst && !scannedSecond && countedFirst > 0) {
      bucket = "missed-in-second";
    } else if (!scannedFirst && scannedSecond && countedSecond > 0) {
      bucket = "missed-in-first";
    } else if (countedFirst !== countedSecond) {
      bucket = "disagree";
    } else {
      bucket =
        countedSecond === expectedSecond ? "agreed-clean" : "agreed-variance";
    }

    const agreed = bucket === "agreed-clean" || bucket === "agreed-variance";

    rows.push({
      itemId: lead?.itemId ?? g,
      variantItemIds: members.length > 1 ? members.map((m) => m.itemId) : undefined,
      brand: lead?.brand,
      model: lead?.model,
      size: lead?.size,
      mpn: lead?.mpn,
      expectedFirst,
      expectedSecond,
      bookMoved: membersA.length > 0 && membersB.length > 0 && expectedFirst !== expectedSecond,
      countedFirst,
      countedSecond,
      spread: countedSecond - countedFirst,
      confirmedVariance: agreed ? countedSecond - expectedSecond : null,
      bucket,
    });
  }

  // Worst disagreement first, then biggest confirmed variance — a report is read
  // top-down, and a disagreement is the thing somebody has to go do something about.
  rows.sort(
    (x, z) =>
      Math.abs(z.spread) - Math.abs(x.spread) ||
      Math.abs(z.confirmedVariance ?? 0) - Math.abs(x.confirmedVariance ?? 0),
  );

  const count = (bkt: ComparisonBucket) => rows.filter((r) => r.bucket === bkt).length;
  const confirmed = rows.filter((r) => r.confirmedVariance !== null);

  return {
    rows,
    summary: {
      lines: rows.length,
      agreedClean: count("agreed-clean"),
      agreedVariance: count("agreed-variance"),
      disagree: count("disagree"),
      missedInFirst: count("missed-in-first"),
      missedInSecond: count("missed-in-second"),
      bookMovedLines: rows.filter((r) => r.bookMoved).length,
      unitsInDispute: rows.reduce((n, r) => n + Math.abs(r.spread), 0),
      confirmedNetVariance: confirmed.reduce((n, r) => n + (r.confirmedVariance ?? 0), 0),
      confirmedShortUnits: confirmed.reduce(
        (n, r) => n + Math.min(0, r.confirmedVariance ?? 0),
        0,
      ),
      confirmedOverUnits: confirmed.reduce(
        (n, r) => n + Math.max(0, r.confirmedVariance ?? 0),
        0,
      ),
      countedUnitsFirst: rows.reduce((n, r) => n + r.countedFirst, 0),
      countedUnitsSecond: rows.reduce((n, r) => n + r.countedSecond, 0),
    },
  };
}
