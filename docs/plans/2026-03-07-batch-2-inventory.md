# Batch 2: Inventory Thresholds, Search, and Filters Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix low stock logic (threshold <= 2), implement space-aware search normalization, and strengthen inventory filters.

**Architecture:**
- Backend: Update LOW_STOCK_THRESHOLD constant from 5 to 2; implement normalization that removes spaces for flexible matching while preserving spaces in display
- Frontend: Add RAM, improved sort options, and visual improvements to the filter drawer

**Tech Stack:** React + Vite, Convex backend, TailwindCSS

---

## Task 1: Fix Low Stock Threshold (Backend)

**Files:**
- Modify: `convex/products.ts:151`

**Step 1: Update LOW_STOCK_THRESHOLD constant**

```typescript
// Change from:
const LOW_STOCK_THRESHOLD = 5;

// Change to:
const LOW_STOCK_THRESHOLD = 2;
```

**Step 2: Commit**

```bash
cd "d:/Abenier/Micky Mobile Admin/Admin-Ted"
git add convex/products.ts
git commit -m "fix: update low stock threshold to 2"
```

Expected: Commit succeeds, low stock tab now shows only products with stock <= 2.

---

## Task 2: Implement Space-Aware Search Normalization

**Files:**
- Modify: `convex/products.ts:49-61` (buildSearchNormalized function)
- Modify: `convex/products.ts:354-360` (search logic in listProducts)

**Step 1: Update buildSearchNormalized to remove all spaces**

```typescript
/**
 * Build a normalized, lowercase search field for indexed prefix queries.
 * Removes ALL spaces to enable flexible matching: "iphone17" matches "iphone 17" and vice versa.
 * Used during product creation/update to build the searchNormalized field.
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
    .replace(/\s+/g, "") // Remove ALL spaces for flexible matching
    .trim();
}
```

**Step 2: Update search logic in listProducts to normalize the query the same way**

Find this section (lines 354-360):
```typescript
// --- Text search (hard-capped to avoid unbounded in-memory scans) ---
if (normalizedSearch) {
  const candidates = products.slice(0, 300);
  products = candidates.filter((p) => {
    const st = p.searchText ?? (p.phoneType ? p.phoneType.toLowerCase() : "");
    return st.includes(normalizedSearch);
  });
}
```

Replace with:
```typescript
// --- Text search (hard-capped to avoid unbounded in-memory scans) ---
if (normalizedSearch) {
  const candidates = products.slice(0, 300);
  // Remove spaces from search query to match flexible search: "iphone17" matches "iphone 17"
  const normalizedQueryNoSpaces = normalizedSearch.replace(/\s+/g, "");
  products = candidates.filter((p) => {
    // Compare space-removed versions: searchNormalized has spaces removed, so does query
    const st = (p.searchNormalized ?? p.phoneType ?? "").toLowerCase().replace(/\s+/g, "");
    return st.includes(normalizedQueryNoSpaces);
  });
}
```

**Step 3: Commit**

```bash
cd "d:/Abenier/Micky Mobile Admin/Admin-Ted"
git add convex/products.ts
git commit -m "fix: implement space-aware search normalization"
```

Expected: Both "iphone 17" and "iphone17" now match products with "iphone 17" in the name.

---

## Task 3: Add RAM Filter to Backend

**Files:**
- Modify: `convex/products.ts:235-352` (listProducts query)

**Step 1: Add ram filter parameter and logic**

In the args object (around line 236-257), add after storageGb:
```typescript
// RAM filter: numeric GB value (e.g. 4, 6, 8, 12).
ramGb: v.optional(v.number()),
```

In the handler parameters (line 260), add `ramGb` to the destructuring.

In the advanced filters section (after line 351), add:
```typescript
if (ramGb !== undefined) {
  const ramStr = String(ramGb);
  products = products.filter((p) => p.ram?.startsWith(ramStr) ?? false);
}
```

**Step 2: Commit**

```bash
cd "d:/Abenier/Micky Mobile Admin/Admin-Ted"
git add convex/products.ts
git commit -m "feat(backend): add RAM filter support to listProducts"
```

Expected: Backend now accepts ramGb filter parameter.

---

## Task 4: Enhance Frontend Filters - Add RAM Filter

