import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from 'convex/react';
import { Camera, Archive, RotateCcw, X } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { getTelegramUser } from '../lib/telegram';
import { processImage } from '../lib/imageProcessor';
import { formatETB, getStockStatus } from '../lib/utils';
import { normalizePhoneType, validatePhoneType } from '../lib/phoneTypeUtils';
import { getBackendInfo } from '../lib/backend';
import type { Condition, ProductType } from '../types';

const CONDITIONS: Condition[] = ['New', 'Like New', 'Excellent', 'Good', 'Fair', 'Poor'];
const CONDITION_DESCRIPTIONS: Record<Condition, string> = {
  New: 'Sealed box, never used',
  'Like New': 'Opened but mint, no marks',
  Excellent: 'Barely used, minimal wear',
  Good: 'Light wear, fully functional',
  Fair: 'Visible wear, all features work',
  Poor: 'Heavy wear or minor issues',
};

interface FormData {
  type: ProductType;
  phoneType: string;
  ram: string;
  storage: string;
  condition: Condition | '';
  price: number | null;
  stockQuantity: string;
  exchangeEnabled: boolean;
  description: string;
  // Additional specifications
  screenSize: string;
  battery: string;
  mainCamera: string;
  selfieCamera: string;
  simType: string;
  color: string;
  operatingSystem: string;
  features: string;
}

interface ImageSlot {
  preview: string;
  blob?: Blob;
}

const IMAGE_SLOT_COUNT = 3;

const formatPriceForInput = (price: number) => price.toLocaleString('en-US');

