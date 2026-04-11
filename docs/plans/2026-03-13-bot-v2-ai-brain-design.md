# TedyTech Bot V2 — AI Brain Architecture Design

**Date:** 2026-03-13
**Status:** APPROVED FOR IMPLEMENTATION
**Scope:** n8n workflow redesign — AI-first product matching, multi-step sell/exchange intake, scalable inventory strategy
**Production bot:** Live (V1 stays active until atomic webhook switch)
**Convex backend:** `https://fastidious-schnauzer-265.convex.cloud`

---

## 1. Problem Statement

The current V1 bot (22 nodes, `ip8TLyBJ5a7D7Tbx_workflow.json`) has a structurally buy-centric pipeline. While sell and exchange intents are detected, they fall into the same generic response generation path as buy — no multi-step intake, no structured Convex writes, no progression state.

The deeper problem is that the **product matching decision is made by a deterministic JS fuzzy-match engine** (`Evaluate_Match_Quality.js`), not by the AI. The AI in Call 1 extracts entities blindly — with no inventory context — and the JS node makes the final product decision using substring and regex matching. This breaks on shorthand product names ("S24", "Camon 20", "13 Pro", "A55"), partial wording, and anything requiring semantic brand or model family understanding.

### Current Weaknesses

| Weakness | Root Cause |
|---|---|
| Shorthand product names fail to match | JS fuzzy match is string-based; "S24" is not a substring of "Samsung Galaxy S24" |
| Sell/exchange detected but not actioned | No dedicated intake path; routes to generic response generation |
| Sell/exchange creates no structured Convex record | No mutations wired for these flows in V1 |
| AI and matching are disconnected | Call 1 has no inventory context; it extracts entities that JS then tries to match |
| Full catalog fetched after intent, too late for AI | Products fetched post-intent; AI cannot use them for matching |
| Full catalog fetched on every message | No pre-filtering; does not scale as inventory grows |
| Architecture is buy-centric | Even though 11 intents are classified, the pipeline handles only buy-path efficiently |

---

## 2. V2 Design Principles

```
AI   = brain (understands customer meaning, resolves shorthand, drives routing)
Convex = truth (inventory, intake state, leads, exchanges — all grounded here)
n8n  = orchestration (execution, deterministic routing, pre-signals, writes)
```

- AI is never the final authority on product IDs — a deterministic validator enforces this
- Inventory is passed to the AI before matching, not after
- Sell and exchange are multi-step intake flows with explicit state machines
- No admin-facing Convex record is written until an intake flow reaches a completion-ready state
- JS helpers remain as pre-processing signals — inputs to the AI, not decisions

---

## 3. V2 Node Architecture

### Full Node Layout (19 nodes)

```
STAGE 1 — INPUT
[1]  Telegram Trigger
[2]  Normalize Input + JS Pre-signals      ENHANCED
[3]  Check Empty IF                        KEEP

STAGE 2 — CONTEXT LOAD
[4]  Load Conversation Memory + Intake     MOVED EARLIER
[5]  Fetch Inventory (tiered)              REDESIGNED

STAGE 3 — AI BRAIN
[6]  Build Call 1 Prompt                  REDESIGNED
[7]  OpenRouter: Call 1 AI Brain          REDESIGNED
[8]  Parse Call 1 Output                  REDESIGNED
[9]  ID Validator                         NEW

STAGE 4 — ROUTING
[10] Routing Switch                        REDESIGNED

STAGE 5 — PATH EXECUTION (conditional)
[11] Fetch Full Product Details            CONDITIONAL — show_product path
[12] Intake State Manager                  CONDITIONAL — sell/exchange in-progress
[13] Intake Complete Writer                CONDITIONAL — completion states only

STAGE 6 — RESPONSE
[14] Assemble Final Prompt                 REDESIGNED
[15] OpenRouter: Call 2 Response           KEEP structure, update prompt
[16] Parse Final Response                  KEEP

STAGE 7 — OUTPUT
[17] Save Conversation Memory + Intake     KEEP
[18] Send Telegram Reply                   KEEP
[19] Error Fallback                        KEEP
```

