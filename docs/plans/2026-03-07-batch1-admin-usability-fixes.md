# Batch 1 Admin Usability Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 5 critical admin-side usability bugs: permanent delete for archived products, decrement sheet visibility, Dashboard modal visibility, and nav badge prominence.

**Architecture:** Three independent fix areas — (1) new Convex mutation + Inventory UI delete flow, (2) z-index elevation for all in-page modals (fixes issues 2 & 3), (3) badge size increase in BottomNav. No new dependencies needed.

**Tech Stack:** React + TypeScript + Convex + TailwindCSS, Telegram Mini App (dark theme, mobile-first)

---

### Task 1: Add `permanentDeleteProduct` mutation to Convex

**Files:**
- Modify: `convex/products.ts` (add mutation after `restoreProduct`)

**Step 1: Write the mutation**

Add after the `restoreProduct` mutation (~line 557):

```typescript
/**
 * Hard-delete a product permanently. Only call this on archived products.
 * This is irreversible — it removes the document entirely from the database.
 */
export const permanentDeleteProduct = mutation({
  args: { productId: v.id("products") },
  handler: async (ctx, { productId }) => {
    await ctx.db.delete(productId);
  },
});
```

**Step 2: Verify TypeScript compiles**

```bash
cd "d:/Abenier/TedyTech Admin/Admin-Ted"
npm run build
```
Expected: no errors related to products.ts

---

### Task 2: Add delete button + red confirmation sheet to Archived tab in Inventory.tsx

**Files:**
- Modify: `src/pages/Inventory.tsx`

This task has several sub-steps in a single file.

**Step 1: Add the import for the Trash2 icon**

At the top of the file, in the lucide-react import line, add `Trash2`:
```typescript
import { Package, Search, X, Loader2, SlidersHorizontal, Trash2 } from 'lucide-react';
```

**Step 2: Add mutation import and state**

In `InventoryContent`, after the `updateStockQuantity` mutation hook, add:
```typescript
const permanentDeleteProduct = useMutation(api.products.permanentDeleteProduct);
const [confirmDeleteProduct, setConfirmDeleteProduct] = useState<Product | null>(null);
```

**Step 3: Add handler functions**

After `handleConfirmDecrement`:
```typescript
const handleDeleteRequest = (product: Product) => {
  setConfirmDeleteProduct(product);
};
const handleConfirmDelete = async () => {
  if (!confirmDeleteProduct) return;
  const productId = getProductId(confirmDeleteProduct);
  if (!productId) return;
  setConfirmDeleteProduct(null);
  try {
    await permanentDeleteProduct({ productId: productId as Id<'products'> });
  } catch (err) {
    console.error('[Inventory] permanentDelete failed', err);
  }
};
```

**Step 4: Add delete button on archived product rows**

In the product list rendering (inside `products.map(...)`), after the existing stock controls `<div className="flex items-center justify-end gap-2 px-2">`, wrap the stock controls in a conditional and add a delete button for archived products:

Replace the existing `<div className="flex items-center justify-end gap-2 px-2">...</div>` block with:

```tsx
{tab === 'archived' ? (
  /* Archived: show delete action instead of stock controls */
  <div className="flex items-center justify-end px-2">
    <button
      type="button"
      onClick={() => handleDeleteRequest(product)}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold active:scale-95 transition-transform"
      style={{ background: 'rgba(239,68,68,0.12)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.25)' }}
    >
      <Trash2 size={13} />
      Delete permanently
    </button>
  </div>
) : (
  /* All other tabs: show stock controls */
  <div className="flex items-center justify-end gap-2 px-2">
    <button
      type="button"
      onClick={() => handleDecrementRequest(product)}
      disabled={stockQuantity === 0 || isPending}
      className="w-8 h-8 rounded-lg text-base font-bold leading-none active:scale-95 transition-transform disabled:opacity-40 disabled:active:scale-100"
      style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
    >
      -
    </button>
    <span className="w-7 text-center text-sm font-semibold" style={{ color: 'var(--text)' }}>
      {stockQuantity}
    </span>
    <button
      type="button"
      onClick={() => handleIncrement(product)}
      disabled={isPending}
      className="w-8 h-8 rounded-lg text-base font-bold leading-none active:scale-95 transition-transform disabled:opacity-40 disabled:active:scale-100"
      style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
    >
      +
    </button>
  </div>
)}
```

**Step 5: Add the red permanent delete confirmation sheet**

After the existing decrement confirmation bottom sheet block (after its closing `}`), add:

