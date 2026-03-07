// convex/dashboard.ts
import { query } from "./_generated/server";

// ── Ethiopia time (UTC+3) ───────────────────────────────────────────────────
const ETH_OFFSET_MS = 3 * 60 * 60 * 1000;

function ethDayBoundaries(now: number): { todayStart: number; yesterdayStart: number } {
  const ethNow = now + ETH_OFFSET_MS;
  const ethMidnight = ethNow - (ethNow % 86_400_000);
  const todayStart = ethMidnight - ETH_OFFSET_MS;
  const yesterdayStart = todayStart - 86_400_000;
  return { todayStart, yesterdayStart };
}

// ── Median helper ───────────────────────────────────────────────────────────
function medianMs(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export const getHomeMetrics = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const { todayStart, yesterdayStart } = ethDayBoundaries(now);

    const cutoff15m = now - 15 * 60_000;
    const cutoff30m = now - 30 * 60_000;
    const cutoff12h = now - 12 * 3_600_000;
    const cutoff48h = now - 48 * 3_600_000;

    // ── Fetch all threads ────────────────────────────────────────────────────
    const allThreads = await ctx.db.query("threads").collect();
    const activeThreads = allThreads.filter(
      (t) => t.status === "new" || t.status === "seen"
    );

    // ── A) Replies Waiting > 15 min ──────────────────────────────────────────
    const repliesWaiting15m = activeThreads.filter(
      (t) =>
        t.lastCustomerMessageAt != null &&
        t.lastCustomerMessageAt < cutoff15m &&
        (t.lastAdminMessageAt == null ||
          t.lastCustomerMessageAt > t.lastAdminMessageAt)
    ).length;

    const repliesWaiting15mYesterday = allThreads.filter(
      (t) =>
        t.lastCustomerMessageAt != null &&
        t.lastCustomerMessageAt >= yesterdayStart &&
        t.lastCustomerMessageAt < todayStart &&
        (t.lastAdminMessageAt == null ||
          t.lastCustomerMessageAt > t.lastAdminMessageAt)
    ).length;

    // ── B) First-Time Today ──────────────────────────────────────────────────
    // Uses firstMessageAt (not createdAt). Threads without firstMessageAt
    // (pre-backfill) are excluded from this count until backfill is run.
    const firstTimeToday = allThreads.filter(
      (t) => t.firstMessageAt != null && t.firstMessageAt >= todayStart
    ).length;
    const firstTimeYesterday = allThreads.filter(
      (t) =>
        t.firstMessageAt != null &&
        t.firstMessageAt >= yesterdayStart &&
        t.firstMessageAt < todayStart
    ).length;

    // ── C) Median Reply Time ─────────────────────────────────────────────────
    // Algorithm:
    // 1. Get all customer messages in the time window (indexed)
    // 2. For each thread: find the last customer message in the window
    // 3. Get all human admin messages in the window (indexed, bot excluded)
    // 4. For each thread: find the first human admin reply after the last customer msg
    // 5. Sample = min(reply.createdAt - lastCustMsg.createdAt, 60 min)
    // 6. Return median of all samples in minutes

    async function computeMedianForWindow(from: number, to: number): Promise<number> {
      const custMsgs = await ctx.db
        .query("messages")
        .withIndex("by_sender_and_createdAt", (q) =>
          q.eq("sender", "customer").gte("createdAt", from)
        )
        .filter((q) => q.lt(q.field("createdAt"), to))
        .collect();

      if (custMsgs.length === 0) return 0;

      // Last customer message per thread in this window
      const lastCustByThread = new Map<string, number>();
      for (const m of custMsgs) {
        const k = m.threadId as string;
        if (!lastCustByThread.has(k) || m.createdAt > lastCustByThread.get(k)!) {
          lastCustByThread.set(k, m.createdAt);
        }
      }

      // All admin messages from window start onwards (replies may come slightly after window)
      const adminMsgs = await ctx.db
        .query("messages")
        .withIndex("by_sender_and_createdAt", (q) =>
          q.eq("sender", "admin").gte("createdAt", from)
        )
        .collect();

      // Exclude bot messages
      const humanAdminMsgs = adminMsgs.filter((m) => m.senderRole !== "bot");

      // Group admin messages by thread, sorted ascending
      const adminByThread = new Map<string, number[]>();
      for (const m of humanAdminMsgs) {
        const k = m.threadId as string;
        if (!adminByThread.has(k)) adminByThread.set(k, []);
        adminByThread.get(k)!.push(m.createdAt);
      }
      for (const arr of adminByThread.values()) arr.sort((a, b) => a - b);

      // Build samples: first admin reply after last customer message
      const samples: number[] = [];
      for (const [threadKey, lastCustTs] of lastCustByThread) {
        const adminTimes = adminByThread.get(threadKey);
        if (!adminTimes) continue;
        const firstReply = adminTimes.find((t) => t > lastCustTs);
        if (firstReply != null) {
          samples.push(Math.min(firstReply - lastCustTs, 3_600_000));
        }
      }

      return Math.round(medianMs(samples) / 60_000);
    }

    const medianReplyToday = await computeMedianForWindow(todayStart, now);
    const medianReplyYesterday = await computeMedianForWindow(yesterdayStart, todayStart);

    // ── D) Phones Sold ────────────────────────────────────────────────────────
    const completedExchanges = await ctx.db
      .query("exchanges")
      .withIndex("by_status", (q) => q.eq("status", "Completed"))
      .collect();
    const phonesSoldToday = completedExchanges.filter(
      (e) => e.completedAt != null && e.completedAt >= todayStart
    ).length;
    const phonesSoldYesterday = completedExchanges.filter(
      (e) =>
        e.completedAt != null &&
        e.completedAt >= yesterdayStart &&
        e.completedAt < todayStart
    ).length;

    // ── Follow-Up Pending ─────────────────────────────────────────────────────
    // Active threads, last msg was customer >= 12h ago, no subsequent admin reply
    const followUpPending = activeThreads.filter(
      (t) =>
        t.lastCustomerMessageAt != null &&
        t.lastCustomerMessageAt < cutoff12h &&
        (t.lastAdminMessageAt == null ||
          t.lastCustomerMessageAt > t.lastAdminMessageAt)
    ).length;

    // ── Alerts ────────────────────────────────────────────────────────────────

    // 1. Threads waiting > 30 min
    const waiting30m = activeThreads.filter(
      (t) =>
        t.lastCustomerMessageAt != null &&
        t.lastCustomerMessageAt < cutoff30m &&
        (t.lastAdminMessageAt == null ||
          t.lastCustomerMessageAt > t.lastAdminMessageAt)
    ).length;

    // 2. Low stock products
    const adminSettingsDocs = await ctx.db.query("adminSettings").collect();
    const adminSettings = adminSettingsDocs[0] ?? null;
    const allProducts = await ctx.db
      .query("products")
      .withIndex("by_isArchived_createdAt", (q) => q.eq("isArchived", false))
      .collect();
    const lowStock = allProducts.filter((p) => {
      const threshold =
        p.lowStockThreshold ??
        (p.type === "phone"
          ? (adminSettings?.phoneLowStockThreshold ?? 2)
          : (adminSettings?.accessoryLowStockThreshold ?? 2));
      return p.stockQuantity > 0 && p.stockQuantity <= threshold;
    }).length;

    // 3. Reply speed ratio today vs yesterday (>1.3x = noticeably slower)
    const replySlowRatio =
      medianReplyYesterday > 0 && medianReplyToday > 0
        ? medianReplyToday / medianReplyYesterday
        : null;

    // 4. Threads with firstMessageAt today but no admin reply yet
    const unansweredToday = allThreads.filter(
      (t) =>
        t.firstMessageAt != null &&
        t.firstMessageAt >= todayStart &&
        !t.hasAdminReplied
    ).length;

    // 5. Quotes open > 48h
    const quotedExchanges = await ctx.db
      .query("exchanges")
      .withIndex("by_status", (q) => q.eq("status", "Quoted"))
      .collect();
    const quotes48h = quotedExchanges.filter(
      (e) => e.quotedAt != null && e.quotedAt < cutoff48h
    ).length;

    // 6. New customer spike: > 50% increase and >= 5 new customers
    const newCustomerDelta = firstTimeToday - firstTimeYesterday;
    const newCustomerPct =
      firstTimeYesterday > 0
        ? Math.round((newCustomerDelta / firstTimeYesterday) * 100)
        : null;

    return {
      // KPI A
      repliesWaiting15m,
      repliesWaiting15mYesterday,
      // KPI B
      firstTimeToday,
      firstTimeYesterday,
      // KPI C
      medianReplyToday,
      medianReplyYesterday,
      // KPI D
      phonesSoldToday,
      phonesSoldYesterday,
      // Quick action
      followUpPending,
      // Alerts
      alerts: {
        waiting30m,
        lowStock,
        replySlowRatio,
        unansweredToday,
        quotes48h,
        newCustomerToday: firstTimeToday,
        newCustomerDelta,
        newCustomerPct,
      },
    };
  },
});

