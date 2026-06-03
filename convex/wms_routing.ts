// WMS routing & put-away scoring helpers.
//
// Pure functions only — no Convex query/mutation context. Imported by
// convex/wms.ts queries (getPickRoute, getSuggestedPutAway).

export type RoutingLocation = {
  _id: string;
  x: number;
  y: number;
  zone: string;
  label: string;
  maxCapacity: number;
};

export type RoutingInventory = {
  locationId: string;
  upc: string;
  quantity: number;
  brand?: string;
  size?: string;
};

export type PickItem = {
  locationId: string;
  upc: string;
  quantity: number;
};

function euclidean(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

// Nearest-neighbor TSP from the dock. Returns the picks in walking order plus
// the total estimated distance (grid units). When the same locationId appears
// multiple times in the input it is visited once and the picks at that stop
// are kept adjacent.
export function optimizePickRoute(
  picks: PickItem[],
  locations: RoutingLocation[],
  dockX: number,
  dockY: number,
): { route: PickItem[]; estimatedDistance: number } {
  if (picks.length === 0) return { route: [], estimatedDistance: 0 };

  const locById = new Map(locations.map((l) => [l._id, l]));

  // Group picks by location so each stop is visited once.
  const stops = new Map<string, PickItem[]>();
  for (const p of picks) {
    const list = stops.get(p.locationId) ?? [];
    list.push(p);
    stops.set(p.locationId, list);
  }

  const unvisited = new Set(stops.keys());
  const route: PickItem[] = [];
  let totalDistance = 0;
  let curX = dockX;
  let curY = dockY;

  while (unvisited.size > 0) {
    let nearestId: string | null = null;
    let nearestDist = Infinity;
    for (const id of unvisited) {
      const loc = locById.get(id);
      if (!loc) continue;
      const d = euclidean(curX, curY, loc.x, loc.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearestId = id;
      }
    }
    if (!nearestId) break;

    const loc = locById.get(nearestId)!;
    totalDistance += nearestDist;
    curX = loc.x;
    curY = loc.y;
    for (const p of stops.get(nearestId)!) route.push(p);
    unvisited.delete(nearestId);
  }

  return { route, estimatedDistance: totalDistance };
}

export type ScoredLocation = {
  locationId: string;
  label: string;
  zone: string;
  score: number;
  reason: "same SKU" | "near dock" | "empty zone" | "similar family";
  currentQuantity: number;
  remainingCapacity: number;
};

// Score put-away locations. Filters out anything that would exceed maxCapacity
// once incomingQuantity is added. Returns top 3 by score.
export function scorePutAwayLocations(
  upc: string,
  incomingQuantity: number,
  brand: string | undefined,
  size: string | undefined,
  locations: RoutingLocation[],
  inventory: RoutingInventory[],
  dockX: number,
  dockY: number,
): ScoredLocation[] {
  // Aggregate current quantity per location.
  const quantityByLoc = new Map<string, number>();
  const upcsAtLoc = new Map<string, Set<string>>();
  const familyAtLoc = new Map<string, Set<string>>();
  for (const inv of inventory) {
    quantityByLoc.set(
      inv.locationId,
      (quantityByLoc.get(inv.locationId) ?? 0) + inv.quantity,
    );
    if (!upcsAtLoc.has(inv.locationId)) upcsAtLoc.set(inv.locationId, new Set());
    upcsAtLoc.get(inv.locationId)!.add(inv.upc);
    const fam = `${inv.brand ?? ""}|${inv.size ?? ""}`;
    if (!familyAtLoc.has(inv.locationId)) familyAtLoc.set(inv.locationId, new Set());
    familyAtLoc.get(inv.locationId)!.add(fam);
  }

  // Aggregate zone fill % to penalize crowded zones.
  const zoneCapacity = new Map<string, { current: number; max: number }>();
  for (const l of locations) {
    const z = zoneCapacity.get(l.zone) ?? { current: 0, max: 0 };
    z.max += l.maxCapacity;
    z.current += quantityByLoc.get(l._id) ?? 0;
    zoneCapacity.set(l.zone, z);
  }

  const incomingFamily = `${brand ?? ""}|${size ?? ""}`;
  const scored: ScoredLocation[] = [];

  for (const loc of locations) {
    const currentQty = quantityByLoc.get(loc._id) ?? 0;
    const remaining = loc.maxCapacity - currentQty;
    if (remaining < incomingQuantity) continue; // skip — would overflow

    let score = 0;
    let reason: ScoredLocation["reason"] = "near dock";

    const upcs = upcsAtLoc.get(loc._id);
    const families = familyAtLoc.get(loc._id);

    if (upcs?.has(upc)) {
      score += 100;
      reason = "same SKU";
    } else if (
      incomingFamily !== "|" &&
      families?.has(incomingFamily)
    ) {
      score += 50;
      reason = "similar family";
    } else if (currentQty === 0) {
      // Empty position gets a small base bonus so the suggestion makes sense
      // even when there's no consolidation candidate.
      score += 10;
      reason = "empty zone";
    }

    // Distance-from-dock: closer is better. Capped so very-distant positions
    // don't go strongly negative.
    const dist = euclidean(dockX, dockY, loc.x, loc.y);
    score += Math.max(0, 50 - dist);

    // Penalize zones >80% full.
    const z = zoneCapacity.get(loc.zone);
    if (z && z.max > 0 && z.current / z.max > 0.8) {
      score -= 20;
    }

    scored.push({
      locationId: loc._id,
      label: loc.label,
      zone: loc.zone,
      score,
      reason,
      currentQuantity: currentQty,
      remainingCapacity: remaining,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3);
}
