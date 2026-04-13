# Home KPI Dashboard + Alerts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Dashboard.tsx's mock stats/activity with live KPI cards, contextual quick actions, and an Alerts section backed by a real Convex query.

**Architecture:** Create `convex/dashboard.ts` with a single `getHomeMetrics` query. Two schema additions are required first: `threads.firstMessageAt` (optional number) and `messages.senderRole` (optional union). Add a backfill mutation for firstMessageAt. Rewrite Dashboard.tsx to consume the query via `useQuery`. Add URL param awareness to Inbox and Exchanges for alert deep links.

**Tech Stack:** React + TypeScript, Convex (backend query + schema), TailwindCSS, react-router-dom v6, lucide-react

---

## Key Constraints / Assumptions

- **Ethiopia time (Africa/Addis_Ababa = UTC+3):** All "today/yesterday" day boundaries use UTC+3 offset. `todayStart = floor((now + 3h) to midnight) - 3h`. No IANA tz library available in Convex; compute with fixed +3h offset arithmetic.
- **`firstMessageAt`** is NOT derived from `thread.createdAt`. It is the timestamp of the earliest **customer** message in the thread. We add `firstMessageAt: v.optional(v.number())` to the threads schema and provide a backfill mutation.
- **Median reply time** is computed per admin-reply-event: for each thread active today, find the most recent customer message that started a wait, then find the first human admin reply after it. Delta capped at 60 min. Compute median of all such deltas.
- **Bot exclusion:** Add `senderRole: v.optional(v.union("customer","admin","bot"))` to messages. A message is a human admin reply when `sender === "admin" && senderRole !== "bot"`. Existing messages have no senderRole → treated as human admin (safe: bot messages were not previously stored, so this is correct for existing data).
- Inbox and Exchanges still use mock API — deep links add URL param awareness and a filter label banner, not actual data filtering.
- Convex import path from `src/pages/`: `../../convex/_generated/api` (confirmed from Inventory.tsx).

---

## Ethiopia Time Helper

Reusable constant in `convex/dashboard.ts`:

```typescript
const ETH_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3

function ethDayBoundaries(now: number): { todayStart: number; yesterdayStart: number } {
  // Shift now to Ethiopia local time, find midnight, shift back to UTC
  const ethNow = now + ETH_OFFSET_MS;
  const ethMidnight = ethNow - (ethNow % 86_400_000); // floor to day in ETH
  const todayStart = ethMidnight - ETH_OFFSET_MS;      // back to UTC ms
  const yesterdayStart = todayStart - 86_400_000;
  return { todayStart, yesterdayStart };
}
```

---

## Task 0: Schema changes — add `threads.firstMessageAt` + `messages.senderRole`

**Files:**
- Modify: `convex/schema.ts`

### Step 1: Add `firstMessageAt` to threads table

In the threads defineTable block, add after `updatedAt`:
```typescript
firstMessageAt: v.optional(v.number()),
```

### Step 2: Add `senderRole` to messages table

In the messages defineTable block, add after `sender`:
```typescript
senderRole: v.optional(v.union(
  v.literal("customer"),
  v.literal("admin"),
  v.literal("bot")
)),
```

### Step 3: Verify no other files need updating

The `sender` field is unchanged — this is purely additive. Existing message creation code that only sets `sender` continues to work; `senderRole` is optional.

### Step 4: Deploy to dev to validate schema compiles

```bash
cd "d:/Abenier/Micky Mobile Admin/Admin-Ted"
npx convex dev --once
```
Expected: exits 0, no errors.

### Step 5: Commit

```bash
git add convex/schema.ts
git commit -m "feat(schema): add threads.firstMessageAt + messages.senderRole"
```

---

## Task 1: Backfill mutation — `convex/threads.ts` — `backfillFirstMessageAt`

**Files:**
- Modify (or Create if missing): `convex/threads.ts`

Check if `convex/threads.ts` exists. If not, create it. If it exists, append the mutation.

### Step 1: Write the mutation

