# Affiliate Mutations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `getOrCreateMyAffiliate` and `trackReferral` write mutations to `convex/affiliates.ts` so the customer Earn page and Telegram bot can populate the affiliates and referrals tables.

**Architecture:** Both mutations are appended to the existing `convex/affiliates.ts` file. No new files needed. The import line is updated to include `mutation` alongside the existing `query`. After adding the code, Convex types are regenerated, the build is verified, and the functions are deployed to production (`fastidious-schnauzer-265`).

**Tech Stack:** Convex 1.32 (mutations), TypeScript 5.9, `v` from `convex/values`.

---

## Task 1: Add `getOrCreateMyAffiliate` mutation

**Files:**
- Modify: `convex/affiliates.ts` (line 2 — import; append after line 67)

**Step 1: Update the import to include `mutation`**

Change line 2 from:
```ts
import { query } from "./_generated/server";
```
to:
```ts
import { query, mutation } from "./_generated/server";
```

Also add `v` to the values import — add a second import line after the server import:
```ts
import { v } from "convex/values";
```

**Step 2: Append `getOrCreateMyAffiliate` to the end of the file**

After the closing `});` of `getOverview` (currently line 67), add a blank line then:

```ts
// ── getOrCreateMyAffiliate ────────────────────────────────────────────────
// Called by the customer mini app Earn page on load.
// Returns the existing affiliate for this user, or creates one if none exists.
// Code format: "REF" + 6 random digits. Collision-safe via do…while loop.

export const getOrCreateMyAffiliate = mutation({
  args: { telegramUserId: v.string() },
  handler: async (ctx, { telegramUserId }) => {
    // 1. Return existing affiliate if present
    const existing = await ctx.db
      .query("affiliates")
      .withIndex("by_ownerTelegramUserId", (q) =>
        q.eq("ownerTelegramUserId", telegramUserId)
      )
      .first();
    if (existing) return existing;

    // 2. Generate a unique 6-digit code
    let code: string;
    do {
      code = "REF" + Math.floor(100_000 + Math.random() * 900_000).toString();
    } while (
      await ctx.db
        .query("affiliates")
        .withIndex("by_code", (q) => q.eq("code", code))
        .first()
    );

    // 3. Insert and return the new affiliate
    const id = await ctx.db.insert("affiliates", {
      code,
      ownerTelegramUserId: telegramUserId,
      createdAt: Date.now(),
      status: "active",
    });

    return ctx.db.get(id);
  },
});
```

**Step 3: Verify TypeScript**

```bash
cd "d:/Abenier/Micky Mobile Admin/Admin-Ted"
npx tsc --noEmit
```

Expected: no output, exit code 0.

---

## Task 2: Append `trackReferral` mutation

**Files:**
- Modify: `convex/affiliates.ts` (append after `getOrCreateMyAffiliate`)

**Step 1: Append `trackReferral` to the end of the file**

After the closing `});` of `getOrCreateMyAffiliate`, add a blank line then:

```ts
// ── trackReferral ─────────────────────────────────────────────────────────
// Called by the Telegram bot on /start <code>, or any surface recording a referral.
// Silently no-ops on unknown codes and duplicate (code, user) pairs.

export const trackReferral = mutation({
  args: {
    code: v.string(),
    referredTelegramUserId: v.string(),
    source: v.optional(v.string()),
  },
  handler: async (ctx, { code, referredTelegramUserId, source }) => {
    // 1. Verify the affiliate code exists — ignore silently if not
    const affiliate = await ctx.db
      .query("affiliates")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();
    if (!affiliate) return { inserted: false };

    // 2. Idempotency: skip if this (referredUser, code) pair already recorded
    const duplicate = await ctx.db
      .query("referrals")
      .withIndex("by_referred_and_code", (q) =>
        q.eq("referredTelegramUserId", referredTelegramUserId).eq("code", code)
      )
      .first();
    if (duplicate) return { inserted: false };

    // 3. Insert referral
    await ctx.db.insert("referrals", {
      code,
      referredTelegramUserId,
      createdAt: Date.now(),
      source,
    });

    return { inserted: true };
  },
});
```

**Step 2: Verify TypeScript**

```bash
cd "d:/Abenier/Micky Mobile Admin/Admin-Ted"
npx tsc --noEmit
```

Expected: no output, exit code 0.

---

## Task 3: Build, regenerate types, deploy, commit, push

**Step 1: Full production build**

```bash
cd "d:/Abenier/Micky Mobile Admin/Admin-Ted"
npm run build
```

Expected output ends with: `✓ built in X.XXs`

If the build fails with a TypeScript error about missing `api.affiliates.getOrCreateMyAffiliate` or `api.affiliates.trackReferral`, run codegen first:

```bash
npx convex codegen
```

Then re-run `npm run build`.

**Step 2: Confirm git diff is scoped**

```bash
git diff --stat
```

Expected: only `convex/affiliates.ts` modified (plus possibly `convex/_generated/api.d.ts` if codegen ran).

**Step 3: Deploy to production Convex**

```bash
npx convex deploy --yes
```

Expected output includes:
```
✔ Deployed Convex functions to https://fastidious-schnauzer-265.convex.cloud
```

Verify the deploy output does NOT show any deleted functions or removed indexes.

**Step 4: Commit all changes**

```bash
git add convex/affiliates.ts convex/_generated/api.d.ts docs/plans/2026-03-01-affiliate-mutations-design.md docs/plans/2026-03-01-affiliate-mutations.md
git commit -m "feat: add getOrCreateMyAffiliate and trackReferral mutations

- getOrCreateMyAffiliate: find-or-create with REF+6digit code, collision-safe
- trackReferral: idempotent referral recording, silent no-op on unknown codes
- Deploy to fastidious-schnauzer-265 (prod)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

**Step 5: Push**

```bash
git push
```

Expected: `main -> main` push confirmation.

---

## Verification Checklist

- [ ] `npx tsc --noEmit` passes after each task
- [ ] `npm run build` passes with no errors
- [ ] `npx convex deploy --yes` succeeds — shows the two new functions deployed
- [ ] Only `convex/affiliates.ts` (and optionally `convex/_generated/api.d.ts`) changed
- [ ] Commit pushed to `main`
- [ ] (Manual, optional) Convex dashboard → Functions tab shows `affiliates:getOrCreateMyAffiliate` and `affiliates:trackReferral`
