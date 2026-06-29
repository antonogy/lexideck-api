import { InternalTranslationResult } from '../translate/dto/translation-result.dto';
import { dedupeSenceTranslations, mergeSdcvResults } from './merge';

function res(
  source: string,
  senses: { translation: string[]; canonicalPosTag?: any }[],
): InternalTranslationResult {
  return {
    source,
    provider: 'sdcv',
    examples: [],
    senses: senses.map((s) => ({
      translation: s.translation,
      description: [],
      posTag: '',
      canonicalPosTag: s.canonicalPosTag ?? null,
    })),
  };
}

describe('dedupeSenceTranslations', () => {
  it('removes accent-mark duplicates within a sense translation list', () => {
    const out = dedupeSenceTranslations([
      {
        translation: ['муха', 'му́ха'], // му́ха is the accented duplicate
        description: [],
        posTag: '',
        canonicalPosTag: 'NOUN',
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].translation).toEqual(['муха']);
  });

  it('removes exact duplicates within a sense translation list', () => {
    const out = dedupeSenceTranslations([
      {
        translation: ['house', 'home', 'house'],
        description: [],
        posTag: '',
        canonicalPosTag: 'NOUN',
      },
    ]);
    expect(out[0].translation).toEqual(['house', 'home']);
  });

  it('does not deduplicate across senses — same word in two senses is kept', () => {
    const out = dedupeSenceTranslations([
      { translation: ['house'], description: ['building'], posTag: '', canonicalPosTag: 'NOUN' },
      { translation: ['house'], description: ['firm'], posTag: '', canonicalPosTag: 'NOUN' },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].translation).toEqual(['house']);
    expect(out[1].translation).toEqual(['house']);
  });

  it('preserves senses whose translations are already unique', () => {
    const out = dedupeSenceTranslations([
      { translation: ['house', 'home'], description: [], posTag: '', canonicalPosTag: 'NOUN' },
    ]);
    expect(out[0].translation).toEqual(['house', 'home']);
  });
});

describe('mergeSdcvResults', () => {
  it('returns null when both results are null', () => {
    expect(mergeSdcvResults(['fly', 'flies'], [null, null])).toBeNull();
  });

  it('uses text result when single query', () => {
    const merged = mergeSdcvResults(
      ['fly'],
      [res('fly', [{ translation: ['летать'] }])],
    );
    expect(merged?.source).toBe('fly');
    expect(merged?.senses).toHaveLength(1);
  });

  it('concatenates senses from both lookups and dedupes translations within each', () => {
    const normalized = res('fly', [
      { translation: ['летать', 'лета́ть'], canonicalPosTag: 'VERB' },
    ]);
    const text = res('flies', [
      { translation: ['мухи'], canonicalPosTag: 'NOUN' },
    ]);
    const merged = mergeSdcvResults(['fly', 'flies'], [normalized, text]);
    expect(merged?.source).toBe('fly');
    expect(merged?.senses).toHaveLength(2);
    // accent duplicate removed within the first sense
    expect(merged?.senses[0].translation).toEqual(['летать']);
    expect(merged?.senses[1].translation).toEqual(['мухи']);
  });

  it('falls back to text result when normalized is null', () => {
    const text = res('flies', [{ translation: ['мухи'] }]);
    const merged = mergeSdcvResults(['fly', 'flies'], [null, text]);
    expect(merged?.source).toBe('flies');
  });
});
