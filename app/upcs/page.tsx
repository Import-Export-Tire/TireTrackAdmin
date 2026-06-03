"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useState, useRef } from "react";
import { Protected } from "../protected";
import { useAuth } from "../auth-context";
import * as XLSX from "xlsx";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { toast } from "sonner";
import { Plus, Search, MoreVertical, Trash2, Pencil, Upload, CheckCircle2, X, Info } from "lucide-react";

// ── Utility functions (unchanged) ──────────────────────────────────────────
function parseDescription(desc: string): { size: string; brand: string; model: string } {
  const parts = desc.trim().split(/\s+/);
  const size = parts[0] || "";
  let brand = parts[parts.length - 1] || "";
  if (brand === "PHI" || brand.length <= 3) {
    brand = parts[parts.length - 2] || brand;
  }
  const model =
    parts
      .slice(1, -1)
      .join(" ")
      .replace(/^\d+[A-Z]\s*/, "")
      .replace(/\s*PHI$/, "")
      .trim() || brand;

  return { size, brand, model };
}

// Detect column indices from header row
function detectColumnMapping(
  headers: string[]
): { upc: number; brand: number; model: number; size: number; inventoryNumber: number } | null {
  const normalized = headers.map((h) => String(h || "").toLowerCase().trim());

  // Look for Amazon UPC format with named columns
  const upcIdx = normalized.findIndex((h) => h === "upc");
  const lineIdx = normalized.findIndex((h) => h === "line" || h === "model");
  const brandIdx = normalized.findIndex((h) => h === "brand" || h === "manufacturer");
  const sizeIdx = normalized.findIndex((h) => h === "size" || h === "tiresize");
  const invIdx = normalized.findIndex(
    (h) => h === "inventorynumber" || h === "inventory" || h === "sku" || h === "inventory #"
  );

  if (upcIdx >= 0) {
    return {
      upc: upcIdx,
      brand: brandIdx >= 0 ? brandIdx : -1,
      model: lineIdx >= 0 ? lineIdx : -1,
      size: sizeIdx >= 0 ? sizeIdx : -1,
      inventoryNumber: invIdx >= 0 ? invIdx : -1,
    };
  }

  return null;
}

