# W09 Inventory Count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Count function on the TireTrack scanner that records UPC + quantity into an open batch, compares it against a frozen snapshot of IECentral's W09 on-hand, and produces scanned and discrepancy reports in TireTrackAdmin as CSV and PDF.

**Architecture:** IECentral gains two token-authed endpoints over its existing S3 OEIVAL cache. A Convex action pulls a W09 snapshot at batch open and freezes it as `wms_count_baseline` rows, so mid-count inventory movement cannot contaminate the result. Scans land in `wms_count_scans` with a transactionally-maintained `wms_count_totals` rollup, and a pure `computeVariance` function joins totals against the baseline into five buckets. Nothing is written back to IECentral or JMK.

**Tech Stack:** Next.js App Router + Node runtime (IECentral endpoints), Convex actions/mutations/queries on shared deployment `wary-squirrel-295`, React Native / Expo (scanner), Next.js + Tailwind `ios-*` tokens (Admin), Vitest, `jspdf` + `jspdf-autotable`.

**Spec:** `TireTrackAdmin/docs/superpowers/specs/2026-07-31-w09-inventory-count-design.md`

## Global Constraints

- **`TireTrackAdmin/convex/` is the source of truth for the shared Convex backend.** A `post-commit` hook runs `~/sync-convex.sh`, copying `convex/` into TireTrackLite. **Never edit `TireTrackLite/convex/` directly.** Commit in Admin before any Lite task that consumes new Convex code.
- **Anything imported by a file inside `convex/` must live inside `convex/`.** `convex/` is copied verbatim into Lite, which has no top-level `lib/`. An import like `../lib/foo` bundles fine in Admin and breaks Lite's typecheck. This was hit and fixed once already in the returns work — do not repeat it.
- Both apps use Convex deployment **`wary-squirrel-295`**. `npx convex deploy` defaults to the wrong deployment (`energetic-badger-312`, 403). Deploy with `CONVEX_DEPLOY_KEY` for `wary-squirrel-295`, which the user supplies — never hardcode it into a file.
- **`npx tsc --noEmit` is the gate in all three repos.** No eslint step. IECentral additionally has Vitest already configured (`vitest.config.ts`).
- **`W09` is the only location enabled at launch, but location is a parameter, not a constant.** Counting is going to other locations — the near-term case is replacing a manual count elsewhere. Exactly one place names enabled locations: `COUNT_LOCATIONS` in `convex/wms_count_locations.ts`. No `"W09"` literal may appear in a screen, page, or query outside that file. The nine codes the OEIVAL cache carries are `R10` Everson, `R15` Rodgers, `R20` Essey Tire, `R25` Export, `R30` Jeannette, `R35` King's Super Tire, `W07` Uniontown, `W08` Latrobe, `W09` Chestnut Ridge.
- **Count access is NOT gated on `wms_user_assignments`.** That table belongs to the Chestnut Ridge WMS pilot; reusing it would make "can count at Jeannette" require "is a Chestnut Ridge warehouse-management user". Counting has its own `wms_count_assignments` table.
- **Count tires only.** `productType` is the discriminator: exclude `T` (transaction placeholders — TIRE, TIRE/U, LTADJ, STH, NGT, TED, TEST*) and `T *` (studding parts/labour). Keep every other code — TP, TL, TM, TST, TP*, TL*, TF, TS, TSG, T2M, TA, TO, TPT, TT are all real tire classes. Blocklist not allowlist, so a new tire class is never silently dropped. Backstops: known placeholder itemIds, and `qtyOnHand >= 100_000`. **Do not filter on `dclass`** — 17 real tires would vanish.
- Measured reality to design against: W09 has **56,107 catalog rows**, **480 real in-stock items**, **33,320 units**, max single-SKU qty **1,872**.
- Admin UI uses existing `ios-*` Tailwind tokens and `components/ui` primitives. Scanner screens follow the existing keyboard-wedge pattern (`autoFocus`, `blurOnSubmit={false}`, commit on `onSubmitEditing`) used by `WMSPutAwayScreen` — that is how TC51 DataWedge feeds input.
- Branches: `feat/w09-inventory-count` in TireTrackAdmin (exists, already carries the spec and a merge of main) and a matching `feat/w09-inventory-count` in TireTrackLite and IECentral, each cut from that repo's `main`.
- Do not override any repo's configured git `user.email`.

## File Structure

**IECentral** (read-only inventory provider):
- Create `lib/inventorySnapshot.ts` — sentinel list, exclusion predicate, and the S3 streaming reader. Pure-ish and unit-testable; both routes use it.
- Create `lib/inventorySnapshot.test.ts` — Vitest for the exclusion predicate.
- Create `app/api/inventory/snapshot/route.ts` — token-authed W09 snapshot.
- Create `app/api/inventory/search/route.ts` — token-authed catalog search.
- Create `lib/inventoryAuth.ts` — shared bearer-token check.

**TireTrackAdmin** (schema, functions, reports):
- Modify `convex/schema.ts` — four new tables.
- Create `convex/wms_count_locations.ts` — `COUNT_LOCATIONS`, the single source of truth for which locations are enabled. Inside `convex/` so scanner, Admin and Convex functions all read the same list.
- Create `convex/wms_count.ts` — batch lifecycle, scans, queries. New file rather than growing `wms.ts` (891 lines).
- Create `convex/wms_count_variance.ts` — the pure variance function, **inside `convex/`** so both the Convex functions and the Admin UI can import it.
- Create `lib/countVariance.test.ts` — Vitest against that function.
- Modify `app/page.tsx` — `inventory` role option, `/wms/counts` nav link.
- Create `app/wms/counts/page.tsx` — batch list.
- Create `app/wms/counts/[id]/page.tsx` — scanned + discrepancy tabs.
- Create `app/wms/counts/exports.ts` — CSV and PDF builders, kept out of the page files.
- Modify `app/wms/page.tsx` — link to counts.

**TireTrackLite** (scanner):
- Create `src/screens/wms/WMSCountScreen.tsx`.
- Modify `src/screens/wms/WMSHomeScreen.tsx` — Count entry, role-gated.
- Modify `App.tsx` — `wmsCount` screen wiring.
- Modify `src/screens/HomeScreen.tsx` — pass `effectiveRole` down to the WMS home.

---

### Task 1: IECentral — "is this a countable tire?", tested

The single highest-risk piece of logic in the feature. Get it wrong one way and the discrepancy report is dominated by five 990,000-unit phantoms; get it wrong the other way and real truck tires vanish from the count. Pure function, tests first.

**`productType` is the discriminator** — see the spec. Exclude `T` and `T *`, keep every other code.

**Files:**
- Create: `IECentral/lib/inventorySnapshot.ts`
- Test: `IECentral/lib/inventorySnapshot.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `NON_TIRE_PRODUCT_TYPES: Set<string>`, `PLACEHOLDER_ITEM_IDS: Set<string>`, `PLACEHOLDER_QTY_THRESHOLD = 100_000`, `isCountableTire(row: { productType?: string; itemId?: string; qtyOnHand?: number }): boolean`, `type SnapshotItem = { itemId: string; qtyOnHand: number; brand: string; model: string; size: string; mpn: string }`. Used by Tasks 2 and 3.

- [ ] **Step 1: Create the branch**

```bash
cd ~/IECentral
git checkout main && git pull --ff-only
git checkout -b feat/w09-inventory-count
```

- [ ] **Step 2: Write the failing test**

Create `IECentral/lib/inventorySnapshot.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isCountableTire, NON_TIRE_PRODUCT_TYPES } from "./inventorySnapshot";

// Real W09 rows, copied from the live cache on 2026-07-31.
const tire = (productType: string, itemId: string, qtyOnHand: number) => ({
  productType,
  itemId,
  qtyOnHand,
});

describe("isCountableTire", () => {
  it("excludes productType 'T' — every such row is a placeholder, not a tire", () => {
    // These five hold 4,968,000 of W09's 5,001,320 "units".
    expect(isCountableTire(tire("T", "TIRE", 990000))).toBe(false);
    expect(isCountableTire(tire("T", "TIRE/U", 999000))).toBe(false);
    expect(isCountableTire(tire("T", "LTADJ", 990000))).toBe(false);
    expect(isCountableTire(tire("T", "STH", 999000))).toBe(false);
    expect(isCountableTire(tire("T", "NGT", 990000))).toBe(false);
    expect(isCountableTire(tire("T", "TED", 0))).toBe(false);
    expect(isCountableTire(tire("T", "TEST23", 0))).toBe(false);
  });

  it("excludes productType 'T *' — studding parts and labour", () => {
    expect(isCountableTire(tire("T *", "STUD12", 0))).toBe(false);
    expect(isCountableTire(tire("T *", "STUD15", 3))).toBe(false);
  });

  it("keeps passenger, light-truck, medium-truck and trailer tires", () => {
    expect(isCountableTire(tire("TP", "AYAEP044.", 990))).toBe(true);   // 185/65R14
    expect(isCountableTire(tire("TL", "LXST2031660020", 78))).toBe(true); // LT225/75R16
    expect(isCountableTire(tire("TM", "RBP1063481256", 82))).toBe(true);  // 11R22.5
    expect(isCountableTire(tire("TST", "ST17580R13", 11))).toBe(true);    // ST175/80R13
  });

  it("keeps starred tire classes", () => {
    expect(isCountableTire(tire("TP*", "DU266016616[", 1872))).toBe(true);
    expect(isCountableTire(tire("TL*", "SOMEWINTER", 4))).toBe(true);
  });

  it("keeps an unknown-but-tire-looking class rather than dropping inventory", () => {
    // Blocklist, not allowlist: a new JMK tire class must not silently vanish.
    expect(isCountableTire(tire("TB", "SOMEBUSTIRE", 12))).toBe(true);
  });

  it("is case- and whitespace-insensitive on productType", () => {
    expect(isCountableTire(tire("  t  ", "TIRE", 990000))).toBe(false);
    expect(isCountableTire(tire(" tp ", "AYAEP044.", 12))).toBe(true);
  });

  it("excludes anything at or above the qty threshold as a backstop", () => {
    // Catches a placeholder that arrives under a new productType.
    expect(isCountableTire(tire("TP", "NEWPLACEHOLDER", 100000))).toBe(false);
  });

  it("excludes the known placeholder itemIds even under a tire productType", () => {
    // Third layer, in case JMK reclassifies a placeholder.
    expect(isCountableTire(tire("TP", "STH", 5))).toBe(false);
    expect(isCountableTire(tire("TP", "TEST'TS'ITEM-", 5))).toBe(false);
  });

  it("does not treat a substring as a placeholder itemId", () => {
    // 'TIRE' is a placeholder id; 'TIREX123' is a real part number.
    expect(isCountableTire(tire("TP", "TIREX123", 40))).toBe(true);
  });

  it("excludes a row with no productType at all rather than guessing", () => {
    expect(isCountableTire({ itemId: "MYSTERY", qtyOnHand: 5 })).toBe(false);
  });

  it("lists exactly the two non-tire codes", () => {
    expect([...NON_TIRE_PRODUCT_TYPES].sort()).toEqual(["T", "T *"]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd ~/IECentral && npx vitest run lib/inventorySnapshot.test.ts`
Expected: FAIL — cannot resolve `./inventorySnapshot`.

- [ ] **Step 4: Write the implementation**

Create `IECentral/lib/inventorySnapshot.ts`:

```ts
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { createGunzip } from "zlib";
import { createInterface } from "readline";
import { brandCodeToName } from "@/lib/brandMapping";

const BUCKET = "ietires-dunlop-jmk-uploads";
const META_KEY = "jmk-uploads/oeival/_cache/latest.meta.json";
const ITEMS_KEY = "jmk-uploads/oeival/_cache/latest.items.ndjson.gz";

/**
 * We count TIRES. `productType` is JMK's classification and it is the honest
 * discriminator — every code starts with "T", but not every code is a tire.
 *
 *   T    -> TIRE, TIRE/U, LTADJ, STH, NGT, TED, TEST* — transaction
 *           placeholders carrying 990,000/999,000 "units". No real tires.
 *   T *  -> STUD12/13/15, "TIRE STUDDING PARTS AND LABOR". Parts and labour.
 *   rest -> TP passenger, TL light truck, TM medium truck, TST trailer,
 *           TP*/TL* starred variants, TF, TS, TSG, T2M, TA, TO, TPT, TT.
 *
 * A BLOCKLIST, not an allowlist, on purpose: if JMK adds a new tire class, an
 * allowlist would silently drop real inventory from every count, which is the
 * worse failure. A new placeholder class is caught by the two backstops below
 * and shows up in the excluded-count.
 */
export const NON_TIRE_PRODUCT_TYPES = new Set(["T", "T *"]);

/** Known placeholder itemIds — third layer, in case one gets reclassified. */
export const PLACEHOLDER_ITEM_IDS = new Set([
  "TIRE",
  "TIRE/U",
  "LTADJ",
  "STH",
  "NGT",
  "TED",
]);

/** Backstop: placeholders carry 990,000+. Largest real W09 stock is 1,872. */
export const PLACEHOLDER_QTY_THRESHOLD = 100_000;

/**
 * True when a row is a countable physical tire.
 *
 * Deliberately NOT keyed on `dclass`, which looks like the obvious rule — 463 of
 * W09's 480 real items are `dclass: "Dot"`. The other 17 are real tires too:
 * nine RBP commercial truck tires (225/70R19.5, 11R22.5) with blank dclass and
 * eight "Bracket" rows. Filtering on dclass silently drops them.
 */
export function isCountableTire(row: {
  productType?: string;
  itemId?: string;
  qtyOnHand?: number;
}): boolean {
  const pt = String(row.productType ?? "").trim().toUpperCase();
  if (!pt) return false; // no classification — don't guess it's a tire
  if (NON_TIRE_PRODUCT_TYPES.has(pt)) return false;

  const id = String(row.itemId ?? "").trim().toUpperCase();
  if (!id) return false;
  if (PLACEHOLDER_ITEM_IDS.has(id)) return false;
  if (id.startsWith("TEST")) return false;

  if (Math.abs(Number(row.qtyOnHand) || 0) >= PLACEHOLDER_QTY_THRESHOLD) return false;

  return true;
}

export type SnapshotItem = {
  itemId: string;
  qtyOnHand: number;
  brand: string;
  model: string;
  size: string;
  mpn: string;
};

export type SnapshotResult = {
  location: string;
  fileDate: string | null;
  fileName: string | null;
  generatedAt: string | null;
  count: number;
  excludedNonTires: number;
  excludedUnits: number;
  items: SnapshotItem[];
};

const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        },
      }
    : {}),
});

