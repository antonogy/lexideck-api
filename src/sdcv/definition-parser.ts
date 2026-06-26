import {
  CanonicalPosTag,
  TranslationAlternativeDto,
} from '../translate/dto/translation-result.dto';
import { GRAMMAR_NAMES, stripTextPos } from './pos-recognition';

const SENSE_MARKER = /^\s*(?:\d+\s*[).\]]|[•\-*])\s*/;

export type DefinitionFormat = 'html' | 'text';

// A leaf <div>…</div> whose content holds no block-level child (div/ol/ul/li).
// Inline children (font/i/b/br…) are allowed and stripped afterwards; block
// children make this NOT a leaf, so the wrapper/pronunciation divs don't match.
const LEAF_DIV =
  /<div[^>]*>((?:[^<]|<(?!\/?(?:div|ol|ul|li)\b)[^>]*>)*?)<\/div>/gi;
const GRAMMAR_IN_DIV = /class="grammar"[^>]*>([^<]+)</i;

// Parses one sdcv result `definition` into senses[]. The `format` is declared
// per-dictionary (from the .ifo sametypesequence) rather than sniffed, so a
// plain-text definition that happens to contain a '<' is never misrouted.
//  - 'html' (StarDict sametypesequence=h, e.g. FreeDict/WikDict): POS comes from
//    <font class="grammar">WORD</font> markers; translations are leaf <div> nodes.
//  - 'text': one sense per line, optionally prefixed by a sense marker and/or a
//    POS abbreviation (per the recognition table).
export function parseDefinition(
  definition: string,
  format: DefinitionFormat,
): TranslationAlternativeDto[] {
  if (!definition || !definition.trim()) {
    return [];
  }
  return format === 'html'
    ? parseHtmlDefinition(definition)
    : parseTextDefinition(definition);
}

function parseHtmlDefinition(definition: string): TranslationAlternativeDto[] {
  // Walk leaf divs in document order, tracking the most recent grammar marker so
  // that each translation gets the POS of the homograph block it belongs to —
  // correct even when one definition contains multiple POS blocks.
  const senses: TranslationAlternativeDto[] = [];
  let currentPos: CanonicalPosTag | null = null;
  let m: RegExpExecArray | null;
  LEAF_DIV.lastIndex = 0;
  while ((m = LEAF_DIV.exec(definition)) !== null) {
    const inner = m[1];

    const grammar = GRAMMAR_IN_DIV.exec(inner);
    if (grammar) {
      currentPos = GRAMMAR_NAMES[grammar[1].trim().toLowerCase()] ?? null;
      continue;
    }

    const translation = decodeEntities(
      inner
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    );
    if (!translation) {
      continue;
    }
    senses.push({
      translation,
      normalizedTranslation: translation,
      posTag: '',
      canonicalPosTag: currentPos,
    });
  }
  return senses;
}

function parseTextDefinition(definition: string): TranslationAlternativeDto[] {
  const senses: TranslationAlternativeDto[] = [];
  for (const raw of definition.split(/\r?\n/)) {
    const line = raw.replace(SENSE_MARKER, '').trim();
    if (!line) {
      continue;
    }
    const { canonicalPosTag, rest } = stripTextPos(line);
    const translation = rest.trim();
    if (!translation) {
      // Line carried only a POS abbreviation / marker — skip it.
      continue;
    }
    senses.push({
      translation,
      normalizedTranslation: translation,
      posTag: '',
      canonicalPosTag,
    });
  }
  return senses;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
