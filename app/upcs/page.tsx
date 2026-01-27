"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useState, useRef } from "react";
import { Protected } from "../protected";
import { useAuth } from "../auth-context";
import Link from "next/link";
import * as XLSX from "xlsx";

function parseDescription(desc: string): { size: string; brand: string; model: string } {
  const parts = desc.trim().split(/\s+/);
  const size = parts[0] || "";
  let brand = parts[parts.length - 1] || "";
  if (brand === "PHI" || brand.length <= 3) {
    brand = parts[parts.length - 2] || brand;
  }
  const model = parts.slice(1, -1).join(" ").replace(/^\d+[A-Z]\s*/, "").replace(/\s*PHI$/, "").trim() || brand;

  return { size, brand, model };
}

// Detect column indices from header row
function detectColumnMapping(headers: string[]): { upc: number; brand: number; model: number; size: number; inventoryNumber: number } | null {
  const normalized = headers.map(h => String(h || "").toLowerCase().trim());

  // Look for Amazon UPC format with named columns
  const upcIdx = normalized.findIndex(h => h === "upc");
  const lineIdx = normalized.findIndex(h => h === "line"); // "Line" = model in Amazon format
  const brandIdx = normalized.findIndex(h => h === "brand" || h === "manufacturer");
  const sizeIdx = normalized.findIndex(h => h === "size" || h === "tiresize");
  const invIdx = normalized.findIndex(h => h === "inventorynumber" || h === "inventory" || h === "sku");

  if (upcIdx >= 0) {
    return {
      upc: upcIdx,
      brand: brandIdx >= 0 ? brandIdx : -1,
      model: lineIdx >= 0 ? lineIdx : -1, // "Line" column is the model
      size: sizeIdx >= 0 ? sizeIdx : -1,
      inventoryNumber: invIdx >= 0 ? invIdx : -1,
    };
  }

  return null; // Fall back to legacy positional parsing
}