```typescript
import { mutation } from "./_generated/server";

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
        .first(); // ascending by createdAt → earliest
      if (firstMsg) {
        await ctx.db.patch(thread._id, { firstMessageAt: firstMsg.createdAt });
        updated++;
      }
    }
    return { updated, total: threads.length };
  },
});
```

### Step 2: Deploy and run backfill via Convex dashboard

```bash
npx convex dev --once
```

Then from the Convex dashboard (https://dashboard.convex.dev), run `threads:backfillFirstMessageAt` once.
Document: backfill completed, N threads updated.

### Step 3: Commit

```bash
git add convex/threads.ts
git commit -m "feat(convex): add backfillFirstMessageAt mutation"
```

---

## Task 2: Create `convex/dashboard.ts` — `getHomeMetrics` query

**Files:**
- Create: `convex/dashboard.ts`

### Step 1: Write the full query

```typescript
// convex/dashboard.ts
import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

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

    // ── A) Replies Waiting > 15 min ─────────────────────────────────────────
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

    // ── B) First-Time Today (uses firstMessageAt, not createdAt) ────────────
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
    // For each thread with a customer message today:
    //   find the most recent customer message in [todayStart, now]
    //   find the first human admin reply after it
    //   sample = min(reply.createdAt - customerMsg.createdAt, 60 min)
    // Use both today and yesterday for comparison.

    async function computeMedianForWindow(
      from: number,
      to: number
    ): Promise<number> {
      // Get all customer messages in window
      const custMsgs = await ctx.db
        .query("messages")
        .withIndex("by_sender_and_createdAt", (q) =>
          q.eq("sender", "customer").gte("createdAt", from)
        )
        .filter((q) => q.lt(q.field("createdAt"), to))
        .collect();

      if (custMsgs.length === 0) return 0;

      // Group by thread: find last customer message per thread in window
      const lastCustByThread = new Map<string, number>();
      for (const m of custMsgs) {
        const k = m.threadId as string;
        if (!lastCustByThread.has(k) || m.createdAt > lastCustByThread.get(k)!) {
          lastCustByThread.set(k, m.createdAt);
        }
      }

      // Get all admin messages in window (+ a bit beyond, for replies that came after window end)
      const adminMsgs = await ctx.db
        .query("messages")
        .withIndex("by_sender_and_createdAt", (q) =>
          q.eq("sender", "admin").gte("createdAt", from)
        )
        .collect();

      // Filter: human admin only (exclude bot)
      const humanAdminMsgs = adminMsgs.filter((m) => m.senderRole !== "bot");

      // Group by thread: sorted ascending
      const adminByThread = new Map<string, number[]>();
      for (const m of humanAdminMsgs) {
        const k = m.threadId as string;
        if (!adminByThread.has(k)) adminByThread.set(k, []);
        adminByThread.get(k)!.push(m.createdAt);
      }
      for (const arr of adminByThread.values()) arr.sort((a, b) => a - b);

      // Build samples
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

    const medianReplyToday     = await computeMedianForWindow(todayStart, now);
    const medianReplyYesterday = await computeMedianForWindow(yesterdayStart, todayStart);

    // ── D) Phones Sold ────────────────────────────────────────────────────────
    const completedExchanges = await ctx.db
      .query("exchanges")
      .withIndex("by_status", (q) => q.eq("status", "Completed"))
      .collect();
    const phonesSoldToday     = completedExchanges.filter(
      (e) => e.completedAt != null && e.completedAt >= todayStart
    ).length;
    const phonesSoldYesterday = completedExchanges.filter(
      (e) =>
        e.completedAt != null &&
        e.completedAt >= yesterdayStart &&
        e.completedAt < todayStart
    ).length;

    // ── Follow-Up Pending (no admin reply >= 12h) ─────────────────────────────
    const followUpPending = activeThreads.filter(
      (t) =>
        t.lastCustomerMessageAt != null &&
        t.lastCustomerMessageAt < cutoff12h &&
        (t.lastAdminMessageAt == null ||
          t.lastCustomerMessageAt > t.lastAdminMessageAt)
    ).length;

    // ── Alerts ────────────────────────────────────────────────────────────────

    // 1. Waiting > 30 min
    const waiting30m = activeThreads.filter(
      (t) =>
        t.lastCustomerMessageAt != null &&
        t.lastCustomerMessageAt < cutoff30m &&
        (t.lastAdminMessageAt == null ||
          t.lastCustomerMessageAt > t.lastAdminMessageAt)
    ).length;

    // 2. Low stock products
    const allProducts = await ctx.db
      .query("products")
      .withIndex("by_isArchived_createdAt", (q) => q.eq("isArchived", false))
      .collect();
    const lowStock = allProducts.filter(
      (p) => p.lowStockThreshold != null && p.stockQuantity <= p.lowStockThreshold
    ).length;

    // 3. Reply speed ratio today vs yesterday
    const replySlowRatio =
      medianReplyYesterday > 0 && medianReplyToday > 0
        ? medianReplyToday / medianReplyYesterday
        : null;

    // 4. Unanswered today (firstMessageAt today, no admin reply yet)
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

    // 6. New customer spike (>50% and >=5 delta)
    const newCustomerDelta = firstTimeToday - firstTimeYesterday;
    const newCustomerPct =
      firstTimeYesterday > 0
        ? Math.round((newCustomerDelta / firstTimeYesterday) * 100)
        : null;

    return {
      repliesWaiting15m,
      repliesWaiting15mYesterday,
      firstTimeToday,
      firstTimeYesterday,
      medianReplyToday,
      medianReplyYesterday,
      phonesSoldToday,
      phonesSoldYesterday,
      followUpPending,
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
```

### Step 2: Deploy to dev to validate

```bash
npx convex dev --once
```
Expected: exits 0, `dashboard:getHomeMetrics` visible in function list.

### Step 3: Commit

```bash
git add convex/dashboard.ts
git commit -m "feat(convex): add getHomeMetrics dashboard query (ETH time, firstMessageAt, bot-safe median)"
```

---

## Task 3: Create `src/components/KpiCard.tsx`

**Files:**
- Create: `src/components/KpiCard.tsx`

Layout: title (top, wraps up to 2 lines, no ellipsis) → big number → comparison line.

### Step 1: Write the component

```tsx
// src/components/KpiCard.tsx
interface KpiCardProps {
  title: string;
  value: string | number;
  comparison?: string;
  comparisonColor?: string;
  onClick?: () => void;
}

export default function KpiCard({
  title,
  value,
  comparison,
  comparisonColor = 'text-gray-400',
  onClick,
}: KpiCardProps) {
  const Tag = onClick ? 'button' : ('div' as 'button' | 'div');
  return (
    <Tag
      {...(onClick ? { onClick, type: 'button' as const } : {})}
      className={`bg-white rounded-2xl p-4 shadow-sm border border-black/5 text-left w-full${
        onClick ? ' active:scale-[0.98] transition-transform cursor-pointer' : ''
      }`}
    >
      {/* Title — wrap up to 2 lines, never truncate */}
      <p
        className="text-xs text-gray-500 font-medium leading-snug"
        style={{
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {title}
      </p>
      {/* Big number */}
      <p className="text-3xl font-bold text-gray-900 mt-1 leading-none">{value}</p>
      {/* Comparison */}
      {comparison != null && (
        <p className={`text-xs mt-1.5 leading-snug ${comparisonColor}`}>{comparison}</p>
      )}
    </Tag>
  );
}
```

### Step 2: Commit

```bash
git add src/components/KpiCard.tsx
git commit -m "feat(components): add KpiCard with wrapping title, big number, comparison line"
```

---

## Task 4: Rewrite `src/pages/Dashboard.tsx`

**Files:**
- Modify (full rewrite): `src/pages/Dashboard.tsx`

Replace entire file. Remove all mock API dependencies. All previous imports from `../lib/api` are dropped.

### Step 1: Write the new Dashboard.tsx

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Settings as SettingsIcon, X } from 'lucide-react';
import KpiCard from '../components/KpiCard';
import LoadingSpinner from '../components/LoadingSpinner';
import { getTelegramUser } from '../lib/telegram';

