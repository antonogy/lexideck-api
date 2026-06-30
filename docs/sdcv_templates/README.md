# sdcv Definition HTML Templates

Derived from 40 real lookups across 4 language pairs: EN→RU, RU→EN, ES→RU, RU→ES.

## Outer JSON shape (always)

```json
[
  { "dict": "Dictionary Name", "word": "headword", "definition": "<HTML>" },
  { "dict": "Dictionary Name", "word": "headword", "definition": "<HTML>" }
]
```

- Array; **empty array `[]` = word not found**
- Multiple entries = **homographs** (same word, different POS)
- Each entry has identical `dict` and `word` fields; only `definition` varies

---

## Definition HTML — invariant wrapper

Every definition follows this shell:

```html
\n<div>PRONUNCIATION<br>\n<div><font class="grammar" color="green">POS</font></div>BODY</div>
```

### Pronunciation

Single IPA:
```
/<font color="gray">IPA</font>/
```

Multiple IPAs (comma + space separated):
```
/<font color="gray">IPA1</font>/, /<font color="gray">IPA2</font>/, /<font color="gray">[ALT]</font>/
```
Primary transcriptions appear without brackets; regional/archaic variants appear in `[brackets]`.

### POS values observed
`noun`, `verb`, `adjective`, `pronoun` — as plain English strings inside `<font class="grammar" color="green">`.

---

## Body templates (8 patterns)

See individual template files for annotated HTML.

| File | Template | Frequency | Examples |
|------|----------|-----------|---------|
| `T1-simple.html` | No desc, single translation | common | бежать, мочь/noun |
| `T2-desc-single.html` | Inline description + single translation | common | книга, банк, цвет (RU→ES) |
| `T3-desc-multitrans.html` | Inline description (optional) + flat translation list | common | set/adj, trabajo, город; **color, жизнь** (no desc) |
| `T4-senselist-direct.html` | Sense list, each sense → direct translation | common | свет, run, думать/sense1 |
| `T5-senselist-subtrans.html` | Sense list, each sense → translation sublist (desc optional) | common | дом, время, работа; **vida/sense1** (no desc) |
| `T6-mixed.html` | Sense list mixing T4/T5/desc-sublist variants | complex | вода, water, думать, vida |
| `T7-parallel-lists.html` | Desc `<ol>` + translation `<ol>` as siblings | uncommon | ставить, hablar, говорить, mundo |
| `T8-desclist-single.html` | Desc `<ol>` + single `<div>` translation as siblings | uncommon | tierra, poder, hacer, земля |

---

## Cross-cutting observations

### Optional descriptions
T3 and T5 inline descriptions are **optional** — body may begin directly with the translation block:
- T3 without desc: `color` (ES→RU), `жизнь` (RU→ES) — POS followed immediately by flat `<ol>` of translations
- T5 without desc in `<li>`: `vida` sense 1 — outer `<li>` has no text, only a translation sub-`<ol>`

### HTML entities in translations
Translation `<div>` content may contain escaped HTML (e.g. stress markup):
```html
<div>v&lt;u&gt;i&lt;/u&gt;da</div>   <!-- renders as v<u>i</u>da -->
```
Seen in: `жизнь` (RU→ES). Parsers must handle entity-encoded inner HTML.

### Dict lookup collisions
A single sdcv call may return entries for **unrelated words** that share the same headword string in the dictionary index. `correr` (ES→RU) returned 10 entries for words like "race", "lamb", "belt", "mail", "copper" — all coincidentally indexed under the same key. Callers should validate that returned `word` field matches the queried term.