// ── Main dashboard component ────────────────────────────────────────────────
function UPCDashboard() {
  const { canEdit } = useAuth();

  // ── State (all preserved) ──
  const [search, setSearch] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({
    current: 0,
    total: 0,
    inserted: 0,
    skipped: 0,
  });
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUPC, setEditingUPC] = useState<any>(null);
  const [newUPC, setNewUPC] = useState({
    upc: "",
    brand: "",
    model: "",
    size: "",
    inventoryNumber: "",
  });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Queries ──
  const upcCount = useQuery(api.queries.getUPCCount);
  const upcs = useQuery(api.queries.searchUPCs, {
    search: search.length >= 2 ? search : undefined,
    limit: 100,
  });

  // ── Mutations ──
  const batchImport = useMutation(api.mutations.batchImportUPCs);
  const addSingleUPC = useMutation(api.mutations.addSingleUPC);
  const updateUPC = useMutation(api.mutations.updateUPC);
  const deleteUPC = useMutation(api.mutations.deleteUPC);

  // ── Handlers (all logic preserved) ──
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadProgress({ current: 0, total: 0, inserted: 0, skipped: 0 });

    let rows: any[] = [];
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    } else {
      const text = await file.text();
      const lines = text.split("\n").filter((line) => line.trim());
      const delimiter = text.includes("\t") ? "\t" : ",";
      rows = lines.map((line) => line.split(delimiter).map((cell) => cell.trim()));
    }

    const headerRow = rows[0] || [];
    const dataRows = rows.slice(1);
    setUploadProgress((p) => ({ ...p, total: dataRows.length }));

    const parsed: Array<{
      upc: string;
      brand: string;
      model: string;
      size: string;
      inventoryNumber?: string;
    }> = [];

    const columnMapping = detectColumnMapping(headerRow);

    for (const row of dataRows) {
      let upc: string;
      let brand: string;
      let model: string;
      let size: string;
      let inventoryNumber: string;

      if (columnMapping) {
        upc = String(row[columnMapping.upc] || "").trim();
        brand = columnMapping.brand >= 0 ? String(row[columnMapping.brand] || "").trim() : "";
        model = columnMapping.model >= 0 ? String(row[columnMapping.model] || "").trim() : "";
        size = columnMapping.size >= 0 ? String(row[columnMapping.size] || "").trim() : "";
        inventoryNumber =
          columnMapping.inventoryNumber >= 0
            ? String(row[columnMapping.inventoryNumber] || "").trim()
            : "";
      } else {
        upc = String(row[1] || "").trim();
        const description = String(row[2] || "");
        inventoryNumber = String(row[3] || "").trim();
        const descParsed = parseDescription(description);
        brand = descParsed.brand;
        model = descParsed.model;
        size = descParsed.size;
      }

      if (!upc || upc.length < 6) continue;

      if (brand || model || size) {
        parsed.push({
          upc,
          brand: brand || model || "Unknown",
          model: model || brand || "Unknown",
          size: size || "Unknown",
          inventoryNumber: inventoryNumber || undefined,
        });
      }
    }

    const BATCH_SIZE = 500;
    let totalInserted = 0;
    let totalSkipped = 0;

    for (let i = 0; i < parsed.length; i += BATCH_SIZE) {
      const batch = parsed.slice(i, i + BATCH_SIZE);
      const result = await batchImport({ upcs: batch });
      totalInserted += result.inserted;
      totalSkipped += result.skipped;
      setUploadProgress({
        current: Math.min(i + BATCH_SIZE, parsed.length),
        total: parsed.length,
        inserted: totalInserted,
        skipped: totalSkipped,
      });
    }

    setIsUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    toast.success(
      `Upload complete — ${totalInserted.toLocaleString()} added, ${totalSkipped.toLocaleString()} skipped`
    );
  };

  const handleAddUPC = async () => {
    if (!newUPC.upc || !newUPC.brand || !newUPC.size) return;

    const result = await addSingleUPC({
      upc: newUPC.upc.trim(),
      brand: newUPC.brand.trim(),
      model: newUPC.model.trim() || newUPC.brand.trim(),
      size: newUPC.size.trim(),
      inventoryNumber: newUPC.inventoryNumber.trim() || undefined,
    });

    if (result.success) {
      setShowAddModal(false);
      setNewUPC({ upc: "", brand: "", model: "", size: "", inventoryNumber: "" });
      toast.success("UPC added");
    }
  };

  const handleUpdateUPC = async () => {
    if (!editingUPC) return;

    await updateUPC({
      id: editingUPC._id,
      upc: editingUPC.upc,
      brand: editingUPC.brand,
      model: editingUPC.model,
      size: editingUPC.size,
      inventoryNumber: editingUPC.inventoryNumber || undefined,
    });

    setEditingUPC(null);
    toast.success("UPC updated");
  };

  const handleDeleteUPC = async () => {
    if (!confirmDeleteId) return;
    await deleteUPC({ id: confirmDeleteId as any });
    setConfirmDeleteId(null);
    toast.success("UPC deleted");
  };

  return (
    <div className="min-h-screen bg-ios-gray6 p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <PageHeader
        title="Tire UPC Database"
        subtitle="Manage tire UPC codes for return scanning"
        backHref="/"
        right={
          canEdit ? (
            <div className="flex items-center gap-2">
              {/* Total UPC count badge */}
              <div className="text-right mr-1 hidden sm:block">
                <p className="text-xl font-bold text-ios-blue">
                  {upcCount?.toLocaleString() ?? "…"}
                </p>
                <p className="text-xs text-ios-gray2">Total UPCs</p>
              </div>

              <Button variant="secondary" onClick={() => setShowAddModal(true)}>
                <Plus className="w-4 h-4 mr-1" />
                Add
              </Button>

              {/* File upload — label styled as button; hidden input triggers file picker */}
              <label className={buttonVariants({ variant: "default" }) + " cursor-pointer"}>
                <Upload className="w-4 h-4 mr-1" />
                Upload
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt,.tsv,.xlsx,.xls"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          ) : (
            /* Non-editors still see the count */
            <div className="text-right">
              <p className="text-xl font-bold text-ios-blue">
                {upcCount?.toLocaleString() ?? "…"}
              </p>
              <p className="text-xs text-ios-gray2">Total UPCs</p>
            </div>
          )
        }
      />

      {/* Upload progress panel */}
      {isUploading && (
        <div className="mb-4 bg-white border border-ios-gray5 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="font-medium text-sm flex items-center gap-2 text-ios-gray1">
              <div className="w-4 h-4 border-2 border-ios-blue border-t-transparent rounded-full animate-spin" />
              Uploading UPCs…
            </span>
            <span className="text-ios-gray2 text-sm">
              {uploadProgress.current.toLocaleString()} / {uploadProgress.total.toLocaleString()}
            </span>
          </div>
          <div className="w-full bg-ios-gray5 rounded-full h-2 mb-4 overflow-hidden">
            <div
              className="bg-ios-blue h-2 rounded-full transition-all duration-300"
              style={{
                width: uploadProgress.total
                  ? `${(uploadProgress.current / uploadProgress.total) * 100}%`
                  : "0%",
              }}
            />
          </div>
          <div className="flex gap-6 text-sm">
            <span className="flex items-center gap-1.5 text-green-600">
              <CheckCircle2 className="w-4 h-4" />
              {uploadProgress.inserted.toLocaleString()} inserted
            </span>
            <span className="flex items-center gap-1.5 text-ios-gray2">
              <X className="w-4 h-4" />
              {uploadProgress.skipped.toLocaleString()} skipped
            </span>
          </div>
        </div>
      )}

      {/* Upload complete panel */}
      {!isUploading && uploadProgress.total > 0 && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-xl p-5">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-green-700">Upload Complete</p>
              <p className="text-sm text-green-600">
                {uploadProgress.inserted.toLocaleString()} new UPCs added,{" "}
                {uploadProgress.skipped.toLocaleString()} duplicates skipped
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                setUploadProgress({ current: 0, total: 0, inserted: 0, skipped: 0 })
              }
              className="text-green-600 hover:bg-green-100 shrink-0"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Search bar */}
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ios-gray2 pointer-events-none" />
          <Input
            type="text"
            placeholder="Search by UPC, brand, size, or inventory number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {search.length > 0 && search.length < 2 && (
          <p className="text-ios-gray2 text-sm mt-2 flex items-center gap-1.5">
            <Info className="w-4 h-4 shrink-0" />
            Type at least 2 characters to search
          </p>
        )}
      </div>

      {/* UPC table */}
      <div className="bg-white border border-ios-gray5 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-ios-gray6 border-b border-ios-gray5">
                <TableHead>UPC</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Inventory #</TableHead>
                {canEdit && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {upcs === undefined ? (
                /* Loading state */
                <>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Skeleton className="h-4 w-32" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-28" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                      {canEdit && <TableCell />}
                    </TableRow>
                  ))}
                </>
              ) : upcs.length === 0 ? (
                /* Empty state */
                <TableRow>
                  <TableCell
                    colSpan={canEdit ? 6 : 5}
                    className="py-16 text-center text-ios-gray2"
                  >
                    {search
                      ? "No UPCs found matching your search"
                      : "No UPCs in database — upload a file to get started"}
                  </TableCell>
                </TableRow>
              ) : (
                /* Populated rows */
                upcs.map((upc) => (
                  <TableRow key={upc._id}>
                    <TableCell className="font-mono text-ios-blue">{upc.upc}</TableCell>
                    <TableCell className="font-medium">{upc.brand}</TableCell>
                    <TableCell className="text-ios-gray1">{upc.model}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{upc.size}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-ios-gray2">
                      {upc.inventoryNumber || "—"}
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className={buttonVariants({ variant: "ghost", size: "icon" })}
                          >
                            <MoreVertical className="w-4 h-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setEditingUPC(upc)}>
                              <Pencil className="w-4 h-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setConfirmDeleteId(upc._id)}
                              className="text-ios-red focus:bg-ios-red/10"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Truncation notice */}
      {upcs && upcs.length >= 100 && (
        <p className="text-ios-gray2 text-sm mt-3 text-center flex items-center justify-center gap-1.5">
          <Info className="w-4 h-4 shrink-0" />
          Showing first 100 results. Use search to find specific UPCs.
        </p>
      )}

      {/* ── Add UPC Dialog ─────────────────────────────────────────────── */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add UPC</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="add-upc">UPC Code *</Label>
              <Input
                id="add-upc"
                value={newUPC.upc}
                onChange={(e) => setNewUPC({ ...newUPC, upc: e.target.value })}
                placeholder="012345678901"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-brand">Brand *</Label>
              <Input
                id="add-brand"
                value={newUPC.brand}
                onChange={(e) => setNewUPC({ ...newUPC, brand: e.target.value })}
                placeholder="Michelin"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-model">Model</Label>
              <Input
                id="add-model"
                value={newUPC.model}
                onChange={(e) => setNewUPC({ ...newUPC, model: e.target.value })}
                placeholder="Defender T+H"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-size">Size *</Label>
              <Input
                id="add-size"
                value={newUPC.size}
                onChange={(e) => setNewUPC({ ...newUPC, size: e.target.value })}
                placeholder="225/65R17"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-inv">Inventory Number</Label>
              <Input
                id="add-inv"
                value={newUPC.inventoryNumber}
                onChange={(e) => setNewUPC({ ...newUPC, inventoryNumber: e.target.value })}
                placeholder="1200000088"
                className="font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddUPC}
              disabled={!newUPC.upc || !newUPC.brand || !newUPC.size}
            >
              Add UPC
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit UPC Dialog ────────────────────────────────────────────── */}
      <Dialog open={!!editingUPC} onOpenChange={(open) => { if (!open) setEditingUPC(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit UPC</DialogTitle>
          </DialogHeader>
          {editingUPC && (
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-upc">UPC Code</Label>
                <Input
                  id="edit-upc"
                  value={editingUPC.upc}
                  onChange={(e) => setEditingUPC({ ...editingUPC, upc: e.target.value })}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-brand">Brand</Label>
                <Input
                  id="edit-brand"
                  value={editingUPC.brand}
                  onChange={(e) => setEditingUPC({ ...editingUPC, brand: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-model">Model</Label>
                <Input
                  id="edit-model"
                  value={editingUPC.model}
                  onChange={(e) => setEditingUPC({ ...editingUPC, model: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-size">Size</Label>
                <Input
                  id="edit-size"
                  value={editingUPC.size}
                  onChange={(e) => setEditingUPC({ ...editingUPC, size: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-inv">Inventory Number</Label>
                <Input
                  id="edit-inv"
                  value={editingUPC.inventoryNumber || ""}
                  onChange={(e) =>
                    setEditingUPC({ ...editingUPC, inventoryNumber: e.target.value })
                  }
                  className="font-mono"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditingUPC(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateUPC}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ─────────────────────────────────── */}
      <Dialog
        open={!!confirmDeleteId}
        onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete UPC?</DialogTitle>
            <DialogDescription>
              This will permanently remove the UPC from the database. This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmDeleteId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteUPC}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Page export ─────────────────────────────────────────────────────────────
export default function UPCsPage() {
  return (
    <Protected>
      <UPCDashboard />
    </Protected>
  );
}
