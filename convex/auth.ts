import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Simple hash function (in production, use bcrypt via action)
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36) + str.length.toString(36);
}

// Create first superadmin (only works if no admins exist)
export const createFirstAdmin = mutation({
  args: {
    email: v.string(),
    password: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("adminUsers").first();
    if (existing) {
      return { success: false, error: "Admin already exists. Use invite flow." };
    }
    
    const adminId = await ctx.db.insert("adminUsers", {
      email: args.email.toLowerCase(),
      passwordHash: simpleHash(args.password),
      name: args.name,
      role: "superadmin",
      allowedLocations: ["all"],
      isActive: true,
      createdAt: Date.now(),
      forcePasswordChange: false,
    });
    
    return { success: true, adminId };
  },
});

// Login
export const login = mutation({
  args: {
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const admin = await ctx.db
      .query("adminUsers")
      .withIndex("by_email", (q) => q.eq("email", args.email.toLowerCase()))
      .first();
    
    if (!admin) {
      return { success: false, error: "Invalid credentials" };
    }
    
    if (!admin.isActive) {
      return { success: false, error: "Account deactivated" };
    }
    
    if (admin.passwordHash !== simpleHash(args.password)) {
      return { success: false, error: "Invalid credentials" };
    }
    
    // Update last login
    await ctx.db.patch(admin._id, { lastLoginAt: Date.now() });
    
    return {
      success: true,
      admin: {
        id: admin._id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        allowedLocations: admin.allowedLocations,
        forcePasswordChange: admin.forcePasswordChange || false,
      },
    };
  },
});

// Get current admin by ID
export const getAdmin = query({
  args: { adminId: v.string() },
  handler: async (ctx, args) => {
    try {
      // Validate that it's an adminUsers ID before querying
      const admin = await ctx.db.get(args.adminId as any);
      if (!admin || !admin.isActive) return null;

      // Check if this is actually from the adminUsers table
      // by verifying it has the expected fields
      if (!admin.email || !admin.role || !admin.allowedLocations) {
        return null; // Not an admin user, clear session
      }

      return {
        id: admin._id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        allowedLocations: admin.allowedLocations,
        forcePasswordChange: admin.forcePasswordChange || false,
      };
    } catch {
      // Invalid ID format or wrong table - return null to clear session
      return null;
    }
  },
});

// Create new admin (superadmin only) - with temp password
export const createAdmin = mutation({
  args: {
    callerAdminId: v.id("adminUsers"),
    email: v.string(),
    password: v.string(),
    name: v.string(),
    role: v.union(v.literal("admin"), v.literal("viewer")),
    allowedLocations: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // Verify caller is superadmin
    const caller = await ctx.db.get(args.callerAdminId);
    if (!caller || caller.role !== "superadmin") {
      return { success: false, error: "Unauthorized: Only superadmins can create admins" };
    }

    const existing = await ctx.db
      .query("adminUsers")
      .withIndex("by_email", (q) => q.eq("email", args.email.toLowerCase()))
      .first();

    if (existing) {
      return { success: false, error: "Email already exists" };
    }

    const adminId = await ctx.db.insert("adminUsers", {
      email: args.email.toLowerCase(),
      passwordHash: simpleHash(args.password),
      name: args.name,
      role: args.role,
      allowedLocations: args.allowedLocations,
      isActive: true,
      createdAt: Date.now(),
      forcePasswordChange: true,
      tempPasswordSetAt: Date.now(),
    });

    return { success: true, adminId };
  },
});

// Update admin (superadmin only)
export const updateAdmin = mutation({
  args: {
    callerAdminId: v.id("adminUsers"),
    adminId: v.id("adminUsers"),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    role: v.optional(v.union(v.literal("superadmin"), v.literal("admin"), v.literal("viewer"))),
    allowedLocations: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Verify caller is superadmin
    const caller = await ctx.db.get(args.callerAdminId);
    if (!caller || caller.role !== "superadmin") {
      return { success: false, error: "Unauthorized: Only superadmins can update admins" };
    }

    const { callerAdminId, adminId, email, ...updates } = args;

    // If email is being changed, check it's not already in use
    if (email) {
      const existing = await ctx.db
        .query("adminUsers")
        .withIndex("by_email", (q) => q.eq("email", email.toLowerCase()))
        .first();

      if (existing && existing._id !== adminId) {
        return { success: false, error: "Email already in use" };
      }
    }

    const filteredUpdates = Object.fromEntries(
      Object.entries({
        ...updates,
        ...(email && { email: email.toLowerCase() }),
      }).filter(([_, v]) => v !== undefined)
    );
    await ctx.db.patch(adminId, filteredUpdates);
    return { success: true };
  },
});

// Change password (also clears forcePasswordChange)
export const changePassword = mutation({
  args: {
    adminId: v.id("adminUsers"),
    currentPassword: v.string(),
    newPassword: v.string(),
  },
  handler: async (ctx, args) => {
    const admin = await ctx.db.get(args.adminId);
    if (!admin) {
      return { success: false, error: "Admin not found" };
    }
    
    if (admin.passwordHash !== simpleHash(args.currentPassword)) {
      return { success: false, error: "Current password incorrect" };
    }
    
    if (args.newPassword.length < 8) {
      return { success: false, error: "Password must be at least 8 characters" };
    }
    
    await ctx.db.patch(args.adminId, {
      passwordHash: simpleHash(args.newPassword),
      forcePasswordChange: false,
      tempPasswordSetAt: undefined,
    });
    
    return { success: true };
  },
});

// Reset password (superadmin sets new temp password for another admin)
export const resetAdminPassword = mutation({
  args: {
    callerAdminId: v.id("adminUsers"),
    adminId: v.id("adminUsers"),
    newPassword: v.string(),
  },
  handler: async (ctx, args) => {
    // Verify caller is superadmin
    const caller = await ctx.db.get(args.callerAdminId);
    if (!caller || caller.role !== "superadmin") {
      return { success: false, error: "Unauthorized: Only superadmins can reset passwords" };
    }

    await ctx.db.patch(args.adminId, {
      passwordHash: simpleHash(args.newPassword),
      forcePasswordChange: true,
      tempPasswordSetAt: Date.now(),
    });

    return { success: true };
  },
});

// Get all admins (for superadmin management)
export const getAllAdmins = query({
  args: {},
  handler: async (ctx) => {
    const admins = await ctx.db.query("adminUsers").collect();
    return admins.map((a) => ({
      id: a._id,
      email: a.email,
      name: a.name,
      role: a.role,
      allowedLocations: a.allowedLocations,
      isActive: a.isActive,
      createdAt: a.createdAt,
      lastLoginAt: a.lastLoginAt,
      forcePasswordChange: a.forcePasswordChange || false,
    }));
  },
});

// Delete admin (superadmin only)
export const deleteAdmin = mutation({
  args: {
    callerAdminId: v.id("adminUsers"),
    adminId: v.id("adminUsers"),
  },
  handler: async (ctx, args) => {
    // Verify caller is superadmin
    const caller = await ctx.db.get(args.callerAdminId);
    if (!caller || caller.role !== "superadmin") {
      return { success: false, error: "Unauthorized: Only superadmins can delete admins" };
    }

    // Prevent deleting yourself
    if (args.callerAdminId === args.adminId) {
      return { success: false, error: "Cannot delete your own account" };
    }

    await ctx.db.delete(args.adminId);
    return { success: true };
  },
});
