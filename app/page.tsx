"use client";

import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { useMemo } from "react";
import { Protected } from "./protected";
import { useAuth } from "./auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { GroupedList, GroupedListItem } from "@/components/GroupedList";
import { ChevronRight } from "lucide-react";

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
  const locationOption = LOCATION_OPTIONS.find((loc) => loc.shortId === lowerFilter);
  if (locationOption && lowerLocationId === locationOption.id.toLowerCase()) return true;
  return false;
};

function Dashboard() {
  const { admin } = useAuth();

  const getTodayMidnightEST = () => {
    const now = new Date();
    const estDateStr = now.toLocaleDateString("en-US", { timeZone: "America/New_York" });
    const [month, day, year] = estDateStr.split("/").map(Number);
    const midnightEST = new Date(
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00-05:00`
    );
    return midnightEST.getTime();
  };

  const todayMidnight = getTodayMidnightEST();

  const trucks = useQuery(api.queries.getAllTrucks);
  const scansToday = useQuery(api.queries.getScansToday, { midnightTimestamp: todayMidnight });
  const unresolvedErrorCount = useQuery(api.queries.getUnresolvedErrorCount);

  const effectiveLocationFilter = useMemo(() => {
    if (admin?.allowedLocations.includes("all")) return "all";
    return admin?.allowedLocations[0] || "all";
  }, [admin]);

  const filteredTrucks = useMemo(() => {
    return trucks?.filter((truck) =>
      matchesLocationFilter(truck.locationId, effectiveLocationFilter)
    );
  }, [trucks, effectiveLocationFilter]);

  const trucksToday = filteredTrucks?.filter((t) => t.openedAt >= todayMidnight).length ?? null;
  const openTrucks = filteredTrucks?.filter((t) => t.status === "open").length ?? null;
  const closedToday =
    filteredTrucks?.filter((t) => t.status === "closed" && t.closedAt && t.closedAt >= todayMidnight)
      .length ?? null;

  const trucksLoading = trucks === undefined;
  const scansLoading = scansToday === undefined;

  return (
    <div className="min-h-screen bg-ios-gray6 p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-black">TireTrack Admin</h1>
        <p className="text-ios-gray1 mt-1 text-[15px]">Warehouse Management Dashboard</p>
        {admin && (
          <p className="text-[13px] text-ios-gray1 mt-0.5">
            Signed in as{" "}
            <span className="font-medium text-black">{admin.name}</span>
            {" "}
            <span className="capitalize">({admin.role})</span>
          </p>
        )}
      </header>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {/* Trucks Today */}
        <Card>
          <CardContent className="px-5 py-4">
            {trucksLoading ? (
              <Skeleton className="h-8 w-16 mb-1" />
            ) : (
              <div className="text-3xl font-semibold tracking-tight text-black">
                {trucksToday ?? "—"}
              </div>
            )}
            <div className="text-[13px] text-ios-gray1 mt-1">Trucks Today</div>
          </CardContent>
        </Card>

        {/* Open Trucks */}
        <Card>
          <CardContent className="px-5 py-4">
            {trucksLoading ? (
              <Skeleton className="h-8 w-16 mb-1" />
            ) : (
              <div className="text-3xl font-semibold tracking-tight text-black">
                {openTrucks ?? "—"}
              </div>
            )}
            <div className="text-[13px] text-ios-gray1 mt-1">Open Trucks</div>
          </CardContent>
        </Card>

        {/* Closed Today */}
        <Card>
          <CardContent className="px-5 py-4">
            {trucksLoading ? (
              <Skeleton className="h-8 w-16 mb-1" />
            ) : (
              <div className="text-3xl font-semibold tracking-tight text-black">
                {closedToday ?? "—"}
              </div>
            )}
            <div className="text-[13px] text-ios-gray1 mt-1">Closed Today</div>
          </CardContent>
        </Card>

        {/* Scans Today */}
        <Card>
          <CardContent className="px-5 py-4">
            {scansLoading ? (
              <Skeleton className="h-8 w-20 mb-1" />
            ) : (
              <div className="text-3xl font-semibold tracking-tight text-black">
                {scansToday != null ? scansToday.toLocaleString() : "—"}
              </div>
            )}
            <div className="text-[13px] text-ios-gray1 mt-1">Scans Today</div>
          </CardContent>
        </Card>
      </div>

      {/* Navigation: Manifests & Scanning */}
      <h2 className="text-sm uppercase tracking-wider font-semibold text-ios-gray1 mb-2 px-1">
        Manifests &amp; Scanning
      </h2>
      <GroupedList className="mb-6">
        <GroupedListItem
          href="/manifests"
          label="Manifests"
          value="View trucks, scans, and vendor exports"
          trailing={<ChevronRight className="w-5 h-5" />}
        />
        <GroupedListItem
          href="/returns"
          label="Returns"
          value="View and process return batches"
          trailing={<ChevronRight className="w-5 h-5" />}
        />
        <GroupedListItem
          href="/upcs"
          label="UPCs"
          value="Manage UPC catalog"
          trailing={<ChevronRight className="w-5 h-5" />}
        />
      </GroupedList>

      {/* Navigation: Reporting */}
      <h2 className="text-sm uppercase tracking-wider font-semibold text-ios-gray1 mb-2 px-1">
        Reporting
      </h2>
      <GroupedList className="mb-6">
        <GroupedListItem
          href="/reports"
          label="Reports"
          value="Performance and summary reports"
          trailing={<ChevronRight className="w-5 h-5" />}
        />
        <GroupedListItem
          href="/bonuses"
          label="Bonuses"
          value="Supervisor bonus tracker"
          trailing={<ChevronRight className="w-5 h-5" />}
        />
      </GroupedList>

      {/* Navigation: WMS */}
      <h2 className="text-sm uppercase tracking-wider font-semibold text-ios-gray1 mb-2 px-1">
        Warehouse Management
      </h2>
      <GroupedList className="mb-6">
        <GroupedListItem
          href="/wms"
          label="WMS"
          value="Warehouse management overview"
          trailing={<ChevronRight className="w-5 h-5" />}
        />
        <GroupedListItem
          href="/wms/inventory"
          label="Inventory"
          value="View and manage inventory"
          trailing={<ChevronRight className="w-5 h-5" />}
        />
        <GroupedListItem
          href="/wms/transactions"
          label="Transactions"
          value="WMS transaction history"
          trailing={<ChevronRight className="w-5 h-5" />}
        />
        <GroupedListItem
          href="/wms/floor-builder"
          label="Floor Builder"
          value="Configure warehouse floor layout"
          trailing={<ChevronRight className="w-5 h-5" />}
        />
      </GroupedList>

      {/* Navigation: Administration */}
      <h2 className="text-sm uppercase tracking-wider font-semibold text-ios-gray1 mb-2 px-1">
        Administration
      </h2>
      <GroupedList className="mb-6">
        <GroupedListItem
          href="/app-download"
          label="App Download"
          value="Scanner app distribution"
          trailing={<ChevronRight className="w-5 h-5" />}
        />
        <GroupedListItem
          href="/setup"
          label="Setup"
          value="System configuration"
          trailing={<ChevronRight className="w-5 h-5" />}
        />
        <GroupedListItem
          href="/change-password"
          label="Change Password"
          value="Update your admin password"
          trailing={<ChevronRight className="w-5 h-5" />}
        />
        <GroupedListItem
          href="/errors"
          label={
            <span className="flex items-center gap-2">
              Error Logs
              {(unresolvedErrorCount ?? 0) > 0 && (
                <span className="inline-flex items-center justify-center bg-ios-red text-white text-[11px] font-bold rounded-full min-w-[20px] h-5 px-1.5">
                  {unresolvedErrorCount! > 99 ? "99+" : unresolvedErrorCount}
                </span>
              )}
            </span>
          }
          value="Scan and system error log"
          trailing={<ChevronRight className="w-5 h-5" />}
        />
      </GroupedList>
    </div>
  );
}

export default function Home() {
  return (
    <Protected>
      <Dashboard />
    </Protected>
  );
}
