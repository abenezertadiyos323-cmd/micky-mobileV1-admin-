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

const StorageOption = v.union(
  v.literal("32GB"),
  v.literal("64GB"),
  v.literal("128GB"),
  v.literal("256GB"),
  v.literal("512GB"),
  v.literal("1TB")
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

// Backward compatibility: legacy products stored images as { storageId, order }.
// New products store direct URL strings.
const ProductImage = v.union(
  v.string(),
  v.object({
    storageId: v.id("_storage"),
    order: v.number(),
  }),
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
    storageOptions: v.optional(v.array(StorageOption)),
    condition: v.optional(Condition),

    price: v.number(),
    stockQuantity: v.number(),
    lowStockThreshold: v.optional(v.number()),

    exchangeEnabled: v.boolean(),
    description: v.optional(v.string()),

    // New shape: string[] URLs.
    // Legacy shape ({ storageId, order }) remains valid for existing products.
    images: v.array(ProductImage),

    isArchived: v.boolean(),
    archivedAt: v.optional(v.number()),

    createdAt: v.number(),
    createdBy: v.string(),
    updatedAt: v.number(),
    updatedBy: v.string(),
    sellerId: v.string(),

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

    // Additional phone specifications (optional)
    screenSize: v.optional(v.string()),
    battery: v.optional(v.string()),
    mainCamera: v.optional(v.string()),
    selfieCamera: v.optional(v.string()),
    simType: v.optional(v.string()),
    color: v.optional(v.string()),
    operatingSystem: v.optional(v.string()),
    features: v.optional(v.string()),
  })
    .index("by_type", ["type"])
    .index("by_type_searchNormalized", ["type", "searchNormalized"])
    .searchIndex("search_products", {
      searchField: "searchNormalized",
      filterFields: ["isArchived"],
    })
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
  sessions: defineTable(v.any()).index("by_customer_chat", ["customer_id", "chat_id"]),

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

  /* =========================
     PHONE ACTIONS
  ========================= */
  phoneActions: defineTable({
    sessionId: v.string(),
    actionType: v.union(
      v.literal("inquiry"),
      v.literal("exchange"),
      v.literal("call"),
      v.literal("map"),
    ),
    sourceTab: v.union(
      v.literal("home"),
      v.literal("search"),
      v.literal("saved"),
      v.literal("product_detail"),
      v.literal("about"),
    ),
    sourceProductId: v.optional(v.string()),
    timestamp: v.number(),
    phoneId: v.optional(v.string()),
    variantId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_actionType", ["actionType"])
    .index("by_createdAt", ["createdAt"]),

  /* =========================
     EXCHANGE REQUESTS
  ========================= */
  exchangeRequests: defineTable({
    sessionId: v.string(),
    desiredPhoneId: v.string(),
    offeredModel: v.string(),
    offeredStorageGb: v.number(),
    offeredCondition: v.string(),
    offeredNotes: v.optional(v.string()),
    status: v.string(),
    createdAt: v.number(),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_status", ["status"])
    .index("by_createdAt", ["createdAt"]),

  /* =========================
     N8N BOT WORKFLOW SESSIONS
  ========================= */
  botWorkflowSessions: defineTable({
    sellerId: v.string(),
    chatId: v.string(),
    stage: v.string(),
    activeFlow: v.string(),
    followupRound: v.number(),
    collectedFields: v.any(),
    shownOptions: v.optional(v.any()),
    language: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_chatId", ["chatId"])
    .index("by_sellerId_and_chatId", ["sellerId", "chatId"]),

  /* =========================
     N8N BOT LEADS
  ========================= */
  botLeads: defineTable({
    sellerId: v.string(),
    chatId: v.string(),
    username: v.optional(v.string()),
    name: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    customer_goal: v.optional(v.string()),
    phoneType: v.optional(v.string()),
    source: v.optional(v.string()),
    stage: v.optional(v.string()),
    summary: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_sellerId_and_chatId", ["sellerId", "chatId"])
    .index("by_updatedAt", ["updatedAt"]),

  /* =========================
     N8N ORDER INQUIRIES
  ========================= */
  botOrderInquiries: defineTable({
    sellerId: v.string(),
    chatId: v.string(),
    username: v.optional(v.string()),
    phoneType: v.optional(v.string()),
    selected_option: v.optional(v.string()),
    inquiry_type: v.optional(v.string()),
    summary: v.optional(v.string()),
    createdAt: v.string(),
  })
    .index("by_sellerId_and_chatId", ["sellerId", "chatId"])
    .index("by_createdAt", ["createdAt"]),

  /* =========================
     N8N EXCHANGE SUBMISSIONS
  ========================= */
  botExchangeSubmissions: defineTable({
    sellerId: v.string(),
    chatId: v.string(),
    username: v.optional(v.string()),
    phoneType: v.optional(v.string()),
    storage: v.optional(v.string()),
    ram: v.optional(v.string()),
    simType: v.optional(v.string()),
    battery: v.optional(v.string()),
    condition: v.optional(v.string()),
    defects: v.optional(v.string()),
    target_phone: v.optional(v.string()),
    stage: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_sellerId_and_chatId", ["sellerId", "chatId"])
    .index("by_updatedAt", ["updatedAt"]),

  /* =========================
     N8N ADMIN INBOX RECORDS
  ========================= */
  botInboxRecords: defineTable({
    sellerId: v.string(),
    chatId: v.string(),
    username: v.optional(v.string()),
    name: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    customer_goal: v.optional(v.string()),
    phoneType: v.optional(v.string()),
    target_phone: v.optional(v.string()),
    summary: v.optional(v.string()),
    stage: v.optional(v.string()),
    priority: v.optional(v.string()),
    tab: v.optional(v.string()),
    source: v.optional(v.string()),
    status: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_sellerId_and_chatId", ["sellerId", "chatId"])
    .index("by_status_and_updatedAt", ["status", "updatedAt"]),

  /* =========================
     N8N NOTIFY INTENTS
  ========================= */
  botNotifyRequests: defineTable({
    sellerId: v.string(),
    chatId: v.string(),
    username: v.optional(v.string()),
    requested_phone: v.string(),
    notify_when_available: v.boolean(),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_requested_phone", ["requested_phone"])
    .index("by_sellerId_chatId_requested_phone", [
      "sellerId",
      "chatId",
      "requested_phone",
    ]),

  /* =========================
     ADMIN SETTINGS
  ========================= */
  adminSettings: defineTable({
    storeName: v.optional(v.string()),
    supportContact: v.optional(v.string()),
    telegramBotLink: v.optional(v.string()),
    phoneLowStockThreshold: v.optional(v.number()),
    accessoryLowStockThreshold: v.optional(v.number()),
    exchangeAlertsEnabled: v.optional(v.boolean()),
    inboxAlertsEnabled: v.optional(v.boolean()),
    storeAddress: v.optional(v.string()),
    storeLocationLink: v.optional(v.string()),
    warrantyPolicy: v.optional(v.string()),
    exchangeRules: v.optional(v.string()),
    updatedAt: v.number(),
  }),

  /* =========================
     BOT THREADS
     Durable bot-only per-chat state for the Telegram sales workflow.
  ========================= */
  botThreads: defineTable({
    chatId: v.string(),
    telegramUserId: v.string(),
    username: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastMessageAt: v.number(),
    firstMessageAt: v.number(),
    messageCount: v.number(),
    recentMessages: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
        timestamp: v.number(),
      }),
    ),
    intake: v.optional(
      v.object({
        flow: v.union(v.literal("sell"), v.literal("exchange")),
        status: v.union(
          v.literal("start"),
          v.literal("in_progress"),
          v.literal("complete"),
        ),
        data: v.object({
          offered_model: v.optional(v.string()),
          offered_storage: v.optional(v.string()),
          offered_condition: v.optional(
            v.union(
              v.literal("new"),
              v.literal("good"),
              v.literal("fair"),
              v.literal("poor"),
            ),
          ),
          asking_price: v.optional(v.number()),
          desired_product_id: v.optional(v.string()),
          desired_product_name: v.optional(v.string()),
          customer_notes: v.optional(v.string()),
        }),
        last_updated_at: v.number(),
        write_key: v.string(),
      }),
    ),
  }).index("by_chatId", ["chatId"]),
});
