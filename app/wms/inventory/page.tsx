"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import React, { useMemo, useState } from "react";
import { Protected } from "../../protected";
import { useAuth } from "../../auth-context";
import { iOS, PageShell, TopBar, Card, PillButton, TextField, Select, Sheet, labelStyle } from "../_ui";

const WAREHOUSE_CODE = "W09";
type SortKey = "oldest" | "quantity" | "brand";

export default function InventoryPage() {
  return (
    <Protected>
      <Inventory />
    </Protected>
  );
}

function Inventory() {
  const { admin } = useAuth();
  const inventory = useQuery(api.wms.getAllInventory, { warehouseCode: WAREHOUSE_CODE });
  const adjustInventory = useMutation(api.wms.adjustInventory);

  const [search, setSearch] = useState("");
  const [zoneFilter, setZoneFilter] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("oldest");
  const [editing, setEditing] = useState<{
    upc: string;
    locationId: Id<"wms_locations">;
    locationLabel: string;
    current: number;
  } | null>(null);

  const zones = useMemo(() => {
    const set = new Set<string>();
    (inventory ?? []).forEach((r) => set.add(r.zone));
    return Array.from(set).sort();
  }, [inventory]);

  const filtered = useMemo(() => {
    let rows = inventory ?? [];
    if (zoneFilter) rows = rows.filter((r) => r.zone === zoneFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          r.upc.toLowerCase().includes(q) ||
          (r.brand ?? "").toLowerCase().includes(q) ||
          (r.size ?? "").toLowerCase().includes(q) ||
          (r.description ?? "").toLowerCase().includes(q) ||
          r.locationLabel.toLowerCase().includes(q),
      );
    }
    const sorted = [...rows];
    if (sortKey === "oldest") sorted.sort((a, b) => a.receivedAt - b.receivedAt);
    else if (sortKey === "quantity") sorted.sort((a, b) => b.quantity - a.quantity);
    else if (sortKey === "brand") sorted.sort((a, b) => (a.brand ?? "").localeCompare(b.brand ?? ""));
    return sorted;
  }, [inventory, search, zoneFilter, sortKey]);

  function exportCSV() {
    const headers = ["UPC", "Description", "Brand", "Size", "Location", "Zone", "Quantity", "ReceivedAt", "DaysInWarehouse"];
    const csv = [
      headers.join(","),
      ...filtered.map((r) =>
        [
          r.upc,
          q(r.description),
          q(r.brand ?? ""),
          q(r.size ?? ""),
          r.locationLabel,
          r.zone,
          r.quantity,
          new Date(r.receivedAt).toISOString(),
          Math.floor((Date.now() - r.receivedAt) / 86_400_000),
        ].join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wms_inventory_${WAREHOUSE_CODE}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleAdjust(newQty: number, reason: string) {
    if (!editing || !admin) return;
    await adjustInventory({
      upc: editing.upc,
      locationId: editing.locationId,
      newQuantity: newQty,
      reason,
      userId: admin.id,
      userName: admin.name,
    });
    setEditing(null);
  }

  return (
    <PageShell>
      <TopBar
        back={{ href: "/wms", label: "Floor" }}
        title="Inventory"
        subtitle={`${filtered.length} row${filtered.length === 1 ? "" : "s"}`}
        trailing={<PillButton onClick={exportCSV} variant="secondary">Export CSV</PillButton>}
      />

      <div style={{ padding: "0 24px 24px" }}>
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={labelStyle}>Search</div>
              <TextField wide type="search" placeholder="UPC, brand, size, location…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div>
              <div style={labelStyle}>Zone</div>
              <Select value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
                <option value="">All</option>
                {zones.map((z) => <option key={z} value={z}>{z}</option>)}
              </Select>
            </div>
            <div>
              <div style={labelStyle}>Sort</div>
              <Select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                <option value="oldest">Oldest first</option>
                <option value="quantity">Highest quantity</option>
                <option value="brand">Brand A→Z</option>
              </Select>
            </div>
          </div>
        </Card>

        <Card padded={false}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: iOS.bg }}>
                <Th>UPC</Th>
                <Th>Description</Th>
                <Th>Brand</Th>
                <Th>Size</Th>
                <Th>Location</Th>
                <Th align="right">Qty</Th>
                <Th align="right">Days</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {!inventory && <tr><Td colSpan={8} center>Loading…</Td></tr>}
              {inventory && filtered.length === 0 && <tr><Td colSpan={8} center muted>No inventory matches.</Td></tr>}
              {filtered.map((r, idx) => (
                <tr key={r.inventoryId} style={{ borderTop: idx === 0 ? "none" : `1px solid ${iOS.separator}` }}>
                  <Td mono>{r.upc}</Td>
                  <Td>{r.description}</Td>
                  <Td>{r.brand ?? ""}</Td>
                  <Td>{r.size ?? ""}</Td>
                  <Td bold>{r.locationLabel}</Td>
                  <Td align="right" bold>{r.quantity}</Td>
                  <Td align="right" muted>{Math.floor((Date.now() - r.receivedAt) / 86_400_000)}</Td>
                  <Td>
                    <button
                      onClick={() =>
                        setEditing({
                          upc: r.upc,
                          locationId: r.locationId as Id<"wms_locations">,
                          locationLabel: r.locationLabel,
                          current: r.quantity,
                        })
                      }
                      style={{ color: iOS.accent, fontSize: 14, fontWeight: 500, background: "transparent", border: "none", cursor: "pointer" }}
                    >
                      Adjust
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {editing && (
        <AdjustSheet
          upc={editing.upc}
          locationLabel={editing.locationLabel}
          currentQty={editing.current}
          onCancel={() => setEditing(null)}
          onConfirm={handleAdjust}
        />
      )}
    </PageShell>
  );
}

function AdjustSheet({
  upc,
  locationLabel,
  currentQty,
  onCancel,
  onConfirm,
}: {
  upc: string;
  locationLabel: string;
  currentQty: number;
  onCancel: () => void;
  onConfirm: (newQty: number, reason: string) => Promise<void>;
}) {
  const [newQty, setNewQty] = useState(String(currentQty));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Sheet
      open
      onClose={onCancel}
      title="Adjust inventory"
      footer={
        <>
          <PillButton variant="ghost" onClick={onCancel}>Cancel</PillButton>
          <PillButton
            disabled={saving || !reason || Number.isNaN(Number(newQty))}
            onClick={async () => {
              setSaving(true);
              try { await onConfirm(Number(newQty), reason); } finally { setSaving(false); }
            }}
          >
            {saving ? "Saving…" : "Save adjustment"}
          </PillButton>
        </>
      }
    >
      <div style={{ color: iOS.text2, fontSize: 14, marginBottom: 12 }}>
        {upc} at {locationLabel} — currently {currentQty}
      </div>
      <div style={{ marginBottom: 14 }}>
        <div style={labelStyle}>New quantity</div>
        <TextField wide type="number" value={newQty} onChange={(e) => setNewQty(e.target.value)} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <div style={labelStyle}>Reason</div>
        <TextField wide value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. cycle count correction" />
      </div>
    </Sheet>
  );
}

function Th({ children, align }: { children?: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th style={{ padding: "10px 14px", textAlign: align ?? "left", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: iOS.text3, fontWeight: 600, borderBottom: `1px solid ${iOS.separator}` }}>
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  bold,
  muted,
  mono,
  colSpan,
  center,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  bold?: boolean;
  muted?: boolean;
  mono?: boolean;
  colSpan?: number;
  center?: boolean;
}) {
  return (
    <td
      colSpan={colSpan}
      style={{
        padding: "10px 14px",
        textAlign: center ? "center" : align ?? "left",
        color: muted ? iOS.text2 : iOS.text,
        fontWeight: bold ? 600 : 400,
        fontFamily: mono ? '"SF Mono", ui-monospace, Menlo, monospace' : undefined,
        fontSize: mono ? 13 : 14,
      }}
    >
      {children}
    </td>
  );
}

function q(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}
