# The bake-off harness

A **spike, kept.** It decided which reader v1 uses, and it is committed only because
[the plan](../../../docs/plans/pdf-ingestion.md#the-bake-off-and-what-it-decided-2026-08-26) cites
its numbers — a measurement whose method you cannot read is an anecdote. It will be replaced by
`scripts/pdf-eval.ts` and `src/pdf-score.ts`, and deleted when it is.

```bash
npx tsx evals/pdf/bakeoff/bakeoff.mts                # every document, every chunk — spends real money
npx tsx evals/pdf/bakeoff/bakeoff.mts harder         # one document
RUN=order-a npx tsx evals/pdf/bakeoff/bakeoff.mts harder 1   # one chunk, results kept apart
npx tsx evals/pdf/bakeoff/score.mts                  # judge whatever is in the output directory
```

Output goes to `scratch-bakeoff/` (git-ignored) unless `BAKEOFF_OUT` says otherwise. Needs
`ANTHROPIC_API_KEY` and `OPENROUTER_API_KEY`.

## Two things to know before you read any number it prints

**`score.mts` iterates over the pages the model *claimed*.** A page the model omitted entirely
produces **no row**, not a zero — so a dropped page passes by absence. That is the exact failure this
bake-off found, and this script did not catch it; a person counting records did. Two reviewers found
the hole independently. The production checker asserts page coverage *first*, and deliberately is
not built like this.

**It is a catastrophe detector, not a fidelity measure.** The fold discards case, punctuation and
symbols — which the prompt demands exactly — and ignores record type, paragraph boundaries,
`continues` and `uncertain` altogether. A structural regression is invisible to it.

## One thing that had to be fixed before the results meant anything

`cut()` is memoised **and stamps fixed dates**, so the same page range hashes the same in every
process and every reader on a chunk provably gets identical bytes. Without that, pdf-lib writes a
fresh document id and creation date into every save — so the first version of this harness compared
two readers on two different files while the write-up said "same PDF bytes". GPT Sol found it by
hashing two cuts. The hash is now recorded on every call.

## Readers

| Label | What it is |
|---|---|
| `haiku-native` | Haiku 4.5, Anthropic SDK, streamed, **document block before** the instruction |
| `haiku-native-textfirst` | same, **instruction before** the document block |
| `haiku-native-nocover` | as textfirst, with the prompt's "leave out a cover page" clause removed — a control for the scan finding |
| `haiku-via-openrouter` | `anthropic/claude-haiku-4.5`, OpenRouter `native` engine, not streamed |
| `haiku-text-only` | Anthropic SDK, the pdf.js text layer pasted in, no image |
| `gemini-flash-native` | `google/gemini-3.7-flash`, OpenRouter `native` engine, not streamed |
| `mistral-ocr` | OpenRouter `mistral-ocr` engine — a parser, not a model; its output arrives in file annotations with no page boundaries |

Note the two spellings of the same model: `claude-haiku-4-5-20251001` for the Anthropic SDK and
`anthropic/claude-haiku-4.5` for OpenRouter, a dash against a dot. See
[`src/models.ts`](../../../src/models.ts) for why neither is derived from the other.
