// convex/phoneActions.ts
// Customer mini app phone actions and exchange request submission.
// No admin auth required — called directly by the customer app.

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const toStartSlug = (value: string, maxLength = 48): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLength);

const toHumanStartText = (value: string): string =>
  value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const buildProductLabel = (
  product: { phoneType?: string | null; storage?: string | null } | null,
  fallback?: string | null,
): string | null => {
  const fromProduct = [product?.phoneType, product?.storage]
    .filter((part) => typeof part === "string" && part.trim())
    .join(" ")
    .trim();

  if (fromProduct) return fromProduct;

  const rawFallback = typeof fallback === "string" ? fallback.trim() : "";
  if (!rawFallback) return null;

  return toHumanStartText(rawFallback);
};

/**
 * Create a phone action record (inquiry, exchange, call, map).
 * Called by customer mini app to track user interactions.
 */
export const createPhoneActionRequest = mutation({
  args: {
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
    timestamp: v.optional(v.number()),
    // Legacy fields kept optional for backward compatibility.
    phoneId: v.optional(v.string()),
    variantId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sourceProductId = args.sourceProductId ?? args.phoneId;
    const id = await ctx.db.insert("phoneActions", {
      sessionId: args.sessionId,
      actionType: args.actionType,
      sourceTab: args.sourceTab,
      sourceProductId: sourceProductId ?? undefined,
      timestamp: args.timestamp ?? Date.now(),
      phoneId: args.phoneId ?? sourceProductId ?? undefined,
      variantId: args.variantId ?? undefined,
      createdAt: Date.now(),
    });
    return id;
  },
});

/**
 * Create an exchange request from the customer mini app.
 * Stores raw customer submission (brand name, storage, condition, notes).
 * Returns the leadId for the customer to include in Telegram deep link.
 */
export const createExchangeRequestMiniapp = mutation({
  args: {
    sessionId: v.string(),
    desiredPhoneId: v.string(),
    offeredModel: v.string(),
    offeredStorageGb: v.number(),
    offeredCondition: v.string(),
    offeredNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("exchangeRequests", {
      sessionId: args.sessionId,
      desiredPhoneId: args.desiredPhoneId,
      offeredModel: args.offeredModel,
      offeredStorageGb: args.offeredStorageGb,
      offeredCondition: args.offeredCondition,
      offeredNotes: args.offeredNotes ?? "",
      status: "new",
      createdAt: Date.now(),
    });
    return id;
  },
});

/**
 * Query exchange requests by session.
 * Called by customer app useExchangeRequests hook.
 */
export const getExchangeRequestsV2 = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("exchangeRequests")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .collect();
  },
});

/**
 * Get exchange request detail.
 * Called by customer app useExchangeDetail hook.
 * Returns { request, images } shape for compatibility.
 * No authorization — exchangeRequests are customer submissions identified by ID.
 */
export const getExchangeDetailV2 = query({
  args: {
    requestId: v.id("exchangeRequests"),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.requestId);
    if (!doc) return {};

    // Verify ownership if sessionId provided
    if (args.sessionId && doc.sessionId !== args.sessionId) return {};

    return {
      request: doc,
      images: [],
    };
  },
});

/**
 * Build a Telegram deep link with compact start payload so the bot knows
 * what customer action triggered the handoff from the mini app.
 */
export const getTelegramStartLink = query({
  args: {
    actionType: v.union(
      v.literal("buy"),
      v.literal("ask"),
      v.literal("photo"),
      v.literal("exchange"),
    ),
    productId: v.optional(v.id("products")),
    exchangeRequestId: v.optional(v.id("exchangeRequests")),
  },
  handler: async (ctx, args) => {
    const settings = (await ctx.db.query("adminSettings").collect())[0] ?? null;
    const botLink = settings?.telegramBotLink?.trim();
    if (!botLink) return null;

    let startPayload = "start";

    if (args.exchangeRequestId) {
      startPayload = `lead_${args.exchangeRequestId}`;
    } else if (args.productId) {
      const product = await ctx.db.get(args.productId);
      if (!product) return null;
      const productLabel = [product.phoneType, product.storage].filter(Boolean).join(" ");
      const slug = toStartSlug(productLabel || "product");
      startPayload = `${args.actionType}_${slug}`;
    } else if (args.actionType === "exchange") {
      startPayload = "exchange";
    }

    const separator = botLink.includes("?") ? "&" : "?";
    return {
      botLink,
      startPayload,
      deepLink: `${botLink}${separator}start=${startPayload}`,
    };
  },
});

/**
 * Resolve Telegram /start payloads into durable business context.
 * Used by the bot workflow to safely handle both current payloads and
 * legacy customer-app payloads like lead_<phoneActionId>.
 */
