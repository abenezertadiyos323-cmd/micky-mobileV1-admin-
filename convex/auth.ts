// convex/auth.ts
// Telegram initData verification for the Customer Mini App.
// Verifies the HMAC-SHA256 signature from Telegram WebApp and upserts a
// `customers` document. Never blocks UI — called fire-and-forget from AppContext.

import { mutation } from "./_generated/server";
import { v } from "convex/values";

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;
const encoder = new TextEncoder();

type TelegramUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
};

function getEnvValue(name: string): string | undefined {
  const runtime = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return runtime.process?.env?.[name];
}

function parseTelegramUser(userRaw: string): TelegramUser {
  let parsed: unknown;
  try {
    parsed = JSON.parse(userRaw);
  } catch {
    throw new Error("Invalid Telegram authentication data");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { id?: unknown }).id !== "number"
  ) {
    throw new Error("Invalid Telegram authentication data");
  }

  return parsed as TelegramUser;
}

function buildDataCheckString(params: URLSearchParams) {
  return [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function hexToBytes(hex: string) {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error("Invalid Telegram authentication data");
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a[i] ^ b[i];
  }
  return mismatch === 0;
}

async function hmacSha256(
  keyInput: string | Uint8Array,
  message: string,
): Promise<Uint8Array> {
  const keyBytes =
    typeof keyInput === "string" ? encoder.encode(keyInput) : keyInput;
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return new Uint8Array(signature);
}

async function verifyInitData(initData: string, botToken: string): Promise<TelegramUser> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const authDateRaw = params.get("auth_date");
  const userRaw = params.get("user");

  if (!hash || !authDateRaw || !userRaw) {
    throw new Error("Invalid Telegram authentication data");
  }

  if (!/^\d+$/.test(authDateRaw)) {
    throw new Error("Invalid Telegram authentication data");
  }
  const authDate = Number(authDateRaw);

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (authDate > nowSeconds + 60) {
    throw new Error("Invalid Telegram authentication data");
  }
  if (nowSeconds - authDate > MAX_AUTH_AGE_SECONDS) {
    throw new Error("Telegram authentication has expired");
  }

  const dataCheckString = buildDataCheckString(params);
  const secretKey = await hmacSha256("WebAppData", botToken);
  const expectedHashBytes = await hmacSha256(secretKey, dataCheckString);
  const providedHashBytes = hexToBytes(hash.toLowerCase());

  if (!timingSafeEqual(expectedHashBytes, providedHashBytes)) {
    throw new Error("Invalid Telegram authentication data");
  }

  return parseTelegramUser(userRaw);
}

/**
 * Background verification for the Customer Mini App.
 * Called fire-and-forget from AppContext after Telegram is detected.
 * Upserts a `customers` record and returns the Convex document ID.
 */
export const verifyTelegramUser = mutation({
  args: {
    initData: v.string(),
  },
  handler: async (ctx, args) => {
    const botToken = getEnvValue("TELEGRAM_BOT_TOKEN");
    if (!botToken) {
      throw new Error("Server configuration missing TELEGRAM_BOT_TOKEN");
    }

    const user = await verifyInitData(args.initData, botToken);
    const now = Date.now();

    const existing = await ctx.db
      .query("customers")
      .withIndex("by_telegramUserId", (q) => q.eq("telegramUserId", user.id))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        updatedAt: now,
      });
      return { ok: true as const, customerId: existing._id };
    }

    const customerId = await ctx.db.insert("customers", {
      telegramUserId: user.id,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      createdAt: now,
      updatedAt: now,
    });

    return { ok: true as const, customerId };
  },
});

/**
 * Explicit Telegram login (called by useAuth.verifyTelegram).
 * Same verification as verifyTelegramUser, with a richer response shape.
 */
export const loginWithTelegram = mutation({
  args: {
    initData: v.string(),
  },
  handler: async (ctx, args) => {
    const botToken = getEnvValue("TELEGRAM_BOT_TOKEN");
    if (!botToken) {
      throw new Error("Server configuration missing TELEGRAM_BOT_TOKEN");
    }

    const user = await verifyInitData(args.initData, botToken);
    const now = Date.now();

    const existing = await ctx.db
      .query("customers")
      .withIndex("by_telegramUserId", (q) => q.eq("telegramUserId", user.id))
      .first();

    let customerId;
    if (existing) {
      customerId = existing._id;
      await ctx.db.patch(existing._id, {
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        photoUrl: user.photo_url,
        updatedAt: now,
      });
    } else {
      customerId = await ctx.db.insert("customers", {
        telegramUserId: user.id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        photoUrl: user.photo_url,
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      ok: true,
      customer: {
        id: customerId,
        telegramUserId: user.id,
        username: user.username ?? null,
        firstName: user.first_name ?? null,
        lastName: user.last_name ?? null,
        photoUrl: user.photo_url ?? null,
      },
    };
  },
});
