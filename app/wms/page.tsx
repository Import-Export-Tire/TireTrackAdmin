"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Protected } from "../protected";
import {
  iOS,
  PageShell,
  TopBar,
  Card,
  PillButton,
  TextField,
  Sheet,
  GroupedList,
  GroupedRow,
} from "./_ui";

const WAREHOUSE_CODE = "W09";

const HEAT = [
  { min: 0, max: 0, fill: "#FFFFFF", label: "Empty" },
  { min: 0.0001, max: 0.25, fill: "#D1FAE5", label: "1–25%" },
  { min: 0.2501, max: 0.5, fill: "#FEF9C3", label: "26–50%" },
  { min: 0.5001, max: 0.75, fill: "#FED7AA", label: "51–75%" },
  { min: 0.7501, max: 1.1, fill: "#FECACA", label: "76–100%" },
];

function colorFor(percentFull: number): string {
  for (const b of HEAT) if (percentFull >= b.min && percentFull <= b.max) return b.fill;
  return "#FFFFFF";
}

const AGING_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export default function WMSDashboardPage() {
  return (
    <Protected>
      <Dashboard />
    </Protected>
  );
}

function Dashboard() {
  const config = useQuery(api.wms.getFloorConfig, { warehouseCode: WAREHOUSE_CODE });
  const occupancy = useQuery(api.wms.getFloorOccupancy, { warehouseCode: WAREHOUSE_CODE });
  const transactions = useQuery(api.wms.getRecentTransactions, {
    warehouseCode: WAREHOUSE_CODE,
    limit: 20,
  });
  const floorPlan = useQuery(api.wms.getFloorPlanImage, { warehouseCode: WAREHOUSE_CODE });

  const [search, setSearch] = useState("");
  const [agingOverlay, setAgingOverlay] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<Id<"wms_locations"> | null>(null);
  const [opacityOverride, setOpacityOverride] = useState<number | null>(null);
  const effectiveOpacity = opacityOverride ?? floorPlan?.opacity ?? 0.4;

  const matchingLocations = useQuery(
    api.wms.findUPC,
    search.trim() ? { upc: search.trim(), warehouseCode: WAREHOUSE_CODE } : "skip",
  );
  const matchSet = new Set((matchingLocations ?? []).map((m) => m.locationId as string));

  const stats = useMemo(() => {
    if (!occupancy) return { total: 0, occupied: 0, empty: 0, skus: 0, units: 0 };
    const occupied = occupancy.filter((l) => l.totalQuantity > 0).length;
    const skus = occupancy.reduce((acc, l) => acc + l.skuCount, 0);
    const units = occupancy.reduce((acc, l) => acc + l.totalQuantity, 0);
    return {
      total: occupancy.length,
      occupied,
      empty: occupancy.length - occupied,
      skus,
      units,
    };
  }, [occupancy]);

  return (
    <PageShell>
      <TopBar
        back={{ href: "/", label: "Admin" }}
        title="Chestnut Ridge"
        subtitle="Warehouse W09"
        trailing={
          <div style={{ display: "flex", gap: 8 }}>
            <PillButton href="/wms/floor-builder" variant="secondary">Floor builder</PillButton>
            <PillButton href="/wms/inventory" variant="secondary">Inventory</PillButton>
            <PillButton href="/wms/transactions" variant="secondary">Activity</PillButton>
            <PillButton href="/wms/counts" variant="secondary">Counts</PillButton>
          </div>
        }
      />

      <div style={{ padding: "0 24px 24px" }}>
        <StatsRow stats={stats} />

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", margin: "16px 0" }}>
          <TextField
            type="search"
            placeholder="Search UPC"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 280 }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: iOS.text2 }}>
            <input
              type="checkbox"
              checked={agingOverlay}
              onChange={(e) => setAgingOverlay(e.target.checked)}
              style={{ accentColor: iOS.accent }}
            />
            Aging overlay (30+ days)
          </label>
          {floorPlan?.url && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, color: iOS.text2 }}>Floor plan</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={effectiveOpacity}
                onChange={(e) => setOpacityOverride(Number.parseFloat(e.target.value))}
                style={{ accentColor: iOS.accent, width: 120 }}
              />
              <span style={{ fontSize: 12, color: iOS.text3, width: 32 }}>
                {Math.round(effectiveOpacity * 100)}%
              </span>
              {opacityOverride !== null && (
                <button
                  onClick={() => setOpacityOverride(null)}
                  style={{ background: "transparent", border: "none", color: iOS.accent, fontSize: 12, fontWeight: 500, cursor: "pointer" }}
                >
                  Reset
                </button>
              )}
            </div>
          )}
          <div style={{ flex: 1 }} />
          <HeatLegend />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16 }}>
          <Card>
            {!config && (
              <div style={{ color: iOS.text2, textAlign: "center", padding: 40, fontSize: 15 }}>
                Floor not configured —{" "}
                <Link href="/wms/floor-builder" style={{ color: iOS.accent }}>open Floor builder</Link>{" "}
                to lay out positions.
              </div>
            )}
            {config && occupancy && (
              <FloorSVG
                config={config}
                occupancy={occupancy}
                matchSet={matchSet}
                agingOverlay={agingOverlay}
                onSelect={(id) => setSelectedLocationId(id)}
                backdropUrl={floorPlan?.url ?? null}
                backdropOpacity={effectiveOpacity}
                backdropRotation={(floorPlan as any)?.rotation ?? 0}
                outline={(config as any).outline ?? undefined}
              />
            )}
          </Card>

          <Card padded={false} style={{ maxHeight: 700, overflowY: "auto" }}>
            <div style={{ padding: "16px 16px 8px", fontSize: 13, fontWeight: 600, color: iOS.text3, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Live activity
            </div>
            {!transactions && <div style={{ padding: 16, color: iOS.text2 }}>Loading…</div>}
            {transactions && transactions.length === 0 && (
              <div style={{ padding: 16, color: iOS.text2, fontSize: 14 }}>No activity yet.</div>
            )}
            {transactions?.map((t, idx) => (
              <TxRow key={t._id} tx={t} isLast={idx === transactions.length - 1} />
            ))}
          </Card>
        </div>
      </div>

      <PositionSheet locationId={selectedLocationId} onClose={() => setSelectedLocationId(null)} />
    </PageShell>
  );
}

