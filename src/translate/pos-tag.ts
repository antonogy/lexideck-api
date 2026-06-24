import {
  CanonicalPosTag,
  InternalTranslationResult,
  TranslationResultDto,
} from './dto/translation-result.dto';

// Output rules: lowercase, no punctuation. Several non-EN/RU rows are best-effort
// placeholders flagged for linguistic review (notably de/pl/uk).
export const POS_LABELS: Record<string, Record<CanonicalPosTag, string>> = {
  en: { NOUN: 'noun', VERB: 'verb', ADJ: 'adj', ADV: 'adv', PREP: 'prep' },
  ru: { NOUN: 'сущ', VERB: 'гл', ADJ: 'прил', ADV: 'нареч', PREP: 'предл' },
  es: { NOUN: 'sust', VERB: 'verb', ADJ: 'adj', ADV: 'adv', PREP: 'prep' },
  fr: { NOUN: 'nom', VERB: 'verb', ADJ: 'adj', ADV: 'adv', PREP: 'prép' },
  de: { NOUN: 'subst', VERB: 'verb', ADJ: 'adj', ADV: 'adv', PREP: 'präp' },
  pt: { NOUN: 'subst', VERB: 'verb', ADJ: 'adj', ADV: 'adv', PREP: 'prep' },
  it: { NOUN: 'sost', VERB: 'verb', ADJ: 'agg', ADV: 'avv', PREP: 'prep' },
  nl: { NOUN: 'znw', VERB: 'ww', ADJ: 'bnw', ADV: 'bijw', PREP: 'vz' },
  pl: {
    NOUN: 'rzecz',
    VERB: 'czas',
    ADJ: 'przym',
    ADV: 'przysł',
    PREP: 'przyim',
  },
  uk: {
    NOUN: 'імен',
    VERB: 'дієсл',
    ADJ: 'прикм',
    ADV: 'присл',
    PREP: 'прийм',
  },
};

export function localizePosTag(
  canonicalTag: CanonicalPosTag | null | undefined,
  to: string,
): string {
  if (!canonicalTag) {
    return '';
  }
  return POS_LABELS[to]?.[canonicalTag] ?? '';
}

// Converts InternalTranslationResult -> public TranslationResultDto.
// Localizes POS tags, extracts senses[0] into the top-level fields, sets
// alternatives = senses[1:] (primary excluded), strips canonicalPosTag.
export function finalizeResult(
  result: InternalTranslationResult,
  to: string,
): TranslationResultDto {
  const localized = result.senses.map((s) => ({
    translation: s.translation,
    normalizedTranslation: s.normalizedTranslation,
    posTag: localizePosTag(s.canonicalPosTag, to),
  }));

  const [primary, ...alternatives] = localized;

  return {
    source: result.source,
    translation: primary.translation,
    normalizedTranslation: primary.normalizedTranslation,
    posTag: primary.posTag,
    alternatives,
    examples: result.examples,
    provider: result.provider,
  };
}
