import {
  CanonicalPosTag,
  TranslationSenseDto,
} from '../translate/dto/translation-result.dto';
import { GRAMMAR_NAMES, stripTextPos } from './pos-recognition';

const SENSE_MARKER = /^\s*(?:\d+\s*[).\]]|[•\-*])\s*/;

export type DefinitionFormat = 'html' | 'text';

// Parses one sdcv result `definition` into senses[]. The `format` is declared
// per-dictionary (from the .ifo sametypesequence) rather than sniffed, so a
// plain-text definition that happens to contain a '<' is never misrouted.
export function parseDefinition(
  definition: string,
  format: DefinitionFormat,
): TranslationSenseDto[] {
  if (!definition || !definition.trim()) {
    return [];
  }
  return format === 'html'
    ? parseHtmlDefinition(definition)
    : parseTextDefinition(definition);
}

// ---------------------------------------------------------------------------
// HTML parser
// ---------------------------------------------------------------------------

interface Block {
  tag: string;
  outerHtml: string;
  innerHtml: string;
}

// Returns the index immediately AFTER the </tag> that closes the opening tag
// whose content starts at `afterOpen`. Tracks nesting. Returns -1 on malformed.
function findClosingTag(html: string, afterOpen: number, tag: string): number {
  const openRe = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'gi');
  const closeStr = `</${tag}>`;
  let depth = 1;
  let pos = afterOpen;

  while (depth > 0) {
    openRe.lastIndex = pos;
    const nextOpen = openRe.exec(html);
    const nextCloseIdx = html.indexOf(closeStr, pos);

    if (nextCloseIdx === -1) return -1; // malformed

    if (nextOpen && nextOpen.index < nextCloseIdx) {
      depth++;
      pos = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      pos = nextCloseIdx + closeStr.length;
    }
  }
  return pos;
}

// Extracts top-level occurrences of `tags` inside `html`, skipping nested ones.
function topLevelBlocks(html: string, tags: string[]): Block[] {
  const pattern = new RegExp(`<(${tags.join('|')})(?:\\s[^>]*)?>`, 'gi');
  const result: Block[] = [];
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    const openStart = m.index;
    const contentStart = openStart + m[0].length;
    const end = findClosingTag(html, contentStart, tag);
    if (end === -1) continue;

    const closeStr = `</${tag}>`;
    const innerHtml = html.slice(contentStart, end - closeStr.length);
    const outerHtml = html.slice(openStart, end);

    result.push({ tag, outerHtml, innerHtml });
    pattern.lastIndex = end; // skip past this block
  }
  return result;
}

// Returns the innerHtml of each top-level <li> in an <ol>'s innerHTML.
function extractLiItems(olInner: string): string[] {
  return topLevelBlocks(olInner, ['li']).map((b) => b.innerHtml);
}

// True when every <li> in olInner is a pure translation item: <li><div>…</div></li>
// with NO inline text content before the div and no other block children.
function isTranslationOl(olInner: string): boolean {
  const items = extractLiItems(olInner);
  if (items.length === 0) return false;
  return items.every((li) => {
    const blocks = topLevelBlocks(li, ['ol', 'ul', 'li', 'div']);
    if (blocks.length !== 1 || blocks[0].tag !== 'div') return false;
    // No text/markup before the div
    const textBefore = li
      .slice(0, li.indexOf(blocks[0].outerHtml))
      .replace(/<[^>]+>/g, '')
      .trim();
    if (textBefore) return false;
    // The div must itself be a leaf (no block children)
    return (
      topLevelBlocks(blocks[0].innerHtml, ['div', 'ol', 'ul', 'li']).length ===
      0
    );
  });
}

// For a translation ol: decoded text from each <li>'s leaf <div>.
function extractTranslationsFromOl(olInner: string): string[] {
  return extractLiItems(olInner)
    .map((li) => {
      const divs = topLevelBlocks(li, ['div']);
      return divs[0] ? decodeEntities(stripTags(divs[0].innerHtml)) : '';
    })
    .filter(Boolean);
}

// For a description ol: text content (tags stripped) of each <li>.
function extractDescsFromOl(olInner: string): string[] {
  return extractLiItems(olInner)
    .map((li) => decodeEntities(stripTags(li)).trim())
    .filter(Boolean);
}

