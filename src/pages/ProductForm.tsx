import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from 'convex/react';
import { Camera, Archive, RotateCcw, X, Plus, Trash } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { getTelegramUser } from '../lib/telegram';
import { processImage } from '../lib/imageProcessor';
import { formatETB, getStockStatus } from '../lib/utils';
import { normalizePhoneType, validatePhoneType } from '../lib/phoneTypeUtils';
import { PHONE_STORAGE_OPTIONS } from '../lib/storageOptions';
import type { Condition, ProductType } from '../types';

const CONDITIONS: Condition[] = ['New', 'Like New', 'Excellent', 'Good', 'Fair', 'Poor'];

const RAM_OPTIONS = ['8GB', '12GB'] as const;

export interface VariantInput {
  id: string; // UI key
  storage: string;
  ram: string; // For Samsung
  priceText: string;
  stockQuantity: string;
}

interface FormData {
  type: ProductType;
  brand: 'iPhone' | 'Samsung' | '';
  phoneType: string;
  condition: Condition | '';
  exchangeEnabled: boolean;
  description: string;
  
  // Specifics
  batteryHealth: string;
  modelOrigin: string; // iPhone
  simType: string; // Uses as SIM Type / SIM Slot
  network: string; // Samsung
  
  // Variant system
  variants: VariantInput[];
  
