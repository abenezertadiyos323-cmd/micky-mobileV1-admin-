# Batch 3: Design Consistency + Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix color inconsistencies in ProductForm and ExchangeDetail, and build a practical Settings screen backed by a Convex settings document.

**Architecture:** Token-based color cleanup (replace hardcoded Tailwind indigo/amber/green with CSS variable inline styles); new `adminSettings` Convex table with single-document upsert pattern; rebuilt Settings screen with 5 card sections.

**Tech Stack:** React + Vite, Convex backend, TailwindCSS (dark theme)

---

## Task 1: Add adminSettings Convex Schema + Backend

**Files:**
- Modify: `convex/schema.ts` (add adminSettings table at end of defineSchema)
- Create: `convex/adminSettings.ts`

**Step 1: Add adminSettings table to schema**

At the end of the `defineSchema({...})` object in `convex/schema.ts`, add before the closing `});`:

```typescript
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
  updatedAt: v.number(),
}),
```

No indexes needed — single document table, always fetched with full collect.

**Step 2: Create convex/adminSettings.ts**

```typescript
// convex/adminSettings.ts
// Single admin settings document — one query, one mutation

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Returns the single admin settings document, or null if not yet created.
 * Frontend uses defaults when null is returned.
 */
export const getSettings = query({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("adminSettings").collect();
    return docs[0] ?? null;
  },
});

/**
 * Upsert admin settings — creates the document if it doesn't exist,
 * otherwise patches only the provided fields.
 */
export const upsertSettings = mutation({
  args: {
    storeName: v.optional(v.string()),
    supportContact: v.optional(v.string()),
    telegramBotLink: v.optional(v.string()),
    phoneLowStockThreshold: v.optional(v.number()),
    accessoryLowStockThreshold: v.optional(v.number()),
    exchangeAlertsEnabled: v.optional(v.boolean()),
    inboxAlertsEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("adminSettings").first();
    const now = Date.now();

    if (existing) {
      // Only patch fields that were actually provided
      const patch: Record<string, unknown> = { updatedAt: now };
      if (args.storeName !== undefined) patch.storeName = args.storeName;
      if (args.supportContact !== undefined) patch.supportContact = args.supportContact;
      if (args.telegramBotLink !== undefined) patch.telegramBotLink = args.telegramBotLink;
      if (args.phoneLowStockThreshold !== undefined) patch.phoneLowStockThreshold = args.phoneLowStockThreshold;
      if (args.accessoryLowStockThreshold !== undefined) patch.accessoryLowStockThreshold = args.accessoryLowStockThreshold;
      if (args.exchangeAlertsEnabled !== undefined) patch.exchangeAlertsEnabled = args.exchangeAlertsEnabled;
      if (args.inboxAlertsEnabled !== undefined) patch.inboxAlertsEnabled = args.inboxAlertsEnabled;
      await ctx.db.patch(existing._id, patch as Partial<typeof existing>);
    } else {
      await ctx.db.insert("adminSettings", {
        ...args,
        updatedAt: now,
      });
    }
  },
});
```

**Step 3: Commit**

```bash
cd "d:/Abenier/TedyTech Admin/Admin-Ted"
git add convex/schema.ts convex/adminSettings.ts
git commit -m "feat(backend): add adminSettings table and upsert mutation"
```

Expected: Commit succeeds. Schema and backend ready for frontend consumption.

---

## Task 2: Fix ProductForm.tsx Color Inconsistencies

**Files:**
- Modify: `src/pages/ProductForm.tsx`

**Changes Required:**

### Change 1: Type selector buttons (around line 436-448)
Current:
```tsx
className={`flex-1 py-2.5 rounded-xl text-sm font-semibold capitalize transition-all ${form.type === t
  ? 'bg-indigo-600 text-white shadow-sm'
  : 'bg-surface-2 text-muted'
}`}
```
Replace with (split className and style):
```tsx
className="flex-1 py-2.5 rounded-xl text-sm font-semibold capitalize transition-all active:scale-95"
style={form.type === t
  ? { background: 'var(--primary)', color: 'var(--primary-foreground)' }
  : { background: 'var(--surface-2)', color: 'var(--muted)' }
}
```