// Decoded inline text that appears before the first block-level child element.
function extractInlineText(html: string): string {
  // Everything up to the first <ol>, <ul>, <li>, or <div>
  const blockStart = html.search(/<(?:ol|ul|li|div)[\s>]/i);
  const raw = blockStart === -1 ? html : html.slice(0, blockStart);
  return decodeEntities(stripTags(raw)).trim();
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeSense(
  description: string[],
  translation: string[],
  canonicalPosTag: CanonicalPosTag | null,
): TranslationSenseDto {
  return {
    translation: translation.filter(Boolean),
    description: description.filter(Boolean),
    posTag: '',
    canonicalPosTag,
  };
}

function parseSenseList(
  olInner: string,
  pos: CanonicalPosTag | null,
): TranslationSenseDto[] {
  const senses: TranslationSenseDto[] = [];
  for (const li of extractLiItems(olInner)) {
    const blocks = topLevelBlocks(li, ['ol', 'div']);
    const ols = blocks.filter((b) => b.tag === 'ol');
    const divs = blocks.filter((b) => b.tag === 'div');
    const inlineText = extractInlineText(li);

    if (ols.length === 0) {
      // T4: description text + leaf div translation
      if (divs.length > 0) {
        senses.push(
          makeSense(
            [inlineText],
            [decodeEntities(stripTags(divs[0].innerHtml))],
            pos,
          ),
        );
      }
    } else if (ols.length === 1 && isTranslationOl(ols[0].innerHtml)) {
      // T5: description text + translation sublist
      senses.push(
        makeSense(
          [inlineText],
          extractTranslationsFromOl(ols[0].innerHtml),
          pos,
        ),
      );
    } else if (
      ols.length === 1 &&
      !isTranslationOl(ols[0].innerHtml) &&
      divs.length > 0
    ) {
      // T6-VariantA: description sublist + shared single translation
      senses.push(
        makeSense(
          extractDescsFromOl(ols[0].innerHtml),
          [decodeEntities(stripTags(divs[0].innerHtml))],
          pos,
        ),
      );
    }
    // Unknown/malformed li shapes are silently skipped.
  }
  return senses;
}

// Strip pronunciation (<font color="gray">…</font> / … / <br>) and the POS
// grammar div from the outer <div> body, returning {pos, body}.
function extractPosAndBody(divInner: string): {
  pos: CanonicalPosTag | null;
  body: string;
} {
  // Remove pronunciation line: everything up to and including the <br>
  let body = divInner.replace(/[\s\S]*?<br\s*\/?>/i, '').trim();

  // Extract grammar POS from first matching grammar div, then remove it
  let pos: CanonicalPosTag | null = null;
  body = body.replace(
    /<div[^>]*>[^<]*<font[^>]*class="grammar"[^>]*>([^<]+)<\/font>[^<]*<\/div>/i,
    (_, word: string) => {
      pos = GRAMMAR_NAMES[word.trim().toLowerCase()] ?? null;
      return '';
    },
  );

  return { pos, body: body.trim() };
}

function parseBody(
  body: string,
  pos: CanonicalPosTag | null,
): TranslationSenseDto[] {
  const blocks = topLevelBlocks(body, ['ol', 'div']);
  const ols = blocks.filter((b) => b.tag === 'ol');
  const divs = blocks.filter((b) => b.tag === 'div');

  if (ols.length === 0) {
    // T1 / T2: single sense — optional inline description + one leaf div translation
    const translation = divs[0]
      ? decodeEntities(stripTags(divs[0].innerHtml))
      : '';
    if (!translation) return [];
    return [makeSense([extractInlineText(body)], [translation], pos)];
  }

  if (ols.length === 1) {
    if (divs.length > 0) {
      // T8: description ol + single translation div
      return [
        makeSense(
          extractDescsFromOl(ols[0].innerHtml),
          [decodeEntities(stripTags(divs[0].innerHtml))],
          pos,
        ),
      ];
    }
    if (isTranslationOl(ols[0].innerHtml)) {
      // T3: optional inline description + flat translation list
      return [
        makeSense(
          [extractInlineText(body)],
          extractTranslationsFromOl(ols[0].innerHtml),
          pos,
        ),
      ];
    }
    // T4 / T5 / T6: sense list
    return parseSenseList(ols[0].innerHtml, pos);
  }

  if (ols.length >= 2) {
    // T7: description ol + translation ol
    return [
      makeSense(
        extractDescsFromOl(ols[0].innerHtml),
        extractTranslationsFromOl(ols[1].innerHtml),
        pos,
      ),
    ];
  }

  return [];
}

function parseHtmlDefinition(definition: string): TranslationSenseDto[] {
  const senses: TranslationSenseDto[] = [];

  // Each homograph is wrapped in a top-level <div>. Walk them in order.
  for (const block of topLevelBlocks(definition, ['div'])) {
    const { pos, body } = extractPosAndBody(block.innerHtml);
    senses.push(...parseBody(body, pos));
  }

  return senses;
}

// ---------------------------------------------------------------------------
// Text parser (unchanged logic, updated field shape)
// ---------------------------------------------------------------------------

function parseTextDefinition(definition: string): TranslationSenseDto[] {
  const senses: TranslationSenseDto[] = [];
  for (const raw of definition.split(/\r?\n/)) {
    const line = raw.replace(SENSE_MARKER, '').trim();
    if (!line) {
      continue;
    }
    const { canonicalPosTag, rest } = stripTextPos(line);
    const translation = rest.trim();
    if (!translation) {
      continue;
    }
    senses.push({
      translation: [translation],
      description: [],
      posTag: '',
      canonicalPosTag,
    });
  }
  return senses;
}

// ---------------------------------------------------------------------------
// Entity decoding
// ---------------------------------------------------------------------------

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
