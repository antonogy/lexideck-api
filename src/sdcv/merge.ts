import {
  InternalTranslationResult,
  TranslationSenseDto,
} from '../translate/dto/translation-result.dto';

// Strip combining diacritical marks (e.g. Russian stress accent U+0301)
// so that "муха" and "му́ха" are treated as identical for dedup purposes.
function normalizeForKey(s: string): string {
  return s.normalize('NFD').replace(/\p{Mn}/gu, '');
}

// Dedupe by (translation, canonicalPosTag), preserving first-occurrence order.
// Uses the language-agnostic canonical tag, NOT the localized posTag string.
// Translations that differ only by accent/stress marks are treated as duplicates.
export function dedupeAlternatives(
  senses: TranslationSenseDto[],
): TranslationSenseDto[] {
  const seen = new Set<string>();
  return senses.filter((s) => {
    // Key fields joined by NUL (a space can appear inside `translation`, so it
    // would not unambiguously delimit translation from canonicalPosTag).
    const key = `${normalizeForKey(s.translation)}\0${s.canonicalPosTag ?? ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

// results[] is parallel to queries[] (length 1 or 2).
// queries[0] = normalized (if provided and different), else text.
// `primary`/`secondary` here are merge-order concepts (normalized lookup first),
// not API rank — all senses in the final result are treated as equal.
export function mergeSdcvResults(
  queries: string[],
  results: (InternalTranslationResult | null)[],
): InternalTranslationResult | null {
  const normalizedResult = queries.length === 2 ? results[0] : null;
  const textResult = queries.length === 2 ? results[1] : results[0];

  const primary = normalizedResult ?? textResult;
  if (!primary) {
    return null;
  }

  const secondary = primary === normalizedResult ? textResult : null;

  const senses = secondary
    ? dedupeAlternatives([...primary.senses, ...secondary.senses])
    : primary.senses;

  return { ...primary, senses };
}