### Change 2: All input focus rings (throughout file)
Replace ALL occurrences of `focus:ring-2 focus:ring-indigo-500` with `focus:ring-1 focus:ring-[var(--primary)]`
There are ~10 occurrences across all input/textarea fields.

### Change 3: Condition chips (around line 510-525)
Current selected state:
```tsx
? 'border-indigo-500 bg-indigo-950/60'
```
```tsx
<p className={`text-xs font-semibold ${form.condition === c ? 'text-indigo-400' : 'text-app-text'}`}>
```
Replace with:
```tsx
// className approach for non-color parts only, inline style for color
className={`p-2.5 rounded-xl border text-left transition-all ${form.condition === c ? '' : 'border-[var(--border)] bg-surface-2'}`}
style={form.condition === c ? { background: 'rgba(245,196,0,0.12)', border: '1px solid var(--primary)' } : {}}
```
```tsx
<p className="text-xs font-semibold" style={{ color: form.condition === c ? 'var(--primary)' : 'var(--text)' }}>
```

### Change 4: Price hint text (around line 635)
Current: `<p className="text-[11px] text-blue-400 mt-1">`
Replace: `<p className="text-[11px] mt-1" style={{ color: 'var(--primary)' }}>`

### Change 5: Exchange toggle buttons (around lines 662-682)
Current:
```tsx
? 'bg-red-500 text-white shadow-sm'
: 'text-muted'
```
```tsx
? 'bg-green-500 text-white shadow-sm'
: 'text-muted'
```
Replace Exchange OFF:
```tsx
className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all`}
style={!form.exchangeEnabled
  ? { background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }
  : { color: 'var(--muted)' }
}
```
Replace Exchange ON:
```tsx
className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all`}
style={form.exchangeEnabled
  ? { background: 'var(--primary)', color: 'var(--primary-foreground)' }
  : { color: 'var(--muted)' }
}
```

### Change 6: Save button (around line 714-720)
Current: `className="w-full py-4 bg-indigo-600 text-white font-semibold btn-interactive rounded-xl shadow-sm disabled:opacity-50"`
Replace:
```tsx
className="w-full py-4 font-semibold btn-interactive rounded-xl shadow-sm disabled:opacity-50"
style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
```

**Step: Commit**

```bash
cd "d:/Abenier/TedyTech Admin/Admin-Ted"
git add src/pages/ProductForm.tsx
git commit -m "fix(ui): replace indigo/green/blue hardcoded colors in ProductForm with design tokens"
```

Expected: ProductForm now uses yellow primary for all active/CTA states.

---

## Task 3: Fix ExchangeDetail.tsx + Dashboard.tsx Color Issues

**Files:**
- Modify: `src/pages/ExchangeDetail.tsx`
- Modify: `src/pages/Dashboard.tsx`

### ExchangeDetail Changes

**Change 1: Customer avatar (around line 140-144)**
Current: `style={{ background: '#2563EB' }}`
Replace: `style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}`
Also update the text color class: remove `text-white` (now handled by inline style)

**Change 2: Admin override label (around line 246-247)**
Current: `style={{ color: '#FCD34D' }}`
Replace: `style={{ color: 'var(--primary)' }}`

**Change 3: Mark Accepted button (around line 270-279)**
Current: `className="... bg-amber-500 text-white ..."`
Replace:
```tsx
className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm active:scale-[0.98] transition-all disabled:opacity-50"
style={{ background: 'rgba(245,196,0,0.15)', color: '#F5C400', border: '1px solid rgba(245,196,0,0.35)' }}
```

