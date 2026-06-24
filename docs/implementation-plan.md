# LexiDeck Translation API — Implementation Plan

## Overview

Implementation is split into 6 phases, ordered so each phase produces a runnable/testable increment. Phases 1–3 build the skeleton with full `POST /v1/translate` functionality backed by Azure only (no sdcv yet). Phases 4–5 layer in sdcv support and the `/v1/examples` endpoint. Phase 6 covers polish and Swagger documentation.

---

## Phase 1 — Project Scaffold

**Goal:** runnable NestJS app with auth, config, and DTOs in place. No translation logic yet.

### 1.1 — Initialise project

- `nest new lexideck-api` (select npm/pnpm as preferred)
- Set `"strict": true` in `tsconfig.json`
- Install dependencies:
  ```
  @nestjs/config
  @nestjs/swagger swagger-ui-express
  class-validator class-transformer
  ```
- Create `.env` file with all required env vars stubbed out:
  ```
  API_KEY=dev-secret
  AZURE_ENABLED=false
  AZURE_TRANSLATOR_KEY=
  AZURE_TRANSLATOR_REGION=
  DICTIONARIES_CONFIG_PATH=./config/dictionaries.json
  SDCV_TIMEOUT_MS=3000
  ```

### 1.2 — Config module

- Create `src/config/configuration.ts` — load and expose typed config from env vars:
  ```typescript
  export default () => ({
    apiKey: process.env.API_KEY,
    azure: {
      enabled: process.env.AZURE_ENABLED !== 'false',
      key: process.env.AZURE_TRANSLATOR_KEY,
      region: process.env.AZURE_TRANSLATOR_REGION,
    },
    sdcv: {
      timeoutMs: parseInt(process.env.SDCV_TIMEOUT_MS ?? '3000', 10),
    },
    dictionariesConfigPath: process.env.DICTIONARIES_CONFIG_PATH ?? './config/dictionaries.json',
  });
  ```
- Wire `ConfigModule.forRoot({ load: [configuration], isGlobal: true })` in `AppModule`

### 1.3 — Auth guard

- Create `src/auth/api-key.guard.ts` — `CanActivate` implementation:
  - Reads `X-API-Key` header from request
  - Compares against `config.apiKey` using constant-time comparison (`timingSafeEqual` from `crypto`)
  - Returns `false` (→ 401) on mismatch or missing header
- Register guard globally in `AppModule` via `APP_GUARD` provider

### 1.4 — DTOs

Create all DTOs in `src/translate/dto/`:

**`translate-request.dto.ts`**
```typescript
class TranslateRequestDto {
  @IsString() @IsNotEmpty() text: string;
  @IsString() @IsOptional() normalized?: string;
  @IsString() @Length(2, 2) from: string;
  @IsString() @Length(2, 2) to: string;
  @IsBoolean() @IsOptional() withExamples?: boolean;
}
```

**`translation-result.dto.ts`** — `TranslationAlternativeDto`, `TranslationExampleDto`, `TranslationResultDto`, `InternalTranslationResult`, `CanonicalPosTag` type, as specified in the API spec

**`examples-request.dto.ts`** / **`examples-response.dto.ts`** — per the spec

- Enable `ValidationPipe` globally in `main.ts` with `{ whitelist: true, transform: true }`

### 1.5 — Language allowlist validation

- Create `src/translate/supported-languages.ts` — exports `SUPPORTED_LANGUAGES` set (10 codes) and a `validateLanguagePair(from, to)` helper that throws `BadRequestException` when either code is outside the set or `from === to`
- Call this from `TranslateController` before delegating to the service

### Checkpoint
- App starts, `POST /v1/translate` returns 401 without key, 400 on bad body, 500 with key (no logic yet)

---

## Phase 2 — Azure Dictionary Service

**Goal:** `POST /v1/translate` fully functional via Azure only (`AZURE_ENABLED=true`, no sdcv). This is the fastest path to a working end-to-end integration.

### 2.1 — Azure module

- Create `src/azure/azure.module.ts` and `src/azure/azure-dictionary.service.ts`
- Inject `ConfigService`; validate at startup that `key`/`region` are present when `azure.enabled=true` (throw on missing)

### 2.2 — `AzureDictionaryService.lookup()`

- `POST https://api.cognitive.microsofttranslator.com/dictionary/lookup?api-version=3.0&from={from}&to={to}`
- Headers: `Ocp-Apim-Subscription-Key`, `Ocp-Apim-Subscription-Region`, `Content-Type: application/json`
- Body: `[{ "Text": queryTerm }]`
- Parse response:
  - `translations[]` empty → throw `NotFoundException`
  - Sort by `confidence` desc
  - Map each to `TranslationAlternativeDto` with `translation` = `displayTarget`, `normalizedTranslation` = `normalizedTarget`, `canonicalPosTag` from the Azure-tag → canonical map:
    ```typescript
    const AZURE_TO_CANONICAL: Record<string, CanonicalPosTag> = {
      NOUN: 'NOUN', VERB: 'VERB', ADJ: 'ADJ', ADV: 'ADV', PREP: 'PREP',
    };
    ```
  - `source` = response's `normalizedSource` field
  - Return `InternalTranslationResult` with `senses[]`, `provider='azure'`, `examples=[]`

