# Semantic Markdown & NLP Highlighting Architecture

AuricIDE marks up Markdown prose with a layered highlighting engine built on
CodeMirror 6. The engine's job is to surface what is **actionable or factual** —
instructions, constraints, entities, dates, figures — and to leave ordinary prose
alone.

> **Prose stays prose.** The engine never colours word classes. Highlighting
> nouns, verbs and adjectives turns a document into a rainbow and tells the
> reader nothing they could act on, so it is deliberately absent. If you are
> adding a highlight, the test is "would someone do something differently
> because this is marked?" — not "what part of speech is it?"

---

## Layer overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Layer 4: Paragraph intent      src/lib/nlp/deepHighlightExtension.ts     │
│   - Model: Xenova/mobilebert-uncased-mnli (zero-shot, in a worker)       │
│   - Line classes: .cm-intent-instruction / -explanation / -warning /     │
│                   -question / -context                                   │
├──────────────────────────────────────────────────────────────────────────┤
│ Layer 3: Async NER             src/lib/nlp/deepHighlightExtension.ts     │
│   - Model: Xenova/bert-base-NER via @huggingface/transformers            │
│   - Mark class: .cm-semantic-deep-entity                                 │
├──────────────────────────────────────────────────────────────────────────┤
│ Layer 2: Actionable spans      src/lib/editor/nlpHighlightExtension.ts   │
│   - Engine: regex patterns + wink-nlp NER (synchronous)                  │
│   - Mark classes: .cm-semantic-entity / -keyword / -prompt-directive /   │
│                   -prompt-context / -prompt-constraint                   │
├──────────────────────────────────────────────────────────────────────────┤
│ Layer 1: Theme & base syntax   src/lib/editor/auricTheme.ts              │
│   - CodeMirror 6 HighlightStyle & Theme                                  │
│   - Auric dark-mode palette, Markdown token styling                      │
└──────────────────────────────────────────────────────────────────────────┘
```

Layers 1–2 are synchronous and run on every viewport change. Layers 3–4 are
asynchronous, model-backed, and stream their decorations in when ready.

---

## Layer 1: Base theme (`src/lib/editor/auricTheme.ts`)

- **Purpose:** foundation dark-mode theme and standard Markdown token styling.
- **Components:**
  - `auricTheme` — editor background, selection highlight, active line, gutters.
  - `auricHighlightStyle` — `HighlightStyle.define()` mapping standard Lezer tags
    (`tags.heading`, `tags.emphasis`, `tags.strong`, `tags.link`,
    `tags.monospace`, `tags.quote`, …) to Auric design-system colours.

One deliberate omission is worth knowing before you add a rule: there is **no
rule for `tags.list`**. Lezer applies that tag to the entire list item, so
styling it repaints whole paragraphs of prose. The list marker is styled through
`tags.processingInstruction` instead. The file carries this note inline — read it
before adding a tag, because several tags are broader than their names suggest.

---

## Layer 2: Actionable spans (`src/lib/editor/nlpHighlightExtension.ts`)

- **Purpose:** fast, synchronous marking of the things a reader acts on.
- **Libraries:** `wink-nlp` + `wink-eng-lite-web-model`.
- **Entry point:** `analyzeText()` in `src/lib/nlp/highlighter.ts`, which composes
  three sources into one sorted, non-overlapping span list via `SpanCollector`:

| Source                       | Patterns in                                                                 | Emits                                                     |
| ---------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------- |
| Structural / domain patterns | `src/lib/nlp/patterns.ts` (`STRUCTURE_REGEX`)                               | `keyword`                                                 |
| Prompt-framework labels      | `PROMPT_DIRECTIVE_REGEX`, `PROMPT_CONTEXT_REGEX`, `PROMPT_CONSTRAINT_REGEX` | `prompt-directive`, `prompt-context`, `prompt-constraint` |
| wink-nlp NER                 | `src/lib/nlp/winkAnalyzer.ts`                                               | `entity` (dates, money, URLs, …)                          |

The extension maps those five span types to five CSS classes and nothing else:
`cm-semantic-entity`, `cm-semantic-keyword`, `cm-semantic-prompt-directive`,
`cm-semantic-prompt-context`, `cm-semantic-prompt-constraint`.

Note that wink-nlp is used here for **named-entity recognition**, not for
part-of-speech tagging. Prompt-framework matches highlight only the _label_ (up
to and including the colon), not the sentence that follows — the marker is the
signal, and colouring the body would swamp the page.

---

## Layer 3: Deep NER (`src/lib/nlp/deepHighlightExtension.ts`)

- **Purpose:** asynchronous named-entity recognition for real-world entities
  (persons, organisations, locations, misc).
- **Library:** `@huggingface/transformers`, model `Xenova/bert-base-NER`, run off
  the main thread in `src/lib/nlp/deepAnalysisWorker.ts`.
- **Token aggregation:** `src/lib/nlp/nerAggregation.ts` converts sub-word BIO
  tokens into unified entity ranges.
- **Styling:** one calm, unified mark class, `.cm-semantic-deep-entity`
  (defined in `src/app/globals.css`). Entities are not colour-coded per type —
  a page of prose with five entity colours is the rainbow problem again.

---

## Layer 4: Paragraph intent (`src/lib/nlp/deepHighlightExtension.ts`)

- **Purpose:** classify what a paragraph is _for_, so a reader can see at a
  glance which blocks are instructions and which are background.
- **Model:** `Xenova/mobilebert-uncased-mnli`, zero-shot classification, same
  worker as Layer 3.
- **Styling:** line decorations, one per classified paragraph:
  `.cm-intent-instruction`, `.cm-intent-explanation`, `.cm-intent-warning`,
  `.cm-intent-question`, `.cm-intent-context`.
- **Scope:** only the first substantial prose paragraph is classified. Markdown
  headings are titles, not intents, and are skipped.

**Invariant — keep NER and intent in separate state fields.** They share a
worker but not a `StateField`. When they shared one, either effect's dispatch
replaced the whole decoration set, so an intent result wiped the NER marks and
vice versa. The separation is load-bearing; the source says so at the field
definitions.

---

## Extension setup

All extensions are combined in `src/lib/editor/setup.ts` inside CodeMirror
`Compartment` instances, so features can be reconfigured at runtime without
recreating the editor view.
