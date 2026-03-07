import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from 'convex/react';
import { ErrorBoundary } from 'react-error-boundary';
import { Package, Search, X, Loader2, SlidersHorizontal, Trash2 } from 'lucide-react';
import ProductCard from '../components/ProductCard';
import EmptyState from '../components/EmptyState';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { Product, ProductType, Condition } from '../types';
import { getSearchHistory, addToSearchHistory, clearSearchHistory } from '../utils/searchHistory';

type InventoryTab = 'all' | 'inStock' | 'lowStock' | 'outOfStock' | 'exchangeEnabled' | 'archived';
type InventoryTabParam =
  | InventoryTab
  | 'instock'
  | 'lowstock'
  | 'outofstock'
  | 'exchange'
  | 'exchangeenabled';

const PRODUCT_TABS: { key: ProductType; label: string }[] = [
  { key: 'phone', label: 'Phones' },
  { key: 'accessory', label: 'Accessories' },
];
const FILTER_TABS: { key: InventoryTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'inStock', label: 'In Stock' },
  { key: 'lowStock', label: 'Low Stock' },
  { key: 'outOfStock', label: 'Out of Stock' },
  { key: 'exchangeEnabled', label: 'Exchange' },
  { key: 'archived', label: 'Archived' },
];

const CONDITIONS: { value: Condition; label: string }[] = [
  { value: 'Excellent', label: 'Excellent' },
  { value: 'Good', label: 'Good' },
  { value: 'Fair', label: 'Fair' },
  { value: 'Poor', label: 'Poor' },
];

const STORAGE_OPTIONS = [64, 128, 256, 512] as const;
const RAM_OPTIONS = [4, 6, 8, 12] as const;

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

// Module-level cache: keyed by "type-tab-filters" so each combination feels instant on re-visit.
const productCache: Partial<Record<string, Product[]>> = {};
const isProductType = (value: string | null): value is ProductType =>
  value === 'phone' || value === 'accessory';
const isInventoryTabParam = (value: string | null): value is InventoryTabParam =>
  value === 'all' ||
  value === 'instock' ||
  value === 'lowstock' ||
  value === 'outofstock' ||
  value === 'exchange' ||
  value === 'exchangeenabled' ||
  value === 'archived';

const toInventoryTab = (value: string | null): InventoryTab => {
  if (!value) return 'all';
  const normalized = value.trim().toLowerCase();
  if (!isInventoryTabParam(normalized)) return 'all';
  if (normalized === 'instock') return 'inStock';
  if (normalized === 'lowstock') return 'lowStock';
  if (normalized === 'outofstock') return 'outOfStock';
  if (normalized === 'exchange' || normalized === 'exchangeenabled') return 'exchangeEnabled';
  return normalized;
};

const toSafeProducts = (value: unknown): Product[] => (
  Array.isArray(value) ? value as Product[] : []
);

function InventoryErrorFallback({ error }: { error: Error }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'var(--bg)' }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl p-5 shadow-sm"
        style={{ background: 'var(--surface)', border: '1px solid rgba(239,68,68,0.3)' }}
      >
        <h1 className="text-lg font-semibold mb-2" style={{ color: 'var(--text)' }}>Inventory failed to render</h1>
        <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>{error.message || 'Unknown error'}</p>
        {error.stack && (
          <pre
            className="text-xs rounded-xl p-3 overflow-x-auto mb-4 whitespace-pre-wrap"
            style={{ color: '#F87171', background: 'rgba(239,68,68,0.1)' }}
          >
            {error.stack}
          </pre>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="w-full py-2.5 rounded-xl text-sm font-semibold active:scale-95 transition-transform"
          style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >
          Retry
        </button>
      </div>
    </div>
  );
}

function ProductSkeleton() {
  return (
    <div
      className="rounded-2xl p-3 flex gap-3"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="w-16 h-16 rounded-xl bg-surface-2 animate-pulse flex-shrink-0" />
      <div className="flex-1 py-1 space-y-2">
        <div className="h-2.5 bg-surface-2 rounded-full animate-pulse w-1/3" />
        <div className="h-3.5 bg-surface-2 rounded-full animate-pulse w-2/3" />
        <div className="h-2.5 bg-surface-2 rounded-full animate-pulse w-1/4" />
      </div>
      <div className="w-14 h-5 bg-surface-2 rounded-full animate-pulse self-center" />
    </div>
  );
}

