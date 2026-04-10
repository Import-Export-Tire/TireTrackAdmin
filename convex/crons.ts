import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Auto-close all open trucks at midnight Eastern.
// EDT = UTC-4 (midnight = 4 AM UTC), EST = UTC-5 (midnight = 5 AM UTC).
// Run at both times; the handler is idempotent (no open trucks = no-op).
crons.cron(
  "auto-close trucks at midnight EDT",
  "0 4 * * *",
  internal.scheduled.autoCloseTrucksNightly
);
crons.cron(
  "auto-close trucks at midnight EST",
  "0 5 * * *",
  internal.scheduled.autoCloseTrucksNightly
);

// Send daily truck manifest email at 6 AM Eastern.
// EDT = 10 AM UTC, EST = 11 AM UTC. Run both; email action is idempotent
// (checks if already sent for the date).
crons.cron(
  "send daily manifest email EDT",
  "0 10 * * *",
  internal.actions.sendManifestEmail.sendDailyManifestEmail
);
crons.cron(
  "send daily manifest email EST",
  "0 11 * * *",
  internal.actions.sendManifestEmail.sendDailyManifestEmail
);

// Clear error logs nightly (same dual-schedule pattern)
crons.cron(
  "clear error logs nightly EDT",
  "0 4 * * *",
  internal.scheduled.clearErrorLogsNightly
);
crons.cron(
  "clear error logs nightly EST",
  "0 5 * * *",
  internal.scheduled.clearErrorLogsNightly
);

// Health check: look for unresolved errors every 15 minutes and email alert
crons.cron(
  "health check and error alerts",
  "*/15 * * * *",
  internal.scheduled.checkHealthAndAlert
);

export default crons;
