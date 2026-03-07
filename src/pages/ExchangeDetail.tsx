import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Send, CheckCircle, MessageCircle, ArrowRight } from 'lucide-react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import LoadingSpinner from '../components/LoadingSpinner';
import { getTelegramUser } from '../lib/telegram';
import {
  formatETB,
  formatRelativeTime,
  getCustomerName,
  buildQuoteMessage,
} from '../lib/utils';
import type { Exchange } from '../types';

function getStatusStyleDark(status: string): { background: string; color: string } {
  switch (status) {
    case 'Pending':   return { background: 'rgba(59,130,246,0.15)',  color: '#60A5FA' };
    case 'Quoted':    return { background: 'rgba(139,92,246,0.15)',  color: '#A78BFA' };
    case 'Accepted':  return { background: 'rgba(245,196,0,0.15)',   color: '#F5C400' };
    case 'Completed': return { background: 'rgba(16,185,129,0.15)',  color: '#34D399' };
    case 'Rejected':  return { background: 'rgba(239,68,68,0.15)',   color: '#F87171' };
    default:          return { background: 'rgba(148,163,184,0.12)', color: '#94A3B8' };
  }
}

const cardStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
};

export default function ExchangeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [actionLoading, setActionLoading] = useState(false);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [quoteText, setQuoteText] = useState('');
  const user = getTelegramUser();

  const exchange = useQuery(
    api.exchanges.getExchange,
    id ? { exchangeId: id as Id<'exchanges'> } : 'skip'
  ) as Exchange | undefined | null;

  const updateStatusMutation = useMutation(api.exchanges.updateExchangeStatus);
  const sendQuoteMutation = useMutation(api.exchanges.sendQuote);

  const quoteInitialized = useRef(false);
  useEffect(() => {
    if (exchange && !quoteInitialized.current) {
      quoteInitialized.current = true;
      setQuoteText(
        buildQuoteMessage({
          tradeInModel: `${exchange.tradeInBrand} ${exchange.tradeInModel}`,
          tradeInValue: exchange.finalTradeInValue,
          desiredPhoneModel: exchange.desiredPhone?.phoneType ?? 'Desired Phone',
          desiredPhonePrice: exchange.desiredPhonePrice,
          difference: exchange.finalDifference,
        })
      );
    }
  }, [exchange]);

  const handleAction = async (action: 'accept' | 'complete' | 'reject') => {
    if (!id || !exchange) return;
    setActionLoading(true);
    const statusMap = { accept: 'Accepted', complete: 'Completed', reject: 'Rejected' } as const;
    await updateStatusMutation({
      exchangeId: id as Id<'exchanges'>,
      status: statusMap[action],
      adminTelegramId: String(user.id),
    });
    setActionLoading(false);
  };

  const handleSendQuote = async () => {
    if (!id || !quoteText.trim()) return;
    setActionLoading(true);
    await sendQuoteMutation({
      exchangeId: id as Id<'exchanges'>,
      quoteText,
      adminTelegramId: String(user.id),
    });
    setShowQuoteModal(false);
    setActionLoading(false);
  };

  if (exchange === undefined) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg)' }}>
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!exchange) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3" style={{ background: 'var(--bg)' }}>
        <p style={{ color: 'var(--muted)' }}>Exchange not found</p>
        <button onClick={() => navigate(-1)} className="text-sm" style={{ color: 'var(--primary)' }}>Go back</button>
      </div>
    );
  }

  const statusStyle = getStatusStyleDark(exchange.status);
  const customerName = exchange.thread
    ? getCustomerName(exchange.thread.customerFirstName, exchange.thread.customerLastName)
    : 'Unknown';

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-3 py-3"
        style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
      >
        <button
          onClick={() => navigate(-1)}
          className="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
          style={{ color: 'var(--muted)' }}
        >
          <ChevronLeft size={22} />
        </button>
        <div className="flex-1">
          <h1 className="text-base font-bold" style={{ color: 'var(--text)' }}>Exchange Request</h1>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>{formatRelativeTime(exchange.createdAt)}</p>
        </div>
        <span className="text-xs font-bold px-3 py-1 rounded-full" style={statusStyle}>
          {exchange.status}
        </span>
      </div>

      <div className="px-4 py-4 space-y-4 pb-8">
        {/* Customer Info */}
        <div className="rounded-2xl p-4 shadow-sm" style={cardStyle}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>Customer</p>
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold"
              style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
              {customerName.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>{customerName}</p>
              {exchange.thread?.customerUsername ? (
                <p className="text-xs" style={{ color: 'var(--muted)' }}>@{exchange.thread.customerUsername}</p>
              ) : (
                <p className="text-xs" style={{ color: 'var(--muted)' }}>No username</p>
              )}
              <p className="text-xs" style={{ color: 'var(--muted)' }}>ID: {exchange.telegramId}</p>
            </div>
          </div>
        </div>

        {/* Trade-in Details */}
        <div className="rounded-2xl p-4 shadow-sm" style={cardStyle}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>Trade-In Phone</p>
          <div className="grid grid-cols-2 gap-y-2 gap-x-4">
            <div>
              <p className="text-[10px]" style={{ color: 'var(--muted)' }}>Brand</p>
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{exchange.tradeInBrand}</p>
            </div>
            <div>
              <p className="text-[10px]" style={{ color: 'var(--muted)' }}>Model</p>
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{exchange.tradeInModel}</p>
            </div>
            <div>
              <p className="text-[10px]" style={{ color: 'var(--muted)' }}>Storage</p>
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{exchange.tradeInStorage}</p>
            </div>
            <div>
              <p className="text-[10px]" style={{ color: 'var(--muted)' }}>RAM</p>
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{exchange.tradeInRam}</p>
            </div>
            <div>
              <p className="text-[10px]" style={{ color: 'var(--muted)' }}>Condition</p>
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{exchange.tradeInCondition}</p>
            </div>
            {exchange.tradeInImei && (
              <div>
                <p className="text-[10px]" style={{ color: 'var(--muted)' }}>IMEI</p>
                <p className="text-xs font-mono" style={{ color: 'var(--muted)' }}>{exchange.tradeInImei}</p>
              </div>
            )}
          </div>
        </div>

        {/* Desired Phone */}
        <div className="rounded-2xl p-4 shadow-sm" style={cardStyle}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>Desired Phone</p>
          {exchange.desiredPhone ? (
            <div className="flex items-center gap-3">
              <div
                className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0"
                style={{ background: 'var(--surface-2)' }}
              >
                {exchange.desiredPhone.images[0] ? (
                  <img
                    src={exchange.desiredPhone.images[0]}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs" style={{ color: 'var(--muted)' }}>No img</div>
                )}
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                  {exchange.desiredPhone.phoneType}
                </p>
                {exchange.desiredPhone.storage && (
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>{exchange.desiredPhone.storage}</p>
                )}
                <p className="text-sm font-bold mt-0.5" style={{ color: 'var(--primary)' }}>
                  {formatETB(exchange.desiredPhonePrice)}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>Phone not found</p>
          )}
        </div>

        {/* Price Calculation */}
        <div className="rounded-xl p-4 shadow-sm cursor-default" style={cardStyle}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>Price Breakdown</p>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm" style={{ color: 'var(--muted)' }}>Desired Phone Price</span>
              <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{formatETB(exchange.desiredPhonePrice)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm" style={{ color: 'var(--muted)' }}>Trade-in Value</span>
              <span className="text-sm font-semibold" style={{ color: '#34D399' }}>− {formatETB(exchange.finalTradeInValue)}</span>
            </div>
            <div className="h-px my-1" style={{ background: 'var(--border)' }} />
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold" style={{ color: 'var(--text)' }}>Customer Pays</span>
              <span className="text-base font-bold" style={{ color: 'var(--primary)' }}>{formatETB(exchange.finalDifference)}</span>
            </div>
          </div>
          {(exchange.adminOverrideTradeInValue || exchange.adminOverrideDifference) && (
            <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
              <p className="text-[11px] font-medium" style={{ color: 'var(--primary)' }}>Admin override applied</p>
              <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
                Calculated: {formatETB(exchange.calculatedTradeInValue)} trade-in / {formatETB(exchange.calculatedDifference)} difference
              </p>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        {(exchange.status === 'Pending' || exchange.status === 'Quoted' || exchange.status === 'Accepted') && (
          <div className="rounded-xl p-4 mt-4 mb-4 shadow-sm cursor-default" style={cardStyle}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>Actions</p>
            <div className="space-y-2 flex flex-col items-center">
              {exchange.status === 'Pending' && (
                <button
                  onClick={() => setShowQuoteModal(true)}
                  disabled={actionLoading}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm active:scale-[0.98] transition-all disabled:opacity-50"
                  style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                  <Send size={16} />
                  Send Quote: {formatETB(exchange.finalDifference)}
                </button>
              )}
              {exchange.status === 'Quoted' && (
                <button
                  onClick={() => handleAction('accept')}
                  disabled={actionLoading}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm active:scale-[0.98] transition-all disabled:opacity-50"
                  style={{ background: 'rgba(245,196,0,0.15)', color: '#F5C400', border: '1px solid rgba(245,196,0,0.4)' }}
                >
                  <CheckCircle size={16} />
                  Mark Accepted
                </button>
              )}
              {exchange.status === 'Accepted' && (
                <button
                  onClick={() => handleAction('complete')}
                  disabled={actionLoading}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm active:scale-[0.98] transition-all disabled:opacity-50"
                  style={{ background: 'rgba(16,185,129,0.12)', color: '#34D399', border: '1px solid rgba(16,185,129,0.3)' }}
                >
                  <CheckCircle size={16} />
                  Mark Completed
                </button>
              )}
              <button
                onClick={() => handleAction('reject')}
                disabled={actionLoading}
                className="mt-2 text-xs font-medium py-2 active:scale-[0.98] transition-all text-center"
                style={{ color: '#F87171' }}
              >
                Reject Exchange
              </button>
            </div>
          </div>
        )}

        {/* Customer Notes */}
        {exchange.customerNotes && (
          <div
            className="rounded-xl p-4 shadow-sm"
            style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}
          >
            <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: '#FCD34D' }}>Customer Notes</p>
            <p className="text-sm" style={{ color: '#FDE68A' }}>{exchange.customerNotes}</p>
            {exchange.budgetMentionedInSubmission && (
              <span
                className="inline-block mt-2 text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(245,158,11,0.2)', color: '#FCD34D' }}
              >
                💬 Budget mentioned
              </span>
            )}
          </div>
        )}

        {/* View Thread Button */}
        <button
          onClick={() => navigate(`/inbox/${exchange.threadId}`)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm active:scale-[0.98] transition-transform shadow-sm"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
        >
          <MessageCircle size={16} style={{ color: 'var(--primary)' }} />
          View Conversation
          <ArrowRight size={14} style={{ color: 'var(--muted)' }} />
        </button>

        {/* Finalized state */}
        {(exchange.status === 'Completed' || exchange.status === 'Rejected') && (
          <div
            className="rounded-xl p-4 shadow-sm"
            style={exchange.status === 'Completed'
              ? { background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }
              : { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }
            }
          >
            <p className="text-sm font-bold" style={{ color: exchange.status === 'Completed' ? '#34D399' : '#F87171' }}>
              {exchange.status === 'Completed' ? '✅ Exchange Completed' : '❌ Exchange Rejected'}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              {exchange.status === 'Completed'
                ? `Completed ${formatRelativeTime(exchange.completedAt!)}`
                : `Rejected ${formatRelativeTime(exchange.rejectedAt!)}`}
            </p>
          </div>
        )}
      </div>

      {/* Send Quote Modal */}
      {showQuoteModal && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40">
          <div
            className="rounded-t-3xl w-full p-5 pb-8 animate-in slide-in-from-bottom duration-200"
            style={{ background: 'var(--surface)' }}
          >
            <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: 'var(--border)' }} />
            <h2 className="text-base font-bold mb-1" style={{ color: 'var(--text)' }}>Send Quote</h2>
            <p className="text-xs font-medium mb-3" style={{ color: 'var(--muted)' }}>
              Trading {exchange.tradeInBrand} {exchange.tradeInModel} for {exchange.desiredPhone?.phoneType || 'Unknown'} • {formatETB(exchange.finalDifference)}
            </p>
            <textarea
              value={quoteText}
              onChange={(e) => setQuoteText(e.target.value)}
              rows={6}
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none mb-3"
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
              }}
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowQuoteModal(false)}
                className="flex-1 py-3 rounded-xl font-semibold text-sm active:scale-95 transition-transform"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSendQuote}
                disabled={actionLoading || !quoteText.trim()}
                className="flex-1 py-3 rounded-xl font-semibold text-sm active:scale-95 transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                <Send size={14} />
                {actionLoading ? 'Sending...' : 'Send Quote'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