### 2.3 — `AzureDictionaryService.examples()`

- `POST https://api.cognitive.microsofttranslator.com/dictionary/examples?api-version=3.0&from={from}&to={to}`
- Body: `[{ "Text": queryTerm, "Translation": translation }]`
- Map each result entry to `TranslationExampleDto` using `targetPrefix`/`targetTerm`/`targetSuffix` (source-side fields discarded)
- Return `TranslationExampleDto[]` (may be empty, not an error)

### 2.4 — POS tag finalization helpers

Implement standalone functions (not class methods) in `src/translate/pos-tag.ts`:

- `POS_LABELS` table (canonical → per-language abbreviation, all 10 languages)
- `localizePosTag(canonicalTag, to): string`
- `finalizeResult(result: InternalTranslationResult, to: string): TranslationResultDto` — localizes POS tags, extracts `senses[0]` into top-level fields, sets `alternatives = senses[1:]`, strips `canonicalPosTag` from output

### 2.5 — `TranslateService` (Azure-only stub)

- Create `src/translate/translate.service.ts`
- `translate(req)`:
  - If `!config.azure.enabled` → throw `NotFoundException` (no sdcv either in this phase)
  - Call `azure.lookup(req.text, req.from, req.to)`
  - Call `finalizeResult(azureResult, req.to)`
  - Call `maybeAttachExamples(final, req)` — calls `azure.examples()` if `withExamples && azureEnabled`; hard-fail for azure provider

### 2.6 — `TranslateController`

- Create `src/translate/translate.controller.ts`
- `@Post('/v1/translate')` handler: validates language pair, delegates to `TranslateService`, returns result
- Wire `TranslateModule` into `AppModule`

### Checkpoint
- With `AZURE_ENABLED=true` and valid Azure credentials: `POST /v1/translate` returns full `TranslationResultDto`
- `withExamples=true` returns populated `examples[]`
- `AZURE_ENABLED=false` returns 404

---

## Phase 3 — `/v1/examples` Endpoint

**Goal:** standalone Examples endpoint for alternative translation taps.

### 3.1 — `ExamplesController`

- Create `src/translate/examples.controller.ts`
- `@Post('/v1/examples')` handler:
  - Validates language pair (reuse `validateLanguagePair`)
  - If `!config.azure.enabled` → return `{ examples: [] }` immediately (no error)
  - Call `azure.examples(req.text, req.translation, req.from, req.to)` → return `ExamplesResponseDto`
  - On Azure error → 502 `upstream_error`

### 3.2 — Wire up

- Register `ExamplesController` in `TranslateModule`

### Checkpoint
- `POST /v1/examples` returns `{ "examples": [...] }` for a valid pair
- `AZURE_ENABLED=false` returns `{ "examples": [] }` with 200

---

## Phase 4 — sdcv Integration

**Goal:** sdcv-first lookup with Azure as fallback; the full request flow as specified.

### 4.1 — Dictionary config

- Create `src/sdcv/dictionary-config.service.ts`:
  - Loads `dictionaries.json` at startup (path from config)
  - Exposes `getConfig(from, to): DictionaryConfig | null`
  - Logs a warning at startup if the config file is missing (not an error — empty config is valid)
- Create `config/dictionaries.json` with empty object `{}` as starting point

### 4.2 — `SdcvService`

Create `src/sdcv/sdcv.service.ts`:

**Invocation**
```typescript
async lookup(text: string, config: DictionaryConfig): Promise<InternalTranslationResult | null>
```

Shell out using Node's `child_process.execFile` (not `exec` — avoids shell injection):
```
sdcv --non-interactive --json-output --utf8-output --data-dir <path> -u <dictName> <text>
```
Apply `SDCV_TIMEOUT_MS` as the child process timeout.

**Output handling**
- Non-zero exit (other than "not found") or timeout → throw `UpstreamException` (→ 502)
- Parse stdout as JSON: `[{ word, dict, definition }]`
- Empty array or sdcv's "Nothing similar to..." message → return `null`
- On one match: parse `definition` into `senses[]` (see §4.3)
- Return `InternalTranslationResult` with `source = entry.word`, `provider = 'sdcv'`, `examples = []`

**Robustness**
- Wrap entire method in try/catch; re-throw as `UpstreamException` on unexpected errors

### 4.3 — Definition parser

Create `src/sdcv/definition-parser.ts`:

```typescript
function parseDefinition(definition: string): TranslationAlternativeDto[]
```

Algorithm per the spec:
1. Split `definition` by newlines, discard empty lines
2. Strip leading sense markers (`1)`, `2.`, `•`, etc.) via regex
3. Match leading POS abbreviation against recognition table → `canonicalPosTag`; strip the abbreviation from the remainder
4. Remainder (trimmed) → `translation`; set `normalizedTranslation = translation`
5. Return one `TranslationAlternativeDto` per line

POS recognition table (in `src/sdcv/pos-recognition.ts`):
```typescript
const POS_PATTERNS: [RegExp, CanonicalPosTag][] = [
  [/^(n\.|сущ\.)\s*/i, 'NOUN'],
  [/^(v\.|гл\.)\s*/i, 'VERB'],
  [/^(adj\.|прил\.)\s*/i, 'ADJ'],
  [/^(adv\.|нареч\.)\s*/i, 'ADV'],
  [/^(prep\.|предл\.)\s*/i, 'PREP'],
];
```

### 4.4 — Merge logic

Add `mergeSdcvResults(queries, results)` and `dedupeAlternatives(senses)` in `src/sdcv/merge.ts` per the spec:
- Prefer `normalized` query's result as primary
- Append `text` query's senses after dedup by `(translation, canonicalPosTag ?? '')`

### 4.5 — Update `TranslateService`

Wire sdcv into the full request flow:

```typescript
async translate(req): Promise<TranslationResultDto> {
  const config = this.dictConfig.getConfig(req.from, req.to);

  if (config) {
    const queries = (req.normalized && req.normalized !== req.text)
      ? [req.normalized, req.text]
      : [req.text];

    const results = await Promise.all(queries.map(q => this.sdcv.lookup(q, config)));
    // any throw → propagates as 502

    const merged = mergeSdcvResults(queries, results);
    if (merged) {
      const final = finalizeResult(merged, req.to);
      return this.maybeAttachExamples(final, req); // soft-fail
    }
    // both null → fall through
  }

  if (!this.config.azure.enabled) throw new NotFoundException();

  const azureResult = await this.azure.lookup(req.text, req.from, req.to);
  const final = finalizeResult(azureResult, req.to);
  return this.maybeAttachExamples(final, req); // hard-fail
}
```

### 4.6 — Create `SdcvModule`, wire into `AppModule`

### Checkpoint
- With `dictionaries.json` empty: all lookups still go to Azure (same as Phase 2)
- Add a test StarDict dictionary entry to `dictionaries.json`; verify sdcv path is hit and returns structured result
- Verify sdcv "not found" → falls through to Azure
- Verify sdcv process error → 502 (no Azure call)
- Verify `withExamples=true` on sdcv hit → Azure Examples called, soft-fail on error

---

## Phase 5 — Error Handling & Edge Cases

**Goal:** harden all error paths before the Swagger pass.

### 5.1 — Exception filter

- Create `src/common/http-exception.filter.ts` — global exception filter that maps:
  - `BadRequestException` → `{ "error": "invalid_request", "message": "..." }`
  - `UnauthorizedException` → `{ "error": "unauthorized" }`
  - `NotFoundException` → `{ "error": "not_found" }`
  - `ServiceUnavailableException` → `{ "error": "unsupported_language_pair" }`
  - `BadGatewayException` → `{ "error": "upstream_error", "message": "..." }`
  - Any unhandled → `{ "error": "internal_error" }` + log
- Register globally in `main.ts`

### 5.2 — `TranslateService` unsupported-pair handling

- After language-pair validation: if no dict config AND `!azureEnabled` → throw `NotFoundException`
- After sdcv "both null" AND `!azureEnabled` → throw `NotFoundException`
- After Azure lookup returns empty `translations[]` → throw `NotFoundException` (already in `AzureDictionaryService`)
- If `from`/`to` pair is not in Azure's dictionary scope (Azure returns 400/empty for a valid-code but unsupported pair) → throw `ServiceUnavailableException` (`503`)

### 5.3 — `SdcvService` process error classification

Distinguish between:
- Exit code 0, empty/not-found output → `null` (not found, safe to fall through)
- Exit code non-zero → `BadGatewayException` (→ 502, no fallback)
- Timeout → `BadGatewayException`
- JSON parse error of sdcv output → `BadGatewayException`

### 5.4 — Definition parser edge cases

- `definition` is empty string → return `[]` (treated as not-found)
- All lines are empty after stripping → return `[]`
- Lines with no recognisable translation text (only a POS abbreviation, no remainder) → skip that line
- HTML-markup detection: if `definition` contains `<` tags, strip HTML before line-splitting (basic `replace(/<[^>]+>/g, '')`) — defensive measure until specific dicts are chosen

### 5.5 — `AzureDictionaryService` error classification

