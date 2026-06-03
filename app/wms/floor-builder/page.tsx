"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Protected } from "../../protected";
import { useAuth } from "../../auth-context";
import {
  iOS,
  PageShell,
  TopBar,
  Card,
  PillButton,
  TextField,
  Sheet,
  Segmented,
  labelStyle,
  FONT_STACK,
} from "../_ui";

const WAREHOUSE_CODE = "W09";

type Mode = "place" | "moveDock" | "drawAisle" | "outline" | "image";

export default function FloorBuilderPage() {
  return (
    <Protected>
      <FloorBuilder />
    </Protected>
  );
}

function FloorBuilder() {
  const { admin } = useAuth();
  const config = useQuery(api.wms.getFloorConfig, { warehouseCode: WAREHOUSE_CODE });
  const occupancy = useQuery(api.wms.getFloorOccupancy, { warehouseCode: WAREHOUSE_CODE });
  const floorPlan = useQuery(api.wms.getFloorPlanImage, { warehouseCode: WAREHOUSE_CODE });
  const updateFloorConfig = useMutation(api.wms.updateFloorConfig);
  const createLocation = useMutation(api.wms.createLocation);
  const updateLocation = useMutation(api.wms.updateLocation);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const setFloorPlanImage = useMutation(api.wms.setFloorPlanImage);

  // Real-world dimensions are the source of truth; grid counts are derived.
  const [feetPerCell, setFeetPerCell] = useState<number>(5);
  const [widthFt, setWidthFt] = useState<number>(100);
  const [depthFt, setDepthFt] = useState<number>(75);
  const [dockX, setDockX] = useState(0);
  const [dockY, setDockY] = useState(0);
  const [aisles, setAisles] = useState<Array<{ x1: number; y1: number; x2: number; y2: number }>>([]);
  const [outline, setOutline] = useState<Array<{ x: number; y: number }>>([]);
  const [outlineClosed, setOutlineClosed] = useState<boolean>(false);
  const [mode, setMode] = useState<Mode>("place");
  const [editingLocationId, setEditingLocationId] = useState<Id<"wms_locations"> | null>(null);
  const [newPositionAt, setNewPositionAt] = useState<{ x: number; y: number } | null>(null);
  const [aisleStart, setAisleStart] = useState<{ x: number; y: number } | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [planOpacityLocal, setPlanOpacityLocal] = useState<number | null>(null);
  const [rotationLocal, setRotationLocal] = useState<number | null>(null);
  const [scaleLocal, setScaleLocal] = useState<number | null>(null);
  const [offsetXLocal, setOffsetXLocal] = useState<number | null>(null);
  const [offsetYLocal, setOffsetYLocal] = useState<number | null>(null);

  const opacity = planOpacityLocal ?? floorPlan?.opacity ?? 0.4;
  const rotation = rotationLocal ?? (floorPlan as any)?.rotation ?? 0;
  const scale = scaleLocal ?? (floorPlan as any)?.scale ?? 1;
  const offsetXFt = offsetXLocal ?? (floorPlan as any)?.offsetXFt ?? 0;
  const offsetYFt = offsetYLocal ?? (floorPlan as any)?.offsetYFt ?? 0;

  const gridWidth = Math.max(1, Math.round(widthFt / Math.max(0.5, feetPerCell)));
  const gridHeight = Math.max(1, Math.round(depthFt / Math.max(0.5, feetPerCell)));

  useEffect(() => {
    if (config) {
      const fpc = config.feetPerCell ?? 5;
      setFeetPerCell(fpc);
      setWidthFt(config.gridWidth * fpc);
      setDepthFt(config.gridHeight * fpc);
      setDockX(config.dockX);
      setDockY(config.dockY);
      setAisles(config.aisles ?? []);
      const savedOutline = (config as any).outline as Array<{ x: number; y: number }> | undefined;
      if (savedOutline && savedOutline.length >= 3) {
        setOutline(savedOutline);
        setOutlineClosed(true);
      }
    }
  }, [config]);

  const positionByXY = useMemo(() => {
    const m = new Map<string, NonNullable<typeof occupancy>[number]>();
    (occupancy ?? []).forEach((p) => m.set(`${p.x},${p.y}`, p));
    return m;
  }, [occupancy]);

  function handleCellClick(x: number, y: number) {
    if (mode === "moveDock") {
      setDockX(x);
      setDockY(y);
      setMode("place");
      return;
    }
    if (mode === "drawAisle") {
      if (!aisleStart) setAisleStart({ x, y });
      else {
        setAisles((prev) => [...prev, { x1: aisleStart.x, y1: aisleStart.y, x2: x, y2: y }]);
        setAisleStart(null);
      }
      return;
    }
    if (mode === "outline") {
      if (outlineClosed) {
        setOutline([{ x, y }]);
        setOutlineClosed(false);
        return;
      }
      if (outline.length >= 3) {
        const first = outline[0];
        if (Math.abs(first.x - x) <= 1 && Math.abs(first.y - y) <= 1) {
          setOutlineClosed(true);
          return;
        }
      }
      setOutline((prev) => [...prev, { x, y }]);
      return;
    }
    if (mode === "image") return;
    const existing = positionByXY.get(`${x},${y}`);
    if (existing) setEditingLocationId(existing.locationId as Id<"wms_locations">);
    else setNewPositionAt({ x, y });
  }

  function normalizeRotation(value: number): number {
    let v = value % 360;
    if (v < 0) v += 360;
    return Math.round(v * 10) / 10;
  }

  async function handleSaveConfig() {
    setSavingConfig(true);
    try {
      await updateFloorConfig({
        warehouseCode: WAREHOUSE_CODE,
        gridWidth,
        gridHeight,
        dockX,
        dockY,
        feetPerCell,
        aisles,
        outline: outlineClosed && outline.length >= 3 ? outline : undefined,
      });
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleCreatePosition(draft: { zone: string; position: string; maxCapacity: number; notes?: string }) {
    if (!newPositionAt || !admin) return;
    await createLocation({
      warehouseCode: WAREHOUSE_CODE,
      zone: draft.zone,
      position: draft.position,
      x: newPositionAt.x,
      y: newPositionAt.y,
      maxCapacity: draft.maxCapacity,
      notes: draft.notes,
      userId: admin.id,
    });
    setNewPositionAt(null);
  }

  async function handleUploadFloorPlan(file: File) {
    setUploadingImage(true);
    try {
      // Ensure floor config exists so setFloorPlanImage has a row to patch.
      await updateFloorConfig({
        warehouseCode: WAREHOUSE_CODE,
        gridWidth,
        gridHeight,
        dockX,
        dockY,
        feetPerCell,
        aisles,
        outline: outlineClosed && outline.length >= 3 ? outline : undefined,
      });
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "image/png" },
        body: file,
      });
      if (!res.ok) throw new Error(`upload HTTP ${res.status}`);
      const { storageId } = await res.json();
      await setFloorPlanImage({
        warehouseCode: WAREHOUSE_CODE,
        storageId,
        opacity,
        rotation,
        scale,
        offsetXFt,
        offsetYFt,
      });
    } catch (e: any) {
      alert(`Upload failed: ${e.message ?? e}`);
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleRemoveFloorPlan() {
    await setFloorPlanImage({
      warehouseCode: WAREHOUSE_CODE,
      storageId: undefined,
      opacity: undefined,
      rotation: undefined,
      scale: undefined,
      offsetXFt: undefined,
      offsetYFt: undefined,
    });
    setPlanOpacityLocal(null);
    setRotationLocal(null);
    setScaleLocal(null);
    setOffsetXLocal(null);
    setOffsetYLocal(null);
  }

  async function resetImageTransform() {
    setScaleLocal(1);
    setOffsetXLocal(0);
    setOffsetYLocal(0);
    setRotationLocal(0);
    const sid = (config as any)?.floorPlanStorageId;
    if (!sid) return;
    await setFloorPlanImage({
      warehouseCode: WAREHOUSE_CODE,
      storageId: sid,
      opacity,
      rotation: 0,
      scale: 1,
      offsetXFt: 0,
      offsetYFt: 0,
    });
  }

  async function persistImage(patch: { opacity?: number; rotation?: number; scale?: number; offsetXFt?: number; offsetYFt?: number }) {
    const sid = (config as any)?.floorPlanStorageId;
    if (!sid) return;
    await setFloorPlanImage({
      warehouseCode: WAREHOUSE_CODE,
      storageId: sid,
      opacity: patch.opacity ?? opacity,
      rotation: patch.rotation ?? rotation,
      scale: patch.scale ?? scale,
      offsetXFt: patch.offsetXFt ?? offsetXFt,
      offsetYFt: patch.offsetYFt ?? offsetYFt,
    });
  }

  function openLabelPrintView() {
    const labels = (occupancy ?? []).map((p) => p.label).sort();
    const html = buildLabelHTML(labels);
    const w = window.open("", "_blank", "width=900,height=1100");
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  }

  return (
    <PageShell>
      <TopBar
        back={{ href: "/wms", label: "Floor" }}
        title="Floor builder"
        subtitle={`${(occupancy ?? []).length} positions`}
        trailing={
          <PillButton onClick={openLabelPrintView} variant="secondary">
            Print labels
          </PillButton>
        }
      />

      <div style={{ padding: "0 24px 24px" }}>
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
            <FtField label="Warehouse width" value={widthFt} onChange={setWidthFt} />
            <FtField label="Warehouse depth" value={depthFt} onChange={setDepthFt} />
            <div>
              <div style={labelStyle}>Cell size</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <TextField
                  type="number"
                  step={0.5}
                  value={feetPerCell}
                  onChange={(e) => setFeetPerCell(Number.parseFloat(e.target.value) || 1)}
                  style={{ width: 80 }}
                />
                <span style={{ color: iOS.text2, fontSize: 14 }}>ft / side</span>
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <div>
              <div style={labelStyle}>Mode</div>
              <Segmented<Mode>
                value={mode}
                onChange={(v) => {
                  if (v === "drawAisle") setAisleStart(null);
                  setMode(v);
                }}
                options={[
                  { value: "place", label: "Place" },
                  { value: "moveDock", label: "Dock" },
                  { value: "drawAisle", label: "Aisle" },
                  { value: "outline", label: "Outline" },
                  { value: "image", label: "Image" },
                ]}
              />
            </div>
            <PillButton onClick={() => setAisles([])} variant="ghost">
              Clear aisles
            </PillButton>
            <PillButton onClick={handleSaveConfig} disabled={savingConfig}>
              {savingConfig ? "Saving…" : "Save floor"}
            </PillButton>
          </div>

          {/* Floor plan backdrop controls */}
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
              marginTop: 16,
              paddingTop: 16,
              borderTop: `1px solid ${iOS.separator}`,
            }}
          >
            <div style={{ fontSize: 13, color: iOS.text2, fontWeight: 600 }}>Floor plan backdrop</div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUploadFloorPlan(f);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
            <PillButton variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={uploadingImage}>
              {uploadingImage ? "Uploading…" : floorPlan?.url ? "Replace image" : "Upload image"}
            </PillButton>
            {floorPlan?.url && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, color: iOS.text2 }}>Opacity</span>
                  <input
                    type="range"
                    min={0.05}
                    max={1}
                    step={0.05}
                    value={opacity}
                    onChange={(e) => setPlanOpacityLocal(Number.parseFloat(e.target.value))}
                    onMouseUp={(e) => persistImage({ opacity: Number.parseFloat((e.target as HTMLInputElement).value) })}
                    style={{ accentColor: iOS.accent }}
                  />
                  <span style={{ fontSize: 12, color: iOS.text3, width: 32 }}>{Math.round(opacity * 100)}%</span>
                </div>
                <RotationControl
                  rotation={rotation}
                  onPreview={(v) => setRotationLocal(normalizeRotation(v))}
                  onCommit={(v) => {
                    const n = normalizeRotation(v);
                    setRotationLocal(n);
                    persistImage({ rotation: n });
                  }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, color: iOS.text2 }}>Scale</span>
                  <input
                    type="range"
                    min={0.25}
                    max={4}
                    step={0.01}
                    value={scale}
                    onChange={(e) => setScaleLocal(Number.parseFloat(e.target.value))}
                    onMouseUp={(e) => persistImage({ scale: Number.parseFloat((e.target as HTMLInputElement).value) })}
                    style={{ accentColor: iOS.accent, width: 120 }}
                  />
                  <span style={{ fontSize: 12, color: iOS.text3, width: 36 }}>{scale.toFixed(2)}×</span>
                </div>
                <PillButton variant="ghost" onClick={resetImageTransform}>Reset transform</PillButton>
                <PillButton variant="ghost" onClick={handleRemoveFloorPlan}>Remove</PillButton>
              </>
            )}
          </div>

          <p style={{ color: iOS.text3, fontSize: 12, marginTop: 12 }}>
            Floor is {widthFt} ft × {depthFt} ft — {gridWidth} × {gridHeight} cells at {feetPerCell} ft / side.
          </p>
        </Card>

        <ModeBanner
          mode={mode}
          aisleStart={aisleStart}
          outline={outline}
          outlineClosed={outlineClosed}
          feetPerCell={feetPerCell}
          onUndoOutline={() => {
            setOutline((p) => p.slice(0, -1));
            setOutlineClosed(false);
          }}
          onFinishOutline={() => {
            if (outline.length >= 3) setOutlineClosed(true);
          }}
          onClearOutline={() => {
            setOutline([]);
            setOutlineClosed(false);
          }}
        />

        <Card>
          <BuilderGrid
            gridWidth={gridWidth}
            gridHeight={gridHeight}
            feetPerCell={feetPerCell}
            dockX={dockX}
            dockY={dockY}
            aisles={aisles}
            positions={(occupancy ?? []).map((p) => ({
              locationId: p.locationId as unknown as string,
              label: p.label,
              x: p.x,
              y: p.y,
            }))}
            aisleStart={aisleStart}
            outline={outline}
            outlineClosed={outlineClosed}
            mode={mode}
            onCellClick={handleCellClick}
            onUpdateVertex={(idx, x, y) => {
              setOutline((prev) => {
                const next = [...prev];
                next[idx] = { x, y };
                return next;
              });
            }}
            onInsertVertex={(afterIdx, x, y) => {
              setOutline((prev) => {
                const next = [...prev];
                next.splice(afterIdx + 1, 0, { x, y });
                return next;
              });
            }}
            onDeleteVertex={(idx) => {
              setOutline((prev) => {
                if (prev.length <= 3) return prev;
                return prev.filter((_, i) => i !== idx);
              });
            }}
            onSetOutline={(next) => setOutline(next)}
            backdropUrl={floorPlan?.url ?? null}
            backdropOpacity={opacity}
            backdropRotation={rotation}
            backdropScale={scale}
            backdropOffsetXFt={offsetXFt}
            backdropOffsetYFt={offsetYFt}
            onCommitImageOffset={(xFt, yFt) => {
              setOffsetXLocal(xFt);
              setOffsetYLocal(yFt);
              persistImage({ offsetXFt: xFt, offsetYFt: yFt });
            }}
            onPreviewImageOffset={(xFt, yFt) => {
              setOffsetXLocal(xFt);
              setOffsetYLocal(yFt);
            }}
          />
        </Card>
      </div>

      {newPositionAt && (
        <NewPositionSheet
          x={newPositionAt.x}
          y={newPositionAt.y}
          onCancel={() => setNewPositionAt(null)}
          onSave={handleCreatePosition}
        />
      )}

      {editingLocationId && (
        <EditPositionSheet
          locationId={editingLocationId}
          onClose={() => setEditingLocationId(null)}
          onSave={async (patch) => {
            await updateLocation({ locationId: editingLocationId, ...patch });
            setEditingLocationId(null);
          }}
        />
      )}
    </PageShell>
  );
}