**Files:**
- Modify: `src/pages/Inventory.tsx:35-50` (types and constants)
- Modify: `src/pages/Inventory.tsx:156` (advancedFilters state)
- Modify: `src/pages/Inventory.tsx:164-171` (activeFilterCount)
- Modify: `src/pages/Inventory.tsx:175-184` (convex query args)

**Step 1: Add RAM_OPTIONS constant and ramGb to type**

Add after STORAGE_OPTIONS (around line 50):
```typescript
const RAM_OPTIONS = [4, 6, 8, 12] as const;
```

Update AdvancedFilters type (around line 35-41) to add:
```typescript
ramGb?: number;
```

**Step 2: Update activeFilterCount**

Change lines 165-171 to include ramGb:
```typescript
const activeFilterCount = [
  advancedFilters.condition,
  advancedFilters.priceMin,
  advancedFilters.priceMax,
  advancedFilters.storageGb,
  advancedFilters.ramGb,
  advancedFilters.hasImages,
].filter((v) => v !== undefined).length;
```

**Step 3: Update Convex query call**

In the useQuery call (around line 175-184), add:
```typescript
ramGb: advancedFilters.ramGb,
```

**Step 4: Commit**

```bash
cd "d:/Abenier/Micky Mobile Admin/Admin-Ted"
git add src/pages/Inventory.tsx
git commit -m "feat(frontend): add RAM filter type and state"
```

Expected: RAM filter state now tracked.

---

## Task 5: Add RAM Filter UI to Drawer

**Files:**
- Modify: `src/pages/Inventory.tsx:812-812` (add RAM filter UI after Storage section)

**Step 1: Add RAM filter UI in drawer**

After the Storage section (around line 812), add before the "Has Images" section:

```typescript
{/* RAM */}
<div>
  <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>RAM</p>
  <select
    value={draftFilters.ramGb ?? ''}
    onChange={(e) =>
      setDraftFilters((prev) => ({
        ...prev,
        ramGb: e.target.value ? Number(e.target.value) : undefined,
      }))
    }
    className="w-full rounded-xl px-3 py-2 text-sm outline-none transition-colors appearance-none"
    style={inputStyle}
  >
    <option value="">Any</option>
    {RAM_OPTIONS.map((gb) => (
      <option key={gb} value={gb}>
        {gb} GB
      </option>
    ))}
  </select>
</div>
```

**Step 2: Commit**

```bash
cd "d:/Abenier/Micky Mobile Admin/Admin-Ted"
git add src/pages/Inventory.tsx
git commit -m "feat(frontend): add RAM filter UI to filter drawer"
```

Expected: RAM dropdown now visible in filter drawer under Storage filter.

---

## Task 6: Add Sort Options to Frontend Filters

**Files:**
- Modify: `src/pages/Inventory.tsx:35-50` (add SortOption type)
- Modify: `src/pages/Inventory.tsx:156` (add sortBy to advancedFilters state)
- Modify: `src/pages/Inventory.tsx:700-750` (add sort section to drawer)
- Modify: `src/pages/Inventory.tsx:540-603` (apply sorting to products array)

**Step 1: Add sort type and state**

Add before AdvancedFilters type (around line 35):
```typescript
type SortOption = 'newest' | 'priceLow' | 'priceHigh' | 'stockLow';

type AdvancedFilters = {
  condition?: Condition;
  priceMin?: number;
  priceMax?: number;
  storageGb?: number;
  ramGb?: number;
  hasImages?: boolean;
  sortBy?: SortOption;
};
```

**Step 2: Update activeFilterCount to include sortBy**

Change activeFilterCount to:
```typescript
const activeFilterCount = [
  advancedFilters.condition,
  advancedFilters.priceMin,
  advancedFilters.priceMax,
  advancedFilters.storageGb,
  advancedFilters.ramGb,
  advancedFilters.hasImages,
  advancedFilters.sortBy && advancedFilters.sortBy !== 'newest',
].filter((v) => v !== undefined && v !== false).length;
```

**Step 3: Add sorting logic before rendering products**

Before the product rendering (around line 540), add this sorting function:

```typescript
// Apply sorting to products based on sortBy preference
const sortedProducts = (() => {
  if (!advancedFilters.sortBy || advancedFilters.sortBy === 'newest') {
    return products; // Already sorted newest-first from backend
  }

  const sorted = [...products];
  if (advancedFilters.sortBy === 'priceLow') {
    sorted.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  } else if (advancedFilters.sortBy === 'priceHigh') {
    sorted.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
  } else if (advancedFilters.sortBy === 'stockLow') {
    sorted.sort((a, b) => (a.stockQuantity ?? 0) - (b.stockQuantity ?? 0));
  }
  return sorted;
})();
```

Then update all references to `products` in the render section (line 540-603) to use `sortedProducts` instead. Change:
- Line 541: `{products.length}` → `{sortedProducts.length}`
- Line 545: `{products.map((product, index) => {` → `{sortedProducts.map((product, index) => {`

**Step 4: Add sort UI to drawer**

Add this section before the Condition section (around line 730):

```typescript
{/* Sort */}
<div>
  <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>Sort by</p>
  <select
    value={draftFilters.sortBy ?? 'newest'}
    onChange={(e) =>
      setDraftFilters((prev) => ({
        ...prev,
        sortBy: e.target.value as SortOption,
      }))
    }
    className="w-full rounded-xl px-3 py-2 text-sm outline-none transition-colors appearance-none"
    style={inputStyle}
  >
    <option value="newest">Newest</option>
    <option value="priceLow">Price: Low to High</option>
    <option value="priceHigh">Price: High to Low</option>
    <option value="stockLow">Stock: Low to High</option>
  </select>
</div>
```

**Step 5: Commit**

```bash
cd "d:/Abenier/Micky Mobile Admin/Admin-Ted"
git add src/pages/Inventory.tsx
git commit -m "feat(frontend): add sort options to filter drawer"
```

Expected: Sort dropdown appears at top of filter drawer, sorting works on all options.

---

## Task 7: Verify and Test All Changes

**Step 1: Deploy backend changes**

```bash
cd "d:/Abenier/Micky Mobile Admin/Admin-Ted"
npx convex deploy --yes
```

Expected: Deployment succeeds to prod (fastidious-schnauzer-265).

**Step 2: Build frontend**

```bash
cd "d:/Abenier/Micky Mobile Admin/Admin-Ted"
npm run build
```

Expected: Build succeeds with no errors.

**Step 3: Test low stock threshold**

In Convex dashboard or via `npx convex run`:
- Verify a phone product with stock = 2 appears in Low Stock tab
- Verify a phone product with stock = 3 does NOT appear in Low Stock tab
- Verify a phone product with stock = 0 does NOT appear in Low Stock tab

**Step 4: Test space-aware search**

- Search "iphone 17" → matches products with "iphone 17" or "iPhone 17"
- Search "iphone17" → matches the same products
- Search "iphone16pro" → matches products with "iPhone 16 Pro"

**Step 5: Test RAM filter**

- Select "4 GB" in RAM filter
- Only products with "4" in the ram field appear

**Step 6: Test sort options**

- Select "Price: Low to High" → products sorted ascending by price
- Select "Price: High to Low" → products sorted descending by price
- Select "Stock: Low to High" → products sorted ascending by stock
- Select "Newest" → back to default newest-first order

**Step 7: Verify filter count indicator**

- No active filters → no dot on filter icon
- Select any filter → dot appears on filter icon
- Select "Newest" → dot does NOT appear (newest is default)

---

## Verification Checklist

- [ ] Low stock: Phone with stock 2 is in Low Stock tab
- [ ] Low stock: Phone with stock 3 is NOT in Low Stock tab
- [ ] Low stock: Accessory with stock 2 is in Low Stock tab
- [ ] Low stock: Accessory with stock 3 is NOT in Low Stock tab
- [ ] Search: "iphone17" matches "iPhone 17" products
- [ ] Search: "iphone 17" matches same products as "iphone17"
- [ ] Filters: RAM filter works (shows only selected RAM)
- [ ] Filters: Sort options work (all 4 sort modes produce correct order)
- [ ] Filters: UI is clear and mobile-friendly
- [ ] Filters: Active filter count dot appears correctly
- [ ] Build: `npm run build` succeeds
- [ ] Convex: `npx convex deploy --yes` succeeds

---

## Post-Implementation

After all tasks complete:
1. Merge all changes to main branch
2. Verify on live Vercel deployment
3. Update memory with changes made