### Nodes Removed from V1

| Removed Node | Reason |
|---|---|
| `Needs Database IF` | Catalog is always pre-fetched in node [5]; routing is now on `routing_action` |
| `Build Convex Query` | Replaced by tiered inventory fetch in node [5] |
| `Convex Data Lookup` | Replaced by conditional `Fetch Full Product Details` node [11] |
| `Evaluate Match Quality` | Fully replaced by Call 1 AI matching + ID Validator |

---

## 4. JS Pre-signals (Node [2])

Node [2] is enhanced to produce lightweight deterministic signals. These are **inputs to Call 1** — not decisions. Call 1 may use, ignore, or override any of them.

| Signal | Source | Shape | Purpose |
|---|---|---|---|
| `language_hint` | Unicode range check (`\u1200-\u137F`) | `"am"` / `"en"` / `"mixed"` | Guides Call 1 on response language |
| `media_hint` | Telegram update fields | `{ has_photo, has_voice, has_document }` | Infers photo/voice intent without empty text |
| `storage_hint` | Loose regex `/\b(64|128|256|512|1tb)\s?gb?\b/i` | `"256GB"` or `null` | Passed to tiered fetch and Call 1 as candidate filter |
| `brand_hint` | Loose regex over known brand list | `"samsung"` / `"apple"` / `null` | Drives Tier 1 inventory fetch |
| `admin_hint` | Compare `telegram_user_id` against cached seller IDs | `{ is_admin_sender: bool }` | Deterministic admin routing gate |
| `message_length_hint` | Word count | `"short"` / `"medium"` / `"long"` | Helps Call 1 handle low-context messages conservatively |

Pre-signals are assembled as a `pre_signals` object and injected into the Call 1 prompt. They are also available to node [5] for tiered inventory fetch selection.

---

## 5. Tiered Inventory Fetch (Node [5])

The bot never blindly passes all inventory to Call 1. Node [5] selects a fetch tier based on pre-signals from node [2].

### Tier Selection Logic

```
IF brand_hint is set AND brand_hint is a known brand:
  → Tier 1: listCompactProductsByBrand(brand_hint)
  → Expected result size: 5–20 products

ELSE IF primary message signals are vague (no brand, discovery-style, recommendation):
  → Tier 2: listCompactFeaturedProducts(limit: 25)
  → Selection rule (deterministic, see below)

ELSE IF Tier 1 returns 0 results (brand_hint set but no products):
  → Tier 3: listAllCompactProducts()

ELSE IF chat_history (already loaded by node [4]) contains references to two or more
         distinct brands, or no brand_hint and no vague discovery signal is present:
  → Tier 3: listAllCompactProducts()
  Note: node [5] reads chat_history directly from the node [4] output.
        No additional pre-signal from node [2] is needed for this branch.
```

### Tier 2 Selection Rule (deterministic)

Products are sorted and selected in this exact priority order:

```
1. isNewArrival = true    (sort by _creationTime DESC within this group)
2. isFeatured = true      (sort by _creationTime DESC within this group)
3. isPopular = true       (sort by _creationTime DESC within this group)
4. Remaining active products, sorted by price DESC
```

Limit: 25 products total. If fewer than 10 products qualify under rules 1–3, supplement with rule 4 up to 25. `inStock = false` products are included in the list but flagged — Call 1 should consider them as out-of-stock candidates only.

### Compact Product Shape (all tiers)

```ts
{
  id: string,           // Convex document ID
  name: string,         // Full product name e.g. "Samsung Galaxy S24 5G"
  brand: string,        // e.g. "Samsung"
  price: number,        // in ETB
  storage: string,      // e.g. "256GB"
  inStock: boolean,
  hasImage: boolean
}
```

No description, tags, image URLs, or admin-only fields are included. Those load only in node [11] for a confirmed match.

### Required Convex Queries

Three new public queries to add to `convex/products.ts`:

```ts
listCompactProductsByBrand(brand: string): CompactProduct[]
listCompactFeaturedProducts(limit: number): CompactProduct[]
listAllCompactProducts(): CompactProduct[]
```

All three return the same `CompactProduct` shape above.

---

## 6. Call 1 — AI Brain

### Role

Call 1 is the single AI decision point for:
- Understanding the customer's real meaning, including shorthand and partial wording
- Matching their request to real products from the provided inventory
- Classifying primary and secondary business intent
- Deciding the exact routing action
- Detecting and progressing sell/exchange intake flows
- Deciding whether the bot should ask a clarification question or proceed

### Model

`google/gemini-3.1-flash-lite-preview` via OpenRouter
Temperature: `0.1` (strict, structured output)
Max tokens: `300`
Output format: JSON only

### Input Shape

```json
{
  "system_prompt": "You are TedyTech's AI product matching brain...",
  "user_message": "S24 how much",
  "pre_signals": {
    "language_hint": "en",
    "media_hint": { "has_photo": false, "has_voice": false, "has_document": false },
    "storage_hint": null,
    "brand_hint": "samsung",
    "message_length_hint": "short"
  },
  "chat_history": ["...last 5 turns as [{role, content}]..."],
  "intake_state": null,
  "inventory": [
    { "id": "abc123", "name": "Samsung Galaxy S24", "brand": "Samsung",
      "price": 85000, "storage": "256GB", "inStock": true, "hasImage": true },
    { "id": "def456", "name": "Samsung Galaxy S24+", "brand": "Samsung",
      "price": 97000, "storage": "512GB", "inStock": false, "hasImage": true }
  ]
}
```

When `intake_state` is non-null, the inventory array may be omitted or minimal — intake flows do not require product matching.

### Output Schema

```json
{
  "primary_intent": "buy_phone",
  "secondary_intent": "ask_price",
  "routing_action": "show_product",
  "matched_product_id": "abc123",
  "candidate_ids": ["abc123", "def456"],
  "match_reason": "User typed 'S24' — maps to Samsung Galaxy S24 by brand+model shorthand. S24+ included as candidate due to similar model family.",
  "confidence": "high",
  "needs_clarification": false,
  "clarification_question": null,
  "entities": { "brand": "Samsung", "model": "Galaxy S24", "storage": null },
  "is_followup": false,
  "followup_resolves_to": null,
  "intake_action": null,
  "intake_data": null
}
```

For sell/exchange intents:

```json
{
  "primary_intent": "sell_phone",
  "secondary_intent": null,
  "routing_action": "start_sell_intake",
  "matched_product_id": null,
  "candidate_ids": [],
  "match_reason": "User stated 'sell my phone' — intake flow begins. No product match needed.",
  "confidence": "high",
  "needs_clarification": false,
  "clarification_question": null,
  "entities": {},
  "is_followup": false,
  "followup_resolves_to": null,
  "intake_action": "start",
  "intake_data": {
    "offered_model": null,
    "offered_storage": null,
    "offered_condition": null,
    "asking_price": null
  }
}
```

### Primary Intent Taxonomy (business-centered)

| `primary_intent` | Meaning |
|---|---|
| `buy_phone` | Customer wants to buy or browse a phone |
| `sell_phone` | Customer wants to sell their phone |
| `exchange_phone` | Customer wants to trade in their phone |
| `faq` | General question (hours, location, payment, policies) |
| `greeting` | Hello, hi, welcome |
| `unclear` | Cannot determine intent from message |

### Secondary Intent Taxonomy

| `secondary_intent` | Meaning |
|---|---|
| `ask_price` | Customer asking about price |
| `ask_availability` | Customer asking if a phone is in stock |
| `ask_photo` | Customer wants to see photos |
| `ask_specs` | Customer asking about specs/features |
| `ask_location` | Customer asking about store location |
| `ask_payment` | Customer asking about payment options |
| `ask_comparison` | Customer wants to compare two phones |
| `ask_recommendation` | Customer wants a suggestion |
| `null` | No secondary intent detected |

### Candidate IDs Hard Cap