- HTTP 4xx from Azure (bad key, unsupported pair) → `ServiceUnavailableException` or `BadGatewayException` as appropriate, with Azure's error message forwarded in `message`
- HTTP 5xx / network errors → `BadGatewayException`

### Checkpoint
- All error paths return the correct status code and `{ "error": "..." }` body shape
- 502 on sdcv crash; 404 on not-found; 503 on unsupported pair; 401 on bad key; 400 on bad request

---

## Phase 6 — Swagger Documentation

**Goal:** self-documenting OpenAPI spec via `@nestjs/swagger` decorators, accessible at `/api`.

### 6.1 — Setup

In `main.ts`:
```typescript
const config = new DocumentBuilder()
  .setTitle('LexiDeck Translation API')
  .setVersion('1.0')
  .addApiKey({ type: 'apiKey', in: 'header', name: 'X-API-Key' }, 'apiKey')
  .build();
const doc = SwaggerModule.createDocument(app, config);
SwaggerModule.setup('api', app, doc);
```

### 6.2 — Decorate DTOs

Add to all DTO classes/interfaces:
- `@ApiProperty()` / `@ApiPropertyOptional()` on every field with description + example values
- `TranslateRequestDto`, `TranslationAlternativeDto`, `TranslationExampleDto`, `TranslationResultDto`, `ExamplesRequestDto`, `ExamplesResponseDto`

### 6.3 — Decorate controllers

**`TranslateController`**
```typescript
@ApiTags('translate')
@ApiSecurity('apiKey')
@ApiOperation({ summary: 'Translate a word or idiom' })
@ApiBody({ type: TranslateRequestDto })
@ApiResponse({ status: 200, type: TranslationResultDto })
@ApiResponse({ status: 400, description: 'Invalid request' })
@ApiResponse({ status: 401, description: 'Unauthorized' })
@ApiResponse({ status: 404, description: 'Not found' })
@ApiResponse({ status: 502, description: 'Upstream error' })
@ApiResponse({ status: 503, description: 'Unsupported language pair' })
```

**`ExamplesController`**
```typescript
@ApiTags('examples')
@ApiSecurity('apiKey')
@ApiOperation({ summary: 'Fetch usage examples for an alternative translation' })
@ApiBody({ type: ExamplesRequestDto })
@ApiResponse({ status: 200, type: ExamplesResponseDto })
@ApiResponse({ status: 400, description: 'Invalid request' })
@ApiResponse({ status: 401, description: 'Unauthorized' })
@ApiResponse({ status: 502, description: 'Upstream error' })
```

### Checkpoint
- `GET /api` renders Swagger UI
- Both endpoints are visible with request/response schemas and example values
- "Authorize" button in Swagger UI accepts `X-API-Key`

---

## File Structure (final)

```
src/
├── main.ts                                  # bootstrap, Swagger setup
├── app.module.ts
├── common/
│   └── http-exception.filter.ts             # global exception filter
├── auth/
│   ├── auth.module.ts
│   └── api-key.guard.ts
├── config/
│   └── configuration.ts
├── translate/
│   ├── translate.module.ts
│   ├── translate.controller.ts              # POST /v1/translate
│   ├── examples.controller.ts               # POST /v1/examples
│   ├── translate.service.ts
│   ├── pos-tag.ts                           # POS_LABELS, localizePosTag, finalizeResult
│   └── dto/
│       ├── translate-request.dto.ts
│       ├── translation-result.dto.ts
│       ├── examples-request.dto.ts
│       └── examples-response.dto.ts
├── sdcv/
│   ├── sdcv.module.ts
│   ├── sdcv.service.ts
│   ├── definition-parser.ts
│   ├── pos-recognition.ts
│   ├── merge.ts
│   └── dictionary-config.service.ts
└── azure/
    ├── azure.module.ts
    └── azure-dictionary.service.ts
config/
└── dictionaries.json                        # empty {} until dicts sourced
```

---

## Dependency Reference

| Package | Purpose |
|---|---|
| `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` | NestJS runtime |
| `@nestjs/config` | Env var loading |
| `@nestjs/swagger`, `swagger-ui-express` | OpenAPI docs |
| `class-validator`, `class-transformer` | DTO validation + transform |
| `node-fetch` or native `fetch` (Node 18+) | Azure HTTP calls |

No ORM, no database, no queue library — the service is stateless and has no persistence layer in MVP.

---

## Development Sequence Summary

| Phase | Delivers |
|---|---|
| 1 | Runnable app, auth, config, DTOs, language validation |
| 2 | Full `/v1/translate` via Azure — end-to-end working integration |
| 3 | `/v1/examples` endpoint |
| 4 | sdcv-first lookup with Azure fallback — complete request flow |
| 5 | Hardened error handling, all error shapes correct |
| 6 | Swagger UI, all endpoints documented |
