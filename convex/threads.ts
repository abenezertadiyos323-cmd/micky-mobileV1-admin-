import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * One-time backfill: for each thread missing firstMessageAt,
 * find its earliest customer message and store the timestamp.
 * Safe to run multiple times (skips threads already set).
 */
export const backfillFirstMessageAt = mutation({
  args: {},
  handler: async (ctx) => {
    const threads = await ctx.db.query("threads").collect();
    let updated = 0;
    for (const thread of threads) {
      if (thread.firstMessageAt != null) continue; // already set
      const firstMsg = await ctx.db
        .query("messages")
        .withIndex("by_threadId_and_createdAt", (q) =>
          q.eq("threadId", thread._id)
        )
        .filter((q) => q.eq(q.field("sender"), "customer"))
        .first(); // ascending by createdAt → earliest customer message
      if (firstMsg) {
        await ctx.db.patch(thread._id, { firstMessageAt: firstMsg.createdAt });
        updated++;
      }
    }
    return { updated, total: threads.length };
  },
});

/**
 * Badge count: number of threads with status "new"
 * (customer messaged, admin hasn't replied/seen yet).
 * Used by the BottomNav Inbox badge.
 */
export const getInboxBadgeCount = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("threads")
      .withIndex("by_status", (q) => q.eq("status", "new"))
      .collect();
    return rows.length;
  },
});

/**
 * Badge count: number of exchanges with status "Pending".
 * Used by the BottomNav Exchange badge.
 */
export const getExchangeBadgeCount = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("exchanges")
      .withIndex("by_status", (q) => q.eq("status", "Pending"))
      .collect();
    return rows.length;
  },
});

/**
 * List all non-done threads sorted by lastMessageAt descending.
 * Category (hot/warm/cold) is computed client-side from the returned fields.
 */
export const listThreads = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db
      .query("threads")
      .withIndex("by_lastMessageAt")
      .order("desc")
      .collect();
    return all.filter((t) => t.status !== "done");
  },
});

/**
 * Get a single thread by ID. Returns null if not found.
 */
export const getThread = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.threadId);
  },
});

/**
 * List all messages for a thread sorted ascending by createdAt.
 */
export const listThreadMessages = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_threadId_and_createdAt", (q) =>
        q.eq("threadId", args.threadId)
      )
      .order("asc")
      .collect();
  },
});

/**
 * Mark a thread as seen and clear unreadCount.
 * Called by ThreadDetail when an admin opens a new thread.
 */
export const markThreadSeen = mutation({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.threadId, {
      status: "seen",
      unreadCount: 0,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Bot-only durable state: fetch or create a per-chat thread record.
 * This lives in botThreads so it does not interfere with the admin CRM threads table.
 */
export const getOrCreateThread = mutation({
  args: {
    chatId: v.string(),
    telegramUserId: v.string(),
    username: v.optional(v.string()),
    firstName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("botThreads")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .first();

    if (existing) return existing;

    const now = Date.now();
    const id = await ctx.db.insert("botThreads", {
      chatId: args.chatId,
      telegramUserId: args.telegramUserId,
      username: args.username,
      firstName: args.firstName,
      lastMessageAt: now,
      firstMessageAt: now,
      messageCount: 0,
      recentMessages: [],
      intake: undefined,
    });

    return await ctx.db.get(id);
  },
});

/**
 * Append the latest user/assistant exchange to durable bot conversation memory.
 * Keeps only the last 10 entries (5 exchange pairs).
 */
export const updateThread = mutation({
  args: {
    chatId: v.string(),
    userMessage: v.string(),
    assistantMessage: v.string(),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db
      .query("botThreads")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .first();

    if (!thread) {
      throw new Error(`Bot thread not found for chatId: ${args.chatId}`);
    }

    const newMessages = [
      ...thread.recentMessages,
      { role: "user" as const, content: args.userMessage, timestamp: args.timestamp },
      { role: "assistant" as const, content: args.assistantMessage, timestamp: args.timestamp + 1 },
    ].slice(-10);

    await ctx.db.patch(thread._id, {
      recentMessages: newMessages,
      lastMessageAt: args.timestamp,
      messageCount: thread.messageCount + 1,
    });

    return { ok: true, threadId: thread._id, messageCount: thread.messageCount + 1 };
  },
});

/**
 * Persist the active sell/exchange intake state for the bot flow.
 * write_key makes repeated n8n retries idempotent.
 */
export const updateIntakeState = mutation({
  args: {
    chatId: v.string(),
    flow: v.union(v.literal("sell"), v.literal("exchange")),
    status: v.union(
      v.literal("start"),
      v.literal("in_progress"),
      v.literal("complete"),
    ),
    data: v.object({
      offered_model: v.optional(v.string()),
      offered_storage: v.optional(v.string()),
      offered_condition: v.optional(
        v.union(
          v.literal("new"),
          v.literal("good"),
          v.literal("fair"),
          v.literal("poor"),
        ),
      ),
      asking_price: v.optional(v.number()),
      desired_product_id: v.optional(v.string()),
      desired_product_name: v.optional(v.string()),
      customer_notes: v.optional(v.string()),
    }),
    write_key: v.string(),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db
      .query("botThreads")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .first();

    if (!thread) {
      throw new Error(`Bot thread not found for chatId: ${args.chatId}`);
    }

    if (thread.intake?.write_key === args.write_key) {
      return { skipped: true };
    }

    await ctx.db.patch(thread._id, {
      intake: {
        flow: args.flow,
        status: args.status,
        data: args.data,
        last_updated_at: Date.now(),
        write_key: args.write_key,
      },
    });

    return { skipped: false };
  },
});

/**
 * Clear intake state after a successful sell/exchange write.
 */
export const clearIntakeState = mutation({
  args: { chatId: v.string() },
  handler: async (ctx, args) => {
    const thread = await ctx.db
      .query("botThreads")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .first();

    if (!thread) {
      return { ok: true, notFound: true };
    }

    await ctx.db.patch(thread._id, { intake: undefined });
    return { ok: true, notFound: false };
  },
});