/** Thrown when the Lambda has not yet built a cache. Route maps this to 409. */
export class SnapshotCacheMissing extends Error {}

/**
 * Stream the OEIVAL cache and return countable on-hand stock for one location.
 * Mirrors app/api/reports/inventory-data/route.ts, minus the price columns.
 */
export async function readLocationSnapshot(location: string): Promise<SnapshotResult> {
  const loc = location.trim().toUpperCase();

  let meta: any;
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: META_KEY }));
    const text = await res.Body?.transformToString("utf-8");
    if (!text) throw new Error("empty meta");
    meta = JSON.parse(text);
  } catch (err) {
    throw new SnapshotCacheMissing(
      "Inventory cache hasn't been built yet. Upload a new OEIVAL or trigger the " +
        "dunlop-oeival-processor Lambda. (" +
        (err instanceof Error ? err.message : "unknown") +
        ")"
    );
  }

  const itemsRes = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: meta.itemsKey || ITEMS_KEY })
  );
  const body = itemsRes.Body as unknown as NodeJS.ReadableStream | null;
  if (!body) throw new SnapshotCacheMissing("Cache items file missing.");

  const gunzip = createGunzip();
  body.pipe(gunzip as unknown as NodeJS.WritableStream);
  const rl = createInterface({
    input: gunzip as unknown as NodeJS.ReadableStream,
    crlfDelay: Infinity,
  });

  // Key by itemId. W09 measured one row per itemId, but do not assume that
  // holds for every location — sum duplicates rather than overwrite.
  const byItem = new Map<string, SnapshotItem>();
  let excludedNonTires = 0;
  let excludedUnits = 0;

  for await (const line of rl) {
    if (!line) continue;
    let it: any;
    try {
      it = JSON.parse(line);
    } catch {
      continue;
    }
    if (String(it.location ?? "").trim().toUpperCase() !== loc) continue;

    const qty = Number(it.qtyOnHand ?? 0);
    if (qty === 0) continue;

    const itemId = String(it.itemId ?? "").trim();
    if (!isCountableTire({ productType: it.productType, itemId, qtyOnHand: qty })) {
      excludedNonTires += 1;
      excludedUnits += qty;
      continue;
    }

    const key = itemId.toUpperCase();
    const existing = byItem.get(key);
    if (existing) {
      existing.qtyOnHand += qty;
    } else {
      byItem.set(key, {
        itemId,
        qtyOnHand: qty,
        brand: brandCodeToName(String(it.manufacturerName ?? "")),
        model: String(it.model ?? ""),
        size: String(it.description ?? ""),
        mpn: String(it.mfgItemId ?? ""),
      });
    }
  }

  const items = [...byItem.values()];
  return {
    location: loc,
    fileDate: meta.fileDate ?? null,
    fileName: meta.fileName ?? null,
    generatedAt: meta.generatedAt ?? null,
    count: items.length,
    excludedNonTires,
    excludedUnits,
    items,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd ~/IECentral && npx vitest run lib/inventorySnapshot.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Verify typecheck**

Run: `cd ~/IECentral && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
cd ~/IECentral
git add lib/inventorySnapshot.ts lib/inventorySnapshot.test.ts
git commit -m "feat(inventory): location snapshot reader with sentinel SKU exclusion

Five JMK pseudo-SKUs (TIRE, TIRE/U, LTADJ, STH, NGT) hold 4,968,000 of
W09's 5,001,320 'units' — placeholders for dropship, adjustment and
ship-to-home, not tires. Excluded by explicit itemId plus a 100k qty
backstop, and counted in the result so the exclusion is auditable.

Explicitly NOT excluded on blank dclass: nine blank-dclass in-stock rows
at W09 are real RBP truck tires and would be silently dropped."
```

---

### Task 2: IECentral — the two token-authed endpoints

**Files:**
- Create: `IECentral/lib/inventoryAuth.ts`
- Create: `IECentral/app/api/inventory/snapshot/route.ts`
- Create: `IECentral/app/api/inventory/search/route.ts`

**Interfaces:**
- Consumes: `readLocationSnapshot`, `SnapshotCacheMissing` (Task 1); existing `searchTires` from `lib/oeivalBrandIndex`.
- Produces: `GET /api/inventory/snapshot?location=W09` → `SnapshotResult`; `GET /api/inventory/search?q=...` → `{ results: TireSearchResult[] }`. Both require `Authorization: Bearer $INVENTORY_SNAPSHOT_TOKEN`. Used by Task 4.

- [ ] **Step 1: Create the shared auth check**

Create `IECentral/lib/inventoryAuth.ts`:

```ts
import { timingSafeEqual } from "crypto";

/**
 * Bearer-token gate for the inventory endpoints.
 *
 * Returns null when the request is authorised, or the numeric status to reply
 * with. Fails CLOSED: an unset token yields 503, never open access.
 */
export function checkInventoryToken(req: Request): 401 | 503 | null {
  const expected = process.env.INVENTORY_SNAPSHOT_TOKEN;
  if (!expected) return 503;

  const header = req.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return 401;
  const provided = header.slice(prefix.length);

  // timingSafeEqual throws on length mismatch, so compare lengths first.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return 401;
  return timingSafeEqual(a, b) ? null : 401;
}
```

- [ ] **Step 2: Create the snapshot route**

Create `IECentral/app/api/inventory/snapshot/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkInventoryToken } from "@/lib/inventoryAuth";
import { readLocationSnapshot, SnapshotCacheMissing } from "@/lib/inventorySnapshot";

export const maxDuration = 60;

/**
 * GET /api/inventory/snapshot?location=W09
 *
 * Countable on-hand stock for one location, from the OEIVAL cache, with JMK
 * sentinel SKUs excluded. Consumed by TireTrack's count-batch open action to
 * freeze an immutable comparison baseline.
 */
export async function GET(request: NextRequest) {
  const authFail = checkInventoryToken(request);
  if (authFail) {
    return NextResponse.json(
      { error: authFail === 503 ? "INVENTORY_SNAPSHOT_TOKEN not configured" : "Unauthorized" },
      { status: authFail }
    );
  }

  const location = request.nextUrl.searchParams.get("location") || "";
  if (!/^[A-Za-z0-9]{2,8}$/.test(location)) {
    return NextResponse.json({ error: "location required, e.g. W09" }, { status: 400 });
  }

  try {
    return NextResponse.json(await readLocationSnapshot(location));
  } catch (err) {
    if (err instanceof SnapshotCacheMissing) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "snapshot failed" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Create the search route**

Create `IECentral/app/api/inventory/search/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkInventoryToken } from "@/lib/inventoryAuth";
import { searchTires } from "@/lib/oeivalBrandIndex";

export const maxDuration = 30;

/**
 * GET /api/inventory/search?q=...
 *
 * Catalog search for the scanner's sidewall lookup, so a counter holding an
 * unrecognised UPC can find the tire by what is printed on it. Needed because
 * only 480 of W09's 56,107 catalog items are in stock — a tire on the floor may
 * be any catalog item, so the frozen baseline is not a sufficient search index.
 */
