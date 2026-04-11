// convex/sessions.ts
// Shared session handlers for the customer mini app and the Telegram bot.

import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { v } from "convex/values";

type JsonRecord = Record<string, unknown>;

const MAX_HISTORY = 24;

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: JsonRecord, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function asString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function asNullableString(value: unknown, fallback: string | null) {
  if (value === null) {
    return null;
  }
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNullableNumber(value: unknown, fallback: number | null) {
  if (value === null) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return fallback;
}

function asCount(value: unknown, fallback: number) {
  const normalized = asNumber(value, fallback);
  return Math.max(0, Math.floor(normalized));
}

function toArray(value: unknown, fallback: unknown[] = []) {
  return Array.isArray(value) ? value : fallback;
}

function normalizeAdminEscalation(
  incoming: unknown,
  fallback: { required: boolean; reason: string | null; status: string | null },
) {
  const source = isRecord(incoming) ? incoming : {};
  return {
    required: asBoolean(source.required, fallback.required),
    reason: asNullableString(source.reason, fallback.reason),
    status: asNullableString(source.status, fallback.status),
  };
}

function buildSessionDefaults(customerId: string, now: number) {
  return {
    session_id: `sess_${customerId || "guest"}`,
    customer_id: customerId,
    created_at: now,
    last_message_at: now,
    message_count: 0,
    conversation_state: {
      current_topic: null as string | null,
      current_flow: null as string | null,
      is_active: true,
    },
    flow_context: {
      buy_flow: {
        shown_products: [] as unknown[],
        current_interest: null as unknown,
      },
    },
    collected_constraints: {
      budget_etb: null as number | null,
      brand: null as string | null,
      model: null as string | null,
      storage: null as string | null,
      condition: null as string | null,
    },
    last_asked_key: null as string | null,
    conversation_history: [] as unknown[],
    admin_escalation: {
      required: false,
      reason: null as string | null,
      status: null as string | null,
    },
  };
}

function normalizeStoredSession(source: unknown, customerId: string, now: number) {
  const defaults = buildSessionDefaults(customerId, now);
  const record = isRecord(source) ? source : {};
  const conversationState = isRecord(record.conversation_state)
    ? record.conversation_state
    : {};
  const flowContext = isRecord(record.flow_context) ? record.flow_context : {};
  const buyFlow = isRecord(flowContext.buy_flow) ? flowContext.buy_flow : {};
  const collectedConstraints = isRecord(record.collected_constraints)
    ? record.collected_constraints
    : {};

  return {
    session_id: asString(record.session_id, defaults.session_id),
    customer_id: asString(record.customer_id, customerId || defaults.customer_id),
    created_at: asNumber(record.created_at, defaults.created_at),
    last_message_at: asNumber(record.last_message_at, defaults.last_message_at),
    message_count: asCount(record.message_count, defaults.message_count),
    conversation_state: {
      current_topic: asNullableString(
        conversationState.current_topic,
        defaults.conversation_state.current_topic,
      ),
      current_flow: asNullableString(
        conversationState.current_flow,
        defaults.conversation_state.current_flow,
      ),
      is_active: asBoolean(
        conversationState.is_active,
        defaults.conversation_state.is_active,
      ),
    },
    flow_context: {
      buy_flow: {
        shown_products: toArray(
          buyFlow.shown_products,
          defaults.flow_context.buy_flow.shown_products,
        ),
        current_interest: hasOwn(buyFlow, "current_interest")
          ? buyFlow.current_interest
          : defaults.flow_context.buy_flow.current_interest,
      },
    },
    collected_constraints: {
      budget_etb: hasOwn(collectedConstraints, "budget_etb")
        ? asNullableNumber(
            collectedConstraints.budget_etb,
            defaults.collected_constraints.budget_etb,
          )
        : defaults.collected_constraints.budget_etb,
      brand: hasOwn(collectedConstraints, "brand")
        ? asNullableString(
            collectedConstraints.brand,
            defaults.collected_constraints.brand,
          )
        : defaults.collected_constraints.brand,
      model: hasOwn(collectedConstraints, "model")
        ? asNullableString(
            collectedConstraints.model,
            defaults.collected_constraints.model,
          )
        : defaults.collected_constraints.model,
      storage: hasOwn(collectedConstraints, "storage")
        ? asNullableString(
            collectedConstraints.storage,
            defaults.collected_constraints.storage,
          )
        : defaults.collected_constraints.storage,
      condition: hasOwn(collectedConstraints, "condition")
        ? asNullableString(
            collectedConstraints.condition,
            defaults.collected_constraints.condition,
          )
        : defaults.collected_constraints.condition,
    },
    last_asked_key: asNullableString(
      record.last_asked_key,
      defaults.last_asked_key,
    ),
    conversation_history: toArray(
      record.conversation_history,
      defaults.conversation_history,
    ).slice(-MAX_HISTORY),
    admin_escalation: normalizeAdminEscalation(
      record.admin_escalation,
      defaults.admin_escalation,
    ),
  };
}

function mergeSessionState(existing: unknown, incoming: unknown, customerId: string, now: number) {
  const base = normalizeStoredSession(existing, customerId, now);
  const patch = isRecord(incoming) ? incoming : {};
  const patchState = isRecord(patch.conversation_state) ? patch.conversation_state : {};
  const patchFlowContext = isRecord(patch.flow_context) ? patch.flow_context : {};
  const patchBuyFlow = isRecord(patchFlowContext.buy_flow) ? patchFlowContext.buy_flow : {};
  const patchConstraints = isRecord(patch.collected_constraints)
    ? patch.collected_constraints
    : {};

  const shownProducts = hasOwn(patchBuyFlow, "shown_products")
    ? toArray(patchBuyFlow.shown_products)
    : base.flow_context.buy_flow.shown_products;

  const currentInterest = hasOwn(patchBuyFlow, "current_interest")
    ? patchBuyFlow.current_interest
    : base.flow_context.buy_flow.current_interest;

  return {
    session_id: asString(patch.session_id, base.session_id),
    customer_id: customerId,
    created_at: base.created_at,
    last_message_at: asNumber(patch.last_message_at, now),
    message_count: hasOwn(patch, "message_count")
      ? asCount(patch.message_count, base.message_count)
      : base.message_count,
    conversation_state: {
      current_topic: hasOwn(patchState, "current_topic")
        ? asNullableString(
            patchState.current_topic,
            base.conversation_state.current_topic,
          )
        : base.conversation_state.current_topic,
      current_flow: hasOwn(patchState, "current_flow")
        ? asNullableString(
            patchState.current_flow,
            base.conversation_state.current_flow,
          )
        : base.conversation_state.current_flow,
      is_active: hasOwn(patchState, "is_active")
        ? asBoolean(patchState.is_active, base.conversation_state.is_active)
        : base.conversation_state.is_active,
    },
    flow_context: {
      buy_flow: {
        shown_products: shownProducts,
        current_interest: currentInterest,
      },
    },
    collected_constraints: {
      budget_etb: hasOwn(patchConstraints, "budget_etb")
        ? asNullableNumber(
            patchConstraints.budget_etb,
            base.collected_constraints.budget_etb,
          )
        : base.collected_constraints.budget_etb,
      brand: hasOwn(patchConstraints, "brand")
        ? asNullableString(
            patchConstraints.brand,
            base.collected_constraints.brand,
          )
        : base.collected_constraints.brand,
      model: hasOwn(patchConstraints, "model")
        ? asNullableString(
            patchConstraints.model,
            base.collected_constraints.model,
          )
        : base.collected_constraints.model,
      storage: hasOwn(patchConstraints, "storage")
        ? asNullableString(
            patchConstraints.storage,
            base.collected_constraints.storage,
          )
        : base.collected_constraints.storage,
      condition: hasOwn(patchConstraints, "condition")
        ? asNullableString(
            patchConstraints.condition,
            base.collected_constraints.condition,
          )
        : base.collected_constraints.condition,
    },
    last_asked_key: hasOwn(patch, "last_asked_key")
      ? asNullableString(patch.last_asked_key, base.last_asked_key)
      : base.last_asked_key,
    conversation_history: hasOwn(patch, "conversation_history")
      ? toArray(patch.conversation_history).slice(-MAX_HISTORY)
      : base.conversation_history,
    admin_escalation: hasOwn(patch, "admin_escalation")
      ? normalizeAdminEscalation(
          patch.admin_escalation,
          base.admin_escalation,
        )
      : base.admin_escalation,
  };
}

export const createSession = mutation({
  args: {},
  handler: async (ctx) => {
    const id = await ctx.db.insert("sessions", {
      createdAt: Date.now(),
    });
    return id;
  },
});

export const loadByCustomerChat = internalQuery({
  args: {
    customerId: v.string(),
    chatId: v.string(),
  },
  handler: async (ctx, args) => {
    const sessionDoc = await ctx.db
      .query("sessions")
      .withIndex("by_customer_chat", (q) =>
        q.eq("customer_id", args.customerId).eq("chat_id", args.chatId),
      )
      .unique();

    if (!sessionDoc) {
      return null;
    }

    return {
      session_id: sessionDoc.session_id,
      customer_id: sessionDoc.customer_id,
      created_at: sessionDoc.created_at,
      last_message_at: sessionDoc.last_message_at,
      message_count: sessionDoc.message_count,
      conversation_state: sessionDoc.conversation_state,
      flow_context: sessionDoc.flow_context,
      collected_constraints: sessionDoc.collected_constraints,
      last_asked_key: sessionDoc.last_asked_key,
      conversation_history: sessionDoc.conversation_history,
      admin_escalation: sessionDoc.admin_escalation,
    };
  },
});

export const saveByCustomerChat = internalMutation({
  args: {
    customerId: v.string(),
    chatId: v.string(),
    session: v.any(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existingDoc = await ctx.db
      .query("sessions")
      .withIndex("by_customer_chat", (q) =>
        q.eq("customer_id", args.customerId).eq("chat_id", args.chatId),
      )
      .unique();

    const mergedSession = mergeSessionState(
      existingDoc ?? null,
      args.session,
      args.customerId,
      now,
    );

    const writePayload = {
      customer_id: args.customerId,
      chat_id: args.chatId,
      session_id: mergedSession.session_id,
      created_at: mergedSession.created_at,
      last_message_at: mergedSession.last_message_at,
      message_count: mergedSession.message_count,
      conversation_state: mergedSession.conversation_state,
      flow_context: mergedSession.flow_context,
      collected_constraints: mergedSession.collected_constraints,
      last_asked_key: mergedSession.last_asked_key,
      conversation_history: mergedSession.conversation_history,
      admin_escalation: mergedSession.admin_escalation,
      updated_at: now,
    };

    if (existingDoc) {
      await ctx.db.patch(existingDoc._id, writePayload);
    } else {
      await ctx.db.insert("sessions", writePayload);
    }

    return mergedSession;
  },
});
