import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const getSettings = query({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("adminSettings").collect();
    return docs[0] ?? null;
  },
});

export const upsertSettings = mutation({
  args: {
    storeName: v.optional(v.string()),
    supportContact: v.optional(v.string()),
    telegramBotLink: v.optional(v.string()),
    storeAddress: v.optional(v.string()),
    storeLocationLink: v.optional(v.string()),
    phoneLowStockThreshold: v.optional(v.number()),
    accessoryLowStockThreshold: v.optional(v.number()),
    exchangeAlertsEnabled: v.optional(v.boolean()),
    inboxAlertsEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = (await ctx.db.query("adminSettings").collect())[0];
    const patch = { ...args, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("adminSettings", patch);
    }
  },
});
