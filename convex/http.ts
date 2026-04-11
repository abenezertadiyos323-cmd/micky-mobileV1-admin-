import { httpRouter } from "convex/server";
import { httpAction, internalMutation, internalQuery } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";

declare const process: {
  env: Record<string, string | undefined>;
};

const http = httpRouter();
const internalApi = internal as any;

const verifyAuth = (req: Request) => {
  const authHeader = req.headers.get("Authorization");
  if (!process.env.BOT_CONVEX_SECRET) {
    throw new Error("Server Misconfiguration: BOT_CONVEX_SECRET is not set");
  }
  if (authHeader !== `Bearer ${process.env.BOT_CONVEX_SECRET}`) {
    throw new Error("Unauthorized");
  }
};

const withAuth = (
  handler: Parameters<typeof httpAction>[0],
) =>
  httpAction(async (ctx, req) => {
    try {
      verifyAuth(req);
      return await handler(ctx, req);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown HTTP action error";
      const status = message === "Unauthorized" ? 401 : 400;
      return Response.json({ ok: false, error: message }, { status });
    }
  });

const toOptionalString = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
};

const toRequiredString = (value: unknown, fieldName: string): string => {
  const normalized = toOptionalString(value);
  if (!normalized) {
    throw new Error(`Missing required field: ${fieldName}`);
  }
  return normalized;
};

const toIsoString = (value: unknown, fallback = new Date().toISOString()) =>
  toOptionalString(value) ?? fallback;

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // Keep bot-compatible HTTP routes tolerant of malformed bodies.
  }

  return {};
}

const normalizeCompare = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const matchesOptionalField = (actual: unknown, expected: unknown) => {
  const expectedValue = normalizeCompare(expected);
  if (!expectedValue) return true;
  return normalizeCompare(actual) === expectedValue;
};

export const saveLeadRecord = internalMutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("botLeads")
      .withIndex("by_sellerId_and_chatId", (q) =>
        q.eq("sellerId", args.sellerId).eq("chatId", args.chatId),
      )
      .first();

    const payload = {
      sellerId: args.sellerId,
      chatId: args.chatId,
      username: args.username,
      name: args.name,
      phoneNumber: args.phoneNumber,
      customer_goal: args.customer_goal,
      phoneType: args.phoneType,
      source: args.source,
      stage: args.stage,
      summary: args.summary,
      createdAt: existing?.createdAt ?? args.createdAt,
      updatedAt: args.updatedAt,
    };

    return existing
      ? (await ctx.db.patch(existing._id, payload), existing._id)
      : await ctx.db.insert("botLeads", payload);
  },
});

export const getWorkflowSessionRecord = internalQuery({
  args: {
    sellerId: v.string(),
    chatId: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("botWorkflowSessions")
      .withIndex("by_sellerId_and_chatId", (q) =>
        q.eq("sellerId", args.sellerId).eq("chatId", args.chatId),
      )
      .first();

    return session
      ? {
          stage: session.stage,
          activeFlow: session.activeFlow,
          followupRound: session.followupRound,
          collectedFields: session.collectedFields ?? {},
          shownOptions: session.shownOptions ?? null,
          language: session.language,
          updatedAt: session.updatedAt,
        }
      : null;
  },
});

export const upsertWorkflowSessionRecord = internalMutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("botWorkflowSessions")
      .withIndex("by_sellerId_and_chatId", (q) =>
        q.eq("sellerId", args.sellerId).eq("chatId", args.chatId),
      )
      .first();

    const payload = {
      sellerId: args.sellerId,
      chatId: args.chatId,
      stage: args.stage,
      activeFlow: args.activeFlow,
      followupRound: args.followupRound,
      collectedFields: args.collectedFields,
      shownOptions: args.shownOptions,
      language: args.language,
      createdAt: existing?.createdAt ?? args.createdAt,
      updatedAt: args.updatedAt,
    };

    const sessionId = existing
      ? (await ctx.db.patch(existing._id, payload), existing._id)
      : await ctx.db.insert("botWorkflowSessions", payload);

    return {
      sessionId,
      session: {
        stage: payload.stage,
        activeFlow: payload.activeFlow,
        followupRound: payload.followupRound,
        collectedFields: payload.collectedFields,
        shownOptions: payload.shownOptions ?? null,
        language: payload.language,
        updatedAt: payload.updatedAt,
      },
    };
  },
});

