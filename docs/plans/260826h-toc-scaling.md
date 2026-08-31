# Making the table of contents scale past one response

**2026-08-26.** Stage 4 asks for the whole tree in one model call, and one model call holds 128,000
tokens. Most of what it writes grows linearly with the article, so there is an article length past
which the stage cannot work at all. Today that length is about 55,000 words. This plan takes it to
about 125,000 and removes the unbounded term, so the next ceiling is one we choose rather than one
we hit.

The bug that started this is written up in [260826a-toc-max-tokens.md](../postmortems/260826a-toc-max-tokens.md).
That postmortem's fix was a bridge and said so. This is the thing it was a bridge to.

> Ideally we'd like to process long-book-length texts.
>
> — Greg, 2026-08-25

## What is actually true about the limit

**128,000 output tokens is Anthropic's hard per-response cap, and thinking counts inside it.**
Measured, not inferred: a request with `max_tokens: 500000` comes back

```
400  max_tokens: 500000 > 128000, which is the maximum allowed number of
     output tokens for claude-sonnet-5
```

and `GET /v1/models` reports `"max_tokens": 128000` for Opus 5, Sonnet 5 and Fable 5 (64,000 for
Haiku 4.5). The `output-128k-2025-02-19` beta header that raised this on Sonnet 3.7 is documented as
a no-op on Claude 4 and later — it is built in.

