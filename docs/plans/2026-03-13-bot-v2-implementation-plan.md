# TedyTech Bot V2 — AI Brain Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the live TedyTech Telegram bot from a JS-fuzzy-match-centric V1 pipeline to a V2 AI-brain architecture where Gemini resolves shorthand product names against real Convex inventory, and sell/exchange flows progress through explicit multi-step intake states.

**Architecture:** Convex compact catalog is fetched before Call 1 (tiered by brand/featured/full). Call 1 (Gemini, temp 0.1) receives the inventory and returns structured routing with matched product IDs. A deterministic ID Validator node guards against hallucinated IDs before routing to path-specific execution. V1 stays live on the production webhook until V2 passes full test-bot validation.

**Tech Stack:** n8n (workflow orchestration), Convex (database + mutations), OpenRouter → Gemini 3.1 Flash Lite (AI calls), Telegram Bot API

**Spec source:** `docs/plans/2026-03-13-bot-v2-ai-brain-design.md`

---

## 1. Executive Summary

V2 is built as a parallel n8n workflow (`TedyTech V2 - AI Brain`) with V1's webhook kept active throughout. Ten implementation phases cover Convex data prep (Phase A), the n8n workflow scaffold (Phase B), the AI brain call and validator (Phases C–D), the intake state machine (Phases E–F), the response generation layer (Phase G), test-bot QA (Phase H), production cutover (Phase I), and post-launch monitoring (Phase J).

The plan is grounded entirely in the approved spec. Four schema-reality corrections from reading the live codebase are locked in Section 2 below — these are not spec changes, they are the spec adapted to the existing Convex schema.

---

## 2. Frozen Design Decisions

These are locked for the entire implementation. Do not deviate without explicit revision.

### 2A. Thread State Table (New)

The `threads` table does not currently exist in `convex/schema.ts`. V1 stores conversation memory in n8n's in-process session storage. V2 moves this to Convex for persistence and intake state tracking.

**Add to `convex/schema.ts`:**

```ts
threads: defineTable({
  chatId: v.string(),                    // Telegram chat_id (unique per conversation)
  telegramUserId: v.string(),            // Telegram user_id
  username: v.optional(v.string()),
  firstName: v.optional(v.string()),
  lastMessageAt: v.number(),             // Unix ms — updated on every message
  firstMessageAt: v.number(),            // Unix ms — set on first message, never updated
  messageCount: v.number(),              // Incremented on every message
  recentMessages: v.array(v.object({
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    timestamp: v.number(),
  })),                                   // Capped at last 5 pairs (10 entries max)
  intake: v.optional(v.object({
    flow: v.union(v.literal("sell"), v.literal("exchange")),
    status: v.union(
      v.literal("start"),
      v.literal("in_progress"),
      v.literal("complete"),
    ),
    data: v.object({
      offered_model:      v.optional(v.string()),
      offered_storage:    v.optional(v.string()),
      offered_condition:  v.optional(v.union(
        v.literal("new"),
        v.literal("good"),
        v.literal("fair"),
        v.literal("poor"),
      )),
      asking_price:       v.optional(v.number()),
      desired_product_id:   v.optional(v.string()),
      desired_product_name: v.optional(v.string()),
      customer_notes:     v.optional(v.string()),
    }),
    last_updated_at: v.number(),         // Unix ms
    write_key: v.string(),               // Dedup: "${telegram_message_id}:${flow}"
  })),
}).index("by_chatId", ["chatId"]),
```

**Intake state lifecycle:**
- **Read:** Node [4] queries `threads` by `chatId`. If `intake.status !== "complete"`, passes intake to Call 1 input.
- **Write (in-progress):** Node [12] patches `threads.intake` after `start_*` or `continue_*` actions. Skips write if `write_key` matches (idempotent).
- **Write (completion):** Node [13] writes final record to admin table, then patches `threads.intake = null`.
- **Never cleared mid-intake:** If user sends an off-topic message during intake, Call 1 reads `intake_state` and chooses whether to continue intake or acknowledge the digression.

### 2B. Candidate IDs Hard Cap

- `candidate_ids` maximum: **4**
- If Call 1 returns > 4 IDs: ID Validator truncates to 4, sets `routing_action = "show_candidates"`
- If 5+ matches and no dominant candidate (all `confidence = "low"`): set `routing_action = "ask_clarification"`, empty `candidate_ids`
- Hard cap is enforced by Node [9] (ID Validator), not by Call 1

### 2C. Tier 2 Featured Selection Rule (Deterministic)

Tier 2 is triggered when no brand_hint is detected and message is discovery-style or vague.

**Exact sort priority:**
1. `isNewArrival = true` — sort by `createdAt DESC` within this group
2. `isFeatured = true` — sort by `createdAt DESC` within this group
3. `isPopular = true` — sort by `createdAt DESC` within this group
4. Remaining `status = "active"` products — sort by `price DESC`

**Limit:** 25 total. If groups 1–3 total fewer than 10, supplement from group 4 until 25.
**Include out-of-stock:** `inStock = false` products are included but flagged. Call 1 uses them as candidates; Call 2 handles messaging.
**Only `status = "active"` products are ever returned** across all tiers.

### 2D. Brand and Storage Extraction

The `products` table has no `brand` or `storage` fields. Compact product queries derive these from `name` at query time using a deterministic helper function.

**`extractBrand(name: string): string`**
Check `name.toLowerCase()` against known brand list in order:
```
"iphone" | "apple" → "Apple"
"samsung" → "Samsung"
"tecno" | "camon" | "spark" | "phantom" → "Tecno"
"infinix" → "Infinix"
"itel" → "Itel"
"redmi" | "xiaomi" | "poco" → "Xiaomi"
"huawei" → "Huawei"
"pixel" | "google" → "Google"
default → "Other"
```

**`extractStorage(name: string): string | null`**
Regex: `/\b(64|128|256|512|1\s?tb)\s?gb?\b/i`
Returns matched group (e.g., "256GB") or `null`.

Both helpers live in `convex/lib/productHelpers.ts` (new file).

### 2E. source Field for Bot-Originated Records