export const saveOrderInquiryRecord = internalMutation({
  args: {
    sellerId: v.string(),
    chatId: v.string(),
    username: v.optional(v.string()),
    phoneType: v.optional(v.string()),
    selected_option: v.optional(v.string()),
    inquiry_type: v.optional(v.string()),
    summary: v.optional(v.string()),
    createdAt: v.string(),
  },
  handler: async (ctx, args) =>
    await ctx.db.insert("botOrderInquiries", {
      sellerId: args.sellerId,
      chatId: args.chatId,
      username: args.username,
      phoneType: args.phoneType,
      selected_option: args.selected_option,
      inquiry_type: args.inquiry_type,
      summary: args.summary,
      createdAt: args.createdAt,
    }),
});

export const saveExchangeSubmissionRecord = internalMutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("botExchangeSubmissions")
      .withIndex("by_sellerId_and_chatId", (q) =>
        q.eq("sellerId", args.sellerId).eq("chatId", args.chatId),
      )
      .first();

    const payload = {
      sellerId: args.sellerId,
      chatId: args.chatId,
      username: args.username,
      phoneType: args.phoneType,
      storage: args.storage,
      ram: args.ram,
      simType: args.simType,
      battery: args.battery,
      condition: args.condition,
      defects: args.defects,
      target_phone: args.target_phone,
      stage: args.stage,
      createdAt: existing?.createdAt ?? args.createdAt,
      updatedAt: args.updatedAt,
    };

    return existing
      ? (await ctx.db.patch(existing._id, payload), existing._id)
      : await ctx.db.insert("botExchangeSubmissions", payload);
  },
});

export const saveInboxRecord = internalMutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("botInboxRecords")
      .withIndex("by_sellerId_and_chatId", (q) =>
        q.eq("sellerId", args.sellerId).eq("chatId", args.chatId),
      )
      .first();

    const payload = {
      sellerId: args.sellerId,
      chatId: args.chatId,
      username: args.username,
      name: args.name,
      phoneNumber: args.phoneNumber,
      customer_goal: args.customer_goal,
      phoneType: args.phoneType,
      target_phone: args.target_phone,
      summary: args.summary,
      stage: args.stage,
      priority: args.priority,
      tab: args.tab,
      source: args.source,
      status: args.status,
      createdAt: existing?.createdAt ?? args.createdAt,
      updatedAt: args.updatedAt,
    };

    return existing
      ? (await ctx.db.patch(existing._id, payload), existing._id)
      : await ctx.db.insert("botInboxRecords", payload);
  },
});

