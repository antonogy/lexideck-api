import { dedupeSenceTranslations } from './merge';

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

