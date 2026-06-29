import { parseDefinition } from './definition-parser';

describe('parseDefinition', () => {
  it('returns [] for empty/whitespace input', () => {
    expect(parseDefinition('', 'html')).toEqual([]);
    expect(parseDefinition('   \n  ', 'text')).toEqual([]);
  });

  describe('HTML (WikDict) format', () => {
    // Shared helper for building a definition wrapper with POS
    function withPos(pos: string, body: string): string {
      return `<div><div><font class="grammar" color="green">${pos}</font></div>${body}</div>`;
    }

    // -----------------------------------------------------------------------
    // T1 — no description, single translation
    // -----------------------------------------------------------------------
    it('T1: extracts single translation with empty description (бежать)', () => {
      const def = withPos('verb', '<div>run</div>');
      const senses = parseDefinition(def, 'html');
      expect(senses).toHaveLength(1);
      expect(senses[0].translation).toEqual(['run']);
      expect(senses[0].description).toEqual([]);
      expect(senses[0].canonicalPosTag).toBe('VERB');
    });

    // -----------------------------------------------------------------------
    // T2 — inline description + single translation
    // -----------------------------------------------------------------------
    it('T2: extracts description and single translation (книга)', () => {
      const def = withPos(
        'noun',
        'носитель информации, как правило, в виде сброшюрованных листов бумаги<div>book</div>',
      );
      const senses = parseDefinition(def, 'html');
      expect(senses).toHaveLength(1);
      expect(senses[0].translation).toEqual(['book']);
      expect(senses[0].description).toEqual([
        'носитель информации, как правило, в виде сброшюрованных листов бумаги',
      ]);
    });

    // -----------------------------------------------------------------------
    // T3 — inline description (optional) + flat translation list
    // -----------------------------------------------------------------------
    it('T3: extracts description and multiple translations (set/adjective)', () => {
      const def = withPos(
        'adjective',
        'Ready, prepared.<ol><li><div>гото́вый</div></li><li><div>устано́вленный</div></li></ol>',
      );
      const senses = parseDefinition(def, 'html');
      expect(senses).toHaveLength(1);
      expect(senses[0].translation).toEqual(['гото́вый', 'устано́вленный']);
      expect(senses[0].description).toEqual(['Ready, prepared.']);
    });

    it('T3 no-desc: flat translation list without description (color)', () => {
      const def = withPos(
        'noun',
        '<ol><li><div>цвет</div></li><li><div>краска</div></li></ol>',
      );
      const senses = parseDefinition(def, 'html');
      expect(senses).toHaveLength(1);
      expect(senses[0].translation).toEqual(['цвет', 'краска']);
      expect(senses[0].description).toEqual([]);
    });

    // -----------------------------------------------------------------------
    // T4 — sense list, each sense with description + direct translation
    // -----------------------------------------------------------------------
    it('T4: extracts multiple senses with one translation each (свет)', () => {
      const def = withPos(
        'noun',
        `<ol>
          <li>физ. электромагнитное излучение<div>light</div></li>
          <li>мир, часть вселенной<div>world</div></li>
          <li>социол. светское общество<div>society</div></li>
          <li>разг. электроснабжение<div>power</div></li>
        </ol>`,
      );
      const senses = parseDefinition(def, 'html');
      expect(senses).toHaveLength(4);
      expect(senses[0].translation).toEqual(['light']);
      expect(senses[0].description).toEqual([
        'физ. электромагнитное излучение',
      ]);
      expect(senses[1].translation).toEqual(['world']);
      expect(senses[3].translation).toEqual(['power']);
    });

    // -----------------------------------------------------------------------
    // T5 — sense list, each sense with translation sublist
    // -----------------------------------------------------------------------
    it('T5: extracts multiple senses with translation arrays (дом)', () => {
      const def = withPos(
        'noun',
        `<ol>
          <li>архитектурное сооружение
            <ol><li><div>house</div></li><li><div>home</div></li></ol>
          </li>
          <li>перен. фирма, предприятие<div>house</div></li>
        </ol>`,
      );
      const senses = parseDefinition(def, 'html');
      expect(senses).toHaveLength(2);
      expect(senses[0].translation).toEqual(['house', 'home']);
      expect(senses[0].description).toEqual(['архитектурное сооружение']);
      expect(senses[1].translation).toEqual(['house']);
      expect(senses[1].description).toEqual(['перен. фирма, предприятие']);
    });

    // -----------------------------------------------------------------------
    // T6 — mixed: desc sublist + shared translation (Variant A) and T4/T5
    // -----------------------------------------------------------------------
    it('T6: handles description sublist + shared translation (думать)', () => {
      const def = withPos(
        'verb',
        `<ol>
          <li>осуществлять мыслительную деятельность<div>pensar</div></li>
          <li>
            <ol>
              <li>иметь мнение, полагать</li>
              <li>разг. предполагать, намереваться</li>
            </ol>
            <div>creer</div>
          </li>
        </ol>`,
      );
      const senses = parseDefinition(def, 'html');
      expect(senses).toHaveLength(2);
      expect(senses[0].translation).toEqual(['pensar']);
      expect(senses[0].description).toEqual([
        'осуществлять мыслительную деятельность',
      ]);
      expect(senses[1].translation).toEqual(['creer']);
      expect(senses[1].description).toEqual([
        'иметь мнение, полагать',
        'разг. предполагать, намереваться',
      ]);
    });

    // -----------------------------------------------------------------------
    // T7 — parallel lists: desc ol + translation ol
    // -----------------------------------------------------------------------
    it('T7: extracts many descriptions and many translations as one sense (ставить)', () => {
      const def = withPos(
        'verb',
        `<ol><li>помещать на опору в стоячем положении</li><li>помещать в определённое место</li></ol>
         <ol><li><div>place</div></li><li><div>make stand</div></li><li><div>set</div></li><li><div>set up</div></li></ol>`,
      );
      const senses = parseDefinition(def, 'html');
      expect(senses).toHaveLength(1);
      expect(senses[0].translation).toEqual([
        'place',
        'make stand',
        'set',
        'set up',
      ]);
      expect(senses[0].description).toEqual([
        'помещать на опору в стоячем положении',
        'помещать в определённое место',
      ]);
    });

    // -----------------------------------------------------------------------
    // T8 — description ol + single translation div
    // -----------------------------------------------------------------------
    it('T8: extracts description list and single translation (tierra)', () => {
      const def = withPos(
        'noun',
        `<ol>
          <li>Superficie del planeta Tierra que no se encuentra cubierta por agua.</li>
          <li>Material granuloso y oscuro que compone el suelo.</li>
          <li>Suelo.</li>
        </ol>
        <div>земля</div>`,
      );
      const senses = parseDefinition(def, 'html');
      expect(senses).toHaveLength(1);
      expect(senses[0].translation).toEqual(['земля']);
      expect(senses[0].description).toEqual([
        'Superficie del planeta Tierra que no se encuentra cubierta por agua.',
        'Material granuloso y oscuro que compone el suelo.',
        'Suelo.',
      ]);
    });

    // -----------------------------------------------------------------------
    // POS tagging
    // -----------------------------------------------------------------------
    it('maps grammar words to canonical POS tags', () => {
      expect(
        parseDefinition(withPos('verb', '<div>run</div>'), 'html')[0]
          .canonicalPosTag,
      ).toBe('VERB');
      expect(
        parseDefinition(withPos('noun', '<div>муха</div>'), 'html')[0]
          .canonicalPosTag,
      ).toBe('NOUN');
      expect(
        parseDefinition(withPos('adjective', '<div>быстрый</div>'), 'html')[0]
          .canonicalPosTag,
      ).toBe('ADJ');
    });

    it('assigns correct POS per homograph block', () => {
      const def =
        '<div><div><font class="grammar" color="green">verb</font></div><div>летать</div></div>' +
        '<div><div><font class="grammar" color="green">noun</font></div><div>муха</div></div>';
      const senses = parseDefinition(def, 'html');
      expect(senses).toEqual([
        expect.objectContaining({
          translation: ['летать'],
          canonicalPosTag: 'VERB',
        }),
        expect.objectContaining({
          translation: ['муха'],
          canonicalPosTag: 'NOUN',
        }),
      ]);
    });

    it('sets canonicalPosTag null when grammar marker is absent', () => {
      expect(
        parseDefinition('<div><div>привет</div></div>', 'html')[0]
          .canonicalPosTag,
      ).toBeNull();
    });

    // -----------------------------------------------------------------------
    // Entity decoding
    // -----------------------------------------------------------------------
    it('decodes HTML entities in translations', () => {
      const def = withPos('noun', '<div>v&lt;u&gt;i&lt;/u&gt;da</div>');
      expect(parseDefinition(def, 'html')[0].translation).toEqual([
        'v<u>i</u>da',
      ]);
    });

    // -----------------------------------------------------------------------
    // normalizedTranslation is NOT set for sdcv
    // -----------------------------------------------------------------------
    it('does not set normalizedTranslation', () => {
      const s = parseDefinition(withPos('noun', '<div>муха</div>'), 'html')[0];
      expect(s.normalizedTranslation).toBeUndefined();
    });
  });

  describe('plain-text format', () => {
    it('wraps each translation in an array with empty description', () => {
      const def = '1) гл. летать\n2) сущ. муха';
      const senses = parseDefinition(def, 'text');
      expect(senses).toEqual([
        expect.objectContaining({
          translation: ['летать'],
          description: [],
          canonicalPosTag: 'VERB',
        }),
        expect.objectContaining({
          translation: ['муха'],
          description: [],
          canonicalPosTag: 'NOUN',
        }),
      ]);
    });

    it('does not misparse a plain-text definition that contains a "<"', () => {
      const senses = parseDefinition('v. to fly <poet.>', 'text');
      expect(senses[0]).toEqual(
        expect.objectContaining({
          translation: ['to fly <poet.>'],
          canonicalPosTag: 'VERB',
        }),
      );
    });

    it('keeps lines without POS as canonicalPosTag null', () => {
      expect(
        parseDefinition('просто слово', 'text')[0].canonicalPosTag,
      ).toBeNull();
    });

    it('skips lines that are only a POS abbreviation', () => {
      expect(parseDefinition('v.\n', 'text')).toEqual([]);
    });
  });
});