function UPCDashboard() {
  const { canEdit } = useAuth();
  const [search, setSearch] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, inserted: 0, skipped: 0 });
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUPC, setEditingUPC] = useState<any>(null);
  const [newUPC, setNewUPC] = useState({ upc: "", brand: "", model: "", size: "", inventoryNumber: "" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const upcCount = useQuery(api.queries.getUPCCount);
  const upcs = useQuery(api.queries.searchUPCs, { search: search.length >= 2 ? search : undefined, limit: 100 });

  const batchImport = useMutation(api.mutations.batchImportUPCs);
  const addSingleUPC = useMutation(api.mutations.addSingleUPC);
  const updateUPC = useMutation(api.mutations.updateUPC);
  const deleteUPC = useMutation(api.mutations.deleteUPC);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadProgress({ current: 0, total: 0, inserted: 0, skipped: 0 });

    let rows: any[] = [];

    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    } else {
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      const delimiter = text.includes('\t') ? '\t' : ',';
      rows = lines.map(line => line.split(delimiter).map(cell => cell.trim()));
    }

    const headerRow = rows[0] || [];
    const dataRows = rows.slice(1);
    setUploadProgress(p => ({ ...p, total: dataRows.length }));

    const parsed: Array<{ upc: string; brand: string; model: string; size: string; inventoryNumber?: string }> = [];

    // Detect if this is an Amazon UPC format with named columns
    const columnMapping = detectColumnMapping(headerRow);

    for (const row of dataRows) {
      let upc: string;
      let brand: string;
      let model: string;
      let size: string;
      let inventoryNumber: string;

      if (columnMapping) {
        // Amazon UPC format - use detected column indices
        upc = String(row[columnMapping.upc] || "").trim();
        brand = columnMapping.brand >= 0 ? String(row[columnMapping.brand] || "").trim() : "";
        model = columnMapping.model >= 0 ? String(row[columnMapping.model] || "").trim() : ""; // "Line" column = model
        size = columnMapping.size >= 0 ? String(row[columnMapping.size] || "").trim() : "";
        inventoryNumber = columnMapping.inventoryNumber >= 0 ? String(row[columnMapping.inventoryNumber] || "").trim() : "";
      } else {
        // Legacy format - positional columns with description parsing
        upc = String(row[1] || "").trim();
        const description = String(row[2] || "");
        inventoryNumber = String(row[3] || "").trim();
        const descParsed = parseDescription(description);
        brand = descParsed.brand;
        model = descParsed.model;
        size = descParsed.size;
      }

      if (!upc || upc.length < 6) continue;

      // Only require UPC and at least one other field
      if (brand || model || size) {
        parsed.push({
          upc,
          brand: brand || model || "Unknown", // Fallback if brand missing
          model: model || brand || "Unknown", // Use model from "Line" column, fallback to brand
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
  };

  const handleDeleteUPC = async (id: string) => {
    if (confirm("Delete this UPC?")) {
      await deleteUPC({ id: id as any });
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      {/* Header */}
      <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-xl sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/"
                className="w-10 h-10 min-h-[44px] min-w-[44px] bg-slate-800/80 hover:bg-slate-700 border border-slate-700/50 rounded-xl flex items-center justify-center transition-all hover:scale-105 hover:border-slate-600"
                aria-label="Back to dashboard"
              >
                <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
                  Tire UPC Database
                </h1>
                <p className="text-slate-500 text-xs">Manage tire UPC codes for return scanning</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right mr-2 hidden sm:block">
                <p className="text-2xl font-bold text-cyan-400">{upcCount?.toLocaleString() || "..."}</p>
                <p className="text-xs text-slate-500">Total UPCs</p>
              </div>
              {canEdit && (
                <>
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="px-4 py-2.5 bg-slate-800/80 hover:bg-slate-700 border border-slate-700/50 hover:border-slate-600 rounded-xl text-sm font-medium transition-all hover:scale-105 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add
                  </button>
                  <label className="px-4 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-xl text-sm font-medium cursor-pointer transition-all hover:scale-105 shadow-lg shadow-cyan-500/25 flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Upload
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.txt,.tsv,.xlsx,.xls"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-4 sm:p-6">
        {/* Upload Progress */}
        {isUploading && (
          <div className="mb-6 bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-3">
              <span className="font-medium flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                Uploading UPCs...
              </span>
              <span className="text-slate-400 text-sm">
                {uploadProgress.current.toLocaleString()} / {uploadProgress.total.toLocaleString()}
              </span>
            </div>
            <div className="w-full bg-slate-700/50 rounded-full h-2 mb-4 overflow-hidden">
              <div
                className="bg-gradient-to-r from-cyan-500 to-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
              />
            </div>
            <div className="flex gap-6 text-sm">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                {uploadProgress.inserted.toLocaleString()} inserted
              </span>
              <span className="flex items-center gap-1.5 text-slate-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                {uploadProgress.skipped.toLocaleString()} skipped
              </span>
            </div>
          </div>
        )}

        {/* Upload Complete Message */}
        {!isUploading && uploadProgress.total > 0 && (
          <div className="mb-6 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-500/20 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="font-semibold text-emerald-400">Upload Complete</p>
                <p className="text-sm text-slate-400">
                  {uploadProgress.inserted.toLocaleString()} new UPCs added, {uploadProgress.skipped.toLocaleString()} duplicates skipped
                </p>
              </div>
              <button
                onClick={() => setUploadProgress({ current: 0, total: 0, inserted: 0, skipped: 0 })}
                className="p-2 hover:bg-slate-700/50 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="mb-6">
          <div className="relative">
            <svg className="w-5 h-5 text-slate-500 absolute left-4 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by UPC, brand, size, or inventory number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-12 pr-4 py-3.5 bg-slate-800/50 border border-slate-700/50 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all placeholder:text-slate-600"
            />
          </div>
          {search.length > 0 && search.length < 2 && (
            <p className="text-slate-500 text-sm mt-2 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Type at least 2 characters to search
            </p>
          )}
        </div>

        {/* UPC Table */}
        <div className="bg-slate-800/30 backdrop-blur border border-slate-700/30 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-900/50 border-b border-slate-700/50">
                  <th className="px-5 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">UPC</th>
                  <th className="px-5 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Brand</th>
                  <th className="px-5 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Model</th>
                  <th className="px-5 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Size</th>
                  <th className="px-5 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Inventory #</th>
                  {canEdit && <th className="px-5 py-4 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {upcs === undefined ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                        <p className="text-slate-500">Loading UPCs...</p>
                      </div>
                    </td>
                  </tr>
                ) : upcs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <svg className="w-12 h-12 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        <p className="text-slate-500">{search ? "No UPCs found matching your search" : "No UPCs in database"}</p>
                        {!search && <p className="text-slate-600 text-sm">Upload a file to get started</p>}
                      </div>
                    </td>
                  </tr>
                ) : (
                  upcs.map((upc) => (
                    <tr key={upc._id} className="hover:bg-slate-800/50 transition-colors">
                      <td className="px-5 py-4 font-mono text-cyan-300">{upc.upc}</td>
                      <td className="px-5 py-4 font-medium">{upc.brand}</td>
                      <td className="px-5 py-4 text-slate-300">{upc.model}</td>
                      <td className="px-5 py-4">
                        <span className="px-2.5 py-1 bg-slate-700/50 border border-slate-600/30 rounded-lg text-sm">{upc.size}</span>
                      </td>
                      <td className="px-5 py-4 text-slate-500 font-mono text-sm">{upc.inventoryNumber || "—"}</td>
                      {canEdit && (
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setEditingUPC(upc)}
                              className="p-2 hover:bg-slate-700 rounded-lg transition-all text-slate-500 hover:text-white"
                              title="Edit"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDeleteUPC(upc._id)}
                              className="p-2 hover:bg-red-500/20 rounded-lg transition-all text-slate-500 hover:text-red-400"
                              title="Delete"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {upcs && upcs.length >= 100 && (
          <p className="text-slate-600 text-sm mt-4 text-center flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            Showing first 100 results. Use search to find specific UPCs.
          </p>
        )}
      </div>

      {/* Add UPC Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowAddModal(false)}>
          <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Add UPC</h3>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-slate-700 rounded-lg transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-slate-400 text-sm mb-1">UPC Code *</label>
                <input
                  type="text"
                  value={newUPC.upc}
                  onChange={(e) => setNewUPC({ ...newUPC, upc: e.target.value })}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 font-mono transition-all"
                  placeholder="012345678901"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">Brand *</label>
                <input
                  type="text"
                  value={newUPC.brand}
                  onChange={(e) => setNewUPC({ ...newUPC, brand: e.target.value })}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
                  placeholder="Michelin"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">Model</label>
                <input
                  type="text"
                  value={newUPC.model}
                  onChange={(e) => setNewUPC({ ...newUPC, model: e.target.value })}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
                  placeholder="Defender T+H"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">Size *</label>
                <input
                  type="text"
                  value={newUPC.size}
                  onChange={(e) => setNewUPC({ ...newUPC, size: e.target.value })}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
                  placeholder="225/65R17"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">Inventory Number</label>
                <input
                  type="text"
                  value={newUPC.inventoryNumber}
                  onChange={(e) => setNewUPC({ ...newUPC, inventoryNumber: e.target.value })}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 font-mono transition-all"
                  placeholder="1200000088"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowAddModal(false)} className="flex-1 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl font-medium transition-colors">Cancel</button>
                <button onClick={handleAddUPC} className="flex-1 px-4 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-xl font-medium shadow-lg shadow-cyan-500/25 transition-all">Add UPC</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit UPC Modal */}
      {editingUPC && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setEditingUPC(null)}>
          <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Edit UPC</h3>
              <button onClick={() => setEditingUPC(null)} className="p-2 hover:bg-slate-700 rounded-lg transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-slate-400 text-sm mb-1">UPC Code</label>
                <input
                  type="text"
                  value={editingUPC.upc}
                  onChange={(e) => setEditingUPC({ ...editingUPC, upc: e.target.value })}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 font-mono transition-all"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">Brand</label>
                <input
                  type="text"
                  value={editingUPC.brand}
                  onChange={(e) => setEditingUPC({ ...editingUPC, brand: e.target.value })}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">Model</label>
                <input
                  type="text"
                  value={editingUPC.model}
                  onChange={(e) => setEditingUPC({ ...editingUPC, model: e.target.value })}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">Size</label>
                <input
                  type="text"
                  value={editingUPC.size}
                  onChange={(e) => setEditingUPC({ ...editingUPC, size: e.target.value })}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">Inventory Number</label>
                <input
                  type="text"
                  value={editingUPC.inventoryNumber || ""}
                  onChange={(e) => setEditingUPC({ ...editingUPC, inventoryNumber: e.target.value })}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 font-mono transition-all"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditingUPC(null)} className="flex-1 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl font-medium transition-colors">Cancel</button>
                <button onClick={handleUpdateUPC} className="flex-1 px-4 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-xl font-medium shadow-lg shadow-cyan-500/25 transition-all">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function UPCsPage() {
  return (
    <Protected>
      <UPCDashboard />
    </Protected>
  );
}
