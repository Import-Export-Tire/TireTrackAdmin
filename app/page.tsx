"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { useState, useMemo } from "react";
import { Protected } from "./protected";
import { useAuth } from "./auth-context";
import Link from "next/link";

const LOCATIONS = [
  { id: "all", name: "All Locations" },
  { id: "latrobe", name: "Latrobe" },
  { id: "everson", name: "Everson" },
  { id: "chestnut", name: "Chestnut" },
];

const LOCATION_OPTIONS = [
  { id: "kj7q0v1qxbf6z1b1h2cjhf4m8h74vjbe", name: "Latrobe", shortId: "latrobe" },
  { id: "kj74zfr66q23wgv5xc3qdc0a6s74vvtr", name: "Everson", shortId: "everson" },
  { id: "kj70r8fvdeg83dhapvp91kqs2574vqng", name: "Chestnut", shortId: "chestnut" },
];

const matchesLocationFilter = (truckLocationId: string | undefined, filterValue: string): boolean => {
  if (filterValue === "all") return true;
  if (!truckLocationId) return false;

  const lowerLocationId = truckLocationId.toLowerCase();
  const lowerFilter = filterValue.toLowerCase();

  if (lowerLocationId.includes(lowerFilter)) return true;

  const locationOption = LOCATION_OPTIONS.find(loc => loc.shortId === lowerFilter);
  if (locationOption && lowerLocationId === locationOption.id.toLowerCase()) return true;

  return false;
};

