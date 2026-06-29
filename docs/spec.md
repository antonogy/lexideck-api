# LexiDeck Translation API — Backend Spec (v1)

## Overview

A standalone NestJS service that sits between the LexiDeck iOS app and translation backends. For a given word or idiom (not full sentences), it returns a structured `TranslationResult` matching the shape already used by the iOS app's `TranslationService` protocol. The server tries `sdcv` first, then falls back to Azure Translator's Dictionary Lookup + Dictionary Examples endpoints if sdcv finds no entry.

This service is single-tenant (personal use), with a single static API key for auth.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | NestJS |
| Local dictionary | `sdcv` CLI (`--json-output`) over regular StarDict-format dictionaries |
| Remote fallback | Azure Translator API v3 (Dictionary Lookup + Dictionary Examples) |
| Auth | Static API key via header, checked against env var |

---

## Supported Languages (MVP)

To keep dictionary sourcing and Azure pair-verification manageable for MVP, the server restricts `from`/`to` to a fixed set of 10 languages, chosen for relevance across Europe and the Americas:

| Code | Language |
|---|---|
| `en` | English |
| `es` | Spanish |
| `fr` | French |
| `de` | German |
| `pt` | Portuguese |
| `it` | Italian |
| `ru` | Russian |
| `nl` | Dutch |
| `pl` | Polish |
| `uk` | Ukrainian |

- `from` and `to` must both be in this set, and must differ. A request with either code outside this list → `400 invalid_request`.
- This is the full universe of *requestable* pairs (10 × 9 = 90 directed pairs), not a guarantee that each has an sdcv dictionary configured — `dictionaries.json` covers a subset (see `DictionaryConfigService`), and any pair not in `dictionaries.json` still falls through to Azure.
- All pairs in this list are expected to be within Azure Translator's Dictionary Lookup scope (EN↔{ES,FR,DE,PT,IT,RU,NL,PL,UK} and the reverse are all commonly supported); this should be spot-checked against Azure's supported-languages list before relying on it for any specific pair, since Azure's *dictionary* scope is narrower than its general translation scope.
- This list can be extended later by adding entries to a config-driven allowlist rather than hardcoding — flagged as a follow-up if/when more languages are needed.

### `POST /v1/translate`

**Request body**
```json
{
  "text": "fly",
  "from": "en",
  "to": "ru",
  "withExamples": true
}
```
- `text` — a single word or idiom (not a sentence), as the user typed/spoke it
- `from`, `to` — BCP 47 language codes, matching `Workspace.languageA` / `languageB`; must each be one of the 10 supported codes listed in "Supported Languages (MVP)" above, and must differ from each other
- `withExamples` — optional, default `false`. If `true`, an Azure Dictionary Examples call is made for the primary translation **regardless of which provider (`sdcv` or `azure`) produced it**. If `false` (or omitted), `examples` is always `[]` and no Examples call is made — even when `provider="azure"` (previously, the Azure-fallback path always called Examples; this is no longer the case).

**Headers**
```
X-API-Key: <key>
```