**`candidate_ids` is capped at 4.** If the AI returns more than 4 plausible matches:
- The ID Validator node truncates to the 4 highest-confidence candidates
- `routing_action` is set to `show_candidates` (clarification mode)
- If 5+ matches exist and none is clearly dominant, the validator may downgrade to `discovery`

---

## 7. ID Validator Node [9]

A small deterministic JS node that runs after `Parse Call 1 Output`. It validates, cleans, and enriches the Call 1 result before it reaches the routing switch. It also sets `resolution_status` for analytics.

### Four Checks (applied in order)

```
Check 1 — matched_product_id exists in fetched inventory?
  IF NOT FOUND:
    - Set matched_product_id = null
    - If candidate_ids.length > 0: downgrade routing_action to "show_candidates"
    - Else: downgrade routing_action to "ask_clarification"
    - Set resolution_status = "validator_rejected"

Check 2 — candidate_ids all valid?
  - Remove any candidate_id not present in fetched compact catalog
  - Cap remaining list at 4
  - If candidates were removed, log removed IDs + match_reason
  - Set resolution_status = "validator_candidate_filtered" if any were removed

Check 3 — confidence = "low" AND routing_action = "show_product"?
  - Downgrade routing_action to "show_candidates" (if candidate_ids remain) or "ask_clarification"
  - Set resolution_status = "ai_downgraded"

Check 4 — matched_product_id.inStock = false?
  - Do NOT null out matched_product_id
  - Set out_of_stock = true (Call 2 must not fake availability, must respond honestly)
  - resolution_status unchanged
```

### Output Enrichment

After all 4 checks, node [9] **appends** `resolution_status` and (when applicable) `out_of_stock: true` directly to the Call 1 result object. All downstream nodes — the routing switch [10], the final prompt assembler [14], and Call 2 [15] — receive this enriched object. These fields are added by node [9]; they are not returned by Call 1 itself.

### resolution_status Field

Set by the validator after all 4 checks. Used for logging and analytics — not sent to the customer.

| `resolution_status` | Meaning |
|---|---|
| `"ai_exact"` | AI matched a single product, validator confirmed, confidence high |
| `"ai_candidates"` | AI returned 2–4 candidates, all confirmed by validator |
| `"ai_downgraded"` | AI said show_product but low confidence — validator downgraded |
| `"validator_rejected"` | AI returned a matched_product_id that doesn't exist in catalog |
| `"validator_candidate_filtered"` | Some candidate_ids were invalid, removed |
| `"intake_active"` | routing_action is a sell/exchange intake action |
| `"no_match"` | No candidates, no match |
| `"direct"` | Greeting, FAQ, direct answer — no product lookup |

---

## 8. Intake State — Explicit Design

### Storage Location

Intake state is stored at the **thread level** in the Convex `threads` table — one record per `chat_id`. It is not message-level. Intake spans multiple conversation turns and must survive bot restarts, n8n redeployments, and workflow updates.

### Exact Field Shape (Convex schema addition)

Add to the `threads` table in `convex/schema.ts`:

```ts
intake: v.optional(v.object({
  flow:           v.union(v.literal("sell"), v.literal("exchange")),
  status:         v.union(v.literal("start"), v.literal("in_progress"), v.literal("complete")),
  data: v.object({
    // sell fields
    offered_model:     v.optional(v.string()),
    offered_storage:   v.optional(v.string()),
    offered_condition: v.optional(v.union(
      v.literal("new"), v.literal("good"), v.literal("fair"), v.literal("poor")
    )),
    asking_price:      v.optional(v.number()),
    // exchange fields
    desired_product_id:   v.optional(v.string()),
    desired_product_name: v.optional(v.string()),
    // shared
    customer_notes:    v.optional(v.string()),
  }),
  last_updated_at: v.number(),   // Unix ms timestamp
  write_key:       v.string(),   // Dedup key: `${telegram_message_id}:${flow}`
}))
```

### Read/Write Lifecycle

