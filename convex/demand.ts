// convex/demand.ts
// Demand event logging for the Micky Mobile bot and mini app.
//
// Callers:
//   - Telegram bot (n8n): logs source="bot" when a customer asks about a phone type
//   - Mini app search:    logs source="search" when a customer searches a phone type
//   - Mini app selection: logs source="select" when a customer submits an exchange form
//
// POST https://<deployment>.convex.cloud/api/mutation
// { "path": "demand:logDemandEvent", "args": { "source": "bot", "phoneType": "iPhone 15 Pro", ... } }

import { mutation } from "./_generated/server";
import { v } from "convex/values";

// ── Ethiopian time (UTC+3) — matches dashboard.ts convention ─────────────────
const ETH_OFFSET_MS = 3 * 60 * 60 * 1000;

function ethTodayStart(): number {
  const ethNow = Date.now() + ETH_OFFSET_MS;
  const ethMidnight = ethNow - (ethNow % 86_400_000);
  return ethMidnight - ETH_OFFSET_MS;
}

// ── phoneType normalization ───────────────────────────────────────────────────
// Prevents duplicates like "iphone 13" vs "iPhone 13" vs "iPhone  13"
// Rules: trim → collapse multiple spaces → lowercase
function normalizePhoneType(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

// ── logDemandEvent ────────────────────────────────────────────────────────────

export const logDemandEvent = mutation({
  args: {
    source: v.union(
      v.literal("bot"),
      v.literal("search"),
      v.literal("select"),
    ),
    phoneType: v.string(),
    userId: v.optional(v.string()),
    threadId: v.optional(v.id("threads")),
    meta: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const phoneType = normalizePhoneType(args.phoneType);
    if (!phoneType) {
      throw new Error("phoneType must be non-empty");
    }

    // ── Abuse protection: source="bot" + threadId → max 1 per (threadId, phoneType) per ETH day
    // Prevents bot-loop spam when a thread repeatedly triggers the same keyword.
    if (args.source === "bot" && args.threadId != null) {
      const threadId = args.threadId; // narrow type for use in filter callback
      const todayStart = ethTodayStart();
      const existing = await ctx.db
        .query("demand_events")
        .withIndex("by_phoneType_and_createdAt", (q) =>
          q.eq("phoneType", phoneType).gte("createdAt", todayStart)
        )
        .filter((q) =>
          q.and(
            q.eq(q.field("source"), "bot"),
            q.eq(q.field("threadId"), threadId),
          )
        )
        .first();
      if (existing !== null) {
        return existing._id; // already recorded today — skip
      }
    }

    return await ctx.db.insert("demand_events", {
      source: args.source,
      phoneType,
      createdAt: Date.now(),
      userId: args.userId,
      threadId: args.threadId,
      meta: args.meta,
    });
  },
});