**Response body — `TranslationResult`**
```json
{
  "source": "fly",
  "senses": [
    {
      "translation": ["летать"],
      "description": [],
      "posTag": "гл"
    },
    {
      "translation": ["муха"],
      "description": ["(non-technical) any fly of family Muscidae"],
      "posTag": "сущ"
    }
  ],
  "examples": [],
  "provider": "sdcv"
}
```
(`text="fly"`, `to="ru"`. The dictionary's `fly` entry has two senses — "летать" (verb) and "муха" (noun). `senses[0]` is the primary (first/highest-confidence sense). Azure results additionally carry `normalizedTranslation` per sense; sdcv results leave it absent.)

**Field semantics — `translation` and `description`:** `senses[].translation` is `string[]` — one or more target-language words for this sense (e.g. `["летать"]` or `["дом", "жилище"]`). `senses[].description` is `string[]` — source-language gloss(es) from the dictionary definition (e.g. `["(non-technical) any fly of family Muscidae"]`); `[]` when none.

**Field semantics — `normalizedTranslation`:** `senses[].normalizedTranslation` is the canonical form expected by downstream lookups (Azure Dictionary Examples). It is only set by Azure results; sdcv results leave it `undefined`. `maybeAttachExamples` falls back to `req.text` when it is absent.

**Field semantics — `posTag`:** part-of-speech labels are localized into the *target language* (`to`), not English, and follow a fixed format: lowercase, no punctuation (e.g. `гл` not `гл.`, `verb` not `VERB.`). The intent is that `posTag` is directly displayable next to the translation without further formatting — e.g. "гл — летать" for an en→ru result. If no POS information is available for a sense, `posTag` is `""`. See "Finalizing the Result" below for the canonical-tag → localized-abbreviation mapping.

**`senses[]` order.** `senses[0]` is the primary (highest-confidence / first-listed) sense. A result may have `senses.length === 1` if only one sense was found — this is not an error.

`provider` tells the client which backend served the result (informational; iOS can ignore it, but useful for debugging/telemetry).

When `withExamples` is `false` or omitted, `examples` is always `[]` regardless of `provider`, and no Azure Examples call is made. When `withExamples` is `true`, `examples` is populated via a Dictionary Examples call for `(text, senses[0].normalizedTranslation ?? text)` regardless of `provider` — see "Examples (`withExamples`)" below for the exact behavior and per-provider error handling.

**Error responses**

| Status | Condition | Body |
|---|---|---|
| 401 | Missing/invalid `X-API-Key` | `{ "error": "unauthorized" }` |
| 400 | Missing/invalid `text`, `from`, or `to`; `from`/`to` not in the supported language set; or `from == to` | `{ "error": "invalid_request", "message": "..." }` |
| 404 | sdcv found no entry for `text` and Azure also found none | `{ "error": "not_found" }` |
| 502 | sdcv crashed/errored/timed out; Azure lookup call failed; or (`provider="azure"` AND `withExamples=true`) the Azure Examples call failed | `{ "error": "upstream_error", "message": "..." }` |
| 503 | No dictionary configured for `(from, to)` and Azure pair also unsupported | `{ "error": "unsupported_language_pair" }` |

---

### `POST /v1/examples`

Used when the user taps an **alternative** translation in the result panel — re-fetches example sentences for that specific `(text, translation)` pair without re-running the full lookup. This always calls Azure Dictionary Examples directly (`AzureDictionaryService.examples()`), since example sentences are Azure-only regardless of which provider served the original lookup.

**Request body**
```json
{
  "text": "flies",
  "translation": "муха",
  "from": "en",
  "to": "ru"
}
```
- `text` — the original source word/idiom, as sent to `/v1/translate` (the raw client input, same as that endpoint's `text`)
- `translation` — the `translation` (or `normalizedTranslation`) of the alternative the user tapped, taken from that alternative's entry in the prior `/v1/translate` response's `alternatives[]`
- `from`, `to` — same as `/v1/translate`; must be in the 10-language supported set and differ

**Headers**
```
X-API-Key: <key>
```

**Response body**
```json
{
  "examples": [
    {
      "targetPrefix": "На кухне летала ",
      "targetTerm": "муха",
      "targetSuffix": "."
    }
  ]
}
```
- `examples: TranslationExampleDto[]` — same shape as `/v1/translate`'s `examples` field (target-language only, `targetPrefix`/`targetTerm`/`targetSuffix`)
- May be `[]` if Azure returns no examples for this pair (not an error — same "hide silently" behavior as the iOS spec's empty-examples rule)

**Error responses**

| Status | Condition | Body |
|---|---|---|
| 401 | Missing/invalid `X-API-Key` | `{ "error": "unauthorized" }` |
| 400 | Missing/invalid `text`, `translation`, `from`, or `to`; `from`/`to` not in the supported language set; or `from == to` | `{ "error": "invalid_request", "message": "..." }` |
| 502 | Azure Examples call failed (network/auth error) | `{ "error": "upstream_error", "message": "..." }` |
| 503 | `from`/`to` pair not supported by Azure's dictionary scope | `{ "error": "unsupported_language_pair" }` |

Unlike `/v1/translate`, there is no `404 not_found` here — an empty `translations`/`examples[]` from Azure is represented as `{ "examples": [] }`, not an error, since the `(text, translation)` pair is assumed valid (it came from a prior successful `/v1/translate` response).

If `AZURE_ENABLED=false`, this endpoint always returns `{ "examples": [] }` immediately without calling Azure, and no error is returned — same contract, just always empty.

**Module structure**: handled by a new `examples.controller.ts` in the `translate/` module (or a sibling `examples/` module), calling the existing `AzureDictionaryService.examples()` directly — no new service logic required.

---

## Request Flow

```
POST /v1/translate { text, from, to, withExamples? }
  │
  ├─► 1. Validate X-API-Key (env var ANTHROPIC-style static secret)
  │
  ├─► 1.5. Validate `from`/`to` against the supported language set (10 codes) and `from != to`
  │         → 400 invalid_request if either check fails
  │
  ├─► 2. Resolve dictionary config for (from, to)
  │       - look up DictionaryConfig entry
  │       - if none exists AND AZURE_ENABLED=false → 404 not_found immediately
  │       - if none exists AND AZURE_ENABLED=true → skip to step 4 (Azure) directly
  │
  ├─► 3. sdcv lookup
  │       - run sdcv for `text`
  │       - error/crash/timeout → 502 upstream_error immediately
  │         (do NOT fall back to Azure — Azure quota is conserved for "not found" only)
  │       - null (not found) AND AZURE_ENABLED=false → 404 not_found
  │       - null AND AZURE_ENABLED=true → fall through to step 4 (Azure)
  │       - non-null → step 5, provider="sdcv", examples=[]
  │
  ├─► 4. Azure fallback (only when both sdcv queries returned "not found" AND AZURE_ENABLED=true)
  │       - call Dictionary Lookup (from, to, text) — the raw client input
  │         (Azure performs its own normalization server-side)
  │       - if translations[] empty → 404 not_found
  │       - build senses[] from response (senses[0] = highest confidence)
  │       - result → step 5, provider="azure", examples=[]
  │
  ├─► 5. Finalize: localize posTags + extract primary (applies to both branches above)
  │       - convert each sense's canonicalPosTag → posTag string via POS_LABELS[to]
  │       - extract senses[0] into top-level translation/normalizedTranslation/posTag
  │       - set alternatives = senses[1:] (primary excluded, NOT duplicated)
  │       - strip canonicalPosTag from the serialized response
  │       - result → step 6
  │
  └─► 6. Examples (only if `withExamples === true` AND AZURE_ENABLED=true)
          - if AZURE_ENABLED=false → skip, examples stays []
          - call Dictionary Examples for (text, result.normalizedTranslation)
          - provider="sdcv" + Examples call fails → SOFT fail, return result with examples=[]
          - provider="azure" + Examples call fails → HARD fail, 502 (same as any other Azure error)
          - on success → attach examples to result
          - if withExamples is false/absent → examples stays [], no call made
          - return final TranslationResultDto
```

---

## Module Structure

```
src/
├── main.ts
├── app.module.ts
├── translate/
│   ├── translate.module.ts
│   ├── translate.controller.ts        # POST /v1/translate — annotate with @nestjs/swagger decorators
│   ├── examples.controller.ts         # POST /v1/examples — annotate with @nestjs/swagger decorators
│   ├── translate.service.ts           # orchestrates sdcv → azure flow
│   └── dto/
│       ├── translate-request.dto.ts
│       ├── translation-result.dto.ts
│       ├── examples-request.dto.ts
│       └── examples-response.dto.ts
├── sdcv/
│   ├── sdcv.module.ts
│   ├── sdcv.service.ts                # shells out to sdcv, parses output
│   └── dictionary-config.service.ts   # loads (from,to) → dict name/path mapping
├── azure/
│   ├── azure.module.ts
│   └── azure-dictionary.service.ts    # Dictionary Lookup + Examples calls
├── auth/
│   ├── auth.module.ts
│   └── api-key.guard.ts               # checks X-API-Key against env var
└── config/
    ├── configuration.ts                # env loading (Azure key/region, API key, dict config path)
    └── dictionaries.json               # (from,to) -> sdcv dict name/path mapping
```

---

## Key Interfaces

### `TranslateRequestDto`
```typescript
class TranslateRequestDto {
  text: string;           // required, non-empty
  from: string;           // required, BCP 47 code
  to: string;             // required, BCP 47 code
  withExamples?: boolean; // optional, default false
}
```

### `TranslationResultDto`
```typescript
type CanonicalPosTag = 'NOUN' | 'VERB' | 'ADJ' | 'ADV' | 'PREP';

// One dictionary sense. Used as the element type for InternalTranslationResult.senses[]
// (internal) and TranslationResultDto.senses[] (public). `canonicalPosTag` is internal-only
// and stripped by finalizeResult() before the response is sent.
class TranslationSenseDto {
  translation: string[];           // one or more target-language words for this sense
  description: string[];           // source-language gloss(es); [] when none
  normalizedTranslation?: string;  // Azure-only; undefined for sdcv
  posTag: string;                  // localized, lowercase, no punctuation; "" if unknown
  canonicalPosTag?: CanonicalPosTag | null; // internal only, stripped before serialization
}

interface TranslationExampleDto {
  targetPrefix: string;
  targetTerm: string;
  targetSuffix: string;
}

// Internal working shape produced by SdcvService / AzureDictionaryService.
// senses[0] is the primary; senses[1:] are secondary.
interface InternalTranslationResult {
  source: string;
  senses: TranslationSenseDto[];
  examples: TranslationExampleDto[];
  provider: 'sdcv' | 'azure';
}

// Public response shape produced by finalizeResult().
class TranslationResultDto {
  source: string;
  senses: TranslationSenseDto[];   // all senses in order; senses[0] = primary
  examples: TranslationExampleDto[];
  provider: 'sdcv' | 'azure';
}
```
`canonicalPosTag` is populated by `SdcvService`/`AzureDictionaryService` and consumed by `finalizeResult` for POS localization; it is stripped before the response is sent and is not part of the public contract.

### `ExamplesRequestDto` / `ExamplesResponseDto`

Used by `POST /v1/examples`.

```typescript
class ExamplesRequestDto {
  text: string;         // required, non-empty — the original source word/idiom (raw input, same as TranslateRequestDto.text)
  translation: string;  // required, non-empty — the tapped alternative's translation/normalizedTranslation
  from: string;          // required, BCP 47 code
  to: string;            // required, BCP 47 code
}

interface ExamplesResponseDto {
  examples: TranslationExampleDto[]; // may be empty; not an error
}
```

### `DictionaryConfigService`

Loads `dictionaries.json` at startup, mapping language pairs to sdcv dictionary identifiers:

```json
{
  "en-ru": { "dictName": "stardict-en-ru-mueller", "path": "/dicts/en-ru" },
  "ru-en": { "dictName": "stardict-ru-en-mueller", "path": "/dicts/ru-en" },
  "en-es": { "dictName": "stardict-en-es", "path": "/dicts/en-es" },
  "en-de": { "dictName": "stardict-en-de", "path": "/dicts/en-de" },
  "en-fr": { "dictName": "stardict-en-fr", "path": "/dicts/en-fr" }
}
```
Entries are added incrementally as dictionary files are sourced for specific pairs from the 10-language MVP set (see "Supported Languages" above); pairs without an entry fall through to Azure.

```typescript
class DictionaryConfigService {
  getConfig(from: string, to: string): DictionaryConfig | null;
}

interface DictionaryConfig {
  dictName: string;  // sdcv -u argument
  path: string;      // directory containing the .ifo/.idx/.dict files
}
```

Pair key is `"${from}-${to}"`. If no entry exists, sdcv step is skipped entirely and the flow goes straight to Azure (using `text` as the query term).

### `SdcvService`

```typescript
class SdcvService {
  // Returns parsed result, or null if "not found"/empty.
  // Throws on process error (non-zero exit, timeout, malformed JSON from sdcv itself).
  async lookup(text: string, config: DictionaryConfig): Promise<InternalTranslationResult | null>;
}
```

**Invocation**
```
sdcv --non-interactive --json-output --utf8-output --data-dir <path> -u <dictName> <text>
```

`--json-output` produces an array of `{ word, dict, definition }` objects, one per dictionary that matched. Since the request specifies a single `dictName` via `-u`, the array has at most one element.

- Empty array (or sdcv's "Nothing similar to ... found" with no JSON) → return `null` (not found, fall through to Azure).
- Non-zero exit code, timeout, or unparseable top-level JSON → throw (caller maps to 502, no Azure fallback).

**Parsing `definition` into senses**

The dictionary format (`sametypesequence`) determines the parser path, declared per-dictionary in `dictionaries.json` via a `format` field (`"html"` or `"text"`):

- **HTML format** (WikDict/FreeDict StarDict dicts, `sametypesequence=h`): the `definition` is a string of one or more `<div>` blocks (one per homograph), each containing a POS grammar `<div>` and a structured body. The HTML parser (`src/sdcv/definition-parser.ts`) walks 8 structural templates (T1–T8) covering flat single-sense, flat multi-translation, sense-list, and description+translation-list patterns, extracting `translation: string[]` and `description: string[]` per sense. The POS grammar div maps to a canonical tag.

- **Text format** (plain-text dicts): the `definition` is a multi-line string. Each non-empty line has a leading sense marker stripped (e.g. `1)`, `2.`, `•`), a leading POS abbreviation extracted via a fixed recognition table, and the remainder becomes `translation[0]`. `description` is `[]`.

POS recognition table (text format; HTML format reads the grammar div class instead):

| Abbreviation pattern | Canonical tag |
|---|---|
| `n.`, `сущ.` | `NOUN` |
| `v.`, `гл.` | `VERB` |
| `adj.`, `прил.` | `ADJ` |
| `adv.`, `нареч.` | `ADV` |
| `prep.`, `предл.` | `PREP` |
| (no match) | `null` (unknown) |

`normalizedTranslation` is **not set** by sdcv — `senses[].normalizedTranslation` is `undefined` for all sdcv results. Within-sense translation dedup (accent-mark-aware) is applied by `dedupeSenceTranslations` in `src/sdcv/merge.ts` before the result is returned.

**Building the result**

- `source` = `word` field from the sdcv JSON entry (the matched headword).
- `senses[]` = parsed senses in definition order (`senses[0]` = primary).
- `provider` = `'sdcv'`, `examples` = `[]`.
- Returns `InternalTranslationResult` (not yet finalized — `posTag` localization is applied later by `finalizeResult`).
- If `definition` parses to zero non-empty senses → treat as "not found" (return `null`).

### `AzureDictionaryService`

Reuses the same two-call pattern as the iOS-side Phase 5 plan, but server-side. The two calls are now separate methods, since `examples()` may be invoked regardless of which provider served the primary lookup (see `TranslateService` below):

```typescript
class AzureDictionaryService {
  async lookup(queryTerm: string, from: string, to: string): Promise<InternalTranslationResult>;
  // throws NotFoundException if translations[] is empty
  // throws on network/auth error

  async examples(queryTerm: string, translation: string, from: string, to: string): Promise<TranslationExampleDto[]>;
  // throws on network/auth error (caller decides whether this is fatal — see TranslateService)
}
```

**`lookup()`**
- Called only when both sdcv queries return "not found" (preserves free-tier quota).
- Query term: `text` (the raw client input) — Azure performs its own normalization server-side.
- Calls `POST /dictionary/lookup` → builds `senses[]` from `translations[]` (sorted by `confidence` desc, confidence itself dropped from output; each `translations[].displayTarget`/`normalizedTarget` map to `senses[].translation`/`normalizedTranslation`). `senses[0]` = `translations[0]` (highest confidence = primary).
- Azure's `translations[].posTag` (e.g. `VERB`, `NOUN`, `ADJ`, ...) is mapped directly to the same internal **canonical POS tag** enum used by `SdcvService` (Azure's tagset already matches the canonical tags 1:1 — `VERB`→`VERB`, `NOUN`→`NOUN`, etc.; unrecognized Azure tags → `null`).
- `source` in the response = Azure's own normalization of the query term (the `normalizedSource`/lemma field Azure returns for the looked-up text), not the client-supplied `normalized` field directly — Azure may further normalize it.
- `provider` = `'azure'`, `examples` = `[]` (filled in later by `examples()` if requested).
- Azure key/region read from env config (server-side secret store, not Keychain — this is the backend now).
- Returns `InternalTranslationResult` (not yet finalized — `translation`/`normalizedTranslation`/top-level `posTag` are derived later in `finalizeResult`).

**`examples()`**
- Calls `POST /dictionary/examples` for the `(queryTerm, translation)` pair → builds `TranslationExampleDto[]` from `targetPrefix`/`targetTerm`/`targetSuffix` (source-side fields discarded, per existing "target-only" rule).
- Called only when `req.withExamples === true`, regardless of `provider` — see `TranslateService` for the exact arguments and per-provider error handling.

### `TranslateService` (orchestrator)

```typescript
class TranslateService {
  async translate(req: TranslateRequestDto): Promise<TranslationResultDto> {
    const config = this.dictConfig.getConfig(req.from, req.to);

    if (config) {
      // Any sdcv error/crash/timeout → 502, no Azure fallback.
      const result = await this.sdcv.lookup(req.text, config);
      if (result) {
        const final = finalizeResult(result, req.to);
        return await this.maybeAttachExamples(final, req); // soft-fail for sdcv provider
      }
      // null → fall through to Azure (or 404 if Azure disabled)
    }

    if (!this.config.azureEnabled) {
      throw new NotFoundException(); // → 404 not_found
    }

    const azureResult = await this.azure.lookup(req.text, req.from, req.to);
    const final = finalizeResult(azureResult, req.to);
    return await this.maybeAttachExamples(final, req); // hard-fail (502) for azure provider
  }

  // Calls Azure Dictionary Examples with (req.text, senses[0].normalizedTranslation ?? req.text).
  // Error handling differs by provider:
  //  - provider === 'sdcv': SOFT failure — return result with examples=[].
  //  - provider === 'azure': HARD failure — propagate (→ 502).
  private async maybeAttachExamples(
    result: TranslationResultDto,
    req: TranslateRequestDto,
  ): Promise<TranslationResultDto> {
    if (!req.withExamples || !this.config.azureEnabled) return result;
    const translationKey = result.senses[0]?.normalizedTranslation ?? req.text;
    try {
      const examples = await this.azure.examples(req.text, translationKey, req.from, req.to);
      return { ...result, examples };
    } catch (err) {
      if (result.provider === 'sdcv') return result; // soft fail
      throw err;
    }
  }
}

// dedupeSenceTranslations (src/sdcv/merge.ts) deduplicates translation[] within each sense,
// removing entries that differ only by accent/stress marks from an earlier entry in the same
// sense. Called inside SdcvService.lookup() — not in TranslateService.
```

### Finalizing the Result: POS Tag Localization

Internally, both `SdcvService` and `AzureDictionaryService` produce a `senses[]` array where `senses[0]` is the primary sense (highest confidence / first dictionary sense) and the rest are secondary senses, each carrying an internal **canonical POS tag** (`'NOUN' | 'VERB' | 'ADJ' | 'ADV' | 'PREP' | null`) rather than a final `posTag` string.

`finalizeResult(result, to)` localizes each sense's canonical tag into the target-language `posTag` string and returns `senses[]` directly — no primary extraction, no `alternatives[]`.

```typescript
// Output format rules for every entry: lowercase, no punctuation.
const POS_LABELS: Record<string, Record<CanonicalPosTag, string>> = {
  en: { NOUN: 'noun', VERB: 'verb', ADJ: 'adj', ADV: 'adv', PREP: 'prep' },
  ru: { NOUN: 'сущ',  VERB: 'гл',   ADJ: 'прил', ADV: 'нареч', PREP: 'предл' },
  es: { NOUN: 'sust', VERB: 'verb', ADJ: 'adj', ADV: 'adv', PREP: 'prep' },
  fr: { NOUN: 'nom',  VERB: 'verb', ADJ: 'adj', ADV: 'adv', PREP: 'prép' },
  de: { NOUN: 'subst', VERB: 'verb', ADJ: 'adj', ADV: 'adv', PREP: 'präp' },
  pt: { NOUN: 'subst', VERB: 'verb', ADJ: 'adj', ADV: 'adv', PREP: 'prep' },
  it: { NOUN: 'sost', VERB: 'verb', ADJ: 'agg', ADV: 'avv', PREP: 'prep' },
  nl: { NOUN: 'znw',  VERB: 'ww',   ADJ: 'bnw', ADV: 'bijw', PREP: 'vz' },
  pl: { NOUN: 'rzecz', VERB: 'czas', ADJ: 'przym', ADV: 'przysł', PREP: 'przyim' },
  uk: { NOUN: 'імен', VERB: 'дієсл', ADJ: 'прикм', ADV: 'присл', PREP: 'прийм' },
};

function localizePosTag(canonicalTag: CanonicalPosTag | null, to: string): string {
  if (!canonicalTag) return '';
  return POS_LABELS[to]?.[canonicalTag] ?? '';
}

// Converts InternalTranslationResult -> public TranslationResultDto.
function finalizeResult(
  result: InternalTranslationResult,
  to: string,
): TranslationResultDto {
  const senses = result.senses.map(s => ({
    translation: s.translation,
    description: s.description,
    normalizedTranslation: s.normalizedTranslation,
    posTag: localizePosTag(s.canonicalPosTag, to),
  }));

  return {
    source: result.source,
    senses,
    examples: result.examples,
    provider: result.provider,
  };
}
```

- One row per language in the "Supported Languages (MVP)" set is required; the table above is a starting point and will need linguistic review for accuracy (especially `de`/`pl`/`uk`, which are placeholders here).
- All entries must be lowercase with no trailing punctuation, per the response format rules.
- If `to` or the canonical tag is missing from the table, `posTag` falls back to `""` — never to an English or unlocalized abbreviation, to keep the contract consistent (a Russian-target response never shows an English POS label).
- `canonicalPosTag` is an internal field on `TranslationSenseDto` (not part of the public response shape) — see DTOs above.
- A single-sense result has `senses.length === 1`; this is not an error.

### Examples (`withExamples`)

`maybeAttachExamples(result, req)` (shown inline in the `TranslateService.translate()` listing above) is the final step, run after `finalizeResult()`, for **both** the sdcv and Azure branches.

- If `req.withExamples` is falsy **or `AZURE_ENABLED=false`** → return `result` unchanged (`examples` stays `[]`, no Azure call made). This is the default, and matches the previous behavior for `provider="sdcv"`. **Note:** this is a behavior change for `provider="azure"` — previously Examples was always called on that path; now it's also gated by `withExamples`.
- If `req.withExamples` is `true` → call `AzureDictionaryService.examples(req.text, result.senses[0]?.normalizedTranslation ?? req.text, req.from, req.to)`. The first argument is always the raw `text`; the second is the primary sense's `normalizedTranslation` when available (Azure result) or `req.text` as fallback (sdcv result, where `normalizedTranslation` is undefined).
- **Error handling is provider-dependent**, because the meaning of an Examples failure differs:
  - `provider === 'sdcv'`: the primary lookup already succeeded locally; an Examples failure is a **soft failure** — the response is returned normally with `examples: []`, no error surfaced to the client.
  - `provider === 'azure'`: the request is already dependent on Azure for the primary result; an Examples failure here is treated like any other Azure error — **hard failure**, `502 upstream_error`.
- This means a single request can make 1 sdcv call + 1 Azure Examples call (sdcv hit + `withExamples=true`), or up to 2 Azure calls (sdcv miss → Azure lookup + Azure examples), in addition to the sdcv attempt(s) in step 3.

---

## Auth

`ApiKeyGuard` applied globally (or to the `translate` controller):
- Reads `X-API-Key` header
- Compares against `process.env.API_KEY` (constant-time comparison)
- Missing or mismatched → 401

---

## Configuration / Env Vars

| Variable | Purpose |
|---|---|
| `API_KEY` | Static key the LexiDeck app sends in `X-API-Key` |
| `AZURE_ENABLED` | Set to `false` to disable Azure entirely — no fallback lookups, no Examples calls; `withExamples` is ignored and always returns `[]`. Defaults to `true`. Useful for local development or when Azure credentials are not yet configured. |
| `AZURE_TRANSLATOR_KEY` | Azure Translator subscription key (required when `AZURE_ENABLED=true`) |
| `AZURE_TRANSLATOR_REGION` | Azure Translator region, e.g. `westeurope` (required when `AZURE_ENABLED=true`) |
| `DICTIONARIES_CONFIG_PATH` | Path to `dictionaries.json` (defaults to `./config/dictionaries.json`) |
| `SDCV_TIMEOUT_MS` | Timeout for sdcv subprocess calls (default e.g. 3000) |

---

## Notes / Open Items for Later

- Dictionary files for specific `(from, to)` pairs (within the 10-language MVP set) are not yet sourced — `dictionaries.json` starts empty or with placeholder pairs, and all lookups fall straight to Azure until dicts are added. Sourcing 90 directed pairs' worth of dictionaries is unrealistic; expect coverage to start with EN↔{RU, ES, FR, DE} and expand opportunistically.
- Regular off-the-shelf StarDict dictionaries (e.g. converted Babylon glossaries) can be used directly — no special format conversion needed, since `sdcv --json-output` exposes the raw `definition` text for parsing.
- The POS *recognition* table (source-dictionary abbreviation → canonical tag) is dictionary-source-dependent and will likely need tuning/expansion once real dictionary files are chosen — some dicts won't include POS markers at all, in which case `canonicalPosTag` will be `null` and `posTag` will be `""` for all senses from that dict (iOS already handles missing posTag gracefully by displaying the label as-is).
- The POS *localization* table (`POS_LABELS`, canonical tag → target-language abbreviation) needs linguistic review before relying on it — several entries (notably `de`, `pl`, `uk`) are best-effort placeholders and may not match conventions used by real dictionaries/learners for those languages.
- StarDict dict `definition` format (`sametypesequence`) is declared per-dictionary in `dictionaries.json` via a `format` field. HTML dicts (WikDict/FreeDict) are fully handled by the 8-template parser; plain-text dicts use line-splitting. No further sniffing is needed.
- Idiom support depends entirely on whether headwords in the StarDict source include multi-word entries; no special handling beyond passing `text` as-is to sdcv.
- `senses[].normalizedTranslation` is set only by Azure results; sdcv results leave it undefined. `maybeAttachExamples` falls back to `req.text` when it is absent.
- `withExamples=true` consumes Azure Examples-endpoint quota even when `provider="sdcv"` (i.e. even when the local dictionary fully served the translation). This is an intentional tradeoff for richer client UX, but means the "preserve Azure free-tier quota" goal from the sdcv-first design only applies to the *Lookup* endpoint, not *Examples* — the iOS client should set `withExamples: true` deliberately (e.g. only when the result panel's examples section is visible/expanded) rather than on every request, if Examples-quota usage becomes a concern.
- Add `@nestjs/swagger` decorators (`@ApiTags`, `@ApiOperation`, `@ApiHeader` for `X-API-Key`, `@ApiBody`/`@ApiResponse` driven off `TranslateRequestDto`/`TranslationResultDto`, plus the error response shapes for 400/401/404/502/503) to `translate.controller.ts` so the API is self-documenting via the generated OpenAPI/Swagger UI — useful given this is a standalone service consumed by a separate iOS client.

---

## Future Backlog

These are deliberately **not** part of the MVP scope above; they're recorded here so they're not lost, but each needs its own design pass before implementation.

- **Augment local dictionaries from Azure fallback results.** When sdcv returns "not found" and Azure serves the result (`provider="azure"`), persist that `(text, senses, posTags)` data so a future identical lookup can be served by sdcv instead, reducing Azure Lookup-quota usage over time. Open questions to resolve when this is designed:
  - **Storage format.** StarDict dictionaries are compiled binary formats (`.ifo`/`.idx`/`.dic[.dz]`), not simple append-friendly files — sdcv can't read arbitrary new entries without a re-index/recompile step (e.g. via `dictzip`/`dictfmt`-style tooling). Options: (a) maintain a separate "overlay" StarDict dictionary per `(from, to)` pair that gets periodically rebuilt from accumulated Azure results, with sdcv configured to query both the base dict and the overlay; or (b) skip sdcv/StarDict entirely for these entries and serve them from a simple DB-backed lookup table checked *before* sdcv, in which case "the dictionary" here really means a new cache layer, not literally the StarDict files.
  - **Trigger and write path.** Synchronous (write before responding — adds latency to the Azure-fallback path) vs. asynchronous (respond normally, write in the background/queue).
  - **Format fidelity.** Azure's `senses[]`/`canonicalPosTag` shape would need to round-trip back into whatever the chosen storage format is, ideally without loss — and re-parsing through the same `definition`-line-parsing logic in `SdcvService` if going the StarDict-overlay route, which assumes a specific text format that Azure-derived entries would need to be formatted to match.
  - **Pairs without any `dictionaries.json` entry.** For `(from, to)` pairs with *no* configured dict at all (step 2 currently skips straight to Azure), this feature would effectively be "create a new local dictionary from scratch via Azure usage" — a bigger scope than "augment an existing dict."
  - **Staleness/correctness.** Azure results aren't guaranteed correct/complete for a given sense — caching them locally means propagating any Azure quirks (or future Azure improvements wouldn't retroactively fix cached entries).