export const resolveTelegramStartContext = query({
  args: {
    payload: v.string(),
  },
  handler: async (ctx, args) => {
    const payload = String(args.payload || "").trim();
    if (!payload) return null;

    const parts = payload.split("_").filter(Boolean);
    if (parts.length === 0) return null;

    let action = parts[0].toLowerCase();
    let restParts = parts.slice(1);
    if (action === "ctx" && restParts.length > 0) {
      action = restParts[0].toLowerCase();
      restParts = restParts.slice(1);
    }

    const rawValue = restParts.join("_");

    if (action === "item" && rawValue) {
      const modelHint = toHumanStartText(rawValue);
      return {
        resolvedType: "product",
        source: "legacy_item_payload",
        action: "ask",
        contextType: "product_interest",
        analysisText: modelHint || "/start",
        modelHint: modelHint || null,
        product: {
          id: null,
          label: modelHint || null,
        },
        exchangeLead: null,
      };
    }

    if (action !== "lead" || !rawValue) return null;

    try {
      const exchangeRequest = await ctx.db.get(rawValue as any);
      if (
        exchangeRequest &&
        typeof exchangeRequest === "object" &&
        "desiredPhoneId" in exchangeRequest &&
        "offeredModel" in exchangeRequest
      ) {
        let desiredPhone: {
          id: string;
          label: string | null;
        } | null = null;

        try {
          const product = await ctx.db.get((exchangeRequest as any).desiredPhoneId as any);
          const label = buildProductLabel(product as any, (exchangeRequest as any).desiredPhoneId);
          desiredPhone = {
            id: String((exchangeRequest as any).desiredPhoneId || ""),
            label,
          };
        } catch {
          desiredPhone = {
            id: String((exchangeRequest as any).desiredPhoneId || ""),
            label: buildProductLabel(null, (exchangeRequest as any).desiredPhoneId),
          };
        }

        return {
          resolvedType: "exchange",
          source: "exchangeRequests",
          action: "exchange",
          contextType: "exchange_lead",
          analysisText: "exchange lead",
          modelHint: desiredPhone?.label ?? null,
          product: desiredPhone,
          exchangeLead: {
            leadId: String((exchangeRequest as any)._id || rawValue),
            sessionId: String((exchangeRequest as any).sessionId || ""),
            desiredPhoneId: String((exchangeRequest as any).desiredPhoneId || ""),
            desiredPhoneLabel: desiredPhone?.label ?? null,
            offeredModel: String((exchangeRequest as any).offeredModel || ""),
            offeredStorageGb: Number((exchangeRequest as any).offeredStorageGb || 0),
            offeredCondition: String((exchangeRequest as any).offeredCondition || ""),
            offeredNotes: String((exchangeRequest as any).offeredNotes || ""),
            createdAt: Number((exchangeRequest as any).createdAt || 0),
          },
        };
      }
    } catch {
      // rawValue may not be an exchangeRequests id
    }

    try {
      const phoneAction = await ctx.db.get(rawValue as any);
      if (
        phoneAction &&
        typeof phoneAction === "object" &&
        "actionType" in phoneAction &&
        "sourceTab" in phoneAction
      ) {
        const sourceProductId =
          typeof (phoneAction as any).sourceProductId === "string" &&
          (phoneAction as any).sourceProductId.trim()
            ? (phoneAction as any).sourceProductId.trim()
            : typeof (phoneAction as any).phoneId === "string" &&
                (phoneAction as any).phoneId.trim()
              ? (phoneAction as any).phoneId.trim()
              : null;

        let productDoc: any = null;
        if (sourceProductId) {
          try {
            productDoc = await ctx.db.get(sourceProductId as any);
          } catch {
            productDoc = null;
          }
        }

        const productLabel = buildProductLabel(productDoc, sourceProductId);
        const actionType = String((phoneAction as any).actionType || "inquiry").toLowerCase();
        const resolvedAction = actionType === "exchange" ? "exchange" : "ask";
        const resolvedType = resolvedAction === "exchange" ? "exchange" : "product";
        const contextType =
          resolvedAction === "exchange" ? "exchange" : "product_interest";
        const analysisText =
          resolvedAction === "exchange"
            ? "exchange"
            : productLabel || "/start";

        return {
          resolvedType,
          source: "phoneActions",
          action: resolvedAction,
          contextType,
          analysisText,
          modelHint: resolvedAction === "exchange" ? null : productLabel,
          product: {
            id: sourceProductId,
            label: productLabel,
          },
          exchangeLead: null,
          phoneAction: {
            id: String((phoneAction as any)._id || rawValue),
            actionType,
            sourceTab: String((phoneAction as any).sourceTab || ""),
          },
        };
      }
    } catch {
      // rawValue may not be a phoneActions id
    }

    return {
      resolvedType: "unknown",
      source: "unknown_lead",
      action: "lead",
      contextType: "lead_reference",
      analysisText: "/start",
      modelHint: null,
      product: null,
      exchangeLead: null,
    };
  },
});
