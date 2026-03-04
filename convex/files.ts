// convex/files.ts
// Convex Storage helpers — generates pre-signed upload URLs for client-side uploads

import { mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Returns a short-lived upload URL that the browser can POST a file to directly.
 * After uploading, the response JSON contains { storageId }.
 * Resolve that with getStorageUrl, then store the URL in product.images.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Resolve a public URL for a stored file.
 * Used after upload so products can persist image URLs directly.
 */
export const getStorageUrl = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
  },
});