function StatsRow({ stats }: { stats: { total: number; occupied: number; empty: number; skus: number; units: number } }) {
  const items = [
    { label: "Positions", value: stats.total },
    { label: "Occupied", value: stats.occupied },
    { label: "Empty", value: stats.empty },
    { label: "SKU rows", value: stats.skus },
    { label: "Units", value: stats.units },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
      {items.map((it) => (
        <Card key={it.label} style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: iOS.text3, textTransform: "uppercase", letterSpacing: 0.5 }}>
            {it.label}
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: iOS.text, letterSpacing: -0.3, marginTop: 2 }}>
            {it.value}
          </div>
        </Card>
      ))}
    </div>
  );
}

function HeatLegend() {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11 }}>
      {HEAT.map((b) => (
        <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 14, height: 14, background: b.fill, border: `1px solid ${iOS.separator}`, borderRadius: 4 }} />
          <span style={{ color: iOS.text2 }}>{b.label}</span>
        </div>
      ))}
    </div>
  );
}

interface FloorSVGProps {
  config: {
    gridWidth: number;
    gridHeight: number;
    dockX: number;
    dockY: number;
    aisles?: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  };
  occupancy: Array<{
    locationId: string;
    label: string;
    x: number;
    y: number;
    percentFull: number;
    totalQuantity: number;
    lastMovedAt: number;
  }>;
  matchSet: Set<string>;
  agingOverlay: boolean;
  onSelect: (id: Id<"wms_locations">) => void;
  backdropUrl?: string | null;
  backdropOpacity?: number;
  backdropRotation?: number;
  outline?: Array<{ x: number; y: number }>;
}

