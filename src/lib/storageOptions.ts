export const PHONE_STORAGE_OPTIONS = [
  '32GB',
  '64GB',
  '128GB',
  '256GB',
  '512GB',
] as const;

export type PhoneStorageOption = (typeof PHONE_STORAGE_OPTIONS)[number];

const STORAGE_OPTION_SET = new Set<string>(PHONE_STORAGE_OPTIONS);

const STORAGE_MATCHERS: Record<PhoneStorageOption, RegExp> = {
  '32GB': /\b32\s*gb\b/i,
  '64GB': /\b64\s*gb\b/i,
  '128GB': /\b128\s*gb\b/i,
  '256GB': /\b256\s*gb\b/i,
  '512GB': /\b512\s*gb\b/i,
};

const STORAGE_OPTION_TO_GB: Record<PhoneStorageOption, number> = {
  '32GB': 32,
  '64GB': 64,
  '128GB': 128,
  '256GB': 256,
  '512GB': 512,
};

function normalizeSingleStorageOption(value: string): PhoneStorageOption | null {
  const compact = value.trim().toUpperCase().replace(/\s+/g, '');
  if (!compact) return null;
  return STORAGE_OPTION_SET.has(compact) ? compact as PhoneStorageOption : null;
}

export function normalizePhoneStorageOptions(
  values: readonly string[] | null | undefined,
): PhoneStorageOption[] {
  const seen = new Set<PhoneStorageOption>();

  for (const value of values ?? []) {
    const normalized = normalizeSingleStorageOption(value);
    if (normalized) seen.add(normalized);
  }

  return PHONE_STORAGE_OPTIONS.filter((option) => seen.has(option));
}

export function parsePhoneStorageOptions(
  value: string | readonly string[] | null | undefined,
): PhoneStorageOption[] {
  if (Array.isArray(value)) return normalizePhoneStorageOptions(value);
  if (typeof value !== 'string') return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  const direct = normalizeSingleStorageOption(trimmed);
  if (direct) return [direct];

  return PHONE_STORAGE_OPTIONS.filter((option) => STORAGE_MATCHERS[option].test(trimmed));
}

export function formatPhoneStorageDisplay(
  options: readonly string[] | null | undefined,
): string | undefined {
  const normalized = normalizePhoneStorageOptions(options);
  return normalized.length > 0 ? normalized.join(', ') : undefined;
}

export function getPhoneStorageDisplay(
  storage: string | null | undefined,
  storageOptions?: readonly string[] | null,
): string | undefined {
  const fromOptions = formatPhoneStorageDisplay(storageOptions);
  if (fromOptions) return fromOptions;

  const fromStorage = formatPhoneStorageDisplay(parsePhoneStorageOptions(storage));
  if (fromStorage) return fromStorage;

  if (typeof storage !== 'string') return undefined;
  const trimmed = storage.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function phoneStorageOptionToGb(option: PhoneStorageOption): number {
  return STORAGE_OPTION_TO_GB[option];
}

export const PHONE_STORAGE_FILTER_OPTIONS = PHONE_STORAGE_OPTIONS.map((option) => ({
  label: option,
  value: phoneStorageOptionToGb(option),
}));
