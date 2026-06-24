import { parseDefinition } from './definition-parser';

describe('parseDefinition', () => {
  it('returns [] for empty/whitespace input', () => {
    expect(parseDefinition('')).toEqual([]);
    expect(parseDefinition('   \n  ')).toEqual([]);
  });

  describe('HTML (WikDict) format', () => {
    const verbDef =
      '\n<div>/<font color="gray">flaɪ</font>/<br>\n<div><font class="grammar" color="green">verb</font></div><ol><li><div>летать</div></li><li><div>лететь</div></li></ol></div>';

    it('extracts leaf <div> translations and skips pronunciation/grammar divs', () => {
      const senses = parseDefinition(verbDef);
      expect(senses.map((s) => s.translation)).toEqual(['летать', 'лететь']);
    });

    it('maps the grammar word to a canonical POS tag', () => {
      const senses = parseDefinition(verbDef);
      expect(senses.every((s) => s.canonicalPosTag === 'VERB')).toBe(true);
    });

    it('maps adjective/noun grammar words', () => {
      expect(
        parseDefinition(
          '<div><font class="grammar">adjective</font></div><ol><li><div>быстрый</div></li></ol>',
        )[0].canonicalPosTag,
      ).toBe('ADJ');
      expect(
        parseDefinition(
          '<div><font class="grammar">noun</font></div><ol><li><div>муха</div></li></ol>',
        )[0].canonicalPosTag,
      ).toBe('NOUN');
    });

    it('sets canonicalPosTag null when grammar marker missing', () => {
      const senses = parseDefinition('<div>привет</div>');
      expect(senses[0].canonicalPosTag).toBeNull();
    });

    it('sets normalizedTranslation equal to translation', () => {
      const s = parseDefinition('<div>муха</div>')[0];
      expect(s.normalizedTranslation).toBe('муха');
    });
  });

  describe('plain-text format', () => {
    it('parses one sense per line, stripping markers and POS abbreviations', () => {
      const def = '1) гл. летать\n2) сущ. муха';
      const senses = parseDefinition(def);
      expect(senses).toEqual([
        expect.objectContaining({
          translation: 'летать',
          canonicalPosTag: 'VERB',
        }),
        expect.objectContaining({
          translation: 'муха',
          canonicalPosTag: 'NOUN',
        }),
      ]);
    });

    it('keeps lines without POS as canonicalPosTag null', () => {
      expect(parseDefinition('просто слово')[0].canonicalPosTag).toBeNull();
    });

    it('skips lines that are only a POS abbreviation', () => {
      expect(parseDefinition('v.\n')).toEqual([]);
    });
  });
});
