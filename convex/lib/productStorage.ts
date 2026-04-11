export const STORAGE_OPTIONS = [
  "32GB",
  "64GB",
  "128GB",
  "256GB",
  "512GB",
  "1TB",
] as const;

export type StorageOption = (typeof STORAGE_OPTIONS)[number];

const STORAGE_OPTION_SET = new Set<string>(STORAGE_OPTIONS);

const STORAGE_MATCHERS: Record<StorageOption, RegExp> = {
  "32GB": /\b32\s*gb\b/i,
  "64GB": /\b64\s*gb\b/i,
  "128GB": /\b128\s*gb\b/i,
  "256GB": /\b256\s*gb\b/i,
  "512GB": /\b512\s*gb\b/i,
  "1TB": /\b1\s*tb\b|\b1024\s*gb\b/i,
};

const STORAGE_OPTION_TO_GB: Record<StorageOption, number> = {
  "32GB": 32,
  "64GB": 64,
  "128GB": 128,
  "256GB": 256,
  "512GB": 512,
  "1TB": 1024,
};

function normalizeSingleStorageOption(value: string): StorageOption | null {
  const compact = value.trim().toUpperCase().replace(/\s+/g, "");
  if (!compact) return null;
  if (compact === "1024GB") return "1TB";
  return STORAGE_OPTION_SET.has(compact) ? (compact as StorageOption) : null;
}

export function normalizeStorageOptions(
  values: readonly string[] | null | undefined,
): StorageOption[] {
  const seen = new Set<StorageOption>();

  for (const value of values ?? []) {
    const normalized = normalizeSingleStorageOption(value);
    if (normalized) seen.add(normalized);
  }

  return STORAGE_OPTIONS.filter((option) => seen.has(option));
}

export function parseStorageOptions(
  value: string | readonly string[] | null | undefined,
): StorageOption[] {
  if (Array.isArray(value)) return normalizeStorageOptions(value);
  if (typeof value !== "string") return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  const direct = normalizeSingleStorageOption(trimmed);
  if (direct) return [direct];

  return STORAGE_OPTIONS.filter((option) => STORAGE_MATCHERS[option].test(trimmed));
}

export function formatStorageDisplay(
  options: readonly string[] | null | undefined,
): string | undefined {
  const normalized = normalizeStorageOptions(options);
  return normalized.length > 0 ? normalized.join(", ") : undefined;
}

export function normalizeProductStorage(input: {
  storage?: string | null;
  storageOptions?: readonly string[] | null;
}): {
  storage: string | undefined;
  storageOptions: StorageOption[] | undefined;
  searchText: string | undefined;
} {
  const normalizedOptions = normalizeStorageOptions(input.storageOptions);
  const parsedOptions =
    normalizedOptions.length > 0 ? normalizedOptions : parseStorageOptions(input.storage);
  const storage = formatStorageDisplay(parsedOptions);

  if (parsedOptions.length > 0) {
    return {
      storage,
      storageOptions: parsedOptions,
      searchText: parsedOptions.join(" "),
    };
  }

  const fallback = typeof input.storage === "string" ? input.storage.trim() : "";
  return {
    storage: fallback || undefined,
    storageOptions: undefined,
    searchText: fallback || undefined,
  };
}

export function hasStorageGb(
  storageGb: number,
  input: {
    storage?: string | null;
    storageOptions?: readonly string[] | null;
  },
): boolean {
  const normalized = normalizeProductStorage(input);
  if (normalized.storageOptions?.some((option) => STORAGE_OPTION_TO_GB[option] === storageGb)) {
    return true;
  }

  if (!normalized.storage) return false;

  if (storageGb === 1024 && /\b1\s*tb\b/i.test(normalized.storage)) {
    return true;
  }

  return new RegExp(`\\b${storageGb}\\s*gb\\b`, "i").test(normalized.storage);
}
