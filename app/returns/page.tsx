"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useState } from "react";
import { Protected } from "../protected";
import { useAuth } from "../auth-context";
import Link from "next/link";

function ReturnsDashboard() {
  const { canEdit } = useAuth();
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "closed">("all");
  const [editingItem, setEditingItem] = useState<any>(null);
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState<string | null>(null);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [viewingItem, setViewingItem] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchStatusFilter, setSearchStatusFilter] = useState<string>("all");
  const [isSearching, setIsSearching] = useState(false);

  const stats = useQuery(api.queries.getReturnStats);
  const batches = useQuery(api.queries.getAllReturnBatches);
  const items = useQuery(
    api.queries.getReturnBatchItems,
    selectedBatch && !isSearching ? { batchId: selectedBatch as any } : "skip"
  );

  // Search query - only runs when searching
  const searchResults = useQuery(
    api.exportQueries.searchReturnItems,
    isSearching && searchQuery.length >= 2
      ? { search: searchQuery, status: searchStatusFilter === "all" ? undefined : searchStatusFilter }
      : "skip"
  );

  const updateItemStatus = useMutation(api.mutations.updateReturnItemStatus);
  const updateItem = useMutation(api.mutations.updateReturnItem);
  const deleteItem = useMutation(api.mutations.deleteReturnItem);
  const deleteBatch = useMutation(api.mutations.deleteReturnBatch);

  const filteredBatches = batches?.filter((batch) => {
    if (statusFilter === "all") return true;
    return batch.status === statusFilter;
  });

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleStatusChange = async (itemId: string, status: "pending" | "processed" | "not_processed", notes?: string) => {
    await updateItemStatus({ itemId: itemId as any, status, notes });
  };

  const handleUpdateItem = async () => {
    if (!editingItem) return;
    await updateItem({
      itemId: editingItem._id as any,
      poNumber: editingItem.poNumber,
      invNumber: editingItem.invNumber,
      tireBrand: editingItem.tireBrand,
      tireModel: editingItem.tireModel,
      tireSize: editingItem.tireSize,
      tirePartNumber: editingItem.tirePartNumber,
      quantity: editingItem.quantity,
      status: editingItem.status,
      notes: editingItem.notes,
    });
    setEditingItem(null);
  };

  const handleDeleteItem = async (itemId: string) => {
    if (confirm("Delete this return item?")) {
      await deleteItem({ itemId: itemId as any });
    }
  };

  const handleDeleteBatch = async (batchId: string) => {
    await deleteBatch({ batchId: batchId as any });
    setBatchDeleteConfirm(null);
    if (selectedBatch === batchId) {
      setSelectedBatch(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "processed":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg text-xs font-medium">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
            Processed
          </span>
        );
      case "not_processed":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-xs font-medium">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
            Not Processed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-700/50 text-slate-400 border border-slate-600/30 rounded-lg text-xs font-medium">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" /></svg>
            Pending
          </span>
        );
    }
  };

  const itemStats = items ? {
    total: items.length,
    processed: items.filter(i => i.status === "processed").length,
    notProcessed: items.filter(i => i.status === "not_processed").length,
    pending: items.filter(i => i.status === "pending").length,
  } : null;

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      {/* Header */}
      <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-xl sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
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
                  Returns Management
                </h1>
                <p className="text-slate-500 text-xs">Process and track tire returns</p>
              </div>
            </div>

            {/* Search Bar */}
            <div className="flex items-center gap-3">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (e.target.value.length >= 2) {
                      setIsSearching(true);
                    }
                  }}
                  onFocus={() => searchQuery.length >= 2 && setIsSearching(true)}
                  placeholder="Search brand, size, part #..."
                  className="pl-10 pr-4 py-2 w-64 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => {
                      setSearchQuery("");
                      setIsSearching(false);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              {isSearching && (
                <select
                  value={searchStatusFilter}
                  onChange={(e) => setSearchStatusFilter(e.target.value)}
                  className="px-3 py-2 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm text-white focus:outline-none focus:border-cyan-500/50"
                >
                  <option value="all">All Status</option>
                  <option value="processed">Processed</option>
                  <option value="pending">Pending</option>
                  <option value="not_processed">Not Processed</option>
                </select>
              )}
              {isSearching && (
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setIsSearching(false);
                  }}
                  className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl text-sm font-medium transition-all"
                >
                  Back to Batches
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto p-4 sm:p-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl p-4 hover:border-amber-500/30 transition-all">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-500/10 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-400">{stats?.openBatches || 0}</p>
                <p className="text-slate-500 text-xs">Open Batches</p>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl p-4 hover:border-slate-600/50 transition-all">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-700/50 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.itemsToday || 0}</p>
                <p className="text-slate-500 text-xs">Items Today</p>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl p-4 hover:border-emerald-500/30 transition-all">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-emerald-400">{stats?.processed || 0}</p>
                <p className="text-slate-500 text-xs">Processed</p>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl p-4 hover:border-red-500/30 transition-all">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-500/10 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-red-400">{stats?.notProcessed || 0}</p>
                <p className="text-slate-500 text-xs">Not Processed</p>
              </div>
            </div>
          </div>
        </div>

        {/* Search Results View */}
        {isSearching ? (
          <div className="bg-slate-800/30 backdrop-blur border border-slate-700/30 rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-700/30 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">
                  Search Results
                  {searchResults && (
                    <span className="text-cyan-400 ml-2">
                      ({searchResults.totalMatches} matches)
                    </span>
                  )}
                </h2>
                <p className="text-slate-500 text-sm mt-1">
                  Searching for "{searchQuery}" {searchStatusFilter !== "all" && `in ${searchStatusFilter}`}
                </p>
              </div>
            </div>

            <div className="p-4">
              {searchQuery.length < 2 ? (
                <div className="text-center py-12 text-slate-500">
                  <svg className="w-12 h-12 mx-auto mb-3 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <p>Type at least 2 characters to search</p>
                </div>
              ) : searchResults === undefined ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : searchResults.items.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <svg className="w-12 h-12 mx-auto mb-3 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-lg font-medium mb-1">No results found</p>
                  <p className="text-sm">Try different search terms</p>
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-slate-900/80 backdrop-blur-sm">
                      <tr className="text-left text-slate-400 text-xs uppercase tracking-wider border-b border-slate-700/50">
                        <th className="px-4 py-3 font-semibold">Batch</th>
                        <th className="px-4 py-3 font-semibold">Brand</th>
                        <th className="px-4 py-3 font-semibold">Model</th>
                        <th className="px-4 py-3 font-semibold">Size</th>
                        <th className="px-4 py-3 font-semibold">Part #</th>
                        <th className="px-4 py-3 font-semibold text-center">Qty</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                        <th className="px-4 py-3 font-semibold">Location</th>
                        <th className="px-4 py-3 font-semibold">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/30">
                      {searchResults.items.map((item: any) => (
                        <tr
                          key={item._id}
                          className="hover:bg-slate-800/50 transition-colors cursor-pointer"
                          onClick={() => {
                            setSelectedBatch(item.returnBatchId);
                            setIsSearching(false);
                            setSearchQuery("");
                          }}
                        >
                          <td className="px-4 py-3">
                            <span className="text-cyan-400 font-medium">{item.batchNumber}</span>
                          </td>
                          <td className="px-4 py-3 font-medium text-white">{item.tireBrand || "-"}</td>
                          <td className="px-4 py-3 text-slate-300">{item.tireModel || "-"}</td>
                          <td className="px-4 py-3 text-slate-300">{item.tireSize || "-"}</td>
                          <td className="px-4 py-3 font-mono text-sm text-slate-400">{item.tirePartNumber || "-"}</td>
                          <td className="px-4 py-3 text-center text-slate-300">{item.quantity || 1}</td>
                          <td className="px-4 py-3">{getStatusBadge(item.status)}</td>
                          <td className="px-4 py-3 text-slate-400 text-sm">{item.locationName}</td>
                          <td className="px-4 py-3 text-slate-500 text-xs">{formatDate(item.scannedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {searchResults.totalMatches > searchResults.items.length && (
                    <p className="text-center text-slate-500 text-xs py-3">
                      Showing {searchResults.items.length} of {searchResults.totalMatches} results
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Batches List */}
          <div className="bg-slate-800/30 backdrop-blur border border-slate-700/30 rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-700/30 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Batches</h2>
              <div className="flex gap-1 bg-slate-900/50 rounded-lg p-1">
                {(["all", "open", "closed"] as const).map((status) => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      statusFilter === status
                        ? "bg-cyan-600 text-white shadow-lg shadow-cyan-500/25"
                        : "text-slate-400 hover:text-white hover:bg-slate-700"
                    }`}
                  >
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4">
              {batches === undefined ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : filteredBatches?.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <svg className="w-12 h-12 mx-auto mb-3 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  <p>No return batches found</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                  {filteredBatches?.map((batch) => (
                    <div
                      key={batch._id}
                      className={`relative group p-4 rounded-xl cursor-pointer transition-all ${
                        selectedBatch === batch._id
                          ? "bg-gradient-to-r from-cyan-600 to-blue-600 shadow-lg shadow-cyan-500/20"
                          : "bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/30 hover:border-slate-600/50"
                      }`}
                      onClick={() => setSelectedBatch(batch._id)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold">{batch.batchNumber || `Batch ${batch._id.slice(-6)}`}</div>
                          <div className="text-sm text-slate-300 mt-1 flex items-center gap-2">
                            <span>{batch.itemCount} items</span>
                            <span className="text-slate-500">•</span>
                            <span className="text-slate-400">{batch.openedByName}</span>
                            <span className="text-slate-500">•</span>
                            <span className="text-cyan-400">{batch.locationName}</span>
                          </div>
                          <div className="text-xs text-slate-500 mt-1">
                            {formatDate(batch.openedAt)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-1 rounded-lg text-xs font-medium ${
                            batch.status === "open"
                              ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                              : "bg-slate-600/50 text-slate-300 border border-slate-500/30"
                          }`}>
                            {batch.status}
                          </span>
                          {canEdit && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setBatchDeleteConfirm(batch._id);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/20 rounded-lg transition-all"
                              title="Delete Batch"
                            >
                              <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>

                      {batchDeleteConfirm === batch._id && (
                        <div className="absolute inset-0 bg-slate-900/95 backdrop-blur-sm rounded-xl flex items-center justify-center gap-3 z-10">
                          <span className="text-sm">Delete batch & {batch.itemCount} items?</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteBatch(batch._id);
                            }}
                            className="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-medium"
                          >
                            Yes
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setBatchDeleteConfirm(null);
                            }}
                            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium"
                          >
                            No
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Items Table */}
          <div className="lg:col-span-2 bg-slate-800/30 backdrop-blur border border-slate-700/30 rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-700/30 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-semibold">
                  Return Items {selectedBatch && <span className="text-cyan-400">({items?.length || 0})</span>}
                </h2>
                {itemStats && (
                  <div className="flex gap-4 mt-1.5 text-sm">
                    <span className="flex items-center gap-1 text-emerald-400">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      {itemStats.processed}
                    </span>
                    <span className="flex items-center gap-1 text-red-400">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      {itemStats.notProcessed}
                    </span>
                    <span className="flex items-center gap-1 text-slate-400">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" /></svg>
                      {itemStats.pending}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4">
              {!selectedBatch ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                  <svg className="w-16 h-16 mb-4 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <p className="text-lg font-medium mb-1">No batch selected</p>
                  <p className="text-sm">Select a batch to view items</p>
                </div>
              ) : items === undefined ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : items.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No items in this batch</p>
              ) : (
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-slate-900/80 backdrop-blur-sm">
                      <tr className="text-left text-slate-400 text-xs uppercase tracking-wider border-b border-slate-700/50">
                        <th className="px-4 py-3 font-semibold w-16">Image</th>
                        <th className="px-4 py-3 font-semibold">PO / INV</th>
                        <th className="px-4 py-3 font-semibold">Tire</th>
                        <th className="px-4 py-3 font-semibold">Part #</th>
                        <th className="px-4 py-3 font-semibold text-center">Qty</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                        <th className="px-4 py-3 font-semibold">Scanned By</th>
                        {canEdit && <th className="px-4 py-3 font-semibold">Actions</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/30">
                      {items.map((item) => (
                        <tr key={item._id} className="hover:bg-slate-800/50 transition-colors cursor-pointer" onClick={() => setViewingItem(item)}>
                          <td className="px-4 py-3">
                            {item.imageUrl && item.imageUrl.startsWith("http") ? (
                              <button
                                onClick={() => setViewingImage(item.imageUrl!)}
                                className="w-12 h-12 rounded-lg overflow-hidden border border-slate-600 hover:border-cyan-500 transition-colors relative group"
                              >
                                <img
                                  src={item.imageUrl}
                                  alt="Return label"
                                  className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                                  </svg>
                                </div>
                              </button>
                            ) : item.imageUrl ? (
                              <div className="w-12 h-12 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center" title="Image on device only - not uploaded">
                                <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                </svg>
                              </div>
                            ) : (
                              <div className="w-12 h-12 rounded-lg bg-slate-700/50 flex items-center justify-center" title="No image">
                                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-mono text-sm">
                              {item.poNumber && <div className="text-cyan-300">PO: {item.poNumber}</div>}
                              {item.invNumber && <div className="text-slate-400">INV: {item.invNumber}</div>}
                              {!item.poNumber && !item.invNumber && <span className="text-slate-600">—</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-sm space-y-1">
                              {item.tireBrand && (
                                <div className="font-medium">{item.tireBrand}</div>
                              )}
                              {item.tireModel && item.tireModel !== item.tireBrand && (
                                <div className="text-cyan-300">{item.tireModel}</div>
                              )}
                              {item.tireSize && (
                                <span className="inline-block px-2 py-0.5 bg-slate-700/50 border border-slate-600/30 rounded text-xs">{item.tireSize}</span>
                              )}
                              {!item.tireBrand && !item.tireModel && !item.tireSize && (
                                <span className="text-slate-600">No tire info</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {item.tirePartNumber ? (
                              <span className="font-mono text-sm text-cyan-300">{item.tirePartNumber}</span>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center font-medium">{item.quantity || 1}</td>
                          <td className="px-4 py-3">
                            <div>
                              {getStatusBadge(item.status)}
                              {item.notes && (
                                <div className="text-xs text-slate-500 mt-1 max-w-[150px] truncate" title={item.notes}>
                                  {item.notes}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-400 text-sm">{item.scannedByName}</td>
                          {canEdit && (
                            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleStatusChange(item._id, "processed")}
                                  className={`p-1.5 rounded-lg transition-all ${
                                    item.status === "processed"
                                      ? "bg-emerald-500/30 text-emerald-400"
                                      : "hover:bg-emerald-500/20 text-slate-500 hover:text-emerald-400"
                                  }`}
                                  title="Mark Processed"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => {
                                    const notes = prompt("Enter notes for why this wasn't processed:");
                                    if (notes !== null) {
                                      handleStatusChange(item._id, "not_processed", notes);
                                    }
                                  }}
                                  className={`p-1.5 rounded-lg transition-all ${
                                    item.status === "not_processed"
                                      ? "bg-red-500/30 text-red-400"
                                      : "hover:bg-red-500/20 text-slate-500 hover:text-red-400"
                                  }`}
                                  title="Mark Not Processed"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => handleStatusChange(item._id, "pending")}
                                  className={`p-1.5 rounded-lg transition-all ${
                                    item.status === "pending"
                                      ? "bg-slate-600 text-slate-300"
                                      : "hover:bg-slate-700 text-slate-500"
                                  }`}
                                  title="Reset to Pending"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => setViewingItem(item)}
                                  className="p-1.5 hover:bg-cyan-500/20 rounded-lg transition-all text-slate-500 hover:text-cyan-400"
                                  title="View Details"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => setEditingItem(item)}
                                  className="p-1.5 hover:bg-slate-700 rounded-lg transition-all text-slate-500 hover:text-white"
                                  title="Edit"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => handleDeleteItem(item._id)}
                                  className="p-1.5 hover:bg-red-500/20 rounded-lg transition-all text-slate-500 hover:text-red-400"
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
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
        )}
      </div>

      {/* Detail View Modal */}
      {viewingItem && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setViewingItem(null)}
        >
          <div
            className="bg-slate-800 border border-slate-700 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-6 border-b border-slate-700 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Return Item Details</h3>
                <p className="text-slate-500 text-xs mt-0.5">
                  Scanned by {viewingItem.scannedByName} on {formatDate(viewingItem.scannedAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {canEdit && (
                  <button
                    onClick={() => { setEditingItem(viewingItem); setViewingItem(null); }}
                    className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                    Edit
                  </button>
                )}
                <button onClick={() => setViewingItem(null)} className="p-2 hover:bg-slate-700 rounded-lg transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Image */}
              {viewingItem.imageUrl && viewingItem.imageUrl.startsWith("http") ? (
                <div>
                  <label className="block text-slate-400 text-xs uppercase tracking-wider font-medium mb-2">Captured Image</label>
                  <button
                    onClick={() => setViewingImage(viewingItem.imageUrl)}
                    className="w-full max-h-80 rounded-xl overflow-hidden border border-slate-700 hover:border-cyan-500 transition-colors"
                  >
                    <img
                      src={viewingItem.imageUrl}
                      alt="Return item"
                      className="w-full h-full object-contain bg-slate-900"
                    />
                  </button>
                  <p className="text-slate-600 text-xs mt-1">Click image to view full size</p>
                </div>
              ) : (
                <div className="flex items-center gap-3 py-4 px-4 bg-slate-900/50 rounded-xl border border-slate-700/30">
                  <svg className="w-8 h-8 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="text-slate-500 text-sm">No image captured for this item</span>
                </div>
              )}

              {/* Status */}
              <div className="flex items-center gap-3">
                {getStatusBadge(viewingItem.status)}
                {viewingItem.notes && (
                  <span className="text-slate-400 text-sm">{viewingItem.notes}</span>
                )}
              </div>

              {/* Order Info */}
              <div>
                <label className="block text-slate-400 text-xs uppercase tracking-wider font-medium mb-2">Order Information</label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-900/50 rounded-xl p-3 border border-slate-700/30">
                    <p className="text-slate-500 text-xs mb-1">PO Number</p>
                    <p className="font-mono text-sm">{viewingItem.poNumber || <span className="text-slate-600">-</span>}</p>
                  </div>
                  <div className="bg-slate-900/50 rounded-xl p-3 border border-slate-700/30">
                    <p className="text-slate-500 text-xs mb-1">Invoice Number</p>
                    <p className="font-mono text-sm">{viewingItem.invNumber || <span className="text-slate-600">-</span>}</p>
                  </div>
                  <div className="bg-slate-900/50 rounded-xl p-3 border border-slate-700/30">
                    <p className="text-slate-500 text-xs mb-1">UPC Code</p>
                    <p className="font-mono text-sm">{viewingItem.upcCode || <span className="text-slate-600">-</span>}</p>
                  </div>
                  <div className="bg-slate-900/50 rounded-xl p-3 border border-slate-700/30">
                    <p className="text-slate-500 text-xs mb-1">Quantity</p>
                    <p className="text-sm font-medium">{viewingItem.quantity || 1}</p>
                  </div>
                </div>
              </div>

              {/* Tire Info */}
              <div>
                <label className="block text-slate-400 text-xs uppercase tracking-wider font-medium mb-2">Tire Information</label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-900/50 rounded-xl p-3 border border-slate-700/30">
                    <p className="text-slate-500 text-xs mb-1">Brand</p>
                    <p className="text-sm font-medium">{viewingItem.tireBrand || <span className="text-slate-600">-</span>}</p>
                  </div>
                  <div className="bg-slate-900/50 rounded-xl p-3 border border-slate-700/30">
                    <p className="text-slate-500 text-xs mb-1">Model</p>
                    <p className="text-sm">{viewingItem.tireModel || <span className="text-slate-600">-</span>}</p>
                  </div>
                  <div className="bg-slate-900/50 rounded-xl p-3 border border-slate-700/30">
                    <p className="text-slate-500 text-xs mb-1">Size</p>
                    <p className="text-sm">{viewingItem.tireSize || <span className="text-slate-600">-</span>}</p>
                  </div>
                  <div className="bg-slate-900/50 rounded-xl p-3 border border-slate-700/30">
                    <p className="text-slate-500 text-xs mb-1">Part Number</p>
                    <p className="font-mono text-sm">{viewingItem.tirePartNumber || <span className="text-slate-600">-</span>}</p>
                  </div>
                </div>
              </div>

              {/* From Address */}
              {viewingItem.fromAddress && (
                <div>
                  <label className="block text-slate-400 text-xs uppercase tracking-wider font-medium mb-2">From Address</label>
                  <div className="bg-slate-900/50 rounded-xl p-3 border border-slate-700/30">
                    <p className="text-sm whitespace-pre-line">{viewingItem.fromAddress}</p>
                  </div>
                </div>
              )}

              {/* Raw OCR Text */}
              {viewingItem.rawText && (
                <div>
                  <label className="block text-slate-400 text-xs uppercase tracking-wider font-medium mb-2">
                    Raw Scan Text
                    {viewingItem.aiConfidence && (
                      <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        viewingItem.aiConfidence === "high" ? "bg-emerald-500/20 text-emerald-400" :
                        viewingItem.aiConfidence === "medium" ? "bg-amber-500/20 text-amber-400" :
                        "bg-red-500/20 text-red-400"
                      }`}>
                        {viewingItem.aiConfidence} confidence
                      </span>
                    )}
                  </label>
                  <div className="bg-slate-900/50 rounded-xl p-3 border border-slate-700/30 max-h-40 overflow-y-auto">
                    <pre className="text-xs text-slate-400 font-mono whitespace-pre-wrap">{viewingItem.rawText}</pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Image Viewer Modal */}
      {viewingImage && (
        <div
          className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setViewingImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] w-full" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setViewingImage(null)}
              className="absolute -top-12 right-0 p-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <img
              src={viewingImage}
              alt="Return label"
              className="w-full h-auto max-h-[85vh] object-contain rounded-xl"
            />
            <div className="absolute bottom-4 right-4">
              <a
                href={viewingImage}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-slate-800/80 hover:bg-slate-700 backdrop-blur rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Open Full Size
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Edit Item Modal */}
      {editingItem && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setEditingItem(null)}>
          <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Edit Return Item</h3>
              <button onClick={() => setEditingItem(null)} className="p-2 hover:bg-slate-700 rounded-lg transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              {editingItem.imageUrl && (
                <div>
                  <label className="block text-slate-400 text-sm mb-2">Label Image</label>
                  <button
                    onClick={() => setViewingImage(editingItem.imageUrl)}
                    className="w-full h-32 rounded-xl overflow-hidden border border-slate-700 hover:border-cyan-500 transition-colors"
                  >
                    <img
                      src={editingItem.imageUrl}
                      alt="Return label"
                      className="w-full h-full object-contain bg-slate-900"
                    />
                  </button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 text-sm mb-1">PO Number</label>
                  <input
                    type="text"
                    value={editingItem.poNumber || ""}
                    onChange={(e) => setEditingItem({ ...editingItem, poNumber: e.target.value })}
                    className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 font-mono transition-all"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 text-sm mb-1">INV Number</label>
                  <input
                    type="text"
                    value={editingItem.invNumber || ""}
                    onChange={(e) => setEditingItem({ ...editingItem, invNumber: e.target.value })}
                    className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 font-mono transition-all"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 text-sm mb-1">Tire Brand</label>
                  <input
                    type="text"
                    value={editingItem.tireBrand || ""}
                    onChange={(e) => setEditingItem({ ...editingItem, tireBrand: e.target.value })}
                    className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 text-sm mb-1">Tire Model</label>
                  <input
                    type="text"
                    value={editingItem.tireModel || ""}
                    onChange={(e) => setEditingItem({ ...editingItem, tireModel: e.target.value })}
                    className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 text-sm mb-1">Tire Size</label>
                  <input
                    type="text"
                    value={editingItem.tireSize || ""}
                    onChange={(e) => setEditingItem({ ...editingItem, tireSize: e.target.value })}
                    className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 text-sm mb-1">Part Number</label>
                  <input
                    type="text"
                    value={editingItem.tirePartNumber || ""}
                    onChange={(e) => setEditingItem({ ...editingItem, tirePartNumber: e.target.value })}
                    className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 font-mono transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">Quantity</label>
                <input
                  type="number"
                  value={editingItem.quantity || 1}
                  onChange={(e) => setEditingItem({ ...editingItem, quantity: parseInt(e.target.value) || 1 })}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
                  min="1"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">Status</label>
                <select
                  value={editingItem.status}
                  onChange={(e) => setEditingItem({ ...editingItem, status: e.target.value })}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
                >
                  <option value="pending">Pending</option>
                  <option value="processed">Processed</option>
                  <option value="not_processed">Not Processed</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">Notes</label>
                <textarea
                  value={editingItem.notes || ""}
                  onChange={(e) => setEditingItem({ ...editingItem, notes: e.target.value })}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 resize-none transition-all"
                  rows={3}
                  placeholder="Add notes about this return..."
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditingItem(null)} className="flex-1 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl font-medium transition-colors">Cancel</button>
                <button onClick={handleUpdateItem} className="flex-1 px-4 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-xl font-medium shadow-lg shadow-cyan-500/25 transition-all">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function ReturnsPage() {
  return (
    <Protected>
      <ReturnsDashboard />
    </Protected>
  );
}
