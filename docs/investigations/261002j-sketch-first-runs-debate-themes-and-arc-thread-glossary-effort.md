# Three small prompt-and-effort evals: Sketch's first runs, Debate themes, arc/thread/glossary effort

Written 2026-10-02. Each of these was a short measurement that shaped one prompt or setting, and
until now its reasoning lived only in a plan or an `evals/results/` file. They are separate questions
sharing a document because each is too small for its own. The Sketch effort question
(`high` to `low`) is in
[261001c](261001c-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md) and not here.

## 1. Sketch: do model-authored pictures hold up? (2026-08-30 and 2026-09-03)

Plan: [260830j](../plans/260830j-sketch-diagram.md). Live doc: [sketch.md](../project/sketch.md).

**Question.** Greg, 2026-08-30: *"Let the agent decide the layout completely, probably with SVG."*
Can a model lay out the argument's shape as a checked scene (five primitives with numbers, not raw
SVG) so the picture is not "wrong in a way that looks exactly like being right"?

**What ran.** `npx tsx evals/sketch/run.ts`, shipping prompt `sketch/1`, on three articles
([sketch-2026-08-30](../../evals/results/sketch-2026-08-30/README.md)); a re-draw of two after a
prompt fix ([sketch-2026-08-30b](../../evals/results/sketch-2026-08-30b/README.md)); and one
more article under `sketch/2` on 2026-09-03
([sketch-oai-hf](../../evals/results/sketch-oai-hf/README.md)).

**Numbers** (those READMEs; the first cost line is the plan's, 2026-08-30, `capable`/`high`):
- $0.18-0.25 and 125-145 s a picture. 25-34 nodes, 3 scenes, all nodes linked, 0 faults, 0% overlap.
- `flow` (Kendall's tau of node height against block order): 0.95, 0.95, 1.00 on the first three;
  0.92 and 0.94 on the re-draw; 1.00 on `openai-huggingface`. These "say it is not broken", not that
  it is good (the README's own words).

**The qualitative test.** A Sonnet subagent was given only the three overview PNGs and asked what each
piece argues. It read all three correctly; losses were compression, not invention (e.g. the Noema
picture drew two ethical risks as symmetric where the essay argues an asymmetry). Two more readers
found the one real failure class: **geometry asserting more than the prose** (a numbered 1/2/3/4
ladder for a constitution that says prioritisation is "holistic rather than strict"; a decision
diamond on a question the essay says cannot be settled). The prompt gained a section naming what
each device claims; on the first re-draw the ladder became unnumbered pills under "held holistically,
not as a strict ladder" and the diamond went.

**Spot-check of navigation.** Of five Noema nodes chased into `blocks.json`, three landed exactly,
one on a heading, one a block early on the counter-consideration. Not fixed; a verification model
pass was named and not built.

**Decision.** Sketch exists as a model-written scene with validation, on demand and never in the
default ingest. Raw model SVG was rejected as a first model-authored markup (the app's stated
"model output is text, never `dangerouslySetInnerHTML`" rule, and mXSS risk).

**Caveats.** Three articles, one draw each, and the reader test is one subagent per article. Later,
sixteen draws on eight articles measured the effort question ([261001c](261001c-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md)).

## 2. Debate themes: does the third call group sources well? (2026-09-30)

Plan: [260930j](../plans/260930j-debate-themes-and-key-sources.md). Outputs:
[run 1](../plans/260930j-themes-eval-run1.txt), [run 2](../plans/260930j-themes-eval-run2.txt).
Live doc: [debate.md](../project/reception.md).

**Question.** Greg, 2026-09-30 (report 6M): highlight "key themes from other people and commentary"
and "key nodes, i.e. the critical papers that really responded or moved things forward or take a
different view". Can one extra model call over a debate's verified rows do that?

**What ran.** `npx tsx evals/debate/themes.ts <debates.json>` calls production's `synthesiseDebate`
over nine stored debates, on Sonnet 5, about ten seconds a call. Two passes, a prompt revision between.

**Numbers** (counted from the two output files, 2026-10-02): run 1 answered 8 of 9 (one `failed`),
11 themes, 17 key sources. Run 2 answered 9 of 9, 13 themes, 13 key sources. The plan reads run 2 as
"every theme spans two different works; 12 of 13 roles right against the passages, the thirteenth
(`restates the exact figure`) filed `responds` and more likely `origin`." Cost was not metered; the
plan's estimate is "a cent or two" on a debate's roughly $0.25 (input under 3,000 tokens).

**What changed between runs** (plan): output ceiling 2,000 to 8,000 tokens (one run hit
`finish_reason: length`); two copies of one work on two sites count as one work; an `origin` role
added (a `responds` was really the original study); key-source cap rows/2 to rows/3.

**Decision and dead ends.** Built as a third call after verification. Passed over: no model at all
(badge rows from `disputes` and `bears: directly`: repeats 5P's stance order, no themes); folding
into pass B (it does not see pass A's rows and answers before verification drops rows); a separate
pipeline step (too much plumbing for a cent). Not taken from the plan review: a no-filter v1.

**Caveats.** Nine debates, judged by a read of titles and passages, one reader, no second judge.

## 3. Does arc/thread/glossary need `high`? (2026-08-26)

Source: [effort-vs-quality.md](../../evals/results/effort-vs-quality.md), which is already a full
write-up; this entry only records where it sits and what it decided. Trigger: GPT Sol noticed arc
and tweets ask `high` while glossary asks `medium`, and effort is part of the prompt-cache key.

Two articles, three stages, both efforts (`SPIDERYARN_PIPELINE_EFFORT`). Headline: `arc` on noema
fell from vocab retention 0.79 (`high`) to 0.68 (`medium`), past the "couple of points" line in
[reorder-quality-before.md](../../evals/results/reorder-quality-before.md); glossary at `high` got
more formulaic on noema (template 0.35 against 0.09) while spending 8,590 against 4,032 output
tokens. **Decision: do not align the efforts**; make the cache breakpoint conditional on whether a
stage that can read it is scheduled (`sharesArticleCache` in `src/pipeline.ts`). Caveat: one run per
cell, and the `arc`-on-noema result carries the conclusion alone.

## Re-run

```
npx tsx evals/sketch/run.ts            # paid; see the file header
npx tsx evals/debate/themes.ts <debates.json> [--out <file.json>]   # paid, cents; debates read by hand, read-only
```

Up: [research.md](../project/research.md)