**Change 4: Mark Completed button (around line 280-288)**
Current: `className="... bg-green-600 text-white ..."`
Replace:
```tsx
className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm active:scale-[0.98] transition-all disabled:opacity-50"
style={{ background: 'rgba(16,185,129,0.12)', color: '#34D399', border: '1px solid rgba(16,185,129,0.3)' }}
```

### Dashboard Change

**Change: "not available" tag (around line 126)**
Current: `<span className="text-xs font-medium text-red-400">not available</span>`
Replace: `<span className="text-xs font-medium" style={{ color: 'var(--badge)' }}>not available</span>`

**Commit:**

```bash
cd "d:/Abenier/TedyTech Admin/Admin-Ted"
git add src/pages/ExchangeDetail.tsx src/pages/Dashboard.tsx
git commit -m "fix(ui): replace hardcoded colors in ExchangeDetail and Dashboard with design tokens"
```

Expected: ExchangeDetail action buttons now use dark-theme-friendly semantic styles. Avatar uses primary. Dashboard uses --badge red for "not available".

---

## Task 4: Build New Settings Screen

**Files:**
- Modify: `src/pages/Settings.tsx` (complete rewrite)

**Complete new Settings.tsx:**

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from 'convex/react';
import { ChevronRight } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import { getTelegramUser } from '../lib/telegram';
import { getBackendInfo } from '../lib/backend';
import { api } from '../../convex/_generated/api';

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL || 'http://localhost:8400';
const APP_VERSION = import.meta.env.VITE_APP_VERSION
  ? `v${import.meta.env.VITE_APP_VERSION}`
  : 'v1.0.0';

// Default values used when no settings document exists yet
const DEFAULTS = {
  storeName: '',
  supportContact: '',
  telegramBotLink: '',
  phoneLowStockThreshold: 2,
  accessoryLowStockThreshold: 2,
  exchangeAlertsEnabled: true,
  inboxAlertsEnabled: true,
};

type SettingsDoc = typeof DEFAULTS;

// Shared card wrapper
function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      {children}
    </div>
  );
}

// Shared section header above each card
function SectionLabel({ label }: { label: string }) {
  return (
    <p
      className="text-[11px] font-semibold uppercase tracking-wider mb-2 px-1"
      style={{ color: 'var(--muted)' }}
    >
      {label}
    </p>
  );
}