export async function GET(request: NextRequest) {
  const authFail = checkInventoryToken(request);
  if (authFail) {
    return NextResponse.json(
      { error: authFail === 503 ? "INVENTORY_SNAPSHOT_TOKEN not configured" : "Unauthorized" },
      { status: authFail }
    );
  }

  const q = request.nextUrl.searchParams.get("q") || "";
  if (q.trim().length < 2) return NextResponse.json({ results: [] });

  try {
    return NextResponse.json({ results: await searchTires(q, 40) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "search failed", results: [] },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Verify typecheck and existing tests**

```bash
cd ~/IECentral && npx tsc --noEmit && npx vitest run
```
Expected: no `tsc` output; all tests pass.

- [ ] **Step 5: Commit**

```bash
cd ~/IECentral
git add lib/inventoryAuth.ts app/api/inventory
git commit -m "feat(inventory): token-authed snapshot and catalog search endpoints

Narrow, purpose-built endpoints for TireTrack's W09 count rather than
widening the existing unauthenticated /api/reports/* surface. Bearer token
compared with timingSafeEqual; an unset token returns 503 so the routes
fail closed rather than becoming open."
```

- [ ] **Step 6: Set the token in Vercel and locally, then verify against production**

The token is a shared secret. Generate one, add it to IECentral's Vercel project env (all environments) and to `.env.local`, then redeploy. **Ask the user to run the env-var commands rather than writing the secret into a tracked file.**

```bash
# generate
openssl rand -hex 32
```

After the deploy, confirm the contract end to end:

```bash
# 401 without a token
curl -s -o /dev/null -w "%{http_code}\n" -L "https://www.iecentral.com/api/inventory/snapshot?location=W09"
# expect 401

# 200 with it, and the measured shape
curl -s -L -H "Authorization: Bearer $TOKEN" \
  "https://www.iecentral.com/api/inventory/snapshot?location=W09" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print({k:d[k] for k in ('location','fileDate','count','excludedNonTires','excludedUnits')})"
# expect count == 480, excludedNonTires == 5, excludedUnits ≈ 4968000
```

Record the actual numbers, and read them as a diagnostic:

| observed `count` | meaning |
|---|---|
| **480** | correct |
| 485 | the `productType` exclusion did not run |
| 471 | `dclass` was filtered — 9 RBP truck tires wrongly dropped |
| 463 | only `dclass: "Dot"` kept — 17 real tires wrongly dropped |
| ~347 | only `productType: "TP"` kept — all light/medium truck and trailer tires dropped |

---

### Task 3: Convex schema — four count tables

**Files:**
- Modify: `TireTrackAdmin/convex/schema.ts` (append after `wms_user_assignments`, before the closing `});`)

**Interfaces:**
- Consumes: nothing.
- Produces: tables `wms_count_batches`, `wms_count_baseline`, `wms_count_scans`, `wms_count_totals`. Used by Tasks 4-8.

- [ ] **Step 1: Add the tables**

In `convex/schema.ts`, after the `wms_user_assignments` table definition:

```ts
  // ==========================================================================
  // WMS Inventory Count — physical count vs a frozen IECentral baseline.
  // Reports only; nothing is written back to IECentral or JMK.
  // ==========================================================================

  wms_count_batches: defineTable({
    warehouseCode: v.string(),
    status: v.union(v.literal("open"), v.literal("closed")),
    // Stringified id from either users or adminUsers — batches are opened from
    // the scanner and from Admin. Mirrors wms_transactions.performedBy.
    openedBy: v.string(),
    openedByName: v.string(),
    openedAt: v.number(),
    closedBy: v.optional(v.string()),
    closedByName: v.optional(v.string()),
    closedAt: v.optional(v.number()),
    baselineStatus: v.union(
      v.literal("pending"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    baselineError: v.optional(v.string()),
    baselineFileDate: v.optional(v.string()),      // OEIVAL fileDate — self-describing report
    baselineGeneratedAt: v.optional(v.string()),
    baselineItemCount: v.optional(v.number()),
    baselineUnitCount: v.optional(v.number()),
    baselineExcludedNonTires: v.optional(v.number()),
    baselineExcludedUnits: v.optional(v.number()),
    notes: v.optional(v.string()),
  }).index("by_warehouse_status", ["warehouseCode", "status"])
    .index("by_warehouse_openedAt", ["warehouseCode", "openedAt"]),

  // Immutable once baselineStatus flips to "ready" — this is what makes a
  // report run months later reproduce exactly what it said on the day.
  wms_count_baseline: defineTable({
    batchId: v.id("wms_count_batches"),
    itemId: v.string(),
    qtyOnHand: v.number(),
    brand: v.optional(v.string()),
    model: v.optional(v.string()),
    size: v.optional(v.string()),
    mpn: v.optional(v.string()),
  }).index("by_batch", ["batchId"])
    .index("by_batch_item", ["batchId", "itemId"]),

  // One row per scan event — the audit trail. Undo is a soft void, never a
  // delete: a miscount that vanishes is a miscount nobody can explain later.
  wms_count_scans: defineTable({
    batchId: v.id("wms_count_batches"),
    warehouseCode: v.string(),
    rawBarcode: v.string(),
    upc: v.optional(v.string()),
    itemId: v.optional(v.string()),        // absent = unmatched
    quantity: v.number(),
    matchSource: v.union(
      v.literal("upc"),
      v.literal("manual-search"),
      v.literal("resolved"),
      v.literal("unmatched"),
    ),
    brand: v.optional(v.string()),
    model: v.optional(v.string()),
    size: v.optional(v.string()),
    scannedBy: v.string(),
    scannedByName: v.string(),
    scannedAt: v.number(),
    voided: v.optional(v.boolean()),
    voidedBy: v.optional(v.string()),
    voidedAt: v.optional(v.number()),
  }).index("by_batch_scannedAt", ["batchId", "scannedAt"])
    .index("by_batch_item", ["batchId", "itemId"])
    .index("by_batch_upc", ["batchId", "upc"]),

  // Who may count, and WHERE. Deliberately separate from wms_user_assignments:
  // that table gates the Chestnut Ridge WMS pilot, and counting at a retail
  // store has nothing to do with warehouse management. The `inventory` role says
  // a person counts; this says which locations.
  wms_count_assignments: defineTable({
    userId: v.id("users"),
    locationCode: v.string(),
    assignedAt: v.number(),
    assignedBy: v.string(),
  }).index("by_user", ["userId"])
    .index("by_location", ["locationCode"])
    .index("by_user_location", ["userId", "locationCode"]),

  // Rollup maintained in the same transaction as each scan, so reports never
  // collect() thousands of raw scan rows. Exactly one of itemId / upc is set:
  // matched totals key on itemId, unmatched on upc.
  wms_count_totals: defineTable({
    batchId: v.id("wms_count_batches"),
    itemId: v.optional(v.string()),
    upc: v.optional(v.string()),
    countedQty: v.number(),
    scanCount: v.number(),
    lastScannedAt: v.number(),
  }).index("by_batch", ["batchId"])
    .index("by_batch_item", ["batchId", "itemId"])
    .index("by_batch_upc", ["batchId", "upc"]),
```

- [ ] **Step 2: Verify typecheck**

Run: `cd ~/TireTrackAdmin && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd ~/TireTrackAdmin
git add convex/schema.ts
git commit -m "feat(wms): schema for inventory count batches, baseline, scans, totals

wms_count_totals exists so reports never collect() raw scans. Exactly one
of itemId/upc is set per totals row — deliberately not an empty-string
sentinel, which is one grouping typo away from merging every unmatched UPC
into a single phantom item."
```

---

### Task 4: Variance computation, tested

The one place a silent bug produces a confidently wrong report that someone acts on. Pure function, tests first. Lives in `convex/` because both the Convex queries and the Admin pages import it, and `convex/` cannot import from outside itself.

**Files:**
- Create: `TireTrackAdmin/convex/wms_count_variance.ts`
- Test: `TireTrackAdmin/lib/countVariance.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
type BaselineRow = { itemId: string; qtyOnHand: number; brand?: string; model?: string; size?: string; mpn?: string };
type TotalRow = { itemId?: string; upc?: string; countedQty: number; scanCount: number };
type Bucket = "match" | "short" | "over" | "notFound" | "unexpected";
type VarianceRow = { itemId: string; brand?: string; model?: string; size?: string; mpn?: string; expected: number; counted: number; variance: number; scanCount: number; bucket: Bucket };
type UnmatchedRow = { upc: string; countedQty: number; scanCount: number };
type VarianceSummary = { baselineItems: number; countedItems: number; matched: number; short: number; over: number; notFound: number; unexpected: number; unmatchedUpcs: number; expectedUnits: number; countedUnits: number; netUnitVariance: number };
computeVariance(baseline: BaselineRow[], totals: TotalRow[]): { rows: VarianceRow[]; unmatched: UnmatchedRow[]; summary: VarianceSummary }
```

Used by Tasks 5, 7, 8.

- [ ] **Step 1: Write the failing test**

Create `TireTrackAdmin/lib/countVariance.test.ts`:

```ts
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
    expect(r.summary.matched).toBe(1);      // A
    expect(r.summary.short).toBe(1);        // B
    expect(r.summary.over).toBe(1);         // C
    expect(r.summary.notFound).toBe(1);     // D
    expect(r.summary.unexpected).toBe(1);   // Z
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/TireTrackAdmin && npx vitest run lib/countVariance.test.ts`
Expected: FAIL — cannot resolve `../convex/wms_count_variance`.

- [ ] **Step 3: Write the implementation**

Create `TireTrackAdmin/convex/wms_count_variance.ts`:

```ts
/**
 * Physical count vs frozen IECentral baseline.
 *
 * Pure and dependency-free on purpose: this is the one place where a silent
 * bug yields a confidently wrong report that somebody then acts on. Lives
 * inside convex/ because convex/ is copied verbatim into TireTrackLite and
 * therefore cannot import from the repo's top-level lib/.
 */

export type BaselineRow = {
  itemId: string;
  qtyOnHand: number;
  brand?: string;
  model?: string;
  size?: string;
  mpn?: string;
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
  if (expected > 0 && counted === 0) return "notFound";
  if (expected === 0) return "unexpected";
  if (counted === expected) return "match";
  return counted < expected ? "short" : "over";
}

export function computeVariance(
  baseline: BaselineRow[],
  totals: TotalRow[],
): { rows: VarianceRow[]; unmatched: UnmatchedRow[]; summary: VarianceSummary } {
  const baseByItem = new Map<string, BaselineRow>();
  for (const row of baseline) baseByItem.set(key(row.itemId), row);

  const countedByItem = new Map<string, { qty: number; scans: number }>();
  const unmatched: UnmatchedRow[] = [];

  for (const t of totals) {
    if (t.itemId) {
      const k = key(t.itemId);
      const prev = countedByItem.get(k) ?? { qty: 0, scans: 0 };
      countedByItem.set(k, {
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

  // Full outer join: every baseline item, plus every counted item with no
  // baseline row.
  for (const [k, base] of baseByItem) {
    const c = countedByItem.get(k);
    const expected = base.qtyOnHand;
    const counted = c?.qty ?? 0;
    rows.push({
      itemId: base.itemId,
      brand: base.brand,
      model: base.model,
      size: base.size,
      mpn: base.mpn,
      expected,
      counted,
      variance: counted - expected,
      scanCount: c?.scans ?? 0,
      bucket: bucketFor(expected, counted),
    });
  }

  for (const [k, c] of countedByItem) {
    if (baseByItem.has(k)) continue;
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
      baselineItems: baseByItem.size,
      countedItems: countedByItem.size,
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/TireTrackAdmin && npx vitest run`
Expected: PASS — 11 new tests plus the 7 existing `conditionPhotos` tests.

- [ ] **Step 5: Verify typecheck and that Convex still bundles**

```bash
cd ~/TireTrackAdmin && npx tsc --noEmit && npx convex codegen
```
Expected: both clean. `convex codegen` proves the new file bundles.

- [ ] **Step 6: Commit**

```bash
cd ~/TireTrackAdmin
git add convex/wms_count_variance.ts lib/countVariance.test.ts
git commit -m "feat(wms): pure variance computation with five buckets, tested

Full outer join of frozen baseline against counted totals. notFound
(expected > 0, counted 0) is separated from short because that is where
real shrink shows up and a naive implementation merges the two. Unmatched
UPCs are reported alongside but never folded into variance.

Lives in convex/ because convex/ is copied into TireTrackLite and cannot
import the repo's top-level lib/."
```

---

### Task 5: Convex count functions

**Files:**
- Create: `TireTrackAdmin/convex/wms_count.ts`

**Interfaces:**
- Consumes: schema (Task 3); `computeVariance` (Task 4); `IECENTRAL_SNAPSHOT_URL` and `IECENTRAL_SNAPSHOT_TOKEN` from Convex env.
- Produces:
  - `openCountBatch` (action) `{ warehouseCode, actor }` → `{ batchId, alreadyOpen? }`
  - `retryBaseline` (action) `{ batchId, actor }`
  - `recordCountScan` (mutation) `{ batchId, rawBarcode, quantity, actor, itemIdOverride? }` → `{ scanId, itemId?, matched, brand?, model?, size?, runningQty }`
  - `voidCountScan` (mutation) `{ scanId, actor }`
  - `closeCountBatch` (mutation) `{ batchId, actor }`
  - `resolveUnmatchedUpc` (mutation) `{ batchId, upc, itemId, alsoSaveMapping, scope, scanId?, actor }`
  - `getOpenCountBatch`, `getCountBatches`, `getCountBatch`, `getCountVariance`, `listCountScans` (queries)
  - `searchIECentralTires` (action) `{ q, actor }` → `{ results }`
  - Actor validator shape shared by all of the above.

- [ ] **Step 1: Create the enabled-locations constant**

Create `TireTrackAdmin/convex/wms_count_locations.ts`. This is the **only** place
a location code is named. Inside `convex/` so the scanner, the Admin pages and the
Convex functions all read one list.

```ts
/**
 * Locations enabled for physical counting.
 *
 * Deliberately a constant, not a config table: enabling a location means someone
 * will act on its variance report, so it should be a reviewed code change rather
 * than a checkbox clicked by accident. Adding Jeannette is one line here.
 *
 * All nine codes the OEIVAL cache carries, for reference when enabling:
 *   R10 Everson · R15 Rodgers · R20 Essey Tire · R25 Export · R30 Jeannette
 *   R35 King's Super Tire · W07 Uniontown · W08 Latrobe · W09 Chestnut Ridge
 */
export const COUNT_LOCATIONS: Array<{ code: string; label: string }> = [
  { code: "W09", label: "Chestnut Ridge" },
];
```

- [ ] **Step 2: Create the file with the actor helper and batch lifecycle**

Create `TireTrackAdmin/convex/wms_count.ts`:

```ts
import { action, mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { computeVariance } from "./wms_count_variance";
import { COUNT_LOCATIONS } from "./wms_count_locations";
import { Id } from "./_generated/dataModel";

/**
 * Count batches are opened and closed from BOTH the scanner (users) and
 * TireTrackAdmin (adminUsers), which are separate identity tables. Every
 * mutation therefore takes a discriminated actor rather than a bare user id.
 */
export const actorValidator = v.union(
  v.object({ kind: v.literal("user"), userId: v.id("users") }),
  v.object({ kind: v.literal("admin"), adminId: v.id("adminUsers") }),
);

type Actor =
  | { kind: "user"; userId: Id<"users"> }
  | { kind: "admin"; adminId: Id<"adminUsers"> };

/**
 * Resolve and authorise an actor. Throws otherwise — client gating is
 * convenience, this is the boundary.
 */
async function authorizeCountActor(
  ctx: { db: any },
  actor: Actor,
  warehouseCode: string,
): Promise<{ performedBy: string; performedByName: string }> {
  if (actor.kind === "user") {
    const user = await ctx.db.get(actor.userId);
    if (!user || !user.isActive) throw new Error("Not authorized");
    if (user.role !== "inventory") {
      throw new Error("Inventory role required to count");
    }
    // wms_count_assignments, NOT wms_user_assignments — counting is not the
    // WMS pilot. A counter at a retail store never touches warehouse management.
    const assignment = await ctx.db
      .query("wms_count_assignments")
      .withIndex("by_user_location", (q: any) =>
        q.eq("userId", actor.userId).eq("locationCode", warehouseCode),
      )
      .first();
    if (!assignment) throw new Error(`Not assigned to count at ${warehouseCode}`);
    return { performedBy: String(actor.userId), performedByName: user.name };
  }

  const admin = await ctx.db.get(actor.adminId);
  if (!admin || !admin.isActive) throw new Error("Not authorized");
  if (admin.role !== "admin" && admin.role !== "superadmin") {
    throw new Error("Not authorized");
  }
  // Empty allowedLocations already means all-locations elsewhere in this codebase.
  if (
    admin.allowedLocations.length > 0 &&
    !admin.allowedLocations.includes(warehouseCode)
  ) {
    throw new Error(`Not authorized for ${warehouseCode}`);
  }
  return { performedBy: String(actor.adminId), performedByName: admin.name };
}

const normalizeUpc = (raw: string) => String(raw ?? "").replace(/\D/g, "");

// ---------------------------------------------------------------- batch open

export const createBatchInternal = internalMutation({
  args: { warehouseCode: v.string(), actor: actorValidator },
  handler: async (ctx, args) => {
    if (!COUNT_LOCATIONS.some((l) => l.code === args.warehouseCode)) {
      // Explicit error rather than an empty baseline, which would read as
      // "this location has zero inventory".
      throw new Error(`${args.warehouseCode} is not enabled for counting`);
    }

    const { performedBy, performedByName } = await authorizeCountActor(
      ctx,
      args.actor as Actor,
      args.warehouseCode,
    );

    const existing = await ctx.db
      .query("wms_count_batches")
      .withIndex("by_warehouse_status", (q) =>
        q.eq("warehouseCode", args.warehouseCode).eq("status", "open"),
      )
      .first();
    if (existing) return { batchId: existing._id, alreadyOpen: true as const };

    const batchId = await ctx.db.insert("wms_count_batches", {
      warehouseCode: args.warehouseCode,
      status: "open",
      openedBy: performedBy,
      openedByName: performedByName,
      openedAt: Date.now(),
      baselineStatus: "pending",
    });
    return { batchId, alreadyOpen: false as const };
  },
});

export const insertBaselineChunk = internalMutation({
  args: {
    batchId: v.id("wms_count_batches"),
    items: v.array(
      v.object({
        itemId: v.string(),
        qtyOnHand: v.number(),
        brand: v.optional(v.string()),
        model: v.optional(v.string()),
        size: v.optional(v.string()),
        mpn: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const it of args.items) {
      await ctx.db.insert("wms_count_baseline", { batchId: args.batchId, ...it });
    }
  },
});

export const finishBaseline = internalMutation({
  args: {
    batchId: v.id("wms_count_batches"),
    status: v.union(v.literal("ready"), v.literal("failed")),
    error: v.optional(v.string()),
    fileDate: v.optional(v.string()),
    generatedAt: v.optional(v.string()),
    itemCount: v.optional(v.number()),
    unitCount: v.optional(v.number()),
    excludedNonTires: v.optional(v.number()),
    excludedUnits: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { batchId, status, error, ...rest } = args;
    await ctx.db.patch(batchId, {
      baselineStatus: status,
      baselineError: error,
      baselineFileDate: rest.fileDate,
      baselineGeneratedAt: rest.generatedAt,
      baselineItemCount: rest.itemCount,
      baselineUnitCount: rest.unitCount,
      baselineExcludedNonTires: rest.excludedNonTires,
      baselineExcludedUnits: rest.excludedUnits,
    });
  },
});

export const clearBaseline = internalMutation({
  args: { batchId: v.id("wms_count_batches") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("wms_count_baseline")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
  },
});

async function loadBaseline(
  ctx: any,
  batchId: Id<"wms_count_batches">,
  warehouseCode: string,
) {
  const base = process.env.IECENTRAL_SNAPSHOT_URL;
  const token = process.env.IECENTRAL_SNAPSHOT_TOKEN;
  if (!base || !token) {
    await ctx.runMutation(internal.wms_count.finishBaseline, {
      batchId,
      status: "failed",
      error:
        "IECENTRAL_SNAPSHOT_URL / IECENTRAL_SNAPSHOT_TOKEN not set on the Convex deployment.",
    });
    return;
  }

  try {
    const res = await fetch(
      `${base}/api/inventory/snapshot?location=${encodeURIComponent(warehouseCode)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Snapshot returned ${res.status}. ${body.slice(0, 200)}` +
          (res.status === 401 ? " (check IECENTRAL_SNAPSHOT_TOKEN)" : ""),
      );
    }
    const snap = (await res.json()) as {
      fileDate: string | null;
      generatedAt: string | null;
      count: number;
      excludedNonTires: number;
      excludedUnits: number;
      items: Array<{
        itemId: string;
        qtyOnHand: number;
        brand?: string;
        model?: string;
        size?: string;
        mpn?: string;
      }>;
    };

    // 500-row chunks keep each transaction well inside Convex limits. W09
    // measured 480 items, so this is one chunk in practice — the loop is
    // headroom for a larger warehouse, not a current need.
    for (let i = 0; i < snap.items.length; i += 500) {
      await ctx.runMutation(internal.wms_count.insertBaselineChunk, {
        batchId,
        items: snap.items.slice(i, i + 500),
      });
    }

    await ctx.runMutation(internal.wms_count.finishBaseline, {
      batchId,
      status: "ready",
      fileDate: snap.fileDate ?? undefined,
      generatedAt: snap.generatedAt ?? undefined,
      itemCount: snap.items.length,
      unitCount: snap.items.reduce((n, i) => n + i.qtyOnHand, 0),
      excludedNonTires: snap.excludedNonTires,
      excludedUnits: snap.excludedUnits,
    });
  } catch (err: any) {
    await ctx.runMutation(internal.wms_count.clearBaseline, { batchId });
    await ctx.runMutation(internal.wms_count.finishBaseline, {
      batchId,
      status: "failed",
      error: err?.message ?? "Snapshot fetch failed",
    });
  }
}

/**
 * Open a count batch and freeze the IECentral baseline into it.
 *
 * Scanning is permitted while the baseline is pending or failed — the floor
 * must never wait on S3. Only variance reporting requires "ready".
 */
export const openCountBatch = action({
  args: { warehouseCode: v.string(), actor: actorValidator },
  handler: async (ctx, args): Promise<{ batchId: Id<"wms_count_batches">; alreadyOpen: boolean }> => {
    const created: { batchId: Id<"wms_count_batches">; alreadyOpen: boolean } =
      await ctx.runMutation(internal.wms_count.createBatchInternal, args);
    if (created.alreadyOpen) return created;
    await loadBaseline(ctx, created.batchId, args.warehouseCode);
    return created;
  },
});

export const retryBaseline = action({
  args: { batchId: v.id("wms_count_batches"), actor: actorValidator },
  handler: async (ctx, args): Promise<{ success: true }> => {
    const batch = await ctx.runQuery(internal.wms_count.getBatchInternal, {
      batchId: args.batchId,
    });
    if (!batch) throw new Error("Batch not found");
    await ctx.runMutation(internal.wms_count.clearBaseline, { batchId: args.batchId });
    await ctx.runMutation(internal.wms_count.finishBaseline, {
      batchId: args.batchId,
      status: "failed",
      error: "Retrying…",
    });
    await loadBaseline(ctx, args.batchId, batch.warehouseCode);
    return { success: true };
  },
});

export const getBatchInternal = internalQuery({
  args: { batchId: v.id("wms_count_batches") },
  handler: async (ctx, args) => await ctx.db.get(args.batchId),
});
```

- [ ] **Step 3: Append scan recording, void, close, and resolve**

Continue in the same file:

```ts
// -------------------------------------------------------------------- scans

/** Upsert the rollup for one scan delta. Keeps reports off the raw scan table. */
async function applyTotalsDelta(
  ctx: any,
  batchId: Id<"wms_count_batches">,
  opts: { itemId?: string; upc?: string; qtyDelta: number; scanDelta: number },
) {
  const existing = opts.itemId
    ? await ctx.db
        .query("wms_count_totals")
        .withIndex("by_batch_item", (q: any) =>
          q.eq("batchId", batchId).eq("itemId", opts.itemId),
        )
        .first()
    : await ctx.db
        .query("wms_count_totals")
        .withIndex("by_batch_upc", (q: any) =>
          q.eq("batchId", batchId).eq("upc", opts.upc),
        )
        .first();

  if (!existing) {
    if (opts.qtyDelta === 0 && opts.scanDelta === 0) return;
    await ctx.db.insert("wms_count_totals", {
      batchId,
      itemId: opts.itemId,
      upc: opts.itemId ? undefined : opts.upc,
      countedQty: opts.qtyDelta,
      scanCount: opts.scanDelta,
      lastScannedAt: Date.now(),
    });
    return;
  }

  const countedQty = existing.countedQty + opts.qtyDelta;
  const scanCount = existing.scanCount + opts.scanDelta;
  if (scanCount <= 0 && countedQty <= 0) {
    await ctx.db.delete(existing._id);
    return;
  }
  await ctx.db.patch(existing._id, {
    countedQty,
    scanCount,
    lastScannedAt: Date.now(),
  });
}

export const recordCountScan = mutation({
  args: {
    batchId: v.id("wms_count_batches"),
    rawBarcode: v.string(),
    quantity: v.number(),
    actor: actorValidator,
    itemIdOverride: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) throw new Error("Batch not found");
    if (batch.status !== "open") throw new Error("This batch is closed");

    const { performedBy, performedByName } = await authorizeCountActor(
      ctx,
      args.actor as Actor,
      batch.warehouseCode,
    );

    if (!Number.isInteger(args.quantity) || args.quantity < 1 || args.quantity > 999) {
      throw new Error("Quantity must be a whole number between 1 and 999");
    }

    const upc = normalizeUpc(args.rawBarcode);
    let itemId: string | undefined;
    let matchSource: "upc" | "manual-search" | "unmatched" = "unmatched";
    let brand: string | undefined;
    let model: string | undefined;
    let size: string | undefined;

    if (args.itemIdOverride) {
      itemId = args.itemIdOverride;
      matchSource = "manual-search";
    } else if (upc) {
      const tire = await ctx.db
        .query("tireUPCs")
        .withIndex("by_upc", (q) => q.eq("upc", upc))
        .first();
      if (tire?.inventoryNumber) {
        itemId = tire.inventoryNumber;
        matchSource = "upc";
        brand = tire.brand;
        model = tire.model;
        size = tire.size;
      }
    }

    if (itemId && !brand) {
      const base = await ctx.db
        .query("wms_count_baseline")
        .withIndex("by_batch_item", (q) =>
          q.eq("batchId", args.batchId).eq("itemId", itemId!),
        )
        .first();
      brand = base?.brand;
      model = base?.model;
      size = base?.size;
    }

    const scanId = await ctx.db.insert("wms_count_scans", {
      batchId: args.batchId,
      warehouseCode: batch.warehouseCode,
      rawBarcode: args.rawBarcode,
      upc: upc || undefined,
      itemId,
      quantity: args.quantity,
      matchSource,
      brand,
      model,
      size,
      scannedBy: performedBy,
      scannedByName: performedByName,
      scannedAt: Date.now(),
    });

    await applyTotalsDelta(ctx, args.batchId, {
      itemId,
      upc: upc || args.rawBarcode,
      qtyDelta: args.quantity,
      scanDelta: 1,
    });

    const totals = itemId
      ? await ctx.db
          .query("wms_count_totals")
          .withIndex("by_batch_item", (q) =>
            q.eq("batchId", args.batchId).eq("itemId", itemId!),
          )
          .first()
      : null;

    return {
      scanId,
      itemId,
      matched: !!itemId,
      brand,
      model,
      size,
      runningQty: totals?.countedQty ?? args.quantity,
    };
  },
});

export const voidCountScan = mutation({
  args: { scanId: v.id("wms_count_scans"), actor: actorValidator },
  handler: async (ctx, args) => {
    const scan = await ctx.db.get(args.scanId);
    if (!scan) throw new Error("Scan not found");
    if (scan.voided) return { success: true as const };

    const batch = await ctx.db.get(scan.batchId);
    if (!batch) throw new Error("Batch not found");
    if (batch.status !== "open") throw new Error("This batch is closed");

    const { performedBy } = await authorizeCountActor(
      ctx,
      args.actor as Actor,
      batch.warehouseCode,
    );

    await ctx.db.patch(args.scanId, {
      voided: true,
      voidedBy: performedBy,
      voidedAt: Date.now(),
    });
    await applyTotalsDelta(ctx, scan.batchId, {
      itemId: scan.itemId,
      upc: scan.upc || scan.rawBarcode,
      qtyDelta: -scan.quantity,
      scanDelta: -1,
    });
    return { success: true as const };
  },
});

export const closeCountBatch = mutation({
  args: { batchId: v.id("wms_count_batches"), actor: actorValidator },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) throw new Error("Batch not found");
    if (batch.status === "closed") return { success: true as const };

    const { performedBy, performedByName } = await authorizeCountActor(
      ctx,
      args.actor as Actor,
      batch.warehouseCode,
    );

    const anyScan = await ctx.db
      .query("wms_count_scans")
      .withIndex("by_batch_scannedAt", (q) => q.eq("batchId", args.batchId))
      .filter((q) => q.neq(q.field("voided"), true))
      .first();
    if (!anyScan) {
      throw new Error("Nothing has been counted yet — cannot close an empty batch");
    }

    await ctx.db.patch(args.batchId, {
      status: "closed",
      closedBy: performedBy,
      closedByName: performedByName,
      closedAt: Date.now(),
    });
    return { success: true as const };
  },
});

/**
 * Attach an unmatched UPC to an itemId.
 *
 * scope "scan" is the scanner resolving the tire in the counter's hand; scope
 * "batch" is Admin cleaning up every unmatched scan of that UPC wholesale.
 * They are genuinely different intents, hence the explicit argument.
 */
export const resolveUnmatchedUpc = mutation({
  args: {
    batchId: v.id("wms_count_batches"),
    upc: v.string(),
    itemId: v.string(),
    alsoSaveMapping: v.boolean(),
    scope: v.union(v.literal("batch"), v.literal("scan")),
    scanId: v.optional(v.id("wms_count_scans")),
    actor: actorValidator,
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) throw new Error("Batch not found");
    await authorizeCountActor(ctx, args.actor as Actor, batch.warehouseCode);

    if (args.scope === "scan" && !args.scanId) {
      throw new Error("scanId is required when scope is 'scan'");
    }

    const candidates =
      args.scope === "scan"
        ? [await ctx.db.get(args.scanId!)].filter(Boolean)
        : await ctx.db
            .query("wms_count_scans")
            .withIndex("by_batch_upc", (q) =>
              q.eq("batchId", args.batchId).eq("upc", args.upc),
            )
            .collect();

    const base = await ctx.db
      .query("wms_count_baseline")
      .withIndex("by_batch_item", (q) =>
        q.eq("batchId", args.batchId).eq("itemId", args.itemId),
      )
      .first();

    let moved = 0;
    for (const scan of candidates as any[]) {
      if (!scan || scan.voided || scan.itemId) continue;
      await ctx.db.patch(scan._id, {
        itemId: args.itemId,
        matchSource: "resolved",
        brand: base?.brand ?? scan.brand,
        model: base?.model ?? scan.model,
        size: base?.size ?? scan.size,
      });
      await applyTotalsDelta(ctx, args.batchId, {
        upc: scan.upc || scan.rawBarcode,
        qtyDelta: -scan.quantity,
        scanDelta: -1,
      });
      await applyTotalsDelta(ctx, args.batchId, {
        itemId: args.itemId,
        qtyDelta: scan.quantity,
        scanDelta: 1,
      });
      moved += 1;
    }

    if (args.alsoSaveMapping && args.upc) {
      const existing = await ctx.db
        .query("tireUPCs")
        .withIndex("by_upc", (q) => q.eq("upc", args.upc))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, { inventoryNumber: args.itemId });
      } else {
        await ctx.db.insert("tireUPCs", {
          upc: args.upc,
          brand: base?.brand ?? "",
          model: base?.model ?? "",
          size: base?.size ?? "",
          inventoryNumber: args.itemId,
        });
      }
    }

    return { success: true as const, scansMoved: moved };
  },
});
```

- [ ] **Step 4: Append the queries and the catalog-search action**

```ts
// ------------------------------------------------------------------ queries

/**
 * Locations this user may count at, resolved from wms_count_assignments and
 * intersected with the enabled list. The scanner reads THIS — never a constant —
 * so one assignment auto-selects and several show a picker.
 */
export const getMyCountLocations = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || !user.isActive || user.role !== "inventory") return [];
    const rows = await ctx.db
      .query("wms_count_assignments")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const enabled = new Map(COUNT_LOCATIONS.map((l) => [l.code, l.label]));
    return rows
      .filter((r) => enabled.has(r.locationCode))
      .map((r) => ({ code: r.locationCode, label: enabled.get(r.locationCode)! }));
  },
});

/** Enabled locations, for the Admin dropdown. */
export const getCountLocations = query({
  args: {},
  handler: async () => COUNT_LOCATIONS,
});

/** Grant a user the ability to count at a location. Admin only. */
export const assignCountLocation = mutation({
  args: {
    userId: v.id("users"),
    locationCode: v.string(),
    callerAdminId: v.id("adminUsers"),
  },
  handler: async (ctx, args) => {
    const admin = await ctx.db.get(args.callerAdminId);
    if (!admin || !admin.isActive) throw new Error("Not authorized");
    if (admin.role !== "admin" && admin.role !== "superadmin") {
      throw new Error("Not authorized");
    }
    if (!COUNT_LOCATIONS.some((l) => l.code === args.locationCode)) {
      throw new Error(`${args.locationCode} is not enabled for counting`);
    }
    const existing = await ctx.db
      .query("wms_count_assignments")
      .withIndex("by_user_location", (q) =>
        q.eq("userId", args.userId).eq("locationCode", args.locationCode),
      )
      .first();
    if (existing) return { success: true as const };
    await ctx.db.insert("wms_count_assignments", {
      userId: args.userId,
      locationCode: args.locationCode,
      assignedAt: Date.now(),
      assignedBy: admin.name,
    });
    return { success: true as const };
  },
});

export const unassignCountLocation = mutation({
  args: {
    userId: v.id("users"),
    locationCode: v.string(),
    callerAdminId: v.id("adminUsers"),
  },
  handler: async (ctx, args) => {
    const admin = await ctx.db.get(args.callerAdminId);
    if (!admin || !admin.isActive) throw new Error("Not authorized");
    const row = await ctx.db
      .query("wms_count_assignments")
      .withIndex("by_user_location", (q) =>
        q.eq("userId", args.userId).eq("locationCode", args.locationCode),
      )
      .first();
    if (row) await ctx.db.delete(row._id);
    return { success: true as const };
  },
});

export const getCountAssignments = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("wms_count_assignments").take(500);
    const users = await ctx.db.query("users").take(500);
    return rows.map((r) => ({
      ...r,
      userName: users.find((u) => u._id === r.userId)?.name ?? "Unknown",
    }));
  },
});

export const getOpenCountBatch = query({
  args: { warehouseCode: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("wms_count_batches")
      .withIndex("by_warehouse_status", (q) =>
        q.eq("warehouseCode", args.warehouseCode).eq("status", "open"),
      )
      .first(),
});

export const getCountBatches = query({
  args: { warehouseCode: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("wms_count_batches")
      .withIndex("by_warehouse_openedAt", (q) => q.eq("warehouseCode", args.warehouseCode))
      .order("desc")
      .take(100),
});

export const getCountBatch = query({
  args: { batchId: v.id("wms_count_batches") },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) return null;
    const totals = await ctx.db
      .query("wms_count_totals")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .collect();
    const scans = await ctx.db
      .query("wms_count_scans")
      .withIndex("by_batch_scannedAt", (q) => q.eq("batchId", args.batchId))
      .collect();
    const live = scans.filter((s) => s.voided !== true);

    // Per-counter breakdown — accountability on a multi-counter inventory day.
    const byCounter = new Map<string, { name: string; units: number; scans: number }>();
    for (const s of live) {
      const e = byCounter.get(s.scannedBy) ?? {
        name: s.scannedByName,
        units: 0,
        scans: 0,
      };
      e.units += s.quantity;
      e.scans += 1;
      byCounter.set(s.scannedBy, e);
    }

    return {
      batch,
      countedItems: totals.length,
      countedUnits: totals.reduce((n, t) => n + t.countedQty, 0),
      scanCount: live.length,
      voidedCount: scans.length - live.length,
      counters: [...byCounter.values()].sort((a, b) => b.units - a.units),
    };
  },
});

export const getCountVariance = query({
  args: { batchId: v.id("wms_count_batches") },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) return null;
    if (batch.baselineStatus !== "ready") {
      return { baselineStatus: batch.baselineStatus, baselineError: batch.baselineError };
    }
    const baseline = await ctx.db
      .query("wms_count_baseline")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .collect();
    const totals = await ctx.db
      .query("wms_count_totals")
      .withIndex("by_batch", (q) => q.eq("batchId", args.batchId))
      .collect();
    return {
      baselineStatus: "ready" as const,
      baselineFileDate: batch.baselineFileDate,
      baselineExcludedNonTires: batch.baselineExcludedNonTires,
      baselineExcludedUnits: batch.baselineExcludedUnits,
      ...computeVariance(baseline, totals),
    };
  },
});

export const listCountScans = query({
  args: { batchId: v.id("wms_count_batches"), limit: v.optional(v.number()) },
  handler: async (ctx, args) =>
    await ctx.db
      .query("wms_count_scans")
      .withIndex("by_batch_scannedAt", (q) => q.eq("batchId", args.batchId))
      .order("desc")
      .take(args.limit ?? 50),
});

/**
 * Sidewall lookup. Hits IECentral's catalog rather than the frozen baseline:
 * only 480 of W09's 56,107 catalog items are in stock, and finding stock the
 * book says is zero is a core purpose of counting.
 */
export const searchIECentralTires = action({
  args: { q: v.string() },
  handler: async (_ctx, args): Promise<{ results: any[]; error?: string }> => {
    const base = process.env.IECENTRAL_SNAPSHOT_URL;
    const token = process.env.IECENTRAL_SNAPSHOT_TOKEN;
    if (!base || !token) return { results: [], error: "Search is not configured" };
    try {
      const res = await fetch(
        `${base}/api/inventory/search?q=${encodeURIComponent(args.q)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return { results: [], error: `Search returned ${res.status}` };
      return (await res.json()) as { results: any[] };
    } catch (err: any) {
      return { results: [], error: err?.message ?? "Search failed" };
    }
  },
});
```

- [ ] **Step 5: Verify typecheck and bundling**

```bash
cd ~/TireTrackAdmin && npx tsc --noEmit && npx convex codegen && npx vitest run
```
Expected: all clean.

- [ ] **Step 6: Commit (fires the sync hook into TireTrackLite)**

```bash
cd ~/TireTrackAdmin
git add convex/wms_count.ts convex/wms_count_locations.ts
git commit -m "feat(wms): count batch lifecycle, scan recording, variance queries

Baseline is frozen at batch open by a Convex action fetching IECentral's
token-authed snapshot; scanning is allowed while it loads so the floor
never waits on S3. Totals are upserted in the same transaction as each
scan. Undo is a soft void that reverses the totals delta. Authorization
goes through one authorizeCountActor helper that accepts either a scanner
user with the inventory role or an admin."
```

- [ ] **Step 7: Confirm the sync hook copied it to Lite**

```bash
diff -q ~/TireTrackAdmin/convex/wms_count.ts ~/TireTrackLite/convex/wms_count.ts && echo SYNCED
```
Expected: `SYNCED`.

- [ ] **Step 8: Set the Convex environment variables and deploy**

`IECENTRAL_SNAPSHOT_URL` (**`https://www.iecentral.com`** — the www host, see below) and `IECENTRAL_SNAPSHOT_TOKEN` must exist on the **Convex** deployment, not just in Vercel. Ask the user for the deploy key, then:

```bash
cd ~/TireTrackAdmin
export CONVEX_DEPLOY_KEY='<wary-squirrel-295 key from the user>'
npx convex env set IECENTRAL_SNAPSHOT_URL https://www.iecentral.com
npx convex env set IECENTRAL_SNAPSHOT_TOKEN '<token from Task 2>'
npx convex deploy -y
```

---

### Task 6: Scanner — the Count screen

**Files:**
- Create: `TireTrackLite/src/screens/wms/WMSCountScreen.tsx`
- Modify: `TireTrackLite/src/screens/wms/WMSHomeScreen.tsx`
- Modify: `TireTrackLite/App.tsx`
- Modify: `TireTrackLite/src/screens/HomeScreen.tsx`

**Interfaces:**
- Consumes: `api.wms_count.*` from Task 5.
- Produces: `wmsCount` screen reachable from the WMS home when `role === "inventory"`.

- [ ] **Step 1: Create the branch**

```bash
cd ~/TireTrackLite
git checkout main && git pull --ff-only
git checkout -b feat/w09-inventory-count
```

- [ ] **Step 2: Widen `WMSHomeScreen` to gate the Count entry**

In `src/screens/wms/WMSHomeScreen.tsx`, extend the screen union and props:

```tsx
type WMSScreen = "wmsPutAway" | "wmsLocate" | "wmsPick" | "wmsMove" | "wmsCount";

interface WMSHomeScreenProps {
  onBack: () => void;
  onNavigate: (screen: WMSScreen) => void;
  /** Warehouse-user role; "inventory" unlocks the Count entry. */
  role?: string;
}
```

Accept `role` in the signature (`export default function WMSHomeScreen({ onBack, onNavigate, role }: WMSHomeScreenProps)`), and add this button after the existing Move button, matching the styling of its siblings:

```tsx
        {role === "inventory" && (
          <TouchableOpacity
            style={[styles.button, styles.buttonCount]}
            onPress={() => onNavigate("wmsCount")}
          >
            <Text style={styles.buttonIcon}>🧮</Text>
            <Text style={styles.buttonText}>Count</Text>
          </TouchableOpacity>
        )}
```

Add `buttonCount: { backgroundColor: "#0d9488" },` to that file's `StyleSheet.create`.

- [ ] **Step 3: Pass the role from `HomeScreen` through `App.tsx`**

`HomeScreen` already computes `effectiveRole`. In `App.tsx`, the `case "wms":` branch renders `WMSHomeScreen` — give it the role. `App.tsx` has the live user via `useAuth()`; add `role={user?.role}` to the `WMSHomeScreen` element and add `"wmsCount"` to the `Screen` union:

```tsx
  | "wmsCount";
```

and a new case:

```tsx
    case "wmsCount":
      return <WMSCountScreen onBack={() => navigate("wms")} />;
```

with the import:

```tsx
import WMSCountScreen from "./src/screens/wms/WMSCountScreen";
```

**Note:** `HomeScreen` re-fetches the live user and calls `login()` when `role` changes, so granting the Inventory role in Admin takes effect without a re-login. That path needs no change — but `App.tsx` must read `user?.role` from context (not a stale prop) for the gate to pick it up.

- [ ] **Step 4: Create the Count screen**

Create `TireTrackLite/src/screens/wms/WMSCountScreen.tsx`:

```tsx
// TireTrackLite/src/screens/wms/WMSCountScreen.tsx
import React, { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
} from "react-native";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { useAuth } from "../../context/AuthContext";

type Props = { onBack: () => void };

export default function WMSCountScreen({ onBack }: Props) {
  const { user } = useAuth();
  const actor = user
    ? ({ kind: "user" as const, userId: user._id as Id<"users"> })
    : null;

  // Location comes from THIS user's count assignments, never a constant — that
  // is what lets counting move to other locations without touching this screen.
  const myLocations = useQuery(
    api.wms_count.getMyCountLocations,
    user ? { userId: user._id as Id<"users"> } : "skip",
  );
  const [picked, setPicked] = useState<string | null>(null);
  const location =
    picked ?? (myLocations?.length === 1 ? myLocations[0].code : null);
  const locationLabel =
    myLocations?.find((l: any) => l.code === location)?.label ?? location ?? "";

  const openBatch = useQuery(
    api.wms_count.getOpenCountBatch,
    location ? { warehouseCode: location } : "skip",
  );
  const batchDetail = useQuery(
    api.wms_count.getCountBatch,
    openBatch?._id ? { batchId: openBatch._id } : "skip",
  );
  const recentScans = useQuery(
    api.wms_count.listCountScans,
    openBatch?._id ? { batchId: openBatch._id, limit: 10 } : "skip",
  );

  const openCountBatch = useAction(api.wms_count.openCountBatch);
  const searchTires = useAction(api.wms_count.searchIECentralTires);
  const recordScan = useMutation(api.wms_count.recordCountScan);
  const voidScan = useMutation(api.wms_count.voidCountScan);
  const closeBatch = useMutation(api.wms_count.closeCountBatch);
  const resolveUpc = useMutation(api.wms_count.resolveUnmatchedUpc);

  const [scanInput, setScanInput] = useState("");
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const batch = openBatch ?? null;
  const baselineStatus = batch?.baselineStatus;

  const handleOpen = async () => {
    if (!actor || !location) return;
    setBusy(true);
    try {
      await openCountBatch({ warehouseCode: location!, actor });
      setQty("1"); // fresh batch starts at 1 so a stale quantity can't carry over
    } catch (e: any) {
      Alert.alert("Could not open batch", e?.message ?? "Unknown error");
    } finally {
      setBusy(false);
    }
  };

  const handleScan = async (raw: string) => {
    const barcode = raw.trim();
    if (!barcode || !batch || !actor) return;
    const quantity = parseInt(qty, 10);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      Alert.alert("Bad quantity", "Enter a whole number between 1 and 999.");
      return;
    }
    setBusy(true);
    try {
      const res = await recordScan({
        batchId: batch._id,
        rawBarcode: barcode,
        quantity,
        actor,
      });
      setLastResult(res);
      setScanInput("");
      inputRef.current?.focus();
    } catch (e: any) {
      Alert.alert("Scan not saved", e?.message ?? "Unknown error");
    } finally {
      setBusy(false);
    }
  };

  const runSearch = async () => {
    if (searchText.trim().length < 2) return;
    setSearching(true);
    try {
      const res = await searchTires({ q: searchText });
      setSearchResults(res.results ?? []);
      if (res.error) Alert.alert("Search problem", res.error);
    } finally {
      setSearching(false);
    }
  };

  const pickSearchResult = async (item: any) => {
    if (!batch || !actor || !lastResult) return;
    try {
      await resolveUpc({
        batchId: batch._id,
        upc: lastResult.upc ?? "",
        itemId: item.itemId,
        alsoSaveMapping: true,
        scope: "scan",
        scanId: lastResult.scanId,
        actor,
      });
      setSearchOpen(false);
      setSearchResults([]);
      setSearchText("");
      setLastResult({ ...lastResult, matched: true, itemId: item.itemId });
    } catch (e: any) {
      Alert.alert("Could not attach", e?.message ?? "Unknown error");
    }
  };

  const handleClose = () => {
    if (!batch || !actor) return;
    Alert.alert(
      "Close this count?",
      `${batchDetail?.countedUnits ?? 0} units across ${batchDetail?.countedItems ?? 0} items. This freezes the batch.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Close batch",
          style: "destructive",
          onPress: async () => {
            try {
              await closeBatch({ batchId: batch._id, actor });
            } catch (e: any) {
              Alert.alert("Could not close", e?.message ?? "Unknown error");
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Inventory Count{locationLabel ? ` · ${locationLabel}` : ""}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {myLocations !== undefined && myLocations.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>No counting locations</Text>
            <Text style={styles.muted}>
              Ask an admin to assign you a location to count in TireTrack Admin.
            </Text>
          </View>
        ) : !location ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Choose a location</Text>
            {(myLocations ?? []).map((l: any) => (
              <TouchableOpacity
                key={l.code}
                style={styles.primaryBtn}
                onPress={() => setPicked(l.code)}
              >
                <Text style={styles.primaryBtnText}>
                  {l.label} ({l.code})
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : !batch ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>No open count</Text>
            <Text style={styles.muted}>
              Opening a batch for {locationLabel} freezes the current IECentral
              on-hand figures, so stock moving during the count can't skew the
              result.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleOpen} disabled={busy}>
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Open count batch</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Open count</Text>
              <Text style={styles.muted}>
                Opened by {batch.openedByName} ·{" "}
                {new Date(batch.openedAt).toLocaleString()}
              </Text>
              <View style={styles.statRow}>
                <View style={styles.stat}>
                  <Text style={styles.statNum}>{batchDetail?.countedUnits ?? 0}</Text>
                  <Text style={styles.statLabel}>units</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statNum}>{batchDetail?.countedItems ?? 0}</Text>
                  <Text style={styles.statLabel}>items</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statNum}>{batchDetail?.scanCount ?? 0}</Text>
                  <Text style={styles.statLabel}>scans</Text>
                </View>
              </View>

              {baselineStatus === "pending" && (
                <Text style={styles.baselinePending}>Loading inventory baseline…</Text>
              )}
              {baselineStatus === "ready" && (
                <Text style={styles.baselineReady}>
                  Baseline: OEIVAL {String(batch.baselineFileDate ?? "").slice(0, 10)} ·{" "}
                  {batch.baselineItemCount} items
                </Text>
              )}
              {baselineStatus === "failed" && (
                <Text style={styles.baselineFailed}>
                  Baseline failed — {batch.baselineError}
                  {"\n"}Counts are still being saved. Variance needs the baseline.
                </Text>
              )}

              <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
                <Text style={styles.closeBtnText}>Close batch</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>Scan UPC</Text>
              <TextInput
                ref={inputRef}
                style={styles.scanInput}
                value={scanInput}
                onChangeText={setScanInput}
                onSubmitEditing={() => handleScan(scanInput)}
                autoFocus
                blurOnSubmit={false}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Scan or type a UPC"
                placeholderTextColor="#64748b"
              />

              <Text style={styles.label}>Quantity</Text>
              <View style={styles.qtyRow}>
                <TextInput
                  style={styles.qtyInput}
                  value={qty}
                  onChangeText={setQty}
                  keyboardType="number-pad"
                />
                {qty !== "1" && (
                  <View style={styles.qtyChip}>
                    <Text style={styles.qtyChipText}>Qty {qty}</Text>
                  </View>
                )}
                <TouchableOpacity onPress={() => setQty("1")}>
                  <Text style={styles.resetQty}>reset</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.hint}>
                Quantity stays put between scans so a stack counts fast.
              </Text>
            </View>

            {lastResult && (
              <View style={[styles.card, lastResult.matched ? styles.okCard : styles.warnCard]}>
                {lastResult.matched ? (
                  <>
                    <Text style={styles.okText}>
                      {lastResult.brand} {lastResult.model}
                    </Text>
                    <Text style={styles.muted}>{lastResult.size}</Text>
                    <Text style={styles.muted}>
                      Counted so far: {lastResult.runningQty}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.warnText}>Unknown UPC — saved</Text>
                    <Text style={styles.muted}>
                      It'll show in the report as unmatched. You can attach the
                      right tire now or leave it for the office.
                    </Text>
                    <TouchableOpacity
                      style={styles.findBtn}
                      onPress={() => setSearchOpen(true)}
                    >
                      <Text style={styles.findBtnText}>Find this tire</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}

            <Text style={styles.sectionTitle}>Last scans</Text>
            {(recentScans ?? []).map((s: any) => (
              <View key={s._id} style={[styles.scanRow, s.voided && styles.scanVoided]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.scanMain}>
                    {s.itemId ?? s.upc ?? s.rawBarcode}
                    {s.voided ? "  (voided)" : ""}
                  </Text>
                  <Text style={styles.scanSub}>
                    {s.brand ? `${s.brand} ${s.size ?? ""} · ` : ""}
                    {s.scannedByName}
                  </Text>
                </View>
                <Text style={styles.scanQty}>×{s.quantity}</Text>
                {!s.voided && actor && (
                  <TouchableOpacity
                    onPress={() => voidScan({ scanId: s._id, actor })}
                    style={styles.undoBtn}
                  >
                    <Text style={styles.undoText}>Undo</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <Modal visible={searchOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.cardTitle}>Find the tire</Text>
            <Text style={styles.muted}>
              Type what's on the sidewall — size, brand, model.
            </Text>
            <TextInput
              style={styles.scanInput}
              value={searchText}
              onChangeText={setSearchText}
              onSubmitEditing={runSearch}
              placeholder="e.g. 245/40R18 Michelin"
              placeholderTextColor="#64748b"
              autoFocus
            />
            <TouchableOpacity style={styles.primaryBtn} onPress={runSearch} disabled={searching}>
              {searching ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Search</Text>
              )}
            </TouchableOpacity>
            <ScrollView style={{ maxHeight: 260, marginTop: 12 }}>
              {searchResults.map((r) => (
                <TouchableOpacity
                  key={r.itemId}
                  style={styles.resultRow}
                  onPress={() => pickSearchResult(r)}
                >
                  <Text style={styles.scanMain}>
                    {r.brand} {r.model}
                  </Text>
                  <Text style={styles.scanSub}>
                    {r.sizeDesc} · {r.itemId}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity onPress={() => setSearchOpen(false)}>
              <Text style={styles.cancelText}>Skip for now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  header: { padding: 16, borderBottomWidth: 1, borderBottomColor: "#1e293b" },
  back: { color: "#60a5fa", fontSize: 15, fontWeight: "600", marginBottom: 6 },
  title: { color: "#fff", fontSize: 18, fontWeight: "700" },
  body: { padding: 12, paddingBottom: 40 },
  card: {
    backgroundColor: "#1e293b",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  okCard: { borderWidth: 1, borderColor: "#16a34a" },
  warnCard: { borderWidth: 1, borderColor: "#f59e0b" },
  cardTitle: { color: "#fff", fontSize: 16, fontWeight: "700", marginBottom: 6 },
  muted: { color: "#94a3b8", fontSize: 12, marginBottom: 4 },
  label: {
    color: "#cbd5e1",
    fontSize: 11,
    textTransform: "uppercase",
    marginTop: 8,
    marginBottom: 6,
  },
  hint: { color: "#64748b", fontSize: 11, marginTop: 6 },
  primaryBtn: {
    backgroundColor: "#2563eb",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    marginTop: 12,
  },
  primaryBtnText: { color: "#fff", fontWeight: "700" },
  closeBtn: {
    borderWidth: 1,
    borderColor: "#dc2626",
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
    marginTop: 12,
  },
  closeBtnText: { color: "#dc2626", fontWeight: "700" },
  statRow: { flexDirection: "row", marginTop: 12, gap: 20 },
  stat: { alignItems: "center" },
  statNum: { color: "#fff", fontSize: 20, fontWeight: "700" },
  statLabel: { color: "#64748b", fontSize: 10, textTransform: "uppercase" },
  baselinePending: { color: "#fbbf24", fontSize: 12, marginTop: 10 },
  baselineReady: { color: "#4ade80", fontSize: 12, marginTop: 10 },
  baselineFailed: { color: "#f87171", fontSize: 12, marginTop: 10 },
  scanInput: {
    backgroundColor: "#0f172a",
    color: "#fff",
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  qtyRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  qtyInput: {
    backgroundColor: "#0f172a",
    color: "#fff",
    borderRadius: 8,
    padding: 12,
    fontSize: 18,
    fontWeight: "700",
    width: 80,
    textAlign: "center",
    borderWidth: 1,
    borderColor: "#334155",
  },
  qtyChip: {
    backgroundColor: "#f59e0b",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  qtyChipText: { color: "#0f172a", fontWeight: "700", fontSize: 12 },
  resetQty: { color: "#60a5fa", fontSize: 12, fontWeight: "600" },
  okText: { color: "#4ade80", fontSize: 15, fontWeight: "700" },
  warnText: { color: "#fbbf24", fontSize: 15, fontWeight: "700", marginBottom: 4 },
  findBtn: {
    backgroundColor: "#f59e0b",
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
    marginTop: 10,
  },
  findBtnText: { color: "#0f172a", fontWeight: "700" },
  sectionTitle: {
    color: "#cbd5e1",
    fontSize: 12,
    textTransform: "uppercase",
    marginTop: 8,
    marginBottom: 8,
  },
  scanRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1e293b",
    borderRadius: 8,
    padding: 12,
    marginBottom: 6,
  },
  scanVoided: { opacity: 0.45 },
  scanMain: { color: "#fff", fontSize: 13, fontWeight: "600" },
  scanSub: { color: "#64748b", fontSize: 11 },
  scanQty: { color: "#fff", fontWeight: "700", marginHorizontal: 10 },
  undoBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  undoText: { color: "#60a5fa", fontSize: 12, fontWeight: "600" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#0f172a",
    padding: 20,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  resultRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#1e293b" },
  cancelText: {
    color: "#94a3b8",
    textAlign: "center",
    paddingVertical: 14,
    fontWeight: "600",
  },
});
```

- [ ] **Step 5: Verify typecheck**

Run: `cd ~/TireTrackLite && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
cd ~/TireTrackLite
git add src/screens/wms/WMSCountScreen.tsx src/screens/wms/WMSHomeScreen.tsx App.tsx convex/
git commit -m "feat(wms): Count screen on the scanner, gated on the inventory role

Keyboard-wedge UPC input matching the other WMS screens, a quantity that
persists between scans (with a visible chip so it can't be left set by
mistake), running totals, and soft-void undo. An unknown UPC is accepted
immediately and offers the sidewall search rather than blocking a counter
mid-aisle."
```

---

### Task 7: Admin — role option and the batch list

**Files:**
- Modify: `TireTrackAdmin/app/page.tsx` (role selects at ~1359 and ~1491, nav grid at ~421-451)
- Create: `TireTrackAdmin/app/wms/counts/page.tsx`
- Modify: `TireTrackAdmin/app/wms/page.tsx`

**Interfaces:**
- Consumes: `api.wms_count.getCountBatches`, `getOpenCountBatch`, `openCountBatch`, `closeCountBatch`, `getCountLocations`, `getCountAssignments`, `assignCountLocation`, `unassignCountLocation`.
- Produces: `/wms/counts` route; `inventory` selectable as a warehouse-user role; counting-location assignment UI.

- [ ] **Step 1: Add the Inventory role to both selects**

In `app/page.tsx`, the edit-user select currently reads:

```tsx
<option value="">Standard</option><option value="supervisor">Supervisor</option>
```

Make it:

```tsx
<option value="">Standard</option><option value="supervisor">Supervisor</option><option value="inventory">Inventory</option>
```

and update the adjacent help text to `Supervisors can access the Bonus Tracker. Inventory can run counts.`

In the add-user select:

```tsx
<option value="user">User</option><option value="supervisor">Supervisor</option>
```

becomes:

```tsx
<option value="user">User</option><option value="supervisor">Supervisor</option><option value="inventory">Inventory</option>
```

- [ ] **Step 2: Show the role on the user list**

Where `app/page.tsx` renders `{user.role === "supervisor" && (...)}`, add a sibling badge so Inventory users are identifiable:

```tsx
                          {user.role === "inventory" && (
                            <span className="px-2 py-0.5 rounded-full bg-ios-teal/15 text-ios-teal text-xs font-semibold">Inventory</span>
                          )}
```

If `ios-teal` is not a defined token in `tailwind.config`/`globals.css`, use `bg-ios-blue/15 text-ios-blue` instead — check before assuming.

- [ ] **Step 3: Add counting-location checkboxes to the user editor**

Granting a counter their locations must be a UI operation — `wms_user_assignments`
never got one and onboarding via CLI is not acceptable for real users.

In the edit-user modal in `app/page.tsx`, directly below the Role select, add a
block that appears only when the selected role is `inventory`:

```tsx
{editingUser.role === "inventory" && (
  <div>
    <label className="block text-ios-gray1 text-sm mb-2">Counting locations</label>
    <div className="space-y-2">
      {(countLocations ?? []).map((loc: any) => {
        const assigned = (countAssignments ?? []).some(
          (a: any) => a.userId === editingUser._id && a.locationCode === loc.code,
        );
        return (
          <label key={loc.code} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={assigned}
              onChange={async (e) => {
                if (!admin?._id) return;
                try {
                  if (e.target.checked) {
                    await assignCountLocation({
                      userId: editingUser._id,
                      locationCode: loc.code,
                      callerAdminId: admin._id as any,
                    });
                  } else {
                    await unassignCountLocation({
                      userId: editingUser._id,
                      locationCode: loc.code,
                      callerAdminId: admin._id as any,
                    });
                  }
                } catch (err: any) {
                  alert(err?.message ?? "Could not update assignment");
                }
              }}
            />
            <span className="text-[#1c1c1e]">
              {loc.label} ({loc.code})
            </span>
          </label>
        );
      })}
    </div>
    <p className="text-xs text-ios-gray1 mt-1">
      Without at least one location, this user can't open a count.
    </p>
  </div>
)}
```

Add the supporting hooks near the other `useQuery`/`useMutation` calls in that
component:

```tsx
  const countLocations = useQuery(api.wms_count.getCountLocations, {});
  const countAssignments = useQuery(api.wms_count.getCountAssignments, {});
  const assignCountLocation = useMutation(api.wms_count.assignCountLocation);
  const unassignCountLocation = useMutation(api.wms_count.unassignCountLocation);
```

- [ ] **Step 4: Add the nav link**

In the nav grid alongside `href="/wms"`, add a card linking to `/wms/counts` labelled **Inventory Counts**, copying the markup of the adjacent card exactly so the styling matches.

- [ ] **Step 5: Create the batch list page**

Create `TireTrackAdmin/app/wms/counts/page.tsx`:

```tsx
"use client";

import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import Link from "next/link";
import { Protected } from "../../protected";
import { useAuth } from "../../auth-context";

function CountsDashboard() {
  const { admin, canEdit } = useAuth();

  // Enabled locations come from convex/wms_count_locations.ts — the one place a
  // location code is named. Today that's W09 alone; the dropdown appears anyway
  // so enabling another location needs no UI change.
  const locations = useQuery(api.wms_count.getCountLocations, {});
  const [location, setLocation] = useState<string | null>(null);
  const active = location ?? locations?.[0]?.code ?? null;
  const activeLabel = locations?.find((l: any) => l.code === active)?.label ?? "";

  const batches = useQuery(
    api.wms_count.getCountBatches,
    active ? { warehouseCode: active } : "skip",
  );
  const openBatch = useQuery(
    api.wms_count.getOpenCountBatch,
    active ? { warehouseCode: active } : "skip",
  );
  const openCountBatch = useAction(api.wms_count.openCountBatch);
  const closeCountBatch = useMutation(api.wms_count.closeCountBatch);
  const [busy, setBusy] = useState(false);

  const actor = admin?._id
    ? ({ kind: "admin" as const, adminId: admin._id as any })
    : null;

  const fmt = (n?: number | null) =>
    typeof n === "number" ? n.toLocaleString() : "—";

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1c1c1e]">
            Inventory Counts{activeLabel ? ` — ${activeLabel}` : ""}
          </h1>
          <p className="text-ios-gray1 text-sm">
            Opening a batch freezes IECentral's on-hand figures so movement
            during the count can't skew variance. Tires only — non-tire
            product types are excluded.
          </p>
          {(locations?.length ?? 0) > 1 && (
            <select
              value={active ?? ""}
              onChange={(e) => setLocation(e.target.value)}
              className="mt-2 px-3 py-2 bg-white border border-ios-gray5 rounded-xl"
            >
              {(locations ?? []).map((l: any) => (
                <option key={l.code} value={l.code}>
                  {l.label} ({l.code})
                </option>
              ))}
            </select>
          )}
        </div>
        {canEdit && actor && active && !openBatch && (
          <button
            onClick={async () => {
              setBusy(true);
              try {
                await openCountBatch({ warehouseCode: active!, actor });
              } catch (e: any) {
                alert(e?.message ?? "Could not open batch");
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="px-4 py-2 bg-ios-blue text-white rounded-xl font-medium disabled:opacity-50"
          >
            {busy ? "Opening…" : "Open count batch"}
          </button>
        )}
      </div>

      {batches === undefined ? (
        <div className="text-ios-gray1">Loading…</div>
      ) : batches.length === 0 ? (
        <div className="p-8 text-center text-ios-gray1 bg-white rounded-2xl shadow-ios">
          No counts yet.
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-ios overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ios-gray6 text-ios-gray1 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">Opened</th>
                <th className="px-4 py-3 font-semibold">By</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Baseline</th>
                <th className="px-4 py-3 font-semibold text-right">Items</th>
                <th className="px-4 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b: any) => (
                <tr key={b._id} className="border-t border-ios-gray5">
                  <td className="px-4 py-3 text-[#1c1c1e]">
                    {new Date(b.openedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-ios-gray1">{b.openedByName}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        b.status === "open"
                          ? "bg-ios-green/15 text-ios-green"
                          : "bg-ios-gray5 text-ios-gray1"
                      }`}
                    >
                      {b.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {b.baselineStatus === "ready" ? (
                      <span className="text-ios-gray1">
                        OEIVAL {String(b.baselineFileDate ?? "").slice(0, 10)} ·{" "}
                        {fmt(b.baselineItemCount)} items
                        {b.baselineExcludedNonTires
                          ? ` · ${b.baselineExcludedNonTires} non-tire rows excluded`
                          : ""}
                      </span>
                    ) : b.baselineStatus === "pending" ? (
                      <span className="text-ios-orange">loading…</span>
                    ) : (
                      <span className="text-ios-red" title={b.baselineError}>
                        failed
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-[#1c1c1e]">
                    {fmt(b.baselineItemCount)}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Link
                      href={`/wms/counts/${b._id}`}
                      className="text-ios-blue font-medium hover:underline"
                    >
                      Reports
                    </Link>
                    {b.status === "open" && canEdit && actor && (
                      <button
                        onClick={async () => {
                          if (!confirm("Close this count batch?")) return;
                          try {
                            await closeCountBatch({ batchId: b._id, actor });
                          } catch (e: any) {
                            alert(e?.message ?? "Could not close");
                          }
                        }}
                        className="ml-4 text-ios-red font-medium hover:underline"
                      >
                        Close
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function CountsPage() {
  return (
    <Protected>
      <CountsDashboard />
    </Protected>
  );
}
```

**Before running:** confirm `ios-green`, `ios-gray6`, and `shadow-ios` are real tokens in this project by grepping an existing page (`app/wms/inventory/page.tsx`). Substitute the nearest existing token for any that is not.

- [ ] **Step 6: Link from the WMS page**

Add an "Inventory Counts" card to `app/wms/page.tsx` beside the existing Inventory/Transactions links, matching their markup.

- [ ] **Step 7: Verify**

```bash
cd ~/TireTrackAdmin && npx tsc --noEmit && npm run build
```
Expected: both clean, and `/wms/counts` appears in the route list.

- [ ] **Step 8: Commit**

```bash
cd ~/TireTrackAdmin
git add app/page.tsx app/wms/page.tsx app/wms/counts/page.tsx
git commit -m "feat(wms): Inventory role option and count batch list

Adds 'inventory' to the warehouse-user role select (the gate for the
scanner's Count screen) and a /wms/counts page listing batches with their
frozen-baseline provenance, including how many placeholder SKUs were
excluded so the exclusion is visible rather than hidden."
```

---

### Task 8: Admin — reports with CSV and PDF

**Files:**
- Create: `TireTrackAdmin/app/wms/counts/exports.ts`
- Create: `TireTrackAdmin/app/wms/counts/[id]/page.tsx`
- Modify: `TireTrackAdmin/package.json` (`jspdf`, `jspdf-autotable`)

**Interfaces:**
- Consumes: `api.wms_count.getCountBatch`, `getCountVariance`, `listCountScans`, `resolveUnmatchedUpc`, `searchIECentralTires`; `VarianceRow`/`VarianceSummary` types from `convex/wms_count_variance`.
- Produces: `downloadScannedCsv`, `downloadDiscrepancyCsv`, `downloadScannedPdf`, `downloadDiscrepancyPdf`.

- [ ] **Step 1: Install the PDF libraries**

```bash
cd ~/TireTrackAdmin && npm install jspdf jspdf-autotable
```

- [ ] **Step 2: Create the export builders**

Create `TireTrackAdmin/app/wms/counts/exports.ts`:

```ts
import type { VarianceRow, UnmatchedRow, VarianceSummary } from "../../../convex/wms_count_variance";

export type ReportHeader = {
  warehouseCode: string;
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

function download(name: string, body: string, mime: string) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const csv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\n");

/** Provenance lines repeated on every export so a file explains itself. */
function provenance(h: ReportHeader): string[][] {
  return [
    ["Warehouse", h.warehouseCode],
    ["Batch", h.batchId],
    ["Opened", new Date(h.openedAt).toLocaleString() + ` by ${h.openedByName}`],
    [
      "Closed",
      h.closedAt ? new Date(h.closedAt).toLocaleString() + ` by ${h.closedByName ?? ""}` : "still open",
    ],
    ["Baseline (OEIVAL file date)", h.baselineFileDate ?? "unknown"],
    [
      "Placeholder SKUs excluded",
      `${h.excludedNonTires ?? 0} items / ${(h.excludedUnits ?? 0).toLocaleString()} units`,
    ],
    ["Counters", h.counters.map((c) => `${c.name} (${c.units}u/${c.scans}s)`).join("; ")],
    [],
  ];
}

export function downloadScannedCsv(
  h: ReportHeader,
  rows: VarianceRow[],
  unmatched: UnmatchedRow[],
) {
  const body = [
    ...provenance(h),
    ["Item ID", "Brand", "Model", "Size", "MPN", "Counted Qty", "Scans"],
    ...rows
      .filter((r) => r.counted > 0)
      .map((r) => [r.itemId, r.brand, r.model, r.size, r.mpn, r.counted, r.scanCount]),
    [],
    ["Unmatched UPC", "Counted Qty", "Scans"],
    ...unmatched.map((u) => [u.upc, u.countedQty, u.scanCount]),
  ];
  download(`${stamp(h)}_scanned.csv`, csv(body), "text/csv");
}

const BUCKET_LABEL: Record<string, string> = {
  short: "Short (fewer on floor)",
  over: "Over (more on floor)",
  notFound: "Not found on floor",
  unexpected: "Unexpected (not in book)",
};

export function downloadDiscrepancyCsv(
  h: ReportHeader,
  rows: VarianceRow[],
  unmatched: UnmatchedRow[],
  summary: VarianceSummary,
) {
  const body: unknown[][] = [
    ...provenance(h),
    ["SUMMARY"],
    ["Baseline items", summary.baselineItems],
    ["Counted items", summary.countedItems],
    ["Matched", summary.matched],
    ["Short", summary.short],
    ["Over", summary.over],
    ["Not found on floor", summary.notFound],
    ["Unexpected", summary.unexpected],
    ["Unmatched UPCs", summary.unmatchedUpcs],
    ["Expected units", summary.expectedUnits],
    ["Counted units", summary.countedUnits],
    ["Net unit variance", summary.netUnitVariance],
    [],
  ];

  for (const bucket of ["short", "over", "notFound", "unexpected"] as const) {
    const group = rows.filter((r) => r.bucket === bucket);
    if (group.length === 0) continue;
    body.push([BUCKET_LABEL[bucket]]);
    body.push(["Item ID", "Brand", "Model", "Size", "MPN", "Expected", "Counted", "Variance"]);
    for (const r of group) {
      body.push([r.itemId, r.brand, r.model, r.size, r.mpn, r.expected, r.counted, r.variance]);
    }
    body.push(["Subtotal units", "", "", "", "", group.reduce((n, r) => n + r.expected, 0), group.reduce((n, r) => n + r.counted, 0), group.reduce((n, r) => n + r.variance, 0)]);
    body.push([]);
  }

  if (unmatched.length) {
    body.push(["Unmatched UPCs — not included in variance"]);
    body.push(["UPC", "Counted Qty", "Scans"]);
    for (const u of unmatched) body.push([u.upc, u.countedQty, u.scanCount]);
  }

  download(`${stamp(h)}_discrepancy.csv`, csv(body), "text/csv");
}

/**
 * PDF builders import jspdf dynamically so the ~150KB library never lands in
 * the initial bundle for a page that may not export anything.
 */
async function newPdf(landscape: boolean) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  return { doc: new jsPDF({ orientation: landscape ? "landscape" : "portrait" }), autoTable };
}

function pdfHeader(doc: any, h: ReportHeader, title: string) {
  doc.setFontSize(15);
  doc.text(`${title} — ${h.warehouseCode}`, 14, 16);
  doc.setFontSize(9);
  const lines = provenance(h)
    .filter((r) => r.length === 2)
    .map(([k, v]) => `${k}: ${v}`);
  doc.text(lines, 14, 23);
  return 23 + lines.length * 4 + 4;
}

export async function downloadScannedPdf(
  h: ReportHeader,
  rows: VarianceRow[],
  unmatched: UnmatchedRow[],
) {
  const { doc, autoTable } = await newPdf(false);
  let y = pdfHeader(doc, h, "Scanned Report");
  autoTable(doc, {
    startY: y,
    head: [["Item ID", "Brand", "Model", "Size", "Counted", "Scans"]],
    body: rows
      .filter((r) => r.counted > 0)
      .map((r) => [r.itemId, r.brand ?? "", r.model ?? "", r.size ?? "", r.counted, r.scanCount]),
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
  let y = pdfHeader(doc, h, "Discrepancy Report");

  autoTable(doc, {
    startY: y,
    head: [["Matched", "Short", "Over", "Not found", "Unexpected", "Unmatched UPCs", "Expected u", "Counted u", "Net u"]],
    body: [[summary.matched, summary.short, summary.over, summary.notFound, summary.unexpected, summary.unmatchedUpcs, summary.expectedUnits, summary.countedUnits, summary.netUnitVariance]],
    styles: { fontSize: 8 },
    headStyles: { fillColor: [0, 122, 255] },
  });

  for (const bucket of ["short", "over", "notFound", "unexpected"] as const) {
    const group = rows.filter((r) => r.bucket === bucket);
    if (group.length === 0) continue;
    autoTable(doc, {
      head: [[{ content: BUCKET_LABEL[bucket], colSpan: 8, styles: { halign: "left" } }],
             ["Item ID", "Brand", "Model", "Size", "MPN", "Expected", "Counted", "Variance"]],
      body: group.map((r) => [r.itemId, r.brand ?? "", r.model ?? "", r.size ?? "", r.mpn ?? "", r.expected, r.counted, r.variance]),
      styles: { fontSize: 7 },
      headStyles: { fillColor: [88, 86, 214] },
    });
  }

  if (unmatched.length) {
    autoTable(doc, {
      head: [[{ content: "Unmatched UPCs — not included in variance", colSpan: 3, styles: { halign: "left" } }],
             ["UPC", "Counted", "Scans"]],
      body: unmatched.map((u) => [u.upc, u.countedQty, u.scanCount]),
      styles: { fontSize: 7 },
      headStyles: { fillColor: [255, 149, 0] },
    });
  }

  doc.save(`${stamp(h)}_discrepancy.pdf`);
}
```

- [ ] **Step 3: Create the report page**

Create `TireTrackAdmin/app/wms/counts/[id]/page.tsx` with two tabs. It must:

- Read `useQuery(api.wms_count.getCountBatch, { batchId })` and `getCountVariance`.
- Render a provenance header: warehouse, opened/closed, **baseline OEIVAL file date**, counters, and the placeholder-exclusion line.
- **Scanned tab:** table of every item with `counted > 0` (itemId, brand, model, size, mpn, counted, scans), the per-counter panel, and `listCountScans` output with voided rows struck through.
- **Discrepancy tab:** if `baselineStatus !== "ready"`, render the baseline state and **hide the tab body** rather than showing misleading zeros. Otherwise four sections in order — Shorts, Overs, Not found on floor, Unexpected — each with a subtotal row, followed by Unmatched UPCs with an inline resolver (search box calling `searchIECentralTires`, pick an item, `also save UPC mapping` checkbox, submit → `resolveUnmatchedUpc` with `scope: "batch"`).
- Four export buttons wired to the Task 2 functions.
- Follow the `ios-*` token and `components/ui` conventions of `app/wms/inventory/page.tsx`.

- [ ] **Step 4: Verify**

```bash
cd ~/TireTrackAdmin && npx tsc --noEmit && npx vitest run && npm run build
```
Expected: all clean; `/wms/counts/[id]` in the route list.

- [ ] **Step 5: Commit**

```bash
cd ~/TireTrackAdmin
git add app/wms/counts package.json package-lock.json
git commit -m "feat(wms): scanned and discrepancy reports with CSV and PDF export

Both reports carry provenance -- the OEIVAL file date the baseline was
frozen from, who counted, and how many placeholder SKUs were excluded --
so a printed copy explains itself. jspdf is imported dynamically to keep
it out of the initial bundle. The discrepancy tab hides itself when the
baseline isn't ready rather than rendering misleading zeros."
```

---

### Task 9: End-to-end verification

**Files:** none.

- [ ] **Step 1: Full sweep**

```bash
cd ~/IECentral      && npx tsc --noEmit && npx vitest run
cd ~/TireTrackAdmin && npx tsc --noEmit && npx vitest run && npm run build
cd ~/TireTrackLite  && npx tsc --noEmit
```

- [ ] **Step 2: Deploy, in this order**

IECentral first — the Convex action depends on its endpoints existing.

1. Merge/deploy IECentral so `/api/inventory/*` is live; confirm the 401-without-token and the ≈480/5/4,968,000 numbers from Task 2 Step 6.
2. `npx convex env set` both variables, then `npx convex deploy` (needs the `wary-squirrel-295` key).
3. Merge TireTrackAdmin and let production build.
4. Publish the Lite OTA: `npx eas-cli update --branch preview --message "..."`. Field scanners are on channel `preview`, `runtimeVersion 2.0.1`, and auto-update on next launch.

- [ ] **Step 3: Grant the Inventory role and a counting location, in the UI**

Both are real UI operations now — no CLI, no Convex dashboard:

1. In Admin, edit the warehouse user and set **Role → Inventory**.
2. In the same editor, tick the counting location (Task 7 Step 3 adds this).

Verify the negative case too: a user with the Inventory role but **no** location
assignment sees "No counting locations" on the scanner and cannot open a batch.

- [ ] **Step 4: Live test at W09**

Record pass/fail with what was actually observed:

1. A `Standard` user does **not** see Count, **and** a direct `recordCountScan` is rejected server-side. A user with the Inventory role but no location assignment is rejected with "Not assigned to count at W09".
2. Open a batch. Baseline reaches `ready` with **≈480 items** and an OEIVAL file date matching the last upload. **If it reports ~485, the sentinel exclusion is not running** — stop and fix before counting.
3. Scan a known UPC with qty 1, then the same UPC with qty 8 — running total should read 9.
4. Scan an unknown UPC; confirm it saves as unmatched, then resolve it via sidewall search and confirm `tireUPCs` gained the mapping.
5. Undo a scan; confirm totals decrease and the row shows as voided rather than disappearing.
6. Hand-count one bin and confirm it matches the scanned report for those items.
7. Close the batch; confirm a closed batch rejects further scans.
8. Export all four files. Check the discrepancy report contains **no ~990,000-unit rows** — that is the regression that makes the whole report useless.

- [ ] **Step 5: Report honestly**

State which steps passed and which did not, with observed output. Do not report the feature complete unless steps 2, 4, 6, and 8 passed.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Token-authed `/api/inventory/snapshot` | 2 |
| Token-authed `/api/inventory/search` | 2 |
| Fails closed when token unset (503) | 2 |
| Tires only — productType T / 'T *' excluded | 1 |
| Not excluding on `dclass` | 1 (explicit test) |
| Exclusion counted and reported, not hidden | 1, 5, 7, 8 |
| Four Convex tables | 3 |
| Actor union + `authorizeCountActor` | 5 |
| Baseline frozen at open, chunked inserts | 5 |
| Scanning allowed while baseline pending/failed | 5, 6 |
| `retryBaseline` after failure | 5 |
| One open batch per warehouse, join-existing | 5 |
| Scan with quantity, 1..999 validation | 5, 6 |
| Totals maintained transactionally | 5 |
| Soft-void undo reversing totals | 5, 6 |
| Close blocks on empty batch | 5 |
| `resolveUnmatchedUpc` with scan/batch scope | 5 |
| Saves UPC→itemId into `tireUPCs` | 5 |
| Five variance buckets incl. `notFound` | 4 |
| Unmatched never folded into variance | 4 (test) |
| Count inside the existing Inventory tile | 6 |
| Gated on `inventory` role | 6, 7 |
| Keyboard-wedge input, qty persists | 6 |
| Sidewall search on unknown UPC | 6 |
| `inventory` role option in Admin | 7 |
| `/wms/counts` list + nav links | 7 |
| Scanned + discrepancy reports, sectioned | 8 |
| CSV + PDF, jspdf dynamic import | 8 |
| Discrepancy hidden when baseline not ready | 5 (query), 8 |
| No write-back to IECentral/JMK | by omission — no task writes there |
| W09 only at launch, location a parameter | 5 (`COUNT_LOCATIONS`), 6, 7 |
| Location selectable, extensible to other locations | 5, 6 (assignment-derived), 7 (dropdown) |
| Count access decoupled from the WMS pilot | 3 (`wms_count_assignments`), 5 |
| Admin UI to grant counting locations | 7 |
| Vitest on the variance function | 4 |
| `tsc` gate in all three repos | 9 |

No gaps.

**Placeholder scan:** Task 8 Step 3 specifies the report page as a structured requirement list rather than full JSX. That is a deliberate exception: it is a large presentational component built from primitives already shown in Tasks 7 and 8 Step 2, and every behavioural rule it must satisfy (section order, subtotals, the hide-when-not-ready rule, the resolver's exact mutation arguments) is stated explicitly. Two steps also require checking a fact before relying on it — that `ios-green`/`ios-gray6`/`ios-teal` tokens exist (Task 7) — because inventing a Tailwind token yields silently unstyled UI.

**Type consistency:** `computeVariance`'s exported types (`VarianceRow`, `UnmatchedRow`, `VarianceSummary`, `BaselineRow`, `TotalRow`, `Bucket`) are defined in Task 4 and imported by name in Task 8. `actorValidator` / `Actor` are defined once in Task 5 and used by every mutation there and both Admin pages. `SnapshotItem` fields (`itemId`, `qtyOnHand`, `brand`, `model`, `size`, `mpn`) match across Task 1's reader, Task 2's response, Task 5's `insertBaselineChunk` validator, and the `wms_count_baseline` schema in Task 3. `matchSource` literals (`upc`, `manual-search`, `resolved`, `unmatched`) match between the Task 3 schema and Task 5's writers. Env var names `IECENTRAL_SNAPSHOT_URL` / `IECENTRAL_SNAPSHOT_TOKEN` (Convex) and `INVENTORY_SNAPSHOT_TOKEN` (IECentral) are used consistently and are deliberately distinct — they live on different platforms.

**Location model.** W09 is the only entry in `COUNT_LOCATIONS` at launch, but no
screen, page or query names a location code — they all read that constant or the
user's own assignments. Enabling another location is one line plus ticking a box
per counter. This was tightened after the user noted counting is likely to replace
a manual count elsewhere, so the extensibility is a near-term requirement rather
than speculative generality.

**Count access is deliberately NOT `wms_user_assignments`.** Reusing the WMS
pilot's table would have made "can count at a retail store" depend on "is a
Chestnut Ridge warehouse-management user". `wms_count_assignments` keeps the two
independent, and Task 7 gives it the admin UI that `wms_user_assignments` never
got — so no CLI or Convex-dashboard step is needed to onboard a counter.
