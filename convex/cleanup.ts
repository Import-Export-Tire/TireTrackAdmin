import { mutation } from "./_generated/server";
import { v } from "convex/values";

// One-time cleanup mutation to delete unused tables from another project
export const deleteUnusedTable = mutation({
  args: { tableName: v.string() },
  handler: async (ctx, args) => {
    // Tables that belong to TireTrackAdmin - DO NOT DELETE
    const keepTables = [
      "adminUsers",
      "auditLogs",
      "locations",
      "returnBatches",
      "returnItems",
      "scans",
      "tireUPCs",
      "trucks",
      "users",
      "vendorAccounts",
    ];

    if (keepTables.includes(args.tableName)) {
      return { error: `Cannot delete ${args.tableName} - it belongs to this app!`, deleted: 0 };
    }

    // Delete all documents from the specified table
    let deleted = 0;
    const docs = await (ctx.db as any).query(args.tableName).collect();

    for (const doc of docs) {
      await ctx.db.delete(doc._id);
      deleted++;
    }

    return { success: true, tableName: args.tableName, deleted };
  },
});

// Bulk cleanup - deletes all documents from all unused tables
export const cleanupAllUnusedTables = mutation({
  args: {},
  handler: async (ctx) => {
    // Tables that DON'T belong to TireTrackAdmin
    const tablesToDelete = [
      "announcementReads",
      "announcements",
      "applicationActivity",
      "applications",
      "arpAgreements",
      "arpEnrollments",
      "arpMeetings",
      "arpRootCause",
      "arpTraining",
      "attendance",
      "calendarShares",
      "callOffs",
      "chatMessages",
      "chatRooms",
      "contactMessages",
      "conversations",
      "dealerInquiries",
      "deletedRecords",
      "documentSignatures",
      "documents",
      "employeePushTokens",
      "equipment",
      "equipmentAgreements",
      "equipmentChecklistConfig",
      "equipmentConditionChecks",
      "equipmentHistory",
      "eventInvites",
      "events",
      "exitInterviews",
      "expenseReports",
      "holidays",
      "jobs",
      "merits",
      "messages",
      "mileageEntries",
      "notifications",
      "offerLetters",
      "onboardingDocuments",
      "overtimeOffers",
      "overtimeResponses",
      "payStubs",
      "payrollCompanies",
      "performanceReviews",
      "personnel",
      "personnelCallLogs",
      "pickers",
      "projectNotes",
      "projectSuggestions",
      "projects",
      "ptoBalances",
      "ptoPolicies",
      "qbConnection",
      "qbEmployeeMapping",
      "qbPendingTimeExport",
      "qbSyncLog",
      "qbSyncQueue",
      "safetyChecklistCompletions",
      "safetyChecklistTemplates",
      "scanners",
      "scheduleOverrides",
      "shiftDailyTasks",
      "shiftTemplates",
      "shifts",
      "surveyAssignments",
      "surveyCampaigns",
      "surveyResponses",
      "systemBanners",
      "tasks",
      "timeCorrections",
      "timeEntries",
      "timeOffRequests",
      "timesheetApprovals",
      "typingIndicators",
      "vehicles",
      "writeUps",
    ];

    const results: { tableName: string; deleted: number; error?: string }[] = [];

    for (const tableName of tablesToDelete) {
      try {
        const docs = await (ctx.db as any).query(tableName).collect();
        let deleted = 0;

        for (const doc of docs) {
          await ctx.db.delete(doc._id);
          deleted++;
        }

        results.push({ tableName, deleted });
      } catch (error: any) {
        results.push({ tableName, deleted: 0, error: error.message });
      }
    }

    const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);
    return {
      success: true,
      totalDeleted,
      tablesProcessed: results.length,
      results
    };
  },
});
