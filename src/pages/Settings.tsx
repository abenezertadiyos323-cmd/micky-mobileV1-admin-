import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import PageHeader from '../components/PageHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import { getTelegramUser } from '../lib/telegram';
import { getBackendInfo } from '../lib/backend';

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL || 'http://localhost:8400';
const APP_VERSION = import.meta.env.VITE_APP_VERSION
  ? `v${import.meta.env.VITE_APP_VERSION}`
  : 'v1.0.0';

// ---- Small helpers ----

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide mb-2 px-1" style={{ color: 'var(--muted)' }}>
      {children}
    </p>
  );
}

function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl overflow-hidden shadow-sm"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      {children}
    </div>
  );
}

function NavRow({ label, subtitle, onPress }: { label: string; subtitle?: string; onPress: () => void }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:opacity-70 transition-opacity border-b last:border-b-0"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{label}</p>
        {subtitle && <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>{subtitle}</p>}
      </div>
      <ChevronRight size={16} style={{ color: 'var(--muted)', flexShrink: 0 }} />
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="px-4 py-3.5 border-b last:border-b-0 cursor-default"
      style={{ borderColor: 'var(--border)' }}
    >
      <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{label}</p>
      <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>{value}</p>
    </div>
  );
}

function ToggleRow({
  label,
  subtitle,
  value,
  onChange,
  last,
}: {
  label: string;
  subtitle?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between px-4 py-3.5 cursor-default${last ? '' : ' border-b'}`}
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="flex-1 min-w-0 pr-4">
        <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{label}</p>
        {subtitle && <p className="text-xs" style={{ color: 'var(--muted)' }}>{subtitle}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className="relative flex-shrink-0 w-12 h-6 rounded-full transition-all duration-200"
        style={{
          background: value ? 'var(--primary)' : 'var(--surface-2)',
          border: '1px solid var(--border)',
        }}
        aria-checked={value}
        role="switch"
      >
        <span
          className="absolute top-0.5 w-5 h-5 rounded-full transition-all duration-200"
          style={{
            background: value ? 'var(--primary-foreground)' : 'var(--muted)',
            left: value ? 'calc(100% - 1.375rem)' : '0.125rem',
          }}
        />
      </button>
    </div>
  );
}

function InputRow({
  label,
  value,
  onChange,
  placeholder,
  type,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="px-4 py-3 border-b last:border-b-0 cursor-default" style={{ borderColor: 'var(--border)' }}>
      <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--muted)' }}>{label}</label>
      <input
        type={type ?? 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl px-3 py-2 text-sm outline-none"
        style={{
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
        }}
      />
    </div>
  );
}

function ApplyButton({ onPress, saving }: { onPress: () => void; saving: boolean }) {
  return (
    <div className="px-4 pt-1 pb-3">
      <button
        type="button"
        onClick={onPress}
        disabled={saving}
        className="w-full py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 transition-opacity"
        style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
      >
        {saving ? 'Saving…' : 'Apply'}
      </button>
    </div>
  );
}

// ---- Main component ----

export default function Settings() {
  const navigate = useNavigate();
  const user = getTelegramUser();
  const backendInfo = getBackendInfo(CONVEX_URL);
  const backendSubtitle = backendInfo.label
    ? `${backendInfo.environment} - ${backendInfo.label}`
    : backendInfo.environment;
  const adminLabel = user.username
    ? `@${user.username} (ID: ${user.id})`
    : `${user.first_name}${user.last_name ? ` ${user.last_name}` : ''} (ID: ${user.id})`;

  const settings = useQuery(api.adminSettings.getSettings);
  const upsertSettings = useMutation(api.adminSettings.upsertSettings);

  // Section A — Store Settings
  const [storeName, setStoreName] = useState('');
  const [supportContact, setSupportContact] = useState('');
  const [telegramBotLink, setTelegramBotLink] = useState('');
  const [storeAddress, setStoreAddress] = useState('Bole Alemnesh Plaza Ground Floor');
  const [storeLocationLink, setStoreLocationLink] = useState('');
  const [storeSaving, setStoreSaving] = useState(false);
  const [storeInitialized, setStoreInitialized] = useState(false);

  // Section C — Inventory
  const [phoneLowStock, setPhoneLowStock] = useState('');
  const [accessoryLowStock, setAccessoryLowStock] = useState('');
  const [invSaving, setInvSaving] = useState(false);
  const [invInitialized, setInvInitialized] = useState(false);

  // Populate draft state once settings load
  if (settings !== undefined && !storeInitialized) {
    setStoreInitialized(true);
    setStoreName(settings?.storeName ?? '');
    setSupportContact(settings?.supportContact ?? '');
    setTelegramBotLink(settings?.telegramBotLink ?? '');
    setStoreAddress(settings?.storeAddress ?? 'Bole Alemnesh Plaza Ground Floor');
    setStoreLocationLink(settings?.storeLocationLink ?? '');
  }
  if (settings !== undefined && !invInitialized) {
    setInvInitialized(true);
    setPhoneLowStock(settings?.phoneLowStockThreshold !== undefined ? String(settings.phoneLowStockThreshold) : '2');
    setAccessoryLowStock(settings?.accessoryLowStockThreshold !== undefined ? String(settings.accessoryLowStockThreshold) : '2');
  }

  const handleToggle = async (field: 'exchangeAlertsEnabled' | 'inboxAlertsEnabled', value: boolean) => {
    await upsertSettings({ [field]: value });
  };

  const handleApplyStore = async () => {
    setStoreSaving(true);
    await upsertSettings({
      storeName: storeName.trim() || undefined,
      supportContact: supportContact.trim() || undefined,
      telegramBotLink: telegramBotLink.trim() || undefined,
      storeAddress: storeAddress.trim() || undefined,
      storeLocationLink: storeLocationLink.trim() || undefined,
    });
    setStoreSaving(false);
  };

  const handleApplyInventory = async () => {
    setInvSaving(true);
    const phone = Number(phoneLowStock);
    const acc = Number(accessoryLowStock);
    await upsertSettings({
      phoneLowStockThreshold: Number.isFinite(phone) && phone >= 0 ? phone : undefined,
      accessoryLowStockThreshold: Number.isFinite(acc) && acc >= 0 ? acc : undefined,
    });
    setInvSaving(false);
  };

  const isLoading = settings === undefined;

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <PageHeader title="Settings" />

      <div className="px-4 py-4 space-y-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}>
        {isLoading ? (
          <LoadingSpinner className="py-12" />
        ) : (
          <>
            {/* [A] Store Settings */}
            <div>
              <SectionLabel>Store Settings</SectionLabel>
              <SettingsCard>
                <InputRow label="Store Name" value={storeName} onChange={setStoreName} placeholder="e.g. Micky Mobile" />
                <InputRow label="Store Address" value={storeAddress} onChange={setStoreAddress} placeholder="Bole Alemnesh Plaza Ground Floor" />
                <InputRow label="Support Contact" value={supportContact} onChange={setSupportContact} placeholder="e.g. +251900000000" />
                <InputRow label="Telegram Bot Link" value={telegramBotLink} onChange={setTelegramBotLink} placeholder="e.g. https://t.me/your_bot" />
                <InputRow label="Store Location Link" value={storeLocationLink} onChange={setStoreLocationLink} placeholder="e.g. https://maps.app.goo.gl/..." />
                <ApplyButton onPress={handleApplyStore} saving={storeSaving} />
              </SettingsCard>
            </div>

            {/* [B] Notifications */}
            <div>
              <SectionLabel>Notifications</SectionLabel>
              <SettingsCard>
                <ToggleRow
                  label="Exchange Alerts"
                  subtitle="Notify when new exchange requests arrive"
                  value={settings?.exchangeAlertsEnabled ?? true}
                  onChange={(v) => handleToggle('exchangeAlertsEnabled', v)}
                />
                <ToggleRow
                  label="Inbox Alerts"
                  subtitle="Notify when customers send messages"
                  value={settings?.inboxAlertsEnabled ?? true}
                  onChange={(v) => handleToggle('inboxAlertsEnabled', v)}
                  last
                />
              </SettingsCard>
            </div>

            {/* [C] Inventory */}
            <div>
              <SectionLabel>Inventory</SectionLabel>
              <SettingsCard>
                <InputRow
                  label="Phone Low Stock Threshold"
                  value={phoneLowStock}
                  onChange={setPhoneLowStock}
                  placeholder="2"
                  type="number"
                />
                <InputRow
                  label="Accessory Low Stock Threshold"
                  value={accessoryLowStock}
                  onChange={setAccessoryLowStock}
                  placeholder="2"
                  type="number"
                />
                <ApplyButton onPress={handleApplyInventory} saving={invSaving} />
              </SettingsCard>
            </div>

            {/* [D] Appearance */}
            <div>
              <SectionLabel>Appearance</SectionLabel>
              <SettingsCard>
                <div className="px-4 py-3.5 flex items-center gap-3 cursor-default">
                  <div
                    className="w-8 h-8 rounded-full flex-shrink-0"
                    style={{ background: 'var(--primary)' }}
                  />
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Brand Color</p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>Micky Mobile yellow (#F5C400) — set in CSS variables</p>
                  </div>
                </div>
              </SettingsCard>
            </div>

            {/* [E] Account */}
            <div>
              <SectionLabel>Account</SectionLabel>
              <SettingsCard>
                <InfoRow label="Admin Profile" value={adminLabel} />
                <InfoRow label="App Version" value={APP_VERSION} />
                <NavRow label="Backend Status" subtitle={backendSubtitle} onPress={() => navigate('/settings/backend')} />
                <NavRow label="Access Control" subtitle="Admin whitelist" onPress={() => navigate('/settings/access')} />
              </SettingsCard>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
