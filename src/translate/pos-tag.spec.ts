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
        translation: 'летать',
        normalizedTranslation: 'летать',
        posTag: '',
        canonicalPosTag: 'VERB',
      },
      {
        translation: 'муха',
        normalizedTranslation: 'муха',
        posTag: '',
        canonicalPosTag: 'NOUN',
      },
    ],
  };

  it('extracts senses[0] into top-level fields with localized posTag', () => {
    const r = finalizeResult(internal, 'ru');
    expect(r.translation).toBe('летать');
    expect(r.posTag).toBe('гл');
    expect(r.provider).toBe('sdcv');
  });

  it('sets alternatives to the remaining senses (primary excluded)', () => {
    const r = finalizeResult(internal, 'ru');
    expect(r.alternatives).toHaveLength(1);
    expect(r.alternatives[0].translation).toBe('муха');
    expect(r.alternatives[0].posTag).toBe('сущ');
  });

  it('strips canonicalPosTag from output', () => {
    const r = finalizeResult(internal, 'ru');
    expect((r.alternatives[0] as any).canonicalPosTag).toBeUndefined();
  });

  it('yields [] alternatives for a single sense', () => {
    const single = { ...internal, senses: [internal.senses[0]] };
    expect(finalizeResult(single, 'ru').alternatives).toEqual([]);
  });
});
