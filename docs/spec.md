# LexiDeck Translation API — Backend Spec (v1)

## Overview

A standalone NestJS service that sits between the LexiDeck iOS app and translation backends. For a given word or idiom (not full sentences), it returns a structured `TranslationResult` matching the shape already used by the iOS app's `TranslationService` protocol. The client may optionally supply a normalized/lemma form alongside the raw input (e.g. via iOS's `NLTagger`); the server tries `sdcv` lookups for both forms and merges the results before falling back to Azure Translator's Dictionary Lookup + Dictionary Examples endpoints if neither sdcv lookup finds an entry.

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
  "text": "flies",
  "normalized": "fly",
  "from": "en",
  "to": "ru",
  "withExamples": true
}
```
- `text` — a single word or idiom (not a sentence), as the user typed/spoke it
- `normalized` — optional client-supplied lemma/normalized form of `text` (e.g. from `NLTagger`); if present, sdcv tries this in addition to `text`
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
  "translation": "летать",
  "normalizedTranslation": "летать",
  "posTag": "гл",
  "alternatives": [
    {
      "translation": "муха",
      "normalizedTranslation": "муха",
      "posTag": "сущ"
    }
  ],
  "examples": [],
  "provider": "sdcv"
}
```
(Here `text="flies"`, `normalized="fly"` — the dictionary had an entry for `fly` but not `flies`, so the `fly` lookup became primary; `source` reflects `fly`. The dictionary's `fly` entry had two senses — "летать" (verb) and "муха" (noun); the verb sense became the primary translation, and the noun sense is the sole entry in `alternatives`. If the `flies` lookup had also returned senses, they'd be appended to `alternatives` after dedup. `to="ru"`, so `posTag` values are Russian abbreviations.)

