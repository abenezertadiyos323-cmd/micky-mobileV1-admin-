// convex/exchanges.ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const trimImageUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

async function normalizeProductImages(
  ctx: { storage: { getUrl: (id: string) => Promise<string | null> } },
  images: unknown,
): Promise<string[]> {
  if (!Array.isArray(images) || images.length === 0) return [];

  const normalized = images
    .map((img, index) => {
      const directUrl = trimImageUrl(img);
      if (directUrl) return { kind: "url" as const, order: index, value: directUrl };

      if (!img || typeof img !== "object") return null;
      const legacy = img as { storageId?: string; order?: number; url?: string };
      if (!legacy.storageId) return null;
      return {
        kind: "legacy" as const,
        order: typeof legacy.order === "number" ? legacy.order : index,
        storageId: legacy.storageId,
        fallbackUrl: trimImageUrl(legacy.url),
      };
    })
    .filter((img): img is NonNullable<typeof img> => img !== null)
    .sort((a, b) => a.order - b.order);

  const urls: string[] = [];
  for (const img of normalized) {
    if (img.kind === "url") {
      urls.push(img.value);
      continue;
    }
    try {
      const resolved = await ctx.storage.getUrl(img.storageId);
      const url = trimImageUrl(resolved) ?? img.fallbackUrl;
      if (url) urls.push(url);
    } catch {
      if (img.fallbackUrl) urls.push(img.fallbackUrl);
    }
  }

  return urls
    .map((url) => trimImageUrl(url))
    .filter((url): url is string => url !== null)
    .slice(0, 3);
}

/**
 * List all exchanges sorted by createdAt descending, with thread and
 * desiredPhone joined (image URLs NOT resolved — list view only needs text).
 * Used by the Exchanges list page.
 */
export const listExchanges = query({
  args: {},
  handler: async (ctx) => {
    const exchanges = await ctx.db
      .query("exchanges")
      .withIndex("by_createdAt")
      .order("desc")
      .collect();

    return Promise.all(
      exchanges.map(async (ex) => {
        const thread = await ctx.db.get(ex.threadId);
        const desiredPhone = await ctx.db.get(ex.desiredPhoneId);
        return {
          ...ex,
          thread: thread ?? undefined,
          desiredPhone: desiredPhone ?? undefined,
        };
      })
    );
  },
});

/**
 * List exchanges associated with a specific thread, sorted by createdAt desc.
 * Used by ThreadDetail to show pinned exchange cards.
 * Image URLs are NOT resolved (card only shows text).
 */
export const listExchangesByThread = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const exchanges = await ctx.db
      .query("exchanges")
      .withIndex("by_threadId_and_createdAt", (q) =>
        q.eq("threadId", args.threadId)
      )
      .order("desc")
      .collect();

    return Promise.all(
      exchanges.map(async (ex) => {
        const desiredPhone = await ctx.db.get(ex.desiredPhoneId);
        return {
          ...ex,
          desiredPhone: desiredPhone ?? undefined,
        };
      })
    );
  },
});

/**
 * Get a single exchange by ID with thread and desiredPhone joined.
 * Images are returned as URL strings for ExchangeDetail.
 */
export const getExchange = query({
  args: { exchangeId: v.id("exchanges") },
  handler: async (ctx, args) => {
    const ex = await ctx.db.get(args.exchangeId);
    if (!ex) return null;

    const thread = await ctx.db.get(ex.threadId);

    // Resolve product + image URLs
    let desiredPhone: (typeof ex & { images: string[] }) | undefined;
    const rawPhone = await ctx.db.get(ex.desiredPhoneId);
    if (rawPhone) {
      const images = await normalizeProductImages(ctx, rawPhone.images);
      desiredPhone = { ...rawPhone, images } as unknown as typeof desiredPhone;
    }

    return {
      ...ex,
      thread: thread ?? undefined,
      desiredPhone,
    };
  },
});

/**
 * Update the status of an exchange and record completion/rejection timestamps.
 */
export const updateExchangeStatus = mutation({
  args: {
    exchangeId: v.id("exchanges"),
    status: v.union(
      v.literal("Pending"),
      v.literal("Quoted"),
      v.literal("Accepted"),
      v.literal("Completed"),
      v.literal("Rejected")
    ),
    adminTelegramId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const patch: {
      status: typeof args.status;
      updatedAt: number;
      completedAt?: number;
      completedBy?: string;
      rejectedAt?: number;
      rejectedBy?: string;
    } = { status: args.status, updatedAt: now };

    if (args.status === "Completed") {
      patch.completedAt = now;
      if (args.adminTelegramId) patch.completedBy = args.adminTelegramId;
    }
    if (args.status === "Rejected") {
      patch.rejectedAt = now;
      if (args.adminTelegramId) patch.rejectedBy = args.adminTelegramId;
    }

    await ctx.db.patch(args.exchangeId, patch);
  },
});

/**
 * Send a quote: create an admin message, update exchange to Quoted,
 * and update thread's last-message metadata.
 */
export const sendQuote = mutation({
  args: {
    exchangeId: v.id("exchanges"),
    quoteText: v.string(),
    adminTelegramId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const ex = await ctx.db.get(args.exchangeId);
    if (!ex) throw new Error("Exchange not found");

    // Insert quote message
    const messageId = await ctx.db.insert("messages", {
      threadId: ex.threadId,
      sender: "admin",
      senderRole: "admin",
      senderTelegramId: args.adminTelegramId,
      text: args.quoteText,
      exchangeId: args.exchangeId,
      createdAt: now,
    });

    // Mark exchange as Quoted
    await ctx.db.patch(args.exchangeId, {
      status: "Quoted",
      quotedAt: now,
      quotedBy: args.adminTelegramId,
      quoteMessageId: messageId,
      updatedAt: now,
    });

    // Update thread last-message metadata
    await ctx.db.patch(ex.threadId, {
      updatedAt: now,
      lastMessageAt: now,
      lastMessagePreview: args.quoteText.slice(0, 100),
      lastAdminMessageAt: now,
      hasAdminReplied: true,
    });

    return { messageId };
  },
});