function InventoryContent() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inventoryTypeParam = searchParams.get('type');
  const inventoryFilterParam = searchParams.get('filter');
  const searchParamQuery = searchParams.get('q');

  const [activeType, setActiveType] = useState<ProductType>(
    () => isProductType(inventoryTypeParam) ? inventoryTypeParam : 'phone',
  );
  // Initialise tab from URL param so Dashboard deep-links still work.
  const [tab, setTab] = useState<InventoryTab>(
    () => toInventoryTab(inventoryFilterParam),
  );
  const [searchQuery, setSearchQuery] = useState<string>(() => (searchParamQuery ?? '').trim());
  const [searchHistory, setSearchHistory] = useState<string[]>(() => getSearchHistory());
  const [searchFocused, setSearchFocused] = useState(false);
  const [confirmDecrementProduct, setConfirmDecrementProduct] = useState<Product | null>(null);
  const [pendingProductIds, setPendingProductIds] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  // committedQ is the value actually sent to the backend (debounced)
  const [committedQ, setCommittedQ] = useState<string>(() => (searchParamQuery ?? '').trim());
  // isSearching: true while the debounce timer is pending
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Advanced filter drawer
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>({});
  const [draftFilters, setDraftFilters] = useState<AdvancedFilters>({});
  const [drawerOpen, setDrawerOpen] = useState(false);

  const updateStockQuantity = useMutation(api.products.updateStockQuantity);
  const permanentDeleteProduct = useMutation(api.products.permanentDeleteProduct);
  const [confirmDeleteProduct, setConfirmDeleteProduct] = useState<Product | null>(null);

  // Number of active advanced filters — drives the indicator dot on the filter icon
  const activeFilterCount = [
    advancedFilters.condition,
    advancedFilters.priceMin,
    advancedFilters.priceMax,
    advancedFilters.storageGb,
    advancedFilters.ramGb,
    advancedFilters.hasImages,
    advancedFilters.sortBy && advancedFilters.sortBy !== 'newest',
  ].filter((v) => v !== undefined && v !== false).length;

  // Convex real-time query — returns undefined on first subscribe or when args change
  const cacheKey = `${activeType}-${tab}-${JSON.stringify(advancedFilters)}`;
  const convexProducts = useQuery(api.products.listProducts, {
    tab,
    type: activeType,
    q: committedQ || undefined,
    condition: advancedFilters.condition,
    priceMin: advancedFilters.priceMin,
    priceMax: advancedFilters.priceMax,
    storageGb: advancedFilters.storageGb,
    ramGb: advancedFilters.ramGb,
    hasImages: advancedFilters.hasImages,
  });
  const cached = toSafeProducts(productCache[cacheKey]);
  const hasConvexResult = convexProducts !== undefined;
  const products = hasConvexResult ? toSafeProducts(convexProducts) : cached;
  const loading = !hasConvexResult && cached.length === 0;

  useEffect(() => {
    if (hasConvexResult && !Array.isArray(convexProducts)) {
      console.error('[Inventory] products query returned a non-array payload', convexProducts);
    }
  }, [hasConvexResult, convexProducts]);

  // Only show skeleton when BOTH Convex and cache are empty
  const safeSearchHistory = Array.isArray(searchHistory) ? searchHistory : [];

  // Keep module-level cache warm so re-visits are instant
  useEffect(() => {
    if (hasConvexResult) {
      productCache[cacheKey] = products;
    }
  }, [cacheKey, hasConvexResult, products]);

  // Save to history on blur if the query is meaningful
  const handleSearchBlur = () => {
    setTimeout(() => setSearchFocused(false), 200);
    if (searchQuery.trim().length > 1) {
      addToSearchHistory(searchQuery.trim());
      setSearchHistory(getSearchHistory());
    }
  };

  const applyHistoryChip = (q: string) => {
    setSearchQuery(q);
    addToSearchHistory(q);
    setSearchHistory(getSearchHistory());
    setSearchFocused(false);
    searchRef.current?.blur();
  };

  const handleClearHistory = () => {
    clearSearchHistory();
    setSearchHistory([]);
  };

  // Advanced filter drawer handlers
  const openDrawer = () => {
    setDraftFilters({ ...advancedFilters });
    setDrawerOpen(true);
  };

  const handleApplyFilters = () => {
    setAdvancedFilters({ ...draftFilters });
    setDrawerOpen(false);
  };

  const handleResetFilters = () => {
    setAdvancedFilters({});
    setDraftFilters({});
    setDrawerOpen(false);
  };

  // Debounce effect: fires on every keystroke, commits search to backend after 300ms
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (!searchQuery) {
      setCommittedQ('');
      setIsSearching(false);
      return;
    }

    const isNumeric = /^[0-9]+$/.test(searchQuery);
    const minLen = isNumeric ? 3 : 2;

    if (searchQuery.length < minLen) {
      // Below minimum — clear any prior search and show default list
      setCommittedQ('');
      setIsSearching(false);
      return;
    }

    // Above minimum — show loader immediately, then commit after 300ms
    setIsSearching(true);
    debounceRef.current = setTimeout(() => {
      setIsSearching(false); // Debounce fired; query loading takes over the indicator
      setCommittedQ(searchQuery);
    }, 300);
  }, [searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // Enter key: bypass debounce and trigger immediately
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (!searchQuery) {
      setCommittedQ('');
      setIsSearching(false);
      return;
    }
    const isNumeric = /^[0-9]+$/.test(searchQuery);
    const minLen = isNumeric ? 3 : 2;
    if (searchQuery.length >= minLen) {
      setIsSearching(false);
      setCommittedQ(searchQuery);
    }
  };

  // Loader indicator: true while debounce is pending OR while Convex is fetching
  const showLoader = isSearching || (convexProducts === undefined && !!committedQ);

  // Stock management helpers
  const setProductPending = (productId: string, pending: boolean) => {
    setPendingProductIds((prev) => {
      const next = new Set(prev);
      if (pending) next.add(productId);
      else next.delete(productId);
      return next;
    });
  };

  const getProductId = (product: Product): string | null => (
    typeof product._id === 'string' && product._id.length > 0 ? product._id : null
  );
  const getProductStock = (product: Product): number => (
    typeof product.stockQuantity === 'number' ? product.stockQuantity : 0
  );

  const updateProductStock = async (productId: string | null, delta: 1 | -1) => {
    if (!productId) {
      console.error('[Inventory] cannot update stock: missing product id');
      return;
    }
    setProductPending(productId, true);
    try {
      await updateStockQuantity({ productId: productId as Id<'products'>, delta });
    } catch (err) {
      console.error(err);
    } finally {
      setProductPending(productId, false);
    }
  };

  const handleIncrement = (product: Product) => void updateProductStock(getProductId(product), 1);
  const handleDecrementRequest = (product: Product) => {
    if (getProductStock(product) <= 0) return;
    if (!getProductId(product)) {
      console.error('[Inventory] cannot decrement stock: missing product id');
      return;
    }
    setConfirmDecrementProduct(product);
  };
  const handleConfirmDecrement = () => {
    if (!confirmDecrementProduct) return;
    const productId = getProductId(confirmDecrementProduct);
    setConfirmDecrementProduct(null);
    void updateProductStock(productId, -1);
  };

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

  const showHistoryChips = searchFocused && !searchQuery && safeSearchHistory.length > 0;
  const confirmProductId = confirmDecrementProduct ? getProductId(confirmDecrementProduct) : null;
  const confirmProductStock = confirmDecrementProduct ? getProductStock(confirmDecrementProduct) : 0;
  const confirmProductName = confirmDecrementProduct &&
    typeof confirmDecrementProduct.phoneType === 'string' &&
    confirmDecrementProduct.phoneType.trim().length > 0
    ? confirmDecrementProduct.phoneType
    : 'Unnamed product';

  const inputStyle = {
    background: 'var(--surface-2)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
  };

  return (
    <div style={{ background: 'var(--bg)' }}>
      {/* Title + Search — NOT sticky, scrolls away */}
      <div style={{ background: 'var(--surface)' }}>
        <div className="px-4 pt-3 pb-2">
          <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>Inventory</h1>
        </div>
        <div className="px-4 pb-2">
          {/* Search bar + filter button */}
          <div className="flex gap-2 mb-2">
            <div className="relative flex-1">
              {showLoader ? (
                <Loader2
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 animate-spin pointer-events-none"
                  style={{ color: 'var(--primary)' }}
                />
              ) : (
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: 'var(--muted)' }}
                />
              )}
              <input
                ref={searchRef}
                type="text"
                placeholder="Search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => setSearchFocused(true)}
                onBlur={handleSearchBlur}
                className="w-full rounded-xl pl-9 pr-9 py-2.5 text-sm outline-none transition-colors"
                style={inputStyle}
              />
              {searchQuery && (
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setSearchQuery('');
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 active:scale-90 transition-transform"
                  style={{ color: 'var(--muted)' }}
                >
                  <X size={15} />
                </button>
              )}
            </div>
            {/* Advanced filter icon */}
            <button
              type="button"
              onClick={openDrawer}
              className="relative flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center active:scale-95 transition-transform"
              style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}
            >
              <SlidersHorizontal size={16} />
              {activeFilterCount > 0 && (
                <span
                  className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full"
                  style={{ background: 'var(--primary)' }}
                />
              )}
            </button>
          </div>

          {/* Recent search chips */}
          {showHistoryChips && (
            <div className="pb-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-medium" style={{ color: 'var(--muted)' }}>Recent searches</span>
                <button
                  onMouseDown={handleClearHistory}
                  className="text-[11px] font-medium active:opacity-70"
                  style={{ color: 'var(--primary)' }}
                >
                  Clear all
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {safeSearchHistory.map((h) => (
                  <button
                    key={h}
                    onMouseDown={() => applyHistoryChip(h)}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium active:scale-95 transition-transform"
                    style={{ background: 'var(--surface-2)', color: 'var(--text)' }}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs — sticky */}
      <div
        className="sticky top-0 z-20"
        style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
      >
        {/* Type tabs */}
        <div className="flex px-4" style={{ borderBottom: '1px solid var(--border)' }}>
          {PRODUCT_TABS.map((pt) => (
            <button
              key={pt.key}
              onClick={() => {
                if (pt.key === 'accessory' && tab === 'exchangeEnabled') setTab('all');
                setActiveType(pt.key);
              }}
              className="flex-1 py-2.5 text-sm font-semibold relative transition-colors"
              style={{ color: activeType === pt.key ? 'var(--primary)' : 'var(--muted)' }}
            >
              {pt.label}
              {activeType === pt.key && (
                <span
                  className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t-full"
                  style={{ background: 'var(--primary)' }}
                />
              )}
            </button>
          ))}
        </div>

        {/* Status filter chips */}
        <div className="flex gap-2 px-4 py-2 overflow-x-auto scrollbar-hide">
          {FILTER_TABS.filter((ft) => !(ft.key === 'exchangeEnabled' && activeType === 'accessory')).map((ft) => (
            <button
              key={ft.key}
              onClick={() => setTab(ft.key)}
              className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
              style={tab === ft.key
                ? { background: 'var(--primary)', color: 'var(--primary-foreground)' }
                : { background: 'var(--surface-2)', color: 'var(--muted)' }
              }
            >
              {ft.label}
            </button>
          ))}
        </div>
      </div>

      {/* Product list */}
      <div className="px-4 py-3">
        {(() => {
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

          return (
            <>
              {loading ? (
          // Skeleton — shown only on first ever load (no cache yet)
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <ProductSkeleton key={n} />
            ))}
          </div>
              ) : products.length === 0 ? (
                <EmptyState
                  icon={<Package size={28} />}
                  title="No products found"
                  subtitle={
                    committedQ
                      ? `No results for "${committedQ}"`
                      : 'Add your first product using the + button'
                  }
                />
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-medium mb-2" style={{ color: 'var(--muted)' }}>
                    {sortedProducts.length} product{sortedProducts.length !== 1 ? 's' : ''}
                    {tab !== 'all' ? ` · ${FILTER_TABS.find((ft) => ft.key === tab)?.label ?? ''}` : ''}
                  </p>
                  {sortedProducts.map((product, index) => {
              const productId = getProductId(product);
              const stockQuantity = getProductStock(product);
              const isPending = !!productId && pendingProductIds.has(productId);
              return (
                <div key={productId ?? `product-${index}`} className="space-y-1">
                  <ProductCard
                    product={product}
                    onClick={() => {
                      if (!productId) {
                        console.error('[Inventory] cannot navigate: missing product id');
                        return;
                      }
                      navigate(`/inventory/${productId}?type=${activeType}`);
                    }}
                  />
                  {tab === 'archived' ? (
                    /* Archived: show permanent delete action instead of stock controls */
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
                </div>
              );
                  })}
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* Decrement confirmation bottom sheet */}
      {confirmDecrementProduct && (
        <div className="fixed inset-0 z-[60] flex items-end bg-black/40">
          <div
            className="rounded-t-3xl w-full p-5 animate-in slide-in-from-bottom duration-200"
            style={{
              background: 'var(--surface)',
              paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
            }}
          >
            <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: 'var(--border)' }} />
            <h2 className="text-base font-bold mb-1" style={{ color: 'var(--text)' }}>Confirm stock decrease</h2>
            <p className="text-xs mb-4" style={{ color: 'var(--muted)' }}>
              {`${confirmProductName}: ${confirmProductStock} -> ${Math.max(0, confirmProductStock - 1)}`}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmDecrementProduct(null)}
                className="flex-1 py-3 rounded-xl font-semibold text-sm active:scale-95 transition-transform"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDecrement}
                disabled={!confirmProductId || pendingProductIds.has(confirmProductId)}
                className="flex-1 py-3 rounded-xl font-semibold text-sm active:scale-95 transition-transform disabled:opacity-50"
                style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Advanced Filter Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex items-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawerOpen(false)}
          />
          {/* Sheet */}
          <div
            className="relative rounded-t-3xl w-full animate-in slide-in-from-bottom duration-200"
            style={{
              background: 'var(--surface)',
              paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
            }}
          >
            {/* Handle */}
            <div className="w-10 h-1 rounded-full mx-auto mt-3 mb-1" style={{ background: 'var(--border)' }} />

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3">
              <h2 className="text-base font-bold" style={{ color: 'var(--text)' }}>Filters</h2>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="w-7 h-7 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}
              >
                <X size={14} />
              </button>
            </div>

            {/* Filter sections */}
            <div className="px-5 space-y-5 max-h-[60vh] overflow-y-auto pb-2">

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

              {/* Condition */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>Condition</p>
                <div className="flex gap-2 flex-wrap">
                  {CONDITIONS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() =>
                        setDraftFilters((prev) => ({
                          ...prev,
                          condition: prev.condition === c.value ? undefined : c.value,
                        }))
                      }
                      className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                      style={draftFilters.condition === c.value
                        ? { background: 'var(--primary)', color: 'var(--primary-foreground)', border: '1px solid var(--primary)' }
                        : { background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)' }
                      }
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Price Range */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>Price Range (ETB)</p>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    placeholder="Min ETB"
                    value={draftFilters.priceMin ?? ''}
                    onChange={(e) =>
                      setDraftFilters((prev) => ({
                        ...prev,
                        priceMin: e.target.value ? Number(e.target.value) : undefined,
                      }))
                    }
                    className="flex-1 rounded-xl px-3 py-2 text-sm outline-none transition-colors"
                    style={inputStyle}
                  />
                  <span className="text-sm font-medium" style={{ color: 'var(--muted)' }}>–</span>
                  <input
                    type="number"
                    placeholder="Max ETB"
                    value={draftFilters.priceMax ?? ''}
                    onChange={(e) =>
                      setDraftFilters((prev) => ({
                        ...prev,
                        priceMax: e.target.value ? Number(e.target.value) : undefined,
                      }))
                    }
                    className="flex-1 rounded-xl px-3 py-2 text-sm outline-none transition-colors"
                    style={inputStyle}
                  />
                </div>
                <p className="text-[11px] mt-1.5" style={{ color: 'var(--muted)' }}>Leave empty to ignore price filtering.</p>
              </div>

              {/* Storage */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>Storage</p>
                <select
                  value={draftFilters.storageGb ?? ''}
                  onChange={(e) =>
                    setDraftFilters((prev) => ({
                      ...prev,
                      storageGb: e.target.value ? Number(e.target.value) : undefined,
                    }))
                  }
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none transition-colors appearance-none"
                  style={inputStyle}
                >
                  <option value="">Any</option>
                  {STORAGE_OPTIONS.map((gb) => (
                    <option key={gb} value={gb}>
                      {gb} GB
                    </option>
                  ))}
                </select>
              </div>

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

              {/* Has Images */}
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Only show products with images</p>
                  <button
                    type="button"
                    onClick={() =>
                      setDraftFilters((prev) => ({
                        ...prev,
                        hasImages: prev.hasImages ? undefined : true,
                      }))
                    }
                    className="relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ml-3"
                    style={{ background: draftFilters.hasImages ? 'var(--primary)' : 'var(--surface-2)' }}
                  >
                    <span
                      className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                        draftFilters.hasImages ? 'translate-x-7' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
                <p className="text-[11px] mt-1" style={{ color: 'var(--muted)' }}>Turn on to hide products without photos.</p>
              </div>

            </div>

            {/* Footer buttons */}
            <div className="flex gap-3 px-5 pt-4">
              <button
                type="button"
                onClick={handleResetFilters}
                className="flex-1 py-3 rounded-xl font-semibold text-sm active:scale-95 transition-transform"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}
              >
                Reset
              </button>
              <button
                type="button"
                onClick={handleApplyFilters}
                className="flex-1 py-3 rounded-xl font-semibold text-sm active:scale-95 transition-transform"
                style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                Apply Filters
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Inventory() {
  return (
    <ErrorBoundary
      onError={(error) => {
        console.error('[Inventory] local error boundary caught an error', error);
      }}
      fallbackRender={({ error }) => (
        <InventoryErrorFallback
          error={error instanceof Error ? error : new Error(String(error))}
        />
      )}
    >
      <InventoryContent />
    </ErrorBoundary>
  );
}
