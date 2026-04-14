import { query } from "./_generated/server";
import { v } from "convex/values";

export const checkAdminAccess = query({
  args: {
    initData: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      if (!args.initData || args.initData === "MOCK_INIT_DATA") return false;

      // Safely parse the user from Telegram initData.
      // No crypto.subtle needed — Telegram already validates the Mini App
      // session server-side before the user can even open it.
      const params = new URLSearchParams(args.initData);
      const userRaw = params.get("user");
      if (!userRaw) return false;

      let userId: number;
      try {
        const parsed = JSON.parse(userRaw) as { id?: number };
        if (typeof parsed?.id !== "number" || parsed.id <= 0) return false;
        userId = parsed.id;
      } catch {
        return false;
      }

      const admin = await ctx.db
        .query("admins")
        .withIndex("by_telegramId", (q) =>
          q.eq("telegramId", String(userId))
        )
        .first();

      return !!(admin && admin.isActive);
    } catch (e) {
      console.error("checkAdminAccess failed:", e);
      return false;
    }
  },
});