**hotLeads:** Use `source: "bot"` — this is a valid enum value in the current schema.
**Bot exchange intake:** Write to the `exchanges` table (admin-managed, has `offeredDevice`, `requestedDevice`, `customerTelegramUserId`). Do NOT write to `exchangeRequests` (that table is miniapp-specific, has required `desiredPhoneId` and `sessionId` that don't apply to bot flows).

The `exchanges` table mutation will be `exchanges:createBotExchange`.

### 2F. resolution_status — Included

`resolution_status` is included. It is set by Node [9] (ID Validator) and flows downstream to Node [14] (Assemble Final Prompt) and Node [17] (Save Memory). It is not sent to the customer. Valid values:

| Value | Set when |
|---|---|
| `"ai_exact"` | matched_product_id confirmed, confidence high |
| `"ai_candidates"` | 2–4 candidate_ids confirmed by validator |
| `"ai_downgraded"` | AI said show_product, low confidence, validator downgraded |
| `"validator_rejected"` | AI matched_product_id not found in catalog |
| `"validator_candidate_filtered"` | Some candidate_ids removed by validator |
| `"intake_active"` | routing_action is a sell/exchange intake action |
| `"no_match"` | No candidates, no match |
| `"direct"` | Greeting, FAQ, direct answer |

### 2G. Convex Mutations Needed

| Function | File | Status | Action |
|---|---|---|---|
| `threads:getOrCreateThread` | `convex/threads.ts` (new) | Missing | Create |
| `threads:updateThread` | `convex/threads.ts` (new) | Missing | Create |
| `threads:updateIntakeState` | `convex/threads.ts` (new) | Missing | Create |
| `threads:clearIntakeState` | `convex/threads.ts` (new) | Missing | Create |
| `products:listCompactProductsByBrand` | `convex/products.ts` | Missing | Add |
| `products:listCompactFeaturedProducts` | `convex/products.ts` | Missing | Add |
| `products:listAllCompactProducts` | `convex/products.ts` | Missing | Add |
| `hotLeads:createBotHotLead` | `convex/hotLeads.ts` | Missing | Add |
| `exchanges:createBotExchange` | `convex/exchanges.ts` | Missing | Add |

---

## 3. Implementation Phases

---

### Phase A — Convex Data Prep

**Goal:** Add the `threads` table, compact product queries, brand/storage helpers, and bot-intake mutations to Convex. All changes are additive — nothing modifies existing functions used by V1 or the miniapp.

**Files touched:**
- Create: `D:/Ab/TedTech/convex/lib/productHelpers.ts`
- Create: `D:/Ab/TedTech/convex/threads.ts`
- Modify: `D:/Ab/TedTech/convex/schema.ts`
- Modify: `D:/Ab/TedTech/convex/products.ts`
- Modify: `D:/Ab/TedTech/convex/hotLeads.ts`
- Modify: `D:/Ab/TedTech/convex/exchanges.ts`

**Rollback safety:** All changes are additive. No existing functions are modified. V1 is unaffected. If any change causes a Convex deploy error, revert only the failing file.

---

#### Task A1: Add `threads` table to schema

- [ ] Open `D:/Ab/TedTech/convex/schema.ts`
- [ ] Add `threads` table definition (exact shape from Section 2A) at the end of the schema, before the closing `}`
- [ ] Run `npx convex dev` (or check Convex dashboard) and confirm schema deploys without error
- [ ] Verify the `threads` table appears in the Convex dashboard under Tables

**Acceptance criteria:** `threads` table exists in production Convex with all fields from Section 2A. Deploy succeeds with no errors.

**Test:** In Convex dashboard, manually insert a test thread record and verify all fields accept the expected types. Delete after testing.

**Risk:** If `threads` already exists via a migration not captured in schema.ts, this will cause a conflict. Check the Convex dashboard first — if `threads` table already exists, inspect its current fields before adding to schema.

---

#### Task A2: Create brand/storage helper functions

- [ ] Create file `D:/Ab/TedTech/convex/lib/productHelpers.ts`
- [ ] Implement `extractBrand(name: string): string`:

```ts
export function extractBrand(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("iphone") || lower.includes("apple")) return "Apple";
  if (lower.includes("samsung")) return "Samsung";
  if (lower.includes("tecno") || lower.includes("camon") ||
      lower.includes("spark") || lower.includes("phantom")) return "Tecno";
  if (lower.includes("infinix")) return "Infinix";
  if (lower.includes("itel")) return "Itel";
  if (lower.includes("redmi") || lower.includes("xiaomi") ||
      lower.includes("poco")) return "Xiaomi";
  if (lower.includes("huawei")) return "Huawei";
  if (lower.includes("pixel") || lower.includes("google")) return "Google";
  return "Other";
}
```

- [ ] Implement `extractStorage(name: string): string | null`:

```ts
export function extractStorage(name: string): string | null {
  const match = name.match(/\b(64|128|256|512|1\s?tb)\s?gb?\b/i);
  if (!match) return null;
  return match[0].replace(/\s/g, "").toUpperCase();
}
```

- [ ] Run `npx convex dev` — confirm file compiles without TypeScript errors

**Acceptance criteria:** Both functions compile. `extractBrand("Samsung Galaxy S24 256GB")` returns `"Samsung"`. `extractStorage("iPhone 13 Pro 128GB")` returns `"128GB"`. `extractStorage("Tecno Camon 20")` returns `null`.

**Test:** Add a quick inline test comment verifying the expected outputs. Remove after confirming.

---

#### Task A3: Add three compact product queries

- [ ] Open `D:/Ab/TedTech/convex/products.ts`
- [ ] Add import at top: `import { extractBrand, extractStorage } from "./lib/productHelpers";`
- [ ] Add a helper that maps a raw product to the compact shape:

```ts
const toCompact = (p: any) => ({
  id: p._id,
  name: p.name,
  brand: extractBrand(p.name),
  price: p.price,
  storage: extractStorage(p.name),
  inStock: p.inStock ?? true,
  hasImage: Array.isArray(p.images) && p.images.length > 0,
});
```

- [ ] Add `listCompactProductsByBrand` query:

```ts
export const listCompactProductsByBrand = query({
  args: { brand: v.string() },
  handler: async (ctx, args) => {
    const products = await ctx.db
      .query("products")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    return products
      .filter((p) => extractBrand(p.name) === args.brand)
      .map(toCompact);
  },
});
```

- [ ] Add `listCompactFeaturedProducts` query (Tier 2 deterministic rule):

```ts
export const listCompactFeaturedProducts = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cap = args.limit ?? 25;
    const all = await ctx.db
      .query("products")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    const byCreatedAtDesc = (a: any, b: any) => b.createdAt - a.createdAt;

    const newArrivals = all.filter((p) => p.isNewArrival).sort(byCreatedAtDesc);
    const featured = all
      .filter((p) => p.isFeatured && !p.isNewArrival)
      .sort(byCreatedAtDesc);
    const popular = all
      .filter((p) => p.isPopular && !p.isFeatured && !p.isNewArrival)
      .sort(byCreatedAtDesc);

    const tier1to3 = [...newArrivals, ...featured, ...popular];

    let result = tier1to3.slice(0, cap);
    if (result.length < 10) {
      const usedIds = new Set(result.map((p) => p._id));
      const supplement = all
        .filter((p) => !usedIds.has(p._id))
        .sort((a, b) => b.price - a.price);
      result = [...result, ...supplement].slice(0, cap);
    }

    return result.map(toCompact);
  },
});
```

- [ ] Add `listAllCompactProducts` query:

```ts
export const listAllCompactProducts = query({
  handler: async (ctx) => {
    const products = await ctx.db
      .query("products")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    return products.map(toCompact);
  },
});
```

- [ ] Run `npx convex dev` — confirm all three queries deploy without error

**Acceptance criteria:** Three queries callable via Convex REST API. `listCompactProductsByBrand({brand:"Samsung"})` returns only Samsung products. `listCompactFeaturedProducts({limit:25})` returns ≤ 25 active products sorted by priority rule. Each result has fields: `id, name, brand, price, storage, inStock, hasImage`.

**Test cases (run via Convex dashboard Functions tab):**
- `listCompactProductsByBrand({brand:"Samsung"})` — all results have `brand: "Samsung"`
- `listCompactProductsByBrand({brand:"Apple"})` — all results have `brand: "Apple"`
- `listCompactFeaturedProducts({limit:5})` — returns ≤ 5 results, prioritizes isNewArrival
- `listAllCompactProducts()` — returns all active products, none have `status != "active"`

**Risk:** If no products have `isNewArrival/isFeatured/isPopular = true`, Tier 2 falls through to supplement rule. This is expected behavior.

---

#### Task A4: Create `convex/threads.ts` with four mutations

- [ ] Create `D:/Ab/TedTech/convex/threads.ts`
- [ ] Implement `getOrCreateThread` (called by Node [4]):

```ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const getOrCreateThread = mutation({
  args: {
    chatId: v.string(),
    telegramUserId: v.string(),
    username: v.optional(v.string()),
    firstName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("threads")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .first();

    if (existing) return existing;

    const now = Date.now();
    const id = await ctx.db.insert("threads", {
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
```

- [ ] Implement `updateThread` (called by Node [17] — save memory):

```ts
export const updateThread = mutation({
  args: {
    chatId: v.string(),
    userMessage: v.string(),
    assistantMessage: v.string(),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .first();

    if (!thread) throw new Error(`Thread not found for chatId: ${args.chatId}`);

    const newMessages = [
      ...thread.recentMessages,
      { role: "user" as const, content: args.userMessage, timestamp: args.timestamp },
      { role: "assistant" as const, content: args.assistantMessage, timestamp: args.timestamp },
    ].slice(-10); // keep last 10 entries (5 pairs)

    await ctx.db.patch(thread._id, {
      recentMessages: newMessages,
      lastMessageAt: args.timestamp,
      messageCount: thread.messageCount + 1,
    });
  },
});
```

- [ ] Implement `updateIntakeState` (called by Node [12] — intake state manager):

```ts
export const updateIntakeState = mutation({
  args: {
    chatId: v.string(),
    flow: v.union(v.literal("sell"), v.literal("exchange")),
    status: v.union(v.literal("start"), v.literal("in_progress"), v.literal("complete")),
    data: v.object({
      offered_model:        v.optional(v.string()),
      offered_storage:      v.optional(v.string()),
      offered_condition:    v.optional(v.union(
        v.literal("new"), v.literal("good"),
        v.literal("fair"), v.literal("poor"),
      )),
      asking_price:         v.optional(v.number()),
      desired_product_id:   v.optional(v.string()),
      desired_product_name: v.optional(v.string()),
      customer_notes:       v.optional(v.string()),
    }),
    write_key: v.string(),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .first();

    if (!thread) throw new Error(`Thread not found for chatId: ${args.chatId}`);

    // Idempotency: skip if same write_key already processed
    if (thread.intake?.write_key === args.write_key) return { skipped: true };

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
```

- [ ] Implement `clearIntakeState` (called by Node [13] — after writing final record):

```ts
export const clearIntakeState = mutation({
  args: { chatId: v.string() },
  handler: async (ctx, args) => {
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .first();

    if (!thread) return;

    await ctx.db.patch(thread._id, { intake: undefined });
  },
});
```

- [ ] Run `npx convex dev` — confirm all four mutations deploy

**Acceptance criteria:** All four `threads` mutations callable via REST API. `getOrCreateThread` is idempotent (calling twice with same chatId returns same record). `updateIntakeState` with same `write_key` returns `{skipped: true}` second time.

**Test (Convex dashboard):**
- Call `getOrCreateThread({chatId:"test_123", telegramUserId:"456", firstName:"TestUser"})` — creates record
- Call again with same chatId — returns same record (no duplicate)
- Call `updateIntakeState` with `write_key: "99:sell"` twice — second call returns `{skipped: true}`

**Risk:** `getOrCreateThread` has a theoretical race condition: two simultaneous first messages from the same `chatId` could each call this mutation before either creates the thread, resulting in two `threads` documents for the same `chatId`. In practice this is extremely unlikely for a single-user chat, but to harden: add a `.unique()` index constraint or catch duplicate errors. For V2 launch this risk is acceptable given typical message rates.

---

#### Task A5: Add `createBotHotLead` mutation to hotLeads.ts

- [ ] Open `D:/Ab/TedTech/convex/hotLeads.ts`
- [ ] Add the following mutation at the end of the file:

```ts
export const createBotHotLead = mutation({
  args: {
    chatId: v.string(),
    telegramUserId: v.string(),
    firstName: v.optional(v.string()),
    intakeSummary: v.string(),    // Human-readable summary of intake data
    offeredModel: v.optional(v.string()),
    askingPrice: v.optional(v.number()),
    customerNotes: v.optional(v.string()),
    sellerId: v.id("sellers"),
    writeKey: v.string(),         // Dedup: "${telegram_message_id}:sell"
  },
  handler: async (ctx, args) => {
    // Duplicate-write protection: check if this write_key was already used
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .first();
    if (thread?.intake?.write_key === args.writeKey) {
      return { skipped: true, reason: "duplicate write_key" };
    }

    const now = Date.now();
    return await ctx.db.insert("hotLeads", {
      sellerId: args.sellerId,
      source: "bot",
      telegramUserId: args.telegramUserId,
      customerName: args.firstName,
      interestSummary: args.intakeSummary,
      message: args.offeredModel
        ? `Selling: ${args.offeredModel}${args.askingPrice ? ` — Asking: ${args.askingPrice} ETB` : ""}${args.customerNotes ? ` — Notes: ${args.customerNotes}` : ""}`
        : args.customerNotes,
      status: "new",
      createdAt: now,
      updatedAt: now,
    });
  },
});
```

**Note on `sellerId`:** This requires the bot to know the admin seller ID. The `sellerId` must be stored in n8n as an environment variable (`$env.TEDYTECH_SELLER_ID`). Verify the seller ID from the Convex `sellers` table before deploying V2.

- [ ] **Before adding the mutation:** Open `D:/Ab/TedTech/convex/hotLeads.ts` and confirm the `hotLeads` table's `source` field definition includes `v.literal("bot")`. If the schema only shows `v.literal("miniapp")` or similar, the mutation will fail Convex validation at runtime. Fix the schema first if needed (Task A1 already handles schema changes).
- [ ] Run `npx convex dev` — confirm mutation deploys

**Acceptance criteria:** Mutation creates a `hotLeads` record with `source: "bot"` and `status: "new"`. Visible in admin dashboard under Hot Leads.

**Risk:** If `hotLeads.source` enum doesn't include `"bot"`, the mutation throws a Convex validation error silently at runtime. The verification step above prevents this. Additionally, the `writeKey` dedup check queries the `threads` table — if the thread doesn't exist yet at write time (race condition), the dedup check returns null and the insert proceeds normally (safe).

---

#### Task A6: Add `createBotExchange` mutation to exchanges.ts

- [ ] Open `D:/Ab/TedTech/convex/exchanges.ts` (if it doesn't exist, check if exchange mutations are in another file)
- [ ] Locate where `exchanges` mutations are defined. If no dedicated mutations file exists, create `D:/Ab/TedTech/convex/exchangeMutations.ts` or add to an existing relevant file.
- [ ] Add:

```ts
export const createBotExchange = mutation({
  args: {
    chatId: v.string(),
    telegramUserId: v.string(),
    firstName: v.optional(v.string()),
    offeredDevice: v.string(),           // e.g., "iPhone 12 128GB, condition: good"
    requestedDevice: v.optional(v.string()), // desired product name if specified
    customerNotes: v.optional(v.string()),
    sellerId: v.id("sellers"),
    writeKey: v.string(),                // Dedup: "${telegram_message_id}:exchange"
  },
  handler: async (ctx, args) => {
    // Duplicate-write protection: check if this write_key was already used
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_chatId", (q) => q.eq("chatId", args.chatId))
      .first();
    if (thread?.intake?.write_key === args.writeKey) {
      return { skipped: true, reason: "duplicate write_key" };
    }

    const now = Date.now();
    return await ctx.db.insert("exchanges", {
      sellerId: args.sellerId,
      status: "pending",
      offeredDevice: args.offeredDevice,
      requestedDevice: args.requestedDevice,
      customerName: args.firstName,
      customerTelegramUserId: args.telegramUserId,
      valuationNote: args.customerNotes,
      createdAt: now,
      updatedAt: now,
    });
  },
});
```

- [ ] Run `npx convex dev` — confirm mutation deploys

**Acceptance criteria:** Mutation creates an `exchanges` record with `status: "pending"`. Visible in admin dashboard under Exchanges. `offeredDevice` contains the full sell-side device description built from intake data.

**Risk:** The `exchanges` table requires `sellerId: v.id("sellers")`. If `TEDYTECH_SELLER_ID` is not set in n8n env vars, this mutation will fail. Verify env var is set before Phase F (see Task B2). The `writeKey` dedup guard queries `threads` — same race condition note as Task A4 applies here; safe for V2 launch.

---

#### Task A7: Phase A acceptance gate

- [ ] Run `npx convex dev` from `D:/Ab/TedTech` — zero TypeScript errors, zero deploy errors
- [ ] Open Convex dashboard → Tables → confirm `threads` table exists
- [ ] Open Convex dashboard → Functions → confirm all new queries and mutations appear
- [ ] Call `listAllCompactProducts()` via dashboard — confirm ≥ 1 product returned with `{id, name, brand, price, storage, inStock, hasImage}` shape
- [ ] Confirm `listCompactProductsByBrand({brand:"Samsung"})` returns only Samsung products (if any exist)
- [ ] Confirm V1 n8n workflow is still executing normally (check last execution log)

---

### Phase B — n8n V2 Parallel Workflow Scaffold

**Goal:** Create the `TedyTech V2 - AI Brain` workflow in n8n as a copy of V1, with the V2 webhook immediately disabled. Establish the skeleton that Phases C–G will fill in.

**Files touched:** n8n workflow (via n8n UI — no file system changes)

**Rollback safety:** V2 webhook is disabled from the start. V1 continues handling all production traffic. No risk.

---

#### Task B1: Duplicate V1 workflow

- [ ] Open the n8n UI
- [ ] Find workflow `ip8TLyBJ5a7D7Tbx` (or by name "TedyTech Telegram AI Assistant")
- [ ] Use n8n's duplicate/copy workflow feature to create `TedyTech V2 - AI Brain`
- [ ] **Immediately disable the webhook** on the V2 workflow (toggle off or set webhook URL to inactive)
- [ ] Confirm V1 webhook is still active and live

**Acceptance criteria:** Two workflows exist. V1 webhook is active. V2 webhook is disabled. V2 is a functional copy of V1 that can be test-executed without affecting production.

---

#### Task B2: Add n8n environment variables

- [ ] In n8n Settings → Environment Variables (or `.env` file), add:
  - `CONVEX_URL` = `https://fastidious-schnauzer-265.convex.cloud`
  - `TEDYTECH_SELLER_ID` = (get from Convex `sellers` table — the active TedyTech seller document `_id`)
- [ ] Verify `OPENROUTER_API_KEY` is already set

**Acceptance criteria:** Three environment variables available in n8n. V2 nodes can reference them as `$env.CONVEX_URL`, `$env.TEDYTECH_SELLER_ID`, `$env.OPENROUTER_API_KEY`.

---

#### Task B3: Label and stage V2 nodes for replacement

- [ ] In V2 workflow, rename or add notes to the following nodes indicating they will be redesigned:
  - `Gemini Analysis Prep` → label: `[TO REPLACE - Phase C]`
  - `OpenRouter Analysis` → label: `[TO REPLACE - Phase C]`
  - `Parse Analysis` → label: `[TO REPLACE - Phase C]`
  - `Needs Database IF` → label: `[TO DELETE - Phase D]`
  - `Build Convex Query` → label: `[TO DELETE - Phase A queries replace this]`
  - `Convex Data Lookup` → label: `[TO REPLACE - Phase C]`
  - `Evaluate Match Quality` → label: `[TO DELETE - Phase D]`
  - `Assemble Final Prompt` → label: `[TO REPLACE - Phase G]`
- [ ] Save V2 workflow

**Acceptance criteria:** All nodes to be replaced are labeled. V2 can be test-executed in n8n using a manual trigger and produces a response (even if using V1 logic still).

---

### Phase C — Call 1 AI Brain (Nodes [2], [4], [5], [6], [7], [8])

**Goal:** Rebuild the first half of the V2 pipeline — pre-signals, memory load with intake, tiered inventory fetch, Call 1 prompt assembly, Call 1 execution, and parse. After this phase, Call 1 outputs the full V2 schema including `primary_intent`, `secondary_intent`, `routing_action`, `matched_product_id`, `candidate_ids`, and `match_reason`.

**Files/nodes touched:** n8n V2 workflow only — nodes [2], [4], [5], [6], [7], [8]. No Convex changes. No V1 changes.

**Rollback safety:** V2 webhook is disabled for all of Phase C. All edits are inside the V2 workflow copy. V1 is completely unaffected. If Phase C produces broken nodes, simply revert the individual node's code back to the V1 copy or delete and re-duplicate from V1.

---

#### Task C1: Enhance Node [2] — Normalize Input + Pre-signals

Replace the existing `Normalize Input` node's Code node logic with the following. This is a JavaScript Code node in n8n.

- [ ] Open Node [2] in V2 workflow
- [ ] Replace the Code node content with:

```js
// === NORMALIZE INPUT ===
const body = $input.item.json.body ?? $input.item.json;
const message = body.message ?? body.edited_message ?? {};
const chat = message.chat ?? {};
const from = message.from ?? {};
const text = (message.text ?? message.caption ?? "").trim();
const photo = message.photo;
const voice = message.voice;
const document = message.document;

const chatId = String(chat.id ?? "");
const userId = String(from.id ?? "");
const username = from.username ?? null;
const firstName = from.first_name ?? null;
const messageId = String(message.message_id ?? "");

// === PRE-SIGNALS ===

// Language hint — Amharic Unicode range
const amharicChars = (text.match(/[\u1200-\u137F]/g) ?? []).length;
const totalChars = text.replace(/\s/g, "").length;
let languageHint = "en";
if (totalChars > 0) {
  const amRatio = amharicChars / totalChars;
  if (amRatio > 0.6) languageHint = "am";
  else if (amRatio > 0.15) languageHint = "mixed";
}

// Media hint
const mediaHint = {
  has_photo: Array.isArray(photo) && photo.length > 0,
  has_voice: !!voice,
  has_document: !!document,
};

// Storage hint — loose regex
const storageMatch = text.match(/\b(64|128|256|512|1\s?tb)\s?gb?\b/i);
const storageHint = storageMatch ? storageMatch[0].replace(/\s/g, "").toUpperCase() : null;

// Brand hint — known brands (keys must be title-case to match extractBrand() output)
const knownBrands = {
  Apple: ["iphone", "apple"],
  Samsung: ["samsung"],
  Tecno: ["tecno", "camon", "spark", "phantom"],
  Infinix: ["infinix"],
  Itel: ["itel"],
  Xiaomi: ["redmi", "xiaomi", "poco"],
  Huawei: ["huawei"],
  Google: ["pixel", "google"],
};
const lowerText = text.toLowerCase();
let brandHint = null;
for (const [brand, keywords] of Object.entries(knownBrands)) {
  if (keywords.some(k => lowerText.includes(k))) {
    brandHint = brand;
    break;
  }
}

// Message length hint
const wordCount = text.split(/\s+/).filter(Boolean).length;
const messageLengthHint = wordCount <= 3 ? "short" : wordCount <= 12 ? "medium" : "long";

// Is first message flag (will be overridden by thread data in node [4])
const isFirstMessage = false; // placeholder — node [4] sets this correctly

return {
  json: {
    chatId,
    userId,
    username,
    firstName,
    messageId,
    messageText: text,
    telegramFileId: photo ? photo[photo.length - 1]?.file_id : null,
    isAdminSender: false, // placeholder — admin check to be added in Phase D
    preSignals: {
      language_hint: languageHint,
      media_hint: mediaHint,
      storage_hint: storageHint,
      brand_hint: brandHint,
      message_length_hint: messageLengthHint,
    },
  },
};
```

- [ ] Test node [2] in isolation with a test Telegram update payload containing text "S24 256gb" — confirm `brandHint: "Samsung"`, `storageHint: "256GB"`
- [ ] Test with Amharic text — confirm `languageHint: "am"`

---

#### Task C2: Redesign Node [4] — Load Conversation Memory + Intake

This node moves earlier in the pipeline (before inventory fetch). Replace with two HTTP Request nodes:

**Node [4a] — Load Thread (Convex mutation: `threads:getOrCreateThread`)**

- [ ] Add an HTTP Request node with:
  - Method: POST
  - URL: `{{ $env.CONVEX_URL }}/api/mutation`
  - Body:
  ```json
  {
    "path": "threads:getOrCreateThread",
    "args": {
      "chatId": "{{ $('Normalize Input').item.json.chatId }}",
      "telegramUserId": "{{ $('Normalize Input').item.json.userId }}",
      "username": "{{ $('Normalize Input').item.json.username }}",
      "firstName": "{{ $('Normalize Input').item.json.firstName }}"
    }
  }
  ```
- [ ] After this node, add a Code node that:
  - Reads the thread data
  - Sets `isFirstMessage = thread.messageCount === 0`
  - Extracts `intake_state = thread.intake ?? null`
  - Extracts `chatHistory = thread.recentMessages` (last 5 pairs)
  - Passes all through to next node

**Acceptance criteria:** Node [4] returns thread record including `intake` state (null or active). `isFirstMessage` is true only on first message.

---

#### Task C3: Build Node [5] — Tiered Inventory Fetch

This is a Code node followed by one HTTP Request node.

- [ ] Add Code node (Node [5a]) that determines the tier:

```js
const { brandHint, messageLengthHint } = $('Normalize Input').item.json.preSignals;
const chatHistory = $('Load Thread').item.json.chatHistory ?? [];
const intakeState = $('Load Thread').item.json.intake_state;

// No inventory needed for active intake flows
if (intakeState && intakeState.status !== "complete") {
  return { json: { fetchTier: "none", inventory: [] } };
}

// Detect cross-brand references in chat history
const brandMentions = new Set();
const allBrands = ["Apple","Samsung","Tecno","Infinix","Itel","Xiaomi","Huawei","Google"];
for (const msg of chatHistory) {
  for (const brand of allBrands) {
    if (msg.content.toLowerCase().includes(brand.toLowerCase())) {
      brandMentions.add(brand);
    }
  }
}
if (brandHint) brandMentions.add(brandHint);
const isCrossBrand = brandMentions.size >= 2;

let fetchTier;
if (brandHint && !isCrossBrand) {
  fetchTier = "brand";
} else if (!brandHint || messageLengthHint === "short") {
  fetchTier = "featured";
} else if (isCrossBrand) {
  fetchTier = "all";
} else {
  fetchTier = "featured";
}

return { json: { fetchTier, brandHint } };
```

- [ ] Add HTTP Request node (Node [5b]) with conditional path selection:
  - If `fetchTier = "brand"`: POST to `{{ $env.CONVEX_URL }}/api/query`, path `products:listCompactProductsByBrand`, args `{brand: brandHint}`
  - If `fetchTier = "featured"`: POST to `{{ $env.CONVEX_URL }}/api/query`, path `products:listCompactFeaturedProducts`, args `{limit: 25}`
  - If `fetchTier = "all"` or `"none"`: POST to `{{ $env.CONVEX_URL }}/api/query`, path `products:listAllCompactProducts`, args `{}`
  - `fetchTier = "none"` (active intake): return empty array without calling Convex

- [ ] Add a Code node (Node [5c]) after the fetch:
  - If Tier 1 returns 0 results: re-fetch using `listAllCompactProducts` (Tier 3 fallback)
  - Otherwise pass inventory array through

**Acceptance criteria:** Message "S24 how much" → `brandHint: "Samsung"` → Tier 1 fetch → inventory contains only Samsung products. Message "I want a phone" → `brandHint: null` → Tier 2 fetch → inventory contains featured products. Active intake → `fetchTier: "none"` → inventory is `[]`.

---

#### Task C4: Build Node [6] — Build Call 1 Prompt

Replace `Gemini Analysis Prep` with a Code node that assembles the Call 1 input:

- [ ] Add Code node that builds:

```js
const normalized = $('Normalize Input').item.json;
const thread = $('Load Thread').item.json;
const inventory = $('Fetch Inventory').item.json.inventory ?? [];

const systemPrompt = `You are TedyTech's AI product matching brain. TedyTech is a phone shop in Addis Ababa, Ethiopia.

## Your Job
Analyze the customer's message and:
1. Classify their primary and secondary business intent
2. Match their request to real products from the inventory list provided
3. Decide what action the bot should take next
4. For sell/exchange flows: progress the intake state

## Product Matching Rules
You have the FULL active inventory relevant to this message below.
- Match shorthand: "S24" → "Samsung Galaxy S24"
- Match partial: "13 Pro" → "iPhone 13 Pro"
- Match Amharic brand references correctly
- "Camon 20" → Tecno Camon 20
- If 2–4 products match: list all as candidate_ids (max 4)
- If 5+ products match and none is dominant: route to ask_clarification with empty candidate_ids
- If no match: route to no_match
- IMPORTANT: Only use IDs from the inventory list provided. Never invent an ID.

## Primary Intent Values (choose one)
buy_phone | sell_phone | exchange_phone | faq | greeting | unclear

## Secondary Intent Values (choose one or null)
ask_price | ask_availability | ask_photo | ask_specs | ask_location | ask_payment | ask_comparison | ask_recommendation | null

## Routing Action Values
show_product | show_candidates | ask_clarification | start_sell_intake | continue_sell_intake | sell_intake_complete | start_exchange_intake | continue_exchange_intake | exchange_intake_complete | discovery | greeting | direct_answer | no_match

## Intake Rules
- If intake_state is provided and status != "complete": continue the active intake flow
- For sell_intake: gather offered_model, offered_condition, asking_price (optional)
- For exchange_intake: gather offered device description, desired product (if specified)
- When all required fields are filled: set routing_action to *_intake_complete

## Confidence Values
high | medium | low

## Output Format
Return ONLY valid JSON. No markdown. No explanation.
{
  "primary_intent": "...",
  "secondary_intent": "...",
  "routing_action": "...",
  "matched_product_id": "id_from_inventory or null",
  "candidate_ids": ["id1", "id2"],
  "match_reason": "brief explanation of why this match was chosen",
  "confidence": "high|medium|low",
  "needs_clarification": false,
  "clarification_question": null,
  "entities": {"brand": null, "model": null, "storage": null},
  "is_followup": false,
  "followup_resolves_to": null,
  "intake_action": null,
  "intake_data": null
}`;

const userContent = `Customer message: "${normalized.messageText}"

Pre-signals: ${JSON.stringify(normalized.preSignals)}

Chat history (last 5 pairs):
${JSON.stringify(thread.chatHistory ?? [], null, 2)}

Current intake state: ${JSON.stringify(thread.intake_state ?? null)}

Inventory (${inventory.length} products):
${JSON.stringify(inventory, null, 2)}`;

return {
  json: {
    systemPrompt,
    userContent,
    inventorySnapshot: inventory, // passed to validator
  }
};
```

---

#### Task C5: Build Node [7] — OpenRouter Call 1 AI Brain

Replace `OpenRouter Analysis` with a reconfigured HTTP Request node:

- [ ] Configure HTTP Request node:
  - Method: POST
  - URL: `https://openrouter.ai/api/v1/chat/completions`
  - Headers: `Authorization: Bearer {{ $env.OPENROUTER_API_KEY }}`, `Content-Type: application/json`
  - Body (note: `max_tokens: 400` is intentionally higher than the spec's 300 — the V2 output schema is richer with intake fields and match_reason; 300 was insufficient in testing):
  ```json
  {
    "model": "google/gemini-3.1-flash-lite-preview",
    "temperature": 0.1,
    "max_tokens": 400,
    "response_format": {"type": "json_object"},
    "messages": [
      {"role": "system", "content": "{{ $('Build Call 1 Prompt').item.json.systemPrompt }}"},
      {"role": "user", "content": "{{ $('Build Call 1 Prompt').item.json.userContent }}"}
    ]
  }
  ```
  - `neverError: true` (same as V1 — capture HTTP errors as responses)

---

#### Task C6: Build Node [8] — Parse Call 1 Output

Replace `Parse Analysis` with a Code node:

- [ ] Add Code node:

```js
const raw = $input.item.json.choices?.[0]?.message?.content ?? "";
const inventory = $('Build Call 1 Prompt').item.json.inventorySnapshot ?? [];

let parsed;
try {
  // Handle JSON wrapped in markdown code blocks
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  parsed = JSON.parse(cleaned);
} catch (e) {
  parsed = {
    primary_intent: "unclear",
    secondary_intent: null,
    routing_action: "ask_clarification",
    matched_product_id: null,
    candidate_ids: [],
    match_reason: `Parse failed: ${e.message}`,
    confidence: "low",
    needs_clarification: true,
    clarification_question: null,
    entities: {},
    is_followup: false,
    followup_resolves_to: null,
    intake_action: null,
    intake_data: null,
  };
}

return {
  json: {
    ...parsed,
    inventorySnapshot: inventory, // passed to validator
  }
};
```

**Acceptance criteria (Phases C1–C6):** Test V2 workflow with manual trigger, message "Samsung S24 price". Call 1 output contains `primary_intent: "buy_phone"`, `secondary_intent: "ask_price"`, `routing_action: "show_product"`, `matched_product_id` is a real Samsung product ID from inventory (if any Samsung products exist), `match_reason` explains the S24 mapping.

---

### Phase D — ID Validator + Routing Switch (Nodes [9], [10])

**Goal:** Add the deterministic safety layer that catches hallucinated product IDs, enforces the candidate cap, and sets `resolution_status`. Then build the routing switch that sends execution to the correct path.

**Files/nodes touched:** n8n V2 workflow only — nodes [9], [10]. Delete nodes: `Needs Database IF`, `Build Convex Query`, `Convex Data Lookup`, `Evaluate Match Quality`. No Convex changes. No V1 changes.

**Rollback safety:** V2 webhook disabled. V1 unaffected.

---

#### Task D1: Build Node [9] — ID Validator

Add a Code node between `Parse Call 1 Output` and the routing switch:

- [ ] Add Code node:

```js
const call1 = $input.item.json;
const inventory = call1.inventorySnapshot ?? [];

// Build a Set of valid IDs for O(1) lookups
const validIds = new Set(inventory.map(p => p.id));
const inventoryMap = Object.fromEntries(inventory.map(p => [p.id, p]));

let {
  matched_product_id,
  candidate_ids = [],
  routing_action,
  confidence,
} = call1;

let resolution_status = "direct";
let out_of_stock = false;
const removedIds = [];

// Check 1: matched_product_id exists in inventory
if (matched_product_id && !validIds.has(matched_product_id)) {
  console.log(`[Validator] Rejected hallucinated ID: ${matched_product_id} — ${call1.match_reason}`);
  removedIds.push(matched_product_id);
  matched_product_id = null;
  routing_action = candidate_ids.length > 0 ? "show_candidates" : "ask_clarification";
  resolution_status = "validator_rejected";
}

// Check 2: filter and cap candidate_ids
const validCandidates = candidate_ids.filter(id => {
  if (!validIds.has(id)) {
    removedIds.push(id);
    return false;
  }
  return true;
});

if (removedIds.length > 0 && resolution_status !== "validator_rejected") {
  resolution_status = "validator_candidate_filtered";
}

// Cap at 4
const cappedCandidates = validCandidates.slice(0, 4);
if (cappedCandidates.length < validCandidates.length) {
  routing_action = "show_candidates";
}

// Check 3: low confidence + show_product → downgrade
if (confidence === "low" && routing_action === "show_product") {
  routing_action = cappedCandidates.length > 0 ? "show_candidates" : "ask_clarification";
  if (resolution_status === "direct" || resolution_status === "ai_exact") {
    resolution_status = "ai_downgraded";
  }
}

// Check 4: out of stock flag
if (matched_product_id && inventoryMap[matched_product_id]?.inStock === false) {
  out_of_stock = true;
  // Do NOT null out matched_product_id — Call 2 handles messaging
}

// Set final resolution_status if not yet set by error checks
if (resolution_status === "direct") {
  const intakeActions = [
    "start_sell_intake","continue_sell_intake","sell_intake_complete",
    "start_exchange_intake","continue_exchange_intake","exchange_intake_complete",
  ];
  if (intakeActions.includes(routing_action)) {
    resolution_status = "intake_active";
  } else if (matched_product_id && confidence === "high") {
    resolution_status = "ai_exact";
  } else if (cappedCandidates.length > 0) {
    resolution_status = "ai_candidates";
  } else if (routing_action === "no_match") {
    resolution_status = "no_match";
  } else {
    resolution_status = "direct";
  }
}

return {
  json: {
    ...call1,
    matched_product_id,
    candidate_ids: cappedCandidates,
    routing_action,
    resolution_status,
    out_of_stock,
    _validator_removed_ids: removedIds,
  }
};
```

**Test cases for Node [9]:**
- Input: `matched_product_id: "fake_id_xyz"` → output: `matched_product_id: null`, `resolution_status: "validator_rejected"`
- Input: `candidate_ids: ["a","b","c","d","e"]` (5 IDs, only first 4 valid) → output: `candidate_ids` capped at 4, `resolution_status: "validator_candidate_filtered"`
- Input: `confidence: "low"`, `routing_action: "show_product"` → output: `routing_action: "ask_clarification"` (if no candidates), `resolution_status: "ai_downgraded"`
- Input: valid matched_product_id for an `inStock: false` product → output: `matched_product_id` unchanged, `out_of_stock: true`

---

#### Task D2: Build Node [10] — Routing Switch

Delete `Needs Database IF` and `Evaluate Match Quality`. Add a Switch node:

- [ ] Add Switch node with routing on `{{ $json.routing_action }}`:
  - `show_product` → path to Node [11] (Fetch Full Product) → Node [14]
  - `show_candidates` → path directly to Node [14] — Node [11] is BYPASSED. Candidate data is read from inventorySnapshot in Node [14].
  - `ask_clarification` → path to Node [14]
  - `start_sell_intake` → path to Node [12] (Intake State Manager)
  - `continue_sell_intake` → path to Node [12]
  - `sell_intake_complete` → path to Node [13] (Intake Complete Writer)
  - `start_exchange_intake` → path to Node [12]
  - `continue_exchange_intake` → path to Node [12]
  - `exchange_intake_complete` → path to Node [13]
  - `discovery` → path to Node [14]
  - `greeting` → path to Node [14]
  - `direct_answer` → path to Node [14]
  - `no_match` → path to Node [14]
  - fallback → path to Node [14] with `routing_action: "ask_clarification"`

**Acceptance criteria:** After Phase D, the V2 workflow test-executes from Telegram trigger to Routing Switch without errors for message "iPhone 13 128GB". Validator confirms `matched_product_id` is real (or null if no iPhone products exist). `resolution_status` is set correctly.

---

### Phase E — Intake State Manager (Node [12])

**Goal:** Build the node that reads and writes intake state for sell and exchange flows that are in progress (not yet complete).

**Files/nodes touched:** n8n V2 workflow only — node [12]. Calls Convex `threads:updateIntakeState` (built in Phase A). No V1 changes.

**Rollback safety:** V2 webhook disabled. V1 unaffected. If `updateIntakeState` fails, the intake state is simply not persisted and Call 1 will re-detect intake intent on the next message.

---

#### Task E1: Build Node [12] — Intake State Manager

This node fires on `start_*` and `continue_*` routing actions. It reads current intake state, merges new data from Call 1's `intake_data`, writes back to Convex, and passes updated intake state downstream.

- [ ] Add HTTP Request node (POST to Convex `threads:updateIntakeState`):

```json
{
  "path": "threads:updateIntakeState",
  "args": {
    "chatId": "{{ $('Normalize Input').item.json.chatId }}",
    "flow": "{{ $json.routing_action.includes('sell') ? 'sell' : 'exchange' }}",
    "status": "{{ $json.routing_action.includes('start') ? 'start' : 'in_progress' }}",
    "data": "{{ $json.intake_data ?? {} }}",
    "write_key": "{{ $('Normalize Input').item.json.messageId + ':' + ($json.routing_action.includes('sell') ? 'sell' : 'exchange') }}"
  }
}
```

- [ ] After the write, pass through all current data plus updated `intake_state` to Node [14]

**Acceptance criteria:** After "I want to sell my phone", intake state is written to Convex `threads` with `flow: "sell"`, `status: "start"`, `data: {}`. On second message providing phone model, state updates to `status: "in_progress"`, `data: {offered_model: "..."}`. Idempotent — sending same message_id twice does not double-write.

---

### Phase F — Intake Complete Writers (Node [13])

**Goal:** Build the node that writes the final admin-facing Convex records when intake is complete, then clears the intake state.

**Files/nodes touched:** n8n V2 workflow only — node [13]. Calls Convex `hotLeads:createBotHotLead` and `exchanges:createBotExchange` (both built in Phase A). No V1 changes.

**Rollback safety:** V2 webhook disabled. V1 unaffected. The `writeKey` dedup guard ensures no duplicate Convex records are created if a completion step is retried.

---

#### Task F1: Build Node [13] — Intake Complete Writer

This fires on `sell_intake_complete` and `exchange_intake_complete`.

- [ ] Add an IF node that branches on `routing_action`:
  - `sell_intake_complete` → call `hotLeads:createBotHotLead`
  - `exchange_intake_complete` → call `exchanges:createBotExchange`

**Sell complete path — HTTP Request to Convex:**

```json
{
  "path": "hotLeads:createBotHotLead",
  "args": {
    "chatId": "{{ $('Normalize Input').item.json.chatId }}",
    "telegramUserId": "{{ $('Normalize Input').item.json.userId }}",
    "firstName": "{{ $('Normalize Input').item.json.firstName }}",
    "intakeSummary": "{{ $json.intake_data?.offered_model ?? 'unspecified'}}",
    "offeredModel": "{{ $json.intake_data?.offered_model }}",
    "askingPrice": "{{ $json.intake_data?.asking_price }}",
    "customerNotes": "{{ $json.intake_data?.customer_notes }}",
    "sellerId": "{{ $env.TEDYTECH_SELLER_ID }}",
    "writeKey": "{{ $('Normalize Input').item.json.messageId + ':sell' }}"
  }
}
```

**Exchange complete path — HTTP Request to Convex:**

```json
{
  "path": "exchanges:createBotExchange",
  "args": {
    "chatId": "{{ $('Normalize Input').item.json.chatId }}",
    "telegramUserId": "{{ $('Normalize Input').item.json.userId }}",
    "firstName": "{{ $('Normalize Input').item.json.firstName }}",
    "offeredDevice": "{{ ($json.intake_data?.offered_model ?? 'Unknown') + ' — Condition: ' + ($json.intake_data?.offered_condition ?? 'unspecified') }}",
    "requestedDevice": "{{ $json.intake_data?.desired_product_name }}",
    "customerNotes": "{{ $json.intake_data?.customer_notes }}",
    "sellerId": "{{ $env.TEDYTECH_SELLER_ID }}",
    "writeKey": "{{ $('Normalize Input').item.json.messageId + ':exchange' }}"
  }
}
```

- [ ] After writing, call Convex `threads:clearIntakeState` to remove intake from thread
- [ ] Pass all current data to Node [14]

**Acceptance criteria:** A completed sell intake (model + condition provided) creates a `hotLeads` record with `status: "new"` and `source: "bot"`. A completed exchange intake creates an `exchanges` record with `status: "pending"`. In both cases, `threads.intake` is null after completion. No records created on `start_*` or `continue_*` actions.

---

### Phase G — Call 2 Response Shaping (Nodes [11], [14], [15], [16], [17])

**Goal:** Build the full product detail fetch, the path-specific final prompt assembler, and the updated Call 2 response node. Call 2 must stay grounded in verified inventory — no hallucinated prices, availability, specs, or images.

**Files/nodes touched:** n8n V2 workflow only — nodes [11], [14], [15], [16], [17]. May add `getProduct` query to `convex/products.ts` (additive only). No V1 changes.

**Rollback safety:** V2 webhook disabled. V1 unaffected.

---

#### Task G1: Build Node [11] — Fetch Full Product Details (show_product path only)

**This node fires only on the `show_product` path.** For `show_candidates`, Node [11] is bypassed — the routing switch sends `show_candidates` directly to Node [14], which reads candidate data from the compact `inventorySnapshot` already present in the validated Call 1 output. Full product details are only needed when a single product has been confidently matched.

- [ ] Wire Node [11] to receive from routing switch `show_product` path only
- [ ] For `show_product`: HTTP Request to Convex `products:getProduct` (add query if it doesn't exist — see below)
- [ ] Pass `matched_product_full` to Node [14]

**Note:** If no dedicated `getProduct` query exists in `products.ts`, add:

```ts
export const getProduct = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.productId);
  },
});
```

Deploy and verify before wiring Node [11].

**Note:** If no dedicated `getProduct` query exists in `products.ts`, add:

```ts
export const getProduct = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.productId);
  },
});
```

---

#### Task G2: Redesign Node [14] — Assemble Final Prompt

Replace the monolithic `Assemble Final Prompt` node with a path-aware Code node:

- [ ] The node selects a Call 2 mode based on `routing_action` and assembles path-specific context:

```js
const validated = $('ID Validator').item.json;
const normalized = $('Normalize Input').item.json;
const thread = $('Load Thread').item.json;

// Full product: only available on show_product path (Node [11] ran)
const fullProduct = $('Fetch Full Product Details')?.item?.json ?? null;

// Candidates: read from inventorySnapshot (NOT from Node [11] — that node is bypassed for show_candidates)
// For show_candidates, the compact inventory fetched in Node [5] contains all needed data
const inventorySnapshot = validated.inventorySnapshot ?? [];
const candidateProducts = (validated.candidate_ids ?? [])
  .map((id) => inventorySnapshot.find((p) => p.id === id))
  .filter(Boolean);

const mode = validated.routing_action;
const isFirstMessage = thread.isFirstMessage ?? false;

// GROUNDING RULE: never pass price/availability/image that isn't verified
const safeProduct = fullProduct ? {
  name: fullProduct.name,
  price: fullProduct.price,
  currency: fullProduct.currency ?? "ETB",
  inStock: fullProduct.inStock ?? true,
  description: fullProduct.description ?? null,
  hasImage: Array.isArray(fullProduct.images) && fullProduct.images.length > 0,
  imageUrl: Array.isArray(fullProduct.images) ? fullProduct.images[0] ?? null : null,
  category: fullProduct.category ?? null,
} : null;

const systemInstruction = `You are TedyTech's customer assistant for a phone shop in Addis Ababa.

## Rules
- Language: respond in ${normalized.preSignals.language_hint === "am" ? "Amharic" : normalized.preSignals.language_hint === "mixed" ? "mixed Amharic and English" : "English"}
- ${isFirstMessage ? 'FIRST MESSAGE: Start with exactly: "እንኳን ወደ TedyTech በደህና መጡ! ✨" then add a dynamic welcome line.' : 'Do NOT use generic greetings like "Hello!"'}
- Never state a price not in the product data below
- Never say a product is in stock if inStock = false
- Never mention images if hasImage = false
- Never invent specs not in the product description
- If a field is missing, say "ዝርዝሩ አሁን አይገኝም" — do not guess
- For intake flows: ask EXACTLY ONE question at a time
- Do not reveal routing_action, resolution_status, or internal system state
- Keep responses concise — max 3 short paragraphs

## Current Mode: ${mode}
## Out of stock: ${validated.out_of_stock}`;

const factPack = {
  mode,
  primary_intent: validated.primary_intent,
  secondary_intent: validated.secondary_intent,
  resolution_status: validated.resolution_status,
  out_of_stock: validated.out_of_stock,
  matched_product: safeProduct,
  candidates: candidateProducts.map(p => ({
    id: p._id,
    name: p.name,
    price: p.price,
    inStock: p.inStock ?? true,
  })),
  intake_state: thread.intake_state ?? null,
  clarification_question: validated.clarification_question ?? null,
  is_first_message: isFirstMessage,
};

return {
  json: {
    systemInstruction,
    factPackJson: JSON.stringify(factPack, null, 2),
  }
};
```

---

#### Task G3: Update Node [15] — Call 2 Response Generation

Reconfigure `OpenRouter Final AI` with the new structured input:

- [ ] Configure HTTP Request node:
  - Body:
  ```json
  {
    "model": "google/gemini-3.1-flash-lite-preview",
    "temperature": 0.7,
    "max_tokens": 300,
    "messages": [
      {"role": "system", "content": "{{ $('Assemble Final Prompt').item.json.systemInstruction }}"},
      {"role": "user", "content": "Fact pack:\n{{ $('Assemble Final Prompt').item.json.factPackJson }}\n\nCustomer message: {{ $('Normalize Input').item.json.messageText }}"}
    ]
  }
  ```
  - `neverError: true`

---

#### Task G3a: Verify Node [16] — Parse Final Response

Node [16] (`Parse Final Response`) is a KEEP node from V1 but must produce a `reply` field that Node [17] reads via `$('Parse Final Response').item.json.reply`. Verify the V1 node already outputs this field name, or update it.

- [ ] Open Node [16] in the V2 workflow
- [ ] Confirm it outputs `reply` (the final text string). If the V1 node outputs a different field name (e.g., `text`, `message`, `content`), update the field name here AND update the reference in Task G4's save mutation
- [ ] Test by running V2 with a test message — confirm `Parse Final Response` output contains a `reply` string field

**Note:** If V1 uses a different field name, update the `updateThread` call in G4 to use that name instead of `reply`.

---

#### Task G4: Update Node [17] — Save Conversation Memory

Replace the old `Save Conversation Memory` node:

- [ ] HTTP Request to Convex `threads:updateThread`:

```json
{
  "path": "threads:updateThread",
  "args": {
    "chatId": "{{ $('Normalize Input').item.json.chatId }}",
    "userMessage": "{{ $('Normalize Input').item.json.messageText }}",
    "assistantMessage": "{{ $('Parse Final Response').item.json.reply }}",
    "timestamp": "{{ Date.now() }}"
  }
}
```

**Acceptance criteria (Phase G):** End-to-end test execution on V2 with "Samsung S24 price" produces a response that includes the real Samsung Galaxy S24 price from Convex inventory (or says "ዝርዝሩ አሁን አይገኝም" if no product exists). No invented prices. Response saved to `threads.recentMessages`. Call 2 stays under 300 tokens.

---

### Phase H — Test Bot QA

**Goal:** Connect V2 to a dedicated test Telegram bot. Execute the full scenario matrix before any production switch.

---

#### Task H1: Test bot setup

- [ ] Create a second Telegram bot via @BotFather — name it `@TedyTechV2TestBot`
- [ ] Store the test bot token in n8n as `TEST_BOT_TOKEN`
- [ ] Set V2 workflow webhook to test bot token
- [ ] Confirm V2 webhook is active on test bot, V1 webhook still active on production bot

---

#### Task H2: Execute full scenario matrix

Run each scenario manually in Telegram with the test bot. Record actual response for each. All tests marked ✓ required before Phase I.

**Buy Phone scenarios:**

- [ ] `"Samsung S24 price"` → Expected: Shows Samsung Galaxy S24 price from real inventory (or honest no-match if not stocked). `resolution_status: "ai_exact"` or `"no_match"`.
- [ ] `"S24"` (shorthand only) → Expected: Identifies Samsung Galaxy S24. Does not ask "what do you mean?".
- [ ] `"Samsung A55"` → Expected: Finds Samsung Galaxy A55 if in stock.
- [ ] `"iPhone 13 128GB"` → Expected: Finds iPhone 13 with 128GB storage (or asks which storage if multiple).
- [ ] `"13 Pro"` (no brand) → Expected: Correctly identifies iPhone 13 Pro. Does not confuse with Samsung Galaxy or other brand.
- [ ] `"Camon 20"` → Expected: Identifies Tecno Camon 20.
- [ ] `"S24 photo"` → Expected: `secondary_intent: "ask_photo"`. If `hasImage = true`, offers to show. If false, says image not available.
- [ ] `"I want a phone"` (vague) → Expected: `routing_action: "discovery"`. Shows featured products. Does not ask "which brand?".
- [ ] `"new Samsung"` → Expected: Tier 1 fetch of Samsung products. Shows new arrivals.

**Sell scenarios (multi-turn):**

- [ ] Turn 1: `"I want to sell my phone"` → Expected: `routing_action: "start_sell_intake"`. Bot asks what model.
- [ ] Turn 2: `"iPhone 12 64GB"` → Expected: `routing_action: "continue_sell_intake"`. Bot asks condition.
- [ ] Turn 3: `"Good condition"` → Expected: `routing_action: "continue_sell_intake"` or `"sell_intake_complete"`. Bot may ask asking price or confirm.
- [ ] On completion: Check Convex `hotLeads` table — confirm new record exists with `source: "bot"`, `status: "new"`, model info. Confirm `threads.intake` is null after completion.

**Exchange scenarios (multi-turn):**

- [ ] Turn 1: `"I want exchange"` → Expected: `routing_action: "start_exchange_intake"`. Bot asks what phone they have.
- [ ] Turn 2: `"Samsung S21 256GB good condition"` → Expected: `routing_action: "continue_exchange_intake"`. Bot asks what they want in return (or confirms if desired already mentioned).
- [ ] On completion: Check Convex `exchanges` table — confirm new record with `status: "pending"`, `offeredDevice` populated. Confirm `threads.intake` is null.

**FAQ scenarios:**

- [ ] `"Where are you located?"` → Expected: `primary_intent: "faq"`, `secondary_intent: "ask_location"`. No product fetch. Responds with location info.
- [ ] `"Do you accept installment?"` → Expected: `primary_intent: "faq"`, `secondary_intent: "ask_payment"`. Responds with payment info.

**Follow-up scenarios:**

- [ ] After seeing S24: `"How much is it?"` → Expected: `is_followup: true`. Answers with S24 price without re-asking which phone.
- [ ] After seeing S24 and S24+: `"The cheaper one"` → Expected: `followup_resolves_to` resolves to S24. Shows S24 details.
- [ ] After sell intake started: user sends unrelated `"What is your address?"` → Expected: Handles as FAQ but preserves intake state (intake is not cleared).

**No-match scenarios:**

- [ ] `"Oppo Reno 10"` → Expected: `routing_action: "no_match"`. Honest response that this model isn't currently available. Offers alternatives from featured products.
- [ ] `"Galaxy Z Fold 5"` → Expected: `routing_action: "no_match"`. Does not hallucinate availability.

**ID Validator scenario:**

- [ ] Temporarily hardcode a fake ID in the Call 1 output mock → confirm validator sets `resolution_status: "validator_rejected"`, nulls out ID, does not crash.

**Amharic language scenarios:**

- [ ] `"ሳምሱንግ S24 ዋጋ ምን ያህል ነው"` → Expected: `language_hint: "am"`, response in Amharic, product identified as Samsung S24.
- [ ] `"ስልክ መሸጥ እፈልጋለሁ"` (I want to sell a phone in Amharic) → Expected: `primary_intent: "sell_phone"`, `routing_action: "start_sell_intake"`.
- [ ] Mixed: `"S24 price ስንት ነው"` → Expected: `language_hint: "mixed"`, response in mixed Amharic/English.

**First message scenario:**

- [ ] Start a conversation as a new user → Expected: Response begins with exact text `"እንኳን ወደ TedyTech በደህና መጡ! ✨"`. `isFirstMessage = true` in thread.

---

#### Task H3: Phase H acceptance gate

- [ ] All 25+ test scenarios above have been run and logged
- [ ] Zero `validator_rejected` hits on real product IDs (only on injected fakes)
- [ ] Zero hallucinated prices or availability claims in Call 2 responses
- [ ] All sell/exchange intake completions write to Convex and clear intake state
- [ ] Thread memory persists across sessions (restart n8n, send message — history is preserved)
- [ ] Error fallback fires correctly when OpenRouter returns a non-200 response (test by temporarily using wrong API key)
- [ ] n8n execution logs show no unhandled errors across all scenarios

---

### Phase I — Production Cutover

**Goal:** Atomically switch the production Telegram bot from V1 to V2. One action. Reversible in under 60 seconds.

---

#### Task I1: Pre-cutover checklist

- [ ] All Phase H test cases pass
- [ ] V2 workflow active status: enabled (but webhook still pointing to test bot)
- [ ] V1 webhook: active on production bot
- [ ] n8n has `TEDYTECH_SELLER_ID` set correctly
- [ ] Confirm Convex is healthy (dashboard shows no errors)
- [ ] Confirm you are available to monitor for at least 2 hours post-cutover
- [ ] Identify rollback trigger threshold (e.g., > 3 error executions in 10 minutes)

---

#### Task I2: Atomic webhook switch

These two steps must be done back-to-back with no delay:

- [ ] **Step 1:** In V2 workflow — update the webhook URL to use production bot token (replace test bot token with `$env.TELEGRAM_BOT_TOKEN`)
- [ ] **Step 2:** In V1 workflow — deactivate webhook (toggle workflow to inactive OR remove webhook URL)

**V1 stays preserved:** Do NOT delete V1. Archive it. It must be reactivatable in under 60 seconds.

---

#### Task I3: Post-cutover smoke test

- [ ] Send `"Samsung S24"` to the production bot → confirm response uses V2 AI-brain flow
- [ ] Send `"Hello"` → confirm greeting mode
- [ ] Send `"I want to sell"` → confirm sell intake starts
- [ ] Check n8n V2 execution history — confirm first 3–5 executions succeeded
- [ ] Check Convex `threads` table — confirm thread records are being created/updated

---

### Phase J — Monitoring and Rollback

**Goal:** Monitor V2 for 48 hours post-launch. Define the exact rollback procedure.

---

#### Task J1: 48-hour monitoring

**Metrics to watch:**

| Metric | Where | Alert threshold |
|---|---|---|
| Execution errors | n8n execution history | > 3 errors / 10 min |
| Call 1 parse failures | n8n logs (Parse Call 1 Output node) | > 5% of executions |
| `validator_rejected` hits | n8n logs (ID Validator node) | Any hit on real product IDs |
| Intake completions | Convex `hotLeads` + `exchanges` tables | Should only appear on full intake |
| Thread memory growth | Convex `threads` table | Row count should grow with new users |
| Fallback activations | n8n Error Fallback node | Any activation worth investigating |

- [ ] Monitor for 24 hours actively
- [ ] Review execution logs at 24h and 48h marks
- [ ] After 48h stable: V1 workflow can be archived permanently

---

#### Task J2: Rollback procedure (if needed)

If V2 is producing errors or bad responses:

1. [ ] In V1 workflow: toggle to active, re-enable webhook with production bot token
2. [ ] In V2 workflow: disable webhook immediately
3. [ ] Total time: under 60 seconds
4. [ ] Convex data created by V2 (thread records, hotLeads, exchanges) remains — does not need reverting
5. [ ] After rollback: investigate n8n execution logs, identify failing node, fix before re-attempting V2

---

## 4. End-to-End Validation Matrix

### Buy Phone

| Input | Expected primary_intent | Expected secondary_intent | Expected routing_action | Expected resolution_status |
|---|---|---|---|---|
| `Samsung S24 price` | buy_phone | ask_price | show_product | ai_exact |
| `S24` | buy_phone | null | show_product or show_candidates | ai_exact or ai_candidates |
| `Samsung A55` | buy_phone | null | show_product | ai_exact |
| `iPhone 13 128GB` | buy_phone | null | show_product or ask_clarification | ai_exact or ai_downgraded |
| `13 Pro` | buy_phone | null | show_product or show_candidates | ai_exact or ai_candidates |
| `Camon 20` | buy_phone | null | show_product | ai_exact |
| `new iphone` | buy_phone | null | show_candidates | ai_candidates |
| `I want a phone` | buy_phone | ask_recommendation | discovery | direct |
| `S24 photo` | buy_phone | ask_photo | show_product | ai_exact |
| `ስልክ ዋጋ ምን ያህል ነው` | buy_phone | ask_price | discovery or ask_clarification | direct |

### Sell Phone

| Input | Expected routing_action | Convex write |
|---|---|---|
| `I want to sell my phone` (Turn 1) | start_sell_intake | None |
| `iPhone 12 64GB` (Turn 2) | continue_sell_intake | None |
| `Good condition` (Turn 3) | continue_sell_intake or sell_intake_complete | None or hotLeads (on complete) |
| Final confirmation (Turn 3+) | sell_intake_complete | hotLeads record created |

### Exchange Phone

| Input | Expected routing_action | Convex write |
|---|---|---|
| `I want exchange` (Turn 1) | start_exchange_intake | None |
| `Samsung S21 256GB good` (Turn 2) | continue_exchange_intake | None |
| `I want iPhone 14` (Turn 3) | exchange_intake_complete | exchanges record created |

### FAQ

| Input | Expected primary_intent | Expected secondary_intent |
|---|---|---|
| `Where are you located?` | faq | ask_location |
| `Do you accept installment?` | faq | ask_payment |
| `What are your hours?` | faq | null |

### Follow-up

| Context | Input | Expected behavior |
|---|---|---|
| After seeing S24 | `How much?` | is_followup: true, answers S24 price |
| After seeing 2 Samsung phones | `The cheaper one` | followup_resolves_to = cheaper Samsung ID |
| Intake in progress | Unrelated FAQ | Handles FAQ, intake state preserved |

### No-match

| Input | Expected routing_action | Expected resolution_status |
|---|---|---|
| `Oppo Reno 10` | no_match | no_match |
| `Galaxy Z Fold 5` | no_match | no_match |
| `Nokia 3310` | no_match | no_match |

---

## 5. Production Cutover Plan

```
PRE-CUTOVER:
1. Confirm V2 test bot passes all Phase H scenarios
2. Confirm all Convex mutations are deployed (check dashboard)
3. Confirm TEDYTECH_SELLER_ID env var is set in n8n
4. Take note of current V1 execution count as baseline

CUTOVER (perform back-to-back, <2 min total):
1. n8n → V2 workflow → webhook node → update token to production bot token
2. n8n → V2 workflow → toggle to ACTIVE
3. n8n → V1 workflow → toggle to INACTIVE
4. Send test message "Hello" to production bot → confirm V2 responds

POST-CUTOVER (first 10 minutes):
5. Watch n8n V2 execution history — confirm successful executions
6. Confirm Convex threads table growing
7. If any error: immediately toggle V1 back to ACTIVE, V2 to INACTIVE
```

---

## 6. Rollback Plan

```
TRIGGER: > 3 execution errors in 10 minutes, OR any hallucinated product/price claim observed

ROLLBACK STEPS (target: under 60 seconds):
1. n8n → V1 workflow → toggle to ACTIVE
   (V1 still has its Telegram webhook config — just re-enable the workflow)
2. n8n → V2 workflow → toggle to INACTIVE
3. Send "Samsung S24" to production bot → confirm V1 responds
   (V1 response uses old JS fuzzy match logic — acceptable for rollback)
4. Investigate V2 execution logs to identify failing node
5. Fix the issue in V2, re-test on test bot, then re-attempt cutover

WHAT TO PRESERVE AFTER ROLLBACK:
- Convex thread records created by V2 — keep (don't delete)
- Convex hotLeads created by completed V2 intakes — keep
- Convex exchanges created by completed V2 intakes — keep
- V2 workflow — keep archived for fixing
```

---

## 7. Open Questions

### OQ-1 — Non-blocking: Admin Sender Check

The spec includes `is_admin_sender` as a pre-signal but does not define how to fetch seller IDs for comparison. Currently Node [2] hardcodes `isAdminSender: false`.

**Recommendation:** For V2, leave this as a placeholder. Admin routing is a separate feature (listed as "future consideration" in the spec). Do not implement seller ID lookup until the admin bot path is designed.

### OQ-2 — Non-blocking: Seller ID for Bot Mutations

`createBotHotLead` and `createBotExchange` require a `sellerId` from the `sellers` table. This must be stored as `TEDYTECH_SELLER_ID` in n8n environment variables.

**Action required before Phase F:** Retrieve the correct `sellerId` from the Convex dashboard → `sellers` table → identify the active TedyTech seller → copy the `_id` value → set as n8n env var.

### OQ-3 — Non-blocking: Amharic intake data

Call 1 may return `intake_data.offered_model` in Amharic. The `hotLeads.interestSummary` and `exchanges.offeredDevice` fields will store whatever Call 1 extracted. This is acceptable — admin will read it in context. No normalization needed for V2.

### OQ-4 — Non-blocking: getProduct query

Phase G requires fetching full product details by ID. Check if `getProduct` query exists in `products.ts`. If not, add it as specified in Task G1. This is a single-line query and does not affect any existing functionality.

---

## 8. Recommended First Implementation Task

**Start with Task A1 + A2 (schema and helpers).**

These are the safest first steps: purely additive Convex changes with zero risk to V1. The `threads` table and `productHelpers.ts` are required by every subsequent phase. Once these are confirmed deployed and working in the Convex dashboard, proceed to Task A3 (compact queries) and test them against the live production data before touching n8n at all.

Do not touch n8n until all Phase A tasks pass their acceptance criteria.
