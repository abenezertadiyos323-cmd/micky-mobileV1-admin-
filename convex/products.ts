// convex/products.ts
// Products backend — queries and mutations for TedyTech Admin

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// ---- Shared validators (mirrors schema enums) ----

const vProductType = v.union(v.literal("phone"), v.literal("accessory"));

const vCondition = v.union(
  v.literal("New"),
  v.literal("Like New"),
  v.literal("Excellent"),
  v.literal("Good"),
  v.literal("Fair"),
  v.literal("Poor"),
);

type ProductType = "phone" | "accessory";

function normalizeExchangeEnabled(type: ProductType, exchangeEnabled: boolean) {
  return type === "phone" ? exchangeEnabled : false;
}

/**
 * Build a normalized, lowercase search text from the indexable product fields.
 * Used for legacy searchText field. Kept for backward compatibility.
 */
function buildSearchText(p: {
  phoneType?: string;
  storage?: string;
  ram?: string;
  condition?: string;
}): string {
  return [p.phoneType, p.storage, p.ram, p.condition]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build a normalized, lowercase search field for indexed prefix queries.
 * Same normalization as buildSearchText but used for the indexed searchNormalized field.
 * Enables efficient prefix-based searches like "iphone 13" → matches "iPhone 13 256GB Good".
 */
function buildSearchNormalized(p: {
  phoneType?: string;
  storage?: string;
  ram?: string;
  condition?: string;
}): string {
  return [p.phoneType, p.storage, p.ram, p.condition]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Image stored in DB: only storageId + order. url is computed at query time.
const vImageInput = v.object({
  storageId: v.id("_storage"),
  order: v.number(),
});

// ---- Helper: resolve ALL storage URLs (used by getProductById) ----

async function resolveImages(
  ctx: { storage: { getUrl: (id: string) => Promise<string | null> } },
  images: Array<{ storageId: string; order: number }>,
) {
  return Promise.all(
    images.map(async (img) => ({
      storageId: img.storageId,
      order: img.order,
      url: (await ctx.storage.getUrl(img.storageId)) ?? "",
    })),
  );
}

// ---- Helper: resolve ONLY the first image URL (thumbnail, for list view) ----

async function resolveThumbnail(
  ctx: { storage: { getUrl: (id: string) => Promise<string | null> } },
  images: Array<{ storageId: string; order: number }>,
) {
  if (!Array.isArray(images) || images.length === 0) return [];
  const sorted = [...images].sort((a, b) => a.order - b.order);
  let url = "";
  if (sorted[0].storageId && typeof sorted[0].storageId === "string") {
    try {
      url = (await ctx.storage.getUrl(sorted[0].storageId)) ?? "";
    } catch {
      url = "";
    }
  }
  return sorted.map((img, index) => ({
    storageId: img.storageId,
    order: img.order,
    ...(index === 0 ? { url } : {}),
  }));
}

// ================================================================
//  QUERIES
// ================================================================

const LOW_STOCK_THRESHOLD = 5;

/**
 * Public query used by the customer mini app.
 * Returns all non-archived products with thumbnail URLs resolved.
 * Exposes customer-app-compatible field aliases (inStock, is_accessory,
 * exchange_available, main_image_url) so the frontend normalizer works
 * without modification.
 * Always returns [] on any backend error — never throws to the client.
 */
export const listAllProducts = query({
  handler: async (ctx) => {
    try {
      const products = await ctx.db
        .query("products")
        .withIndex("by_isArchived_createdAt", (qb) => qb.eq("isArchived", false))
        .order("desc")
        .collect();

      return Promise.all(
        products.map(async (p) => {
          let main_image_url = "";
          try {
            const images = Array.isArray(p.images) ? p.images : [];
            if (images.length > 0) {
              const sorted = [...images].sort((a, b) => a.order - b.order);
              main_image_url =
                (await ctx.storage.getUrl(sorted[0].storageId)) ?? "";
            }
          } catch {
            // Non-fatal — image URL failure must not drop the entire product
          }

          return {
            ...p,
            // Customer-app field aliases:
            name: p.phoneType ?? "",        // mapToProductVM reads raw.name → brand/model
            main_image_url,                 // resolved thumbnail
            inStock: p.stockQuantity > 0,   // normalizePhone reads raw.inStock
            is_accessory: p.type === "accessory",
            exchange_available: p.exchangeEnabled,
          };
        }),
      );
    } catch {
      return [];
    }
  },
});

type InventoryTab =
  | "all"
  | "in_stock"
  | "low_stock"
  | "out_of_stock"
  | "exchange"
  | "archived";

const normalizeTab = (tab?: string): InventoryTab => {
  switch (tab) {
    case "all":
      return "all";
    case "in_stock":
    case "inStock":
      return "in_stock";
    case "low_stock":
    case "lowStock":
      return "low_stock";
    case "out_of_stock":
    case "outOfStock":
      return "out_of_stock";
    case "exchange":
    case "exchangeEnabled":
      return "exchange";
    case "archived":
      return "archived";
    default:
      return "all";
  }
};

const normalizeType = (type?: string): ProductType | undefined => {
  if (type === "phone" || type === "accessory") {
    return type;
  }
  return undefined;
};

/**
 * List all products with optional filtering.
 * Sorted newest-first using by_isArchived_createdAt index.
 * Resolves URL ONLY for the first image (thumbnail) to reduce storage.getUrl calls.
 * Use getProductById to get all image URLs.
 */
export const listProducts = query({
  args: {
    // Primary filter tab — drives isArchived flag and stock constraints.
    tab: v.optional(v.string()),
    // Category/type filter.
    type: v.optional(v.string()),
    // Legacy brand filter (kept for frontend compatibility while phoneType migration completes).
    brand: v.optional(v.string()),
    search: v.optional(v.string()),
    // Advanced filters.
    condition: v.optional(vCondition),
    priceMin: v.optional(v.number()),
    priceMax: v.optional(v.number()),
    hasImages: v.optional(v.boolean()),
    // Storage filter: numeric GB value (e.g. 64, 128, 256, 512).
    // Matched against the storage string field via startsWith.
    storageGb: v.optional(v.number()),
    // Full-text search (unchanged behaviour).
    q: v.optional(v.string()),
    // Legacy params — honoured when tab is absent for backward compatibility.
    includeArchived: v.optional(v.boolean()),
    lowStockOnly: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { tab, type, brand, search, condition, priceMin, priceMax, hasImages, storageGb, q,
      includeArchived, lowStockOnly },
  ) => {
    const normalizedTab = normalizeTab(tab);
    const resolvedType = normalizeType(type);
    const includeArchivedLegacy = !tab && includeArchived === true;
    const normalizedSearch = (search ?? q)?.toLowerCase().replace(/\s+/g, " ").trim();
    const isArchivedTab = normalizedTab === "archived";

    // Choose the most specific available index for the initial fetch.
    let indexedProducts;
    if (normalizedTab === "exchange") {
      // Index covers isArchived=false AND exchangeEnabled=true together.
      indexedProducts = await ctx.db
        .query("products")
        .withIndex("by_isArchived_exchangeEnabled_createdAt", (qb) =>
          qb.eq("isArchived", false).eq("exchangeEnabled", true),
        )
        .order("desc")
        .collect();
    } else {
      // Default: filter by isArchived only.
      indexedProducts = await ctx.db
        .query("products")
        .withIndex("by_isArchived_createdAt", (qb) =>
          tab
            ? qb.eq("isArchived", isArchivedTab)
            : includeArchivedLegacy
              ? qb.gte("isArchived", false) // legacy: include both
              : qb.eq("isArchived", false),
        )
        .order("desc")
        .collect();
    }

    // Compatibility: legacy rows created before isArchived existed may be
    // absent from the index. Treat them as non-archived.
    const legacyProducts = (await ctx.db.query("products").collect())
      .filter((p) => (p as { isArchived?: boolean }).isArchived === undefined)
      .map((p) => ({ ...p, isArchived: false }));

    const merged = [...indexedProducts, ...legacyProducts];
    const deduped = Array.from(
      new Map(merged.map((p) => [p._id, p])).values(),
    ).sort((a, b) => b.createdAt - a.createdAt);

    // Authoritative isArchived gate — handles legacy products that bypassed index.
    let products =
      normalizedTab === "archived"
        ? deduped.filter((p) => p.isArchived === true)
        : includeArchivedLegacy
          ? deduped
          : deduped.filter((p) => p.isArchived === false);

    // --- Tab stock constraints ---
    if (normalizedTab === "in_stock") {
      products = products.filter((p) => p.stockQuantity > 0);
    } else if (normalizedTab === "out_of_stock") {
      products = products.filter((p) => p.stockQuantity === 0);
    } else if (normalizedTab === "low_stock") {
      products = products.filter(
        (p) =>
          p.stockQuantity > 0 &&
          p.stockQuantity <= (p.lowStockThreshold ?? LOW_STOCK_THRESHOLD),
      );
    } else if (normalizedTab === "exchange") {
      products = products.filter((p) => p.exchangeEnabled === true);
    }
    // "exchange" is pre-filtered by index; in-memory filter above keeps it safe.

    // Legacy lowStockOnly (honoured only when tab is absent).
    if (!tab && lowStockOnly) {
      products = products.filter((p) => p.stockQuantity <= 2);
    }

    // --- Advanced filters (applied in-memory after index fetch) ---
    if (resolvedType) products = products.filter((p) => p.type === resolvedType);
    if (brand) {
      const normalizedBrand = brand.toLowerCase();
      products = products.filter((p) => {
        const legacyBrand = (p as unknown as { brand?: string }).brand;
        return legacyBrand?.toLowerCase() === normalizedBrand;
      });
    }
    if (condition) products = products.filter((p) => p.condition === condition);
    if (priceMin !== undefined) products = products.filter((p) => p.price >= priceMin);
    if (priceMax !== undefined) products = products.filter((p) => p.price <= priceMax);
    if (hasImages) products = products.filter((p) => Array.isArray(p.images) && p.images.length > 0);
    if (storageGb !== undefined) {
      const storageStr = String(storageGb);
      products = products.filter((p) => p.storage?.startsWith(storageStr) ?? false);
    }

    // --- Text search (hard-capped to avoid unbounded in-memory scans) ---
    if (normalizedSearch) {
      const candidates = products.slice(0, 300);
      products = candidates.filter((p) => {
        const st = p.searchText ?? (p.phoneType ? p.phoneType.toLowerCase() : "");
        return st.includes(normalizedSearch);
      });
    }

    // Resolve thumbnail URL only. Per-row errors are swallowed so one bad row
    // cannot crash the entire query — the row is returned with images: [].
    return Promise.all(
      products.map(async (p) => {
        try {
          const safeImages = Array.isArray(p.images) ? p.images : [];
          return { ...p, images: await resolveThumbnail(ctx, safeImages) };
        } catch {
          return { ...p, images: [] };
        }
      }),
    );
  },
});

/**
 * Fetch a single product by its Convex ID.
 * Returns images with resolved URLs.
 */
export const getProductById = query({
  args: { productId: v.id("products") },
  handler: async (ctx, { productId }) => {
    const p = await ctx.db.get(productId);
    if (!p) return null;
    return { ...p, images: await resolveImages(ctx, p.images) };
  },
});

// ================================================================
//  MUTATIONS
// ================================================================

/**
 * Create a new product. Images are passed as { storageId, order } pairs;
 * url is NOT stored — it is resolved at query time via Convex Storage.
 */
export const createProduct = mutation({
  args: {
    type: vProductType,
    phoneType: v.string(),
    ram: v.optional(v.string()),
    storage: v.optional(v.string()),
    condition: v.optional(vCondition),
    price: v.number(),
    stockQuantity: v.number(),
    exchangeEnabled: v.boolean(),
    description: v.optional(v.string()),
    images: v.array(vImageInput),
    createdBy: v.string(),
    updatedBy: v.string(),
    // Additional phone specifications
    screenSize: v.optional(v.string()),
    battery: v.optional(v.string()),
    mainCamera: v.optional(v.string()),
    selfieCamera: v.optional(v.string()),
    simType: v.optional(v.string()),
    color: v.optional(v.string()),
    operatingSystem: v.optional(v.string()),
    features: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const exchangeEnabled = normalizeExchangeEnabled(args.type, args.exchangeEnabled);
    return await ctx.db.insert("products", {
      ...args,
      exchangeEnabled,
      isArchived: false,
      searchText: buildSearchText(args),
      searchNormalized: buildSearchNormalized(args),
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Patch an existing product. Only provided fields are updated.
 * Always updates updatedAt and updatedBy.
 */
export const updateProduct = mutation({
  args: {
    productId: v.id("products"),
    type: v.optional(vProductType),
    phoneType: v.optional(v.string()),
    ram: v.optional(v.string()),
    storage: v.optional(v.string()),
    condition: v.optional(vCondition),
    price: v.optional(v.number()),
    stockQuantity: v.optional(v.number()),
    exchangeEnabled: v.optional(v.boolean()),
    description: v.optional(v.string()),
    images: v.optional(v.array(vImageInput)),
    updatedBy: v.string(),
    // Additional phone specifications
    screenSize: v.optional(v.string()),
    battery: v.optional(v.string()),
    mainCamera: v.optional(v.string()),
    selfieCamera: v.optional(v.string()),
    simType: v.optional(v.string()),
    color: v.optional(v.string()),
    operatingSystem: v.optional(v.string()),
    features: v.optional(v.string()),
  },
  handler: async (ctx, { productId, updatedBy, ...patch }) => {
    const existing = await ctx.db.get(productId);
    if (!existing) {
      throw new Error("Product not found");
    }

    const effectiveType: ProductType = patch.type ?? existing.type;
    const effectiveExchangeEnabled = patch.exchangeEnabled ?? existing.exchangeEnabled;
    const normalizedExchangeEnabled = normalizeExchangeEnabled(
      effectiveType,
      effectiveExchangeEnabled,
    );

    // Recompute searchText and searchNormalized using the merged (effective) field values.
    const searchFieldArgs = {
      phoneType: patch.phoneType ?? existing.phoneType,
      storage: patch.storage ?? existing.storage,
      ram: patch.ram ?? existing.ram,
      condition: patch.condition ?? existing.condition,
    };
    const searchText = buildSearchText(searchFieldArgs);
    const searchNormalized = buildSearchNormalized(searchFieldArgs);

    await ctx.db.patch(productId, {
      ...patch,
      exchangeEnabled: normalizedExchangeEnabled,
      searchText,
      searchNormalized,
      updatedAt: Date.now(),
      updatedBy,
    });
  },
});

/**
 * Quickly adjust stock by +1 or -1 from Inventory controls.
 */
export const updateStockQuantity = mutation({
  args: {
    productId: v.id("products"),
    delta: v.number(),
  },
  handler: async (ctx, { productId, delta }) => {
    if (delta !== 1 && delta !== -1) {
      throw new Error("delta must be exactly 1 or -1");
    }

    const product = await ctx.db.get(productId);
    if (!product) {
      throw new Error("Product not found");
    }

    const newQty = Math.max(0, product.stockQuantity + delta);
    await ctx.db.patch(productId, {
      stockQuantity: newQty,
    });

    return { stockQuantity: newQty };
  },
});

/**
 * Soft-delete a product: sets isArchived=true (for index) and archivedAt (for display).
 */
export const archiveProduct = mutation({
  args: { productId: v.id("products") },
  handler: async (ctx, { productId }) => {
    const now = Date.now();
    await ctx.db.patch(productId, {
      isArchived: true,
      archivedAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Restore a previously archived product: clears isArchived and archivedAt.
 */
export const restoreProduct = mutation({
  args: { productId: v.id("products") },
  handler: async (ctx, { productId }) => {
    await ctx.db.patch(productId, {
      isArchived: false,
      archivedAt: undefined,
      updatedAt: Date.now(),
    });
  },
});

/**
 * One-time backfill: compute and store searchText for every product that
 * doesn't have it yet (i.e. created before this field was introduced).
 * Run once from the Convex dashboard: call products:backfillSearchText with {}.
 * Safe to re-run — skips rows that already have a non-empty searchText.
 */
export const backfillSearchText = mutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("products").collect();
    let count = 0;
    for (const p of all) {
      if (!p.searchText) {
        await ctx.db.patch(p._id, {
          searchText: buildSearchText({
            phoneType: p.phoneType,
            storage: p.storage,
            ram: p.ram,
            condition: p.condition,
          }),
        });
        count++;
      }
    }
    return { backfilled: count };
  },
});

/**
 * One-time backfill: compute and store searchNormalized for every product that
 * doesn't have it yet (i.e. created before this field was introduced).
 * Run once from the Convex dashboard: call products:backfillSearchNormalized with {}.
 * Safe to re-run — skips rows that already have a non-empty searchNormalized.
 */
export const backfillSearchNormalized = mutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("products").collect();
    let count = 0;
    for (const p of all) {
      if (!p.searchNormalized) {
        await ctx.db.patch(p._id, {
          searchNormalized: buildSearchNormalized({
            phoneType: p.phoneType,
            storage: p.storage,
            ram: p.ram,
            condition: p.condition,
          }),
        });
        count++;
      }
    }
    return { backfilled: count };
  },
});

/**
 * One-time migration: merges legacy brand + model into the new phoneType field.
 * For each product that has brand/model but no phoneType, writes:
 *   phoneType = brand + " " + model
 * Safe to re-run — skips rows that already have a non-empty phoneType.
 * Run once from the Convex dashboard: call products:migratePhoneType with {}.
 */
export const migratePhoneType = mutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("products").collect();
    let count = 0;
    for (const p of all) {
      const legacy = p as unknown as { brand?: string; model?: string; phoneType?: string };
      if (!legacy.phoneType && legacy.brand && legacy.model) {
        const phoneType = `${legacy.brand} ${legacy.model}`.trim();
        await ctx.db.patch(p._id, {
          phoneType,
          searchText: buildSearchText({
            phoneType,
            storage: p.storage,
            ram: p.ram,
            condition: p.condition,
          }),
        });
        count++;
      }
    }
    return { migrated: count };
  },
});

/**
 * One-time backfill: sets isArchived on all products that predate the field.
 * Run once from the Convex dashboard, then this mutation can be deleted.
 * Not exposed in the API surface — import via internal if needed.
 */
export const backfillIsArchived = mutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("products").collect();
    let count = 0;
    for (const p of all) {
      // isArchived will be undefined on rows that existed before the schema change
      if ((p as { isArchived?: boolean }).isArchived === undefined) {
        await ctx.db.patch(p._id, {
          isArchived: p.archivedAt != null ? true : false,
        });
        count++;
      }
    }
    return { backfilled: count };
  },
});

/**
 * One-time cleanup: removes legacy brand/model fields from product documents
 * that were created before the phoneType migration.
 * Run once from the Convex dashboard after migratePhoneType has been run.
 * Safe to re-run — skips rows that have neither field.
 */
export const cleanupLegacyBrandModel = mutation({
  args: {},
  handler: async (ctx) => {
    const products = await ctx.db.query("products").collect();
    let cleaned = 0;

    for (const p of products) {
      const hasBrand = (p as any).brand !== undefined;
      const hasModel = (p as any).model !== undefined;
      if (hasBrand || hasModel) {
        await ctx.db.patch(p._id, { brand: undefined, model: undefined } as any);
        cleaned++;
      }
    }

    return { cleaned };
  },
});