// ── Helpers ────────────────────────────────────────────────────────────────

function deltaSign(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function replyDot(minutes: number): string {
  if (minutes <= 10) return '🟢';
  if (minutes <= 30) return '🟡';
  return '🔴';
}

// ── Broadcast Modal (MVP placeholder) ─────────────────────────────────────

function BroadcastModal({ onClose }: { onClose: () => void }) {
  const [message, setMessage] = useState('');
  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-end"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white w-full rounded-t-3xl p-6 space-y-4 max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold text-gray-900">📢 Broadcast Promo</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full hover:bg-gray-100"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>
        <select className="w-full border border-gray-200 rounded-xl p-3 text-sm text-gray-700 bg-white">
          <option value="">Select template…</option>
          <option value="iphone">📱 iPhone deals this week</option>
          <option value="arrivals">🆕 New arrivals</option>
          <option value="promo">🎉 Special promo</option>
        </select>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Write your message here…"
          className="w-full border border-gray-200 rounded-xl p-3 text-sm h-28 resize-none text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          disabled={!message.trim()}
          className="w-full bg-blue-600 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-xl py-3 font-semibold text-sm transition-colors"
        >
          Send Broadcast
        </button>
        <p className="text-[11px] text-gray-400 text-center">
          Send functionality coming soon
        </p>
      </div>
    </div>
  );
}

