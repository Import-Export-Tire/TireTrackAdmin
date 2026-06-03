"use client";

import { useState, useEffect, useCallback } from "react";
import { Protected } from "../protected";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { GroupedList, GroupedListItem } from "@/components/GroupedList";
import { Download, RefreshCw } from "lucide-react";

interface ExpoBuild {
  id: string;
  platform: string;
  status: string;
  appVersion: string;
  buildProfile: string;
  gitCommitHash: string;
  createdAt: string;
  completedAt: string;
  artifacts: {
    buildUrl: string;
  };
}

interface BuildsResponse {
  success: boolean;
  latestBuild: ExpoBuild | null;
  allBuilds: ExpoBuild[];
  error?: string;
  timestamp?: string;
}

// Auto-refresh interval (5 minutes)
const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000;
// Max retry attempts
const MAX_RETRIES = 3;

// Version changelog - add new versions at the top
const VERSION_NOTES: Record<string, { date: string; features: string[] }> = {
  "1.1.4": {
    date: "2026-01-29",
    features: [
      "Removed AI label reading - now captures photo for reference only (faster)",
      "Added Part Number field to manual tire entry",
      "Part number auto-fills when selecting matched tire from UPC database",
      "Part number displays in review summary before saving",
    ],
  },
  "1.1.3": {
    date: "2026-01-15",
    features: [
      "Added flashlight toggle for camera",
      "Added zoom controls for camera",
      "Added autofocus for better barcode scanning",
    ],
  },
  "1.1.2": {
    date: "2026-01-10",
    features: [
      "Fixed white screen crash on manual return entry",
    ],
  },
  "1.1.1": {
    date: "2026-01-08",
    features: [
      "Code cleanup and performance improvements",
    ],
  },
  "1.1.0": {
    date: "2026-01-06",
    features: [
      "AI-powered barcode fallback for damaged/unclear barcodes",
      "Improved UPC scanning reliability",
    ],
  },
  "1.0.0": {
    date: "2025-12-01",
    features: [
      "Initial release",
      "Truck manifest scanning",
      "Return label scanning with AI extraction",
      "UPC barcode scanning for tire identification",
    ],
  },
};

