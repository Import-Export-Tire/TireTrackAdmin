"use client";

import { useState, useEffect, useCallback } from "react";
import { Protected } from "../protected";
import Link from "next/link";

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
  }, []);

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
      <div className="min-h-screen bg-slate-950 text-white">
        {/* Header */}
        <div className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-xl sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Link
                  href="/"
                  className="w-10 h-10 bg-slate-800 hover:bg-slate-700 rounded-lg flex items-center justify-center transition-colors min-h-[44px] min-w-[44px]"
                  aria-label="Back to dashboard"
                >
                  <svg
                    className="w-5 h-5 text-slate-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 19l-7-7m0 0l7-7m-7 7h18"
                    />
                  </svg>
                </Link>
                <div>
                  <h1 className="text-xl font-bold">TireTrack Lite App</h1>
                  <p className="text-slate-500 text-sm">
                    Download the latest Android APK
                    {lastFetched && (
                      <span className="ml-2 text-slate-600">
                        • Updated {lastFetched.toLocaleTimeString()}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {retryCount > 0 && retryCount <= MAX_RETRIES && (
                  <span className="text-amber-400 text-xs flex items-center gap-1">
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Retrying ({retryCount}/{MAX_RETRIES})...
                  </span>
                )}
                <button
                  onClick={() => fetchBuilds()}
                  disabled={loading}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 min-h-[44px]"
                  aria-label="Refresh builds"
                >
                  <svg
                    className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  {loading ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {loading && !builds ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-10 h-10 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
              <p className="text-red-400 font-medium">Error loading builds</p>
              <p className="text-slate-500 text-sm mt-1">{error}</p>
              <button
                onClick={() => fetchBuilds()}
                className="mt-4 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-sm transition-colors min-h-[44px]"
              >
                Try Again
              </button>
            </div>
          ) : builds?.latestBuild ? (
            <>
              {/* Latest Build Card */}
              <div className="bg-gradient-to-br from-purple-900/30 to-pink-900/30 border border-purple-500/30 rounded-2xl p-6 mb-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-purple-500/20 rounded-xl flex items-center justify-center">
                    <svg
                      className="w-6 h-6 text-purple-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
                      />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">
                      Latest APK Build
                    </h2>
                    <p className="text-purple-300 text-sm">
                      Version {builds.latestBuild.appVersion || "1.0.0"}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                  <div>
                    <p className="text-slate-500 text-xs uppercase tracking-wider">
                      Profile
                    </p>
                    <p className="text-white font-medium capitalize">
                      {builds.latestBuild.buildProfile}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500 text-xs uppercase tracking-wider">
                      Status
                    </p>
                    <p className="text-emerald-400 font-medium">
                      {builds.latestBuild.status}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500 text-xs uppercase tracking-wider">
                      Built
                    </p>
                    <p className="text-white font-medium">
                      {formatDate(builds.latestBuild.completedAt)}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500 text-xs uppercase tracking-wider">
                      Commit
                    </p>
                    <p className="text-slate-400 font-mono text-sm">
                      {builds.latestBuild.gitCommitHash?.slice(0, 7) || "N/A"}
                    </p>
                  </div>
                </div>

                {builds.latestBuild.artifacts?.buildUrl ? (
                  <button
                    onClick={() => {
                      const url = builds.latestBuild?.artifacts?.buildUrl;
                      if (url) {
                        // Use window.location for direct download - avoids popup blockers
                        window.location.href = url;
                      }
                    }}
                    className="inline-flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-xl font-medium transition-all shadow-lg shadow-purple-500/20 cursor-pointer"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                      />
                    </svg>
                    Download APK
                  </button>
                ) : (
                  <p className="text-slate-500">
                    No download available for this build
                  </p>
                )}

                {/* Version Notes for Current Build */}
                {builds.latestBuild.appVersion && VERSION_NOTES[builds.latestBuild.appVersion] && (
                  <div className="mt-6 pt-6 border-t border-purple-500/20">
                    <h3 className="text-sm font-semibold text-purple-300 mb-3">What&apos;s New in v{builds.latestBuild.appVersion}</h3>
                    <ul className="space-y-2">
                      {VERSION_NOTES[builds.latestBuild.appVersion].features.map((feature, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-slate-300 text-sm">
                          <span className="text-emerald-400 mt-0.5">+</span>
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Full Version History */}
              <div className="mb-8">
                <h3 className="text-lg font-semibold mb-4 text-slate-300">Version History</h3>
                <div className="space-y-4">
                  {Object.entries(VERSION_NOTES).map(([version, info]) => (
                    <div
                      key={version}
                      className={`bg-slate-900/50 border rounded-xl p-4 ${
                        version === builds.latestBuild?.appVersion
                          ? "border-purple-500/30 bg-purple-900/10"
                          : "border-slate-800"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-semibold">v{version}</span>
                          {version === builds.latestBuild?.appVersion && (
                            <span className="px-2 py-0.5 bg-purple-500/20 text-purple-300 text-xs rounded-full">
                              Current
                            </span>
                          )}
                        </div>
                        <span className="text-slate-500 text-sm">{info.date}</span>
                      </div>
                      <ul className="space-y-1">
                        {info.features.map((feature, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-slate-400 text-sm">
                            <span className="text-slate-600">-</span>
                            {feature}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>

              {/* All Builds */}
              {builds.allBuilds.length > 1 && (
                <div>
                  <h3 className="text-lg font-semibold mb-4 text-slate-300">
                    Recent Builds
                  </h3>
                  <div className="space-y-3">
                    {builds.allBuilds.slice(1).map((build) => (
                      <div
                        key={build.id}
                        className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center">
                            <svg
                              className="w-5 h-5 text-slate-500"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
                              />
                            </svg>
                          </div>
                          <div>
                            <p className="text-white font-medium">
                              {build.buildProfile} - v
                              {build.appVersion || "1.0.0"}
                            </p>
                            <p className="text-slate-500 text-sm">
                              {formatDate(build.completedAt)}
                            </p>
                          </div>
                        </div>
                        {build.artifacts?.buildUrl && (
                          <button
                            onClick={() => {
                              if (build.artifacts?.buildUrl) {
                                window.location.href = build.artifacts.buildUrl;
                              }
                            }}
                            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 cursor-pointer"
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                              />
                            </svg>
                            Download
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-8 text-center">
              <div className="w-16 h-16 bg-slate-800 rounded-xl flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-slate-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <p className="text-slate-400 font-medium">No builds found</p>
              <p className="text-slate-600 text-sm mt-1">
                Run &quot;eas build --platform android&quot; to create a build
              </p>
            </div>
          )}

          {/* Instructions */}
          <div className="mt-8 bg-slate-900/30 border border-slate-800/50 rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-4 text-slate-300">
              Installation Instructions
            </h3>
            <ol className="list-decimal list-inside space-y-2 text-slate-400">
              <li>Download the APK file to your Android device</li>
              <li>
                Open the file (you may need to allow &quot;Install from unknown
                sources&quot;)
              </li>
              <li>Follow the installation prompts</li>
              <li>Open TireTrack Lite and sign in with your credentials</li>
            </ol>
            <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <p className="text-amber-400 text-sm">
                <strong>Note:</strong> If you see a &quot;Play Protect&quot;
                warning, tap &quot;Install anyway&quot; - this is normal for
                apps not from the Play Store.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Protected>
  );
}
