import { CanonicalPosTag } from '../translate/dto/translation-result.dto';

// Plain-text dictionaries: leading POS abbreviation → canonical tag.
// Source abbreviations may be in any language depending on the dict.
export const POS_PATTERNS: [RegExp, CanonicalPosTag][] = [
  [/^(n\.|сущ\.)\s*/i, 'NOUN'],
  [/^(v\.|гл\.)\s*/i, 'VERB'],
  [/^(adj\.|прил\.)\s*/i, 'ADJ'],
  [/^(adv\.|нареч\.)\s*/i, 'ADV'],
  [/^(prep\.|предл\.)\s*/i, 'PREP'],
];

// HTML/WikDict dictionaries: full grammar word (as in <font class="grammar">…)
// → canonical tag. Lowercased before lookup.
export const GRAMMAR_NAMES: Record<string, CanonicalPosTag> = {
  noun: 'NOUN',
  'proper noun': 'NOUN',
  verb: 'VERB',
  adjective: 'ADJ',
  adverb: 'ADV',
  preposition: 'PREP',
};

// Strips a recognized leading POS abbreviation from a text line.
// Returns the canonical tag (or null) and the remaining text.
export function stripTextPos(line: string): {
  canonicalPosTag: CanonicalPosTag | null;
  rest: string;
} {
  for (const [re, tag] of POS_PATTERNS) {
    if (re.test(line)) {
      return { canonicalPosTag: tag, rest: line.replace(re, '').trim() };
    }
  }
  return { canonicalPosTag: null, rest: line };
}
