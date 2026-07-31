# W09 Inventory Count — scan-to-count with IECentral variance reporting

**Date:** 2026-07-31
**Repos touched:** TireTrackAdmin (Convex schema, batch/scan functions, reports),
TireTrackLite (scanner screens), IECentral (two new authed API endpoints)

## Problem

Physical inventory at W09 (Chestnut Ridge) has no tool. Counting means paper and
spreadsheets, and the resulting numbers are compared to JMK by hand — slow, and
the comparison is unreproducible once the next inventory file lands.

Two structural facts shape the whole design:

1. **IECentral has no UPC.** Its inventory is the OEIVAL cache in S3
   (`jmk-uploads/oeival/_cache/latest.items.ndjson.gz`), keyed on `itemId` with
   `qtyOnHand` per `location`. `W09` is a real OEIVAL location code
   (Chestnut Ridge, per `lib/locationLabels.ts`). The only UPC→`itemId` mapping
   that exists anywhere is TireTrack's own `tireUPCs.inventoryNumber`.
2. **OEIVAL is a once-a-day manual upload** (Vanessa/Sheila upload it; JMK has
   never used the inbound SFTP). So "inventory in IECentral" is a daily snapshot,
   not a live figure — which is exactly why the count needs a frozen baseline.

The UPC bridge is imperfect and always will be. The design treats an unmapped
UPC as an ordinary, expected event rather than an error.

## Goals

- A **Count** function on the TireTrack scanner: scan UPC, enter quantity, repeat.
- Visible only to warehouse users titled **Inventory**.
- Counts live inside an **open/close batch** whose comparison baseline is frozen
  at open, so mid-count inventory movement cannot contaminate the result.
- Compare counted quantities against IECentral's W09 on-hand.
- **Scanned report** and **discrepancy report** in TireTrackAdmin, each
  exportable as **CSV and PDF**.

## Non-goals

- **No write-back.** Closing a batch writes nothing to IECentral, JMK, or
  TireTrack's own `wms_inventory`. Corrections are made by a human from the
  report.
- No bin/location granularity. Counts roll up to the warehouse, matching what
  IECentral can actually verify (it has no bin concept).
- No support for warehouses other than W09 in this phase, though nothing in the
  schema is W09-specific.

## Where the code lives

`TireTrackAdmin/convex/` is the **source of truth** for the shared Convex
backend; a `post-commit` hook runs `~/sync-convex.sh` to copy `convex/` into
TireTrackLite. Both apps use deployment `wary-squirrel-295`.

**All Convex work is authored in TireTrackAdmin.** Editing
`TireTrackLite/convex/` directly gets overwritten by the next Admin commit.

## Architecture

```
TireTrackLite (scanner)          TireTrackAdmin (reports)
   Count screen                     /wms/counts
        │                                │
        └────────► Convex wary-squirrel-295 ◄────────┘
                    wms_count_batches
                    wms_count_baseline   ← frozen snapshot
                    wms_count_scans      ← audit trail
                    wms_count_totals     ← rollup for reports
                            │
                    Convex action (fetch)
                            │
                            ▼
              IECentral /api/inventory/snapshot?location=W09
                            │
                            ▼
              S3 latest.items.ndjson.gz (OEIVAL cache)
```

The baseline is pulled by a **Convex action**, not by TireTrackAdmin, so opening
a batch from the scanner works with no browser involved.

## IECentral: two new endpoints

Both live under `app/api/inventory/` and are **token-authed**:
`Authorization: Bearer ${INVENTORY_SNAPSHOT_TOKEN}`, compared with
`crypto.timingSafeEqual` on equal-length buffers, 401 on any mismatch or missing
header. If the env var is unset the route returns 503 — it fails closed rather
than becoming open.

These are new and narrow on purpose. The existing `/api/reports/*` routes are
unauthenticated; this design does not widen that surface or depend on it.

### `GET /api/inventory/snapshot?location=W09`

Streams the S3 cache the same way `app/api/reports/inventory-data/route.ts`
already does (`GetObjectCommand` → `createGunzip` → `readline`), reusing
`brandCodeToName` from `lib/brandMapping`. Keeps rows for the requested
`location` where `qtyOnHand !== 0`, aggregating by `itemId` (a location can have
multiple rows per item).

