"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import React, { useMemo, useState } from "react";
import { Protected } from "../../protected";
import { iOS, PageShell, TopBar, Card, PillButton, TextField, Select, labelStyle } from "../_ui";

const WAREHOUSE_CODE = "W09";
const TX_TYPES = ["RECEIVE", "PUT_AWAY", "MOVE", "PICK", "ADJUST", "COUNT", "LABEL_CREATE"] as const;

export default function TransactionsPage() {
  return (
    <Protected>
      <Transactions />
    </Protected>
  );
}

function Transactions() {
  const transactions = useQuery(api.wms.getRecentTransactions, {
    warehouseCode: WAREHOUSE_CODE,
    limit: 1000,
  });

  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [userFilter, setUserFilter] = useState<string>("");
  const [upcFilter, setUpcFilter] = useState<string>("");

  const filtered = useMemo(() => {
    let rows = transactions ?? [];
    const fromTs = fromDate ? new Date(fromDate).getTime() : null;
    const toTs = toDate ? new Date(toDate).getTime() + 86_400_000 : null;
    if (fromTs !== null) rows = rows.filter((t) => t.timestamp >= fromTs);
    if (toTs !== null) rows = rows.filter((t) => t.timestamp <= toTs);
    if (typeFilter) rows = rows.filter((t) => t.type === typeFilter);
    if (userFilter) {
      const q = userFilter.toLowerCase();
      rows = rows.filter((t) => t.performedByName.toLowerCase().includes(q));
    }
    if (upcFilter) {
      const q = upcFilter.toLowerCase();
      rows = rows.filter((t) => t.upc.toLowerCase().includes(q));
    }
    return rows;
  }, [transactions, fromDate, toDate, typeFilter, userFilter, upcFilter]);

  function exportCSV() {
    const headers = ["Timestamp", "Type", "User", "UPC", "Quantity", "From", "To", "Session", "Notes"];
    const csv = [
      headers.join(","),
      ...filtered.map((t) =>
        [
          new Date(t.timestamp).toISOString(),
          t.type,
          q(t.performedByName),
          t.upc,
          t.quantity,
          q(String(t.fromLocationId ?? "")),
          q(String(t.toLocationId ?? "")),
          q(t.sessionId ?? ""),
          q(t.notes ?? ""),
        ].join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wms_transactions_${WAREHOUSE_CODE}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <PageShell>
      <TopBar
        back={{ href: "/wms", label: "Floor" }}
        title="Activity"
        subtitle={`${filtered.length} record${filtered.length === 1 ? "" : "s"}`}
        trailing={<PillButton onClick={exportCSV} variant="secondary">Export CSV</PillButton>}
      />

      <div style={{ padding: "0 24px 24px" }}>
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <Field label="From"><TextField type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></Field>
            <Field label="To"><TextField type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></Field>
            <Field label="Type">
              <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">All</option>
                {TX_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="User"><TextField value={userFilter} onChange={(e) => setUserFilter(e.target.value)} placeholder="name" /></Field>
            <Field label="UPC"><TextField value={upcFilter} onChange={(e) => setUpcFilter(e.target.value)} placeholder="upc" /></Field>
          </div>
        </Card>

        <Card padded={false}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: iOS.bg }}>
                <Th>When</Th>
                <Th>Type</Th>
                <Th>User</Th>
                <Th>UPC</Th>
                <Th align="right">Qty</Th>
                <Th>Notes</Th>
              </tr>
            </thead>
            <tbody>
              {!transactions && <tr><Td colSpan={6} center>Loading…</Td></tr>}
              {transactions && filtered.length === 0 && <tr><Td colSpan={6} center muted>No matches.</Td></tr>}
              {filtered.map((t, idx) => (
                <tr key={t._id} style={{ borderTop: idx === 0 ? "none" : `1px solid ${iOS.separator}` }}>
                  <Td muted>{new Date(t.timestamp).toLocaleString()}</Td>
                  <Td><TypeBadge type={t.type} /></Td>
                  <Td>{t.performedByName}</Td>
                  <Td mono>{t.upc}</Td>
                  <Td align="right" bold>{t.quantity}</Td>
                  <Td muted>{t.notes ?? ""}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </PageShell>
  );
}

function TypeBadge({ type }: { type: string }) {
  const palette: Record<string, { bg: string; fg: string }> = {
    PUT_AWAY: { bg: "#E0EFFF", fg: "#003D80" },
    PICK: { bg: "#D7F5E0", fg: "#004E1E" },
    MOVE: { bg: "#FFE9C2", fg: "#7A4A00" },
    ADJUST: { bg: "#FFD7D3", fg: "#7A1A0E" },
    LABEL_CREATE: { bg: "#E9DFFF", fg: "#3B0F8A" },
    RECEIVE: { bg: "#CFF5F5", fg: "#0A4A4D" },
    COUNT: { bg: "#EAEAEF", fg: iOS.text2 },
  };
  const c = palette[type] ?? { bg: iOS.bg, fg: iOS.text2 };
  return (
    <span style={{ background: c.bg, color: c.fg, padding: "3px 10px", borderRadius: 980, fontSize: 11, fontWeight: 600, letterSpacing: 0.4 }}>
      {type}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
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
