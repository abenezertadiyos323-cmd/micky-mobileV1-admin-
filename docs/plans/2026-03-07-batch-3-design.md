# Batch 3 Design: Design Consistency + Settings Structure

## Goal
Unify the color design system across admin screens, and build a practical settings screen backed by a Convex settings document.

## Approved Design Decisions
1. **Track 1 – Color**: Option B (token-based cleanup): replace all hardcoded Tailwind accent classes with CSS variable inline styles
2. **Track 2 – Settings**: Option B (cards per section): section-labelled cards on a single page
3. **ExchangeDetail accept button**: Keep semantic dark-friendly green (`rgba(16,185,129,0.9)`) for Mark Completed
4. **Save pattern**: Per-section Apply buttons for text/number inputs; toggles save immediately
5. **Schema**: `telegramBotLink` field name (broader than `botUsername`)

---

## Track 1: Color Fixes

### ProductForm.tsx — Hardcoded Colors to Replace

| Location | Current | Fix |
|----------|---------|-----|
| Type tabs active | `bg-indigo-600 text-white shadow-sm` | `background: 'var(--primary)', color: 'var(--primary-foreground)'` |
| All input `focus:ring` | `focus:ring-2 focus:ring-indigo-500` | remove ring (not needed in this dark UI) |
| Condition chips selected | `border-indigo-500 bg-indigo-950/60` + `text-indigo-400` | `background: 'rgba(245,196,0,0.12)', border: '1px solid var(--primary)'` + `color: 'var(--primary)'` |
| Price hint text | `text-blue-400` | `style={{ color: 'var(--primary)' }}` |
| Exchange OFF button | `bg-red-500 text-white shadow-sm` | `background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)'` |
| Exchange ON button | `bg-green-500 text-white shadow-sm` | `background: 'var(--primary)', color: 'var(--primary-foreground)'` |
| Save button | `bg-indigo-600 text-white` | `background: 'var(--primary)', color: 'var(--primary-foreground)'` |
| KEEP: Error borders/text | `border-red-400 bg-red-950/40`, `text-red-500`, `text-red-400` | No change (semantic validation) |
| KEEP: Archive button | `border-red-500/60 text-red-400` | No change (semantic danger) |
| KEEP: Restore button | `border-green-500 text-green-400` | No change (semantic success) |

### ExchangeDetail.tsx — Hardcoded Colors to Replace

| Location | Current | Fix |
|----------|---------|-----|
| Customer avatar background | `background: '#2563EB'` | `background: 'var(--primary)', color: 'var(--primary-foreground)'` |
| Admin override label | `color: '#FCD34D'` | `color: 'var(--primary)'` |
| Mark Accepted button | `bg-amber-500 text-white` | `background: 'rgba(245,196,0,0.15)', color: '#F5C400', border: '1px solid rgba(245,196,0,0.4)'` (uses primary color family, softer) |
| Mark Completed button | `bg-green-600 text-white` | `background: 'rgba(16,185,129,0.12)', color: '#34D399', border: '1px solid rgba(16,185,129,0.3)'` (semantic success, dark-friendly) |
| KEEP: All other semantic colors | red rejected/completed states, green trade-in value | No change |

### Dashboard.tsx — Minor Fix

| Location | Current | Fix |
|----------|---------|-----|
| "not available" tag | `text-red-400` | `style={{ color: 'var(--badge)' }}` |

---

## Track 2: Settings Screen

### Convex Schema — New `adminSettings` Table (single document)
```
adminSettings table:
  storeName?: string
  supportContact?: string
  telegramBotLink?: string
  phoneLowStockThreshold?: number    (default: 2)
  accessoryLowStockThreshold?: number (default: 2)
  exchangeAlertsEnabled?: boolean    (default: true)
  inboxAlertsEnabled?: boolean       (default: true)
  updatedAt: number
```

**No indexes needed** — single document, always fetched by full scan.

### Convex Backend — New `convex/adminSettings.ts`
- `getSettings()` — returns first doc or null
- `upsertSettings(patch)` — upsert pattern: get existing, patch or insert

### Settings Screen Structure
```
Settings
├── [A] Store Settings (card)
│   ├── Store Name (text input + Apply)
│   ├── Support Contact (text input + Apply)
│   └── Telegram Bot Link (text input + Apply)
│
├── [B] Notifications (card)
│   ├── Exchange Alerts (toggle → immediate save)
│   └── Inbox Alerts (toggle → immediate save)
│
├── [C] Inventory (card)
│   ├── Phone Low Stock Threshold (number input)
│   ├── Accessory Low Stock Threshold (number input)
│   └── [Apply button]
│
├── [D] Appearance (card)
│   └── Brand color swatch + note (informational)
│
└── [E] Account (card)
    ├── Admin Profile (display)
    ├── App Version (display)
    ├── Backend Status → /settings/backend (link)
    └── Access Control → /settings/access (link)
```

### UX Rules
- Text/number inputs: local draft state + "Apply" button per card
- Toggles: immediate `upsertSettings` call on change
- No unsaved-changes warnings (admin tool, not critical data)
- Loading state: show skeleton or spinner while `useQuery` is loading
- Error state: silent (Convex handles reconnection)
- Section headers: small uppercase tracking-wide label above each card