**Field semantics — `translation` vs. `normalizedTranslation`:** these are kept distinct even though they're often identical, and the same pair of fields exists at both the top level (for the primary translation) and on each entry in `alternatives` (for that alternative's translation) — same field names, different meaning at each level. `translation` is the display form; `normalizedTranslation` is the canonical form a downstream lookup (Azure Dictionary Examples, or a future transcription/phonetics service) expects as input. For Azure results these can differ (casing, diacritics); for sdcv results `normalizedTranslation` is currently set equal to `translation` (StarDict dictionaries don't provide a separate normalized form), so the two fields coincide — but the shape stays uniform so any consumer can always use `normalizedTranslation` for follow-up API calls regardless of `provider`.

**Field semantics — `posTag`:** part-of-speech labels are localized into the *target language* (`to`), not English, and follow a fixed format: lowercase, no punctuation (e.g. `гл` not `гл.`, `verb` not `VERB.`). The intent is that `posTag` is directly displayable next to the translation without further formatting — e.g. "гл — летать" for an en→ru result, or "verb — to fly" for a ru→en result. If no POS information is available for a sense, `posTag` is `""`. See "Finalizing the Result" below for the canonical-tag → localized-abbreviation mapping and how both sdcv and Azure results are normalized into this form.

**`alternatives` excludes the primary translation.** `result.translation`/`normalizedTranslation`/`posTag` describe the primary (highest-confidence / first-listed) sense; `alternatives` contains only the *other* senses found for the word, if any. A result may legitimately have `alternatives: []` if only one sense was found — this is not an error.

This mirrors the iOS-side `TranslationResult` / `TranslationAlternative` / `TranslationExample` shapes, renaming the "primary"/"normalized source"/"display target" fields for brevity and consistency (the same `translation`/`normalizedTranslation`/`posTag` field names are used at both the result level and the alternative level), with two additions:
- `posTag: string` — the localized, lowercase, punctuation-free part-of-speech abbreviation for `translation` in the target language (e.g. `гл` for a Russian verb, `verb` for an English verb; `""` if unknown). **Note:** the current iOS `TranslationResult` struct does not have a top-level `posTag` field — adding it client-side is a small follow-up if the iOS app wants to display it.
- `provider: "sdcv" | "azure"` — tells the client which backend served the result (informational; iOS can ignore it, but useful for debugging/telemetry)

When `withExamples` is `false` or omitted, `examples` is always `[]` regardless of `provider`, and no Azure Examples call is made. When `withExamples` is `true`, `examples` is populated via a Dictionary Examples call for `(text, normalizedTranslation)` regardless of `provider` — see "Examples (`withExamples`)" below for the exact behavior and per-provider error handling.

**Error responses**

| Status | Condition | Body |
|---|---|---|
| 401 | Missing/invalid `X-API-Key` | `{ "error": "unauthorized" }` |
| 400 | Missing/invalid `text`, `from`, or `to`; `from`/`to` not in the supported language set; or `from == to` | `{ "error": "invalid_request", "message": "..." }` |
| 404 | Neither sdcv (for `normalized` or `text`) nor Azure has an entry | `{ "error": "not_found" }` |
| 502 | sdcv crashed/errored on either query; Azure lookup call failed; or (`provider="azure"` AND `withExamples=true`) the Azure Examples call failed | `{ "error": "upstream_error", "message": "..." }` |
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
- `text` — the original source word/idiom, as sent to `/v1/translate` (the raw client input — same as that endpoint's `text`, not `normalized`)
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
POST /v1/translate { text, normalized?, from, to }
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
  ├─► 3. sdcv lookup (text + normalized)
  │       - if `normalized` provided and differs from `text`:
  │           run sdcv for `normalized` AND `text` (two invocations)
  │         else:
  │           run sdcv for `text` only
  │       - any invocation that errors/crashes/times out → return 502 upstream_error immediately
  │         (do NOT fall back to Azure — Azure quota is conserved for "not found" only)
  │       - each successful invocation → null (not found) or InternalTranslationResult (with senses[])
  │       - merge:
  │           - if `normalized` result is non-null → use it as primary source
  │           - else if `text` result is non-null → use it as primary source
  │           - if BOTH non-null → merge senses (dedupe by translation+canonicalPosTag),
  │             normalized-derived senses first, then text-derived
  │           - if BOTH null AND AZURE_ENABLED=false → 404 not_found
  │           - if BOTH null AND AZURE_ENABLED=true → fall through to step 4 (Azure)
  │       - merged result → step 5, provider="sdcv", examples=[]
  │
  ├─► 4. Azure fallback (only when both sdcv queries returned "not found" AND AZURE_ENABLED=true)
  │       - call Dictionary Lookup (from, to, text) — always the raw input, not `normalized`
  │         (NLTagger-based normalization may be unreliable for non-English source languages,
  │          so Azure's own normalization is relied on instead)
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
  text: string;          // required, non-empty, trimmed
  normalized?: string;   // optional, client-supplied lemma (e.g. from NLTagger)
  from: string;          // required, BCP 47 code
  to: string;            // required, BCP 47 code
  withExamples?: boolean; // optional, default false
}
```

### `TranslationResultDto`
```typescript
type CanonicalPosTag = 'NOUN' | 'VERB' | 'ADJ' | 'ADV' | 'PREP';

// One parsed dictionary sense. Used internally as the array element type
// for SdcvService/AzureDictionaryService/merge output ("senses[]"), where
// senses[0] is always the primary sense, and ALSO as the public-facing
// shape for entries in TranslationResultDto.alternatives (post-finalization,
// where the primary has been extracted and excluded — see "Finalizing the
// Result" below).
interface TranslationAlternativeDto {
  translation: string;
  normalizedTranslation: string;
  posTag: string;                        // localized, lowercase, no punctuation (final, response-facing)
  canonicalPosTag?: CanonicalPosTag | null; // internal only, stripped before serialization
}

interface TranslationExampleDto {
  targetPrefix: string;
  targetTerm: string;
  targetSuffix: string;
}

// Internal working shape produced by SdcvService / AzureDictionaryService / mergeSdcvResults.
// `senses[0]` is the primary; `senses[1:]` are secondary alternatives.
// `translation`/`normalizedTranslation`/`posTag` (top-level) are NOT yet set at this stage.
interface InternalTranslationResult {
  source: string;
  senses: TranslationAlternativeDto[];
  examples: TranslationExampleDto[];
  provider: 'sdcv' | 'azure';
}

// Public response shape, produced by finalizeResult(). senses[0] has been
// extracted into translation/normalizedTranslation/posTag and is NOT
// repeated in `alternatives`.
interface TranslationResultDto {
  source: string;
  translation: string;
  normalizedTranslation: string;
  posTag: string;                        // localized, lowercase, no punctuation
  alternatives: TranslationAlternativeDto[]; // excludes the primary sense
  examples: TranslationExampleDto[];
  provider: 'sdcv' | 'azure';
}
```
`canonicalPosTag` is populated by `SdcvService`/`AzureDictionaryService`, consumed by `dedupeAlternatives` and `finalizeResult`, and removed (or left `undefined`/ignored by the serializer) before the response is sent — it is not part of the public contract.

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

The single result's `definition` is a raw multi-line string whose format depends on the dictionary source (typically Babylon/StarDict-converted bilingual glossaries: one sense per line, often prefixed with a sense number and/or a part-of-speech abbreviation). The service:

1. Splits `definition` into lines, discards empty lines.
2. For each line, strips a leading sense marker if present (e.g. `1)`, `2.`, `•`).
3. Attempts to extract a leading POS abbreviation via a fixed recognition table, mapping the *source dictionary's* abbreviation (which may be in any language, depending on the dict) to an internal **canonical POS tag**:

   | Abbreviation pattern (in `definition`) | Canonical tag |
   |---|---|
   | `n.`, `сущ.` | `NOUN` |
   | `v.`, `гл.` | `VERB` |
   | `adj.`, `прил.` | `ADJ` |
   | `adv.`, `нареч.` | `ADV` |
   | `prep.`, `предл.` | `PREP` |
   | (no match) | `null` (unknown) |

   The canonical tag is an internal-only value (not exposed in the API response) — it's converted to the response's localized `posTag` string in the "POS Tag Localization" step below, based on `to`.

4. The remainder of the line (after stripping sense marker and POS abbreviation) becomes `translation`, trimmed.
5. `normalizedTranslation` = `translation` as-is (sdcv/StarDict dictionaries don't provide separate lemma forms; no further normalization is attempted locally).
6. Each parsed line → one entry in `senses[]`, carrying the canonical tag (pre-localization) internally. The first line's sense becomes `senses[0]` (the primary, by definition — see "Finalizing the Result" below).

**Building the result (single query)**

- `source` = `word` field from the sdcv result for *this* query (the matched headword — handles dictionary-side case folding, but not stemming). The merge step (in `TranslateService`) decides which query's `source` wins overall.
- `senses[]` = all parsed lines, in the order they appeared in `definition` (`senses[0]` = primary).
- `provider` = `'sdcv'`, `examples` = `[]`.
- Returns `InternalTranslationResult` (not yet finalized — `translation`/`normalizedTranslation`/top-level `posTag` are derived later in `finalizeResult`).
- If `definition` parses to zero non-empty lines → treat as "not found" (return `null`).

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
- Query term: `text` (the raw client input) — `normalized` is deliberately NOT used here, since client-side lemmatization (e.g. `NLTagger`) may be unreliable for non-English source languages; Azure performs its own normalization on `text`.
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
      const queries = req.normalized && req.normalized !== req.text
        ? [req.normalized, req.text]
        : [req.text];

      // Any sdcv error/crash/timeout on ANY query → 502, no Azure fallback.
      const results = await Promise.all(
        queries.map(q => this.sdcv.lookup(q, config)) // each throws on error
      );

      const merged = this.mergeSdcvResults(queries, results);
      if (merged) {
        const final = finalizeResult(merged, req.to);
        return await this.maybeAttachExamples(final, req); // soft-fail for sdcv provider
      }
      // both results null → fall through to Azure (or 404 if Azure disabled)
    }

    if (!this.config.azureEnabled) {
      throw new NotFoundException(); // → 404 not_found
    }

    const queryTerm = req.text;
    const azureResult = await this.azure.lookup(queryTerm, req.from, req.to); // throws NotFound → 404, other → 502
    const final = finalizeResult(azureResult, req.to);
    return await this.maybeAttachExamples(final, req); // hard-fail (502) for azure provider
  }

  // If req.withExamples, calls Azure Dictionary Examples with (req.text, result.normalizedTranslation)
  // and attaches the result to `examples`. Otherwise returns `result` unchanged (examples stays []).
  //
  // Error handling differs by provider:
  //  - provider === 'sdcv': Examples failure is a SOFT failure — return `result` with examples=[].
  //    (The primary lookup already succeeded via sdcv; an Azure hiccup shouldn't fail the whole request.)
  //  - provider === 'azure': Examples failure is a HARD failure — propagate (→ 502).
  //    (We're already depending on Azure for this request; a partial Azure failure is treated
  //     the same as any other Azure error.)
  private async maybeAttachExamples(
    result: TranslationResultDto,
    req: TranslateRequestDto,
  ): Promise<TranslationResultDto> {
    if (!req.withExamples || !this.config.azureEnabled) return result;

    if (result.provider === 'sdcv') {
      try {
        const examples = await this.azure.examples(req.text, result.normalizedTranslation, req.from, req.to);
        return { ...result, examples };
      } catch {
        return result; // soft fail: examples=[]
      }
    }

    // provider === 'azure': let errors propagate → 502
    const examples = await this.azure.examples(req.text, result.normalizedTranslation, req.from, req.to);
    return { ...result, examples };
  }

  // results[] is parallel to queries[] (length 1 or 2).
  // queries[0] = normalized (if provided and different), or text.
  private mergeSdcvResults(
    queries: string[],
    results: (InternalTranslationResult | null)[],
  ): InternalTranslationResult | null {
    const normalizedResult = queries.length === 2 ? results[0] : null;
    const textResult = queries.length === 2 ? results[1] : results[0];

    const primary = normalizedResult ?? textResult;
    if (!primary) return null; // both null

    const secondary = (primary === normalizedResult) ? textResult : null;

    const senses = secondary
      ? dedupeAlternatives([...primary.senses, ...secondary.senses])
      : primary.senses;

    return {
      ...primary,
      senses,
    };
  }
}

// Dedupe by (translation, canonicalPosTag), preserving first occurrence order
// (i.e. normalized-derived senses win over text-derived duplicates; the dedup
// runs on senses[] BEFORE primary extraction, so senses[0] after dedup is the
// overall primary regardless of which query it came from).
// Uses the internal canonical tag (language-agnostic), NOT the localized posTag string,
// so dedup is correct regardless of localization order.
function dedupeAlternatives(senses: TranslationAlternativeDto[]): TranslationAlternativeDto[] {
  const seen = new Set<string>();
  return senses.filter(s => {
    const key = `${s.translation}\u0000${s.canonicalPosTag ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
```

**Merge rules summary**
- `normalized` provided and sdcv finds it → that result's `source` and `senses[0]` (eventual `translation`/`normalizedTranslation`) win; `text`'s senses (if any) are appended after dedup.
- `normalized` not provided, or sdcv finds nothing for it → fall back to `text`'s result as primary.
- Both queries return "not found" → Azure fallback (single call, using `text` — the raw input — as the query term; Azure handles its own normalization).
- Any sdcv invocation errors (process crash/timeout/malformed JSON) → 502 immediately; Azure is never called in this case, since the failure is a local-service problem, not a "no entry" case.

### Finalizing the Result: POS Tag Localization + Primary Extraction

Internally, both `SdcvService` and `AzureDictionaryService` (and the merge step) produce a `senses[]` array where `senses[0]` is the primary sense (highest confidence / first dictionary sense) and the rest are secondary senses, each carrying an internal **canonical POS tag** (`'NOUN' | 'VERB' | 'ADJ' | 'ADV' | 'PREP' | null'`) rather than a final `posTag` string.

The very last step of `TranslateService.translate()` — `finalizeResult(result, to)` — does two things:
1. **Localizes** each sense's canonical tag into the response's localized `posTag` string, based on the target language `to`.
2. **Extracts** `senses[0]` into the top-level `translation` / `normalizedTranslation` / `posTag` fields, and sets the response's `alternatives[]` to the *remaining* senses (`senses[1:]`) — **the primary translation is not duplicated into `alternatives[]`**.

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
  const localized = result.senses.map(s => ({
    ...s,
    posTag: localizePosTag(s.canonicalPosTag, to),
  }));

  const [primary, ...alternatives] = localized;

  return {
    source: result.source,
    translation: primary.translation,
    normalizedTranslation: primary.normalizedTranslation,
    posTag: primary.posTag,
    alternatives, // primary excluded
    examples: result.examples,
    provider: result.provider,
  };
}
```

- One row per language in the "Supported Languages (MVP)" set is required; the table above is a starting point and will need linguistic review for accuracy (especially `de`/`pl`/`uk`, which are placeholders here).
- All entries must be lowercase with no trailing punctuation, per the response format rules.
- If `to` or the canonical tag is missing from the table, `posTag` falls back to `""` — never to an English or unlocalized abbreviation, to keep the contract consistent (a Russian-target response never shows an English POS label).
- `canonicalPosTag` is an internal field on `TranslationAlternativeDto` (not part of the public response shape) — see DTOs above.
- **If a sense list has only one entry** (`senses.length === 1`, e.g. an sdcv `definition` with a single line), `alternatives` is `[]` after extraction — this is expected and matches the "Empty States"/error-handling philosophy elsewhere in this spec (an empty `alternatives[]` is not an error).

### Examples (`withExamples`)

`maybeAttachExamples(result, req)` (shown inline in the `TranslateService.translate()` listing above) is the final step, run after `finalizeResult()`, for **both** the sdcv and Azure branches.

- If `req.withExamples` is falsy **or `AZURE_ENABLED=false`** → return `result` unchanged (`examples` stays `[]`, no Azure call made). This is the default, and matches the previous behavior for `provider="sdcv"`. **Note:** this is a behavior change for `provider="azure"` — previously Examples was always called on that path; now it's also gated by `withExamples`.
- If `req.withExamples` is `true` → call `AzureDictionaryService.examples(req.text, result.normalizedTranslation, req.from, req.to)`, i.e. always pass the **raw client input** `text` (not `normalized`, not `result.source`) as the source term, paired with the finalized `normalizedTranslation` (which may have come from sdcv or Azure, depending on `provider`).
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
- `definition` formats vary significantly across StarDict sources (plain text, HTML, Babylon-style markup). If a configured dict's definitions are HTML, an HTML-stripping pass should run before line-splitting — flagged here as a likely follow-up once specific dicts are picked.
- Idiom support depends entirely on whether headwords in the StarDict source include multi-word entries; no special handling beyond passing `text` as-is to sdcv (the `normalized` field is intended for single-word lemmatization — e.g. via iOS `NLTagger` — and its benefit for multi-word idioms is unclear).
- The `normalized` field is optional and trusted as-is from the client; the server does not independently verify or compute it. If absent, behavior is identical to a single-query lookup (no change from the original sdcv-first flow).
- Running two sdcv invocations doubles local lookup latency/cost vs. a single query, but this is negligible compared to Azure API calls and preserves the free-tier quota, which was the priority.
- `withExamples=true` consumes Azure Examples-endpoint quota even when `provider="sdcv"` (i.e. even when the local dictionary fully served the translation). This is an intentional tradeoff for richer client UX, but means the "preserve Azure free-tier quota" goal from the sdcv-first design only applies to the *Lookup* endpoint, not *Examples* — the iOS client should set `withExamples: true` deliberately (e.g. only when the result panel's examples section is visible/expanded) rather than on every request, if Examples-quota usage becomes a concern.
- Add `@nestjs/swagger` decorators (`@ApiTags`, `@ApiOperation`, `@ApiHeader` for `X-API-Key`, `@ApiBody`/`@ApiResponse` driven off `TranslateRequestDto`/`TranslationResultDto`, plus the error response shapes for 400/401/404/502/503) to `translate.controller.ts` so the API is self-documenting via the generated OpenAPI/Swagger UI — useful given this is a standalone service consumed by a separate iOS client.

---

## Future Backlog

These are deliberately **not** part of the MVP scope above; they're recorded here so they're not lost, but each needs its own design pass before implementation.

- **Augment local dictionaries from Azure fallback results.** When both sdcv queries return "not found" and Azure serves the result (`provider="azure"`), persist that `(text, normalized, translation, senses, posTags)` data so a future identical lookup can be served by sdcv instead, reducing Azure Lookup-quota usage over time. Open questions to resolve when this is designed:
  - **Storage format.** StarDict dictionaries are compiled binary formats (`.ifo`/`.idx`/`.dic[.dz]`), not simple append-friendly files — sdcv can't read arbitrary new entries without a re-index/recompile step (e.g. via `dictzip`/`dictfmt`-style tooling). Options: (a) maintain a separate "overlay" StarDict dictionary per `(from, to)` pair that gets periodically rebuilt from accumulated Azure results, with sdcv configured to query both the base dict and the overlay; or (b) skip sdcv/StarDict entirely for these entries and serve them from a simple DB-backed lookup table checked *before* sdcv, in which case "the dictionary" here really means a new cache layer, not literally the StarDict files.
  - **Trigger and write path.** Synchronous (write before responding — adds latency to the Azure-fallback path) vs. asynchronous (respond normally, write in the background/queue).
  - **Format fidelity.** Azure's `senses[]`/`canonicalPosTag` shape would need to round-trip back into whatever the chosen storage format is, ideally without loss — and re-parsing through the same `definition`-line-parsing logic in `SdcvService` if going the StarDict-overlay route, which assumes a specific text format that Azure-derived entries would need to be formatted to match.
  - **Pairs without any `dictionaries.json` entry.** For `(from, to)` pairs with *no* configured dict at all (step 2 currently skips straight to Azure), this feature would effectively be "create a new local dictionary from scratch via Azure usage" — a bigger scope than "augment an existing dict."
  - **Staleness/correctness.** Azure results aren't guaranteed correct/complete for a given sense — caching them locally means propagating any Azure quirks (or future Azure improvements wouldn't retroactively fix cached entries).
