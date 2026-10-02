# Can Jev pick the command a reader asked for?

Written 2026-10-02, Stage D of [plan 261002c](../plans/261002c-commands-do-more-and-an-interface-model-vision.md).
The numbers are in `evals/command-pick/results/summary.md` (`summarise.ts`); the raw answers are
beside it. How to rerun it is in [evals/command-pick/README.md](../../evals/command-pick/README.md).

## The question

The interface model Greg described: the reader types or says a request, and a model picks which
app command to run,

> ideally Jev via OpenRouter as a first-pass for speed, falling back to a more powerful LLM if Jev
> is unsure
>
> — Greg, 2026-10-01 (quoted in [chat-llm-help-commands-vision.md](../project/chat-llm-help-commands-vision.md))

The vision doc listed what we did not know: is Jev right often enough, is its confidence a usable
"unsure" signal, and can it pull out an argument (the words in `find <words>`)?

## What was measured

- **The command list**: 51 rows, hand-copied from the bar on 2026-10-02 — the 18 modes, 8 of the
  16 sub-modes, Library, Profile, the public shelf, Metadata, Comments, Feedback — plus the rows
  plan 261002c adds and the bar does not have yet: *<Step> › Run again* for each of the 14 re-run
  steps, *High-powered AI*, *Access & sharing*, *Archive*, *Export*, *Find <words>*. Each row is
  given to both arms as its label, description and aliases, plus a `none` option.
- **The requests**: 72, written and labelled by us. Round 1 (46): Greg's own examples, paraphrases,
  voice-style ("um can you like open the summary thing"), typos, and six with no right answer
  ("add a tag of neuroscience", "delete this article", "what's the weather tomorrow"). Round 2
  (26): harder ones aimed between near-neighbour rows, plus five more with no right answer.
- **Jev** (`typesafe/jev-1.13`, `POST /api/alpha/decisions`): one call per request, one `choice`
  question whose options are the 51 ids plus `none`. It returns a pick, a probability per option,
  and a `confidence`. Reached through a new declared bypass, `command-pick-jev`.
- **The chat arm**: the capable tier as `src/models.ts` resolves it today
  (`anthropic/claude-sonnet-5`), through the gateway, asked for JSON `{id, argument, confidence}`.
  Chosen over GPT-6 Luna because it stands in for the *fallback* — "a more powerful LLM" — and the
  question is whether Jev can sit in front of it.

## The numbers

| | Jev | Sonnet 5 |
|---|---|---|
| right, all 72 | 68 (94%) | 70 (97%) |
| round 1 (46) | 46 (100%) | 45 (98%) |
| round 2, harder (26) | 22 (85%) | 25 (96%) |
| no right answer (11) | 9 | 10 |
| `find` argument extracted (7) | cannot | 7 of 7, exact |
| median / p90 latency | **0.30 s / 0.54 s** | 2.1 s / 3.7 s |
| cost per call | **$0.00011** | $0.0062 |

What each got wrong:

- **Jev** (all four in round 2): "add a note to this paragraph" → Marginalia (0.66), "highlight the
  bit about consciousness" → the Search mode rather than the Find row (0.51), "print this" → Export
  (0.70), "turn on dark mode" → Profile (0.66). Three are a near neighbour chosen over `none` or
  over the right row; the Search one would still have helped the reader.
- **Sonnet**: "delete this article" → Archive (0.55) — a destructive near neighbour for a command we
  deliberately do not offer — and "where was this originally published" → `mode:metadata`, **an id
  that is not in the list** (the right row is `page:metadata`).

### Is Jev's confidence a usable "unsure" signal?

Trust Jev at or above a threshold, otherwise use Sonnet's answer for the same request:

| threshold | Jev trusted, and right | fall back to Sonnet | final answer right |
|---|---|---|---|
| none (Jev alone) | 68/72 | 0% | 94% |
| 0.7 | 61/62 | 14% | 71/72 (99%) |
| **0.8** | **55/55** | **24%** | **71/72 (99%)** |
| 0.9 | 49/49 | 32% | 71/72 (99%) |

All four of Jev's mistakes had confidence ≤ 0.70, and every answer at 0.8 or above was right. On the
harder round alone, 0.8 sends 35% of requests to the fallback. The one miss left at every threshold
is "delete this article": Jev said `none` at 0.72, and the fallback overruled it with Archive.

## What this says

1. **Jev is fast and cheap enough to be the first pass**: a tenth of the latency and about a
   fiftieth of the cost of the capable model, and right on every request we wrote in the plain
   styles.
2. **A threshold of about 0.8 is a reasonable starting point** — none of Jev's mistakes were above
   0.70, and 0.8 leaves a margin — at the price of sending a quarter to a third of requests to the
   fallback. **It is a starting point, not a measured cut-off**: four errors cannot locate a
   threshold, and a 0.8 chosen from this table is fitted to this table.
3. **Jev cannot take an argument.** It picks among options. When it picks *Find*, the words need a
   second step — the fallback model (7 of 7 here), or a deterministic parse of the verb phrase,
   which plan 261002c's Stage A builds anyway for the typed bar.
4. **The fallback is not automatically safer.** It overruled a correct `none` with a destructive
   neighbour, and it invented an id. Whatever runs the answer must check the id against the real
   registry and treat a `none` from either model as a `none`; anything that writes or spends goes
   through the confirmation gate the vision doc describes.

## Caveats

- **Small, and ours.** 72 requests, written by the same agent that labelled them and built the
  list, in one sitting; real readers will phrase things we did not think of. Round 2 was added
  *after* round 1 came back at 100%, to give the confidence something to be wrong about — it was
  not predeclared, though it was labelled before either model saw it.
- **One run per arm**, no repeats, so run-to-run variation is unmeasured.
- **Some labels are judgement calls.** Several requests accept two ids (a mode or its sub-mode;
  "redo the glossary with the good model" accepts either half of a two-step request). "Highlight
  the bit about consciousness" counted Search-mode as wrong because the Find row was the precise
  answer; a looser label would make Jev 23/26 on round 2.
- **The list is a copy**, not the registry, with descriptions shortened and half the sub-modes left
  out. A production version must serialise the real one; more rows, and rows that move with state
  (Archive/Unarchive), may make it harder.
- **Sonnet's latency includes thinking.** At the provider default it reasons before answering. On
  one request (p04) it used the whole 400-token budget thinking and returned no answer; that row
  was rerun at 2,000 tokens and the rest left as they were (none came near the cap). A no-thinking
  setting would be faster but is a separate measurement.
- **Jev is alpha**, on an endpoint the gateway has no route to. A production path needs that sixth
  wire built (vision doc, item 4).

## Spend

$0.46 in all (Jev $0.008 for 72 calls; Sonnet $0.455 for 73, including the one rerun), recorded in
the ledger as job `eval`.