Cache field names, confirmed from
`aws/dunlop-reporter/lambdas/oeival_processor.py`: `location`, `itemId`,
`mfgItemId`, `description` (the size string), `model`, `manufacturerName`,
`qtyOnHand`.

Response:

```json
{
  "location": "W09",
  "fileDate": "2026-07-30",
  "generatedAt": "2026-07-31T04:12:00.000Z",
  "count": 3184,
  "items": [
    { "itemId": "...", "qtyOnHand": 12, "brand": "...",
      "model": "...", "size": "...", "mpn": "..." }
  ]
}
```

`maxDuration = 60`. If the cache meta is missing it returns 409 with the same
"cache hasn't been built yet" explanation the reports route gives, so the
scanner can say something true instead of failing opaquely.

### `GET /api/inventory/search?q=...`

Token-authed wrapper around the existing `searchTires()` in
`lib/oeivalBrandIndex.ts` (which searches brand + model + size + itemId, handles
`245/40R18` vs `2454018` normalisation, and dedupes). Returns
`{ results: TireSearchResult[] }`, capped at 40. Used for the sidewall lookup
when a scanned UPC is unknown.

**Measure first:** before building the scanner screen, call the snapshot endpoint
and record the real W09 row count. If in-stock W09 rows are only a few thousand,
widen the baseline to include `qtyOnHand === 0` rows too and serve the sidewall
lookup from the local `wms_count_baseline` table — dropping `/api/inventory/search`
and one network dependency. Report the measured number rather than guessing at it.

## Access control

TireTrackAdmin's warehouse-user editor (`app/page.tsx`, the Role `<select>` at
the "Standard / Supervisor" options) gains a third value: **`inventory`**.

- The **Inventory tile** on `HomeScreen` keeps its current gate —
  `getUserWarehouses(userId)` includes `"W09"`.
- The **Count** entry inside `WMSHomeScreen` additionally requires
  `effectiveRole === "inventory"`.

### The actor union

Batches are opened and closed from **both** the scanner and TireTrackAdmin, and
those are two different identity tables (`users` vs `adminUsers`). Every count
mutation therefore takes a discriminated actor rather than a bare user id:

```ts
actor: v.union(
  v.object({ kind: v.literal("user"),  userId:  v.id("users") }),
  v.object({ kind: v.literal("admin"), adminId: v.id("adminUsers") }),
)
```

A shared `authorizeCountActor(ctx, actor, warehouseCode)` helper resolves it and
throws otherwise:

- `kind: "user"` — requires `users.role === "inventory"` **and** a
  `wms_user_assignments` row for that warehouse.
- `kind: "admin"` — requires `adminUsers.role` of `"admin"` or `"superadmin"`,
  `isActive`, and the warehouse in `allowedLocations` (or `allowedLocations`
  empty, which the codebase already treats as all-locations).

It returns `{ performedBy: string, performedByName: string }`, matching how
`wms_transactions.performedBy` already stores a stringified id from either table.
`wms_count_batches.openedBy` / `closedBy` follow that same
`string` + `Name` convention rather than `id("users")`, so an admin-opened batch
is representable.

Client gating is convenience; `authorizeCountActor` is the boundary.

`HomeScreen` already re-fetches the live user via `getUserByEmpId` and updates
the cached session when `role` changes, so granting the title in Admin takes
effect on the scanner without a re-login. That path needs no change.

**Known consequence of a single-select role:** a user cannot be both Supervisor
and Inventory. If someone at W09 needs Bonus Tracker *and* Count, replace the
role value with an independent `canCount: optional(boolean)` — same gating logic,
one extra field, no other design change.

## Schema (TireTrackAdmin/convex/schema.ts)

### `wms_count_batches`

| Field | Type | Notes |
|---|---|---|
| `warehouseCode` | `string` | `"W09"` |
| `status` | `union("open","closed")` | |
| `openedBy` / `openedByName` | `string` / `string` | Stringified id from either identity table — see the actor union |
| `openedAt` | `number` | |
| `closedBy` / `closedByName` / `closedAt` | optional | |
| `baselineStatus` | `union("pending","ready","failed")` | |
| `baselineError` | `optional(string)` | Message shown in Admin and on the scanner |
| `baselineFileDate` | `optional(string)` | OEIVAL `fileDate` — makes the report self-describing |
| `baselineGeneratedAt` | `optional(string)` | Cache build time |
| `baselineItemCount` | `optional(number)` | |
| `notes` | `optional(string)` | |

