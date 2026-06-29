import { TranslationSenseDto } from '../translate/dto/translation-result.dto';

// Strip combining diacritical marks (e.g. Russian stress accent U+0301)
// so that "муха" and "му́ха" are treated as identical for dedup purposes.
function normalizeForKey(s: string): string {
  return s.normalize('NFD').replace(/\p{Mn}/gu, '');
}

// Deduplicates the translation[] array within each sense, removing entries that
// differ only by accent/stress marks from an earlier entry in the same sense.
// Preserves sense order and first-occurrence order within each translation list.
export function dedupeSenceTranslations(
  senses: TranslationSenseDto[],
): TranslationSenseDto[] {
  return senses.map((s) => {
    const seen = new Set<string>();
    const translation = s.translation.filter((t) => {
      const key = normalizeForKey(t);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { ...s, translation };
  });
}

