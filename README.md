# LexiDeck Translation API

Standalone NestJS service between the LexiDeck iOS app and translation backends.
For a single word/idiom it returns a structured `TranslationResult`: an sdcv (local
StarDict) lookup first, falling back to Azure Translator (Dictionary Lookup +
Examples) when nothing is found locally. Single static API key auth.

See [`docs/spec.md`](docs/spec.md) and [`docs/implementation-plan.md`](docs/implementation-plan.md).

## Requirements

- Node 18+ (native `fetch`)
- [`sdcv`](https://dushistov.github.io/sdcv/) on `PATH` — `brew install sdcv`
- StarDict dictionaries under `dicts/<from>-<to>/`, mapped in `config/dictionaries.json`

## Setup

```bash
npm install
# edit .env as needed
npm run start:dev
```

Env vars (see `.env`):

| Var | Purpose |
|---|---|
| `API_KEY` | value the client sends in `X-API-Key` |
| `AZURE_ENABLED` | `false` disables all Azure calls (sdcv-only); default `true` |
| `AZURE_TRANSLATOR_KEY` / `AZURE_TRANSLATOR_REGION` | required when Azure enabled |
| `DICTIONARIES_CONFIG_PATH` | path to `dictionaries.json` (default `./config/dictionaries.json`) |
| `SDCV_TIMEOUT_MS` | sdcv subprocess timeout (default `3000`) |

## Endpoints

- `POST /v1/translate` — translate a word/idiom → `TranslationResultDto`
- `POST /v1/examples` — example sentences for a tapped alternative
- `GET /api` — Swagger UI

All endpoints require the `X-API-Key` header.

```bash
curl -X POST localhost:3000/v1/translate \
  -H 'Content-Type: application/json' -H 'X-API-Key: dev-secret' \
  -d '{"text":"fly","from":"en","to":"ru"}'
```

## Tests

```bash
npm test          # unit (parser, merge, pos-tag)
npm run test:e2e  # end-to-end against the real en-ru/ru-en dicts, AZURE_ENABLED=false
```

## Notes

- The bundled en-ru/ru-en dictionaries are FreeDict/WikDict StarDict files in HTML
  format (`sametypesequence=h`); the definition parser handles both that HTML shape
  (POS from `<font class="grammar">`, translations from leaf `<div>` nodes) and the
  plain-text/abbreviation format described in the spec.
- A single sdcv lookup can return multiple homograph entries (e.g. `fly` as
  adjective/noun/verb); their senses are concatenated and deduped.
- Azure calls go through native `fetch` but are never exercised while
  `AZURE_ENABLED=false` (no Azure keys configured yet).