**Read (node [4] — Load Conversation Memory):**
- Query `threads` by `chat_id`
- If `thread.intake` exists and `status !== "complete"`: pass `intake_state` to Call 1 input
- If `thread.intake` is null or `status === "complete"`: pass `intake_state: null`

**Write (node [12] — Intake State Manager):**
- Fires on `routing_action` in: `start_sell_intake`, `continue_sell_intake`, `start_exchange_intake`, `continue_exchange_intake`
- Before writing, check: `thread.intake.write_key === incoming_write_key`
  - If match: **skip write** (idempotent — same message reprocessed, do not double-write)
  - If no match: update `thread.intake` with new status, merged data, new `write_key`, new `last_updated_at`
- `write_key` format: `"${telegram_message_id}:${flow}"` — e.g. `"8234567:sell"`

**Write (node [13] — Intake Complete Writer):**
- Fires on `routing_action` in: `sell_intake_complete`, `exchange_intake_complete`
- Writes final record to admin-facing Convex destination:
  - `sell_intake_complete` → `hotLeads:createHotLead` with `status: "new"`, `source: "bot_intake"`
  - `exchange_intake_complete` → `exchangeRequests:createExchangeRequest` with `status: "pending"`
- After successful write: **clear** `thread.intake` (set to null)
- Duplicate write protection: check `write_key` before writing final record (same mechanism as node [12])

**When intake is cleared:**
- After `sell_intake_complete` Convex write succeeds
- After `exchange_intake_complete` Convex write succeeds
- Never cleared mid-intake (even if user sends unrelated messages — intake resumes on next relevant turn)

### Draft State (explicit opt-in, not default)

By default, no Convex record is written until intake is complete. If admin follow-up on abandoned intakes is needed, a `status: "draft"` write on `start_sell_intake` / `start_exchange_intake` can be added. This is a deliberate product decision requiring explicit implementation — it is not part of the V2 default design.

---

## 9. Routing Switch (Node [10])

Deterministic routing based on `routing_action` from the validated Call 1 output.

| `routing_action` | Next nodes | Call 2 mode |
|---|---|---|
| `show_product` | [11] Fetch Full Product → [14] → [15] | `exact_match` |
| `show_candidates` | [14] → [15] (candidates passed) | `clarification` |
| `ask_clarification` | [14] → [15] | `clarification` |
| `start_sell_intake` | [12] Intake State → [14] → [15] | `sell_intake_start` |
| `continue_sell_intake` | [12] Intake State → [14] → [15] | `sell_intake_continue` |
| `sell_intake_complete` | [13] Write hotLead → [14] → [15] | `sell_intake_done` |
| `start_exchange_intake` | [12] Intake State → [14] → [15] | `exchange_intake_start` |
| `continue_exchange_intake` | [12] Intake State → [14] → [15] | `exchange_intake_continue` |
| `exchange_intake_complete` | [13] Write exchangeRequest → [14] → [15] | `exchange_intake_done` |
| `discovery` | [14] → [15] (no product fetch) | `discovery` |
| `greeting` | [14] → [15] | `greeting` |
| `direct_answer` | [14] → [15] | `direct_answer` |
| `no_match` | [14] → [15] | `no_match` |

---

## 10. Call 2 — Response Generation

### Role

Call 2 generates the final customer-facing reply. It receives a structured context assembled by node [14] and must:
- Stay grounded in verified inventory data (no hallucinated price, availability, or specs)
- Use the correct language (Amharic / English / mixed per `language_hint`)
- Follow the active Call 2 mode (set by routing switch)
- Not reveal internal system state, routing actions, or AI reasoning
- For intake flows: ask exactly one question at a time (do not ask for all missing fields at once)

### Model

`google/gemini-3.1-flash-lite-preview` via OpenRouter
Temperature: `0.7`
Max tokens: `300`

### What Call 2 Receives (node [14] assembles this)