  // Accessory fallback
  priceText: string;
  stockQuantity: string;
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
    brand: defaultType === 'phone' ? 'iPhone' : '',
    phoneType: '',
    condition: '',
    exchangeEnabled: false,
    description: '',
    batteryHealth: '',
    modelOrigin: '',
    simType: '',
    network: '',
    variants: [{ id: Date.now().toString(), storage: '', ram: '', priceText: '', stockQuantity: '1' }],
    priceText: '',
    stockQuantity: '1',
  });
  
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [imageSlots, setImageSlots] = useState<Array<ImageSlot | null>>(
    () => Array.from({ length: IMAGE_SLOT_COUNT }, () => null),
  );
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formPopulated = useRef(false);

  const user = getTelegramUser();
  const getInventoryPath = () => {
    return `/inventory?type=${form.type}`;
  };

  const existingProduct = useQuery(
    api.products.getProductById,
    isEdit && id ? { productId: id as Id<'products'> } : 'skip',
  );
  const loading = isEdit && existingProduct === undefined;

  useEffect(() => {
    if (existingProduct && !formPopulated.current) {
      formPopulated.current = true;
      
      let mappedBrand: 'iPhone' | 'Samsung' | '' = '';
      if (existingProduct.type === 'phone') {
        const legacyBrand = existingProduct.brand?.toLowerCase() || '';
        if (legacyBrand.includes('apple') || legacyBrand.includes('iphone')) mappedBrand = 'iPhone';
        else if (legacyBrand.includes('samsung')) mappedBrand = 'Samsung';
        else mappedBrand = 'iPhone'; // default
      }

      setForm({
        type: existingProduct.type,
        brand: mappedBrand,
        phoneType: existingProduct.phoneType ?? '',
        condition: (existingProduct.condition as Condition) ?? '',
        exchangeEnabled: existingProduct.type === 'phone' ? existingProduct.exchangeEnabled : false,
        description: existingProduct.description ?? '',
        batteryHealth: existingProduct.batteryHealth ?? '',
        modelOrigin: existingProduct.modelOrigin ?? '',
        simType: existingProduct.simType ?? '',
        network: existingProduct.network ?? '',
        variants: existingProduct.variants?.map((v, i) => ({
          id: String(i),
          storage: v.storage,
          ram: v.ram ?? '',
          priceText: v.price > 0 ? formatPriceForInput(v.price) : '',
          stockQuantity: String(v.stock)
        })) || [{ id: Date.now().toString(), storage: '', ram: '', priceText: '', stockQuantity: '1' }],
        priceText: existingProduct.price > 0 ? formatPriceForInput(existingProduct.price) : '',
        stockQuantity: String(existingProduct.stockQuantity),
      });
      
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

  useEffect(() => {
    if (form.type === 'accessory' && form.exchangeEnabled) {
      setForm((prev) => ({ ...prev, exchangeEnabled: false }));
    }
  }, [form.type, form.exchangeEnabled]);

  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const getStorageUrl = useMutation(api.files.getStorageUrl);
  const createProductMutation = useMutation(api.products.createProduct);
  const updateProductMutation = useMutation(api.products.updateProduct);
  const archiveProductMutation = useMutation(api.products.archiveProduct);
  const restoreProductMutation = useMutation(api.products.restoreProduct);

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
      if (!resp.ok) throw new Error(`Image ${slotIndex + 1} upload failed`);
      const { storageId } = (await resp.json()) as { storageId?: string };
      const resolvedUrl = await getStorageUrl({ storageId: storageId as Id<'_storage'> });
      uploadedBySlot.set(slotIndex, resolvedUrl as string);
    }
    return imageSlots
      .map((slot, slotIndex) => uploadedBySlot.get(slotIndex) || (slot && !slot.blob ? slot.preview : null))
      .filter((url): url is string => url !== null)
      .slice(0, IMAGE_SLOT_COUNT);
  };

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof FormData, string>> = {};
    const validation = validatePhoneType(form.phoneType);
    if (!validation.valid) newErrors.phoneType = validation.error || 'Phone type is required';
    if (form.type === 'phone' && !form.condition) newErrors.condition = 'Condition required for phones';
    
    if (form.type === 'phone') {
        if (form.variants.length === 0) newErrors.variants = 'Must add at least one variant';
        const invalidVariants = form.variants.filter(v => !v.storage || !parsePriceInput(v.priceText) || !v.stockQuantity);
        if (invalidVariants.length > 0) newErrors.variants = 'All variants must have storage, valid price, and stock';
    } else {
        const safePrice = parsePriceInput(form.priceText);
        if (safePrice === null || !Number.isFinite(safePrice) || safePrice <= 0) newErrors.priceText = 'Valid price required';
        if (!form.stockQuantity || Number(form.stockQuantity) < 0) newErrors.stockQuantity = 'Valid quantity required';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    setSaveError(null);
    if (!validate()) return;
    setSaving(true);
    
    try {
      const allImages = await uploadImageUrls();
      const sellerId = String(user.id);
      
      const mappedVariants = form.type === 'phone' ? form.variants.map(v => ({
        storage: v.storage,
        ram: form.brand === 'Samsung' && v.ram ? v.ram : undefined,
        price: parsePriceInput(v.priceText) || 0,
        stock: Number(v.stockQuantity) || 0
      })).filter(v => v.price > 0 && v.stock >= 0) : undefined;
      
      const basePrice = form.type === 'phone' && mappedVariants && mappedVariants.length > 0
        ? Math.min(...mappedVariants.map(v => v.price))
        : parsePriceInput(form.priceText) || 0;
        
      const baseStock = form.type === 'phone' && mappedVariants
        ? mappedVariants.reduce((sum, v) => sum + v.stock, 0)
        : Number(form.stockQuantity);

      const common = {
        type: form.type,
        brand: form.type === 'phone' ? (form.brand === 'iPhone' ? 'Apple' : 'Samsung') : undefined,
        phoneType: normalizePhoneType(form.phoneType),
        storage: form.type === 'phone' && mappedVariants ? mappedVariants.map(v => v.storage).join(', ') : undefined,
        condition: form.type === 'phone' ? (form.condition as Condition) || undefined : undefined,
        price: basePrice,
        stockQuantity: baseStock,
        exchangeEnabled: form.type === 'phone' ? form.exchangeEnabled : false,
        description: form.description || undefined,
        images: allImages,
        updatedBy: sellerId,
        
        batteryHealth: form.type === 'phone' && form.brand === 'iPhone' ? form.batteryHealth || undefined : undefined,
        modelOrigin: form.type === 'phone' && form.brand === 'iPhone' ? form.modelOrigin || undefined : undefined,
        simType: form.type === 'phone' ? form.simType || undefined : undefined,
        network: form.type === 'phone' && form.brand === 'Samsung' ? form.network || undefined : undefined,
        variants: mappedVariants,
      };

      if (isEdit && id) {
        await updateProductMutation({ productId: id as Id<'products'>, ...common });
      } else {
        await createProductMutation({ ...common, createdBy: sellerId, sellerId });
      }
      navigate(getInventoryPath());
    } catch (err) {
      console.error(err);
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const update = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };
  
  const updateVariant = (index: number, key: keyof VariantInput, value: string) => {
      const newVariants = [...form.variants];
      newVariants[index] = { ...newVariants[index], [key]: value };
      update('variants', newVariants);
  };
  
  const addVariant = () => {
      update('variants', [...form.variants, { id: Date.now().toString(), storage: '', ram: '', priceText: '', stockQuantity: '1' }]);
  };
  
  const removeVariant = (index: number) => {
      if (form.variants.length > 1) {
          update('variants', form.variants.filter((_, i) => i !== index));
      }
  };

  if (loading) return <div className="flex items-center justify-center h-screen bg-bg"><LoadingSpinner size="lg" /></div>;

  const isPhone = form.type === 'phone';
  const isIphone = form.brand === 'iPhone';

  return (
    <div className="min-h-screen bg-bg">
      <PageHeader title={isEdit ? 'Edit Product' : `Add ${defaultType === 'phone' ? 'Phone' : 'Accessory'}`} showBack />
        <div className="px-4 py-4 space-y-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}>
          {/* Images Picker */}
          <div className="card-interactive p-4 cursor-default">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Images</p>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelected} />
            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: IMAGE_SLOT_COUNT }, (_, i) => {
                const displayUrl = imageSlots[i]?.preview;
                return (
                  <div key={i} className="space-y-1">
                    <p className="text-[11px] text-muted font-medium">Upload Image {i + 1}</p>
                    <div className="relative">
                      <button type="button" onClick={() => handleSlotPress(i)} className="w-full h-20 rounded-xl border-2 border-dashed flex items-center justify-center bg-surface-2 active:scale-95 transition-transform border-[var(--border)]">
                        {displayUrl ? <img src={displayUrl} alt="" className="w-full h-full object-cover" /> : <Camera size={20} className="text-muted" />}
                      </button>
                      {displayUrl && (
                        <button type="button" onClick={() => handleRemoveImage(i)} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center">
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Basic Info */}
          <div className="card-interactive p-4 space-y-4 cursor-default">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide">Basic Info</p>
            
            {/* Phone Brand Pill */}
            {isPhone && !isEdit && (
                <div>
                  <label className="text-xs font-medium text-app-text mb-1.5 block">Brand</label>
                  <div className="flex gap-2">
                    {(['iPhone', 'Samsung'] as const).map((b) => (
                      <button
                        key={b}
                        onClick={() => update('brand', b)}
                        className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
                        style={form.brand === b ? { background: 'var(--primary)', color: 'var(--primary-foreground)' } : { background: 'var(--surface-2)', color: 'var(--muted)' }}
                      >
                        {b}
                      </button>
                    ))}
                  </div>
                </div>
            )}

            <div>
              <label className="text-xs font-medium text-app-text mb-1.5 block">{isPhone ? 'Phone Type *' : 'Accessory Name *'}</label>
              <input type="text" value={form.phoneType} onChange={(e) => update('phoneType', e.target.value)} placeholder={isPhone ? 'e.g. iPhone 15 Pro Max' : 'e.g. AirPods Pro'} className="w-full bg-surface-2 border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-app-text outline-none" />
              {errors.phoneType && <p className="text-xs text-red-500 mt-1">{errors.phoneType}</p>}
            </div>

            {/* Condition (Phone only) */}
            {isPhone && (
              <div>
                <label className="text-xs font-medium text-app-text mb-1.5 block">Condition *</label>
                <div className="grid grid-cols-3 gap-2">
                  {CONDITIONS.map((c) => (
                    <button key={c} onClick={() => update('condition', c)} className="p-2 border rounded-xl text-xs font-semibold" style={form.condition === c ? { border: '1px solid var(--primary)', background: 'rgba(245,196,0,0.12)', color: 'var(--primary)' } : { border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}>
                      {c}
                    </button>
                  ))}
                </div>
                {errors.condition && <p className="text-xs text-red-500 mt-1">{errors.condition}</p>}
              </div>
            )}
            
            {/* Accessory Price and Stock Fallbacks */}
            {!isPhone && (
                <>
                <div>
                    <label className="text-xs font-medium text-app-text mb-1.5 block">Price (ETB) *</label>
                    <input type="text" value={form.priceText} onChange={(e) => update('priceText', formatPriceForInput(parsePriceInput(e.target.value) || 0))} placeholder="e.g. 5000" className="w-full bg-surface-2 border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-app-text outline-none" />
                </div>
                <div>
                    <label className="text-xs font-medium text-app-text mb-1.5 block">Stock Quantity *</label>
                    <input type="number" value={form.stockQuantity} onChange={(e) => update('stockQuantity', e.target.value)} placeholder="e.g. 10" className="w-full bg-surface-2 border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-app-text outline-none" />
                </div>
                </>
            )}
          </div>
          
          {/* Variant Builder (Phone only) */}
          {isPhone && (
              <div className="card-interactive p-4 space-y-4 cursor-default border-t border-[var(--border)]">
                 <div className="flex justify-between items-center">
                    <p className="text-xs font-semibold text-muted uppercase tracking-wide">Pricing Variants</p>
                    <button onClick={addVariant} className="text-primary text-xs font-bold flex items-center gap-1 active:scale-95"><Plus size={14}/> Add Setup</button>
                 </div>
                 <p className="text-[11px] text-muted -mt-2">Add a row for each storage & RAM capacity you have.</p>
                 
                 {errors.variants && <p className="text-xs text-red-500">{errors.variants}</p>}

                 <div className="space-y-3">
                    {form.variants.map((v, index) => (
                        <div key={v.id} className="relative p-3 rounded-xl border border-[var(--border)] bg-surface-2 space-y-3">
                            {form.variants.length > 1 && (
                                <button onClick={() => removeVariant(index)} className="absolute top-2 right-2 text-red-400 p-1 active:scale-90"><Trash size={14}/></button>
                            )}
                            <div className="grid grid-cols-2 gap-2 pr-6">
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-muted mb-1 block">Storage</label>
                                    <select value={v.storage} onChange={(e) => updateVariant(index, 'storage', e.target.value)} className="w-full bg-surface border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs text-app-text outline-none">
                                        <option value="">Select...</option>
                                        {PHONE_STORAGE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                    </select>
                                </div>
                                {!isIphone && (
                                    <div>
                                        <label className="text-[10px] uppercase font-bold text-muted mb-1 block">RAM</label>
                                        <select value={v.ram} onChange={(e) => updateVariant(index, 'ram', e.target.value)} className="w-full bg-surface border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs text-app-text outline-none">
                                            <option value="">Select...</option>
                                            {RAM_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                        </select>
                                    </div>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-2 pr-6">
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-muted mb-1 block">Price (ETB) *</label>
                                    <input type="text" value={v.priceText} onChange={(e) => updateVariant(index, 'priceText', formatPriceForInput(parsePriceInput(e.target.value) || 0))} placeholder="e.g. 65000" className="w-full bg-surface border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs text-app-text outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-muted mb-1 block">Stock *</label>
                                    <input type="number" min="0" value={v.stockQuantity} onChange={(e) => updateVariant(index, 'stockQuantity', e.target.value)} className="w-full bg-surface border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs text-app-text outline-none" />
                                </div>
                            </div>
                        </div>
                    ))}
                 </div>
              </div>
          )}
          
          {/* Brand Technical Specifics (Phone only) */}
          {isPhone && (
               <div className="card-interactive p-4 space-y-4 cursor-default">
                    <p className="text-xs font-semibold text-muted uppercase tracking-wide">Technical Specifics</p>
                    
                    {/* iPhone specific blocks */}
                    {isIphone ? (
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs font-medium text-app-text mb-1.5 block">Battery Health</label>
                                <input type="text" value={form.batteryHealth} onChange={(e) => update('batteryHealth', e.target.value)} placeholder="e.g. 86% or 100%" className="w-full bg-surface-2 border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-app-text outline-none" />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-app-text mb-1.5 block">Model Origin</label>
                                <input type="text" value={form.modelOrigin} onChange={(e) => update('modelOrigin', e.target.value)} placeholder="e.g. LL/A or ZD/A" className="w-full bg-surface-2 border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-app-text outline-none" />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-app-text mb-1.5 block">SIM Type</label>
                                <select value={form.simType} onChange={(e) => update('simType', e.target.value)} className="w-full bg-surface-2 border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-app-text outline-none">
                                    <option value="">Select...</option>
                                    <option value="Physical Dual SIM">Physical Dual SIM</option>
                                    <option value="Physical + eSIM">Physical + eSIM</option>
                                    <option value="eSIM Only">eSIM Only</option>
                                </select>
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs font-medium text-app-text mb-1.5 block">Network</label>
                                <select value={form.network} onChange={(e) => update('network', e.target.value)} className="w-full bg-surface-2 border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-app-text outline-none">
                                    <option value="">Select...</option>
                                    <option value="5G">5G</option>
                                    <option value="LTE">LTE</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-app-text mb-1.5 block">SIM Slot</label>
                                <select value={form.simType} onChange={(e) => update('simType', e.target.value)} className="w-full bg-surface-2 border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-app-text outline-none">
                                    <option value="">Select...</option>
                                    <option value="Dual SIM">Dual SIM</option>
                                    <option value="Single SIM">Single SIM</option>
                                </select>
                            </div>
                        </div>
                    )}
               </div>
          )}

          {/* Exchange & Additional (Phone only) */}
          {isPhone && (
            <div className="card-interactive p-4 space-y-4 cursor-default">
              <div>
                <p className="text-sm font-semibold text-app-text mb-2">Exchange Available</p>
                <div className="flex rounded-xl border border-[var(--border)] bg-surface-2 p-1 gap-1">
                  <button onClick={() => update('exchangeEnabled', false)} className="flex-1 py-2 rounded-xl text-sm font-bold transition-all" style={!form.exchangeEnabled ? { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' } : { color: 'var(--muted)' }}>
                    Exchange OFF
                  </button>
                  <button onClick={() => update('exchangeEnabled', true)} className="flex-1 py-2 rounded-xl text-sm font-bold transition-all" style={form.exchangeEnabled ? { background: 'var(--primary)', color: 'var(--primary-foreground)' } : { color: 'var(--muted)' }}>
                    Exchange ON
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="card-interactive p-4 cursor-default">
            <label className="text-xs font-semibold text-muted uppercase tracking-wide mb-1 block">Description</label>
            <textarea value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="e.g. Comes with original box and charger." rows={3} className="w-full bg-surface-2 border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-app-text outline-none resize-none" />
          </div>

          {saveError && <div className="bg-red-950/50 border border-red-500/40 rounded-xl px-4 py-3 text-sm text-red-400 font-medium">{saveError}</div>}

          <button onClick={handleSave} disabled={saving} className="w-full py-4 font-semibold btn-interactive rounded-xl shadow-sm disabled:opacity-50" style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : `Add ${form.type === 'phone' ? 'Phone' : 'Accessory'}`}
          </button>
          
          {isEdit && (
            <div className="mt-4">
               {existingProduct?.archivedAt ? (
                  <button onClick={handleRestore} disabled={saving} className="w-full flex items-center justify-center py-3 rounded-xl border border-green-500 text-green-400 font-semibold text-sm">
                    Restore Product
                  </button>
               ) : (
                  <button onClick={handleArchive} disabled={saving} className="w-full flex items-center justify-center py-3 rounded-xl border border-red-500/60 text-red-400 font-semibold text-sm">
                    Archive Product
                  </button>
               )}
            </div>
          )}
      </div>
    </div>
  );
}