// ── Alert row ──────────────────────────────────────────────────────────────

function AlertItem({
  emoji,
  text,
  onClick,
}: {
  emoji: string;
  text: string;
  onClick?: () => void;
}) {
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex items-start gap-3 px-4 py-3 w-full text-left active:bg-gray-50 transition-colors"
      >
        <span className="text-base flex-shrink-0 mt-0.5">{emoji}</span>
        <p className="text-sm text-gray-700 leading-snug">{text}</p>
      </button>
    );
  }
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className="text-base flex-shrink-0 mt-0.5">{emoji}</span>
      <p className="text-sm text-gray-700 leading-snug">{text}</p>
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate();
  const user = getTelegramUser();
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [showAllAlerts, setShowAllAlerts] = useState(false);

  const metrics = useQuery(api.dashboard.getHomeMetrics);

  if (metrics === undefined) {
    return (
      <div className="flex items-center justify-center h-screen">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // ── KPI values ────────────────────────────────────────────────────────────

  // A — Replies Waiting
  const kpiA_delta = metrics.repliesWaiting15m - metrics.repliesWaiting15mYesterday;
  const kpiA_comparison = `${deltaSign(kpiA_delta)} vs yesterday`;
  const kpiA_compColor =
    metrics.repliesWaiting15m > 0 ? 'text-amber-500' : 'text-gray-400';

  // B — First-Time Today
  const kpiB_pct =
    metrics.firstTimeYesterday > 0
      ? Math.round(
          ((metrics.firstTimeToday - metrics.firstTimeYesterday) /
            metrics.firstTimeYesterday) *
            100
        )
      : null;
  const kpiB_comparison =
    kpiB_pct != null ? `${deltaSign(kpiB_pct)}% vs yesterday` : `${metrics.firstTimeToday} total`;
  const kpiB_compColor =
    kpiB_pct != null && kpiB_pct > 0 ? 'text-green-600' : 'text-gray-400';

  // C — Median Reply Time
  const kpiC_value =
    metrics.medianReplyToday > 0 ? `${metrics.medianReplyToday} min` : '—';
  const kpiC_dot = metrics.medianReplyToday > 0 ? replyDot(metrics.medianReplyToday) : '';
  const kpiC_delta = metrics.medianReplyToday - metrics.medianReplyYesterday;
  const kpiC_comparison =
    metrics.medianReplyToday > 0 && metrics.medianReplyYesterday > 0
      ? `${Math.abs(kpiC_delta)} min ${kpiC_delta <= 0 ? 'faster' : 'slower'} · ${kpiC_dot}`
      : metrics.medianReplyToday > 0
      ? `${kpiC_dot} today`
      : 'No data yet';
  const kpiC_compColor =
    kpiC_delta <= 0 ? 'text-green-600' : kpiC_delta <= 10 ? 'text-amber-500' : 'text-red-500';

  // D — Phones Sold
  const kpiD_delta = metrics.phonesSoldToday - metrics.phonesSoldYesterday;
  const kpiD_comparison = `${deltaSign(kpiD_delta)} vs yesterday`;
  const kpiD_compColor = kpiD_delta >= 0 ? 'text-green-600' : 'text-red-500';

  // ── Alerts ─────────────────────────────────────────────────────────────────

  const { alerts } = metrics;
  const activeAlerts: { emoji: string; text: string; to?: string }[] = [];

  if (alerts.waiting30m > 0) {
    activeAlerts.push({
      emoji: '⏳',
      text: `${alerts.waiting30m} thread${alerts.waiting30m > 1 ? 's' : ''} waiting over 30 min`,
      to: '/inbox?filter=waiting30',
    });
  }
  if (alerts.lowStock > 0) {
    activeAlerts.push({
      emoji: '📦',
      text: `${alerts.lowStock} item${alerts.lowStock > 1 ? 's' : ''} low on stock`,
      to: '/inventory?filter=lowstock',
    });
  }
  if (alerts.replySlowRatio != null && alerts.replySlowRatio > 1.3) {
    activeAlerts.push({
      emoji: '🐢',
      text: `Reply speed ${alerts.replySlowRatio.toFixed(1)}× slower than yesterday`,
      to: '/inbox',
    });
  }
  if (alerts.unansweredToday > 0) {
    activeAlerts.push({
      emoji: '🔕',
      text: `${alerts.unansweredToday} thread${alerts.unansweredToday > 1 ? 's' : ''} unanswered today`,
      to: '/inbox?filter=unanswered',
    });
  }
  if (alerts.quotes48h > 0) {
    activeAlerts.push({
      emoji: '💰',
      text: `${alerts.quotes48h} quote${alerts.quotes48h > 1 ? 's' : ''} open for over 48 hours`,
      to: '/exchanges?filter=quoted',
    });
  }
  if (
    alerts.newCustomerPct != null &&
    alerts.newCustomerPct > 50 &&
    alerts.newCustomerDelta >= 5
  ) {
    activeAlerts.push({
      emoji: '🆕',
      text: `${alerts.newCustomerToday} new customers today (+${alerts.newCustomerPct}%)`,
      to: '/inbox?filter=firstContact',
    });
  }

  const PREVIEW = 4;
  const visibleAlerts = showAllAlerts ? activeAlerts : activeAlerts.slice(0, PREVIEW);
  const hasMore = activeAlerts.length > PREVIEW && !showAllAlerts;
  const followUpDisabled = metrics.followUpPending === 0;

  return (
    <>
      <div className="min-h-screen bg-gray-50">
        {/* Sticky Header */}
        <div className="sticky top-0 z-30 bg-white px-4 pt-4 pb-4 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 font-medium">Good day,</p>
              <h1 className="text-xl font-bold text-gray-900">{user.first_name} 👋</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Open settings"
                onClick={() => navigate('/settings')}
                className="w-10 h-10 rounded-full border border-gray-100 bg-gray-50 flex items-center justify-center text-gray-600 active:scale-95 transition-transform"
              >
                <SettingsIcon size={18} />
              </button>
              <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
                {user.first_name.charAt(0).toUpperCase()}
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 py-4 space-y-4">
          {/* KPI Grid */}
          <div>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Today's Overview
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <KpiCard
                title="Replies Waiting"
                value={metrics.repliesWaiting15m}
                comparison={kpiA_comparison}
                comparisonColor={kpiA_compColor}
                onClick={() => navigate('/inbox?filter=waiting30')}
              />
              <KpiCard
                title="First-Time Today"
                value={metrics.firstTimeToday}
                comparison={kpiB_comparison}
                comparisonColor={kpiB_compColor}
                onClick={() => navigate('/inbox?filter=firstContact')}
              />
              <KpiCard
                title="Median Reply Time"
                value={kpiC_value}
                comparison={kpiC_comparison}
                comparisonColor={kpiC_compColor}
                onClick={() => navigate('/inbox')}
              />
              <KpiCard
                title="Phones Sold"
                value={metrics.phonesSoldToday}
                comparison={kpiD_comparison}
                comparisonColor={kpiD_compColor}
                onClick={() => navigate('/exchanges')}
              />
            </div>
          </div>

          {/* Quick Actions */}
          <div>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Quick Actions
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setShowBroadcast(true)}
                className="bg-blue-600 text-white rounded-2xl p-4 flex items-center gap-2 active:scale-95 transition-transform shadow-sm"
              >
                <span className="text-lg leading-none">📢</span>
                <span className="text-sm font-semibold leading-snug">Broadcast Promo</span>
              </button>
              <button
                type="button"
                onClick={() => !followUpDisabled && navigate('/inbox?filter=followUp')}
                disabled={followUpDisabled}
                className={`rounded-2xl p-4 flex items-center gap-2 transition-transform shadow-sm border ${
                  followUpDisabled
                    ? 'bg-gray-100 border-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-white border-gray-100 text-gray-800 active:scale-95'
                }`}
              >
                <span className="text-lg leading-none">💬</span>
                <span className="text-sm font-semibold leading-snug">
                  Follow Up
                  {metrics.followUpPending > 0
                    ? ` · ${metrics.followUpPending} pending`
                    : ' · 0 pending'}
                </span>
              </button>
            </div>
          </div>

          {/* Alerts */}
          <div>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Alerts
            </h2>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {activeAlerts.length === 0 ? (
                <p className="text-center text-gray-500 text-sm py-8">
                  ✅ Nothing needs attention
                </p>
              ) : (
                <>
                  {visibleAlerts.map((alert, idx) => (
                    <div
                      key={idx}
                      className={
                        idx < visibleAlerts.length - 1 || hasMore
                          ? 'border-b border-gray-50'
                          : ''
                      }
                    >
                      <AlertItem
                        emoji={alert.emoji}
                        text={alert.text}
                        onClick={alert.to ? () => navigate(alert.to!) : undefined}
                      />
                    </div>
                  ))}
                  {hasMore && (
                    <button
                      type="button"
                      onClick={() => setShowAllAlerts(true)}
                      className="w-full py-3 text-xs font-medium text-blue-600 text-center active:bg-gray-50 transition-colors"
                    >
                      Show {activeAlerts.length - PREVIEW} more
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {showBroadcast && <BroadcastModal onClose={() => setShowBroadcast(false)} />}
    </>
  );
}
```

### Step 2: Verify old imports are gone

The file must NOT import from `../lib/api`. Run:
```bash
grep "from '../lib/api'" src/pages/Dashboard.tsx
```
Expected: no output.

### Step 3: Commit

```bash
git add src/pages/Dashboard.tsx
git commit -m "feat(ui): rewrite Dashboard with KPI cards, alerts, quick actions (Convex live data)"
```

---

## Task 5: Add `?filter=` URL param awareness to `src/pages/Inbox.tsx`

**Files:**
- Modify: `src/pages/Inbox.tsx`

### Step 1: Add useSearchParams import

In imports, add to the react-router-dom line:
```tsx
import { useNavigate, useSearchParams } from 'react-router-dom';
```

### Step 2: Read filter param inside component

Add immediately after `const navigate = useNavigate();`:
```tsx
const [searchParams] = useSearchParams();
const filterParam = searchParams.get('filter');

const FILTER_LABELS: Record<string, string> = {
  waiting30:    'Waiting >30 min',
  followUp:     'Follow Up',
  unanswered:   'Unanswered today',
  firstContact: 'First contact',
};
const filterLabel = filterParam ? (FILTER_LABELS[filterParam] ?? filterParam) : null;
```

### Step 3: Switch to 'all' tab on mount when filter param present

Add this useEffect BEFORE the existing useEffects:
```tsx
useEffect(() => {
  if (filterParam) setActiveTab('all');
}, []); // run once on mount
// eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally run once
```

Actually, to avoid lint issues, use this safe version:
```tsx
const didApplyFilter = useRef(false);
useEffect(() => {
  if (filterParam && !didApplyFilter.current) {
    didApplyFilter.current = true;
    setActiveTab('all');
  }
}, [filterParam]);
```

Add `useRef` to the React import: `import { useEffect, useRef, useState } from 'react';`

### Step 4: Add filter banner in JSX

Inside the sticky header div, AFTER `<h1 className="text-xl font-bold text-gray-900 mb-3">Inbox</h1>`, add:
```tsx
{filterLabel && (
  <div className="mx-4 mb-2 flex items-center gap-2 bg-blue-50 rounded-xl px-3 py-2">
    <span className="text-xs font-medium text-blue-700">Filtering: {filterLabel}</span>
  </div>
)}
```

### Step 5: Commit

```bash
git add src/pages/Inbox.tsx
git commit -m "feat(inbox): add URL filter param awareness for deep links"
```

---

## Task 6: Add `?filter=` URL param awareness to `src/pages/Exchanges.tsx`

**Files:**
- Modify: `src/pages/Exchanges.tsx`

Same pattern as Task 5.

### Step 1: Add useSearchParams import

```tsx
import { useNavigate, useSearchParams } from 'react-router-dom';
```

### Step 2: Read filter param

After `const navigate = useNavigate();`:
```tsx
const [searchParams] = useSearchParams();
const filterParam = searchParams.get('filter');
const FILTER_LABELS: Record<string, string> = {
  quoted: 'Open Quotes',
};
const filterLabel = filterParam ? (FILTER_LABELS[filterParam] ?? filterParam) : null;
```

### Step 3: Add filter banner in JSX

After `<h1 className="text-xl font-bold text-gray-900 mb-3">Exchanges</h1>`:
```tsx
{filterLabel && (
  <div className="mx-4 mb-2 flex items-center gap-2 bg-blue-50 rounded-xl px-3 py-2">
    <span className="text-xs font-medium text-blue-700">Filtering: {filterLabel}</span>
  </div>
)}
```

### Step 4: Commit

```bash
git add src/pages/Exchanges.tsx
git commit -m "feat(exchanges): add URL filter param awareness for deep links"
```

---

## Task 7: Build verification + Convex prod deploy + final push

### Step 1: Run build

```bash
cd "d:/Abenier/Micky Mobile Admin/Admin-Ted"
npm run build
```

Expected: `✓ built in X.XXs` — zero TypeScript errors.

**Common issues:**
| Error | Fix |
|-------|-----|
| `api.dashboard is not defined` | Run `npx convex dev --once` to regenerate `_generated/api.ts` |
| `No overload matches this call` on `Tag` in KpiCard | Use separate returns for button/div instead of conditional tag |
| `useRef` not in imports | Add to React import |

### Step 2: Deploy Convex to production

```bash
npx convex deploy --yes
```

Expected: `Successfully deployed to fastidious-schnauzer-265`

### Step 3: Final push

```bash
git push origin main
```

---

## Files Changed Summary

| File | Action |
|------|--------|
| `convex/schema.ts` | Add `threads.firstMessageAt` + `messages.senderRole` |
| `convex/threads.ts` | Add `backfillFirstMessageAt` mutation |
| `convex/dashboard.ts` | Create `getHomeMetrics` query |
| `src/components/KpiCard.tsx` | Create new card component |
| `src/pages/Dashboard.tsx` | Full rewrite |
| `src/pages/Inbox.tsx` | Add filter param awareness |
| `src/pages/Exchanges.tsx` | Add filter param awareness |

## Backend Assumptions Summary

1. **Ethiopia UTC+3** — fixed offset arithmetic, no tz library needed.
2. **`firstMessageAt`** — stored on thread from earliest customer message; backfill mutation covers existing threads. Threads without it (pre-backfill) won't appear in first-time counts until backfill runs.
3. **Median** — two indexed queries (customer msgs + admin msgs in window), joined in memory. O(messages today) which is small for MVP.
4. **Bot exclusion** — `senderRole === "bot"` filter; existing messages have no senderRole → treated as human admin (correct for existing data since bots weren't previously used).
5. **Products low stock** — full scan of non-archived products in memory (fine at <10K products).