export const saveNotifyRequestRecord = internalMutation({
  args: {
    sellerId: v.string(),
    chatId: v.string(),
    username: v.optional(v.string()),
    requested_phone: v.string(),
    notify_when_available: v.boolean(),
    createdAt: v.string(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("botNotifyRequests")
      .withIndex("by_sellerId_chatId_requested_phone", (q) =>
        q
          .eq("sellerId", args.sellerId)
          .eq("chatId", args.chatId)
          .eq("requested_phone", args.requested_phone),
      )
      .first();

    const payload = {
      sellerId: args.sellerId,
      chatId: args.chatId,
      username: args.username,
      requested_phone: args.requested_phone,
      notify_when_available: args.notify_when_available,
      createdAt: existing?.createdAt ?? args.createdAt,
      updatedAt: args.updatedAt,
    };

    return existing
      ? (await ctx.db.patch(existing._id, payload), existing._id)
      : await ctx.db.insert("botNotifyRequests", payload);
  },
});

http.route({
  path: "/api/bot/log-message",
  method: "POST",
  handler: withAuth(async (ctx, req) => {
    const args = await req.json();
    const result = await ctx.runMutation(internal.botWebhooks.logMessage, args);
    return Response.json({ success: true, data: result, error: null });
  }),
});

http.route({
  path: "/api/bot/track-demand",
  method: "POST",
  handler: withAuth(async (ctx, req) => {
    const args = await req.json();
    const result = await ctx.runMutation(internal.botWebhooks.trackDemand, args);
    return Response.json({ success: true, data: result, error: null });
  }),
});

http.route({
  path: "/api/bot/create-exchange",
  method: "POST",
  handler: withAuth(async (ctx, req) => {
    const args = await req.json();
    const result = await ctx.runMutation(
      internal.botWebhooks.createExchange,
      args,
    );
    return Response.json({ success: true, data: result, error: null });
  }),
});

http.route({
  path: "/api/leads/save",
  method: "POST",
  handler: withAuth(async (ctx, req) => {
    const body = await req.json();
    const now = new Date().toISOString();
    const leadId = await ctx.runMutation(internalApi.http.saveLeadRecord, {
      sellerId: toRequiredString(body.sellerId, "sellerId"),
      chatId: toRequiredString(body.chatId, "chatId"),
      username: toOptionalString(body.username),
      name: toOptionalString(body.name),
      phoneNumber: toOptionalString(body.phoneNumber),
      customer_goal: toOptionalString(body.customer_goal),
      phoneType: toOptionalString(body.phoneType),
      source: toOptionalString(body.source),
      stage: toOptionalString(body.stage),
      summary: toOptionalString(body.summary),
      createdAt: toIsoString(body.createdAt, now),
      updatedAt: toIsoString(body.updatedAt ?? body.createdAt, now),
    });

    return Response.json({ ok: true, leadId });
  }),
});

http.route({
  path: "/api/sessions/get",
  method: "POST",
  handler: withAuth(async (ctx, req) => {
    const body = await req.json();
    const session = await ctx.runQuery(
      internalApi.http.getWorkflowSessionRecord,
      {
        sellerId: toRequiredString(body.sellerId, "sellerId"),
        chatId: toRequiredString(body.chatId, "chatId"),
      },
    );

    return Response.json({ session });
  }),
});

http.route({
  path: "/api/sessions/upsert",
  method: "POST",
  handler: withAuth(async (ctx, req) => {
    const body = await req.json();
    const now = new Date().toISOString();
    const result = await ctx.runMutation(
      internalApi.http.upsertWorkflowSessionRecord,
      {
        sellerId: toRequiredString(body.sellerId, "sellerId"),
        chatId: toRequiredString(body.chatId, "chatId"),
        stage: toOptionalString(body.stage) ?? "new",
        activeFlow: toOptionalString(body.activeFlow) ?? "none",
        followupRound:
          typeof body.followupRound === "number"
            ? body.followupRound
            : Number(body.followupRound ?? 0) || 0,
        collectedFields:
          body.collectedFields && typeof body.collectedFields === "object"
            ? body.collectedFields
            : {},
        shownOptions:
          body.shownOptions && typeof body.shownOptions === "object"
            ? body.shownOptions
            : undefined,
        language: toOptionalString(body.language) ?? "amharic",
        createdAt: toIsoString(body.createdAt, now),
        updatedAt: toIsoString(body.updatedAt, now),
      },
    );

    return Response.json({ ok: true, ...result });
  }),
});

http.route({
  path: "/api/orders/save",
  method: "POST",
  handler: withAuth(async (ctx, req) => {
    const body = await req.json();
    const recordId = await ctx.runMutation(
      internalApi.http.saveOrderInquiryRecord,
      {
      sellerId: toRequiredString(body.sellerId, "sellerId"),
      chatId: toRequiredString(body.chatId, "chatId"),
      username: toOptionalString(body.username),
      phoneType: toOptionalString(body.phoneType),
      selected_option: toOptionalString(body.selected_option),
      inquiry_type: toOptionalString(body.inquiry_type),
      summary: toOptionalString(body.summary),
      createdAt: toIsoString(body.createdAt),
      },
    );

    return Response.json({ ok: true, orderInquiryId: recordId });
  }),
});

http.route({
  path: "/api/products/search",
  method: "POST",
  handler: withAuth(async (ctx, req) => {
    const body = await req.json();
    const phoneType = toRequiredString(body.phoneType, "phoneType");

    let products = await ctx.runQuery(api.products.listProducts, {
      search: phoneType,
      tab: "all",
      type: "phone",
    });

    const normalizedPhoneType = normalizeCompare(phoneType);
    const directMatches = products.filter(
      (product) => normalizeCompare(product.phoneType) === normalizedPhoneType,
    );
    if (directMatches.length > 0) {
      products = directMatches;
    }

    products = products.filter(
      (product) =>
        matchesOptionalField(product.storage, body.storage) &&
        matchesOptionalField(product.ram, body.ram) &&
        matchesOptionalField(product.simType, body.simType) &&
        matchesOptionalField(product.battery, body.battery) &&
        matchesOptionalField(product.condition, body.condition),
    );

    return Response.json({ products });
  }),
});

http.route({
  path: "/http/products-search",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.json();
    const brand = toOptionalString(body.brand);
    const model = toOptionalString(body.model);
    const maxPrice =
      typeof body.maxPrice === "number"
        ? body.maxPrice
        : Number(body.maxPrice ?? undefined);

    const search = [brand, model].filter(Boolean).join(" ").trim() || undefined;

    let products = await ctx.runQuery(api.products.listProducts, {
      tab: "all",
      type: "phone",
      search,
      priceMax: Number.isFinite(maxPrice) ? maxPrice : undefined,
    });

    if (brand) {
      const brandLower = brand.toLowerCase();
      products = products.filter((product) =>
        String(product.brand ?? product.phoneType ?? "")
          .toLowerCase()
          .includes(brandLower),
      );
    }

    if (model) {
      const modelLower = model.toLowerCase();
      products = products.filter((product) =>
        String(product.model ?? product.phoneType ?? "")
          .toLowerCase()
          .includes(modelLower),
      );
    }

    return new Response(JSON.stringify(products.slice(0, 5)), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

http.route({
  path: "/api/exchange/save",
  method: "POST",
  handler: withAuth(async (ctx, req) => {
    const body = await req.json();
    const now = new Date().toISOString();
    const exchangeId = await ctx.runMutation(
      internalApi.http.saveExchangeSubmissionRecord,
      {
        sellerId: toRequiredString(body.sellerId, "sellerId"),
        chatId: toRequiredString(body.chatId, "chatId"),
      username: toOptionalString(body.username),
      phoneType: toOptionalString(body.phoneType),
      storage: toOptionalString(body.storage),
      ram: toOptionalString(body.ram),
      simType: toOptionalString(body.simType),
      battery: toOptionalString(body.battery),
      condition: toOptionalString(body.condition),
      defects: toOptionalString(body.defects),
      target_phone: toOptionalString(body.target_phone),
      stage: toOptionalString(body.stage),
      createdAt: toIsoString(body.createdAt, now),
      updatedAt: toIsoString(body.updatedAt ?? body.createdAt, now),
      },
    );

    return Response.json({ ok: true, exchangeId });
  }),
});

http.route({
  path: "/api/inbox/save",
  method: "POST",
  handler: withAuth(async (ctx, req) => {
    const body = await req.json();
    const now = new Date().toISOString();
    const inboxId = await ctx.runMutation(internalApi.http.saveInboxRecord, {
      sellerId: toRequiredString(body.sellerId, "sellerId"),
      chatId: toRequiredString(body.chatId, "chatId"),
      username: toOptionalString(body.username),
      name: toOptionalString(body.name),
      phoneNumber: toOptionalString(body.phoneNumber),
      customer_goal: toOptionalString(body.customer_goal),
      phoneType: toOptionalString(body.phoneType),
      target_phone: toOptionalString(body.target_phone),
      summary: toOptionalString(body.summary),
      stage: toOptionalString(body.stage),
      priority: toOptionalString(body.priority),
      tab: toOptionalString(body.tab),
      source: toOptionalString(body.source),
      status: toOptionalString(body.status),
      createdAt: toIsoString(body.createdAt, now),
      updatedAt: toIsoString(body.updatedAt ?? body.createdAt, now),
    });

    return Response.json({ ok: true, inboxId });
  }),
});

http.route({
  path: "/api/notify/save",
  method: "POST",
  handler: withAuth(async (ctx, req) => {
    const body = await req.json();
    const now = new Date().toISOString();
    const notifyId = await ctx.runMutation(
      internalApi.http.saveNotifyRequestRecord,
      {
        sellerId: toRequiredString(body.sellerId, "sellerId"),
        chatId: toRequiredString(body.chatId, "chatId"),
      username: toOptionalString(body.username),
      requested_phone: toRequiredString(body.requested_phone, "requested_phone"),
      notify_when_available: Boolean(body.notify_when_available),
      createdAt: toIsoString(body.createdAt, now),
      updatedAt: toIsoString(body.updatedAt ?? body.createdAt, now),
      },
    );

    return Response.json({ ok: true, notifyId });
  }),
});

http.route({
  path: "/http/session-load",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await readJsonBody(req);
    const userId = toOptionalString(body.userId) ?? "";
    const chatId = toOptionalString(body.chatId) ?? "";

    if (!userId || !chatId) {
      return Response.json(
        {
          session: {
            exists: false,
            data: null,
          },
          error: "Missing userId or chatId",
        },
        { status: 400 },
      );
    }

    const storedSession = await ctx.runQuery(internal.sessions.loadByCustomerChat, {
      customerId: userId,
      chatId,
    });

    return Response.json({
      session: {
        exists: Boolean(storedSession),
        data: storedSession,
      },
    });
  }),
});

http.route({
  path: "/http/session-save",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await readJsonBody(req);
    const userId = toOptionalString(body.userId) ?? "";
    const chatId = toOptionalString(body.chatId) ?? "";
    const session =
      body.session && typeof body.session === "object" && !Array.isArray(body.session)
        ? body.session
        : null;

    if (!userId || !chatId || !session) {
      return Response.json(
        {
          ok: false,
          error: "Missing userId, chatId, or session payload",
        },
        { status: 400 },
      );
    }

    const savedSession = await ctx.runMutation(internal.sessions.saveByCustomerChat, {
      customerId: userId,
      chatId,
      session,
    });

    return Response.json({
      ok: true,
      session: {
        exists: true,
        data: savedSession,
      },
    });
  }),
});

export default http;
