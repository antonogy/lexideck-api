import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { HttpExceptionFilter } from './../src/common/http-exception.filter';
import { AppModule } from './../src/app.module';

// Runs against the real en-ru/ru-en StarDict dictionaries with AZURE_ENABLED=false
// (set in .env), so only the sdcv path is exercised — no Azure calls.
const KEY = 'dev-secret';

describe('Translate API (e2e, sdcv-only)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (path: string, body: unknown, key?: string) => {
    const r = request(app.getHttpServer()).post(path);
    if (key) r.set('X-API-Key', key);
    return r.send(body);
  };

  describe('auth', () => {
    it('401 without key', async () => {
      const res = await post('/v1/translate', {
        text: 'fly',
        from: 'en',
        to: 'ru',
      });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'unauthorized' });
    });

    it('401 with wrong key', async () => {
      const res = await post(
        '/v1/translate',
        { text: 'fly', from: 'en', to: 'ru' },
        'nope',
      );
      expect(res.status).toBe(401);
    });
  });

  describe('validation', () => {
    it('400 when from === to', async () => {
      const res = await post(
        '/v1/translate',
        { text: 'fly', from: 'en', to: 'en' },
        KEY,
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_request');
    });

    it('400 when language unsupported', async () => {
      const res = await post(
        '/v1/translate',
        { text: 'fly', from: 'en', to: 'zz' },
        KEY,
      );
      expect(res.status).toBe(400);
    });

    it('400 when text missing', async () => {
      const res = await post('/v1/translate', { from: 'en', to: 'ru' }, KEY);
      expect(res.status).toBe(400);
    });
  });

  describe('translate via sdcv', () => {
    it('returns a structured result for en→ru "fly"', async () => {
      const res = await post(
        '/v1/translate',
        { text: 'fly', from: 'en', to: 'ru' },
        KEY,
      );
      expect(res.status).toBe(200);
      expect(res.body.provider).toBe('sdcv');
      expect(res.body.source).toBe('fly');
      expect(typeof res.body.translation).toBe('string');
      expect(res.body.translation.length).toBeGreaterThan(0);
      expect(Array.isArray(res.body.alternatives)).toBe(true);
      expect(res.body.examples).toEqual([]);
      // primary not duplicated into alternatives
      expect(res.body.alternatives).not.toContainEqual(
        expect.objectContaining({
          translation: res.body.translation,
          posTag: res.body.posTag,
        }),
      );
    });

    it('localizes posTag into the target language (ru)', async () => {
      const res = await post(
        '/v1/translate',
        { text: 'fly', from: 'en', to: 'ru' },
        KEY,
      );
      const tags = [
        res.body.posTag,
        ...res.body.alternatives.map((a: any) => a.posTag),
      ];
      // all tags are either "" or Russian abbreviations, never English words
      expect(tags).not.toContain('verb');
      expect(tags.some((t: string) => ['гл', 'сущ', 'прил'].includes(t))).toBe(
        true,
      );
    });

    it('does not leak canonicalPosTag in the response', async () => {
      const res = await post(
        '/v1/translate',
        { text: 'fly', from: 'en', to: 'ru' },
        KEY,
      );
      expect(
        res.body.alternatives.every(
          (a: any) => a.canonicalPosTag === undefined,
        ),
      ).toBe(true);
    });

    it('returns ru→en result for "муха"', async () => {
      const res = await post(
        '/v1/translate',
        { text: 'муха', from: 'ru', to: 'en' },
        KEY,
      );
      expect(res.status).toBe(200);
      expect(res.body.translation).toBe('fly');
      expect(res.body.posTag).toBe('noun');
    });

    it('uses normalized form when text itself is absent from the dict', async () => {
      const res = await post(
        '/v1/translate',
        { text: 'flies', normalized: 'fly', from: 'en', to: 'ru' },
        KEY,
      );
      expect(res.status).toBe(200);
      expect(res.body.source).toBe('fly');
    });

    it('404 not_found when neither sdcv nor Azure (disabled) has an entry', async () => {
      const res = await post(
        '/v1/translate',
        { text: 'zzzxqqnope', from: 'en', to: 'ru' },
        KEY,
      );
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'not_found' });
    });

    it('withExamples=true still yields examples:[] when Azure disabled (soft)', async () => {
      const res = await post(
        '/v1/translate',
        { text: 'fly', from: 'en', to: 'ru', withExamples: true },
        KEY,
      );
      expect(res.status).toBe(200);
      expect(res.body.examples).toEqual([]);
    });

    it('404 for a pair with no dictionary and Azure disabled', async () => {
      const res = await post(
        '/v1/translate',
        { text: 'casa', from: 'es', to: 'fr' },
        KEY,
      );
      expect(res.status).toBe(404);
    });
  });

  describe('/v1/examples', () => {
    it('returns { examples: [] } when Azure disabled', async () => {
      const res = await post(
        '/v1/examples',
        { text: 'fly', translation: 'муха', from: 'en', to: 'ru' },
        KEY,
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ examples: [] });
    });

    it('401 without key', async () => {
      const res = await post('/v1/examples', {
        text: 'fly',
        translation: 'муха',
        from: 'en',
        to: 'ru',
      });
      expect(res.status).toBe(401);
    });

    it('400 on missing translation', async () => {
      const res = await post(
        '/v1/examples',
        { text: 'fly', from: 'en', to: 'ru' },
        KEY,
      );
      expect(res.status).toBe(400);
    });
  });
});