function Dashboard() {
  const { admin, logout, canManageAdmins, canEdit } = useAuth();
  const [selectedTruck, setSelectedTruck] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showUsers, setShowUsers] = useState(false);
  const [showAdmins, setShowAdmins] = useState(false);
  const [showUnknownReport, setShowUnknownReport] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "closed">("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [selectedScan, setSelectedScan] = useState<any | null>(null);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [userDeleteConfirm, setUserDeleteConfirm] = useState<string | null>(null);
  const [vendorExportTruck, setVendorExportTruck] = useState<string | null>(null);
  const [showNewAdmin, setShowNewAdmin] = useState(false);
  const [showNewUser, setShowNewUser] = useState(false);
  const [newAdmin, setNewAdmin] = useState({ email: "", password: "", name: "", role: "admin" as "admin" | "viewer", locations: ["all"] });
  const [newUser, setNewUser] = useState({ empId: "", name: "", pin: "", locationId: "", locationName: "", role: "user" });
  const [newUserError, setNewUserError] = useState("");
  const [editingAdmin, setEditingAdmin] = useState<{ id: string; email: string; name: string; role: "superadmin" | "admin" | "viewer"; allowedLocations: string[] } | null>(null);
  const [editAdminError, setEditAdminError] = useState("");
  const [markingMiscan, setMarkingMiscan] = useState<{ scanId: string; trackingNumber: string; scannedByName: string } | null>(null);

  const getTodayMidnightEST = () => {
    const now = new Date();
    const estDateStr = now.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
    const [month, day, year] = estDateStr.split('/').map(Number);
    const midnightEST = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00-05:00`);
    return midnightEST.getTime();
  };

  const todayMidnight = getTodayMidnightEST();

  const trucks = useQuery(api.queries.getAllTrucks);
  const users = useQuery(api.queries.getAllUsers);
  const admins = useQuery(api.auth.getAllAdmins);
  const scansToday = useQuery(api.queries.getScansToday, { midnightTimestamp: todayMidnight });

  // Server-side tracking number search (only when query is 3+ chars)
  const trackingSearchResults = useQuery(
    api.queries.searchTrackingNumber,
    searchQuery.length >= 3 ? { trackingNumber: searchQuery, limit: 50 } : "skip"
  );
  const scans = useQuery(
    api.queries.getTruckScans,
    selectedTruck ? { truckId: selectedTruck as any } : "skip"
  );
  const userAccuracyStats = useQuery(
    api.queries.getUserAccuracyStats,
    showUsers ? {} : "skip"
  );

  const deleteTruck = useMutation(api.mutations.deleteTruck);
  const updateUser = useMutation(api.mutations.updateUser);
  const deleteUser = useMutation(api.mutations.deleteUser);
  const createAppUser = useMutation(api.mutations.createAppUser);
  const createAdmin = useMutation(api.auth.createAdmin);
  const updateAdmin = useMutation(api.auth.updateAdmin);
  const deleteAdmin = useMutation(api.auth.deleteAdmin);
  const markScanAsMiscan = useMutation(api.mutations.markScanAsMiscan);

  const effectiveLocationFilter = useMemo(() => {
    if (admin?.allowedLocations.includes("all")) return locationFilter;
    if (locationFilter === "all") return admin?.allowedLocations[0] || "all";
    if (admin?.allowedLocations.includes(locationFilter)) return locationFilter;
    return admin?.allowedLocations[0] || "all";
  }, [admin, locationFilter]);

  const availableLocations = useMemo(() => {
    if (admin?.allowedLocations.includes("all")) return LOCATIONS;
    return LOCATIONS.filter(
      (loc) => loc.id === "all" || admin?.allowedLocations.includes(loc.id)
    );
  }, [admin]);

  // Get truck IDs that have matching tracking numbers from server-side search
  const truckIdsWithMatchingTracking = useMemo(() => {
    if (!trackingSearchResults || trackingSearchResults.length === 0) return new Set<string>();
    return new Set(trackingSearchResults.map((scan: any) => scan.truckId));
  }, [trackingSearchResults]);

  const filteredTrucks = useMemo(() => {
    const filtered = trucks?.filter((truck) => {
      const query = searchQuery.toLowerCase();
      // Search by truck number or vendor locally
      const matchesTruckNumber = truck.truckNumber.toLowerCase().includes(query);
      const matchesVendor = truck.vendors?.some((v) => v && v.toLowerCase().includes(query));
      // Use server-side tracking search results
      const matchesTracking = truckIdsWithMatchingTracking.has(truck._id);
      const matchesSearch = !query || matchesTruckNumber || matchesVendor || matchesTracking;
      const matchesStatus = statusFilter === "all" || truck.status === statusFilter;
      const matchesLocation = matchesLocationFilter(truck.locationId, effectiveLocationFilter);
      return matchesSearch && matchesStatus && matchesLocation;
    });
    return filtered;
  }, [trucks, searchQuery, statusFilter, effectiveLocationFilter, truckIdsWithMatchingTracking]);

  const filteredUsers = useMemo(() => {
    return users?.filter((user) => {
      const matchesLocation = matchesLocationFilter(user.locationId, effectiveLocationFilter) ||
        matchesLocationFilter(user.locationName, effectiveLocationFilter);
      return matchesLocation;
    });
  }, [users, effectiveLocationFilter]);

  const filteredScans = scans?.filter((scan) =>
    scan.trackingNumber?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const trucksToday = filteredTrucks?.filter((t) => t.openedAt >= todayMidnight).length || 0;
  const openTrucks = filteredTrucks?.filter((t) => t.status === "open").length || 0;
  const closedToday = filteredTrucks?.filter((t) =>
    t.status === "closed" && t.closedAt && t.closedAt >= todayMidnight
  ).length || 0;

  const scansByVendor = useMemo(() => {
    if (!scans) return {};
    return scans.reduce((acc, scan) => {
      const vendor = scan.vendor || "Unknown";
      if (!acc[vendor]) acc[vendor] = [];
      acc[vendor].push(scan);
      return acc;
    }, {} as Record<string, typeof scans>);
  }, [scans]);

  const unknownScansAnalysis = useMemo(() => {
    if (!scans) return [];
    const unknowns = scans.filter((s) => !s.vendor || s.vendor === "Unknown");
    return unknowns.slice(0, 50);
  }, [scans]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatExportDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString("en-US", {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getLocationName = (locationId: string) => {
    if (locationId?.toLowerCase().includes("latrobe")) return "LATROBE";
    if (locationId?.toLowerCase().includes("everson")) return "EVERSON";
    if (locationId?.toLowerCase().includes("chestnut")) return "CHESTNUT";
    return locationId?.toUpperCase() || "UNKNOWN";
  };

  const handleDeleteTruck = async (truckId: string) => {
    if (!canEdit) return;
    await deleteTruck({ truckId: truckId as any });
    setDeleteConfirm(null);
    if (selectedTruck === truckId) {
      setSelectedTruck(null);
    }
  };

  const handleUpdateUser = async (userId: string, updates: any) => {
    if (!canEdit) return;
    await updateUser({ userId: userId as any, ...updates });
    setEditingUser(null);
  };

  const handleDeleteUser = async (userId: string) => {
    if (!canEdit) return;
    await deleteUser({ userId: userId as any });
    setUserDeleteConfirm(null);
  };

  const handleCreateUser = async () => {
    if (!canEdit) return;
    setNewUserError("");

    if (!newUser.empId || !newUser.name || !newUser.pin || !newUser.locationId) {
      setNewUserError("All fields are required");
      return;
    }

    if (newUser.pin.length !== 4 || !/^\d+$/.test(newUser.pin)) {
      setNewUserError("PIN must be 4 digits");
      return;
    }

    const result = await createAppUser({
      empId: newUser.empId,
      name: newUser.name,
      pin: newUser.pin,
      locationId: newUser.locationId,
      locationName: newUser.locationName,
      role: newUser.role,
    });

    if (result.success) {
      setShowNewUser(false);
      setNewUser({ empId: "", name: "", pin: "", locationId: "", locationName: "", role: "user" });
    } else {
      setNewUserError(result.error || "Failed to create user");
    }
  };

  const handleCreateAdmin = async () => {
    if (!canManageAdmins || !admin?.id) return;
    const result = await createAdmin({
      callerAdminId: admin.id as any,
      email: newAdmin.email,
      password: newAdmin.password,
      name: newAdmin.name,
      role: newAdmin.role as "admin" | "viewer",
      allowedLocations: newAdmin.locations,
    });
    if (result.success) {
      setShowNewAdmin(false);
      setNewAdmin({ email: "", password: "", name: "", role: "admin", locations: ["all"] });
    }
  };

  const downloadVendorExport = (vendor: string) => {
    const vendorScans = scansByVendor[vendor];
    if (!vendorScans || !selectedTruck) return;

    const truck = trucks?.find((t) => t._id === selectedTruck);
    const locationName = getLocationName(truck?.locationId || "");
    const preparedTime = formatExportDate(Date.now());

    const lines = [
      `Import Export Tire - ${locationName}`,
      `Truck Number: ${truck?.truckNumber || "Unknown"}`,
      `Vendor: ${vendor}`,
      `Time Prepared: ${preparedTime}`,
      ``,
      `Tracking,Vendor,Timestamp`,
    ];

    vendorScans.forEach((s) => {
      lines.push(`${s.trackingNumber},${s.vendor || "Unknown"},${formatExportDate(s.scannedAt)}`);
    });

    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${truck?.truckNumber}-${vendor.replace(/\s+/g, "_")}-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAllManifest = () => {
    if (!scans || !selectedTruck) return;

    const truck = trucks?.find((t) => t._id === selectedTruck);
    const locationName = getLocationName(truck?.locationId || "");
    const preparedTime = formatExportDate(Date.now());

    const lines = [
      `Import Export Tire - ${locationName}`,
      `Truck Number: ${truck?.truckNumber || "Unknown"}`,
      `Vendor: ALL`,
      `Time Prepared: ${preparedTime}`,
      ``,
      `Tracking,Vendor,Timestamp`,
    ];

    scans.forEach((s) => {
      lines.push(`${s.trackingNumber},${s.vendor || "Unknown"},${formatExportDate(s.scannedAt)}`);
    });

    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${truck?.truckNumber}-ALL-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadUnknownReport = () => {
    if (!scans || !selectedTruck) return;

    const truck = trucks?.find((t) => t._id === selectedTruck);
    const locationName = getLocationName(truck?.locationId || "");
    const preparedTime = formatExportDate(Date.now());
    const unknowns = scans.filter((s) => !s.vendor || s.vendor === "Unknown");

    const lines = [
      `Import Export Tire - ${locationName}`,
      `Truck Number: ${truck?.truckNumber || "Unknown"}`,
      `UNKNOWN VENDOR REPORT`,
      `Time Prepared: ${preparedTime}`,
      `Total Unknown: ${unknowns.length}`,
      ``,
      `Tracking,Timestamp,Raw Barcode (partial)`,
    ];

    unknowns.forEach((s) => {
      const rawPartial = (s.rawBarcode || "").substring(0, 100).replace(/,/g, ";");
      lines.push(`${s.trackingNumber},${formatExportDate(s.scannedAt)},"${rawPartial}"`);
    });

    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${truck?.truckNumber}-UNKNOWN-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const unknownCount = scans?.filter((s) => !s.vendor || s.vendor === "Unknown").length || 0;

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      {/* Header */}
      <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-xl sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          {/* Top row - Logo and user controls */}
          <div className="flex items-center justify-between mb-3 lg:mb-0">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-cyan-500/25">
                <svg className="w-6 h-6 sm:w-7 sm:h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg sm:text-2xl font-bold bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
                  TireTrack Admin
                </h1>
                <p className="text-xs sm:text-sm text-slate-500 hidden sm:block">Warehouse Management Dashboard</p>
              </div>
            </div>

            {/* User info */}
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium text-slate-200">{admin?.name}</p>
                <p className="text-xs text-slate-500 capitalize">{admin?.role}</p>
              </div>
              <button
                onClick={logout}
                className="p-2 sm:p-2.5 bg-slate-800/80 hover:bg-red-500/20 border border-slate-700/50 hover:border-red-500/50 rounded-xl transition-all hover:scale-105"
                title="Logout"
              >
                <svg className="w-5 h-5 text-slate-400 hover:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </div>

          {/* Navigation and controls */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            {/* Navigation tabs */}
            <div className="flex gap-1 bg-slate-800/60 border border-slate-700/50 rounded-xl p-1 overflow-x-auto">
              <button
                onClick={() => { setShowUsers(false); setShowAdmins(false); }}
                className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap flex items-center gap-1.5 ${
                  !showUsers && !showAdmins
                    ? "bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg shadow-cyan-500/25"
                    : "text-slate-400 hover:text-white hover:bg-slate-700/50"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <span className="hidden sm:inline">Manifests</span>
              </button>
              <Link
                href="/returns"
                className="px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-700/50 transition-all whitespace-nowrap flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span className="hidden sm:inline">Returns</span>
              </Link>
              <Link
                href="/upcs"
                className="px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-700/50 transition-all whitespace-nowrap flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                <span className="hidden sm:inline">UPCs</span>
              </Link>
              <Link
                href="/reports"
                className="px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-700/50 transition-all whitespace-nowrap flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <span className="hidden sm:inline">Reports</span>
              </Link>
              <Link
                href="/app-download"
                className="px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-700/50 transition-all whitespace-nowrap flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <span className="hidden sm:inline">App</span>
              </Link>
              <button
                onClick={() => { setShowUsers(true); setShowAdmins(false); }}
                className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap flex items-center gap-1.5 ${
                  showUsers && !showAdmins
                    ? "bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg shadow-cyan-500/25"
                    : "text-slate-400 hover:text-white hover:bg-slate-700/50"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <span className="hidden sm:inline">Users</span>
              </button>
              {canManageAdmins && (
                <button
                  onClick={() => { setShowAdmins(true); setShowUsers(false); }}
                  className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap flex items-center gap-1.5 ${
                    showAdmins
                      ? "bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg shadow-cyan-500/25"
                      : "text-slate-400 hover:text-white hover:bg-slate-700/50"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span className="hidden sm:inline">Admins</span>
                </button>
              )}
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2 sm:gap-3 sm:ml-auto">
              <div className="relative">
                <select
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                  className="flex-1 sm:flex-none pl-3 pr-8 py-2 sm:py-2.5 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all appearance-none cursor-pointer hover:border-slate-600"
                >
                  {availableLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>
                <svg className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>

              <div className="relative flex-1 sm:flex-none">
                <svg className="w-4 h-4 sm:w-5 sm:h-5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Truck, vendor, tracking..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full sm:w-56 pl-9 sm:pl-10 pr-3 sm:pr-4 py-2 sm:py-2.5 bg-slate-800/80 border border-slate-700/50 rounded-xl text-sm focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all"
                />
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-4 sm:p-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
          <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl sm:rounded-2xl p-4 sm:p-5 hover:border-slate-600/50 transition-all group">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-500 text-xs sm:text-sm font-medium">Trucks Today</p>
                <p className="text-2xl sm:text-3xl font-bold mt-1 text-white">{trucksToday}</p>
              </div>
              <div className="w-11 h-11 sm:w-14 sm:h-14 bg-slate-700/50 group-hover:bg-slate-700 rounded-xl sm:rounded-2xl flex items-center justify-center transition-colors">
                <svg className="w-6 h-6 sm:w-7 sm:h-7 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl sm:rounded-2xl p-4 sm:p-5 hover:border-emerald-500/30 transition-all group">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-500 text-xs sm:text-sm font-medium">Open Trucks</p>
                <p className="text-2xl sm:text-3xl font-bold mt-1 text-emerald-400">{openTrucks}</p>
              </div>
              <div className="w-11 h-11 sm:w-14 sm:h-14 bg-emerald-500/10 group-hover:bg-emerald-500/20 rounded-xl sm:rounded-2xl flex items-center justify-center transition-colors">
                <svg className="w-6 h-6 sm:w-7 sm:h-7 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl sm:rounded-2xl p-4 sm:p-5 hover:border-slate-600/50 transition-all group">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-500 text-xs sm:text-sm font-medium">Closed Today</p>
                <p className="text-2xl sm:text-3xl font-bold mt-1 text-slate-300">{closedToday}</p>
              </div>
              <div className="w-11 h-11 sm:w-14 sm:h-14 bg-slate-700/50 group-hover:bg-slate-700 rounded-xl sm:rounded-2xl flex items-center justify-center transition-colors">
                <svg className="w-6 h-6 sm:w-7 sm:h-7 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-xl sm:rounded-2xl p-4 sm:p-5 hover:border-cyan-500/30 transition-all group">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-500 text-xs sm:text-sm font-medium">Scans Today</p>
                <p className="text-2xl sm:text-3xl font-bold mt-1 text-cyan-400">{(scansToday ?? 0).toLocaleString()}</p>
              </div>
              <div className="w-11 h-11 sm:w-14 sm:h-14 bg-cyan-500/10 group-hover:bg-cyan-500/20 rounded-xl sm:rounded-2xl flex items-center justify-center transition-colors">
                <svg className="w-6 h-6 sm:w-7 sm:h-7 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {showAdmins ? (
          /* Admin Management */
          <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-5 sm:p-6 border-b border-slate-700/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-500/10 rounded-xl flex items-center justify-center">
                    <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-lg sm:text-xl font-semibold text-white">Admin Users</h2>
                    <p className="text-slate-500 text-xs sm:text-sm">Manage dashboard access</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowNewAdmin(true)}
                  className="px-4 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-xl text-sm font-medium shadow-lg shadow-cyan-500/20 transition-all hover:scale-105 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Admin
                </button>
              </div>
            </div>
            {admins === undefined ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-10 h-10 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-900/50 border-b border-slate-700/50">
                      <th className="px-5 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Name</th>
                      <th className="px-5 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider hidden sm:table-cell">Email</th>
                      <th className="px-5 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Role</th>
                      <th className="px-5 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider hidden md:table-cell">Locations</th>
                      <th className="px-5 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                      <th className="px-5 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider hidden lg:table-cell">Last Login</th>
                      <th className="px-5 py-4 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/30">
                    {admins.map((a) => (
                      <tr key={a.id} className="hover:bg-slate-800/50 transition-colors">
                        <td className="px-5 py-4 font-medium text-white">{a.name}</td>
                        <td className="px-5 py-4 text-slate-400 hidden sm:table-cell">{a.email}</td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${
                            a.role === "superadmin"
                              ? "bg-purple-500/20 text-purple-400 border border-purple-500/20"
                              : a.role === "admin"
                              ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/20"
                              : "bg-slate-700 text-slate-300 border border-slate-600"
                          }`}>
                            {a.role}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-slate-400 text-sm hidden md:table-cell">
                          {a.allowedLocations.includes("all") ? "All" : a.allowedLocations.join(", ")}
                        </td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${
                            a.isActive
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/20"
                              : "bg-red-500/20 text-red-400 border border-red-500/20"
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${a.isActive ? "bg-emerald-400" : "bg-red-400"}`}></span>
                            {a.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-slate-500 text-sm hidden lg:table-cell">
                          {a.lastLoginAt ? formatDate(a.lastLoginAt) : "Never"}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setEditingAdmin({ id: a.id, email: a.email, name: a.name, role: a.role, allowedLocations: a.allowedLocations })}
                              className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
                              title="Edit"
                            >
                              <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => admin?.id && updateAdmin({ callerAdminId: admin.id as any, adminId: a.id as any, isActive: !a.isActive })}
                              className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
                              title={a.isActive ? "Deactivate" : "Activate"}
                            >
                              {a.isActive ? (
                                <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                </svg>
                              ) : (
                                <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              )}
                            </button>
                            {a.id !== admin?.id && (
                              <button
                                onClick={() => admin?.id && deleteAdmin({ callerAdminId: admin.id as any, adminId: a.id as any })}
                                className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
                                title="Delete"
                              >
                                <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : showUsers ? (
          /* App Users Management */
          <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-5 sm:p-6 border-b border-slate-700/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center">
                    <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-lg sm:text-xl font-semibold text-white">App Users</h2>
                    <p className="text-slate-500 text-xs sm:text-sm">{filteredUsers?.length || 0} warehouse users</p>
                  </div>
                </div>
                {canEdit && (
                  <button
                    onClick={() => setShowNewUser(true)}
                    className="px-4 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-xl text-sm font-medium shadow-lg shadow-cyan-500/20 transition-all hover:scale-105 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add User
                  </button>
                )}
              </div>
            </div>
            {users === undefined ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-10 h-10 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-900/50 border-b border-slate-700/50">
                      <th className="px-5 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Name</th>
                      <th className="px-5 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider hidden sm:table-cell">Employee ID</th>
                      <th className="px-5 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Location</th>
                      <th className="px-5 py-4 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider hidden md:table-cell">This Month</th>
                      <th className="px-5 py-4 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider hidden md:table-cell">All Time</th>
                      <th className="px-5 py-4 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider hidden lg:table-cell">Accuracy</th>
                      <th className="px-5 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                      {canEdit && <th className="px-5 py-4 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/30">
                    {filteredUsers?.map((user) => {
                      const userStats = userAccuracyStats?.users?.find((u: any) => u.userId === user._id);
                      const accuracy = userStats?.accuracy ?? 100;
                      const accuracyColor = accuracy >= 99 ? "text-emerald-400" : accuracy >= 98 ? "text-yellow-400" : "text-red-400";
                      return (
                      <tr key={user._id} className="hover:bg-slate-800/50 transition-colors">
                        <td className="px-5 py-4 font-medium text-white">{user.name}</td>
                        <td className="px-5 py-4 text-slate-400 font-mono text-sm hidden sm:table-cell">{user.empId}</td>
                        <td className="px-5 py-4 text-slate-300">{user.locationName || "-"}</td>
                        <td className="px-5 py-4 text-right hidden md:table-cell">
                          {userStats ? (
                            <div>
                              <span className="font-semibold text-white">{userStats.monthlyScans?.toLocaleString() || 0}</span>
                              {userStats.monthlyBadScans > 0 && (
                                <span className="text-red-400 text-xs ml-1">({userStats.monthlyBadScans} bad)</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-600">-</span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-right hidden md:table-cell">
                          {userStats ? (
                            <div>
                              <span className="text-slate-300">{userStats.totalScans?.toLocaleString() || 0}</span>
                              {userStats.badScans > 0 && (
                                <span className="text-red-400 text-xs ml-1">({userStats.badScans} bad)</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-600">-</span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-right hidden lg:table-cell">
                          {userStats && userStats.totalScans > 0 ? (
                            <span className={`font-semibold ${accuracyColor}`}>{accuracy.toFixed(1)}%</span>
                          ) : (
                            <span className="text-slate-600">-</span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${
                            user.isActive !== false
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/20"
                              : "bg-red-500/20 text-red-400 border border-red-500/20"
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${user.isActive !== false ? "bg-emerald-400" : "bg-red-400"}`}></span>
                            {user.isActive !== false ? "Active" : "Inactive"}
                          </span>
                        </td>
                        {canEdit && (
                          <td className="px-5 py-4">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => setEditingUser(user)}
                                className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
                                title="Edit"
                              >
                                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => handleUpdateUser(user._id, { isActive: !user.isActive })}
                                className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
                                title={user.isActive ? "Deactivate" : "Activate"}
                              >
                                {user.isActive !== false ? (
                                  <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                  </svg>
                                ) : (
                                  <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                )}
                              </button>
                              <button
                                onClick={() => setUserDeleteConfirm(user._id)}
                                className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
                                title="Delete"
                              >
                                <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          /* Trucks & Scans */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
            {/* Trucks Panel */}
            <div className="bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-2xl overflow-hidden shadow-xl">
              <div className="p-5 border-b border-slate-700/30">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-slate-700/50 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                      </svg>
                    </div>
                    <h2 className="text-lg font-semibold text-white">Trucks</h2>
                  </div>
                </div>
                <div className="flex gap-1 bg-slate-900/50 rounded-xl p-1">
                  {(["all", "open", "closed"] as const).map((status) => (
                    <button
                      key={status}
                      onClick={() => setStatusFilter(status)}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                        statusFilter === status
                          ? "bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg"
                          : "text-slate-400 hover:text-white hover:bg-slate-700/50"
                      }`}
                    >
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              {trucks === undefined ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-10 h-10 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : (
                <div className="p-3 space-y-2 max-h-[600px] overflow-y-auto">
                  {filteredTrucks?.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                      <svg className="w-12 h-12 mb-3 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                      </svg>
                      <p className="text-sm">No trucks found</p>
                    </div>
                  ) : (
                    filteredTrucks?.map((truck) => (
                      <div
                        key={truck._id}
                        className={`relative group p-4 rounded-xl transition-all cursor-pointer ${
                          selectedTruck === truck._id
                            ? "bg-gradient-to-r from-cyan-600 to-blue-600 shadow-lg shadow-cyan-500/20"
                            : "bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/30 hover:border-slate-600/50"
                        }`}
                        onClick={() => { setSelectedTruck(truck._id); setVendorExportTruck(null); setShowUnknownReport(false); }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full ${truck.status === "open" ? "bg-emerald-400 animate-pulse" : "bg-slate-400"}`}></div>
                            <div>
                              <div className="font-semibold text-white">{truck.truckNumber}</div>
                              <div className="text-sm text-slate-300 mt-0.5 flex items-center gap-2 flex-wrap">
                                <span className="text-slate-400">{truck.carrier}</span>
                                <span className="text-slate-600">|</span>
                                <span className="font-medium">{truck.scanCount || 0} scans</span>
                              </div>
                              <div className="text-xs text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                                <span>{getLocationName(truck.locationId)}</span>
                                <span className="text-slate-600">|</span>
                                <span className="text-cyan-400/70">Opened: {truck.openedByName || "Unknown"}</span>
                                {truck.closedByName && (
                                  <>
                                    <span className="text-slate-600">|</span>
                                    <span className="text-amber-400/70">Closed: {truck.closedByName}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          {canEdit && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setDeleteConfirm(truck._id); }}
                              className="opacity-0 group-hover:opacity-100 p-2 hover:bg-red-500/20 rounded-lg transition-all"
                            >
                              <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>
                        {deleteConfirm === truck._id && (
                          <div className="absolute inset-0 bg-slate-900/95 rounded-xl flex items-center justify-center gap-3 z-10 backdrop-blur-sm">
                            <span className="text-sm">Delete truck & all scans?</span>
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteTruck(truck._id); }} className="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-medium transition-colors">Yes</button>
                            <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(null); }} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition-colors">No</button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Scans Panel */}
            <div className="lg:col-span-2 bg-slate-800/40 backdrop-blur border border-slate-700/30 rounded-2xl overflow-hidden shadow-xl">
              <div className="p-5 border-b border-slate-700/30">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-cyan-500/10 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-white">Scans</h2>
                      {selectedTruck && <p className="text-cyan-400 text-sm">{filteredScans?.length || 0} records</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedTruck && unknownCount > 0 && (
                      <button
                        onClick={() => setShowUnknownReport(!showUnknownReport)}
                        className={`px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center gap-2 ${
                          showUnknownReport
                            ? "bg-amber-600 text-white shadow-lg shadow-amber-500/20"
                            : "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30"
                        }`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        {unknownCount} Unknown
                      </button>
                    )}
                    {selectedTruck && scans && scans.length > 0 && (
                      <div className="relative">
                        <button
                          onClick={() => setVendorExportTruck(vendorExportTruck ? null : selectedTruck)}
                          className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-xl text-sm font-medium shadow-lg shadow-cyan-500/20 transition-all hover:scale-105 flex items-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          Export
                          <svg className={`w-4 h-4 transition-transform ${vendorExportTruck ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {vendorExportTruck === selectedTruck && (
                          <div className="absolute right-0 mt-2 w-56 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-30 overflow-hidden">
                            <div className="p-2">
                              <button onClick={() => { downloadAllManifest(); setVendorExportTruck(null); }} className="w-full text-left px-3 py-2.5 hover:bg-slate-700 rounded-lg text-sm transition-colors flex items-center justify-between">
                                <span className="flex items-center gap-2">
                                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                                  </svg>
                                  All Vendors
                                </span>
                                <span className="text-slate-500 text-xs">{scans.length}</span>
                              </button>
                              {unknownCount > 0 && (
                                <button onClick={() => { downloadUnknownReport(); setVendorExportTruck(null); }} className="w-full text-left px-3 py-2.5 hover:bg-slate-700 rounded-lg text-sm transition-colors flex items-center justify-between text-amber-400">
                                  <span className="flex items-center gap-2">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                    Unknown Report
                                  </span>
                                  <span className="text-xs">{unknownCount}</span>
                                </button>
                              )}
                              <div className="border-t border-slate-700 my-2"></div>
                              {Object.entries(scansByVendor).filter(([vendor]) => vendor !== "Unknown").map(([vendor, vendorScans]) => (
                                <button key={vendor} onClick={() => { downloadVendorExport(vendor); setVendorExportTruck(null); }} className="w-full text-left px-3 py-2.5 hover:bg-slate-700 rounded-lg text-sm transition-colors flex items-center justify-between">
                                  <span>{vendor}</span>
                                  <span className="text-slate-500 text-xs">{vendorScans.length}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {!selectedTruck ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                  <svg className="w-16 h-16 mb-4 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <p className="text-lg font-medium mb-1">No truck selected</p>
                  <p className="text-sm text-slate-600">Select a truck to view scans</p>
                </div>
              ) : scans === undefined ? (
                <div className="flex items-center justify-center py-20">
                  <div className="w-10 h-10 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : showUnknownReport ? (
                <div className="p-5">
                  <div className="mb-4 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                    <div className="flex items-center gap-3">
                      <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <div>
                        <h3 className="font-medium text-amber-400">Unknown Scans</h3>
                        <p className="text-sm text-slate-400">Scans that couldn't be matched to a vendor</p>
                      </div>
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                    <table className="w-full">
                      <thead className="sticky top-0 bg-slate-900">
                        <tr className="text-left text-slate-400 text-xs border-b border-slate-700">
                          <th className="pb-3 font-medium">Tracking #</th>
                          <th className="pb-3 font-medium">Scanned By</th>
                          <th className="pb-3 font-medium">Time</th>
                          <th className="pb-3 font-medium">Status</th>
                          <th className="pb-3 font-medium"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/30">
                        {unknownScansAnalysis.map((scan) => (
                          <tr key={scan._id} className={`hover:bg-slate-800/50 transition-colors ${scan.isMiscan ? "bg-red-500/10" : ""}`}>
                            <td className="py-3 font-mono text-cyan-300 text-sm">{scan.trackingNumber}</td>
                            <td className="py-3 text-slate-300 text-sm">{scan.scannedByName || "Unknown"}</td>
                            <td className="py-3 text-slate-500 text-sm">{formatDate(scan.scannedAt)}</td>
                            <td className="py-3">
                              {scan.isMiscan ? (
                                <span className="inline-flex items-center px-2 py-1 rounded-lg text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/20">
                                  Bad Scan
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-1 rounded-lg text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/20">
                                  Unknown
                                </span>
                              )}
                            </td>
                            <td className="py-3">
                              {!scan.isMiscan && canEdit && (
                                <button
                                  onClick={() => setMarkingMiscan({ scanId: scan._id, trackingNumber: scan.trackingNumber, scannedByName: scan.scannedByName || "Unknown" })}
                                  className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs rounded-lg border border-red-500/20 transition-colors"
                                  title="Mark as bad scan"
                                >
                                  Mark Bad
                                </button>
                              )}
                              {scan.isMiscan && canEdit && (
                                <button
                                  onClick={async () => {
                                    await markScanAsMiscan({ scanId: scan._id as any, isMiscan: false });
                                  }}
                                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors"
                                  title="Undo bad scan"
                                >
                                  Undo
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-slate-900/95 backdrop-blur-sm">
                      <tr className="text-left text-slate-400 text-xs border-b border-slate-700">
                        <th className="px-5 py-3 font-semibold uppercase tracking-wider">Tracking #</th>
                        <th className="px-5 py-3 font-semibold uppercase tracking-wider">Vendor</th>
                        <th className="px-5 py-3 font-semibold uppercase tracking-wider hidden sm:table-cell">Destination</th>
                        <th className="px-5 py-3 font-semibold uppercase tracking-wider hidden md:table-cell">Time</th>
                        <th className="px-5 py-3 font-semibold uppercase tracking-wider"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/30">
                      {filteredScans?.map((scan) => (
                        <tr key={scan._id} className="hover:bg-slate-800/50 transition-colors">
                          <td className="px-5 py-3 font-mono text-xs text-cyan-300">{scan.trackingNumber}</td>
                          <td className="px-5 py-3">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${
                              scan.vendor === "Unknown" || !scan.vendor
                                ? "bg-red-500/20 text-red-400 border border-red-500/20"
                                : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/20"
                            }`}>
                              {scan.vendor || "Unknown"}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-slate-300 text-sm hidden sm:table-cell">{scan.destination || "-"}</td>
                          <td className="px-5 py-3 text-slate-500 text-sm hidden md:table-cell">{formatDate(scan.scannedAt)}</td>
                          <td className="px-5 py-3">
                            <button onClick={() => setSelectedScan(scan)} className="p-2 hover:bg-slate-700 rounded-lg transition-colors" title="View Details">
                              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {selectedScan && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setSelectedScan(null)}>
          <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Scan Details</h3>
              <button onClick={() => setSelectedScan(null)} className="p-2 hover:bg-slate-700 rounded-lg transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-slate-400 text-sm mb-1">Tracking</p><p className="font-mono text-cyan-300">{selectedScan.trackingNumber}</p></div>
                <div><p className="text-slate-400 text-sm mb-1">Carrier</p><p>{selectedScan.carrier || "-"}</p></div>
                <div><p className="text-slate-400 text-sm mb-1">Vendor</p><p className={!selectedScan.vendor || selectedScan.vendor === "Unknown" ? "text-red-400" : "text-emerald-400"}>{selectedScan.vendor || "Unknown"}</p></div>
                <div><p className="text-slate-400 text-sm mb-1">Account</p><p className="font-mono text-sm">{selectedScan.vendorAccount || "-"}</p></div>
                <div><p className="text-slate-400 text-sm mb-1">Destination</p><p>{selectedScan.destination || "-"}</p></div>
                <div><p className="text-slate-400 text-sm mb-1">Recipient</p><p>{selectedScan.recipientName || "-"}</p></div>
                <div><p className="text-slate-400 text-sm mb-1">Scanned By</p><p className="text-cyan-400">{selectedScan.scannedByName || "Unknown"}</p></div>
                <div><p className="text-slate-400 text-sm mb-1">Scanned At</p><p className="text-slate-300">{selectedScan.scannedAt ? new Date(selectedScan.scannedAt).toLocaleString() : "-"}</p></div>
              </div>
              {selectedScan.address && (
                <div><p className="text-slate-400 text-sm mb-1">Address</p><p>{selectedScan.address}{selectedScan.city ? `, ${selectedScan.city}` : ""}{selectedScan.state ? `, ${selectedScan.state}` : ""}</p></div>
              )}
              <div>
                <p className="text-slate-400 text-sm mb-2">Raw Barcode</p>
                <pre className="bg-slate-900 p-4 rounded-xl text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all border border-slate-700">{selectedScan.rawBarcode}</pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingUser && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setEditingUser(null)}>
          <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Edit User</h3>
              <button onClick={() => setEditingUser(null)} className="p-2 hover:bg-slate-700 rounded-lg transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form className="p-6 space-y-4" onSubmit={async (e) => { e.preventDefault(); const form = e.target as HTMLFormElement; const formData = new FormData(form); const updates: any = {}; const name = formData.get("name") as string; const pin = formData.get("pin") as string; if (name && name.trim()) updates.name = name.trim(); if (pin && pin.length === 4 && /^\d{4}$/.test(pin)) updates.pin = pin; if (Object.keys(updates).length > 0) { await handleUpdateUser(editingUser._id, updates); } else { setEditingUser(null); } }}>
              <div><label className="block text-slate-400 text-sm mb-2">Name</label><input type="text" name="name" defaultValue={editingUser.name} required className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all" /></div>
              <div><label className="block text-slate-400 text-sm mb-2">New PIN (4 digits)</label><input type="text" name="pin" placeholder="Leave blank to keep current" maxLength={4} pattern="\d{4}" className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all font-mono" /><p className="text-xs text-slate-500 mt-1">Enter 4 digits to change PIN</p></div>
              <div className="flex gap-3 pt-2"><button type="button" onClick={() => setEditingUser(null)} className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl font-medium transition-colors">Cancel</button><button type="submit" className="flex-1 px-4 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-xl font-medium shadow-lg shadow-cyan-500/20 transition-all">Save</button></div>
            </form>
          </div>
        </div>
      )}

      {userDeleteConfirm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setUserDeleteConfirm(null)}>
          <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-sm w-full p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">Delete User?</h3>
              <p className="text-slate-400 text-sm mb-6">Consider deactivating instead of deleting.</p>
              <div className="flex gap-3"><button onClick={() => setUserDeleteConfirm(null)} className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl font-medium transition-colors">Cancel</button><button onClick={() => handleDeleteUser(userDeleteConfirm)} className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-500 rounded-xl font-medium transition-colors">Delete</button></div>
            </div>
          </div>
        </div>
      )}

      {editingAdmin && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => { setEditingAdmin(null); setEditAdminError(""); }}>
          <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Edit Admin</h3>
              <button onClick={() => { setEditingAdmin(null); setEditAdminError(""); }} className="p-2 hover:bg-slate-700 rounded-lg transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              {editAdminError && (<div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">{editAdminError}</div>)}
              <div><label className="block text-slate-400 text-sm mb-2">Name</label><input type="text" value={editingAdmin.name} onChange={(e) => setEditingAdmin({ ...editingAdmin, name: e.target.value })} className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all" /></div>
              <div><label className="block text-slate-400 text-sm mb-2">Email</label><input type="email" value={editingAdmin.email} onChange={(e) => setEditingAdmin({ ...editingAdmin, email: e.target.value })} className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all" /></div>
              <div><label className="block text-slate-400 text-sm mb-2">Role</label><select value={editingAdmin.role} onChange={(e) => setEditingAdmin({ ...editingAdmin, role: e.target.value as "superadmin" | "admin" | "viewer" })} className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"><option value="superadmin">Superadmin</option><option value="admin">Admin</option><option value="viewer">Viewer</option></select></div>
              <div><label className="block text-slate-400 text-sm mb-2">Location Access</label><select value={editingAdmin.allowedLocations[0] || "all"} onChange={(e) => setEditingAdmin({ ...editingAdmin, allowedLocations: [e.target.value] })} className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"><option value="all">All Locations</option><option value="latrobe">Latrobe</option><option value="everson">Everson</option><option value="chestnut">Chestnut</option></select></div>
              <div className="flex gap-3 pt-2"><button onClick={() => { setEditingAdmin(null); setEditAdminError(""); }} className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl font-medium transition-colors">Cancel</button><button onClick={async () => {
                if (!editingAdmin.name.trim() || !editingAdmin.email.trim()) {
                  setEditAdminError("Name and email are required");
                  return;
                }
                if (!admin?.id) return;
                const result = await updateAdmin({ callerAdminId: admin.id as any, adminId: editingAdmin.id as any, name: editingAdmin.name, email: editingAdmin.email, role: editingAdmin.role, allowedLocations: editingAdmin.allowedLocations });
                if (result.success) {
                  setEditingAdmin(null);
                  setEditAdminError("");
                } else {
                  setEditAdminError(result.error || "Failed to update admin");
                }
              }} className="flex-1 px-4 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-xl font-medium shadow-lg shadow-cyan-500/20 transition-all">Save</button></div>
            </div>
          </div>
        </div>
      )}

      {markingMiscan && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setMarkingMiscan(null)}>
          <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-sm w-full p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">Mark as Bad Scan?</h3>
              <p className="text-slate-400 text-sm mb-2">This will log the bad scan against the user:</p>
              <p className="text-cyan-400 font-medium mb-2">{markingMiscan.scannedByName}</p>
              <p className="text-slate-500 text-xs font-mono mb-6">{markingMiscan.trackingNumber}</p>
              <div className="flex gap-3">
                <button onClick={() => setMarkingMiscan(null)} className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl font-medium transition-colors">Cancel</button>
                <button
                  onClick={async () => {
                    await markScanAsMiscan({ scanId: markingMiscan.scanId as any, isMiscan: true });
                    setMarkingMiscan(null);
                  }}
                  className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-500 rounded-xl font-medium transition-colors"
                >
                  Mark Bad
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showNewAdmin && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowNewAdmin(false)}>
          <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Add Admin</h3>
              <button onClick={() => setShowNewAdmin(false)} className="p-2 hover:bg-slate-700 rounded-lg transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div><label className="block text-slate-400 text-sm mb-2">Name</label><input type="text" value={newAdmin.name} onChange={(e) => setNewAdmin({ ...newAdmin, name: e.target.value })} className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all" /></div>
              <div><label className="block text-slate-400 text-sm mb-2">Email</label><input type="email" value={newAdmin.email} onChange={(e) => setNewAdmin({ ...newAdmin, email: e.target.value })} className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all" /></div>
              <div><label className="block text-slate-400 text-sm mb-2">Temp Password</label><input type="password" value={newAdmin.password} onChange={(e) => setNewAdmin({ ...newAdmin, password: e.target.value })} className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all" /><p className="text-xs text-slate-500 mt-2">User will be required to change on first login</p></div>
              <div><label className="block text-slate-400 text-sm mb-2">Role</label><select value={newAdmin.role} onChange={(e) => setNewAdmin({ ...newAdmin, role: e.target.value as "admin" | "viewer" })} className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"><option value="admin">Admin</option><option value="viewer">Viewer</option></select></div>
              <div><label className="block text-slate-400 text-sm mb-2">Locations</label><select value={newAdmin.locations[0]} onChange={(e) => setNewAdmin({ ...newAdmin, locations: [e.target.value] })} className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"><option value="all">All Locations</option><option value="latrobe">Latrobe</option><option value="everson">Everson</option><option value="chestnut">Chestnut</option></select></div>
              <div className="flex gap-3 pt-2"><button onClick={() => setShowNewAdmin(false)} className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl font-medium transition-colors">Cancel</button><button onClick={handleCreateAdmin} className="flex-1 px-4 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-xl font-medium shadow-lg shadow-cyan-500/20 transition-all">Create</button></div>
            </div>
          </div>
        </div>
      )}

      {showNewUser && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowNewUser(false)}>
          <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Add App User</h3>
              <button onClick={() => setShowNewUser(false)} className="p-2 hover:bg-slate-700 rounded-lg transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              {newUserError && (<div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">{newUserError}</div>)}
              <div><label className="block text-slate-400 text-sm mb-2">Name *</label><input type="text" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all" placeholder="John Smith" /></div>
              <div><label className="block text-slate-400 text-sm mb-2">Employee ID *</label><input type="text" value={newUser.empId} onChange={(e) => setNewUser({ ...newUser, empId: e.target.value })} className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all font-mono" placeholder="EMP001" /></div>
              <div><label className="block text-slate-400 text-sm mb-2">PIN (4 digits) *</label><input type="text" value={newUser.pin} onChange={(e) => setNewUser({ ...newUser, pin: e.target.value.replace(/\D/g, "").slice(0, 4) })} maxLength={4} className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all font-mono" placeholder="1234" /></div>
              <div><label className="block text-slate-400 text-sm mb-2">Location *</label><select value={newUser.locationId} onChange={(e) => { const loc = LOCATION_OPTIONS.find(l => l.id === e.target.value); setNewUser({ ...newUser, locationId: e.target.value, locationName: loc?.name || "" }); }} className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"><option value="">Select location...</option>{LOCATION_OPTIONS.map((loc) => (<option key={loc.id} value={loc.id}>{loc.name}</option>))}</select></div>
              <div><label className="block text-slate-400 text-sm mb-2">Role</label><select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"><option value="user">User</option><option value="supervisor">Supervisor</option></select></div>
              <div className="flex gap-3 pt-2"><button onClick={() => { setShowNewUser(false); setNewUserError(""); }} className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl font-medium transition-colors">Cancel</button><button onClick={handleCreateUser} className="flex-1 px-4 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-xl font-medium shadow-lg shadow-cyan-500/20 transition-all">Create</button></div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function Home() {
  return (
    <Protected>
      <Dashboard />
    </Protected>
  );
}