```tsx
{/* Permanent delete confirmation bottom sheet */}
{confirmDeleteProduct && (
  <div className="fixed inset-0 z-[60] flex items-end bg-black/50">
    <div
      className="rounded-t-3xl w-full p-5 animate-in slide-in-from-bottom duration-200"
      style={{
        background: 'var(--surface)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)',
      }}
    >
      <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: 'var(--border)' }} />
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3"
        style={{ background: 'rgba(239,68,68,0.12)' }}
      >
        <Trash2 size={22} style={{ color: '#EF4444' }} />
      </div>
      <h2 className="text-base font-bold text-center mb-1" style={{ color: 'var(--text)' }}>
        Delete this product permanently?
      </h2>
      <p className="text-xs text-center mb-1" style={{ color: 'var(--muted)' }}>
        {typeof confirmDeleteProduct.phoneType === 'string' && confirmDeleteProduct.phoneType.trim()
          ? confirmDeleteProduct.phoneType
          : 'Unnamed product'}
      </p>
      <p className="text-xs text-center mb-5" style={{ color: '#EF4444' }}>
        This cannot be undone.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setConfirmDeleteProduct(null)}
          className="flex-1 py-3 rounded-xl font-semibold text-sm active:scale-95 transition-transform"
          style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleConfirmDelete()}
          className="flex-1 py-3 rounded-xl font-semibold text-sm active:scale-95 transition-transform"
          style={{ background: '#EF4444', color: '#ffffff' }}
        >
          Delete
        </button>
      </div>
    </div>
  </div>
)}
```

---

### Task 3: Fix decrement confirmation sheet z-index (hidden behind BottomNav)

**Files:**
- Modify: `src/pages/Inventory.tsx`

**Step 1: Change z-index of the decrement confirmation sheet**

Find the existing decrement sheet div:
```tsx
{confirmDecrementProduct && (
  <div className="fixed inset-0 z-50 flex items-end bg-black/40">
```

Change `z-50` to `z-[60]`:
```tsx
{confirmDecrementProduct && (
  <div className="fixed inset-0 z-[60] flex items-end bg-black/40">
```

BottomNav uses `z-50`. Raising the modal to `z-[60]` ensures it always renders above BottomNav.

---

### Task 4: Fix Dashboard modal z-indexes (modals hidden behind BottomNav)

**Files:**
- Modify: `src/pages/Dashboard.tsx`

The three modals — `RestockModal`, `ContentPlanModal`, `AffiliatesModal` — all render with `z-50`. BottomNav is `z-50` and appears later in the DOM, covering the bottom buttons of these modals.

**Step 1: Fix RestockModal**

Find:
```tsx
className="fixed inset-0 bg-black/60 z-50 flex items-end"
```
Change to `z-[60]`:
```tsx
className="fixed inset-0 bg-black/60 z-[60] flex items-end"
```

**Step 2: Fix ContentPlanModal**

Find:
```tsx
className="fixed inset-0 bg-black/60 z-50 flex items-end"
```
Change to `z-[60]`.

**Step 3: Fix AffiliatesModal**

Find:
```tsx
className="fixed inset-0 bg-black/60 z-50 flex items-end"
```
Change to `z-[60]`.

---

### Task 5: Make Exchange and Inbox nav badges larger and more prominent

**Files:**
- Modify: `src/components/BottomNav.tsx`

**Problem:** The Badge override in BottomNav shrinks the badge to `height: 15px, minWidth: 15px, fontSize: 9px`. The Badge component's natural defaults are `height: 18px, minWidth: 18px, fontSize: 10px`. The override makes it noticeably smaller.

**Step 1: Update the badge style in BottomNav**

Find the Badge `style` prop in `BottomNav.tsx`:
```tsx
style={{
  position:  'absolute',
  top:       '-3px',
  right:     badge >= 10 ? '-7px' : '-5px',
  fontSize:  '9px',
  height:    '15px',
  minWidth:  badge >= 10 ? 'auto' : '15px',
  padding:   badge >= 10 ? '0 4px' : '0',
  pointerEvents: 'none',
}}
```

Replace with (use Badge's natural 18px size, slightly adjust positioning):
```tsx
style={{
  position:   'absolute',
  top:        '-5px',
  right:      badge >= 10 ? '-9px' : '-6px',
  pointerEvents: 'none',
}}
```

This removes the size overrides, so Badge uses its own defaults: `18px` height, `10px` font, `1.5px solid var(--bg)` ring, red shadow — all clearly visible.

---

### Task 6: Verify build and run type-check

**Step 1: Run build**

```bash
cd "d:/Abenier/TedyTech Admin/Admin-Ted"
npm run build
```

Expected: exit 0, no TypeScript errors.

---

### Task 7: Commit and push Batch 1

```bash
cd "d:/Abenier/TedyTech Admin/Admin-Ted"
git add convex/products.ts src/pages/Inventory.tsx src/pages/Dashboard.tsx src/components/BottomNav.tsx
git commit -m "fix(admin): resolve critical inventory and navigation usability issues"
git push
```
