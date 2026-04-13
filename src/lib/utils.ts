// ============================================================
// Micky Mobile Admin — Utility Functions
// ============================================================

/**
 * Format ETB currency
 */
export function formatETB(amount: number): string {
  return `${amount.toLocaleString('en-ET')} ETB`;
}

/**
 * Format relative time (e.g. "2h ago", "3d ago")
 */
export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString('en-ET', { month: 'short', day: 'numeric' });
}

/**
 * Format short time (e.g. "2:30 PM")
 */
export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-ET', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format date (e.g. "Jan 15")
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-ET', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Get stock status label and color
 */
export function getStockStatus(qty: number): {
  label: string;
  color: string;
  bg: string;
} {
  if (qty === 0) return { label: 'Out of Stock', color: 'text-red-400', bg: 'bg-red-950/40' };
  if (qty <= 2) return { label: 'Low Stock', color: 'text-amber-400', bg: 'bg-amber-950/40' };
  return { label: 'In Stock', color: 'text-green-400', bg: 'bg-green-950/40' };
}

/**
 * Get exchange status color
 */
export function getExchangeStatusColor(status: string): {
  color: string;
  bg: string;
} {
  switch (status) {
    case 'Pending': return { color: 'text-blue-400', bg: 'bg-blue-950/40' };
    case 'Quoted': return { color: 'text-purple-400', bg: 'bg-purple-950/40' };
    case 'Accepted': return { color: 'text-amber-400', bg: 'bg-amber-950/40' };
    case 'Completed': return { color: 'text-green-400', bg: 'bg-green-950/40' };
    case 'Rejected': return { color: 'text-red-400', bg: 'bg-red-950/40' };
    default: return { color: 'text-muted', bg: 'bg-surface-2' };
  }
}

/**
 * Get thread category color
 */
export function getCategoryColor(category: string): {
  color: string;
  bg: string;
  border: string;
} {
  switch (category) {
    case 'hot': return { color: 'text-rose-400', bg: 'bg-rose-950/40', border: 'border-rose-500/40' };
    case 'warm': return { color: 'text-amber-400', bg: 'bg-amber-950/40', border: 'border-amber-500/40' };
    case 'cold': return { color: 'text-muted', bg: 'bg-surface-2', border: 'border-[var(--border)]' };
    default: return { color: 'text-muted', bg: 'bg-surface-2', border: 'border-[var(--border)]' };
  }
}

/**
 * Get customer full name
 */
export function getCustomerName(firstName: string, lastName?: string): string {
  return lastName ? `${firstName} ${lastName}` : firstName;
}

/**
 * Build quote message template
 */
export function buildQuoteMessage(params: {
  tradeInModel: string;
  tradeInValue: number;
  desiredPhoneModel: string;
  desiredPhonePrice: number;
  difference: number;
}): string {
  return `Your ${params.tradeInModel} is worth ${formatETB(params.tradeInValue)}.
${params.desiredPhoneModel} costs ${formatETB(params.desiredPhonePrice)}.
You pay ${formatETB(params.difference)}.

When can you meet at PO Box 014?`;
}

/**
 * Truncate text
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

/**
 * Classify thread/exchange category
 */
export function classifyCategory(params: {
  createdAt: number;
  lastCustomerMessageAt?: number;
  lastCustomerMessageHasBudgetKeyword?: boolean;
  priorityValueETB?: number;
  clickedContinue?: boolean;
  hasCustomerMessaged?: boolean;
  hasAdminReplied?: boolean;
}): 'hot' | 'warm' | 'cold' {
  const now = Date.now();
  const twoHours = 2 * 3600 * 1000;
  const twentyFourHours = 24 * 3600 * 1000;

  // Hot
  const recentMessage = params.lastCustomerMessageAt && (now - params.lastCustomerMessageAt) < twoHours;
  const hasBudget = params.lastCustomerMessageHasBudgetKeyword;
  const highValue = params.priorityValueETB && params.priorityValueETB > 50000;
  if (recentMessage || hasBudget || highValue) return 'hot';

  // Warm
  const clickedContinue = params.clickedContinue;
  const hasMessaged = params.hasCustomerMessaged;
  const adminReplied = params.hasAdminReplied;
  if (clickedContinue || hasMessaged || adminReplied) return 'warm';

  // Cold: no engagement + older than 24h
  const isOld = (now - params.createdAt) > twentyFourHours;
  if (isOld) return 'cold';

  return 'warm'; // default
}