function FtField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <TextField
          type="number"
          value={value}
          onChange={(e) => onChange(Number.parseFloat(e.target.value) || 0)}
          style={{ width: 90 }}
        />
        <span style={{ color: iOS.text2, fontSize: 14 }}>ft</span>
      </div>
    </div>
  );
}

function RotationControl({
  rotation,
  onPreview,
  onCommit,
}: {
  rotation: number;
  onPreview: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", border: `1px solid ${iOS.separator}`, borderRadius: 980, background: "#fff" }}>
      <span style={{ fontSize: 12, color: iOS.text2 }}>Rotate</span>
      <input
        type="range"
        min={0}
        max={360}
        step={0.5}
        value={rotation}
        onChange={(e) => onPreview(Number.parseFloat(e.target.value))}
        onMouseUp={(e) => onCommit(Number.parseFloat((e.target as HTMLInputElement).value))}
        style={{ accentColor: iOS.accent, width: 120 }}
      />
      <input
        type="number"
        step={0.1}
        value={rotation}
        onChange={(e) => onPreview(Number.parseFloat(e.target.value) || 0)}
        onBlur={(e) => onCommit(Number.parseFloat(e.target.value) || 0)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        style={{ width: 64, border: `1px solid ${iOS.separator}`, borderRadius: 6, padding: "4px 6px", fontSize: 13, textAlign: "right", fontFamily: FONT_STACK }}
      />
      <span style={{ fontSize: 12, color: iOS.text3 }}>°</span>
      <div style={{ display: "flex", gap: 4, marginLeft: 4 }}>
        {[0, 90, 180, 270].map((preset) => {
          const active = Math.round(rotation) === preset;
          return (
            <button
              key={preset}
              onClick={() => onCommit(preset)}
              style={{ background: active ? iOS.accent : "#E8E8ED", color: active ? "#fff" : iOS.text, border: "none", borderRadius: 6, padding: "3px 7px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: FONT_STACK }}
            >
              {preset}°
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ModeBanner({
  mode,
  aisleStart,
  outline,
  outlineClosed,
  feetPerCell,
  onUndoOutline,
  onFinishOutline,
  onClearOutline,
}: {
  mode: Mode;
  aisleStart: { x: number; y: number } | null;
  outline: Array<{ x: number; y: number }>;
  outlineClosed: boolean;
  feetPerCell: number;
  onUndoOutline: () => void;
  onFinishOutline: () => void;
  onClearOutline: () => void;
}) {
  let text: React.ReactNode;
  let color: string;
  let extra: React.ReactNode = null;
  if (mode === "place") {
    text = "Place mode — tap an empty cell to add a position, or tap an existing position to edit.";
    color = iOS.text2;
  } else if (mode === "moveDock") {
    text = "Dock mode — tap any cell to place the dock there.";
    color = iOS.warn;
  } else if (mode === "drawAisle") {
    text = aisleStart
      ? `Aisle mode — tap the second endpoint to finish the line.`
      : "Aisle mode — tap the first endpoint of the line.";
    color = iOS.accent;
  } else if (mode === "image") {
    text = "Image mode — drag the floor plan to pan it; use the Scale slider to resize.";
    color = "#7C3AED";
  } else {
    color = "#7C3AED";
    if (outlineClosed) {
      const perim = perimeterFeet(outline, feetPerCell);
      text = (
        <span>
          Outline closed — perimeter <strong>{perim.toFixed(1)} ft</strong>. Drag the polygon to move all corners; drag a vertex to nudge one; tap green <strong>+</strong> to insert; double-click to delete.
        </span>
      );
    } else if (outline.length === 0) {
      text = "Outline mode — tap each corner of the warehouse to trace the walls. Tap near the first corner to close.";
    } else {
      const lens = segmentLengthsFeet(outline, feetPerCell);
      const last = lens[lens.length - 1];
      text = (
        <span>
          {outline.length} vertex{outline.length === 1 ? "" : "es"} placed.
          {last !== undefined && <> Last wall <strong>{last.toFixed(1)} ft</strong>.</>}{" "}
          {outline.length >= 3 ? "Tap near first corner to close, or use Finish." : "Tap to add more."}
        </span>
      );
    }
    extra = (
      <div style={{ display: "flex", gap: 6, marginLeft: 12, flexShrink: 0 }}>
        {outline.length > 0 && !outlineClosed && (
          <button onClick={onUndoOutline} style={smallBtn}>Undo</button>
        )}
        {outline.length >= 3 && !outlineClosed && (
          <button onClick={onFinishOutline} style={{ ...smallBtn, background: iOS.accent, color: "#fff" }}>Finish</button>
        )}
        {outline.length > 0 && (
          <button onClick={onClearOutline} style={smallBtn}>Clear</button>
        )}
      </div>
    );
  }
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${iOS.separator}`,
        borderLeft: `4px solid ${color}`,
        borderRadius: 10,
        padding: "10px 14px",
        marginBottom: 12,
        fontSize: 13,
        color: iOS.text,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <span>{text}</span>
      {extra}
    </div>
  );
}

const smallBtn: React.CSSProperties = {
  background: "#E8E8ED",
  color: iOS.text,
  border: "none",
  borderRadius: 980,
  padding: "5px 12px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: FONT_STACK,
};

function segmentLengthsFeet(outline: Array<{ x: number; y: number }>, feetPerCell: number): number[] {
  const lens: number[] = [];
  for (let i = 1; i < outline.length; i++) {
    const a = outline[i - 1];
    const b = outline[i];
    lens.push(Math.hypot(b.x - a.x, b.y - a.y) * feetPerCell);
  }
  return lens;
}

function perimeterFeet(outline: Array<{ x: number; y: number }>, feetPerCell: number): number {
  if (outline.length < 2) return 0;
  let sum = segmentLengthsFeet(outline, feetPerCell).reduce((a, b) => a + b, 0);
  const a = outline[outline.length - 1];
  const b = outline[0];
  sum += Math.hypot(b.x - a.x, b.y - a.y) * feetPerCell;
  return sum;
}

interface BuilderGridProps {
  gridWidth: number;
  gridHeight: number;
  feetPerCell: number;
  dockX: number;
  dockY: number;
  aisles: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  positions: Array<{ locationId: string; label: string; x: number; y: number }>;
  aisleStart: { x: number; y: number } | null;
  outline?: Array<{ x: number; y: number }>;
  outlineClosed?: boolean;
  mode?: Mode;
  onCellClick: (x: number, y: number) => void;
  onUpdateVertex?: (idx: number, x: number, y: number) => void;
  onInsertVertex?: (afterIdx: number, x: number, y: number) => void;
  onDeleteVertex?: (idx: number) => void;
  onSetOutline?: (next: Array<{ x: number; y: number }>) => void;
  backdropUrl?: string | null;
  backdropOpacity?: number;
  backdropRotation?: number;
  backdropScale?: number;
  backdropOffsetXFt?: number;
  backdropOffsetYFt?: number;
  onCommitImageOffset?: (xFt: number, yFt: number) => void;
  onPreviewImageOffset?: (xFt: number, yFt: number) => void;
}

function BuilderGrid({
  gridWidth,
  gridHeight,
  feetPerCell,
  dockX,
  dockY,
  aisles,
  positions,
  aisleStart,
  outline = [],
  outlineClosed = false,
  mode = "place",
  onCellClick,
  onUpdateVertex,
  onInsertVertex,
  onDeleteVertex,
  onSetOutline,
  backdropUrl,
  backdropOpacity = 0.4,
  backdropRotation = 0,
  backdropScale = 1,
  backdropOffsetXFt = 0,
  backdropOffsetYFt = 0,
  onCommitImageOffset,
  onPreviewImageOffset,
}: BuilderGridProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draggingVertex, setDraggingVertex] = useState<number | null>(null);
  const [imageDragging, setImageDragging] = useState(false);
  const [outlineDragging, setOutlineDragging] = useState(false);
  const dragImageStart = useRef<{ mouseX: number; mouseY: number; offsetX: number; offsetY: number } | null>(null);
  const outlineDragStart = useRef<{ startCellX: number; startCellY: number; snapshot: Array<{ x: number; y: number }> } | null>(null);

  const containerMax = 1080;
  const RULER = 28;
  const cell = Math.max(18, Math.floor(containerMax / Math.max(1, gridWidth)));
  const w = cell * gridWidth;
  const h = cell * gridHeight;
  const fullW = w + RULER;
  const fullH = h + RULER;
  const posByXY = new Map(positions.map((p) => [`${p.x},${p.y}`, p]));

  const totalWidthFt = gridWidth * feetPerCell;
  const tickFt = totalWidthFt <= 40 ? 5 : totalWidthFt <= 200 ? 10 : 25;

  function pointerToCell(e: React.PointerEvent | PointerEvent) {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: (p.x - RULER) / cell, y: (p.y - RULER) / cell };
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (draggingVertex !== null) {
      const p = pointerToCell(e);
      if (!p) return;
      const cx = Math.max(0, Math.min(gridWidth, p.x));
      const cy = Math.max(0, Math.min(gridHeight, p.y));
      onUpdateVertex?.(draggingVertex, Math.round(cx * 10) / 10, Math.round(cy * 10) / 10);
    } else if (outlineDragging && outlineDragStart.current) {
      const p = pointerToCell(e);
      if (!p) return;
      const dx = p.x - outlineDragStart.current.startCellX;
      const dy = p.y - outlineDragStart.current.startCellY;
      const next = outlineDragStart.current.snapshot.map((v) => ({
        x: Math.round((v.x + dx) * 10) / 10,
        y: Math.round((v.y + dy) * 10) / 10,
      }));
      onSetOutline?.(next);
    } else if (imageDragging && dragImageStart.current) {
      const start = dragImageStart.current;
      const dxPx = e.clientX - start.mouseX;
      const dyPx = e.clientY - start.mouseY;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const dxFt = ((dxPx * (fullW / rect.width)) / cell) * feetPerCell;
      const dyFt = ((dyPx * (fullH / rect.height)) / cell) * feetPerCell;
      onPreviewImageOffset?.(start.offsetX + dxFt, start.offsetY + dyFt);
    }
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (draggingVertex !== null) setDraggingVertex(null);
    if (outlineDragging) {
      setOutlineDragging(false);
      outlineDragStart.current = null;
    }
    if (imageDragging && dragImageStart.current) {
      setImageDragging(false);
      const start = dragImageStart.current;
      dragImageStart.current = null;
      const dxPx = e.clientX - start.mouseX;
      const dyPx = e.clientY - start.mouseY;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const dxFt = ((dxPx * (fullW / rect.width)) / cell) * feetPerCell;
      const dyFt = ((dyPx * (fullH / rect.height)) / cell) * feetPerCell;
      onCommitImageOffset?.(start.offsetX + dxFt, start.offsetY + dyFt);
    }
  }

  // Ruler ticks
  const horizTicks: React.ReactNode[] = [];
  for (let ft = 0; ft <= gridWidth * feetPerCell; ft += tickFt) {
    const cellsAcross = ft / feetPerCell;
    horizTicks.push(
      <g key={`ht-${ft}`}>
        <line x1={RULER + cellsAcross * cell} y1={RULER - 4} x2={RULER + cellsAcross * cell} y2={RULER} stroke={iOS.text3} strokeWidth={1} />
        <text x={RULER + cellsAcross * cell} y={RULER - 8} textAnchor="middle" fontSize={10} fill={iOS.text2}>{ft}′</text>
      </g>,
    );
  }
  const vertTicks: React.ReactNode[] = [];
  for (let ft = 0; ft <= gridHeight * feetPerCell; ft += tickFt) {
    const cellsDown = ft / feetPerCell;
    vertTicks.push(
      <g key={`vt-${ft}`}>
        <line x1={RULER - 4} y1={RULER + cellsDown * cell} x2={RULER} y2={RULER + cellsDown * cell} stroke={iOS.text3} strokeWidth={1} />
        <text x={RULER - 8} y={RULER + cellsDown * cell + 3} textAnchor="end" fontSize={10} fill={iOS.text2}>{ft}′</text>
      </g>,
    );
  }

  const cells: React.ReactNode[] = [];
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const pos = posByXY.get(`${x},${y}`);
      const emptyFill = backdropUrl ? "rgba(255,255,255,0)" : "#fff";
      const posFill = backdropUrl ? "rgba(0,122,255,0.18)" : "#E0EFFF";
      const stroke = backdropUrl ? "rgba(28,28,30,0.25)" : iOS.separator;
      cells.push(
        <g key={`${x},${y}`} transform={`translate(${x * cell},${y * cell})`} onClick={() => onCellClick(x, y)} style={{ cursor: "pointer" }}>
          <rect x={2} y={2} width={cell - 4} height={cell - 4} fill={pos ? posFill : emptyFill} stroke={stroke} strokeWidth={0.75} rx={6} pointerEvents="all" />
          {pos && (
            <text
              x={cell / 2}
              y={cell / 2 + 4}
              fontSize={Math.max(10, cell * 0.24)}
              textAnchor="middle"
              fill={iOS.accent}
              fontWeight={700}
              style={{
                paintOrder: "stroke",
                stroke: backdropUrl ? "rgba(255,255,255,0.85)" : "transparent",
                strokeWidth: backdropUrl ? 3 : 0,
              }}
            >
              {pos.label}
            </text>
          )}
        </g>,
      );
    }
  }

  const imageOffsetCellsX = backdropOffsetXFt / feetPerCell;
  const imageOffsetCellsY = backdropOffsetYFt / feetPerCell;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${fullW} ${fullH}`}
      style={{
        width: "100%",
        height: "auto",
        display: "block",
        borderRadius: 10,
        cursor: imageDragging
          ? "grabbing"
          : mode === "image" && backdropUrl
          ? "grab"
          : "default",
        touchAction: "none",
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <rect x={0} y={0} width={fullW} height={RULER} fill="#fff" />
      <rect x={0} y={0} width={RULER} height={fullH} fill="#fff" />
      {horizTicks}
      {vertTicks}

      <g transform={`translate(${RULER},${RULER})`}>
        {!backdropUrl && <rect x={0} y={0} width={w} height={h} fill={iOS.bg} />}
        {backdropUrl && (
          <g
            transform={`translate(${imageOffsetCellsX * cell},${imageOffsetCellsY * cell}) translate(${w / 2},${h / 2}) rotate(${backdropRotation}) scale(${backdropScale}) translate(${-w / 2},${-h / 2})`}
            style={{ cursor: mode === "image" ? (imageDragging ? "grabbing" : "grab") : "default" }}
            onPointerDown={(e) => {
              if (mode !== "image") return;
              e.stopPropagation();
              svgRef.current?.setPointerCapture?.(e.pointerId);
              dragImageStart.current = {
                mouseX: e.clientX,
                mouseY: e.clientY,
                offsetX: backdropOffsetXFt,
                offsetY: backdropOffsetYFt,
              };
              setImageDragging(true);
            }}
          >
            <image
              href={backdropUrl}
              x={0}
              y={0}
              width={w}
              height={h}
              opacity={backdropOpacity}
              preserveAspectRatio="xMidYMid meet"
              pointerEvents={mode === "image" ? "all" : "none"}
            />
            {mode === "image" && (
              <rect x={0} y={0} width={w} height={h} fill="none" stroke="#7C3AED" strokeWidth={2} strokeDasharray="6 4" pointerEvents="none" />
            )}
          </g>
        )}
        {cells}
        {aisles.map((a, i) => (
          <line
            key={`aisle-${i}`}
            x1={a.x1 * cell + cell / 2}
            y1={a.y1 * cell + cell / 2}
            x2={a.x2 * cell + cell / 2}
            y2={a.y2 * cell + cell / 2}
            stroke="#A0A0A8"
            strokeWidth={Math.max(2, cell * 0.05)}
            strokeLinecap="round"
          />
        ))}
        {aisleStart && (
          <circle
            cx={aisleStart.x * cell + cell / 2}
            cy={aisleStart.y * cell + cell / 2}
            r={Math.max(4, cell * 0.12)}
            fill={iOS.warn}
          />
        )}
        {outline.length > 0 && (
          <g>
            {(() => {
              const pts = outline.map((p) => ({ px: p.x * cell + cell / 2, py: p.y * cell + cell / 2 }));
              const pathD = (() => {
                let d = `M ${pts[0].px} ${pts[0].py}`;
                for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].px} ${pts[i].py}`;
                if (outlineClosed) d += " Z";
                return d;
              })();
              const segments: React.ReactNode[] = [];
              const endCount = outlineClosed ? outline.length : outline.length - 1;
              for (let i = 0; i < endCount; i++) {
                const a = outline[i];
                const b = outline[(i + 1) % outline.length];
                if (!b) continue;
                const ft = Math.hypot(b.x - a.x, b.y - a.y) * feetPerCell;
                const mx = ((a.x + b.x) / 2) * cell + cell / 2;
                const my = ((a.y + b.y) / 2) * cell + cell / 2;
                segments.push(
                  <g key={`seg-${i}`} transform={`translate(${mx},${my})`} pointerEvents="none">
                    <rect x={-22} y={-9} width={44} height={16} fill="#fff" stroke="#7C3AED" strokeWidth={0.8} rx={8} opacity={0.92} />
                    <text textAnchor="middle" y={3} fontSize={10} fontWeight={700} fill="#5B21B6">
                      {ft.toFixed(1)} ft
                    </text>
                  </g>,
                );
              }
              const canDragOutline = mode === "outline" && outlineClosed;
              return (
                <>
                  <path
                    d={pathD}
                    fill={outlineClosed ? "rgba(124, 58, 237, 0.06)" : "none"}
                    stroke="#7C3AED"
                    strokeWidth={3}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    style={{
                      cursor: canDragOutline ? (outlineDragging ? "grabbing" : "grab") : "default",
                      pointerEvents: canDragOutline ? "all" : "none",
                    }}
                    onPointerDown={(e) => {
                      if (!canDragOutline) return;
                      e.stopPropagation();
                      const p = pointerToCell(e);
                      if (!p) return;
                      svgRef.current?.setPointerCapture?.(e.pointerId);
                      outlineDragStart.current = {
                        startCellX: p.x,
                        startCellY: p.y,
                        snapshot: outline.map((v) => ({ x: v.x, y: v.y })),
                      };
                      setOutlineDragging(true);
                    }}
                  />
                  {pts.map((p, i) => (
                    <circle
                      key={`v-${i}`}
                      cx={p.px}
                      cy={p.py}
                      r={i === 0 && !outlineClosed && outline.length >= 3 ? 8 : 6}
                      fill={i === 0 && !outlineClosed && outline.length >= 3 ? iOS.accent : "#7C3AED"}
                      stroke="#fff"
                      strokeWidth={2}
                      style={{
                        cursor: mode === "outline" ? "grab" : "default",
                        pointerEvents: mode === "outline" ? "all" : "none",
                      }}
                      onPointerDown={(e) => {
                        if (mode !== "outline") return;
                        e.stopPropagation();
                        svgRef.current?.setPointerCapture?.(e.pointerId);
                        setDraggingVertex(i);
                      }}
                      onDoubleClick={(e) => {
                        if (mode !== "outline" || !outlineClosed) return;
                        e.stopPropagation();
                        onDeleteVertex?.(i);
                      }}
                    />
                  ))}
                  {mode === "outline" && outlineClosed && outline.map((a, i) => {
                    const b = outline[(i + 1) % outline.length];
                    const mx = ((a.x + b.x) / 2) * cell + cell / 2;
                    const my = ((a.y + b.y) / 2) * cell + cell / 2;
                    const midGridX = (a.x + b.x) / 2;
                    const midGridY = (a.y + b.y) / 2;
                    return (
                      <g
                        key={`ins-${i}`}
                        transform={`translate(${mx + 14},${my - 14})`}
                        style={{ cursor: "pointer" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onInsertVertex?.(i, midGridX, midGridY);
                        }}
                      >
                        <circle r={9} fill="#34C759" stroke="#fff" strokeWidth={2} />
                        <line x1={-4} y1={0} x2={4} y2={0} stroke="#fff" strokeWidth={2} strokeLinecap="round" />
                        <line x1={0} y1={-4} x2={0} y2={4} stroke="#fff" strokeWidth={2} strokeLinecap="round" />
                      </g>
                    );
                  })}
                  {segments}
                </>
              );
            })()}
          </g>
        )}
        <g transform={`translate(${dockX * cell + cell / 2},${dockY * cell + cell / 2})`}>
          <circle r={Math.max(6, cell * 0.18)} fill={iOS.warn} stroke="#fff" strokeWidth={2} />
          <text x={0} y={Math.max(20, cell * 0.55)} textAnchor="middle" fontSize={11} fontWeight={700}>DOCK</text>
        </g>
      </g>
    </svg>
  );
}

function NewPositionSheet({
  x,
  y,
  onCancel,
  onSave,
}: {
  x: number;
  y: number;
  onCancel: () => void;
  onSave: (draft: { zone: string; position: string; maxCapacity: number }) => Promise<void>;
}) {
  const [zone, setZone] = useState("A");
  const [position, setPosition] = useState("");
  const [maxCapacity, setMaxCapacity] = useState("40");
  const [saving, setSaving] = useState(false);
  return (
    <Sheet
      open
      onClose={onCancel}
      title={`New position at (${x}, ${y})`}
      footer={
        <>
          <PillButton variant="ghost" onClick={onCancel}>Cancel</PillButton>
          <PillButton
            disabled={saving || !zone || !position}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave({ zone, position, maxCapacity: Number.parseInt(maxCapacity, 10) || 0 });
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Create"}
          </PillButton>
        </>
      }
    >
      <Field label="Zone">
        <TextField wide value={zone} onChange={(e) => setZone(e.target.value.toUpperCase())} />
      </Field>
      <Field label="Position">
        <TextField wide value={position} placeholder="01" onChange={(e) => setPosition(e.target.value.toUpperCase())} />
      </Field>
      <Field label="Max capacity (tires)">
        <TextField wide type="number" value={maxCapacity} onChange={(e) => setMaxCapacity(e.target.value)} />
      </Field>
    </Sheet>
  );
}

function EditPositionSheet({
  locationId,
  onClose,
  onSave,
}: {
  locationId: Id<"wms_locations">;
  onClose: () => void;
  onSave: (patch: { maxCapacity?: number; isActive?: boolean; notes?: string }) => Promise<void>;
}) {
  const contents = useQuery(api.wms.getLocationContents, { locationId });
  const [maxCapacity, setMaxCapacity] = useState<string>("");
  const [isActive, setIsActive] = useState<boolean>(true);
  const [notes, setNotes] = useState<string>("");
  useEffect(() => {
    if (contents) {
      setMaxCapacity(String(contents.location.maxCapacity));
      setIsActive(contents.location.isActive);
      setNotes(contents.location.notes ?? "");
    }
  }, [contents]);
  return (
    <Sheet
      open
      onClose={onClose}
      title={contents?.location.label ?? "Position"}
      footer={
        <>
          <PillButton variant="ghost" onClick={onClose}>Cancel</PillButton>
          <PillButton
            onClick={() =>
              onSave({
                maxCapacity: Number.parseInt(maxCapacity, 10) || 0,
                isActive,
                notes: notes || undefined,
              })
            }
          >
            Save
          </PillButton>
        </>
      }
    >
      {!contents && <div style={{ color: iOS.text2 }}>Loading…</div>}
      {contents && (
        <>
          <Field label="Max capacity">
            <TextField wide type="number" value={maxCapacity} onChange={(e) => setMaxCapacity(e.target.value)} />
          </Field>
          <Field label="Active">
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 15 }}>
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} style={{ accentColor: iOS.accent }} />
              Position is active
            </label>
          </Field>
          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{ background: "#fff", border: `1px solid ${iOS.separator}`, borderRadius: 10, padding: "10px 14px", fontSize: 15, color: iOS.text, fontFamily: FONT_STACK, width: "100%", minHeight: 60 }}
            />
          </Field>
          <div style={{ color: iOS.text2, fontSize: 13, marginTop: 8 }}>
            Currently holds {contents.totalQuantity} tires ({Math.round(contents.percentFull * 100)}%).
          </div>
        </>
      )}
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
  );
}

function buildLabelHTML(labels: string[]): string {
  const cells = labels
    .map(
      (label) => `
    <div class="cell">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(label)}" alt="${label}" />
      <div class="text">${label}</div>
      <div class="warehouse">W09 · CHESTNUT RIDGE</div>
    </div>`,
    )
    .join("");
  return `<!doctype html><html><head><title>WMS position labels</title>
<style>
  @page { size: letter; margin: 0.5in; }
  body { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .cell { border: 1px solid #ccc; padding: 10px; text-align: center; page-break-inside: avoid; border-radius: 12px; }
  .cell img { display: block; margin: 0 auto; }
  .text { font-size: 28px; font-weight: 700; margin-top: 6px; }
  .warehouse { font-size: 9px; color: #6E6E73; margin-top: 4px; }
  @media print { .noprint { display: none; } }
</style></head><body>
<div class="noprint" style="margin-bottom:12px"><button onclick="window.print()">Print</button> ${labels.length} labels</div>
<div class="grid">${cells}</div>
</body></html>`;
}
