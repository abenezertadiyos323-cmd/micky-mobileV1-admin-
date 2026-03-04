import { query, mutation } from "./_generated/server";
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

  const urls: Array<{ order: number; value: string }> = [];
  for (let i = 0; i < images.length; i += 1) {
    const img = images[i];
    const directUrl = trimImageUrl(img);
    if (directUrl) {
      urls.push({ order: i, value: directUrl });
      continue;
    }

    if (!img || typeof img !== "object") continue;
    const legacy = img as { storageId?: string; order?: number; url?: string };
    if (typeof legacy.storageId !== "string" || legacy.storageId.length === 0) {
      continue;
    }

    try {
      const resolved = await ctx.storage.getUrl(legacy.storageId);
      const fallback = trimImageUrl(legacy.url);
      const url = trimImageUrl(resolved) ?? fallback;
      if (!url) continue;
      urls.push({
        order: typeof legacy.order === "number" ? legacy.order : i,
        value: url,
      });
    } catch {
      const fallback = trimImageUrl(legacy.url);
      if (!fallback) continue;
      urls.push({
        order: typeof legacy.order === "number" ? legacy.order : i,
        value: fallback,
      });
    }
  }

  return urls
    .sort((a, b) => a.order - b.order)
    .map((item) => item.value)
    .slice(0, 3);
}

export const getSearchPanelData = query({
  args: {
    limit: v.optional(v.number()),
    topDays: v.optional(v.number()),
    trendingHours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 8;
    const topDays = args.topDays ?? 30;
    const trendingHours = args.trendingHours ?? 48;

    const now = Date.now();
    const topSince = now - topDays * 24 * 60 * 60 * 1000;
    const trendingSince = now - trendingHours * 60 * 60 * 1000;

    const all = await ctx.db.query("searches").collect();

    // Aggregate counts per term
    const counts: Record<
      string,
      { term: string; count: number; lastSeen: number }
    > = {};
    for (const s of all) {
      const term = (s.term || "").trim().toLowerCase();
      if (!term) continue;
      const created = s.createdAt || 0;
      const existing = counts[term];
      if (!existing) counts[term] = { term, count: 1, lastSeen: created };
      else {
        existing.count += 1;
        if (created > existing.lastSeen) existing.lastSeen = created;
      }
    }

    const terms = Object.values(counts);

    // top_searches within topSince
    const top_searches = terms
      .filter((t) => t.lastSeen >= topSince)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map((t) => ({ term: t.term, count: t.count }));

    // trending_searches within trendingSince (sorted by lastSeen then count)
    const trending_searches = terms
      .filter((t) => t.lastSeen >= trendingSince)
      .sort((a, b) => b.lastSeen - a.lastSeen || b.count - a.count)
      .slice(0, limit)
      .map((t) => ({ term: t.term, count: t.count }));

    // hot_searches: top short list with labels (use term title-cased)
    const hot_searches = top_searches.slice(0, limit).map((t) => ({
      term: t.term,
      label: t.term
        .split(" ")
        .map((w) => w[0]?.toUpperCase() + w.slice(1))
        .join(" "),
    }));

    return { hot_searches, top_searches, trending_searches };
  },
});

export const logSearch = mutation({
  args: {
    userId: v.optional(v.string()),
    term: v.string(),
  },
  handler: async (ctx, args) => {
    const trimmed = args.term.trim();
    if (!trimmed) return { success: false };
    await ctx.db.insert("searches", {
      userId: args.userId,
      term: trimmed.toLowerCase(),
      createdAt: Date.now(),
    });
    return { success: true };
  },
});

// Admin: list recent searches
export const listRecentSearches = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    return await ctx.db.query("searches").order("desc").take(limit);
  },
});

export const searchProducts = query({
  args: {
    term: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const term = (args.term || "").trim().toLowerCase();
    const limit = args.limit ?? 8;

    // Minimum query length: 2 characters
    if (term.length < 2) {
      return [];
    }

    try {
      // Tokenize the search term
      const tokens = term.split(/\s+/).filter((t) => t.length > 0);

      // Use search index for the first token to get candidates (50 max)
      const candidates = await ctx.db
        .query("products")
        .withSearchIndex("search_products", (s) =>
          s.search("searchNormalized", tokens[0]).eq("isArchived", false),
        )
        .take(50);

      // Filter in-memory to ensure ALL tokens are present in searchNormalized
      const filtered = candidates.filter((p) => {
        const searchNormalized = (p.searchNormalized || "").toLowerCase();
        return tokens.every((token) => searchNormalized.includes(token));
      });

      return Promise.all(
        filtered.slice(0, limit).map(async (p: any) => {
          const images = await normalizeProductImages(ctx, p.images);
          const mainImageUrl = images[0];

          return {
            _id: p._id,
            phoneType: p.phoneType ?? undefined,
            brand: p.brand ?? undefined,
            model: p.model ?? undefined,
            storage: p.storage ?? undefined,
            condition: p.condition ?? undefined,
            price: p.price,
            images,
            mainImageUrl,
            exchange_available: p.exchange_available ?? undefined,
          };
        }),
      );
    } catch (err) {
      console.error("Search error:", err);
      return [];
    }
  },
});
