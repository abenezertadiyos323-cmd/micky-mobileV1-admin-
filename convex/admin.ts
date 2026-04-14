import { query } from "./_generated/server";
import { v } from "convex/values";
import { verifyInitData, getEnvValue } from "./auth";

export const checkAdminAccess = query({
  args: {
    initData: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.initData) return false;

    const botToken = getEnvValue("TELEGRAM_BOT_TOKEN");
    if (!botToken) {
      console.warn("Server configuration missing TELEGRAM_BOT_TOKEN");
      return false;
    }

    try {
      const user = await verifyInitData(args.initData, botToken);
      const admin = await ctx.db
        .query("admins")
        .withIndex("by_telegramId", (q) => q.eq("telegramId", String(user.id)))
        .first();

      return !!(admin && admin.isActive);
    } catch (e) {
      console.error("Auth check failed:", e);
      return false;
    }
  },
});
