import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Base44 sync crons DISABLED - no longer using Base44
// If you need to re-enable, uncomment these:
// crons.interval(
//   "sync users from Base44",
//   { minutes: 5 },
//   api.base44.syncUsersFromBase44
// );
// crons.interval(
//   "retry sync closed trucks",
//   { minutes: 10 },
//   api.base44.retrySyncClosedTrucks
// );

// Auto-close all open trucks at midnight EST (5:00 AM UTC)
// During daylight saving time, midnight EST = 4:00 AM UTC
crons.cron(
  "auto-close trucks at midnight EST",
  "0 5 * * *", // 5:00 AM UTC = 12:00 AM EST (standard time)
  internal.scheduled.autoCloseTrucksNightly
);

export default crons;