- `resolution_status` (from ID Validator)
- `routing_action` + `primary_intent` + `secondary_intent`
- `matched_product` (full product details — only if node [11] ran)
- `candidate_products` (full details for up to 4 candidates — only if show_candidates path)
- `intake_state` (current intake data — only for intake paths)
- `out_of_stock` flag
- `chat_history` (last 5 turns)
- `language_hint`
- `is_first_message` (drives the exact Amharic welcome opening)

### Grounding Rules

Call 2 must never:
- State a price not present in `matched_product.price`
- Claim a product is in stock if `matched_product.inStock = false`
- Reference product images if `matched_product.hasImage = false`
- Invent product specs not in `matched_product.description`

If a field is missing or null, Call 2 must say "ዝርዝሩ አሁን አይገኝም" (details not currently available) — not invent a value.

---

## 11. What JS Matching Is Removed vs What Stays

### Removed from V1

| V1 Logic | Disposition |
|---|---|
| `Evaluate_Match_Quality.js` — entire fuzzy match engine | **Removed** — replaced by Call 1 AI matching |
| `match_type` field (exact/partial/multiple/none) | **Removed** — replaced by `confidence` + `routing_action` + `resolution_status` |
| Ordinal resolution ("the second one" → array index) | **Removed** — replaced by `is_followup` + `followup_resolves_to` in Call 1 |
| `Needs Database IF` node | **Removed** — inventory is always pre-fetched |

### Kept as Pre-signals (not decisions)

| Logic | V2 Role |
|---|---|
| Language hint (Amharic Unicode check) | Pre-signal input to Call 1 |
| Storage regex (`256`, `512gb`, etc.) | Pre-signal input to Call 1 + tiered fetch hint |
| Brand regex (Samsung, iPhone, etc.) | Pre-signal input → drives Tier 1 fetch only |
| Media/photo flag | Pre-signal input to Call 1 |
| Message length | Pre-signal input to Call 1 |

### Kept as Deterministic Post-AI

| Logic | V2 Role |
|---|---|
| Message normalization | Node [2], unchanged |
| ID Validator | Node [9], new, deterministic |
| Routing switch on `routing_action` | Node [10], deterministic |
| Intake state read/write | Nodes [12][13], Convex mutations |
| Lead/exchange Convex writes | Node [13], only on completion states |
| Memory load/save | Nodes [4][17], unchanged |
| Error fallback | Node [19], unchanged |

---

## 12. Migration Plan

**Principle:** V1 stays live throughout. The production webhook switch is atomic. Rollback takes under 60 seconds.

### Phase 0 — Convex Prep (no bot impact)

1. Add `listCompactProductsByBrand`, `listCompactFeaturedProducts`, `listAllCompactProducts` to `convex/products.ts`
2. Add `intake` field to `threads` table in `convex/schema.ts` (see Section 8)
3. Add or verify `hotLeads:createHotLead` accepts `source: "bot_intake"`
4. Add or verify `exchangeRequests:createExchangeRequest` mutation exists in `convex/exchangeRequests.ts` (bot intake table, distinct from `convex/exchanges.ts` which is admin-managed)
5. Test all three compact queries return correct shape against production Convex

### Phase 1 — Build V2 Parallel Workflow in n8n

1. Duplicate V1 workflow as `"TedyTech V2 - AI Brain"` in n8n
2. **Disable V2 webhook** — V1 still handles all production traffic
3. Rebuild nodes in implementation order (Section 13)
4. Use n8n test execution mode to validate each stage in isolation

### Phase 2 — Test Bot Validation

1. Create a second Telegram bot (test token, not production)
2. Point V2 webhook to test bot only
3. Test scenario matrix:
   - Shorthand: S24, A55, 13 Pro, Camon 20, A14
   - Partial: "Samsung 24", "new samsung", "latest iphone"
   - Sell: "sell my phone", "ሸጥ", multi-turn sell intake progression
   - Exchange: "exchange", "trade in", multi-turn exchange intake
   - Discovery: "i want a phone", "suggest something"
   - Followup: "how much is the second one", "is it in stock"
   - Mixed Amharic/English messages
   - Photo request with and without image attached
   - FAQ: location, payment, hours
   - ID validator: manually inject a fake product ID and confirm it is caught
