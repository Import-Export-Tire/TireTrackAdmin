import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Auto-close all open trucks at midnight EST (5:00 AM UTC)
// During daylight saving time, midnight EST = 4:00 AM UTC
crons.cron(
  "auto-close trucks at midnight EST",
  "0 5 * * *", // 5:00 AM UTC = 12:00 AM EST (standard time)
  internal.scheduled.autoCloseTrucksNightly
);

// Send daily truck manifest email at 6 AM EST (11:00 AM UTC)
crons.cron(
  "send daily manifest email",
  "0 11 * * *", // 11:00 AM UTC = 6:00 AM EST (standard time)
  internal.actions.sendManifestEmail.sendDailyManifestEmail
);

export default crons;
