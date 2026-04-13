# Affiliates Quick Action Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an "Affiliates" Quick Action button to the Admin Home dashboard that opens a bottom-sheet modal showing an affiliate/referral overview.

**Architecture:** Full-stack addition — two new Convex tables (`affiliates`, `referrals`), a new `convex/affiliates.ts` query file, and a new `AffiliatesModal` component inside `src/pages/Dashboard.tsx`. Follows the identical modal pattern as the existing Restock Suggestions and Content Plan quick actions.

**Tech Stack:** Convex (schema + query), React + TypeScript (modal component), Tailwind CSS (CSS custom properties).

---

## Task 1: Add `affiliates` and `referrals` tables to Convex schema

**Files:**
- Modify: `convex/schema.ts` (end of file, before the closing `}`of `defineSchema`)

**Step 1: Add the two new tables**

At the very end of `convex/schema.ts`, just before the final `});` closing line (currently line 312), insert the following two table definitions:

```ts
  /* =========================
     AFFILIATES
  ========================= */
  affiliates: defineTable({
    code: v.string(),
    ownerTelegramUserId: v.string(),
    createdAt: v.number(),
    status: v.union(v.literal("active"), v.literal("inactive")),
  })
    .index("by_code", ["code"])
    .index("by_status", ["status"])
    .index("by_ownerTelegramUserId", ["ownerTelegramUserId"]),

  /* =========================
     REFERRALS
  ========================= */
  referrals: defineTable({
    code: v.string(),
    referredTelegramUserId: v.string(),
    createdAt: v.number(),
    source: v.optional(v.string()),
  })
    .index("by_code", ["code"])
    .index("by_createdAt", ["createdAt"])
    .index("by_referred_and_code", ["referredTelegramUserId", "code"]),
```

The final `convex/schema.ts` closing should look like:
```ts
    .index("by_referred_and_code", ["referredTelegramUserId", "code"]),
});
```

**Step 2: Verify the schema compiles**

```bash
cd "d:/Abenier/Micky Mobile Admin/Admin-Ted"
npx tsc --noEmit
```

Expected: no errors (TypeScript only checks, no emit).

**Step 3: Commit**

```bash
git add convex/schema.ts
git commit -m "feat: add affiliates and referrals tables to Convex schema"
```

---

## Task 2: Create `convex/affiliates.ts` with `getOverview` query

**Files:**
- Create: `convex/affiliates.ts`

**Step 1: Create the file with the query**

Create `convex/affiliates.ts` with this exact content:

```ts
// convex/affiliates.ts
import { query } from "./_generated/server";

// ── Ethiopia time (UTC+3) — same helper as dashboard.ts ────────────────────
const ETH_OFFSET_MS = 3 * 60 * 60 * 1000;

function ethTodayStart(now: number): number {
  const ethNow = now + ETH_OFFSET_MS;
  const ethMidnight = ethNow - (ethNow % 86_400_000);
  return ethMidnight - ETH_OFFSET_MS;
}

export const getOverview = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const todayStart = ethTodayStart(now);

    // ── Active affiliate count ────────────────────────────────────────────
    const activeAffiliates = await ctx.db
      .query("affiliates")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    const totalAffiliates = activeAffiliates.length;

    // ── All referrals (for grouping / distinct counts) ────────────────────
    const allReferrals = await ctx.db.query("referrals").collect();

    // Distinct referred users
    const uniqueUsers = new Set(allReferrals.map((r) => r.referredTelegramUserId));
    const totalReferredPeople = uniqueUsers.size;

    // New today (Ethiopian timezone)
    const newReferralsToday = allReferrals.filter(
      (r) => r.createdAt >= todayStart
    ).length;

    // Top 3 codes by total referral count
    const codeCounts = new Map<string, number>();
    for (const r of allReferrals) {
      codeCounts.set(r.code, (codeCounts.get(r.code) ?? 0) + 1);
    }
    const topCodes = Array.from(codeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([code, count]) => ({ code, count }));

    // Recent 5 referrals newest-first
    const recentReferrals = [...allReferrals]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5)
      .map((r) => ({
        code: r.code,
        referredTelegramUserId: r.referredTelegramUserId,
        createdAt: r.createdAt,
        source: r.source,
      }));

    return {
      totalAffiliates,
      totalReferredPeople,
      newReferralsToday,
      topCodes,
      recentReferrals,
    };
  },
});
```

**Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add convex/affiliates.ts
git commit -m "feat: add affiliates getOverview Convex query"
```

---

## Task 3: Update `src/pages/Dashboard.tsx` — add `AffiliatesModal` component

**Files:**
- Modify: `src/pages/Dashboard.tsx`

### Sub-task 3a: Add the `AffiliatesModal` component

Insert this entire component block into `src/pages/Dashboard.tsx` **immediately before** the `// ── Alert row ──` comment line (currently at line 401). This keeps it grouped with the other modal components.

```tsx
// ── Affiliates Overview Modal ──────────────────────────────────────────────

function relativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'yesterday';
  return `${diffDay}d ago`;
}

function AffiliatesModal({
  data,
  onClose,
}: {
  data: {
    totalAffiliates: number;
    totalReferredPeople: number;
    newReferralsToday: number;
    topCodes: Array<{ code: string; count: number }>;
    recentReferrals: Array<{
      code: string;
      referredTelegramUserId: string;
      createdAt: number;
      source?: string;
    }>;
  };
  onClose: () => void;
}) {
  const stats: [string, number][] = [
    ['Total Affiliates', data.totalAffiliates],
    ['Total Referred People', data.totalReferredPeople],
    ['New Referrals Today', data.newReferralsToday],
  ];

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-end"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full rounded-t-3xl p-6 space-y-5 max-h-[85vh] overflow-y-auto"
        style={{ background: 'var(--surface)' }}
      >
        {/* Header */}
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text)' }}>🤝 Affiliate Overview</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full transition-colors"
            style={{ color: 'var(--muted)' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Stats */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
        >
          {stats.map(([label, value], idx) => (
            <div
              key={label}
              className="flex items-center justify-between px-4 py-3"
              style={idx < stats.length - 1 ? { borderBottom: '1px solid var(--border)' } : {}}
            >
              <p className="text-sm" style={{ color: 'var(--muted)' }}>{label}</p>
              <p className="text-sm font-bold tabular-nums" style={{ color: 'var(--text)' }}>{value}</p>
            </div>
          ))}
        </div>

        {/* Top 3 Codes */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted)' }}>
            Top 3 Codes by Referrals
          </p>
          {data.topCodes.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: 'var(--muted)' }}>No referrals yet</p>
          ) : (
            <div
              className="rounded-2xl overflow-hidden"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            >
              {data.topCodes.map((item, idx) => (
                <div
                  key={item.code}
                  className="flex items-center gap-3 px-4 py-3"
                  style={idx < data.topCodes.length - 1 ? { borderBottom: '1px solid var(--border)' } : {}}
                >
                  <span
                    className="text-xs font-bold w-4 flex-shrink-0 tabular-nums"
                    style={{ color: 'var(--muted)' }}
                  >
                    {idx + 1}
                  </span>
                  <p className="flex-1 text-sm font-semibold font-mono" style={{ color: 'var(--text)' }}>
                    {item.code}
                  </p>
                  <p className="text-sm font-bold tabular-nums" style={{ color: 'var(--primary)' }}>
                    {item.count}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Referrals */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted)' }}>
            Recent Referrals (last 5)
          </p>
          {data.recentReferrals.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: 'var(--muted)' }}>No referrals yet</p>
          ) : (
            <div
              className="rounded-2xl overflow-hidden"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            >
              {data.recentReferrals.map((r, idx) => (
                <div
                  key={`${r.code}-${r.referredTelegramUserId}-${idx}`}
                  className="flex items-start gap-3 px-4 py-3"
                  style={idx < data.recentReferrals.length - 1 ? { borderBottom: '1px solid var(--border)' } : {}}
                >
                  <span className="text-base flex-shrink-0 mt-0.5">🔗</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold font-mono truncate" style={{ color: 'var(--text)' }}>
                        {r.code}
                      </p>
                      <p className="text-xs flex-shrink-0" style={{ color: 'var(--muted)' }}>
                        {relativeTime(r.createdAt)}
                      </p>
                    </div>
                    <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>
                      uid {r.referredTelegramUserId}
                      {r.source ? ` · ${r.source}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-xl py-3 font-semibold text-sm active:scale-[0.98] transition-transform"
          style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
