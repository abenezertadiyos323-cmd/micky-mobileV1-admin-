import { Lock } from 'lucide-react';
import type { Product } from '../types';
import { formatETB } from '../lib/utils';

interface ProductCardProps {
  product: Product;
  onClick: () => void;
}

function getStockStyleDark(qty: number): { background: string; color: string } {
  if (qty === 0) return { background: 'rgba(239,68,68,0.15)', color: '#F87171' };
  if (qty <= 2) return { background: 'rgba(245,158,11,0.15)', color: '#FCD34D' };
  return { background: 'rgba(16,185,129,0.15)', color: '#34D399' };
}

export default function ProductCard({ product, onClick }: ProductCardProps) {
  const stockQuantity = typeof product.stockQuantity === 'number' ? product.stockQuantity : 0;
  const images = Array.isArray(product.images) ? product.images : [];
  const imageUrl = images[0];
  const phoneType = typeof product.phoneType === 'string' && product.phoneType.trim().length > 0
    ? product.phoneType
    : 'Unnamed product';
  const storage = typeof product.storage === 'string' && product.storage.trim().length > 0
    ? product.storage
    : undefined;
  const priceLabel = typeof product.price === 'number' ? formatETB(product.price) : 'N/A';
  const stockStyle = getStockStyleDark(stockQuantity);

  return (
    <button
      onClick={onClick}
      className="card-interactive p-3 flex items-center gap-3 w-full text-left"
    >
      {/* Image */}
      <div
        className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0"
        style={{ background: 'var(--surface-2)' }}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={phoneType}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs" style={{ color: 'var(--muted)' }}>
            No img
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          {product.exchangeEnabled ? (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
              style={{ background: 'rgba(16,185,129,0.15)', color: '#34D399' }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#34D399' }} />
              Exchange
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
              style={{ background: 'rgba(245,158,11,0.15)', color: '#FCD34D' }}
            >
              <Lock size={10} />
              Locked
            </span>
          )}
        </div>
        <p className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>{phoneType}</p>
        {storage && (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>{storage}</p>
        )}
        <div className="flex items-center justify-between mt-1">
          <span className="text-sm font-bold" style={{ color: 'var(--primary)' }}>{priceLabel}</span>
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={stockStyle}
          >
            {stockQuantity === 0 ? 'Out' : `${stockQuantity} left`}
          </span>
        </div>
      </div>
    </button>
  );
}
