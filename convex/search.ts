import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

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
      userId: args.userId ?? null,
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
    category: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const term = (args.term || "").trim();
    const limit = args.limit ?? 24;
    const status = args.status ?? "active";

    let rawResults: any[];

    if (term) {
      // Pure functional chain — each method consumes its receiver and returns a
      // fresh SearchFilterBuilderImpl. Never reuse a builder instance.
      rawResults = await ctx.db
        .query("products")
        .withSearchIndex("search_products", (s) =>
          args.category
            ? s.search("name", term).eq("status", status).eq("category", args.category)
            : s.search("name", term).eq("status", status),
        )
        .limit(limit)
        .collect();
    } else {
      // No search term: .search() is required to use the search index, so fall
      // back to a regular filtered query to avoid an illegal empty-term search.
      rawResults = await ctx.db
        .query("products")
        .filter((q) =>
          args.category
            ? q.and(
                q.eq(q.field("status"), status),
                q.eq(q.field("category"), args.category),
              )
            : q.eq(q.field("status"), status),
        )
        .take(limit);
    }

    return rawResults.map((p: any) => ({
      id: p._id,
      name: p.name,
      description: p.description ?? null,
      price: p.price,
      currency: p.currency,
      images: p.images ?? [],
      category: p.category ?? null,
      tags: p.tags ?? [],
      status: p.status,
      isFeatured: !!p.isFeatured,
      isNewArrival: !!p.isNewArrival,
      isPopular: !!p.isPopular,
      createdAt: p.createdAt,
    }));
  },
});
