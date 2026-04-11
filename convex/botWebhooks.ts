import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const logMessage = internalMutation({
    args: {
        telegramId: v.string(),
        customerFirstName: v.string(),
        customerUsername: v.optional(v.string()), // Optional in schema
        userMessage: v.string(),
        aiReply: v.string(),
        telegramMessageId: v.optional(v.string()), // Optional in schema
    },
    handler: async (ctx, args) => {
        let thread = await ctx.db
            .query("threads")
            .withIndex("by_telegramId", (q) => q.eq("telegramId", args.telegramId))
            .first();

        const now = Date.now();
        let threadId;

        if (!thread) {
            // Create new thread directly into real schema
            threadId = await ctx.db.insert("threads", {
                telegramId: args.telegramId,
                customerFirstName: args.customerFirstName,
                customerUsername: args.customerUsername,
                status: "new",
                unreadCount: 1, // Rule locked: new thread = 1
                lastMessageAt: now,
                lastCustomerMessageAt: now,
                firstMessageAt: now,
                hasCustomerMessaged: true,
                hasAdminReplied: true,
                lastCustomerMessageHasBudgetKeyword: false,
                createdAt: now,
                updatedAt: now,
            });
        } else {
            threadId = thread._id;
            // Rule locked: existing thread = unreadCount + 1
            await ctx.db.patch(threadId, {
                lastMessageAt: now,
                lastCustomerMessageAt: now,
                hasCustomerMessaged: true,
                hasAdminReplied: true, // Natively supported by schema
                status: "new",
                unreadCount: thread.unreadCount + 1,
                updatedAt: now,
            });
        }

        // Insert user message
        await ctx.db.insert("messages", {
            threadId,
            sender: "customer",
            senderTelegramId: args.telegramId,
            text: args.userMessage,
            telegramMessageId: args.telegramMessageId,
            createdAt: now,
        });

        // Insert bot reply
        await ctx.db.insert("messages", {
            threadId,
            sender: "admin",
            senderRole: "bot",     // Schema specifically allows v.literal("bot") here
            senderTelegramId: "bot",
            text: args.aiReply,
            createdAt: now + 1,    // Sequential guarantee
        });

        return { threadId };
    },
});

export const trackDemand = internalMutation({
    args: {
        telegramId: v.string(),
        threadId: v.id("threads"),
        phoneType: v.string(),
        source: v.literal("bot"), // Schema locked: MUST be "bot".
        meta: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        // Write analytics directly
        await ctx.db.insert("demand_events", {
            source: args.source,
            phoneType: args.phoneType,
            createdAt: Date.now(),
            userId: args.telegramId,
            threadId: args.threadId,
            meta: args.meta,
        });

        // Explicitly flag thread for admin
        await ctx.db.patch(args.threadId, { status: "new" });
        return { success: true };
    },
});

export const createExchange = internalMutation({
    args: {
        telegramId: v.string(),
        threadId: v.id("threads"),
        desiredPhoneModel: v.string(),
        tradeInBrand: v.string(),
        tradeInModel: v.string(),
        tradeInStorage: v.string(),
        tradeInCondition: v.union(
            v.literal("New"),
            v.literal("Like New"),
            v.literal("Excellent"),
            v.literal("Good"),
            v.literal("Fair"),
            v.literal("Poor")
        ), // Restricted precisely to schema enum
    },
    handler: async (ctx, args) => {
        // 100% compliant search query format for finding desired product
        const desiredPhone = await ctx.db
            .query("products")
            .withSearchIndex("search_products", (q) =>
                q.search("searchNormalized", args.desiredPhoneModel.toLowerCase())
            )
            .first();

        if (!desiredPhone) {
            throw new Error(`Could not definitively resolve desired phone: ${args.desiredPhoneModel}`);
        }

        const exchangeId = await ctx.db.insert("exchanges", {
            telegramId: args.telegramId,
            threadId: args.threadId,
            desiredPhoneId: desiredPhone._id,
            tradeInBrand: args.tradeInBrand,
            tradeInModel: args.tradeInModel,
            tradeInStorage: args.tradeInStorage,
            tradeInRam: "Unknown", // Required string. AI does not extract ram, assuming Unknown.
            tradeInCondition: args.tradeInCondition,
            budgetMentionedInSubmission: false, // Required boolean
            desiredPhonePrice: desiredPhone.price,
            calculatedTradeInValue: 0, // Required number
            calculatedDifference: 0, // Required number
            finalTradeInValue: 0,   // Required number
            finalDifference: 0,     // Required number
            priorityValueETB: 0,    // Required number
            status: "Pending",      // Literal defined in ExchangeStatus
            clickedContinue: false, // Required boolean
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });

        await ctx.db.patch(args.threadId, { status: "new" });
        return { exchangeId };
    },
});