```

### Sub-task 3b: Add state + query in the `Dashboard` function

In the `Dashboard` function body (currently around line 435–451), add the following:

1. **After `const [showContentPlan, setShowContentPlan] = useState(false);` (line 439)**, add:
   ```tsx
   const [showAffiliates, setShowAffiliates] = useState(false);
   ```

2. **After `const demand = useQuery(api.dashboard.getDemandMetrics);` (line 443)**, add:
   ```tsx
   const affiliatesData = useQuery(api.affiliates.getOverview);
   ```

3. **Update the loading gate** at line 445 from:
   ```tsx
   if (metrics === undefined || demand === undefined) {
   ```
   to:
   ```tsx
   if (metrics === undefined || demand === undefined || affiliatesData === undefined) {
   ```

### Sub-task 3c: Add the "Affiliates" button to the Quick Actions grid

In the Quick Actions `<div className="grid grid-cols-2 gap-3">` block (currently lines 581–604), add a third button **after** the Content Plan button, before the closing `</div>`:

```tsx
              <button
                type="button"
                onClick={() => setShowAffiliates(true)}
                className="rounded-2xl p-4 flex items-center gap-2 active:scale-95 transition-transform col-span-2"
                style={{
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                }}
              >
                <span className="text-lg leading-none">🤝</span>
                <span className="text-sm font-semibold leading-snug">Affiliates</span>
              </button>
```

The `col-span-2` makes the Affiliates button span the full width of the 2-column grid, making it look intentional as a "featured" third action rather than an orphaned half-width button.

### Sub-task 3d: Add the modal render at the bottom of the JSX

After the existing `{showContentPlan && (…)}` block (currently ends at line 664), add:

```tsx
      {showAffiliates && affiliatesData && (
        <AffiliatesModal data={affiliatesData} onClose={() => setShowAffiliates(false)} />
      )}
```

**Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/pages/Dashboard.tsx
git commit -m "feat: add Affiliates quick action button and overview modal"
```

---

## Task 4: Build and verify

**Step 1: Run the build**

```bash
cd "d:/Abenier/Micky Mobile Admin/Admin-Ted"
npm run build
```

Expected output ends with something like:
```
✓ built in X.XXs
```

No TypeScript errors, no Vite build errors. If there are errors, fix them before proceeding.

---

## Task 5: Deploy Convex backend to production

**Step 1: Deploy schema + new query to prod**

```bash
cd "d:/Abenier/Micky Mobile Admin/Admin-Ted"
npx convex deploy --yes
```

This deploys to `fastidious-schnauzer-265` (the production Convex deployment used by the live Vercel app). Expected output ends with:
```
Convex functions ready! (X functions)
```

**Note:** This creates the `affiliates` and `referrals` tables in the production database. Both will be empty until populated via the bot or a separate admin tool.

---

## Task 6: Commit remaining files and push

**Step 1: Check status**

```bash
git status
```

**Step 2: Stage and commit any remaining changes**

If there are uncommitted changes (e.g. if you committed incrementally in earlier tasks, this may be empty):

```bash
git add -A
git commit -m "chore: finalize affiliates feature build artifacts"
```

**Step 3: Push to remote**

```bash
git push
```

---

## Verification Checklist

After completing all tasks:

- [ ] `npm run build` completes with no errors
- [ ] `npx convex deploy --yes` succeeds
- [ ] Admin Home dashboard loads without errors
- [ ] Quick Actions section shows three buttons: Restock Suggestions, Content Plan (7d), Affiliates
- [ ] Tapping "Affiliates" opens the bottom-sheet modal
- [ ] Modal displays: 3 stat rows, "Top 3 Codes" section (empty state if no data), "Recent Referrals" section (empty state if no data), Close button
- [ ] Tapping outside the modal or "Close" dismisses it
- [ ] No new bottom-nav tabs added
