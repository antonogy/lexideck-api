import { InternalTranslationResult } from './dto/translation-result.dto';
import { finalizeResult, localizePosTag } from './pos-tag';

describe('localizePosTag', () => {
  it('localizes into the target language', () => {
    expect(localizePosTag('VERB', 'ru')).toBe('гл');
    expect(localizePosTag('NOUN', 'ru')).toBe('сущ');
    expect(localizePosTag('VERB', 'en')).toBe('verb');
  });

  it('returns "" for null tag or unknown language', () => {
    expect(localizePosTag(null, 'ru')).toBe('');
    expect(localizePosTag('VERB', 'xx')).toBe('');
  });
});

describe('finalizeResult', () => {
  const internal: InternalTranslationResult = {
    source: 'fly',
    provider: 'sdcv',
    examples: [],
    senses: [
      {
        translation: ['летать'],
        description: ['to move through the air'],
        posTag: '',
        canonicalPosTag: 'VERB',
      },
      {
        translation: ['муха'],
        description: [],
        posTag: '',
        canonicalPosTag: 'NOUN',
      },
    ],
  };

  it('localizes posTag for all senses', () => {
    const r = finalizeResult(internal, 'ru');
    expect(r.senses[0].translation).toEqual(['летать']);
    expect(r.senses[0].posTag).toBe('гл');
    expect(r.provider).toBe('sdcv');
  });

  it('returns all senses in senses array', () => {
    const r = finalizeResult(internal, 'ru');
    expect(r.senses).toHaveLength(2);
    expect(r.senses[1].translation).toEqual(['муха']);
    expect(r.senses[1].posTag).toBe('сущ');
  });

  it('passes through description array', () => {
    const r = finalizeResult(internal, 'ru');
    expect(r.senses[0].description).toEqual(['to move through the air']);
    expect(r.senses[1].description).toEqual([]);
  });

  it('strips canonicalPosTag from output', () => {
    const r = finalizeResult(internal, 'ru');
    expect((r.senses[1] as any).canonicalPosTag).toBeUndefined();
  });

  it('returns single-element senses array for a single sense', () => {
    const single = { ...internal, senses: [internal.senses[0]] };
    expect(finalizeResult(single, 'ru').senses).toHaveLength(1);
  });
});
