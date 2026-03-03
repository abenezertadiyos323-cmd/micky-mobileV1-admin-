// convex/schema.ts
// DATA V2 → Convex Schema Implementation (MVP Locked)

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/* =========================
   ENUMS
========================= */

const ProductType = v.union(
  v.literal("phone"),
  v.literal("accessory")
);

const Condition = v.union(
  v.literal("New"),
  v.literal("Like New"),
  v.literal("Excellent"),
  v.literal("Good"),
  v.literal("Fair"),
  v.literal("Poor")
);

const ThreadStatus = v.union(
  v.literal("new"),
  v.literal("seen"),
  v.literal("done")
);

const MessageSender = v.union(
  v.literal("customer"),
  v.literal("admin")
);

const ExchangeStatus = v.union(
  v.literal("Pending"),
  v.literal("Quoted"),
  v.literal("Accepted"),
  v.literal("Completed"),
  v.literal("Rejected")
);

const InventoryReason = v.union(
  v.literal("Exchange completed"),
  v.literal("Manual adjustment"),
  v.literal("Product created"),
  v.literal("Product restored from archive")
);

const AffiliateStatus = v.union(
  v.literal("active"),
  v.literal("inactive")
);

/* =========================
   SCHEMA
========================= */

export default defineSchema({

  /* =========================
     ADMINS
  ========================= */
  admins: defineTable({
    telegramId: v.string(),
    firstName: v.string(),
    lastName: v.optional(v.string()),
    username: v.optional(v.string()),
    isActive: v.boolean(),
    addedAt: v.number(),
    addedBy: v.optional(v.string()),
  })
    .index("by_telegramId", ["telegramId"])
    .index("by_isActive", ["isActive"]),

  /* =========================
     PRODUCTS
  ========================= */
  products: defineTable({
    type: ProductType,
    // optional so legacy rows (brand+model, no phoneType) pass schema validation;
    // run products:migratePhoneType to backfill, then make required again.
    phoneType: v.optional(v.string()),

    ram: v.optional(v.string()),
    storage: v.optional(v.string()),
    condition: v.optional(Condition),

    price: v.number(),
    stockQuantity: v.number(),
    lowStockThreshold: v.optional(v.number()),

    exchangeEnabled: v.boolean(),
    description: v.optional(v.string()),

    images: v.array(v.object({
      storageId: v.id("_storage"),
      // url is NOT stored — resolved at query time via ctx.storage.getUrl()
      order: v.number(),
    })),

    isArchived: v.boolean(),
    archivedAt: v.optional(v.number()),

    createdAt: v.number(),
    createdBy: v.string(),
    updatedAt: v.number(),
    updatedBy: v.string(),

    // Normalized search field: lowercase phoneType + storage + ram + condition.
    // Optional so legacy rows remain valid until backfillSearchNormalized is run.
    searchText: v.optional(v.string()),
    // Indexed search field for prefix search: phoneType + storage + ram + condition (lowercase, normalized).
    // optional so legacy rows pass schema validation; run products:backfillSearchNormalized then make required.
    searchNormalized: v.optional(v.string()),

    // Legacy fields kept so rows created before the phoneType migration pass schema validation.
    // Run products:cleanupLegacyBrandModel to remove them from documents, then remove these lines.
    brand: v.optional(v.string()),
    model: v.optional(v.string()),
  })
    .index("by_type", ["type"])
    .index("by_type_searchNormalized", ["type", "searchNormalized"])
    .index("by_isArchived_createdAt", ["isArchived", "createdAt"])
    .index("by_archivedAt_and_stockQuantity", ["archivedAt", "stockQuantity"])
    .index("by_archivedAt", ["archivedAt"])
    .index("by_exchangeEnabled", ["exchangeEnabled"])
    .index("by_type_and_exchangeEnabled_and_archivedAt", [
      "type",
      "exchangeEnabled",
      "archivedAt",
    ])
    .index("by_isArchived_stockQuantity_createdAt", [
      "isArchived",
      "stockQuantity",
      "createdAt",
    ])
    .index("by_isArchived_exchangeEnabled_createdAt", [
      "isArchived",
      "exchangeEnabled",
      "createdAt",
    ])
    .index("by_isArchived_condition_createdAt", [
      "isArchived",
      "condition",
      "createdAt",
    ]),

  /* =========================
     THREADS
  ========================= */
  threads: defineTable({
    telegramId: v.string(),
    customerFirstName: v.string(),
    customerLastName: v.optional(v.string()),
    customerUsername: v.optional(v.string()),

    status: ThreadStatus,
    unreadCount: v.number(),

    lastMessageAt: v.number(),
    lastMessagePreview: v.optional(v.string()),

    lastCustomerMessageAt: v.optional(v.number()),
    lastAdminMessageAt: v.optional(v.number()),
    firstMessageAt: v.optional(v.number()),

    hasCustomerMessaged: v.boolean(),
    hasAdminReplied: v.boolean(),
    lastCustomerMessageHasBudgetKeyword: v.boolean(),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_telegramId", ["telegramId"])
    .index("by_status", ["status"])
    .index("by_status_and_updatedAt", ["status", "updatedAt"])
    .index("by_updatedAt", ["updatedAt"])
    .index("by_lastMessageAt", ["lastMessageAt"]),

  /* =========================
     MESSAGES
  ========================= */
  messages: defineTable({
    threadId: v.id("threads"),
    sender: MessageSender,
    // Extends sender: bot is a subcategory of admin used for automated replies.
    // When senderRole === "bot", the message was sent by the Telegram bot, not a human admin.
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

  /* =========================
     EXCHANGES
  ========================= */
  exchanges: defineTable({
    telegramId: v.string(),
    threadId: v.id("threads"),
    desiredPhoneId: v.id("products"),

    tradeInBrand: v.string(),
    tradeInModel: v.string(),
    tradeInStorage: v.string(),
    tradeInRam: v.string(),
    tradeInCondition: Condition,
    tradeInImei: v.optional(v.string()),

    customerNotes: v.optional(v.string()),
    budgetMentionedInSubmission: v.boolean(),

    desiredPhonePrice: v.number(),

    calculatedTradeInValue: v.number(),
    calculatedDifference: v.number(),

    adminOverrideTradeInValue: v.optional(v.number()),
    adminOverrideDifference: v.optional(v.number()),

    finalTradeInValue: v.number(),
    finalDifference: v.number(),
    priorityValueETB: v.number(),

    status: ExchangeStatus,
    clickedContinue: v.boolean(),

    quotedAt: v.optional(v.number()),
    quotedBy: v.optional(v.string()),
    quoteMessageId: v.optional(v.id("messages")),

    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    completedBy: v.optional(v.string()),
    rejectedAt: v.optional(v.number()),
    rejectedBy: v.optional(v.string()),
  })
    .index("by_telegramId", ["telegramId"])
    .index("by_threadId", ["threadId"])
    .index("by_status", ["status"])
    .index("by_status_and_createdAt", ["status", "createdAt"])
    .index("by_createdAt", ["createdAt"])
    .index("by_updatedAt", ["updatedAt"])
    .index("by_status_and_completedAt", ["status", "completedAt"])
    .index("by_tradeIn_exact_completed", [
      "tradeInBrand",
      "tradeInModel",
      "tradeInStorage",
      "tradeInCondition",
      "status",
    ])
    .index("by_tradeIn_brand_model_storage_completed", [
      "tradeInBrand",
      "tradeInModel",
      "tradeInStorage",
      "status",
    ])
    .index("by_tradeIn_brand_model_completed", [
      "tradeInBrand",
      "tradeInModel",
      "status",
    ])
    .index("by_threadId_and_createdAt", ["threadId", "createdAt"])
    .index("by_threadId_and_updatedAt", ["threadId", "updatedAt"]),

  /* =========================
     INVENTORY EVENTS
  ========================= */
  inventoryEvents: defineTable({
    productId: v.id("products"),
    oldQty: v.number(),
    newQty: v.number(),
    editedBy: v.string(),
    reason: InventoryReason,
    exchangeId: v.optional(v.id("exchanges")),
    timestamp: v.number(),
  })
    .index("by_productId", ["productId"])
    .index("by_productId_and_timestamp", ["productId", "timestamp"])
    .index("by_editedBy", ["editedBy"])
    .index("by_timestamp", ["timestamp"])
    .index("by_reason", ["reason"]),

  /* =========================
     DEMAND EVENTS
  ========================= */
  demand_events: defineTable({
    // Which surface generated the signal
    source: v.union(
      v.literal("bot"),    // Telegram bot conversation
      v.literal("search"), // Customer searched in mini app
      v.literal("select"), // Customer selected/submitted in mini app
    ),
    phoneType: v.string(),   // e.g. "iPhone 15 Pro"
    createdAt: v.number(),
    userId: v.optional(v.string()),      // Telegram user ID (string)
    threadId: v.optional(v.id("threads")),
    meta: v.optional(v.string()),        // JSON-encoded extra context
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_source_and_createdAt", ["source", "createdAt"])
    .index("by_phoneType_and_createdAt", ["phoneType", "createdAt"]),

  /* =========================
     SEARCHES
  ========================= */
  searches: defineTable({
    userId: v.optional(v.string()),
    term: v.string(),
    createdAt: v.number(),
  }).index("by_term", ["term"]),

  /* =========================
     FAVORITES
  ========================= */
  favorites: defineTable({
    userId: v.string(),
    phoneId: v.string(),
    createdAt: v.number(),
  }).index("by_userId", ["userId"]),

  /* =========================
     SESSIONS
  ========================= */
  sessions: defineTable({
    createdAt: v.number(),
  }),

  /* =========================
     CUSTOMERS
  ========================= */
  customers: defineTable({
    telegramUserId: v.number(),
    username: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    photoUrl: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_telegramUserId", ["telegramUserId"]),

  /* =========================
     AFFILIATE COMMISSIONS
  ========================= */
  affiliateCommissions: defineTable({
    affiliateId: v.string(),
    orderId: v.optional(v.string()),
    orderAmount: v.number(),
    commissionPercent: v.number(),
    commissionAmount: v.number(),
    status: v.string(),
    createdAt: v.number(),
  }).index("by_affiliateId", ["affiliateId"]),

  /* =========================
     AFFILIATES
  ========================= */
  affiliates: defineTable({
    code: v.string(),
    ownerTelegramUserId: v.string(),
    createdAt: v.number(),
    status: AffiliateStatus,
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
    .index("by_referred_and_code", ["referredTelegramUserId", "code"])
    .index("by_code_referredTelegramUserId", ["code", "referredTelegramUserId"]),
});
