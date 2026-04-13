# Telegram Message Ingestion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire n8n Telegram stub → Convex prod mutation so every incoming customer Telegram message atomically upserts a thread, sets `firstMessageAt` once, stores the message with idempotency, and powers the Home KPIs.

**Architecture:** n8n receives Telegram webhook updates via the existing Telegram Trigger stub. A Code node normalises the payload; an HTTP Request node POSTs to the Convex REST mutation endpoint `POST https://fastidious-schnauzer-265.convex.cloud/api/mutation`. The Convex `messages:ingestTelegramMessage` mutation is the single atomic write: idempotency check → thread upsert → `firstMessageAt` set-once → message insert. A companion `messages:createAdminMessage` mutation handles admin-side writes and updates `lastAdminMessageAt`.

**Tech Stack:** Convex (TypeScript mutations + schema), n8n workflow JSON, Telegram Bot API, Convex REST API (no auth needed for public mutations)

---

## Task 1: Add media + idempotency fields to messages schema

**Files:**
- Modify: `convex/schema.ts` (messages table, ~line 180–195)

### Step 1: Edit the messages table in schema.ts

Replace the messages `defineTable` block to add three optional fields and one new index:

```typescript
messages: defineTable({
  threadId: v.id("threads"),
  sender: MessageSender,
  senderRole: v.optional(v.union(MessageSender, v.literal("bot"))),
  senderTelegramId: v.string(),
  text: v.string(),
  exchangeId: v.optional(v.id("exchanges")),
  // Idempotency: "<chatId>:<messageId>" — unique per Telegram chat+message
  telegramMessageId: v.optional(v.string()),
  // Media: Telegram file_id stored at ingest; URL resolved on demand via getFile API
  mediaFileId: v.optional(v.string()),
  mediaType: v.optional(v.string()), // "photo" | "document" | "voice" | etc.
  createdAt: v.number(),
})
  .index("by_threadId", ["threadId"])
  .index("by_threadId_and_createdAt", ["threadId", "createdAt"])
  .index("by_sender_and_createdAt", ["sender", "createdAt"])
  .index("by_createdAt", ["createdAt"])
  .index("by_exchangeId", ["exchangeId"])
  .index("by_telegramMessageId", ["telegramMessageId"]),
```

> **Why `optional`?** Prod DB may have messages created before this migration. Optional keeps the schema backward-compatible.

> **Why composite `telegramMessageId`?** Telegram `message_id` is unique *within a chat*, not globally. Storing `"chatId:messageId"` (e.g. `"987654321:42"`) guarantees global uniqueness across all threads.

### Step 2: Verify TypeScript compiles

