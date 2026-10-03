# Marginalia: relation words, and Timeline events in the margin

Overseer queue item `qi-cbnydm7c`, from two of Greg's reports (`spya-ayajv6`, `spya-u3dgk7`, both
checked as his with `feedback-reporter.ts`). Most of both reports has shipped already: the column,
the Socratic questions, the arc, the idea stamps, and FAQ, Debate, Citations and comments shut by
default ([marginalia.md](../project/marginalia.md)). **This builds only the two pieces still
missing.**

> include the "relation-words", e.g. BUT, SO
>
> — Greg, 2026-09-30 (spya-u3dgk7)

> it should almost entirely be reusing existing stuff that we've already generated from quotes and
> ideas and timeline and summary and...
>
> — Greg, 2026-09-29 (spya-ayajv6)

Relation words were written up as stage 2 of
[261001d](261001d-annotations-mode-marginalia-in-a-right-hand-column.md#stage-2--relation-words-proposed-not-built)
and held back until the column had been tried. It has been tried for two days, through seven
follow-up plans. Timeline events are named in [marginalia.md § Keep an eye out for new
kinds](../project/marginalia.md#keep-an-eye-out-for-new-kinds) as "not here yet".

**Not in scope, on purpose:** opening Marginalia never runs another mode (decided, marginalia.md §
What it shows); the dashed underline for ideas in the prose stays deferred (261001d § Deferred,
named — a second mark inside the author's text); automatic ask-for-help comments stay declined.

## Stage 1 — Timeline events in the margin (no model, no server)

One more shut kind, exactly as FAQ and Debate were added (marginalia.md § Keep an eye out):

- `notes.ts`: `{ kind: "timeline"; items: { event: TimelineEvent; quote: string }[] }`, placed
  **beside the passage that dates it**: a `dated` event at `when.at`'s block, a `words` event at
  its earliest mention whose block still holds the phrase. Not simply the first mention, which may
  give no date (Sol P1-2). The phrase must still be in the block. `GROUPED_ORDER` gets `"timeline"`
  after `"faq"`. `MarginSources.timeline`.
- **Only events the piece dates**: `dating.kind` `dated` or `words`. An `untimed` event in the
  margin is a label with nothing to say about time, and a `rejected` one is our failure; both stay
  in the band. This keeps the column sparse (the test article's timeline: ten of twenty-six rows
  untimed).
- The line: one event → stamp is the date in words (`datingWords`, the panel's own function,
  **always with its year**: the band drops a shared year because its head says it once, and the
  margin has no head), line is the event's label; several → stamp *When*, line "3 events".
  Opened: each event's date, label and the quoted words that mention it. Voices: the label is the
  model's, the quote and a `words` phrase the author's, a computed date ours.
- Owner: `useTimelineRead` (exists; reads only) plus `useStepFinished(slug, "timeline", refresh)`
  in `OwnerMarginFeed`; stale lists not drawn. Visitor: `artefacts.timeline.events`, as FAQ.
- `tips.ts`: a `timeline` row. Tests: `tests/marginalia-notes.test.ts` (placement, quote check,
  untimed/rejected left out), the live-refresh test's list of steps the feed listens for, and the
  note-cards test's keys.

## Stage 2 — relation words (a new step, `relations`)

### What the reader sees

A small-caps word at the top of a paragraph's note — **so**, **but**, **why**, **e.g.**, **vs** —
saying how this paragraph bears on the one before it. The word is the answer; its card says the
sentence (260828c § *A symbol that needs a tooltip has already failed*):

| stored | drawn | card says |
|---|---|---|
| `therefore` | so | This paragraph draws its conclusion from the one before it. |
| `but` | but | This paragraph pushes back on what you just read. |
| `contrast` | vs | Something set against what came before, without denying it. |
| `because`, `for-example`, `zoom-in`, `zoom-out`, `new-thread`, `restates`, `and-also` | — | stored, not drawn |

**Draw only the turns** (GPT Sol on 261001d: *"classify every paragraph, draw only the turns"*).
Greg named BUT and SO; `vs` is the other change of direction. On the decorated experiment's 108
paragraphs that is 33 words, about one paragraph in three, and the undrawn seven are 75. Sol's plan
review asked for fewer still (`but` and `vs` only); `so` stays because Greg asked for it by name.
Which words are drawn is one constant (`DRAWN_RELATIONS`), so trying `why` or `e.g.` later, or
dropping `so`, is a one-line change and no new model call.

```
 prose                                         │ margin
 The cost of the method falls with scale.      │
                                               │
 Larger labs therefore moved first …           │ SO      ← beside the paragraph it labels
                                               │
 The smaller labs had one advantage …          │ BUT
                                               │ ▸ FAQ  Why didn't small labs …
```

The word sits first in the block's note, above the question, stamps and shut lines, because it is
about the paragraph's opening, and it is the shortest thing there. It is a button with a card of
its own, like the question and the idea stamp, so a keyboard or a finger can ask what "vs" means.

### The step

One model call per article, the shape of `faq`/`arc`:

- **Input**: the article as every whole-article step sends it (the shared `ids` renderer and cached
  prefix, with the shared `paperwork(...)` instruction), and the ids of the paragraphs to label:
  body text blocks of at least a sentence (`isBodyEvidence`, the floor the questions use), **all
  but the first**, which has no paragraph before it. "The one before" is the previous paragraph in
  that list.
- **Output**: JSON schema `{ relations: [{ blockId, relation }] }`, `relation` from the closed list
  of ten above. No prose comes back, so no plain-words rule applies: the file goes in
  `PLAIN_WORDS_EXEMPT` with that reason.
- **Validation** (deterministic): the model must answer every listed paragraph once. Unknown ids,
  repeats (first wins) and words outside the list are dropped and counted; paragraphs it left out
  are counted as `missing`. **A run that answers fewer than half the list fails** rather than
  storing a sparse artefact that looks like a quiet article (Sol P1-5). A paragraph after a heading
  is labelled like any other: "but" across a section break still means something.
- **Artefact**: `{ version, generator, slug, sourceHash, relations: Record<BlockId, Relation>,
  generatedAt, elapsedMs }` in a new `article_revisions.relations` `jsonb` column (each artefact has
  its own column; there is no generic table — tests/store-artefact-manifest.test.ts), and
  `relations` added to the `revision_step_runs_step` CHECK. **An additive migration**, written by
  copying `drizzle/20260916150539_faq.sql`; applied locally here, to production by the Overseer's
  deploy.
- **Freshness**: FAQ's fingerprint exactly (`articleWithIdsFingerprint`: blocks, tree and the
  metadata head, every byte the prompt is built from; no profile, because who reads does not change
  how one paragraph follows another); `PROMPT_VERSION` `relations/1`.
- **Model**: the `capable` tier, as every whole-article step. One call; the answer is ~10 tokens per
  paragraph, so the cost is almost all input, and that input is the cached article prefix other
  steps already write. *Quick* is the cheaper option and a fair later measurement, not a v1 guess.
- Every registry `mode.md § The artefact` names — `StepName`, `STEP_ORDER`, `STEPS`,
  `FORCE_ONLY_WHEN_NAMED`, `ARTICLE_OUTPUT_FORMAT`, `STEP_BUDGET_MS`, the `models.ts` rows,
  `JOB_DISPOSITION`, `ArtifactKind`/`SHAPE`/`STAMP_SOURCE`, the pg reader and `loadRelations`,
  `REVISION_CARRY_POLICY`, `GET /api/relations/:slug` (and its prefix in `CACHEABLE`,
  src/web/lib/api.ts), export, and the sharing/reset/rerun rows.
- **Owner only in v1.** A visitor's payload carries no staleness verdict, the artefact is carried
  across revisions, and a relation word has no quote to check against its block, so an old *BUT*
  could sit beside a rewritten paragraph (Sol P1-4). Not in the public projection until that
  payload can say an artefact is stale.

### When it runs

**On the owner's press that turns Marginalia on**, and never on a mount. Marginalia's row in
`MODE_TARGET` (src/web/activation.ts) becomes `{ kind: "fixed", target: "relations" }`, the same
first-class mechanism every self-starting mode uses, rather than a raw `armActivation` bolted on
(Sol P1-1): the bar arms it, `ModeBoundary` retires the token if the column fails to render, and
`modeGenerates` tells the command bar it generates. `OwnerMarginFeed` runs `useAutoRun(slug,
"relations", …)` beside its read: one attempt per article per session, a pasted `?margin=1` link
spends nothing, a visitor never starts anything. **The press that turns the column off arms
nothing** (the feed is still mounted for that instant and would claim it). A stale or outdated
artefact counts as "nothing there", so the next press rewrites it; the unforced run is what the
pipeline's own stamp check decides.

This is Greg's *"when I run it, perhaps it should first trigger …"* applied to the margin's **own**
data, which is different from running other modes (still declined: their bands are where they are
made).

While it runs, nothing in the column says so — the words simply appear when the job's completion is
announced (`useStepFinished`), like a FAQ made in the band. A failure is silent in the column too;
the job is visible in the jobs tray like any other. *Rejected alternative:* a "Reading how the
paragraphs connect…" line under the head. It is one more thing in a column whose risk is too much;
add it if the gap proves confusing.

## The simpler options passed over

- **No model: the author's own connective.** Read "However," / "So," / "For example," off the
  paragraph's first words, deterministically, with no step and no migration. Passed over because
  the paragraphs whose opening word *says* the turn are exactly the ones that need no help; the
  value is the implicit turns, and those need a reader. It would also make the margin repeat the
  prose's first word.
- **Fold the words into an existing call** (the structure step, which already writes each part's
  question). Passed over: it changes the most important prompt in the app and invalidates every
  article's tree cache to add a decoration, and it crosses stage ownership.

## Done when

- Stage 1: on an owner's article with a timeline, dated events show as shut *When* lines beside
  the passage that dates them; untimed ones do not; a visitor of a public article sees the same,
  as they see the same events in the band. Unit tests red first, then green.
- Stage 2: pressing Marginalia on an article with no relations starts one `relations` job; when it
  finishes the words appear without reopening; reopening does not start a second; a visitor issues
  no POST (tests/visitor-gaps, public-network-trace stay green); `npm test`, `npm run typecheck`
  green; a browser check on the box (Sonnet subagent, Playwright) with screenshots read by me.
- GPT Sol has reviewed this plan before building and the code before pushing.

## GPT Sol's plan review, 2026-10-03

[The review](261003f-marginalia-plan-review-sol.md); no P0. Each finding checked against the code:

| # | Finding | Taken? |
|---|---|---|
| P1-1 | a raw `armActivation` has no boundary retirement and no disclosure | **Yes**: Marginalia gets a real `MODE_TARGET` row; the off-press arms nothing |
| P1-2 | earliest mention may be undated | **Yes**: placed at the dating passage |
| P1-3 | label is the model's; a lone "12 May" loses its year | **Yes** to both |
| P1-4 | a visitor can get stale relations, and a stale publication year on Timeline | **Relations: yes**, owner only. **Timeline: not here.** The band already shows a visitor the same events with the same year; hiding them in the margin alone fixes nothing. A staleness verdict in the public payload is its own piece of work |
| P1-5 | a three-row answer would be a successful artefact | **Yes**: every listed paragraph, the first excluded, under half fails |
| P1-6 | fingerprint narrower than the prompt | **Yes**: FAQ's fingerprint and `paperwork` |
| P2-7 | `CACHEABLE`; copy the latest CHECK, not FAQ's | **Yes** |
| P2-8 | 43 of 108 is dense; draw `but` and `vs` only | **Partly**: `why` and `e.g.` dropped; `so` kept because Greg named it |
| P2-9 | the diagram was off by one; the word must be focusable | **Yes** |