const parsePriceInput = (value: string): number | null => {
  const digitsOnly = value.replace(/\D/g, '');
  if (!digitsOnly) return null;
  const parsed = Number.parseInt(digitsOnly, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const isProductType = (value: string | null): value is ProductType =>
  value === 'phone' || value === 'accessory';

export default function ProductForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const isEdit = Boolean(id);
  const searchType = searchParams.get('type');
  const defaultType: ProductType = isProductType(searchType) ? searchType : 'phone';

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>({
    type: defaultType,
    phoneType: '',
    ram: '',
    storage: '',
    condition: '',
    price: null,
    stockQuantity: '1',
    exchangeEnabled: false,
    description: '',
    screenSize: '',
    battery: '',
    mainCamera: '',
    selfieCamera: '',
    simType: '',
    color: '',
    operatingSystem: '',
    features: '',
  });
  const [priceText, setPriceText] = useState('');
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [imageSlots, setImageSlots] = useState<Array<ImageSlot | null>>(
    () => Array.from({ length: IMAGE_SLOT_COUNT }, () => null),
  );
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formPopulated = useRef(false);

  const user = getTelegramUser();
  const getInventoryPath = () => {
    const queryType = searchParams.get('type');
    const inventoryType = isProductType(queryType) ? queryType : form.type;
    return `/inventory?type=${inventoryType}`;
  };

  // ---- Convex: load existing product (edit mode only) ----
  const existingProduct = useQuery(
    api.products.getProductById,
    isEdit && id ? { productId: id as Id<'products'> } : 'skip',
  );
  const loading = isEdit && existingProduct === undefined;

  // Populate form once when the query first returns a result
  useEffect(() => {
    if (existingProduct && !formPopulated.current) {
      formPopulated.current = true;
      setForm({
        type: existingProduct.type,
        phoneType: existingProduct.phoneType ?? '',
        ram: existingProduct.ram ?? '',
        storage: existingProduct.storage ?? '',
        condition: existingProduct.condition ?? '',
        price: existingProduct.price,
        stockQuantity: String(existingProduct.stockQuantity),
        exchangeEnabled: existingProduct.type === 'phone' ? existingProduct.exchangeEnabled : false,
        description: existingProduct.description ?? '',
        screenSize: existingProduct.screenSize ?? '',
        battery: existingProduct.battery ?? '',
        mainCamera: existingProduct.mainCamera ?? '',
        selfieCamera: existingProduct.selfieCamera ?? '',
        simType: existingProduct.simType ?? '',
        color: existingProduct.color ?? '',
        operatingSystem: existingProduct.operatingSystem ?? '',
        features: existingProduct.features ?? '',
      });
      setPriceText(existingProduct.price > 0 ? formatPriceForInput(existingProduct.price) : '');
      const existingImages = Array.isArray(existingProduct.images) ? existingProduct.images : [];
      setImageSlots(
        Array.from({ length: IMAGE_SLOT_COUNT }, (_, index) => {
          const url = existingImages[index];
          if (typeof url !== 'string' || url.trim().length === 0) return null;
          return { preview: url };
        }),
      );
    }
  }, [existingProduct]);

  // Accessories never support exchange, so clear any stale truthy state.
  useEffect(() => {
    if (form.type === 'accessory' && form.exchangeEnabled) {
      setForm((prev) => ({ ...prev, exchangeEnabled: false }));
    }
  }, [form.type, form.exchangeEnabled]);

  // ---- Convex mutations ----
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const getStorageUrl = useMutation(api.files.getStorageUrl);
  const createProductMutation = useMutation(api.products.createProduct);
  const updateProductMutation = useMutation(api.products.updateProduct);
  const archiveProductMutation = useMutation(api.products.archiveProduct);
  const restoreProductMutation = useMutation(api.products.restoreProduct);

  // ---- Image picker ----
  const handleSlotPress = (slotIndex: number) => {
    setPickerSlot(slotIndex);
    fileInputRef.current?.click();
  };

  const handleRemoveImage = (slotIndex: number) => {
    setImageSlots((prev) => {
      const next = [...prev];
      next[slotIndex] = null;
      return next;
    });
    if (saveError) setSaveError(null);
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || pickerSlot === null) return;
    e.target.value = '';
    const slotIndex = pickerSlot;
    const { blob, previewUrl } = await processImage(file, 1200, 0.8);
    setImageSlots((prev) => {
      const next = [...prev];
      next[slotIndex] = { blob, preview: previewUrl };
      return next;
    });
    setPickerSlot(null);
  };

  // Upload newly selected images and return URL strings in slot order.
  const uploadImageUrls = async (): Promise<string[]> => {
    const uploadedBySlot = new Map<number, string>();

    for (let slotIndex = 0; slotIndex < imageSlots.length; slotIndex += 1) {
      const slot = imageSlots[slotIndex];
      if (!slot?.blob) continue;

      const uploadUrl = await generateUploadUrl({});
      const resp = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': slot.blob.type },
        body: slot.blob,
      });
      if (!resp.ok) {
        throw new Error(`Image ${slotIndex + 1} upload failed`);
      }

      const { storageId } = (await resp.json()) as { storageId?: string };
      if (!storageId) {
        throw new Error(`Image ${slotIndex + 1} upload response missing storageId`);
      }

      const resolvedUrl = await getStorageUrl({ storageId: storageId as Id<'_storage'> });
      if (!resolvedUrl || typeof resolvedUrl !== 'string') {
        throw new Error(`Image ${slotIndex + 1} URL resolution failed`);
      }

      uploadedBySlot.set(slotIndex, resolvedUrl);
    }

    return imageSlots
      .map((slot, slotIndex) => {
        const uploadedUrl = uploadedBySlot.get(slotIndex);
        if (uploadedUrl) return uploadedUrl;
        if (!slot || slot.blob) return null;
        const existingUrl = slot.preview.trim();
        return existingUrl.length > 0 ? existingUrl : null;
      })
      .filter((url): url is string => url !== null)
      .slice(0, IMAGE_SLOT_COUNT);
  };

  // ---- Validation ----
  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof FormData, string>> = {};
    const validation = validatePhoneType(form.phoneType);
    if (!validation.valid) newErrors.phoneType = validation.error || 'Phone type is required';
    if (form.price === null || !Number.isFinite(form.price) || form.price <= 0) newErrors.price = 'Valid price required';
    if (!form.stockQuantity || Number(form.stockQuantity) < 0) newErrors.stockQuantity = 'Valid quantity required';
    if (form.type === 'phone' && !form.storage) newErrors.storage = 'Storage required for phones';
    if (form.type === 'phone' && !form.condition) newErrors.condition = 'Condition required for phones';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // ---- Save: upload images then create / update product ----
  const handleSave = async () => {
    setSaveError(null);
    if (!validate()) return;

    // Safety net: re-derive price directly from the displayed priceText string.
    // This guarantees we never send NaN, null, or a comma-formatted string to Convex
    // even if form.price somehow desynchronised from priceText.
    const safePrice = parsePriceInput(priceText);
    if (safePrice === null || !Number.isFinite(safePrice) || safePrice <= 0) {
      setErrors((prev) => ({ ...prev, price: 'Valid price required' }));
      return;
    }

    setSaving(true);
    try {
      const allImages = await uploadImageUrls();

      const common = {
        type: form.type,
        phoneType: normalizePhoneType(form.phoneType),
        ram: form.ram || undefined,
        storage: form.storage || undefined,
        condition: (form.condition as Condition) || undefined,
        price: safePrice,
        stockQuantity: Number(form.stockQuantity),
        exchangeEnabled: form.type === 'phone' ? form.exchangeEnabled : false,
        description: form.description || undefined,
        images: allImages,
        updatedBy: String(user.id),
        // Additional specifications (only send if not empty)
        screenSize: form.screenSize || undefined,
        battery: form.battery || undefined,
        mainCamera: form.mainCamera || undefined,
        selfieCamera: form.selfieCamera || undefined,
        simType: form.simType || undefined,
        color: form.color || undefined,
        operatingSystem: form.operatingSystem || undefined,
        features: form.features || undefined,
      };

      if (isEdit && id) {
        await updateProductMutation({ productId: id as Id<'products'>, ...common });
      } else {
        await createProductMutation({ ...common, createdBy: String(user.id) });
      }
      navigate(getInventoryPath());
    } catch (err) {
      console.error('[ProductForm] save failed:', err);
      setSaveError(
        err instanceof Error ? err.message : 'Save failed — please try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!id) return;
    setSaving(true);
    await archiveProductMutation({ productId: id as Id<'products'> });
    navigate(getInventoryPath());
  };

  const handleRestore = async () => {
    if (!id) return;
    setSaving(true);
    await restoreProductMutation({ productId: id as Id<'products'> });
    navigate(getInventoryPath());
  };

  const update = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value } as FormData;
      if (key === 'type' && value === 'accessory') {
        next.exchangeEnabled = false;
      }
      return next;
    });
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
    if (saveError) setSaveError(null);
  };

  const handlePriceChange = (value: string) => {
    const parsed = parsePriceInput(value);
    update('price', parsed);
    setPriceText(parsed === null ? '' : formatPriceForInput(parsed));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (isEdit && existingProduct === null) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-bg gap-3 px-6 text-center">
        <p className="text-app-text font-semibold">Product not found</p>
        <p className="text-muted text-sm">This product may have been deleted.</p>
        <button
          onClick={() => navigate(getInventoryPath())}
          className="mt-2 text-primary text-sm font-semibold active:scale-95 transition-transform"
        >
          ← Back to Inventory
        </button>
      </div>
    );
  }

  const isPhone = form.type === 'phone';
  const stockStatus = getStockStatus(Number(form.stockQuantity) || 0);
  const debugBackendInfo = getBackendInfo(import.meta.env.VITE_CONVEX_URL ?? '');
  const debugHostname = debugBackendInfo.hostname ?? debugBackendInfo.label ?? 'unset';

  return (
    <div className="min-h-screen bg-bg">
      <PageHeader
        title={isEdit ? 'Edit Product' : `Add ${defaultType === 'phone' ? 'Phone' : 'Accessory'}`}
        showBack
      />

        <div className="px-4 py-4 space-y-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}>
          {/* Images */}
          <div className="card-interactive p-4 cursor-default">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Images</p>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileSelected}
            />

            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: IMAGE_SLOT_COUNT }, (_, slotIndex) => {
                const displayUrl = imageSlots[slotIndex]?.preview;
                return (
                  <div key={slotIndex} className="space-y-1">
                    <p className="text-[11px] text-muted font-medium">Upload Image {slotIndex + 1}</p>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => handleSlotPress(slotIndex)}
                        className="w-full h-20 rounded-xl border-2 border-dashed flex items-center justify-center bg-surface-2 overflow-hidden active:scale-95 transition-transform border-[var(--border)]"
                      >
                        {displayUrl ? (
                          <img src={displayUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Camera size={20} className="text-muted" />
                        )}
                      </button>
                      {displayUrl && (
                        <button
                          type="button"
                          onClick={() => handleRemoveImage(slotIndex)}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center active:scale-95 transition-transform"
                          aria-label={`Remove image ${slotIndex + 1}`}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-muted mt-2">Upload up to 3 images. Remove any image with the X button.</p>
          </div>

          {/* Basic Info */}
          <div className="card-interactive p-4 space-y-4 cursor-default">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide">Basic Info</p>

            {/* Type (new products only) */}
            {!isEdit && (
              <div>
                <label className="text-xs font-medium text-app-text mb-1.5 block">Type</label>
                <div className="flex gap-2">
                  {(['phone', 'accessory'] as ProductType[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => update('type', t)}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold capitalize transition-all ${form.type === t
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-surface-2 text-muted'
                        }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Phone Type / Accessory Name */}
            <div>
              <label className="text-xs font-medium text-app-text mb-1.5 block">
                {isPhone ? 'Phone Type *' : 'Accessory Name *'}
              </label>
              <input
                type="text"
                value={form.phoneType}
                onChange={(e) => update('phoneType', e.target.value)}
                placeholder={isPhone ? 'e.g. iPhone 13 Pro Max' : 'e.g. AirPods Pro 2nd Gen'}
                className={`w-full bg-surface-2 border rounded-xl px-3 py-2.5 text-sm text-app-text placeholder:text-muted outline-none focus:ring-2 focus:ring-indigo-500 transition-colors ${errors.phoneType ? 'border-red-400 bg-red-950/40' : 'border-[var(--border)]'
                  }`}
              />
              {errors.phoneType && <p className="text-xs text-red-500 mt-1">{errors.phoneType}</p>}
            </div>

            {/* Phone-specific fields */}
            {isPhone && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-app-text mb-1.5 block">RAM</label>
                    <input
                      type="text"
                      value={form.ram}
                      onChange={(e) => update('ram', e.target.value)}
                      placeholder="e.g. 8GB"
                      className="w-full bg-surface-2 border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-app-text placeholder:text-muted outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-app-text mb-1.5 block">Storage *</label>
                    <input
                      type="text"
                      value={form.storage}
                      onChange={(e) => update('storage', e.target.value)}
                      placeholder="e.g. 256GB"
                      className={`w-full bg-surface-2 border rounded-xl px-3 py-2.5 text-sm text-app-text placeholder:text-muted outline-none focus:ring-2 focus:ring-indigo-500 transition-colors ${errors.storage ? 'border-red-400 bg-red-950/40' : 'border-[var(--border)]'
                        }`}
                    />
                    {errors.storage && <p className="text-xs text-red-500 mt-1">{errors.storage}</p>}
                  </div>
                </div>

                {/* Condition */}
                <div>
                  <label className="text-xs font-medium text-app-text mb-1.5 block">Condition *</label>
                  <div className="grid grid-cols-2 gap-2">
                    {CONDITIONS.map((c) => (
                      <button
                        key={c}
                        onClick={() => update('condition', c)}
                        className={`p-2.5 rounded-xl border text-left transition-all ${form.condition === c
                          ? 'border-indigo-500 bg-indigo-950/60'
                          : 'border-[var(--border)] bg-surface-2'
                          }`}
                      >
                        <p className={`text-xs font-semibold ${form.condition === c ? 'text-indigo-400' : 'text-app-text'}`}>{c}</p>
                        <p className="text-[10px] text-muted mt-0.5">{CONDITION_DESCRIPTIONS[c]}</p>
                      </button>
                    ))}
                  </div>
                  {errors.condition && <p className="text-xs text-red-500 mt-1">{errors.condition}</p>}
                </div>
              </>
            )}
          </div>

          {/* Phone Specifications */}
          {isPhone && (
            <div className="card-interactive p-4 space-y-4 cursor-default">
              <p className="text-xs font-semibold text-muted uppercase tracking-wide">Phone Specifications</p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-app-text mb-1.5 block">Screen Size</label>
                  <input
                    type="text"
                    value={form.screenSize}
                    onChange={(e) => update('screenSize', e.target.value)}
                    placeholder="e.g. 6.7 inches"
                    className="w-full bg-surface-2 border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-app-text placeholder:text-muted outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-app-text mb-1.5 block">Battery</label>
                  <input
                    type="text"
                    value={form.battery}
                    onChange={(e) => update('battery', e.target.value)}
                    placeholder="e.g. 3687 mAh"
                    className="w-full bg-surface-2 border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-app-text placeholder:text-muted outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-app-text mb-1.5 block">Main Camera</label>
                  <input
                    type="text"
                    value={form.mainCamera}
                    onChange={(e) => update('mainCamera', e.target.value)}
                    placeholder="e.g. Triple 12MP"
                    className="w-full bg-surface-2 border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-app-text placeholder:text-muted outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-app-text mb-1.5 block">Selfie Camera</label>
                  <input
                    type="text"
                    value={form.selfieCamera}
                    onChange={(e) => update('selfieCamera', e.target.value)}
                    placeholder="e.g. 12MP"
                    className="w-full bg-surface-2 border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-app-text placeholder:text-muted outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-app-text mb-1.5 block">SIM Type</label>
                  <input
                    type="text"
                    value={form.simType}
                    onChange={(e) => update('simType', e.target.value)}
                    placeholder="e.g. Single Nano SIM"
                    className="w-full bg-surface-2 border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-app-text placeholder:text-muted outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-app-text mb-1.5 block">Color</label>
                  <input
                    type="text"
                    value={form.color}
                    onChange={(e) => update('color', e.target.value)}
                    placeholder="e.g. Blue"
                    className="w-full bg-surface-2 border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-app-text placeholder:text-muted outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-app-text mb-1.5 block">Operating System</label>
                  <input
                    type="text"
                    value={form.operatingSystem}
                    onChange={(e) => update('operatingSystem', e.target.value)}
                    placeholder="e.g. iOS"
                    className="w-full bg-surface-2 border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-app-text placeholder:text-muted outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-app-text mb-1.5 block">Features</label>
                <textarea
                  value={form.features}
                  onChange={(e) => update('features', e.target.value)}
                  placeholder="e.g. Face ID, NFC, Stereo Speakers"
                  rows={2}
                  className="w-full bg-surface-2 border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-app-text placeholder:text-muted outline-none focus:ring-2 focus:ring-indigo-500 transition-colors resize-none"
                />
              </div>
            </div>
          )}

          {/* Pricing & Stock */}
          <div className="card-interactive p-4 space-y-4 cursor-default">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide">Pricing & Stock</p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-app-text mb-1.5 block">Price (ETB) *</label>
                <input
                  type="text"
                  value={priceText}
                  onChange={(e) => handlePriceChange(e.target.value)}
                  placeholder="e.g. 85000"
                  inputMode="numeric"
                  className={`w-full bg-surface-2 border rounded-xl px-3 py-2.5 text-sm text-app-text placeholder:text-muted outline-none focus:ring-2 focus:ring-indigo-500 transition-colors ${errors.price ? 'border-red-400 bg-red-950/40' : 'border-[var(--border)]'
                    }`}
                />
                {errors.price && <p className="text-xs text-red-500 mt-1">{errors.price}</p>}
                {form.price !== null && form.price > 0 && (
                  <p className="text-[11px] text-blue-400 mt-1">{formatETB(form.price)}</p>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-app-text mb-1.5 block">Stock Qty *</label>
                <input
                  type="number"
                  value={form.stockQuantity}
                  onChange={(e) => update('stockQuantity', e.target.value)}
                  placeholder="e.g. 3"
                  min="0"
                  className={`w-full bg-surface-2 border rounded-xl px-3 py-2.5 text-sm text-app-text placeholder:text-muted outline-none focus:ring-2 focus:ring-indigo-500 transition-colors ${errors.stockQuantity ? 'border-red-400 bg-red-950/40' : 'border-[var(--border)]'
                    }`}
                />
                {form.stockQuantity !== '' && (
                  <p className={`text-[11px] mt-1 font-medium ${stockStatus.color}`}>
                    {stockStatus.label}
                  </p>
                )}
              </div>
            </div>

            {/* Exchange Available — segmented pill toggle */}
            {isPhone && (
              <div>
                <p className="text-sm font-semibold text-app-text mb-2">Exchange Available</p>
                <div className="flex rounded-xl border border-[var(--border)] bg-surface-2 p-1 gap-1">
                  <button
                    type="button"
                    onClick={() => update('exchangeEnabled', false)}
                    className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${!form.exchangeEnabled
                      ? 'bg-red-500 text-white shadow-sm'
                      : 'text-muted'
                      }`}
                  >
                    Exchange OFF
                  </button>
                  <button
                    type="button"
                    onClick={() => update('exchangeEnabled', true)}
                    className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${form.exchangeEnabled
                      ? 'bg-green-500 text-white shadow-sm'
                      : 'text-muted'
                      }`}
                  >
                    Exchange ON
                  </button>
                </div>
                <p className="text-[11px] text-muted mt-1.5 px-0.5">
                  {form.exchangeEnabled
                    ? '✓ Customers can submit trade-in requests for this phone'
                    : 'This phone is not available for exchange or trade-in'}
                </p>
              </div>
            )}
          </div>
{/* Description */}
          <div className="card-interactive p-4 cursor-default">
            <label className="text-xs font-semibold text-muted uppercase tracking-wide mb-3 block">
              Description
            </label>
            <textarea
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
              placeholder="Short summary about the product (color, accessories included, etc.)"
              rows={3}
              className="w-full bg-surface-2 border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-app-text placeholder:text-muted outline-none focus:ring-2 focus:ring-indigo-500 transition-colors resize-none"
            />
          </div>

          {/* Save error banner */}
          {saveError && (
            <div className="bg-red-950/50 border border-red-500/40 rounded-xl px-4 py-3 text-sm text-red-400 font-medium">
              {saveError}
            </div>
          )}

          {/* Primary Save button */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="w-full py-4 bg-indigo-600 text-white font-semibold btn-interactive rounded-xl shadow-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : `Add ${form.type === 'phone' ? 'Phone' : 'Accessory'}`}
          </button>

          {/* DEBUG — visible in Telegram to confirm which Convex deployment is active */}
          {import.meta.env.DEV && (
            <p className="text-center text-[10px] text-muted font-mono">
              Convex: {debugHostname}
            </p>
          )}

          {/* Archive / Restore (Edit only) */}
          {isEdit && existingProduct && (
            <div className="card-interactive p-4 cursor-default mt-4">
              <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Danger Zone</p>
              {existingProduct.archivedAt ? (
                <button
                  onClick={handleRestore}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-green-500 text-green-400 font-semibold text-sm btn-interactive disabled:opacity-50"
                >
                  <RotateCcw size={16} />
                  Restore Product
                </button>
              ) : (
                <button
                  onClick={handleArchive}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-red-500/60 text-red-400 font-semibold text-sm btn-interactive disabled:opacity-50"
                >
                  <Archive size={16} />
                  Archive Product
                </button>
              )}
              <p className="text-[11px] text-muted mt-2 text-center">
                {existingProduct.archivedAt
                  ? 'Restore to make product visible again'
                  : 'Archived products are hidden from customers. Auto-deleted after 30 days.'}
              </p>
            </div>
          )}
      </div>
    </div>
  );
}