```bash
cd "d:/Abenier/Micky Mobile Admin/Admin-Ted"
npm run build
```
Expected: no TypeScript errors. (Vite build may fail on unrelated things — that's OK for now; tsc errors are what matter.)

---

## Task 2: Create `convex/messages.ts` with atomic ingestion mutation

**Files:**
- Create: `convex/messages.ts`

### Step 1: Create the file with the full `ingestTelegramMessage` mutation

```typescript
// convex/messages.ts
import { mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Atomic customer message ingestion from Telegram via n8n.
 *
 * Steps (all in one DB transaction):
 * 1. Idempotency check: if telegramMessageId already stored, return early.
 * 2. Upsert thread by telegramId:
 *    - Create if missing (status=new, unreadCount=1, firstMessageAt=ts)
 *    - Update if exists (lastCustomerMessageAt, unreadCount++, reopen if done)
 *    - Set firstMessageAt ONLY if currently null (immutable once set)
 * 3. Insert message row with sender="customer", senderRole="customer".
 *
 * Called by n8n HTTP node:
 *   POST https://fastidious-schnauzer-265.convex.cloud/api/mutation
 *   { "path": "messages:ingestTelegramMessage", "args": { ... } }
 */
export const ingestTelegramMessage = mutation({
  args: {
    telegramId: v.string(),           // Telegram user/chat ID (string of int)
    customerFirstName: v.string(),
    customerLastName: v.optional(v.string()),
    customerUsername: v.optional(v.string()),
    text: v.string(),                 // message text, caption, or "[photo]" etc.
    telegramMessageId: v.string(),    // "<chatId>:<messageId>" composite key
    mediaFileId: v.optional(v.string()),  // Telegram file_id (no URL fetch at ingest)
    mediaType: v.optional(v.string()),    // "photo" | "document" | "voice"
    createdAt: v.optional(v.number()),    // epoch ms from msg.date * 1000; defaults to Date.now()
  },
  handler: async (ctx, args) => {
    const ts = args.createdAt ?? Date.now();

    // ── 1. Idempotency ───────────────────────────────────────────────────────
    const existingMsg = await ctx.db
      .query("messages")
      .withIndex("by_telegramMessageId", (q) =>
        q.eq("telegramMessageId", args.telegramMessageId)
      )
      .first();
    if (existingMsg !== null) {
      return {
        threadId: existingMsg.threadId,
        messageId: existingMsg._id,
        isDuplicate: true,
      };
    }

    // ── 2. Upsert thread ─────────────────────────────────────────────────────
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_telegramId", (q) => q.eq("telegramId", args.telegramId))
      .first();

    const preview = args.text.slice(0, 100);
    let threadId;

    if (thread === null) {
      // New thread — firstMessageAt set on creation
      threadId = await ctx.db.insert("threads", {
        telegramId: args.telegramId,
        customerFirstName: args.customerFirstName,
        customerLastName: args.customerLastName,
        customerUsername: args.customerUsername,
        status: "new",
        unreadCount: 1,
        lastMessageAt: ts,
        lastMessagePreview: preview,
        lastCustomerMessageAt: ts,
        firstMessageAt: ts,          // set once, never overwritten
        hasCustomerMessaged: true,
        hasAdminReplied: false,
        lastCustomerMessageHasBudgetKeyword: false,
        createdAt: ts,
        updatedAt: ts,
      });
    } else {
      threadId = thread._id;

      // Build patch — always update activity fields
      const patch: {
        updatedAt: number;
        lastMessageAt: number;
        lastMessagePreview: string;
        lastCustomerMessageAt: number;
        unreadCount: number;
        hasCustomerMessaged: boolean;
        customerFirstName: string;
        customerLastName?: string;
        customerUsername?: string;
        status?: "new" | "seen" | "done";
        firstMessageAt?: number;
      } = {
        updatedAt: ts,
        lastMessageAt: ts,
        lastMessagePreview: preview,
        lastCustomerMessageAt: ts,
        unreadCount: thread.unreadCount + 1,
        hasCustomerMessaged: true,
        // Refresh profile fields in case name/username changed
        customerFirstName: args.customerFirstName,
        customerLastName: args.customerLastName,
        customerUsername: args.customerUsername,
      };

      // Reopen closed threads when customer writes again
      if (thread.status === "done") patch.status = "new";

      // Set firstMessageAt only once (immutable)
      if (thread.firstMessageAt == null) patch.firstMessageAt = ts;

      await ctx.db.patch(threadId, patch);
    }

    // ── 3. Insert message ────────────────────────────────────────────────────
    const messageId = await ctx.db.insert("messages", {
      threadId,
      sender: "customer",
      senderRole: "customer",
      senderTelegramId: args.telegramId,
      text: args.text,
      telegramMessageId: args.telegramMessageId,
      mediaFileId: args.mediaFileId,
      mediaType: args.mediaType,
      createdAt: ts,
    });

    return { threadId, messageId, isDuplicate: false };
  },
});

/**
 * Create an admin message and update thread.lastAdminMessageAt.
 * Called by the admin mini app (React frontend) when an admin sends a reply.
 *
 * Does NOT need idempotency — admin messages are generated by the app, not Telegram.
 */
export const createAdminMessage = mutation({
  args: {
    threadId: v.id("threads"),
    adminTelegramId: v.string(),
    text: v.string(),
    senderRole: v.optional(v.union(v.literal("admin"), v.literal("bot"))),
  },
  handler: async (ctx, args) => {
    const ts = Date.now();
    const role = args.senderRole ?? "admin";

    const messageId = await ctx.db.insert("messages", {
      threadId: args.threadId,
      sender: "admin",
      senderRole: role,
      senderTelegramId: args.adminTelegramId,
      text: args.text,
      createdAt: ts,
    });

    await ctx.db.patch(args.threadId, {
      updatedAt: ts,
      lastMessageAt: ts,
      lastMessagePreview: args.text.slice(0, 100),
      lastAdminMessageAt: ts,
      hasAdminReplied: true,
    });

    return { messageId };
  },
});
```

### Step 2: Verify TypeScript compiles

```bash
cd "d:/Abenier/Micky Mobile Admin/Admin-Ted"
npm run build
```
Expected: exits 0 with no tsc errors.

---

## Task 3: Deploy schema + mutations to Convex prod

**Files:** (no file changes — just deploy)

### Step 1: Deploy to prod

```bash
cd "d:/Abenier/Micky Mobile Admin/Admin-Ted"
npx convex deploy --yes
```

Expected output:
```
✓ Schema updated
✓ Functions deployed
```
This targets `fastidious-schnauzer-265` (the prod deployment referenced by Vercel).

### Step 2: Smoke-test `ingestTelegramMessage` directly with curl

Run this **exactly** — it simulates a customer sending "Hello from curl test":

```bash
curl -s -X POST \
  "https://fastidious-schnauzer-265.convex.cloud/api/mutation" \
  -H "Content-Type: application/json" \
  -d '{
    "path": "messages:ingestTelegramMessage",
    "args": {
      "telegramId": "111000111",
      "customerFirstName": "CurlTest",
      "text": "Hello from curl test",
      "telegramMessageId": "111000111:1",
      "createdAt": '"$(date +%s)"'000
    }
  }' | python3 -m json.tool
```

Expected response shape:
```json
{
  "status": "success",
  "value": {
    "threadId": "...",
    "messageId": "...",
    "isDuplicate": false
  }
}
```

### Step 3: Verify idempotency — send the same message_id again

```bash
curl -s -X POST \
  "https://fastidious-schnauzer-265.convex.cloud/api/mutation" \
  -H "Content-Type: application/json" \
  -d '{
    "path": "messages:ingestTelegramMessage",
    "args": {
      "telegramId": "111000111",
      "customerFirstName": "CurlTest",
      "text": "Hello from curl test",
      "telegramMessageId": "111000111:1",
      "createdAt": '"$(date +%s)"'000
    }
  }' | python3 -m json.tool
```

Expected: same `threadId`/`messageId` returned, **`"isDuplicate": true`**.

### Step 4: Verify in Convex dashboard

1. Open https://dashboard.convex.dev → select `fastidious-schnauzer-265`
2. Navigate to **Data → threads** table:
   - Confirm 1 row with `telegramId: "111000111"`, `firstMessageAt` set, `status: "new"`
3. Navigate to **Data → messages** table:
   - Confirm 1 row with `telegramMessageId: "111000111:1"`, `senderRole: "customer"`

### Step 5: Commit schema + mutation

```bash
cd "d:/Abenier/Micky Mobile Admin/Admin-Ted"
git add convex/schema.ts convex/messages.ts
git commit -m "feat: add messages:ingestTelegramMessage mutation + media/idempotency fields

- messages schema: +telegramMessageId, +mediaFileId, +mediaType, +by_telegramMessageId index
- messages:ingestTelegramMessage: atomic upsert thread + firstMessageAt + insert message
- messages:createAdminMessage: admin reply mutation with lastAdminMessageAt update"
```

---

## Task 4: Create n8n workflow JSON under docs/n8n/

**Files:**
- Create: `docs/n8n/telegram-ingestion-workflow.json`

### Step 1: Create the n8n workflow JSON

This is the complete importable n8n workflow. The user imports it, attaches their Telegram Bot credential, and activates it.

```json
{
  "name": "Telegram → Convex Ingestion",
  "nodes": [
    {
      "parameters": {
        "updates": ["message"],
        "additionalFields": {}
      },
      "id": "a1b2c3d4-0001-0001-0001-000000000001",
      "name": "Telegram Trigger",
      "type": "n8n-nodes-base.telegramTrigger",
      "typeVersion": 1.1,
      "position": [200, 300],
      "webhookId": "replace-with-your-webhook-id",
      "credentials": {
        "telegramApi": {
          "id": "REPLACE_WITH_CREDENTIAL_ID",
          "name": "Telegram Bot"
        }
      }
    },
    {
      "parameters": {
        "jsCode": "// ─────────────────────────────────────────────────────\n// Extract Telegram message fields → Convex mutation args\n// ─────────────────────────────────────────────────────\nconst update = $input.first().json;\nconst msg = update.message;\n\n// Skip non-message updates (edited_message, callback_query, etc.)\nif (!msg) return [];\n\nconst from = msg.from;\nif (!from) return []; // skip channel posts (no sender)\n\n// Epoch milliseconds from Telegram unix timestamp\nconst ts = msg.date * 1000;\n\n// ── Text and media ──────────────────────────────────\nlet text = '';\nlet mediaFileId;\nlet mediaType;\n\nif (msg.text) {\n  text = msg.text;\n} else if (msg.photo) {\n  // Telegram sends multiple sizes; last entry is the largest\n  const photo = msg.photo[msg.photo.length - 1];\n  mediaFileId = photo.file_id;\n  mediaType = 'photo';\n  text = msg.caption || '[photo]';\n} else if (msg.document) {\n  mediaFileId = msg.document.file_id;\n  mediaType = 'document';\n  text = msg.caption || ('[document: ' + (msg.document.file_name || 'file') + ']');\n} else if (msg.voice) {\n  mediaFileId = msg.voice.file_id;\n  mediaType = 'voice';\n  text = '[voice message]';\n} else if (msg.sticker) {\n  text = '[sticker' + (msg.sticker.emoji ? ': ' + msg.sticker.emoji : '') + ']';\n} else {\n  text = '[unsupported message type]';\n}\n\n// ── Build Convex mutation args ───────────────────────\n// telegramMessageId: composite \"<chatId>:<messageId>\" for global uniqueness\nconst args = {\n  telegramId: String(from.id),\n  customerFirstName: from.first_name,\n  text,\n  telegramMessageId: String(from.id) + ':' + String(msg.message_id),\n  createdAt: ts,\n};\n\n// Only include optional fields if they have values\nif (from.last_name)  args.customerLastName  = from.last_name;\nif (from.username)   args.customerUsername  = from.username;\nif (mediaFileId)     args.mediaFileId       = mediaFileId;\nif (mediaType)       args.mediaType         = mediaType;\n\nreturn [{\n  json: {\n    path: 'messages:ingestTelegramMessage',\n    args,\n  }\n}];"
      },
      "id": "a1b2c3d4-0002-0002-0002-000000000002",
      "name": "Extract Message Fields",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [460, 300]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://fastidious-schnauzer-265.convex.cloud/api/mutation",
        "authentication": "none",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "Content-Type",
              "value": "application/json"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify($json) }}",
        "options": {
          "retryOnFail": true,
          "maxTries": 3,
          "waitBetweenTries": 2000,
          "timeout": 10000
        }
      },
      "id": "a1b2c3d4-0003-0003-0003-000000000003",
      "name": "Convex ingestTelegramMessage",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [720, 300]
    },
    {
      "parameters": {
        "jsCode": "// Log error details — replace with Slack/email node if needed\nconst error = $input.first().json;\nconsole.error('[Telegram Ingestion] Convex call failed:', JSON.stringify(error));\n// Re-throw so n8n marks execution as error (enables retry/alert)\nthrow new Error('Convex mutation failed: ' + JSON.stringify(error));"
      },
      "id": "a1b2c3d4-0004-0004-0004-000000000004",
      "name": "Log Error",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [720, 500]
    }
  ],
  "connections": {
    "Telegram Trigger": {
      "main": [
        [{ "node": "Extract Message Fields", "type": "main", "index": 0 }]
      ]
    },
    "Extract Message Fields": {
      "main": [
        [{ "node": "Convex ingestTelegramMessage", "type": "main", "index": 0 }]
      ]
    },
    "Convex ingestTelegramMessage": {
      "main": [],
      "error": [
        [{ "node": "Log Error", "type": "main", "index": 0 }]
      ]
    }
  },
  "active": false,
  "settings": {
    "executionOrder": "v1",
    "errorWorkflow": ""
  },
  "versionId": "1",
  "meta": {
    "instanceId": "replace-with-your-n8n-instance-id"
  },
  "id": "telegram-convex-ingestion-v1",
  "tags": []
}
```

> **Import instructions:**
> 1. In n8n → Workflows → Import from JSON → paste this file
> 2. Open the **Telegram Trigger** node → set your existing Telegram Bot credential
> 3. Activate the workflow (toggle at top right)
>
> **OR** (if extending the existing stub): open your stub workflow, delete the existing Trigger node, add the three nodes (Extract Message Fields, Convex HTTP, Log Error), wire them, save.

### Step 2: Commit the n8n workflow JSON

```bash
cd "d:/Abenier/Micky Mobile Admin/Admin-Ted"
mkdir -p docs/n8n
git add docs/n8n/telegram-ingestion-workflow.json
git commit -m "docs: add n8n Telegram → Convex ingestion workflow JSON"
```

---

## Task 5: Activate n8n workflow and run end-to-end test

### Step 1: Import / wire the workflow in n8n

Follow the import instructions in Task 4. Ensure the workflow is **active** (green toggle).

### Step 2: Send a real Telegram message to the bot

Open Telegram → find your bot → send a text message:
```
Hey, what's the price of the iPhone 13?
```

### Step 3: Check n8n execution log

In n8n → Executions → find the latest run → verify:
- Telegram Trigger fired ✓
- Extract Message Fields ran without errors ✓
- Convex HTTP node returned 200 with `{ "status": "success", "value": { "isDuplicate": false } }` ✓

### Step 4: Verify in Convex dashboard

1. Open https://dashboard.convex.dev → `fastidious-schnauzer-265`
2. **threads** table: confirm row exists with:
   - `telegramId` = your Telegram user ID (check Telegram: @userinfobot)
   - `firstMessageAt` = a recent timestamp (not null)
   - `status = "new"`
   - `unreadCount = 1`
3. **messages** table: confirm row exists with:
   - `sender = "customer"`
   - `senderRole = "customer"`
   - `text = "Hey, what's the price of the iPhone 13?"`
   - `telegramMessageId = "<yourId>:<message_id>"`

### Step 5: Verify Home KPI "First-Time Today"

Open https://admin-ted.vercel.app → Home page.

**Expected:** "First-Time Today" KPI shows **1** (or more if you already had test messages from Task 3).

> The dashboard query filters `firstMessageAt >= todayStart` (Ethiopia midnight UTC+3). If it's still 0, check:
> - Is `firstMessageAt` set on the thread? (check Convex dashboard)
> - Is `todayStart` correct for your timezone? (dashboard uses UTC+3)

### Step 6: Test idempotency via n8n

Forward the same Telegram message to yourself (Telegram does not re-send, but you can re-trigger via n8n's manual "Test Workflow" → manually paste the update JSON from the previous execution). Expected: `isDuplicate: true` in n8n output, **no duplicate row in messages table**.

### Step 7: Test photo message

Send a photo to the bot. Verify in Convex messages table:
- `mediaType = "photo"`
- `mediaFileId` = a long Telegram file_id string
- `text = "[photo]"` (or the caption if you added one)

---

## Task 6: Final commit and push

```bash
cd "d:/Abenier/Micky Mobile Admin/Admin-Ted"
git status
git push
```

---

## Security note (post-MVP)

The `ingestTelegramMessage` mutation is currently a public unauthenticated Convex endpoint. Anyone who discovers the path can inject fake messages. Mitigation options (in order of effort):

1. **Telegram HMAC verification** — Verify `X-Telegram-Bot-Api-Secret-Token` header in an HTTP action wrapper. Requires moving from `/api/mutation` REST to a `convex/http.ts` action.
2. **Convex environment variable secret** — Add `apiSecret: v.optional(v.string())` arg; check against `process.env.INGESTION_SECRET` in the mutation handler. n8n sends the secret; others don't know it.
3. **Internal mutation** — Make `ingestTelegramMessage` an `internalMutation` and expose it only via an authenticated HTTP action.

Option 2 is the lowest-effort upgrade if security becomes a concern.

---

## Summary of files changed

| File | Change |
|------|--------|
| `convex/schema.ts` | +3 fields on messages, +1 index |
| `convex/messages.ts` | New file — 2 mutations |
| `docs/n8n/telegram-ingestion-workflow.json` | New file — importable workflow |