Indexes: `by_warehouse_status`, `by_warehouse_openedAt`.

### `wms_count_baseline`

Frozen IECentral snapshot rows: `batchId`, `itemId`, `qtyOnHand`, `brand`,
`model`, `size`, `mpn`. Indexes: `by_batch`, `by_batch_item`.

Immutable after `baselineStatus` flips to `"ready"`. This is what makes a report
run in September reproduce exactly what it said in July.

### `wms_count_scans`

One row per scan event — the audit trail.

| Field | Type | Notes |
|---|---|---|
| `batchId` | `id("wms_count_batches")` | |
| `warehouseCode` | `string` | |
| `rawBarcode` | `string` | Exactly what the scanner emitted |
| `upc` | `optional(string)` | Normalised |
| `itemId` | `optional(string)` | **Absent = unmatched** |
| `quantity` | `number` | |
| `matchSource` | `union("upc","manual-search","resolved","unmatched")` | |
| `brand` / `model` / `size` | `optional(string)` | Denormalised for the report |
| `scannedBy` / `scannedByName` | `string` / `string` | Stringified id, as above |
| `scannedAt` | `number` | |
| `voided` / `voidedBy` / `voidedAt` | optional | Soft delete |

Indexes: `by_batch_scannedAt`, `by_batch_item`, `by_batch_upc`.

Undo is a **soft void**, never a delete — a miscount that vanishes is a
miscount nobody can explain later.

### `wms_count_totals`

Rollup, one row per counted thing:

| Field | Type | Notes |
|---|---|---|
| `batchId` | `id("wms_count_batches")` | |
| `itemId` | `optional(string)` | Set for matched scans |
| `upc` | `optional(string)` | Set for unmatched scans |
| `countedQty` | `number` | |
| `scanCount` | `number` | Non-voided scans contributing |
| `lastScannedAt` | `number` | |

**Exactly one of `itemId` / `upc` is set** — matched totals key on `itemId`,
unmatched totals key on `upc`. Enforced in the upsert helper, not by the
validator. Indexes: `by_batch`, `by_batch_item`, `by_batch_upc`.

Deliberately not a sentinel empty string: a report that groups on `itemId === ""`
is one typo away from silently merging every unmatched UPC into a single phantom
item.

**Why this table exists:** reports must never `collect()` the raw scan rows. A
full W09 count is plausibly 5–15k scans, and unbounded `collect()` is a known
scaling trap in this codebase. Totals are maintained in the same transaction as
the scan insert, so reports read a few thousand rows instead of tens of
thousands. Raw scans are read only by the scan-level view, which paginates.

## Convex functions — `convex/wms_count.ts` (new file)

A separate file rather than growing `wms.ts` (891 lines already).

### `openCountBatch` — action

