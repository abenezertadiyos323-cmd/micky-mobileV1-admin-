# Micky Mobile Admin Mini App

A **Telegram-embedded admin system** for a phone-selling business (Micky Mobile). Built as a mobile-first mini app for daily operations: inventory management, customer inbox, and exchange request handling.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Vite + React + TypeScript |
| Styling | Tailwind CSS v4 |
| Routing | React Router v7 |
| Icons | Lucide React |
| Platform | Telegram Mini App |
| Backend (future) | Convex |

---

## Getting Started

### Install

```bash
pnpm install
```

### Run (Development)

```bash
pnpm dev
```

### Build (Production)

```bash
pnpm build
```

### Preview Build

```bash
pnpm preview
```

---

## Project Structure

```
src/
├── pages/
│   ├── Dashboard.tsx         # Home screen with stats + recent activity
│   ├── Inventory.tsx         # Product list with brand filter tabs
│   ├── ProductForm.tsx       # Add / Edit product form
│   ├── Inbox.tsx             # Thread list with Hot/Warm/Cold tabs
│   ├── ThreadDetail.tsx      # Chat conversation view
│   ├── Exchanges.tsx         # Exchange list with Hot/Warm/Cold tabs
│   ├── ExchangeDetail.tsx    # Exchange detail + action buttons
│   └── Settings.tsx          # Settings placeholder
├── components/
│   ├── Layout.tsx            # Main layout with bottom nav + FAB
│   ├── BottomNav.tsx         # Bottom navigation bar
│   ├── FloatingActionButton.tsx
│   ├── StatCard.tsx
│   ├── ProductCard.tsx
│   ├── ThreadCard.tsx
│   ├── ExchangeCard.tsx
│   ├── TabBar.tsx
│   ├── PageHeader.tsx
│   ├── EmptyState.tsx
│   └── LoadingSpinner.tsx
├── lib/
│   ├── api.ts                # Mock API service layer (Convex placeholder)
│   ├── mockData.ts           # Mock data matching DATA V2 schema
│   ├── telegram.ts           # Telegram WebApp SDK helper
│   └── utils.ts              # Utility functions
├── types/
│   └── index.ts              # TypeScript types for all entities
└── hooks/                    # Custom hooks (reserved)
```

---

## Screens

1. **Dashboard** - Stats cards, quick actions, recent activity
2. **Inventory** - Products with brand filter (All/iPhone/Samsung/Tecno/Infinix/Xiaomi/Oppo/Other)
3. **Add/Edit Product** - Full form with condition picker, exchange toggle, archive
4. **Inbox** - Hot/Warm/Cold tabs, chat view, exchange cards pinned in thread
5. **Exchanges** - Hot/Warm/Cold tabs, exchange detail with Send Quote modal
6. **Settings** - Admin profile, placeholder settings

---

## Hot / Warm / Cold Classification

**Hot:** Customer messaged within 2h OR budget mentioned OR trade-in value > 50K ETB

**Warm:** Clicked Continue OR sent message OR admin replied

**Cold:** No engagement + submitted more than 24h ago

**Priority:** Hot > Warm > Cold (one tab only)

---

## Exchange Status Flow

```
Pending -> Quoted (Send Quote) -> Accepted -> Completed
                                           -> Rejected
```

---

## Business Rules

- Currency: ETB only
- Pickup at PO Box 014 only
- No payments tracked in MVP
- Thread auto-closes on Completed/Rejected
- Low stock = stockQuantity <= 2
- No manual thread close button

---

## Future: Convex Backend

Replace `src/lib/api.ts` mock functions with real Convex queries/mutations.
Schema is ready in `convex_schema_DATA_V2.ts`.