There is **one** exception, and it is real. The asynchronous
[Message Batches API](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
accepts `max_tokens` up to 300,000 with the beta header `output-300k-2026-03-24`, on Opus 5,
Sonnet 5, Opus 4.6/4.7/4.8 and Sonnet 4.6 — not Fable 5, not Haiku. Verified both ways: with the
header a batch request succeeded; without it, the same request errored with
`max_tokens: 300000 > 128000`. Note the check happens per-request when the batch runs, so batch
*creation* returns 202 either way and proves nothing.

Anthropic's own warning is why this does not solve our problem:

> A single 300k-token generation can take over an hour to complete, so plan your batch submissions
> with the 24-hour processing window in mind.

An ingest queue with a reader watching a progress card cannot spend an hour. See
[Alternative F](#f-the-batches-api-and-its-300k-ceiling) for the one case where it might still earn
its place.

And raising a ceiling does not fix a term that grows without bound. It buys one more article size.

## Where the tokens actually go

Measured off the three real trees in `data/`, by rebuilding each into the JSON the model emitted:

| | blocks | internal nodes | structure tokens | label tokens | label share |
|---|---|---|---|---|---|
| `writes` | 19 | 10 | 944 | ~700 | 43% |
| the test article | 141 | 33 | 3,556 | ~4,700 | 57% |
| the constitution | 360 | 52 | 6,370 | 17,204 | **73%** |

The share rises with length because the two halves scale differently:

- **Nav labels grow at N** — one per gistable block, about 40 tokens each. Unbounded.
- **Structure grows at roughly N/7** — one internal node per section, about 120–175 tokens each.
  17.7 tokens per block on the constitution, 25.2 on the test article.

That difference is the whole problem, and it is also the whole solution. Take the labels out of the
call and what remains is small, bounded in practice, and gets *better* for having room to think.

### What a nav label is for

Worth stating plainly, because the answer decides how much this matters. A `navLabel` is a 6–20 word
claim about one paragraph. It has four consumers:

- the **leaf column in outline mode** ([`TableView.tsx`](../../src/web/TableView.tsx))
- the **leaf column beside the prose**, opt-in via the **L3** control
  ([`layout.ts`](../../src/web/layout.ts) `leafBesideText`) — added 2026-08-25 after
  *"I really like the Outline 1-sentence-paragraphs. But I also always want to be able to see the
  full text"* ([granularity-zoom.md](../project/granularity-zoom.md#both-at-once-the-paragraph-outline-beside-the-prose))
- the **spine's hover tooltip** ([`Spine.tsx`](../../src/web/Spine.tsx))
- **outline-mode rows** via [`toc-flatten.ts`](../../src/hierarchy-flatten.ts)

It is deliberately *not* in the column-context panels — [`context.ts`](../../src/web/context.ts)
keeps leaves out of every list.

So labels are not decoration and they are not always on screen either. They are the finest level of
the zoom, reached by a control or a mode. That is the fact that makes deferring them thinkable and
dropping them not.

## The plan

Split one call into two products, batch the unbounded one, and keep the bounded one whole.

### 1. The structure call — one whole-document pass

Everything the current call does **except** the nav labels: the tree of internal nodes, their
titles, their gists, their ranges, `sourceHeading`. Unchanged prompt minus its NAV LABELS section.

Its answer is ~7,000 tokens on the constitution instead of ~26,000, which does two things:

- **The ceiling moves.** `budgetFor` refuses when the estimate plus the thinking reservation exceeds
  128,000, so the usable answer is 88,000 tokens. At the estimator's own constants that is **1,976
  blocks** — roughly 123,500 words at the 62.5 words a block our three real articles average. A real
  tree's structure costs less than the estimator charges for it, by 1.5x–2.3x, so an article somewhat
  past 1,976 would in fact have fitted; the margin is deliberate and stays, because an underestimate
  costs a failed multi-minute ingest and an overestimate costs nothing at all.
- **`effort` goes back to `"high"`.** The postmortem dropped stage 4 to `"medium"` because thinking
  and 26,000 tokens of labels were competing for one allowance. With the labels gone there is room
  to think, and boundaries and titles are exactly the part worth thinking about. **The split
  reverses a quality concession we made under duress**, which is the argument for it that has
  nothing to do with token arithmetic.

### 2. The label calls — parallel, batched on sibling sets

The rule, and it is the one detail that decides whether this works:

> **Generate siblings together; generate disjoint sibling groups in parallel.**

Every leaf under one lowest-level parent goes in one call. Complete sibling sets are packed together
until adding the next one would pass 60 gistable blocks. **A sibling set is never split across calls.**
A label's
documented job is to distinguish its paragraph from its neighbours, so every pair a reader compares
must have been written in the same call. Batching on token windows instead of tree boundaries would
break exactly that and nothing else — which is why it would be hard to notice.

Each batch gets: its own blocks' text, the section's ancestor titles and gists, the global outline,
one block of context either side, and the same style contract.

### 3. `(ordinal, label)` pairs, not a map keyed by block id

Within a batch, blocks are numbered locally and the model returns pairs against those ordinals; code
maps them back to stable block ids. The exact expected ordinal set is required.

Two reasons, both about failure rather than tokens. `JSON.parse` silently keeps the last of duplicate
object keys, so a repeated id disappears without trace. And a bare array of labels would let a
dropped entry shift every later label onto the wrong paragraph — plausible output, entirely wrong,
and nothing would catch it. Ordinals make both a hard error.

This changes **only the new label prompt**. The structure call's format works, is validated, and is
no longer the term that grows. One thing at a time.

### 4. `labels.json`, and an honest pending state

Labels become their own artefact keyed by block id — the [`arc.json`](../project/architecture.md)
pattern, already proven, and safer here because block ids are stable across re-extraction where node
ids are not. It carries which blocks went in which call, which is what gives the
[eval](#the-eval) its seam control.

**As built, the merge happens at write time, not read time**, and `tree.json` still carries every
`navLabel` exactly as before. That is a deliberate narrowing of what this plan first said. Merging at
read time would mean changing the web client, which reads `node.navLabel` in four places, and it buys
nothing until labels are actually deferred — the thing this week is explicitly not doing. `labels.json`
is the label stage's own artefact so it can be re-run without redoing the structure
(`npm run labels -- <dir>`), which is what
[CLAUDE.md](../../CLAUDE.md)'s "independently runnable and independently cacheable" asks for.

**Every artefact is written beside its target and renamed into place, and the tree goes last.** The
queue decides a step is done by whether its output files exist
([`src/pipeline.ts`](../../src/pipeline.ts)), so whichever file it looks for is a commit marker
whether or not anybody called it one.

An earlier version of this plan claimed the ordering alone was enough. It is not, and GPT-5.6-sol
said so plainly: `writeFile` creates and truncates its target before it has anything to put there, so
a process killed mid-write leaves a `tree.json` that exists and is not JSON, the step reports itself
finished, and a retry skips it. On a **forced** regeneration it is worse — the old tree is on disk
throughout, so a crash can leave new labels and new blocks beside last week's tree, all three present
and mutually inconsistent. `rename` within a directory is atomic, so each file appears whole or not
at all, and the tree appears only after the other two already have. `labels.json` is in the step's
`outputs` too: a tree with no labels beside it is a half-run step.

What this still does not give us is a way to tell a *stale* complete set from a current one. That
needs a manifest carrying the source hash, the model and both prompt versions, and it is on the open
list below.

[`checkCoverage`](../../src/hierarchy.ts)'s floor and its invented-id check tighten rather than move: the
floor goes from 95% to **100%**, because each batch is now asked for an exact set of paragraph
numbers and refuses any other, so there is no longer a way for a block to be legitimately unlabelled.
It stays in `generateToc` and is joined by `assertEveryBlockLabelled` inside the label stage, which
is what covers the `npm run labels` path. If a tree is ever published before its labels are complete, it must say so
— a `labels: pending` state, never a silent absence. That is
[silent-success](../reusable/silent-success.md) applied to the one new gap this design opens.

### What ships first

**The split, and only the split.** The queue still waits for the labels before publishing, so no
partial-state work lands yet. That single change:

- lifts the refusal ceiling from 876 to ~2,000 blocks
- removes the unbounded term from the budget
- restores `effort: "high"` to the call that deserves it
- is contained to [`src/toc.ts`](../../src/hierarchy.ts) and its tests

Everything else in this document waits on a measurement.

## Is parallelising going to make it incoherent?

The question Greg asked first, and the answer is no for labels and yes for titles and gists — which
is why the design puts them on opposite sides of the split.

**For labels, three independent arguments converge.**

1. *Labelling synthesises nothing across chunks.* The documented failure modes of divide-and-conquer
   — entity misattribution, conceptual drift, hallucination amplification
   ([Context-Aware Hierarchical Merging](https://arxiv.org/abs/2502.00977), 2025) — are all failures
   of compressing and combining content from several places into new prose. One paragraph in, one
   short claim out does not do that.
2. *Sibling batching keeps every compared pair inside one call.* A label is read against its
   neighbours, never against a label forty pages away.
3. *It may be a quality gain.* [Positional bias in long-form summarization](https://arxiv.org/pdf/2410.23609)
   — "lost in the middle" — finds models attend worse to the middle of a long context. One call over
   360 paragraphs systematically shortchanges the article's middle; sixty calls over six paragraphs
   have no middle to lose. **Flagged as extrapolation**: nobody has tested this exact task, and the
   [eval](#the-eval) below is how we find out rather than assume.

**For titles and gists the risk is real.** Sibling titles have to sit at one abstraction level and
tell themselves apart; a parent gist has to read as a compression of its children, because
*"scrolling right elaborates what I just read"* is the contract
([granularity-zoom.md](../project/granularity-zoom.md)). Blind per-section generation produces four
siblings that all mean "Background". That is precisely why structure stays in one whole-document
call for as long as it fits — which, after the split, is a long way.

One thing not to fix: if the author changes position between chapters, labels that contradict each
other are *correct*. A global harmonisation pass would flatten the movement the reader needs to see.

## The eval

Deterministic tests cannot tell us whether a batched label is as good as a whole-pass one, so there
is a small eval harness under [`evals/`](../../evals/), run by hand, with its results committed so a
later change can be compared against them rather than against memory.

**Two texts, three at most.** The constitution (360 blocks, dense headings, the article that broke
the stage) and the test article (141 blocks, 117 gistable, some non-gistable media). Both already
have a whole-pass tree in `data/`, which is the incumbent to beat — not ground truth, just what we
have today.

What it measures, cheaply and mechanically:

- **coverage** — labelled / gistable, which must be 100%
- **seam distinctness** — the pairwise similarity of adjacent labels *at a real batch boundary*
  against the same measure *inside* a batch. If seams are not worse, the coherence worry is answered
  with evidence.
- **template repetition** — the share of labels sharing an opening bigram, which is how "the author
  then turns to" creeps back in
- **vocabulary retention** — the share of a label's content words that appear in its own block, which
  is the closest cheap proxy for "reuses the author's distinctive vocabulary" and for not inventing
- **length distribution** against the documented 6–20 words
- **cost and wall-clock**, per stage

The judgement call it cannot make is Sol's sibling-shuffle test: show a label with its 5–9 sibling
paragraphs shuffled and ask a person which paragraph it points to. That is the direct test of a
label's documented job, and it needs a human. The harness prints the shuffled sets so that test can
be run by hand when a decision needs it.

## What happened when it was built

**2026-08-26.** Built and run against both eval texts. Both ingest end to end and
`npm run validate-tree` reports structure sound on both.

The constitution, 360 blocks, batched against the previous whole-pass tree as the incumbent. Both
columns are measured by the same harness, with heading labels excluded from length and vocabulary —
the first version of this table did not exclude them and was mostly counting how many headings the
article has (see [what the eval got wrong](#what-the-eval-got-wrong)):

| | incumbent | after the split |
|---|---|---|
| coverage | 359 / 360 | **360 / 360** |
| prose labels outside the documented 6–20 words | 22 | **11** |
| labels sharing an opening bigram | 30.9% | **28.9%** |
| label words found in their own block | 76.1% | **78.1%** |
| wall clock | 421s | **~370s** |
| tokens | 48,107 in / 47,602 out | ~113,000 in / ~49,000 out |
| structure `effort` | `"medium"` | `"high"` |
| label calls | — | 7 |

Every quality measure held or improved. **Cost went up**, and this plan should have said so from the
start rather than calling it a wash: input roughly doubles, because each batch re-sends its section,
the global outline and the context blocks. At Sonnet 5's $2/$10 per million that is about $0.72
against $0.57 — **26% more per article**. Prompt caching on the shared outline and style contract
would take some of that back and has not been done.

### How much of this is noise

The 141-block article was labelled three times, so there is a spread to compare against rather than
a single number:

| | incumbent (1 run) | batched (3 runs) |
|---|---|---|
| label words found in their own block | 74.9% | 69.9%, 72.2%, 73.9% |
| labels sharing an opening bigram | 5.1% | 6.8%, 8.5%, 6.8% |
| prose labels outside 6–20 words | 0 | 0, 0, 0 |

**Run-to-run variance on vocabulary is about four points.** That is the single most useful number
here, because it says what a future comparison has to beat: the batched runs sit inside a band whose
top the incumbent's single run touches, and the constitution moved the other way (78.1 against 76.1).
There is no evidence of a regression, and there would not have been evidence of a small improvement
either. An earlier draft of this section reported a 6-point "gap" on one run of each; three runs is
what turned that into a band.

### Three things only the live runs could find

1. **Headings came back prefixed.** The first run labelled them `"Title: The Mythology Of Conscious
   AI"` and `"Heading: The Temptations Of Conscious AI"`. The rule said a heading's label is its own
   text copied exactly; `<h1>` alone was not enough signal that "copy" meant copy. Blocks are now
   marked `HEADING` explicitly. Nothing threw — the labels were the right length, in the right place,
   and wrong.
2. **The author's vocabulary drifted.** Retention on the 141-block article fell from 76.0% to 60.0%,
   and the specific loss was the author's `technorati` becoming `technologists` — a synonym is not as
   good as the word, it is *worse*, because the reader is scanning for what they read. Naming that
   exact substitution in the prompt brought it to 69.6% and brought `technorati` back. It is still
   below the incumbent on that article while being level on the constitution (77.4% vs 78.5%), and
   two runs cannot tell a real gap from run-to-run variance. **Open.**
3. **`effort: "medium"` dropped a label, silently.** A batch asked about 42 paragraphs answered about
   41 — twice — well-formed and untruncated. `parseLabels` caught it, which is the whole reason the
   wire format asks for an exact set of numbers. `"low"` returned everything twice and its eval
   numbers were identical, so `"low"` stays, and the retry was widened from truncation-only to any
   incomplete batch.

The third is worth sitting with. It is this postmortem's own bug at one order of magnitude smaller
with the loud half removed, and it arrived within an hour of the design that anticipated it.

### What an adversarial review found that nothing else did

Everything below passed `npm test` and `npm run typecheck` at the time it was found. That is the
point of the exercise, and the reason to write the list down.

- **`checkCoverage` was a ratio over leaf nodes, not a set over blocks.** `buildTree` took the
  model's word that its ranges tile the article. Two overlapping sections grow *two* leaves for one
  block while a gap elsewhere grows none — so the labelled-node count goes up as the labelled-block
  count goes down, and the ratio comes out at exactly 1.0 with paragraphs missing. Demonstrated on
  twelve blocks with children `[0..6]` and `[5..9]`: coverage reported complete, two paragraphs with
  no row, two rendered twice. **The tests could not see it** because every `checkCoverage` case built
  from a single flat root, and a tree with one range cannot have duplicate leaves — the check and its
  test shared an assumption. Fixed at the source: `buildTree` now refuses a tree whose children do
  not tile their parent, and `checkCoverage` compares sets of block ids.
- **A reversed range** (`start` after `end`) passed every lookup, ran the leaf loop zero times, and
  produced a childless internal node holding a stretch of article that then existed in no leaf at
  all. Now refused by name.
- **The exact-set check cannot see a shift.** It stops a *dropped* label; it cannot stop a model
  that loses count and returns a complete, correctly-numbered set in which pair *n* describes
  paragraph *n+1*. Same physical mistake as the 41-for-42, with the loud half removed. `detectShift`
  now compares each batch's labels against their own paragraphs and against their neighbours, and
  refuses when a neighbour wins — comparative rather than absolute, because adjacent paragraphs of
  one article share plenty of vocabulary and a single odd label proves nothing.
- **`MAX_BATCH` could never bind.** The packing closed a batch as soon as it reached the *minimum*,
  so the count was always under 40 when the maximum was tested. The file documented a 40–80 range
  the code could not produce; every batch came out at about 40, and the test that "checked" the cap
  asserted a bound that could never be reached. The minimum is gone and the cap is 60.
- **`npm run labels` had no gate.** It merges and rewrites `tree.json` without going through
  `generateToc`, so the one advertised standalone command was the one path with nothing between a
  short answer and the disk — and `mergeLabels` *overlaid* rather than replaced, so a partial re-run
  would have written a tree mixing this prompt's labels with last week's, with nothing recording the
  mix. The merge now replaces, and `assertEveryBlockLabelled` runs at the end of the stage where
  both callers pass through.
- **The label stage leaked article prose into error messages.** `src/toc.ts` is written around this
  at length — V8's `JSON.parse` error quotes its input, `src/jobs.ts` logs an error's message *and*
  stack, and `redact` is path-based so it reaches neither. `src/labels.ts` was written without it and
  used bare `JSON.parse` plus a 120-character sample. Now `parseJsonFrom`, and errors carry shape
  rather than content.
- **The prompt told the model a gistable paragraph was `NOT-GISTABLE`**, because the marker was
  chosen from position rather than from the block. Harmless to the labels, a lie in the context
  window. Now `OTHER-SECTION`.
- **The retry threw away the first error.** A truncation carries the two figures saying which half
  of the budget overran; losing it because the second attempt failed differently discarded the only
  evidence worth having. Both attempts are now reported.

### And what a second review found after those were fixed

GPT-5.6-sol reviewed the finished code (2026-08-26) and did not call it finished. Three of its
findings were correctness holes, and one of them is this project's own recurring bug:

- **A heading's label was still not the heading.** The prompt says copy it EXACTLY; the model does
  not. On the two committed articles, **9 of 36** heading labels and **3 of 9** differed — curly
  apostrophes flattened to straight ones, and authored numbering ("2: Other Games In Town") dropped.
  The apostrophe half is the same failure as [the eleven headings in the
  postmortem](../postmortems/260826a-toc-max-tokens.md), which was patched by comparing more loosely. Sol's
  answer was the right one: *"Do not prompt harder."* A heading's label is knowable without a model,
  so `parseLabels` now takes it from `block.text`. Both articles are at 0 differing.
  **And the eval was hiding it**, because it had just started excluding headings on the premise that
  they were copied exactly.
- **"Write the tree last" is not a commit marker.** `writeFile` truncates its target before it has
  anything to put there, so a kill mid-write leaves a `tree.json` that exists and is not JSON — and
  existence is what marks the step done. On a forced regeneration the old tree sits there throughout,
  so a crash leaves new labels beside a stale tree, all three files present. Both writers now write
  beside the target and rename.
- **`assertChildrenPartition` had two false-negative exits.** An unresolvable range returned early on
  the grounds that "the lookup below reports this properly" — which is only true for a lowest-level
  node, so an internal node with an invented endpoint and valid descendants survived. And nothing
  checked that the **root** spans the article, so a tree dropping a leading image or trailing rule
  passed everything (`checkCoverage` counts only gistable blocks) while leaving those blocks with no
  leaf and no resolvable id.

And two things that were not holes but were not honest either:

- **`detectShift` was too weak as a detector and too aggressive as a gate.** It threw whenever either
  neighbour's mean beat the correct mean by *any* amount, over as few as six labels, while its
  comment claimed "cannot happen by chance across dozens". Worse, `contentWords` split on `[a-z]`, so
  a Greek or CJK article produced empty sets everywhere, every score was zero, and `own >= best`
  answered yes to `0 >= 0`: **the gate reported itself satisfied having examined nothing.** That is
  the `\b` mistake from [glossary.md](../project/glossary.md) again. It is now Unicode-aware and
  votes per label rather than averaging: a shift has to move most of the votes the same way *and*
  collapse the correct alignment, over at least twelve labels with real signal. Where there is no
  signal — verse, a table of near-identical rows, a language it cannot read — it declines to judge
  and says so, which is the honest answer in both directions.
- **A test that exercised nothing.** The context-marker test built exactly 60 blocks, which after the
  cap moved to 60 is one batch, so `planBatches(...)[1]` was undefined and an early return skipped
  the assertion — while the assertion still expected a marker the code had stopped emitting. Writing
  it properly immediately found a live bug: the `OTHER-SECTION` fix had overwritten the `CONTEXT`
  case, so every block before and after a batch was mislabelled to the model.

Sol also judged `MIN_PAIRS = 20` on the seam test to be theatre, with the arithmetic to show it: at
similarities near 0.02 a single extreme observation among twenty moves the mean far outside the ±15%
band the verdict was reading, and the pairs are not independent anyway. **The directional verdict is
gone.** The numbers are printed and nothing is concluded from them, because a claim about seams needs
a blinded comparison across several texts and runs with its uncertainty stated, and saying so is more
useful than a verdict nobody should act on.

### The checkpoint, built

The three things that review left open were all about the same hour: what happens when batch eight
of a book fails. They were recorded rather than fixed at the time, and then built, still 2026-08-26,
to Sol's own smallest-correct-form. All three are in [`src/labels.ts`](../../src/labels.ts).

**A checkpoint, in its own file.** Each batch's labels are written to `labels-progress.json` as it
lands, and a later run reuses them. Not into `labels.json`: that file's *existence* is what
[`src/pipeline.ts`](../../src/pipeline.ts) reads as "stage 4 is done", so a partial one would be a
finished-looking article with holes in its navigation. Working state and artefact are different
things and now live in different files. `clearCheckpoint()` deletes it, and the caller calls that
**after** the artefacts are on disk rather than when `generateLabels` returns — the gap is the whole
point, because a caller that died in between would otherwise have lost everything it had just paid
for.

**Resumed by fingerprint, never by block id.** `batchFingerprint` hashes the bytes the request was
about to send — prompt version, model, effort, system prompt, the block ids, and both halves of the
rendered user message. Sol was explicit that matching on ids is *not* correct, and the reason is the
one this whole stage rests on: the boundaries, the crumbs, the gists and the outline can all move
while the same paragraphs sit in the same call, and a label written to tell a paragraph apart from a
different set of neighbours is answering a question nobody asked any more. The ids go in as well, so
two byte-identical sections — repeated boilerplate, a table's header row — cannot collide and fill
one batch from the other's labels.

**And the bytes were not enough**, which the next review found. Move one paragraph from a lowest-level
section into the one beside it, leave both titles and gists alone, and let the packing put both in the
same call: the outline is identical, the section preamble is identical, the numbered paragraphs are
identical and in the same order, the block-id list is identical. Every byte the model would see is
the same, and the sibling grouping — the single thing this stage rests on — has moved. The old labels
would have been reused with nothing going red. `setStarts` and the sets' own ids and blocks are in the
fingerprint now, none of which the model ever sees, and
[`tests/labels-batching.test.ts`](../../tests/labels-batching.test.ts) builds exactly that tree and
asserts the rendered prompt is byte-identical *and* the fingerprint is not.

**The writes are serialised.** Four batches landing at once would each read the accumulated list,
each build a file, and the last rename would win — a checkpoint quietly holding one batch where it
should hold four, with nothing red anywhere and the next run re-buying three answers it had already
paid for.

**Fail-fast.** One shared `AbortController`, composed with the caller's signal through
`AbortSignal.any` so a cancelled ingest still cancels this, and aborted on the first unrecoverable
failure. `queue.clear()` is called too, but the signal is what makes it safe: p-queue never settles a
cleared task's promise, so clearing alone would leave `Promise.all` waiting for ever on a batch that
will never run — a hang rather than a failure. That claim about the dependency is pinned by a test of
its own, because if a p-queue upgrade changed it nothing else here would notice until a run hung in
the dark.

**A manifest on `labels.json`** — `sourceHash`, `structureHash`, `structureVersion` — so a *stale*
complete set can be told from a current one, which atomic writes do not give us. The structure hash
is the one that earns its place: boundaries can move without a single block changing, and
`sourceHash` alone would call that current. It hashes every node's range, parent, title and gist,
*not* the outline the prompt shows the model — the first version hashed `renderOutline`, which is
titles and indentation, so two trees cutting the article in completely different places produced the
same hash. **Nothing reads the manifest yet**: the `toc` step has no freshness check of its own, so
the pipeline still decides it is done by whether the files exist. Recording it is what makes writing
that check a small job; until it is written, it is evidence rather than a guard, and saying so is
better than implying otherwise.

Two smaller things came with it. `generateLabels` builds its Anthropic client on first use rather
than up front, so a fully-resumed run needs no API key — which is also what lets a test prove no
batch quietly went and asked again, by deleting the key and watching the run succeed. And the run
now reports `resumed`, and reports its token counts for **this run's calls only** while
`file.batches` keeps the per-batch figures of whatever call produced each label set. The two
deliberately do not add up on a resumed run.

### What the third review found, and the one thing left open

GPT-5.6-sol reviewed the checkpoint on the day it was built and did not call it clean. Two findings
were high severity. The first — a boundary change reusing the old labels — is fixed above. The
second is **not built, and is the largest remaining path to a green, complete-looking, internally
inconsistent article**:

> `writeAtomic` is atomic for one file only. The three artefacts are separate renames. Two writers
> can leave `labels.json` and `blocks.json` from run B beside `tree.json` from run A. All files
> exist, so the pipeline declares the step done.

The same defect exists inside a *single* process during a forced regeneration: the old `tree.json`
sits there while new labels and blocks land, so a crash before the last rename leaves a
complete-looking mixed generation. Ordering and atomic renames were never going to fix that; only a
publication boundary is. Sol's shape for it: a per-slug interprocess lock, a generation directory
with one atomic "current generation" pointer, the generation id on the checkpoint and on all three
outputs, and a completion step that validates the set.

**Not built here, deliberately, and it is Greg's call rather than mine.** It is not this stage's to
build — it spans stage 4, [`src/pipeline.ts`](../../src/pipeline.ts) and the store — and Sol's own
alternative to the generation directory is "or a database transaction", which is what
[the Postgres migration](260825f-postgres-migration.md) is in the middle of delivering. Building a
filesystem generation scheme now is work with a known expiry date. The risk in the meantime is bounded
by the fact that nobody runs two ingests of one article at once on purpose.

What *was* taken from that finding is the cheap half: the checkpoint carries a `runId`, so
`clearCheckpoint` will not delete a file another process has claimed — and a fully-resumed run
rewrites the file first, without which the stamp would stay with the run that failed and the delete
would refuse for ever. That bug was live for about twenty minutes and the test that would have caught
it was hiding it, because the checkpoint it hand-built carried no stamp at all.

Three smaller things from the same review:

- **`usableCheckpoint` was validating shape, not fit.** It asked whether an entry was well-formed;
  nothing asked whether it answered for the blocks the batch was about to send. Between that and
  `assertEveryBlockLabelled` — which asks whether every block got *a* label, not whether the right
  call wrote it — an entry with one extra id would have overwritten a neighbouring batch's label and
  the run would have reported success. `coversExactly` now checks at the point where the answer is
  known.
- **An abort during the retry was dressed as a second model failure.** A cancelled ingest, or a
  sibling batch ending the run, came back as "failed twice" with a truncation story about a call that
  never happened. It is rethrown as itself now.
- **`TocRun.labelBatches` was printed as "calls".** After a resume it would have said three calls
  having made two. `labelCalls` and `labelsResumed` are separate fields.

And it named seven tests that overclaimed. The worst was one that had been vacuous since before this
work — `batchParts`' "refuses to guess when the boundary is missing" asserted something true on the
ordinary path and never reached the branch it named. That branch is not reachable through the public
API at all, so the test now checks what *is* checkable — that the two halves reassemble into exactly
what `renderBatch` wrote — and the file says the branch is defensive rather than pretending to cover
it.

### The warm-up that was warming nothing

Sol also looked at the prompt caching added to this stage while the review was running, and found it
paying for something that could not exist. The batches share the outline as a cached prefix, and
`generateLabels` ran the first batch alone so that its write would land before the others read —
sound reasoning, and a whole batch of latency on every run of the stage. But Sonnet 5 will not cache
a prefix under **1,024 tokens**, and on both committed articles this prefix is well under it:
roughly 660 tokens on the 141-block article and 950 on the 360-block one. So the serialisation bought
a discount that was never available.

It is now conditional on the prefix clearing the floor, and the run reports `estimatedCacheable`
beside `calls` — because `cacheReadTokens: 0` has *several* causes needing opposite responses
(nothing to cache; a run that made one call or none, so nothing to read it back with; and a cache
that has stopped hitting, which is a bug). The first version of this reported one flag and claimed it
separated them, which it did not: a resumed run reports zero too. The pair does. And the name says
`estimated` because `estimateTokens` is four characters a token, so a prefix within a few percent of
the floor could fall either side — accepted, since the worst case is a few cents. That is
[silent success](../reusable/silent-success.md) in its purest form: the labels were right, the number
was zero, and zero was what working looked like too.

### What the eval got wrong <a id="what-the-eval-got-wrong"></a>

An adversarial review of the finished code (2026-08-26) found the harness measuring the wrong thing
in the two places the first version of this table quoted.

The prompt **requires** a heading's label to be its heading text copied exactly — two to six words,
outside the documented 6–20 range by construction, and scoring ~1.0 on vocabulary because it *is*
the block's own text. Counting them meant "52 labels outside range" was 30 compliant headings and 22
real cases; on the 141-block article all nine were headings and the measure was pure noise. Both
measures now exclude headings and the report says how many it excluded.

Three smaller ones, all the same shape — a tool quietly not doing its job:

- Result files were named by **date**, so two runs on one day overwrote each other, destroying the
  "before" you re-ran in order to have. Now timestamped to the minute.
- The seam line printed `skipped — no labels.json` for a second, different case: a `labels.json`
  that does not account for every label. It named a cause that was not the cause.
- `--shuffle` used `sort(() => Math.random() - 0.5)`, which is not a uniform shuffle and leaves a
  bias correlated with document order — in the one output whose entire point is that a person cannot
  recover the order. Now Fisher–Yates.

And one thing it got right that the *gate* did not: vocabulary retention was the only measure
capable of catching a batch of labels shifted onto the wrong paragraphs, and it was wired to nothing
that runs. It is now `detectShift` in [`src/labels.ts`](../../src/labels.ts), and the eval imports
`contentWords` from the stage so the measure and the gate cannot drift apart.

### What the seam test can and cannot say yet

Nothing, and the harness now says so. There is one seam per pair of calls, so nine calls give eight
seams against forty-one matched interior boundaries. The first version of the eval announced "seams
look worse" off those eight pairs, which differed by half a percentage point of word overlap. It now
prints `only 8 seams, too few to tell` below twenty pairs.

Reaching twenty needs an article of about twenty-one calls — roughly a book. So **the coherence
question is still open on the evidence**, and rests for now on the mechanism rather than the
measurement: labelling synthesises nothing across chunks, and sibling batching keeps every compared
pair inside one call. The measurement will arrive with the first long text.

## Alternatives considered

### A. Raise `max_tokens` and move on

The first thing to try, and it is not available: 128,000 is Anthropic's cap, measured above. Even if
it were ours, it would buy one more article size, because the label term grows without bound. Reject.

### B. Lower `effort` further, or turn thinking off for stage 4

Cheap, and it does buy room — adaptive thinking expands into whatever it is given, which is the
lesson of the postmortem. But it buys room by spending the thing that makes boundaries good, and
boundaries are the visible artefact. Reject as a scaling answer; keep as a per-stage dial, which is
what the split lets us set *up* rather than down.

### C. Recover from truncation — parse the partial JSON, or continue the response

Anthropic documents continuation after `max_tokens`, but a continuation that resumes inside a JSON
string can repeat text, drop punctuation, or change its mind. And a tree built from a truncated
answer describes two thirds of an article with nothing saying so — the exact shape of
[silent-success](../reusable/silent-success.md). **Reject as a recovery path.** A partial parse is
defensible only as a private checkpoint: keep whole validated entries, regenerate the missing ids,
publish nothing partial.

### D. Coarse-to-fine: a global outline first, then subtrees in parallel

Sol's recommendation for book scale, and right there:

1. build the authored-heading skeleton mechanically — never ask the model to quote headings back
2. make bounded section cards in parallel — navigational, not fluent: headings, ranges, distinctive
   terms, opening and closing claims, candidate boundaries
3. one global pass over the ordered cards assigns top-level boundaries and sibling titles
4. each coarse subtree generates in parallel, seeing its raw text plus the whole global outline
5. gists bottom-up, labels in parallel, after structure is fixed

**Not now.** Below ~125,000 words a single structure call sees every boundary and every sibling
title at once, which is strictly better than any decomposition and much simpler. Past that it stops
being optional and becomes the design. The trigger is a real text, not a milestone.

Worth knowing: coarse-to-fine for *extracting* structure from an existing document is unpublished.
The literature is all the mirror image — plan-then-elaborate for *generating* long text
([Summarize, Outline, and Elaborate](https://arxiv.org/pdf/2010.07074)). The nearest precedent is a
product: Descript ships an explicit "Outline → Chapters" mode.

### E. Defer the labels — publish the article, fill the labels in behind

The reader waiting in the queue is waiting for the *article*, and the article is fully readable on
27% of today's answer. Deferring labels roughly halves time-to-read at ingest and costs nothing in
quality, because it is still pre-generation, just sequenced after readability.

**Deferred, not rejected**, and the reason is the L3 control. Sol argued against lazy labels because
pre-generation is what makes zoom feel like zoom; Fable argued for deferral on the grounds that
labels never participate in zoom. Fable's premise is now half wrong — L3 puts the leaf column beside
the prose in reading mode. Deferral survives that, but on weaker ground: L3 is opt-in and the gap is
a couple of minutes, once. Decide it on the timings the split actually produces.

### F. The Batches API and its 300k ceiling

Real, verified, and narrow. It doubles-and-a-half the output a single generation can produce, at the
cost of an hour-scale wait inside a 24-hour window.

Useless for an article. **Possibly right for a book**, because the latency criterion is not uniform:
nobody waits an hour for a twenty-minute read, and nobody reads a 400-page book in one sitting
either. "Paste a book, it's ready tomorrow" is a defensible product. Against it: a second code path,
a second failure mode, and it still only raises a ceiling rather than removing one. File as a real
option with a narrow use, not as the architecture.

### G. Make the finest level extractive rather than abstractive

Pick each paragraph's most distinctive sentence or clause mechanically. Zero model tokens, cannot
hallucinate, and speaks literally in the author's language — which fits the vision unusually well.

It fails exactly where the vision cares: the paragraph whose claim is implicit, or whose first
sentence is setup, anaphora or scene-setting. And it is the road to YouTube's auto-chapters, whose
labels are famously "Introduction" and "Main Discussion" — the failure our prompt's *"a CLAIM or a
MOVE, not a topic label"* rule exists to prevent. **Test it in the eval as a variant; do not let it
drift in as a cost cut.**

A middle option worth the same test: extractive where a paragraph contains a short discriminative
claim, abstractive where it does not, no label for genuine transitions.

### H. A cheaper model for the labels

Haiku 4.5 at roughly half Sonnet 5's price for a task that is genuinely mechanical. Saves on the
order of $0.55 per 100,000 words. Only viable *after* the split, because the batches are what make
a 64,000-token output cap and a 200,000-token context window irrelevant.

**Worth testing, not worth assuming.** The labels are the thing a reader looks at most.

### I. Drop the leaf level entirely

The largest possible win — labels are 73% of the output and all of its growth — and it is off the
table. *"All the way down to a paragraph level"* is the founding quote of the stage
([block-ids.md](../project/block-ids.md), [granularity-zoom.md](../project/granularity-zoom.md)),
and L3 shipped yesterday because Greg wanted that level beside the prose. Recorded here because a
plan that does not name the option it rejected is hiding its own reasoning.

One narrower version stays open for book scale: nobody scans a 5,000-row outline, so at book length
the outline's natural leaf may be the section, with paragraph labels generated only inside the part
being read. That is the one context where lazy labels are clearly right. Decide it when a book
exists.

### J. Variable tree depth

Not an alternative — a defect, and it is already biting. The prompt pins three internal levels, and
the constitution at 360 blocks already strains them:

```
root → 7 chapters → 44 sections → 360 leaves
chapter fan-out: 5, 7, 3, 11, 5, 9, 4     (the prompt asks for 5–9)
section spans:   min 2, median 7, max 30  (the prompt asks for boundaries every ~9)
```

One section swallows thirty paragraphs. Both advisors filed this as book-length work; the numbers
say it is a reader's problem today. **Fix it soon, separately from the split**, so that if tree
shape changes we can tell which change did it.

## What this costs

| | today | after the split |
|---|---|---|
| ceiling | 876 blocks / ~55k words | ~2,000 blocks / ~125k words |
| structure `effort` | `"medium"`, forced | `"high"`, restored |
| the constitution, wall-clock | one call, ~6 min | structure ~2–3 min, then labels in parallel |
| cost, article scale | — | **+26%** — see the build log |
| cost, 100k words | refused | ~$2–3, 4–12 minutes |
| new failure surface | — | partial label sets; coverage moves to the label stage |

Book-scale cost and latency figures are Sol's, from current Sonnet 5 pricing, and are estimates
rather than measurements: 100k words at $2–3 and 4–12 minutes; 300k at $6–9 and 8–25 minutes; 500k
at $10–15 and 12–40 minutes, assuming concurrency around eight. The formula is the useful part:

```
label latency ≈ ceil(batch count / allowed concurrency) × p95 batch time
```

Instrument it before promising anything.

## Deliberately not doing

- **A global voice-harmonisation pass over the labels.** It would flatten real turns in the author's
  argument, and nothing yet shows a seam problem to fix.
- **Token-window chunking that cuts sibling sets.** The tree is the batching boundary, always.
- **One call per paragraph.** Ruinous on both cost and latency, and it destroys the sibling context
  that makes a label distinguishing.
- **Lazy per-section labels for articles.** Outline mode's point is scanning every row at once; a
  mode that back-fills as you scroll is that feature deleted.

## Where the advice came from

- **GPT-5.6-sol**, twice, via [codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md) —
  the sibling-set batching rule, the ordinal wire format, the coarse-to-fine shape, the eval design,
  the three-fixed-levels finding, and the Batches API footnote that turned out to be right when our
  own first research pass said it was wrong.
- **Fable 5** — the final proposal: restoring `effort: "high"` as the split's real prize, keeping
  the wire-format change to the new prompt only, and the position on deferral.
- **A literature sweep** — the papers cited above, and the finding that the coherence risk sits in
  synthesis rather than in labelling.

## See also

- [hierarchy.md § The budget](../project/hierarchy.md#the-budget) — where the design
  lives once this lands
- [260826a-toc-max-tokens.md](../postmortems/260826a-toc-max-tokens.md) — the bug, and why the bridge was a bridge
- [silent-success.md](../reusable/silent-success.md) — why nothing partial is published
- [testing.md](../project/testing.md) — what is deterministic enough to test, and what the eval is for