export default function AppDownloadPage() {
  const [builds, setBuilds] = useState<BuildsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const fetchBuilds = useCallback(async (isRetry = false) => {
    if (!isRetry) {
      setLoading(true);
      setRetryCount(0);
    }
    setError(null);

    try {
      // Add cache-busting query param
      const response = await fetch(`/api/expo-builds?t=${Date.now()}`, {
        cache: "no-store",
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to fetch builds");
      }

      setBuilds(data);
      setLastFetched(new Date());
      setRetryCount(0);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);

      // Auto-retry with exponential backoff
      if (retryCount < MAX_RETRIES) {
        const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
        setRetryCount((prev) => prev + 1);
        setTimeout(() => fetchBuilds(true), delay);
      }
    } finally {
      setLoading(false);
    }
  }, [retryCount]);

  // Initial fetch
  useEffect(() => {
    fetchBuilds();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      fetchBuilds();
    }, AUTO_REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [fetchBuilds]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  return (
    <Protected>
      <div className="min-h-screen p-4 sm:p-6 max-w-3xl mx-auto">
        <PageHeader
          title="TireTrack Lite App"
          subtitle="Download the latest Android APK"
          backHref="/"
          right={
            <div className="flex items-center gap-2">
              {retryCount > 0 && retryCount <= MAX_RETRIES && (
                <span className="text-ios-orange text-xs flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Retrying ({retryCount}/{MAX_RETRIES})...
                </span>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fetchBuilds()}
                disabled={loading}
              >
                <RefreshCw className={loading ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
                {loading ? "Refreshing…" : "Refresh"}
              </Button>
            </div>
          }
        />

        {/* Loading state */}
        {loading && !builds && (
          <Card>
            <CardContent className="py-8 flex items-center justify-center">
              <Skeleton className="h-32 w-full" />
            </CardContent>
          </Card>
        )}

        {/* Error state */}
        {error && (
          <Card>
            <CardContent className="py-6 text-center space-y-3">
              <p className="text-ios-red font-medium">Error loading builds</p>
              <p className="text-sm text-ios-gray1">{error}</p>
              <Button onClick={() => fetchBuilds()}>Try Again</Button>
            </CardContent>
          </Card>
        )}

        {/* Latest build */}
        {builds?.latestBuild && (
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Latest APK Build</CardTitle>
                <Badge variant="success">{builds.latestBuild.status}</Badge>
              </div>
              <p className="text-sm text-ios-gray1">
                Version {builds.latestBuild.appVersion || "1.0.0"}
              </p>
            </CardHeader>
            <CardContent className="space-y-4 pb-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div>
                  <div className="text-xs uppercase tracking-wider text-ios-gray1">Profile</div>
                  <div className="font-medium mt-0.5 capitalize">{builds.latestBuild.buildProfile}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-ios-gray1">Built</div>
                  <div className="font-medium mt-0.5">{formatDate(builds.latestBuild.completedAt)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-ios-gray1">Commit</div>
                  <div className="font-mono text-xs mt-0.5">
                    {builds.latestBuild.gitCommitHash?.slice(0, 7) || "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-ios-gray1">Version</div>
                  <div className="font-medium mt-0.5">{builds.latestBuild.appVersion}</div>
                </div>
              </div>

              {builds.latestBuild.artifacts?.buildUrl ? (
                <Button
                  onClick={() => {
                    const url = builds.latestBuild?.artifacts?.buildUrl;
                    if (url) window.location.href = url;
                  }}
                  size="lg"
                  className="w-full sm:w-auto"
                >
                  <Download className="w-4 h-4" />
                  Download APK
                </Button>
              ) : (
                <p className="text-sm text-ios-gray1">No download available for this build.</p>
              )}

              {/* What's New for current build */}
              {builds.latestBuild.appVersion && VERSION_NOTES[builds.latestBuild.appVersion] && (
                <div className="pt-4 border-t border-ios-gray5">
                  <p className="text-xs uppercase tracking-wider font-semibold text-ios-gray1 mb-2">
                    What&apos;s New in v{builds.latestBuild.appVersion}
                  </p>
                  <ul className="space-y-1">
                    {VERSION_NOTES[builds.latestBuild.appVersion].features.map((feature, idx) => (
                      <li key={idx} className="text-[13px] text-black flex items-start gap-1.5">
                        <span className="text-ios-green mt-0.5">+</span>
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* No builds state */}
        {!loading && !error && builds && !builds.latestBuild && (
          <Card className="mb-6">
            <CardContent className="py-8 text-center">
              <p className="font-medium text-black">No builds found</p>
              <p className="text-sm text-ios-gray1 mt-1">
                Run &quot;eas build --platform android&quot; to create a build
              </p>
            </CardContent>
          </Card>
        )}

        {/* Version history */}
        {Object.keys(VERSION_NOTES).length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm uppercase tracking-wider font-semibold text-ios-gray1 mb-2 px-1">
              Version History
            </h2>
            <GroupedList>
              {Object.entries(VERSION_NOTES).map(([version, info]) => (
                <GroupedListItem
                  key={version}
                  label={
                    <span>
                      v{version}
                      {version === builds?.latestBuild?.appVersion && (
                        <Badge variant="default" className="ml-2">Current</Badge>
                      )}
                    </span>
                  }
                  value={
                    <>
                      <span>{info.date}</span>
                      <ul className="mt-1 space-y-0.5 list-none">
                        {info.features.map((f: string, i: number) => (
                          <li key={i} className="text-[13px] text-ios-gray1">• {f}</li>
                        ))}
                      </ul>
                    </>
                  }
                />
              ))}
            </GroupedList>
          </div>
        )}

        {/* Recent builds */}
        {builds && builds.allBuilds && builds.allBuilds.length > 1 && (
          <div className="mb-6">
            <h2 className="text-sm uppercase tracking-wider font-semibold text-ios-gray1 mb-2 px-1">
              Recent Builds
            </h2>
            <GroupedList>
              {builds.allBuilds.slice(1).map((b) => (
                <GroupedListItem
                  key={b.id}
                  label={`${b.buildProfile} — v${b.appVersion || "1.0.0"}`}
                  value={formatDate(b.completedAt)}
                  trailing={
                    b.artifacts?.buildUrl ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (b.artifacts?.buildUrl) window.location.href = b.artifacts.buildUrl;
                        }}
                      >
                        <Download className="w-3 h-3" />
                        Download
                      </Button>
                    ) : null
                  }
                />
              ))}
            </GroupedList>
          </div>
        )}

        {/* Installation instructions */}
        <div className="mb-6">
          <h2 className="text-sm uppercase tracking-wider font-semibold text-ios-gray1 mb-2 px-1">
            Installation
          </h2>
          <GroupedList>
            <GroupedListItem
              label="Step 1"
              value="Download the APK file to your Android device"
            />
            <GroupedListItem
              label="Step 2"
              value='Open the file (you may need to allow "Install from unknown sources")'
            />
            <GroupedListItem
              label="Step 3"
              value="Follow the installation prompts"
            />
            <GroupedListItem
              label="Step 4"
              value="Open TireTrack Lite and sign in with your credentials"
            />
          </GroupedList>
          <p className="text-xs text-ios-gray1 mt-2 px-1">
            If you see a &quot;Play Protect&quot; warning, tap &quot;Install anyway&quot; — this is normal for apps not distributed via the Play Store.
          </p>
        </div>

        {lastFetched && (
          <p className="text-xs text-ios-gray2 mt-2 text-center">
            Updated {lastFetched.toLocaleTimeString()}
          </p>
        )}
      </div>
    </Protected>
  );
}