4. Confirm intake state persists correctly across turns in Convex `threads`
5. Confirm no Convex `hotLeads` or `exchangeRequests` records appear until intake complete

### Phase 3 — Atomic Production Switch

1. Deactivate V1 webhook in n8n (single toggle)
2. Activate V2 webhook with production bot token
3. V1 workflow: archived, **not deleted** (retain for 30 days)

### Phase 4 — 48-Hour Monitoring Window

- Watch n8n execution history: error rate, Call 1 parse failures, fallback activations
- Watch Convex `hotLeads` table: confirm `source: "bot_intake"` records appear on completion only
- Watch Convex `exchangeRequests` table: confirm records appear on completion only
- Monitor `resolution_status` distribution (log to n8n or a simple Convex `analytics` field)
- Rollback trigger: if error rate significantly exceeds V1 baseline — reactivate V1 in under 60 seconds

---

## 13. Implementation Order

```
Step 1:   convex/schema.ts     — Add intake field to threads table
Step 2:   convex/products.ts   — Add listCompactProductsByBrand
Step 3:   convex/products.ts   — Add listCompactFeaturedProducts (deterministic sort rule)
Step 4:   convex/products.ts   — Add listAllCompactProducts
Step 5:   convex/hotLeads.ts   — Verify/add createHotLead with source:"bot_intake"
Step 6:   convex/exchangeRequests.ts — Verify/add createExchangeRequest mutation
          Note: use the exchangeRequests table (bot-captured intake), NOT the exchanges
          table (admin-managed trade-ins). The mutation path is exchangeRequests:createExchangeRequest.
          File: convex/exchangeRequests.ts (create if it does not exist).

Step 7:   n8n                  — Duplicate V1 as V2, disable V2 webhook
Step 8:   n8n node [2]         — Add pre-signals (language/media/storage/brand/admin/length hints)
Step 9:   n8n node [4]         — Move Load Memory earlier, include intake field read
Step 10:  n8n node [5]         — Build tiered inventory fetch (Tier 1/2/3 logic)
Step 11:  n8n node [6]         — Redesign Build Call 1 Prompt (pre-signals + inventory + history + intake_state)
Step 12:  n8n node [7]         — Redesign Call 1 system prompt (new intent taxonomy + intake awareness)
Step 13:  n8n node [8]         — Redesign Parse Call 1 Output (new schema, fallback to unclear)
Step 14:  n8n node [9]         — Add ID Validator (4 checks + resolution_status)
Step 15:  n8n node [10]        — Redesign Routing Switch (13 routing_action branches)
Step 16:  n8n node [11]        — Conditional Fetch Full Product Details (show_product path)
Step 17:  n8n node [12]        — Intake State Manager (read/write thread.intake, write_key dedup)
Step 18:  n8n node [13]        — Intake Complete Writer (hotLead or exchangeRequest, then clear intake)
Step 19:  n8n node [14]        — Redesign Assemble Final Prompt (path-specific context per routing_action)
Step 20:  n8n node [15]        — Update Call 2 system prompt (grounding rules, intake-aware, mode-aware)
Step 21:  n8n node [17]        — Update Save Memory to preserve intake updates
Step 22:  Test on test bot (full scenario matrix from Section 12 Phase 2)
Step 23:  Atomic webhook switch to production
```

---

## 14. Open Items / Future Considerations

- **Admin path:** `is_admin_sender = true` from node [2] can branch to an admin-specific flow in a future iteration. V2 leaves this slot open without implementing it.
- **Draft intake state:** Not default in V2. Can be added if admin follow-up on abandoned intakes becomes a priority. Requires explicit product decision.
- **Broadcast promo:** Currently unimplemented in V1. Not in scope for V2.
- **Image URL resolution:** Telegram `getFile` API call to resolve `telegram_file_id` to a URL is not in scope for V2 but the `telegram_file_id` is already captured in normalization.
- **`resolution_status` analytics:** Consider logging to a lightweight `bot_analytics` Convex table after V2 stabilizes.