1. Calls internal mutation `createBatch` — validates the caller's role and
   warehouse assignment, rejects if an `open` batch already exists for the
   warehouse (returning that batch's id so the UI can offer to join it), inserts
   with `baselineStatus: "pending"`.
2. `fetch`es `/api/inventory/snapshot?location=<warehouseCode>` with the bearer
   token from `process.env.IECENTRAL_SNAPSHOT_TOKEN`.
3. Inserts baseline rows via internal mutation in **500-row chunks** to stay
   inside Convex transaction limits.
4. Sets `baselineStatus: "ready"`, `baselineItemCount`, `baselineFileDate`,
   `baselineGeneratedAt`.

On any failure: `baselineStatus: "failed"` with `baselineError`. The batch stays
open and scannable — see below. A `retryBaseline` action re-runs steps 2–4 for a
failed batch, deleting any partial rows first.

### `recordCountScan` — mutation

```ts
args: {
  batchId, rawBarcode, quantity, actor,
  itemIdOverride?: string,   // set by the sidewall-search flow
}
```

1. `authorizeCountActor`, plus batch `status === "open"`.
2. Reject `quantity` outside `1..999` or non-integer.
3. Normalise `rawBarcode` → `upc` (trim, strip non-digits, keep the raw form).
4. Resolve `itemId`: `itemIdOverride` if given (`matchSource: "manual-search"`),
   else `tireUPCs.by_upc` → `inventoryNumber` (`matchSource: "upc"`), else
   unmatched.
5. Insert the scan row; upsert `wms_count_totals` in the same transaction.
6. Return `{ scanId, itemId, matched, brand, model, size, runningQty }` so the
   screen can confirm what was counted without a second round-trip.

Scanning is **permitted while `baselineStatus` is `"pending"` or `"failed"`** —
the floor must never wait on S3. Variance reporting requires `"ready"`.

### `voidCountScan` — mutation

Sets `voided` and decrements `wms_count_totals` in the same transaction.
Idempotent: voiding an already-voided scan is a no-op.

### `closeCountBatch` — mutation

Authorise, set `status: "closed"` with `closedBy`/`closedByName`/`closedAt`.
Blocks with an explanatory error if the batch has zero non-voided scans, so a
batch cannot be closed by accident before anyone has counted.

### `resolveUnmatchedUpc` — mutation

Called from **both** surfaces — the scanner's sidewall-search flow and the
Admin discrepancy report — so it takes the actor union, not an admin id.

```ts
args: {
  batchId,
  upc: string,
  itemId: string,
  alsoSaveMapping: boolean,
  scope: v.union(v.literal("batch"), v.literal("scan")),
  scanId: v.optional(v.id("wms_count_scans")),   // required when scope === "scan"
  actor,
}
```

Re-attributes unmatched scans of that `upc` to `itemId`
(`matchSource: "resolved"`), rebuilds the affected `wms_count_totals` rows —
decrementing the `upc`-keyed row and incrementing the `itemId`-keyed one, deleting
the `upc` row when it reaches zero — and, when `alsoSaveMapping`, upserts
`tireUPCs` so the UPC is known forever after.

`scope` exists because the two callers mean different things. The scanner resolves
**the scan just taken** (`"scan"`), because the counter is looking at one tire and
should not retroactively relabel earlier scans of the same barcode they may have
attributed differently. Admin resolves **every unmatched scan of that UPC in the
batch** (`"batch"`), because it is cleaning up a data gap wholesale.

This is what lets the variance report correct itself instead of carrying a
permanent unmatched bucket.

### Queries

- `getOpenCountBatch({ warehouseCode })` — scanner banner.
- `getCountBatches({ warehouseCode })` — Admin list.
- `getCountBatch({ batchId })` — header, baseline status, counter breakdown.
- `getCountTotals({ batchId })` — joined against `wms_count_baseline`; the input
  to both reports.
- `listCountScans({ batchId, paginationOpts })` — paginated raw scans.
- `searchBaseline({ batchId, q })` — sidewall lookup against the local baseline,
  used instead of the IECentral search endpoint if the measurement above shows
  the full W09 catalog is small enough to store.

## Variance computation — `lib/countVariance.ts` (TireTrackAdmin)

A **pure function**, deliberately extracted, because it is the one place where a
silent bug produces a confidently wrong report that someone acts on.

```ts
type VarianceRow = {
  itemId: string;
  brand?: string; model?: string; size?: string; mpn?: string;
  expected: number;      // baseline qtyOnHand
  counted: number;       // rolled-up countedQty
  variance: number;      // counted - expected
  bucket: "short" | "over" | "notFound" | "unexpected" | "match";
};

export function computeVariance(
  baseline: BaselineRow[],
  totals: TotalRow[],
): { rows: VarianceRow[]; unmatched: UnmatchedRow[]; summary: Summary };
```

Buckets, from the **full outer join** of baseline and totals:

| Bucket | Condition | Meaning |
|---|---|---|
| `match` | `counted === expected` | Excluded from the discrepancy report |
| `short` | `0 < counted < expected` | Fewer on the floor than the book |
| `over` | `counted > expected` | More on the floor than the book |
| `notFound` | `expected > 0`, `counted === 0` | In the book, never scanned |
| `unexpected` | `counted > 0`, no baseline row | On the floor, not in the book |

`unmatched` is a separate list keyed by `upc` — scans with no `itemId`. It is
reported alongside but **never folded into variance**, because attributing an
unknown UPC to an item would fabricate a number.

`notFound` deserves emphasis: it is the bucket a naive implementation misses,
and it is where real shrink shows up.

Summary carries counts and total unit deltas per bucket, plus a per-counter
breakdown from the scan rows.

## TireTrackLite: `WMSCountScreen.tsx`

Added to `src/screens/wms/`. `WMSHomeScreen`'s `WMSScreen` union gains
`"wmsCount"`; `App.tsx`'s `Screen` union and switch gain the same, with
`onBack={() => navigate("wms")}` like its siblings.

The Count button on `WMSHomeScreen` renders only when
`effectiveRole === "inventory"`.

**Screen structure:**

1. **Batch banner.** No open batch → a single `Open count batch` button. Open
   batch → batch label, opened-by/at, live total units and item count, and a
   `Close batch` button behind a confirmation naming the totals.
2. **Baseline status line.** `Loading inventory baseline…` while pending,
   `Baseline: OEIVAL 2026-07-30 · 3,184 items` when ready, or a red
   `Baseline failed — <reason>` with a `Retry` action. Scanning is enabled in all
   three states; the failed state adds `Counts are being saved. Variance needs
   the baseline.`
3. **Scan row.** A `TextInput` with `autoFocus` and `blurOnSubmit={false}`,
   committing on `onSubmitEditing` — the keyboard-wedge pattern already used by
   `WMSPutAwayScreen`, which is how the TC51 DataWedge scanners feed input.
4. **Quantity field.** Numeric, **defaults to 1**, sits beside the scan input,
   and **persists between scans** so counting a stack of 8s doesn't mean
   re-typing 8. A visible `Qty 8` chip prevents the obvious hazard of leaving it
   set by mistake, and it resets to 1 on batch open.
5. **Confirmation area.** Last scan resolved: brand / model / size, quantity, and
   the running counted total for that item. Unmatched scans show
   `Unknown UPC — saved` in amber with a `Find this tire` button.
6. **Last 10 scans** list, each with `Undo` (soft void).

**Unknown UPC flow** — accepted immediately, never blocking:

The scan is recorded as unmatched the moment it is entered. `Find this tire`
opens a search sheet (`searchBaseline`, or `/api/inventory/search` via a Convex
action) where the counter types what is on the sidewall — `245/40R18 Michelin` —
and picks a match. Picking calls `resolveUnmatchedUpc` with `scope: "scan"` for
the scan just taken, and offers `Save this UPC for next time`
(`alsoSaveMapping`), which writes `tireUPCs`.

Skipping the search is a first-class choice. The scan is already saved, and Admin
can resolve it later.

**Offline:** out of scope for this phase. Convex's client queues mutations while
disconnected and W09 has warehouse wifi. If counting in a dead zone turns out to
matter, the returns condition-photo outbox is the pattern to copy.

## TireTrackAdmin: reports

### `/wms/counts` — batch list

Batch, status, opened/closed by and at, scan count, baseline file date and
status. Open/close controls for admins. Links into the detail page. Added to the
nav grid in `app/page.tsx` and to `app/wms/page.tsx`, following the existing
`ios-*` card styling and `components/ui` primitives.

### `/wms/counts/[id]` — two tabs

**Scanned report** — every item counted: itemId, brand, model, size, mpn,
counted qty, scan count, last scanned. Plus a per-counter panel (who scanned how
many units / items) and a paginated raw-scan view showing voided rows struck
through.

**Discrepancy report** — sectioned in this order, each with its own subtotal:

1. **Shorts** — descending by absolute variance
2. **Overs**
3. **Not found on floor** — expected > 0, counted 0
4. **Unexpected** — counted, not in the book
5. **Unmatched UPCs** — with an inline resolver: a search box over the baseline,
   pick an item, checkbox for `also save UPC mapping`, submit → the report
   recomputes

The header states the baseline's OEIVAL `fileDate`, the batch open/close times,
and the counter list, so a printed report explains itself without the app.

### Exports

**CSV** follows the existing hand-rolled pattern in `app/reports/page.tsx` and
`app/wms/inventory/page.tsx` (`Blob` + `a.download`), with `"` doubled for
escaping as `app/reports/page.tsx:828` already does. Filenames:
`w09_count_<batch>_scanned_<YYYY-MM-DD>.csv` and `..._discrepancy_....csv`.

**PDF** adds `jspdf` + `jspdf-autotable` to TireTrackAdmin (no PDF library
today). Both reports render as a titled document: header block (warehouse,
batch, baseline file date, open/close, counters), then `autoTable` per section
with repeated headers across page breaks, then a summary block. Landscape for the
discrepancy report — it has more columns. Imported **dynamically** inside the
export handler so the bundle isn't inflated for every page load, matching the
concern already logged about eager `xlsx`/`recharts` imports.

## Error handling

| Case | Behaviour |
|---|---|
| Snapshot endpoint 401 | `baselineStatus: "failed"`, error names the token as the likely cause. Scanning continues. |
| Snapshot 409 (cache not built) | `failed` with the cache explanation surfaced verbatim to the scanner. |
| Snapshot timeout / S3 error | `failed`; `Retry` re-runs cleanly after deleting partial rows. |
| Second open batch attempted | Rejected; returns the existing batch id so the UI offers to join it. |
| Scan into a closed batch | Rejected with `"This batch is closed"`. |
| Non-integer / out-of-range qty | Rejected client- and server-side. |
| Same UPC scanned repeatedly | Allowed and additive — that is how counting works. Totals accumulate; the scan list shows each event. |
| Void of an already-voided scan | No-op. |
| Variance requested while baseline not ready | Report page shows the baseline state and hides the discrepancy tab rather than rendering misleading zeros. |
| OEIVAL file changes mid-count | Irrelevant by construction — the baseline is frozen. The report states the file date it used. |

## Testing

`npx tsc --noEmit` is the gate in both TireTrack repos, and neither has a test
runner today.

- **Add `vitest` to TireTrackAdmin** covering `lib/countVariance.ts` only:
  each of the five buckets, empty baseline, empty totals, `counted === expected`
  exclusion, unmatched kept out of variance, and a mixed fixture asserting
  summary subtotals. This is the highest-risk logic and it is pure, so it is
  cheap to test properly.
- `tsc --noEmit` clean in TireTrackAdmin, TireTrackLite, and IECentral.
- IECentral endpoints: verify 401 on missing/incorrect token, 503 when the env
  var is unset, and a correct `count`/`fileDate` for `location=W09`.
- Live scanner pass at W09: open a batch, confirm the baseline loads and its file
  date matches the last OEIVAL upload; scan a known UPC with qty > 1; scan an
  unknown UPC and resolve it via sidewall search; undo a scan; close the batch;
  export all four files and check the discrepancy totals against a hand count of
  a single known bin.
- Access check: a `Standard` user cannot see the Count button **and** their
  `recordCountScan` call is rejected server-side.

## Decisions

**Baseline frozen at batch open.** OEIVAL lands once a day by manual upload, so
a report computed against "current" inventory would silently change depending on
when it ran. Freezing makes the variance reproducible and lets the report state
which file it judged against.

**Reports only, no write-back.** A physical count is an assertion about reality
that a human should adjudicate before it touches the book of record. Writing
adjustments automatically means one bad count corrupts JMK.

**One open batch per warehouse, many counters.** Multiple people counting into
one batch is how a real inventory day runs, and it makes two competing
half-counts impossible. Per-scan attribution preserves accountability.

**Unmatched UPCs accepted, never blocking.** The UPC→itemId bridge lives in
`tireUPCs` and will always have gaps. Blocking the scan stops a counter mid-aisle
over a data problem someone else has to fix. Recording it and resolving it in
Admin loses nothing and the resolver improves `tireUPCs` permanently.

**Count added inside the existing Inventory tile.** A second tile also named
Inventory would be ambiguous on a 2-column scanner grid, and the WMS home screen
is already the right container.

**`wms_count_totals` maintained transactionally.** Deriving totals by collecting
raw scans at report time would work at 500 scans and fail at 15,000. Paying one
extra write per scan buys reports that stay fast for the life of the feature.
