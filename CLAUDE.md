# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run start:dev          # dev server with watch
npm run build              # compile to dist/
npm test                   # unit tests (src/**/*.spec.ts)
npm run test:e2e           # e2e tests against real en-ru/ru-en dicts, AZURE_ENABLED=false
npm run test:cov           # coverage
npx jest --testPathPattern definition-parser  # single spec file
npm run lint               # eslint --fix
```

## Architecture

NestJS service bridging LexiDeck iOS → translation backends. Single static API key auth (`X-API-Key` → `API_KEY` env var, checked by `ApiKeyGuard` globally).

**Request flow for `POST /v1/translate`:**

1. `TranslateService` calls `DictionaryConfigService.getConfig(from, to)` — reads `config/dictionaries.json`.
2. If config found → `SdcvService.lookup()` shells out to `sdcv --json-output`. Error/timeout → 502 (no Azure fallback). `null` (not found) → fall through to Azure.
3. If no config or sdcv returned null → `AzureDictionaryService.lookup()`. Empty translations → 404.
4. `finalizeResult(result, to)` localizes `canonicalPosTag` → `posTag` string (per `POS_LABELS` in `src/translate/pos-tag.ts`).
5. If `withExamples=true` and `AZURE_ENABLED=true` → `AzureDictionaryService.examples()`. Failures are **soft** when `provider='sdcv'` (returns `examples:[]`) and **hard** (502) when `provider='azure'`.

`POST /v1/examples` calls `AzureDictionaryService.examples()` directly for a tapped alternative — no sdcv involved.

## Key Data Flow

`SdcvService` / `AzureDictionaryService` both return `InternalTranslationResult` (with internal `canonicalPosTag` on each sense). `finalizeResult()` converts this to the public `TranslationResultDto` by localizing POS tags and stripping `canonicalPosTag`.

`canonicalPosTag` (`'NOUN'|'VERB'|'ADJ'|'ADV'|'PREP'|null`) is internal-only — never serialized. `posTag` in the response is always localized to the *target* language (`to`), lowercase, no punctuation.

## Dictionary Parsing

`src/sdcv/definition-parser.ts` handles two formats declared per-dictionary in `config/dictionaries.json` via a `format` field:

- **`"html"`** (bundled en-ru/ru-en FreeDict/WikDict dicts): walks `sametypesequence=h` HTML through 8 structural templates (T1–T8). POS comes from `<font class="grammar">`. Multiple top-level `<div>` blocks = multiple homographs (e.g. `fly` as noun/verb/adj).
- **`"text"`**: line-split, strip sense markers, extract POS abbreviation via `pos-recognition.ts`.

`src/sdcv/merge.ts` deduplicates `translation[]` within each sense (accent-mark-aware) after parsing.

## Module Structure

```
src/
├── translate/          # controllers + TranslateService (orchestrator)
│   ├── dto/            # TranslateRequestDto, TranslationResultDto, ExamplesRequest/ResponseDto
│   ├── pos-tag.ts      # finalizeResult(), POS_LABELS localization table
│   └── supported-languages.ts
├── sdcv/               # SdcvService, definition-parser, merge, pos-recognition
│   └── dictionary-config.service.ts  # loads dictionaries.json
├── azure/              # AzureDictionaryService (lookup + examples)
├── auth/               # ApiKeyGuard
└── config/             # configuration.ts (env loading)
config/dictionaries.json  # (from,to) → {dictName, path, format}
dicts/                    # StarDict binary files (.ifo/.idx/.dict)
```

## Environment

```
API_KEY                    # required — client auth
AZURE_ENABLED              # false disables all Azure (default true)
AZURE_TRANSLATOR_KEY       # required when Azure enabled
AZURE_TRANSLATOR_REGION    # required when Azure enabled
DICTIONARIES_CONFIG_PATH   # default ./config/dictionaries.json
SDCV_TIMEOUT_MS            # default 3000
```

`AZURE_ENABLED=false` is the local dev default (no Azure keys configured). E2e tests always run with it false.

## Adding a New Dictionary

1. Place StarDict files under `dicts/<from>-<to>/`
2. Add entry to `config/dictionaries.json`:
   ```json
   "en-fr": { "dictName": "<exact name from .ifo bookname=>", "path": "./dicts/en-fr" }
   ```
   `format` is auto-detected from the `.ifo` `sametypesequence` at startup — no need to set it.
3. The 10 supported language codes are fixed in `src/translate/supported-languages.ts`; pairs outside that set → 400.

## Supported Languages

Fixed 10-code set: `en es fr de pt it ru nl pl uk`. All 90 directed pairs are requestable; only pairs in `dictionaries.json` hit sdcv — others go straight to Azure.
