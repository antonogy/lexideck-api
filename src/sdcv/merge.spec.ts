import { InternalTranslationResult } from '../translate/dto/translation-result.dto';
import { dedupeAlternatives, mergeSdcvResults } from './merge';

function res(
  source: string,
  senses: { translation: string; canonicalPosTag?: any }[],
): InternalTranslationResult {
  return {
    source,
    provider: 'sdcv',
    examples: [],
    senses: senses.map((s) => ({
      translation: s.translation,
      normalizedTranslation: s.translation,
      posTag: '',
      canonicalPosTag: s.canonicalPosTag ?? null,
    })),
  };
}

describe('dedupeAlternatives', () => {
  it('treats translations differing only by accent marks as duplicates', () => {
    const out = dedupeAlternatives([
      {
        translation: 'муха',
        normalizedTranslation: 'муха',
        posTag: '',
        canonicalPosTag: 'NOUN',
      },
      {
        translation: 'му́ха', // му́ха — same word with stress accent
        normalizedTranslation: 'му́ха',
        posTag: '',
        canonicalPosTag: 'NOUN',
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].translation).toBe('муха');
  });

  it('dedupes by (translation, canonicalPosTag), keeping first occurrence', () => {
    const out = dedupeAlternatives([
      {
        translation: 'муха',
        normalizedTranslation: 'муха',
        posTag: '',
        canonicalPosTag: 'NOUN',
      },
      {
        translation: 'муха',
        normalizedTranslation: 'муха',
        posTag: '',
        canonicalPosTag: 'NOUN',
      },
      {
        translation: 'муха',
        normalizedTranslation: 'муха',
        posTag: '',
        canonicalPosTag: 'VERB',
      },
    ]);
    expect(out).toHaveLength(2);
  });
});

describe('mergeSdcvResults', () => {
  it('returns null when both results are null', () => {
    expect(mergeSdcvResults(['fly', 'flies'], [null, null])).toBeNull();
  });

  it('uses text result when single query', () => {
    const merged = mergeSdcvResults(
      ['fly'],
      [res('fly', [{ translation: 'летать' }])],
    );
    expect(merged?.source).toBe('fly');
    expect(merged?.senses).toHaveLength(1);
  });

  it('prefers normalized result as primary and appends text senses after dedup', () => {
    const normalized = res('fly', [
      { translation: 'летать', canonicalPosTag: 'VERB' },
    ]);
    const text = res('flies', [
      { translation: 'летать', canonicalPosTag: 'VERB' }, // dup → dropped
      { translation: 'мухи', canonicalPosTag: 'NOUN' },
    ]);
    const merged = mergeSdcvResults(['fly', 'flies'], [normalized, text]);
    expect(merged?.source).toBe('fly');
    expect(merged?.senses.map((s) => s.translation)).toEqual([
      'летать',
      'мухи',
    ]);
  });

  it('falls back to text result when normalized is null', () => {
    const text = res('flies', [{ translation: 'мухи' }]);
    const merged = mergeSdcvResults(['fly', 'flies'], [null, text]);
    expect(merged?.source).toBe('flies');
  });
});
