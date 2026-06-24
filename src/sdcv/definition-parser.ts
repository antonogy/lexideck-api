import {
  CanonicalPosTag,
  TranslationAlternativeDto,
} from '../translate/dto/translation-result.dto';
import { GRAMMAR_NAMES, stripTextPos } from './pos-recognition';

const SENSE_MARKER = /^\s*(?:\d+\s*[).\]]|[•\-*])\s*/;

// Parses one sdcv result `definition` into senses[]. Handles two formats:
//  - HTML (StarDict sametypesequence=h, e.g. FreeDict/WikDict): POS comes from
//    <font class="grammar">WORD</font>, translations are leaf <div>text</div> nodes.
//  - Plain text: one sense per line, optionally prefixed by a sense marker and/or
//    a POS abbreviation (per the recognition table).
export function parseDefinition(
  definition: string,
): TranslationAlternativeDto[] {
  if (!definition || !definition.trim()) {
    return [];
  }
  if (/<[a-z!/][^>]*>/i.test(definition)) {
    return parseHtmlDefinition(definition);
  }
  return parseTextDefinition(definition);
}

function parseHtmlDefinition(definition: string): TranslationAlternativeDto[] {
  // POS from the grammar marker (single per homograph entry in WikDict).
  let canonicalPosTag: CanonicalPosTag | null = null;
  const grammar = /<font[^>]*class="grammar"[^>]*>([^<]+)<\/font>/i.exec(
    definition,
  );
  if (grammar) {
    canonicalPosTag = GRAMMAR_NAMES[grammar[1].trim().toLowerCase()] ?? null;
  }

  // Translations are leaf <div>text</div> nodes (the pronunciation/grammar divs
  // contain nested <font> tags, so [^<]+ excludes them).
  const senses: TranslationAlternativeDto[] = [];
  const re = /<div>([^<]+)<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(definition)) !== null) {
    const translation = decodeEntities(m[1].trim());
    if (!translation) {
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