// Toggle row
function ToggleRow({
  label,
  subtitle,
  value,
  onChange,
  isLast,
}: {
  label: string;
  subtitle?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  isLast?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between px-4 py-3.5"
      style={!isLast ? { borderBottom: '1px solid var(--border)' } : {}}
    >
      <div className="flex-1 min-w-0 pr-3">
        <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{label}</p>
        {subtitle && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{subtitle}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className="relative w-11 h-6 rounded-full flex-shrink-0 transition-colors"
        style={{ background: value ? 'var(--primary)' : 'var(--surface-2)', border: '1px solid var(--border)' }}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
            value ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

// Input row
function InputRow({
  label,
  value,
  onChange,
  placeholder,
  type,
  isLast,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  isLast?: boolean;
}) {
  return (
    <div
      className="px-4 py-3"
      style={!isLast ? { borderBottom: '1px solid var(--border)' } : {}}
    >
      <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--muted)' }}>
        {label}
      </label>
      <input
        type={type ?? 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl px-3 py-2 text-sm outline-none"
        style={{
          background: 'var(--surface-2)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
        }}
      />
    </div>
  );
}

// Apply button
function ApplyButton({ onApply, saving }: { onApply: () => void; saving: boolean }) {
  return (
    <div className="px-4 pb-4 pt-1">
      <button
        type="button"
        onClick={onApply}
        disabled={saving}
        className="w-full py-2.5 rounded-xl text-sm font-semibold active:scale-95 transition-transform disabled:opacity-50"
        style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
      >
        {saving ? 'Saving…' : 'Apply'}
      </button>
    </div>
  );
}

// Nav row (links to sub-pages)
function NavRow({
  label,
  subtitle,
  to,
  isLast,
}: {
  label: string;
  subtitle?: string;
  to: string;
  isLast?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-surface-2 transition-colors"
      style={!isLast ? { borderBottom: '1px solid var(--border)' } : {}}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{label}</p>
        {subtitle && (
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>{subtitle}</p>
        )}
      </div>
      <ChevronRight size={16} style={{ color: 'var(--muted)' }} className="flex-shrink-0" />
    </button>
  );
}

// Info row (display only)
function InfoRow({
  label,
  value,
  isLast,
}: {
  label: string;
  value: string;
  isLast?: boolean;
}) {
  return (
    <div
      className="px-4 py-3.5"
      style={!isLast ? { borderBottom: '1px solid var(--border)' } : {}}
    >
      <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{label}</p>
      <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>{value}</p>
    </div>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const user = getTelegramUser();
  const backendInfo = getBackendInfo(CONVEX_URL);
  const backendSubtitle = backendInfo.label
    ? `${backendInfo.environment} - ${backendInfo.label}`
    : backendInfo.environment;

  const adminLabel = user.username
    ? `@${user.username} · ID: ${user.id}`
    : `${user.first_name}${user.last_name ? ` ${user.last_name}` : ''} · ID: ${user.id}`;

  const settingsDoc = useQuery(api.adminSettings.getSettings);
  const upsertSettings = useMutation(api.adminSettings.upsertSettings);

  // Merge fetched settings with defaults
  const resolved: SettingsDoc = {
    storeName: settingsDoc?.storeName ?? DEFAULTS.storeName,
    supportContact: settingsDoc?.supportContact ?? DEFAULTS.supportContact,
    telegramBotLink: settingsDoc?.telegramBotLink ?? DEFAULTS.telegramBotLink,
    phoneLowStockThreshold: settingsDoc?.phoneLowStockThreshold ?? DEFAULTS.phoneLowStockThreshold,
    accessoryLowStockThreshold: settingsDoc?.accessoryLowStockThreshold ?? DEFAULTS.accessoryLowStockThreshold,
    exchangeAlertsEnabled: settingsDoc?.exchangeAlertsEnabled ?? DEFAULTS.exchangeAlertsEnabled,
    inboxAlertsEnabled: settingsDoc?.inboxAlertsEnabled ?? DEFAULTS.inboxAlertsEnabled,
  };

  // Section A — Store draft
  const [storeDraft, setStoreDraft] = useState<{
    storeName: string;
    supportContact: string;
    telegramBotLink: string;
  } | null>(null);
  const [storeSaving, setStoreSaving] = useState(false);

  const storeName = storeDraft?.storeName ?? resolved.storeName;
  const supportContact = storeDraft?.supportContact ?? resolved.supportContact;
  const telegramBotLink = storeDraft?.telegramBotLink ?? resolved.telegramBotLink;

  const handleStoreApply = async () => {
    if (!storeDraft) return;
    setStoreSaving(true);
    await upsertSettings({
      storeName: storeDraft.storeName,
      supportContact: storeDraft.supportContact,
      telegramBotLink: storeDraft.telegramBotLink,
    });
    setStoreDraft(null);
    setStoreSaving(false);
  };

  // Section C — Inventory draft
  const [inventoryDraft, setInventoryDraft] = useState<{
    phoneLowStockThreshold: string;
    accessoryLowStockThreshold: string;
  } | null>(null);
  const [inventorySaving, setInventorySaving] = useState(false);

  const phoneThreshold = inventoryDraft?.phoneLowStockThreshold ?? String(resolved.phoneLowStockThreshold);
  const accessoryThreshold = inventoryDraft?.accessoryLowStockThreshold ?? String(resolved.accessoryLowStockThreshold);

  const handleInventoryApply = async () => {
    if (!inventoryDraft) return;
    const phoneVal = parseInt(inventoryDraft.phoneLowStockThreshold, 10);
    const accessoryVal = parseInt(inventoryDraft.accessoryLowStockThreshold, 10);
    if (isNaN(phoneVal) || isNaN(accessoryVal) || phoneVal < 0 || accessoryVal < 0) return;
    setInventorySaving(true);
    await upsertSettings({
      phoneLowStockThreshold: phoneVal,
      accessoryLowStockThreshold: accessoryVal,
    });
    setInventoryDraft(null);
    setInventorySaving(false);
  };

  // Toggles — immediate save
  const handleToggle = async (field: 'exchangeAlertsEnabled' | 'inboxAlertsEnabled', value: boolean) => {
    await upsertSettings({ [field]: value });
  };

  if (settingsDoc === undefined) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
        <PageHeader title="Settings" />
        <div className="flex items-center justify-center py-16">
          <LoadingSpinner size="md" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <PageHeader title="Settings" />

      <div className="px-4 py-4 space-y-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)' }}>

        {/* A — Store Settings */}
        <div>
          <SectionLabel label="Store" />
          <SettingsCard>
            <InputRow
              label="Store Name"
              value={storeName}
              onChange={(v) => setStoreDraft((prev) => ({ ...(prev ?? { storeName: resolved.storeName, supportContact: resolved.supportContact, telegramBotLink: resolved.telegramBotLink }), storeName: v }))}
              placeholder="e.g. TedyTech"
            />
            <InputRow
              label="Support Contact"
              value={supportContact}
              onChange={(v) => setStoreDraft((prev) => ({ ...(prev ?? { storeName: resolved.storeName, supportContact: resolved.supportContact, telegramBotLink: resolved.telegramBotLink }), supportContact: v }))}
              placeholder="e.g. +251 9XX XXX XXXX"
            />
            <InputRow
              label="Telegram Bot Link"
              value={telegramBotLink}
              onChange={(v) => setStoreDraft((prev) => ({ ...(prev ?? { storeName: resolved.storeName, supportContact: resolved.supportContact, telegramBotLink: resolved.telegramBotLink }), telegramBotLink: v }))}
              placeholder="e.g. @TedyTechBot"
              isLast
            />
            {storeDraft && (
              <ApplyButton onApply={handleStoreApply} saving={storeSaving} />
            )}
          </SettingsCard>
        </div>

        {/* B — Notifications */}
        <div>
          <SectionLabel label="Notifications" />
          <SettingsCard>
            <ToggleRow
              label="Exchange Alerts"
              subtitle="Get notified when new exchanges are submitted"
              value={resolved.exchangeAlertsEnabled}
              onChange={(v) => handleToggle('exchangeAlertsEnabled', v)}
            />
            <ToggleRow
              label="Inbox Alerts"
              subtitle="Get notified when new messages arrive"
              value={resolved.inboxAlertsEnabled}
              onChange={(v) => handleToggle('inboxAlertsEnabled', v)}
              isLast
            />
          </SettingsCard>
        </div>

        {/* C — Inventory */}
        <div>
          <SectionLabel label="Inventory" />
          <SettingsCard>
            <InputRow
              label="Phone Low Stock Threshold"
              value={phoneThreshold}
              onChange={(v) => setInventoryDraft((prev) => ({ ...(prev ?? { phoneLowStockThreshold: String(resolved.phoneLowStockThreshold), accessoryLowStockThreshold: String(resolved.accessoryLowStockThreshold) }), phoneLowStockThreshold: v }))}
              placeholder="e.g. 2"
              type="number"
            />
            <InputRow
              label="Accessory Low Stock Threshold"
              value={accessoryThreshold}
              onChange={(v) => setInventoryDraft((prev) => ({ ...(prev ?? { phoneLowStockThreshold: String(resolved.phoneLowStockThreshold), accessoryLowStockThreshold: String(resolved.accessoryLowStockThreshold) }), accessoryLowStockThreshold: v }))}
              placeholder="e.g. 2"
              type="number"
              isLast
            />
            {inventoryDraft && (
              <ApplyButton onApply={handleInventoryApply} saving={inventorySaving} />
            )}
          </SettingsCard>
          <p className="text-[11px] mt-2 px-1" style={{ color: 'var(--muted)' }}>
            Products with stock at or below this number appear in the Low Stock tab.
          </p>
        </div>

        {/* D — Appearance */}
        <div>
          <SectionLabel label="Appearance" />
          <SettingsCard>
            <div className="px-4 py-4">
              <div className="flex items-center gap-3 mb-2">
                <div
                  className="w-8 h-8 rounded-lg flex-shrink-0"
                  style={{ background: 'var(--primary)' }}
                />
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Brand Color</p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>#F5C400 — TedyTech Yellow</p>
                </div>
              </div>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                The primary color is fixed to the TedyTech brand. Alert red (#FF2D55) is used for unread badges and danger actions. The dark theme is locked for admin use.
              </p>
            </div>
          </SettingsCard>
        </div>

        {/* E — Account */}
        <div>
          <SectionLabel label="Account" />
          <SettingsCard>
            <InfoRow label="Admin Profile" value={adminLabel} />
            <InfoRow label="App Version" value={APP_VERSION} />
            <NavRow label="Backend Status" subtitle={backendSubtitle} to="/settings/backend" />
            <NavRow label="Access Control" subtitle="Admin whitelist" to="/settings/access" isLast />
          </SettingsCard>
        </div>

      </div>
    </div>
  );
}
```

**Commit:**

```bash
cd "d:/Abenier/TedyTech Admin/Admin-Ted"
git add src/pages/Settings.tsx
git commit -m "feat(settings): rebuild settings screen with 5 card sections and Convex persistence"
```

Expected: Settings screen shows 5 sections. Store/Inventory fields show Apply button when changed. Toggles save immediately. Account section shows admin profile, version, and links.

---

## Task 5: Verify Build + Deploy + Push

**Step 1: Deploy backend**

```bash
cd "d:/Abenier/TedyTech Admin/Admin-Ted"
npx convex deploy --yes
```

Expected: Deploys to fastidious-schnauzer-265 (prod). Schema updated with adminSettings table.

**Step 2: Build frontend**

```bash
cd "d:/Abenier/TedyTech Admin/Admin-Ted"
npm run build
```

Expected: Build succeeds with no TypeScript errors.

**Step 3: Push to remote**

```bash
cd "d:/Abenier/TedyTech Admin/Admin-Ted"
git push origin main
```

Expected: All Batch 3 commits pushed.

**Step 4: Verify git log shows all commits**

```bash
cd "d:/Abenier/TedyTech Admin/Admin-Ted"
git log --oneline main -8
```

---

## Verification Checklist

- [ ] ProductForm: type selector uses yellow on active, not indigo
- [ ] ProductForm: condition chips use yellow border/text when selected
- [ ] ProductForm: Save button is yellow, not indigo
- [ ] ProductForm: Exchange toggle uses yellow for ON state
- [ ] ProductForm: price hint is yellow, not blue
- [ ] ExchangeDetail: customer avatar uses primary yellow
- [ ] ExchangeDetail: Mark Accepted uses dark amber style
- [ ] ExchangeDetail: Mark Completed uses dark green style
- [ ] Dashboard: "not available" uses --badge red
- [ ] Settings: 5 card sections visible
- [ ] Settings: Store fields show Apply when changed
- [ ] Settings: Toggles save immediately
- [ ] Settings: Inventory thresholds editable
- [ ] Settings: Account section shows profile, version, links
- [ ] Build: npm run build succeeds
- [ ] Convex: npx convex deploy --yes succeeds