// ── Demand Metrics (new Home dashboard cards) ───────────────────────────────

export const getDemandMetrics = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const { todayStart } = ethDayBoundaries(now);
    const week7Start = now - 7 * 86_400_000;
    const month30Start = now - 30 * 86_400_000;

    // ── Conversations ─────────────────────────────────────────────────────────
    const allThreads = await ctx.db.query("threads").collect();

    // Total: threads with any customer message activity in window
    const totalConvToday = allThreads.filter(
      (t) => t.lastCustomerMessageAt != null && t.lastCustomerMessageAt >= todayStart
    ).length;
    const totalConv7d = allThreads.filter(
      (t) => t.lastCustomerMessageAt != null && t.lastCustomerMessageAt >= week7Start
    ).length;
    const totalConv30d = allThreads.filter(
      (t) => t.lastCustomerMessageAt != null && t.lastCustomerMessageAt >= month30Start
    ).length;

    // First-time: thread's very first customer message is in window
    const firstConvToday = allThreads.filter(
      (t) => t.firstMessageAt != null && t.firstMessageAt >= todayStart
    ).length;
    const firstConv7d = allThreads.filter(
      (t) => t.firstMessageAt != null && t.firstMessageAt >= week7Start
    ).length;
    const firstConv30d = allThreads.filter(
      (t) => t.firstMessageAt != null && t.firstMessageAt >= month30Start
    ).length;

    // ── Phone type demand (from demand_events in last 7d) ────────────────────
    // source breakdown: "bot" | "search" | "select"
    // Log events via demand:logDemandEvent from the bot / mini app.
    const events7d = await ctx.db
      .query("demand_events")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", week7Start))
      .collect();

    // Count by phoneType and source
    const signalMap = new Map<string, { bot: number; search: number; select: number }>();
    for (const event of events7d) {
      const existing = signalMap.get(event.phoneType) ?? { bot: 0, search: 0, select: 0 };
      if (event.source === "bot") existing.bot++;
      else if (event.source === "search") existing.search++;
      else existing.select++;
      signalMap.set(event.phoneType, existing);
    }

    // Sort by totalSignals descending
    const sortedByDemand = [...signalMap.entries()]
      .map(([phoneType, counts]) => ({
        phoneType,
        total: counts.bot + counts.search + counts.select,
        bot: counts.bot,
        search: counts.search,
        select: counts.select,
      }))
      .sort((a, b) => b.total - a.total);

    const topPhoneTypes = sortedByDemand.slice(0, 3).map((item) => ({
      phoneType: item.phoneType,
      totalSignals: item.total,
      botSignals: item.bot,
      searchSignals: item.search,
      selectSignals: item.select,
    }));

    // ── Active inventory by phoneType ─────────────────────────────────────────
    // "available" = non-archived product with stockQuantity > 0
    const activeProducts = await ctx.db
      .query("products")
      .withIndex("by_isArchived_createdAt", (q) => q.eq("isArchived", false))
      .collect();

    // Keys are lowercased so they match normalized demand_events phoneType values.
    // Products store "iPhone 13"; demand events store "iphone 13" after normalization.
    const stockByPhoneType = new Map<string, number>();
    for (const p of activeProducts) {
      if (!p.phoneType) continue;
      const key = p.phoneType.toLowerCase();
      stockByPhoneType.set(key, (stockByPhoneType.get(key) ?? 0) + p.stockQuantity);
    }

    // Requested but not available: demanded phone types with 0 active in-stock units
    const notAvailable = sortedByDemand
      .filter((item) => (stockByPhoneType.get(item.phoneType) ?? 0) === 0)
      .slice(0, 3)
      .map((item) => ({ phoneType: item.phoneType, totalSignals: item.total }));

    // Top 5 demanded with stock info (for Restock Suggestions modal)
    const restockData = sortedByDemand.slice(0, 5).map((item) => ({
      phoneType: item.phoneType,
      totalSignals: item.total,
      availableStock: stockByPhoneType.get(item.phoneType) ?? 0,
    }));

    // Available stock snapshot sorted by qty desc (for Content Plan modal)
    const availableStock = activeProducts
      .filter((p) => p.stockQuantity > 0 && p.phoneType)
      .sort((a, b) => b.stockQuantity - a.stockQuantity)
      .slice(0, 8)
      .map((p) => ({ phoneType: p.phoneType!, stock: p.stockQuantity, price: p.price }));

    return {
      totalConversations: { today: totalConvToday, week7: totalConv7d, month30: totalConv30d },
      firstTimeConversations: { today: firstConvToday, week7: firstConv7d, month30: firstConv30d },
      topPhoneTypes,
      notAvailable,
      restockData,
      availableStock,
    };
  },
});