function FloorSVG({
  config,
  occupancy,
  matchSet,
  agingOverlay,
  onSelect,
  backdropUrl,
  backdropOpacity = 0.4,
  backdropRotation = 0,
  outline,
}: FloorSVGProps) {
  const containerMax = 1200;
  const cell = Math.floor(containerMax / Math.max(1, config.gridWidth));
  const w = cell * config.gridWidth;
  const h = cell * config.gridHeight;
  const now = Date.now();

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto", display: "block", borderRadius: 10 }}>
      {!backdropUrl && <rect x={0} y={0} width={w} height={h} fill={iOS.bg} />}
      {backdropUrl && (
        <g transform={`rotate(${backdropRotation} ${w / 2} ${h / 2})`}>
          <image
            href={backdropUrl}
            x={0}
            y={0}
            width={w}
            height={h}
            opacity={backdropOpacity}
            preserveAspectRatio="xMidYMid meet"
            pointerEvents="none"
          />
        </g>
      )}
      {(config.aisles ?? []).map((a, i) => (
        <line
          key={i}
          x1={a.x1 * cell + cell / 2}
          y1={a.y1 * cell + cell / 2}
          x2={a.x2 * cell + cell / 2}
          y2={a.y2 * cell + cell / 2}
          stroke={iOS.separator}
          strokeWidth={Math.max(2, cell * 0.06)}
          strokeLinecap="round"
        />
      ))}
      {occupancy.map((loc) => {
        const fill = colorFor(loc.percentFull);
        const matched = matchSet.has(loc.locationId);
        const aging =
          agingOverlay &&
          loc.totalQuantity > 0 &&
          loc.lastMovedAt > 0 &&
          now - loc.lastMovedAt > AGING_DAYS_MS;
        return (
          <g
            key={loc.locationId}
            transform={`translate(${loc.x * cell},${loc.y * cell})`}
            onClick={() => onSelect(loc.locationId as Id<"wms_locations">)}
            style={{ cursor: "pointer" }}
          >
            <rect
              x={3}
              y={3}
              width={cell - 6}
              height={cell - 6}
              fill={fill}
              fillOpacity={backdropUrl ? 0.65 : 1}
              stroke={matched ? iOS.accent : iOS.separator}
              strokeWidth={matched ? 2.5 : 1}
              rx={6}
            />
            {aging && (
              <rect
                x={3}
                y={3}
                width={cell - 6}
                height={cell - 6}
                fill="none"
                stroke={iOS.warn}
                strokeWidth={2}
                strokeDasharray="4 3"
                rx={6}
              >
                <animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite" />
              </rect>
            )}
            <text
              x={cell / 2}
              y={cell / 2 + 4}
              fontSize={Math.max(10, cell * 0.22)}
              textAnchor="middle"
              fill={iOS.text}
              fontWeight={600}
              fontFamily='-apple-system, "SF Pro Text"'
              style={{
                paintOrder: "stroke",
                stroke: backdropUrl ? "rgba(255,255,255,0.85)" : "transparent",
                strokeWidth: backdropUrl ? 3 : 0,
              }}
            >
              {loc.label}
            </text>
          </g>
        );
      })}
      {outline && outline.length >= 3 && (
        <path
          d={(() => {
            let d = `M ${outline[0].x * cell + cell / 2} ${outline[0].y * cell + cell / 2}`;
            for (let i = 1; i < outline.length; i++) {
              d += ` L ${outline[i].x * cell + cell / 2} ${outline[i].y * cell + cell / 2}`;
            }
            d += " Z";
            return d;
          })()}
          fill="none"
          stroke="#7C3AED"
          strokeWidth={3}
          strokeLinejoin="round"
          pointerEvents="none"
        />
      )}
      <g transform={`translate(${config.dockX * cell + cell / 2},${config.dockY * cell + cell / 2})`}>
        <circle r={Math.max(6, cell * 0.18)} fill={iOS.warn} stroke="#fff" strokeWidth={2} />
        <text
          x={0}
          y={Math.max(20, cell * 0.55)}
          textAnchor="middle"
          fontSize={11}
          fontWeight={700}
          fontFamily='-apple-system, "SF Pro Text"'
        >
          DOCK
        </text>
      </g>
    </svg>
  );
}

function TxRow({ tx, isLast }: { tx: any; isLast: boolean }) {
  const verb =
    {
      RECEIVE: "received",
      PUT_AWAY: "put away",
      MOVE: "moved",
      PICK: "picked",
      ADJUST: "adjusted",
      COUNT: "counted",
      LABEL_CREATE: "labeled",
    }[tx.type as string] ?? tx.type;
  const ago = formatAgo(Date.now() - tx.timestamp);
  return (
    <GroupedRow isLast={isLast}>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: iOS.text, fontSize: 14 }}>
          <span style={{ fontWeight: 600 }}>{tx.performedByName}</span>{" "}
          <span style={{ color: iOS.text2 }}>{verb}</span>{" "}
          <span style={{ fontWeight: 600 }}>{tx.quantity}×</span>{" "}
          <span style={{ color: iOS.text3, fontSize: 12 }}>{tx.upc}</span>
        </div>
        <div style={{ color: iOS.text3, fontSize: 11, marginTop: 2 }}>{ago}</div>
      </div>
    </GroupedRow>
  );
}

function formatAgo(ms: number): string {
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function PositionSheet({
  locationId,
  onClose,
}: {
  locationId: Id<"wms_locations"> | null;
  onClose: () => void;
}) {
  const contents = useQuery(api.wms.getLocationContents, locationId ? { locationId } : "skip");
  return (
    <Sheet
      open={!!locationId}
      onClose={onClose}
      title={contents?.location.label ?? "Position"}
      footer={
        locationId ? (
          <>
            <PillButton href={`/wms/inventory?location=${locationId}`} variant="secondary">Inventory</PillButton>
            <PillButton href={`/wms/transactions?locationId=${locationId}`}>History</PillButton>
          </>
        ) : null
      }
    >
      <div style={{ color: iOS.text2, fontSize: 14, marginBottom: 12 }}>
        {contents
          ? `${contents.totalQuantity} of ${contents.location.maxCapacity} · ${Math.round(contents.percentFull * 100)}% full`
          : "Loading…"}
      </div>
      <GroupedList>
        {(contents?.inventory ?? []).map((row, idx, arr) => (
          <GroupedRow key={row._id} isLast={idx === arr.length - 1}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{row.upc}</div>
              <div style={{ color: iOS.text2, fontSize: 13, marginTop: 2 }}>
                {[row.brand, row.size, row.description].filter(Boolean).join(" · ")}
              </div>
              <div style={{ color: iOS.text3, fontSize: 11, marginTop: 2 }}>
                {formatAgo(Date.now() - row.lastMovedAt)}
              </div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: iOS.accent, marginLeft: 12 }}>{row.quantity}</div>
          </GroupedRow>
        ))}
        {contents && contents.inventory.length === 0 && (
          <div style={{ padding: 16, textAlign: "center", color: iOS.text2 }}>Empty position</div>
        )}
      </GroupedList>
    </Sheet>
  );
}
