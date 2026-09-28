# Trajectory mode — skim a paper at increasing depth

The vision, with Greg's dictated brief verbatim, his two answers, and the Questions for Greg, is
[trajectory.md](../project/trajectory.md). This is the build. It is run unattended by a session the
Overseer started on 2026-09-28. Greg approved the build and said he cannot answer questions, so every
product call below is a default, recorded in trajectory.md § Questions for Greg. The exceptions are
the two he did answer mid-run: the mode stays behind the experimental switch, and v2 is the
scrapbook.

**Revised after review.** The first draft (commit `fb96e2ad`) stored a new selection of block ranges
over the whole article. GPT Sol's plan review ([review](260928a-trajectory-mode-plan-review-sol.md),
verdict *rethink*) showed that this is a second set of highlights, which is exactly what Greg asked
us not to make. It also showed that three of the draft's four arguments against building on Quotes
were false in the code. An Opus arbiter, asked to decide between the two designs, chose the
quote-backed route. The ledger is at the foot of this plan.

## What v1 is

**A route through the article's Quotes, walked at three depths.** The stops are the quotes that
already exist: the lines Quotes mode chose, checked and marked in the prose. What is new is one
small model call that **orders** them into a route and gives each one a **depth**. Greg's words:
*"maybe it's a trajectory through quotes so that we don't have multiple metadata annotations … one
reusable set of highlights"*.

```
  TRAJECTORY — same spine, same article; the band walks a route through the quotes

 ┌───────────┬──────────────────────────────────────┬──────────────────────────────┐
 │ spine     │  ‹  Stop 2 of 5  ›   Gist · More · Most │  … and the effect held in    │
 │  ▇▇▇▇     │                        5     12    28   │  all four cohorts (Table 2), │
 │  ▇▇       │  1  Results › Main finding             │ ┃the first time it has been  │
 │  ▇▇▇▇▇▇   │▶ 2  Results › Robustness               │ ┃shown outside the lab …     │
 │  ▇▇▇      │     Whether the result holds elsewhere │                  Next stop › │
 │  ▇▇▇▇     │  3  Methods › Design                   │                              │
 │           │  4  Introduction › The gap             │  (the stop's block is marked │
 │           │  5  Discussion › Limits                │   and scrolled near the top) │
 └───────────┴──────────────────────────────────────┴──────────────────────────────┘
      ← / → step the stops while Trajectory is open;  ↑ / ↓ stay the article's
```

### The step (server)

- **A pipeline step, `trajectory`, whose input is another step's artefact.** It reads the stored
  Quotes, the hierarchy tree and the reader's profile. It **never reads the article's prose**; its
  prompt holds only the quotes, so the call is small. It refuses if there are no Quotes, the way
  `illustrated` refuses without a Sketch. The client asks for both in one job when Quotes are
  missing (`precededBy: ["quotes"]`, the same mechanism Illustrated uses for Sketch,
  `useIllustrated.ts`). Off `DEFAULT_INGEST_STEPS`. In `FORCE_ONLY_WHEN_NAMED`. After `quotes` in
  `STEP_ORDER`. In no cache group, because its bytes match no other stage's.
- **The prompt's input**, one entry per quote: the quote id; the quote text (the article's own words,
  up to 1,200 characters); the **section path** of its block, as titles from the tree (e.g.
  *Results › Robustness*); and its Quotes priority. The route is a **judgment about what each
  passage does** — results first, then a quick tour of the methods, varying by paper. That is why
  there is a call at all: ordering by priority would give importance order, not a route.
- **Profiled**, as Ideas and Quotes are. `profileSection(profile)` carries the reader's *About you*
  and the article's *Why you're reading this one*. `PROFILE_RULES` goes in the system prompt. With no
  profile, the default reader is "reading this for the first time, and wants the main point first".
- **The answer** is an ordered list of `{ quote, depth: 1|2|3, role }`. `role` is at most 80
  characters and **names what the passage does, never what it found**: *"The headline result"*,
  *"How they measured it"*, *"What earlier work missed"*. No numbers, no findings, no verdicts. It
  may be a question the passage answers (*"Does it hold outside the lab?"*). It follows the prompt
  rule in [new-mode.md § The words the mode puts in front of the reader](../project/new-mode.md#the-words-the-mode-puts-in-front-of-the-reader)
  and the shared plain-words guide, if that has landed on `dev` by stage 1
  (`docs/project/prompting-guide.md`, from the fb44 session).
- **What is stored**:

  ```ts
  interface TrajectoryStop {
    quoteId: string;     // an id in the Quotes artefact; the stop's passage is that quote's block
    depth: 1 | 2 | 3;    // the shallowest pass this stop belongs to
    role: string | null; // ≤ 80 chars; null if the model's was invalid (F8: never drop a stop for it)
  }
  interface Trajectory { stops: TrajectoryStop[]; quotesHash: string; /* counts + stamp as FAQ */ }
  ```

  **The array order is the route. Depth *d* shows every stop with `depth ≤ d`, in array order.**
  So the passes nest by construction, which is Greg's *"go round again, but this time in a bit more
  detail"*, and there is one list, not three that could disagree. **No block ids are stored
  here.** A stop addresses its passage through the quote, and the quote holds the block id
  ([block-ids.md](../project/block-ids.md)).
- **Validation.** The model's ids are never trusted.
  - A stop naming a quote id that is not in the artefact is dropped.
  - A quote named twice keeps its **shallowest** occurrence (F8).
  - Two stops on the same block keep the shallowest, then the earlier (F8). Otherwise two stops
    would mark one paragraph.
  - A `depth` outside 1–3 is malformed, and that stop is dropped.
  - A `role` that is over 80 characters, empty, or not a string becomes `null`, and the stop is kept
    (F8).
  - Caps apply to the **cumulative** visible counts: 7 at depth ≤ 1, 15 at ≤ 2, 36 at ≤ 3 (F8).
    Over a cap, the excess stops are **dropped**, in route order. They are never demoted, and nothing
    is ever relabelled (F2, F8).
  - **The passes must grow (F2).** With at least 8 usable quotes, the counts after validation must
    satisfy `1 ≤ c₁ < c₂ < c₃`. With fewer, a shorter spiral is allowed: `c₁ ≥ 1` and the counts
    never shrink, and the band shows only the depths that add something. An answer that breaks this
    **fails the job** and writes nothing, with the counts in the message. There is no automatic
    retry in v1; the reader can press re-run.
  - Counts go on the artefact (`unknownQuote`, `duplicate`, `sameBlock`, `malformed`, `badRole`,
    `overCap`) and are logged.
  - Empty outcomes: no `stops` array fails the job; a list that validation empties fails the job.
- **Targets given to the prompt**, from *q*, the number of quotes: depth 1 ≈ `min(5, ⌈q/5⌉)`,
  depth ≤ 2 ≈ `min(12, ⌈q/2⌉)`, and depth ≤ 3 is every quote worth a stop (≤ 36). The prompt says
  depth 3 should normally include nearly all the quotes. These are hypotheses to measure (F10), not
  product constants.
- **Freshness, stamped.** The stamp holds `PROMPT_VERSION`, `quotesHash` (a hash of the quote ids,
  block ids, offered text and priority), and `profileHash`. The route is outdated when:
  - the Quotes set has changed (*Find more* added quotes, or Quotes was regenerated) — the band says
    how many quotes are not on the route, and offers a rebuild;
  - the prompt version has moved on;
  - **the profile is different, including none → some (F7).** This differs on purpose from the
    shared `profileIsStale`, which treats an unprofiled artefact as never stale: a route is exactly
    the thing a profile is meant to change, and rebuilding it costs little. The step's own comparison
    says why.

  Quotes carry their own profile stamp, and the route does not inherit it. Quotes' own panel already
  says when *they* were written for another profile.
- **The model and the stream.** Capable tier, **low effort**: the input is small and the job is
  judgment, not reading. The call streams like FAQ's, with character progress through the job. The
  route becomes usable when validation passes; that is the same shortfall FAQ and Ideas have. It
  comes after a call measured in seconds, and only after Quotes' own call when Quotes had to be
  bought first. Sol's F6 is taken as far as that; incremental stop records are deferred and named in
  trajectory.md's Questions.
- **Billing** — the same job route as every step, so the existing per-account limits apply. The
  model call goes through the AI gateway ([ai-gateway.md](../project/ai-gateway.md)). A cost
  category is added.
- **A re-run replaces the route.** It holds only quote ids, so it needs no ids of its own.

### The mode (client)

- **Band** (`TrajectoryPanel` in `ModeSurface`). The head row has two controls:
  - `‹ Stop k of N ›`;
  - the depth control, three segmented buttons **Gist · More · Most**, each with its stop count.
    It is segmented rather than a slider because there are exactly three positions, and three
    buttons are easier to hit on an iPad. Sol and Opus both agreed.

  **The head stays pinned** while the list scrolls (Most can be around 30 rows).

  The body lists the stops at the current depth, numbered, each with its **section path read from
  the tree** at render time. Only the **current** row shows its `role` in full; the others show the
  section path. This keeps depth 3 from turning into thirty generated lines that could be read
  instead of the paper. Stops from a shallower pass are drawn dimmed, as already seen. Pressing a
  row goes to that stop.

  The foot is one sentence: the passages are the article's own words, chosen by Quotes; the order
  and the roles are the model's reading, shaped by your profile if you gave one. When the depth
  control is at Most, the foot also says *"every one of the article's N quotes"*, or *"M of N"*.
- **Prose.** The current stop's block is the mode's `Found` passage, with the key being the quote's
  id. The ring, the paragraph bar and the rail mark it, using the machinery every passage-marking
  mode uses. The quote stroke is already drawn in every mode.
  - A resolver goes in `search-hits.ts`, and a Trajectory slot in `PassageSlots`, with its reset
    lifecycle (F9).
  - **Stepping always scrolls**, and puts the stop's block near the **top** of the view, not in the
    centre. A non-linear step is arriving somewhere new.
  - No wrap at either end.
- **A "Next stop ›" door in the prose**, after the current stop's block. It is there because on an
  iPad the reader's eyes and thumb are in the prose after reading a stop, and on a narrow window the
  band covers the prose altogether (F4). At the last stop of a pass, it offers *"Go round again —
  More ›"*. Stage 2 finds the existing per-block decoration path to hang it on. It does not invent
  a second one.
- **Narrow windows (F4).** On a narrow window the band covers the prose. When the reader chooses a
  stop there, the band gets out of the way, using the narrow-window mechanism
  ([narrow-windows.md](../project/narrow-windows.md)), and the in-prose door carries the stepping.
  The browser check covers about 420px as well as iPad and desktop widths.
- **Changing depth keeps your place, and "go round again" starts again.** A pure function, tested:
  - **Depth up**, when you are on the **last stop of the current pass**: go to the first stop that is
    new at the new depth. That is going round again.
  - **Depth up** otherwise: stay on the current stop.
  - **Depth down**: stay on the current stop if the shallower pass has it. Otherwise go to the
    nearest earlier stop that it has, or to its first stop if none comes earlier.
- **Keys (F5).** While Trajectory is open, ← / → step the stops. `useArrowNav` in `keynav.ts` takes
  an optional horizontal handler, and the Reader passes Trajectory's controller through it. The
  existing guards stay: no modifiers, not while typing, `defaultPrevented`, no auto-repeat. Stride
  keeps ← / → in every other mode. ↑ / ↓ are untouched. keyboard.md records the exception, which is
  the direction its § on mode-specific keys already points.
- **URL (F9)**: `?mode=trajectory&depth=2&stop=<quoteId>`, through `params.ts`. Check the existing
  names first, and rename if either is taken.
  - Changing depth **pushes** a history entry. Stepping **replaces** the current one.
  - A depth change and the stop that follows from it are written in **one** update.
  - A stale `stop` falls back to the first stop.
  - url-state.md is updated.
- **Opening it starts it** (`useAutoRun`, unforced). It asks for `trajectory`, with `quotes` first if
  there are no Quotes. The job's progress shows which of the two is running.
- **Behind the experimental switch** (Greg, 2026-09-28). **Owner-only**: a visitor gets the
  explanatory band, as with FAQ.
- The card's two sentences, per [new-mode.md § The card on the button](../project/new-mode.md#the-card-on-the-button).
  The `how` half: it reads the article's Quotes, and a small model pass puts them in order. When
  there are no Quotes yet, it makes them first.

## The versions not built, and why

- **A — a new selection of passages from the whole article** (the first draft). It is a second set
  of highlights, whatever it leaves out (Sol F1). Its one advantage is coverage: it could stop at a
  methods paragraph that has no quotable line.
- **Zero-call — order the quotes by their Quotes priority.** It is free, and it would test the
  interaction. But priority gives importance order, not the route Greg described (*"start with the
  results … then a quick tour through the methods … it might vary from paper to paper"*), and it
  cannot take account of why this reader is reading. It is kept as a fallback if the ordering call
  proves worse than priority.
- **Stops as hierarchy nodes.** Leaves are single paragraphs, which a quote's block already is.
  Sections are too coarse to skim.
- **The risk this choice carries — coverage.** Quotes are chosen for being worth keeping, and a
  methods paragraph is rarely quotable. If the real runs show whole sections with no quote, the fix
  is Quotes' prompt ("cover every major section"). That improves the one shared set instead of
  starting a second, and it is a change to another mode's prompt, so it gets its own
  `PROMPT_VERSION` bump and a line in quotes.md. Stage 1 measures this before deciding.

## Stages

0. **Vision doc and plan.** Plan reviewed by Sol and an Opus arbiter, and revised. Commit.
1. **The step (server).** Follow FAQ's stage-1 commit `b31d8b87` for the file list, `illustrated`
   for a step that reads another step's artefact and refuses without it, and Ideas/Quotes for the
   profile. The work:
   - types, `ArtifactKind` and `StepName`, and every total
     ([new-mode.md § The artefact](../project/new-mode.md#the-artefact-if-the-mode-shows-one));
   - the migration: the column, plus the step-name CHECK and `tests/db-step-constraint.test.ts`;
   - `src/trajectory.ts`: the prompt, the parse, the validation, the targets and `PROMPT_VERSION`;
   - the GET route with its outdated sentence, `CACHEABLE`, export, and the cost category.

   Tests go **red first**, for every validation rule above, the growth rule (F2), each of the
   freshness inputs including none → profile (F7), and the refusal without Quotes.

   **Real runs** on at least three local articles — a short essay, a normal paper, and a long
   sectioned paper (F10). For each, record in Progress:
   - the route at each depth;
   - the number of quotes per top-level section (the coverage risk);
   - words and percentage of body text at each depth;
   - the cost and the latency of the call;
   - a judgment: does Gist alone give the gist, and does the route start somewhere sensible?

   Then a GPT Sol code review (write-capable), the gates, and a commit.
2. **The mode (client).** Follow FAQ's stage-2 commit `0e947eb4`. The work:
   - `MODES` and every client total, plus the tests that go red without a type error;
   - `useTrajectory`, with the `precededBy` auto-run;
   - `TrajectoryPanel`;
   - the pure step and depth functions, with tests;
   - the resolver and the `PassageSlots` slot;
   - the in-prose door;
   - the narrow-window behaviour;
   - `useArrowNav`'s horizontal handler, with a test;
   - params and the history semantics;
   - `experimental: true` and `BEHIND_THE_SWITCH`;
   - the card;
   - the docs: the row in experimental-features.md, keyboard.md, url-state.md, and trajectory.md
     updated to what shipped.

   Then a browser check in a Sonnet subagent (Playwright on the box) at 420px, iPad and desktop
   widths, on a real local article. Then a GPT Sol code review, the gates, and a commit.
3. **v2 — the scrapbook** (Greg: *"the thing I'm most excited to experiment with"*). Beside each stop,
   whatever other modes have **already** produced that touches its passage or section, gathered by
   block id: glossary terms it uses, ideas whose passages include it, the section's gist, timeline
   events, citations, FAQ questions it answers, the quote's own reason. It starts no new runs by
   default. Greg encourages **experiment** — new UI, and short generated snippets that tie the
   pieces together — so this stage starts with **two or three spikes of different shapes**,
   screenshotted on a real article. The plan for the stage is written here, with the evidence,
   before it is built. Then a Sol plan review, the build, a browser check, a Sol code review, and a
   commit.
4. **Full suite, push, clean up.** The full suite through `scripts/tmux-job.ts`, push to `dev`,
   `npm run worktree:check`, and remove the worktree.

## Stage 3 in detail — the scrapbook (written after the spikes, 2026-09-28)

**The spikes.** Three static mockups were built on real data from the entropy paper:

- glossary, ideas, timeline and FAQ were generated first, for $0.35;
- each stop was then gathered from every artefact that touches its paragraph or its section;
- each shape was screenshotted at desktop and iPad widths.

The shapes, with a screenshot of each:

- **A. The stop card** ([screenshot](260928a-trajectory-scrapbook-spike-stop-card.png)) — under the
  current row: terms it uses, ideas, the FAQ question it answers, where it sits in the study, the
  section's gist, and the quote's reason.
  - The term chips and the FAQ question earned their place.
  - The **section gist** often gave away the finding (*"account for the vast majority of
    network-wide synergy"*). It is the one piece that reads as a summary standing in for the
    paper.
  - The quote's *why this line* mostly repeated the role.
- **B. The skim sheet** ([screenshot](260928a-trajectory-scrapbook-spike-skim-sheet.png)) — one
  page per depth, one card per stop.
  - It feels most like a scrapbook.
  - It is also the most readable *replacement* for the paper: More is 643 of 8,580 words.
  - And this route ran almost in paper order, so the reordering hardly showed.
- **C. Threaded** ([screenshot](260928a-trajectory-scrapbook-spike-threaded.png)) — A plus **one
  short generated line per stop**. The line says how this stop follows the one before, and points at
  a term or at what to notice, never at what the passage found. For example: *"From the definition
  to real recordings. The first place the paper looks for synergy is its network's rich club —
  note the number."* It did the most to tie the disparate pieces together, which is what Greg asked
  for, and the next stop's line shown under **Next stop ›** read as a door.

**What stage 3 builds: C, with A trimmed.**

1. **A thread line replaces the role line**, written by the same trajectory call. There is no
   second call and no second artefact: the call already sees every quote's words and section, and
   the line needs nothing else.
   - **Per stop per depth.** The previous stop differs by depth, so a stop visible at
     depths 1–3 has up to three lines. Stored as `thread: { "1"?: string, "2"?: string, "3"?:
     string }`, where each key is a depth at which the stop is visible. A missing or invalid line is
     simply absent, and the stop is kept (F8's rule).
   - **Cap: 160 characters.** It follows the same plain-words rule, and never states a finding,
     number or verdict — pointing at one ("note the number") is fine.
   - **Cost:** an estimated +~1k output tokens, about +$0.01 on a ~$0.02 call. `PROMPT_VERSION`
     is bumped, so existing routes show as outdated and offer a rebuild.
   - `role` stays readable in the type for routes written before, and the band falls back to it,
     but the prompt no longer asks for it.
2. **The band.** The current row shows the thread line for the current depth. Under **Next stop ›**
   in the prose, the next stop's line appears in small italics, so the door says where it leads.
3. **The stop card**, under the current row, gathered on the client from what **already exists**:
   - **Terms it uses.** A chip per glossary term that appears in the stop's paragraph; a tap opens
     its one-line sense and a link into Glossary.
     - Found the way the Glossary mode finds its underlines in the prose, **not** from the stored
       per-term block list, which the spike showed misses word forms.
     - A term met at an earlier stop of the current pass is marked *"met at stop k"*. There is **no
       "new" marker**: absence of a match is not evidence, and a wrong "new" is worse than none.
   - **Ideas** whose passages include the paragraph — name only, as a link into Ideas.
   - **The FAQ question** this paragraph answers, if any — as a link into FAQ.
   - **Where it sits in the study**, from Timeline — events whose passages are in this paragraph.
   - **Not shown:** the section gist (the summary risk) and the quote's reason (a repeat).
   - **Every cluster is shown only if its artefact exists and has something for this paragraph.**
     Nothing here starts a run, and nothing is fetched that the reading view does not already know
     how to fetch. When nothing is there, there is no card — and no "generate the glossary to see
     terms" nag either; that is a Question for Greg.
4. **Not built in stage 3**: the skim sheet (B), kept as a later toggle on the same data; the
   gist; the word-form fix in the glossary's stored block lists (Glossary's own business, and not
   needed because the card uses the prose matcher).

**Done when:**

- tests are red first for the thread-line validation and for the card's gathering (a pure function
  from the artefacts plus a block id to the clusters);
- a real run confirms the lines follow the rule;
- a browser check has been run at the same widths;
- Sol has reviewed it.

### Revised after GPT Sol's stage-3 plan review ([review](260928a-trajectory-mode-stage3-plan-review-sol.md), *approve with changes*)

All eight findings were taken. **This section overrides items 1–3 above wherever they differ.**

- **F18 — the relational thread is not built; a context-free cue is.** One stop at one depth can
  be reached from several places: a deep link, "go round again", a row press, or Back. So a line
  that says how the stop follows "the previous one" is false half the time. Instead, each stop gets
  one **`cue`**: at most 140 characters, imperative or a question, naming what to look for in this
  passage, and never what it found. For example: *"Look for how rich-club membership changes the
  comparison."* It replaces `role` in the prompt. The field is new, so old routes (with `role`,
  and outdated by the `PROMPT_VERSION` bump) still draw. The relational version is recorded in
  trajectory.md as tried in the spike and deferred; it would need a line per `{from, to}` edge,
  shown only when that edge is the reader's actual step.
- **F21 — the cue is a route cue, not a synthesis of the scrapbook.** The call never sees the
  glossary, ideas, FAQ or timeline, and it must not: that would braid their freshness and their
  generation into the route's. The tying-together is done by **juxtaposition** on the card —
  and by the next stop's cue under **Next stop ›**.
- **F25 — cue validation, spelled out.**
  - A non-string, empty or over-cap cue becomes `null`, and the stop is kept. It is counted as
    `badCue`, a new counter that defaults to 0 for old artefacts.
  - `role` is no longer asked for. A new answer's missing role is `null`, and it is **not**
    counted as `badRole`.
  - `ANSWER_TOKENS` is recomputed from the cue cap, and the largest permitted answer is tested.
- **F19** — a card cluster whose artefact is `stale` is **not shown**. An `outdated` one (the
  article unchanged, an older prompt) is shown.
- **F20** — the marker reads **"also at stop k"**, never "met". The client does not know what the
  reader has read.
- **F22** — **read-only hooks**: `useIdeasRead`, `useFaqRead` and `useTimelineRead` are split out
  of their mode hooks, following `useGlossaryRead`. The card uses only those, so "nothing here
  starts a run" is structural rather than an accident of activation. The mode hooks layer their jobs
  on the read hooks, and behave exactly as before.
- **F23** — terms are found by scanning `renderedText(block.html)` with `formsOf`/`termPattern`/
  `termAppears` from `src/term-match.ts` over **every** glossary entry, not restricted to
  `entry.blocks`. Tests cover inflection, alias, plural, possessive and a Unicode boundary.
- **F24** — the FAQ question is shown as text, with no `?question=` param. The planned passage jump
  was removed in code review 3: matching is by the current stop's block, so it could only jump to
  the paragraph the reader is already on.
- Card links follow the target mode's experimental-control rule. In particular, a Timeline event
  remains useful scrapbook text while Timeline is hidden, but it is not a control into that mode.

## Review ledger — GPT Sol on the plan, 2026-09-28 (read-only; verdict *rethink*)

| ID | Sev | Finding | Outcome |
|---|---|---|---|
| F1 | P1 | A is a second highlight set; the case against B was false in the code | **accepted** — Opus arbitrated for the quote-backed route (D); the plan was rewritten |
| F2 | P1 | the validator does not guarantee three growing depths | accepted — the growth rule; fail rather than relabel |
| F3 | P1 | multi-block stops do not fit `Found` | accepted — moot under D: a stop is one quote's block |
| F4 | P1 | on a narrow window the band hides the prose | accepted — the in-prose door, the band gets out of the way, and a 420px check |
| F5 | P1 | ← / → need an explicit state seam | accepted — `useArrowNav` takes a horizontal handler |
| F6 | P1 | not streamed | partly — the call streams its progress and is small; incremental stops are deferred and named in Questions |
| F7 | P1 | none → profile does not stale the route | accepted — Trajectory's own stricter rule |
| F8 | P2 | the repairs change the model's route | accepted — shallowest first, cumulative caps, a bad role does not drop a stop, no relabelling |
| F9 | P2 | resolver, `PassageSlots`, history semantics | accepted — named stage-2 tasks |
| F10 | P2 | counts are not reading time | accepted — words and percentage per depth, over three articles |

The Opus second opinion (first round) also gave:

- the role line names what the passage does, never what it found, in at most 80 characters, shown in
  full only on the current row;
- depth up from the end of a pass goes round again;
- the in-prose door;
- scroll to near the top;
- a pinned head;
- the labels *Gist · More · Most*.

## Progress

- 2026-09-28 — plan and vision doc written (`fb96e2ad`); worktree `trajectory-mode`.
- 2026-09-28 — Greg answered two questions through the Overseer: the experimental switch, and v2 is
  the scrapbook, now a firm stage. Recorded in trajectory.md § Decided.
- 2026-09-28 — Sol's plan review said *rethink*. The Opus arbiter chose the quote-backed route. The
  plan was rewritten as above.
- 2026-09-28 — **stage 1 built** by an Opus implementer, committed as `868ae017` and pushed to `dev`
  (migration `20260928012645_trajectory`).
  - **Deviations from the plan:**
    - the model is shown `Q1…Qn` labels rather than quote ids, because it mangled the ids
      (`trajectory/3`);
    - the quotes hash is stored as `sourceHash`, which is the name `stampOf` reads;
    - the profile rule is stale in both directions (none → some, and some → none).
  - **Real runs** on three articles:
    [stage1-real-runs](260928a-trajectory-mode-stage1-real-runs.md). The call took 4–12 s and cost
    $0.009–0.021. Every route started somewhere sensible, and **coverage is the real risk**, as
    predicted: Most reaches 19–32% of a paper's words, and one paper's biggest section has 4
    quotes. Quotes' prompt is **not** changed in this build — that is Questions for Greg.
- 2026-09-28 — **GPT Sol code review 1**
  ([prompt](260928a-trajectory-mode-code-review-1-prompt.md),
  [answer](260928a-trajectory-mode-code-review-1-sol.md)). Verdict: accept with fixes. It fixed
  three things in-stage, committed as `669deefe`:
  - **F11**: one quote per paragraph is offered, by highest priority (`trajectory/4`);
  - **F12**: quote records are fenced as untrusted data;
  - **F13**: the quotes hash covers the offered words and priority.

  F14 (five test tables missing `trajectory`) was the stage-2 work still in progress.
- 2026-09-28 — **stage 2 built** by an Opus implementer and committed as `64595ca9`. The typecheck
  exited 0, and the 30 scoped files passed (819 tests).
  - **The door**: it rides the existing `PdfFigureNotes` after-block slot in `TableView`.
  - **Narrow windows**: there was no existing way for the band to step aside, so the smallest one
    was added — a `band-away` flag beside `band-covers`. The band stays mounted.
  - **Keys**: `useArrowNav` takes an optional horizontal handler.
  - **Deviations from the plan:**
    - the icon is lucide `Route`;
    - pressing a row is a jump, which pushes a history entry — only steps replace one;
    - `sectionPath` is a **client copy** of the server's `sectionPathOf`, pinned by a test, because
      `src/trajectory.ts` imports `node:crypto`. That copy is to be removed in review.
- 2026-09-28 — **browser check** (Sonnet, Playwright) at 1440, 1024×1366, 820×1180 and 420 on the
  entropy paper. Items 2–8 passed: the pinned head; stepping, marking and scroll-to-top; depth-up
  going round again; Back undoing a depth change; the door; the keys; the band stepping aside at 420
  with a way back.
  - Tap targets are 36px, the house control height.
  - The one "fail" is a deep link opening the mode with the switch off. That is documented policy
    (experimental-features.md: hidden from the controls, not unreachable), not a bug.
- 2026-09-28 — **full suite** after `64595ca9`: 6 of 1,160 files red.
  - Four are environment: no API or fleet build in a fresh worktree.
  - One was ours: `last-view.test.ts`. The `depth` and `stop` params had no policy row, and the
    test's scanner misread a one-line `useQueryStates`.
- 2026-09-28 — **GPT Sol code review 2**
  ([prompt](260928a-trajectory-mode-code-review-2-prompt.md),
  [answer](260928a-trajectory-mode-code-review-2-sol.md)). Verdict: accept after fixes. It fixed:
  - **F15**: `sectionPathOf` is one pure module, `src/section-path.ts`, and the client copy is gone;
  - **F16**: a repeated section path is drawn as a muted `〃`, with the full path kept for screen
    readers;
  - **F17**: `depth` and `stop` are remembered by last-view, and the scanner-readable
    `useQueryStates`.

  No other P0/P1 findings: the door is owner- and Trajectory-only, and `bandAway` recovers across
  resizing and mode changes. Gates re-run here afterwards: typecheck clean apart from the
  uncommitted `spikes/` scripts, and 8 files / 185 tests passed.
- 2026-09-28 — **scrapbook spikes**: three static mockups on the entropy paper's real data. The
  glossary, ideas, timeline and FAQ were generated first, for $0.35. Shape C (threaded) plus a
  trimmed A was chosen; see § Stage 3 in detail. **GPT Sol's stage-3 plan review**: approve with
  changes, F18–F25, all taken — the relational thread was replaced by a context-free cue.
- 2026-09-28 — **stage 3 built** by an Opus implementer and committed as `eeb16ed7`:
  - the cue (`trajectory/5`);
  - read-only `useIdeasRead` / `useFaqRead` / `useTimelineRead`;
  - `src/web/stop-card.ts`;
  - the card under the current row, and the next stop's cue under the door.

  **The real model run of `trajectory/5` could not be made**: the box's OpenRouter key hit its $100
  per-key cap (402 `[ai-no-credit]`). That was reported to the Overseer for Greg, and the cue prompt
  is unmeasured until then. The **browser check** (Sonnet, Playwright, at 1440, 820 and 420) passed
  every item:
  - only non-empty clusters are drawn;
  - the links land on the right item, and Back returns to the stop;
  - "also at stop k" is correct;
  - only GETs are made for the four artefacts — no job POSTs.
- 2026-09-28 — **GPT Sol code review 3**
  ([prompt](260928a-trajectory-mode-code-review-3-prompt.md),
  [answer](260928a-trajectory-mode-code-review-3-sol.md)). Verdict: accept. It fixed:
  - **F26**: the FAQ question's no-op passage jump was removed;
  - **F27**: Timeline links follow that mode's experimental rule and fall back to text.

  A worst case of 24 terms × 30 stops gathers in about 2 ms. Gates re-run here afterwards:
  typecheck 0, and 6 files / 97 tests passed.
- 2026-09-28 — credit was restored, so the held-back **real runs of `trajectory/5`** were made on
  the entropy paper ($0.023, 10.5 s) and the essay ($0.011, 5.2 s). There were 0 bad cues, and none
  of the 30 states a finding (one presupposes one). The cues are monotonous: 26 of 30 start
  *"Look for"*. Details in [stage1-real-runs](260928a-trajectory-mode-stage1-real-runs.md) § Stage 3.
- 2026-09-28 — **full suite** on the merged tree after stage 3: 1,170 files passed, and 5 failed,
  all of them the known no-build environment reds (`cold-start-lazy-imports`, `pdf-bundle-trace`
  and three fleet tests needing `build:fleet`). None of the five is ours. Pushed to `dev`. **Done:**
  v1 and v2 are built; what is left is Greg's, in trajectory.md § Questions for Greg.

## Stage 5 — flash, position, order, promotion, regenerate, and the card's sources (2026-09-28)

Asked by Greg on 2026-09-28 after v1 and v2 had landed, relayed by the Overseer. His words,
verbatim, in the order they arrived:

> The Trajectory mode:
> - Should flash-highlight (in the text) the quote/block being jumped to each time (just as I've asked us to do for all block-links, e.g. in Glossary).
> - Provide some kind of subtle visual indication in the left-hand Mode column of how far through the article each suggested block-link is.

> And move Quotes mode and Trajectory mode further towards the left (after Summary). And if I try and run Trajectory mode before Quotes has been run, queue that first.

> And maybe add a 'Regenerate' (or similarly-named) button to Trajectory.

> And take Trajectory and Quotes modes out of Experimental features, i.e. into mainstream features.

> If there are other modes that should also run first as part of generating Trajectory, queue them first too.

> — Greg, 2026-09-28

All of it is client-side: no prompt change, no schema change, no new model call of Trajectory's own.

### 5a. The flash on every arrival

**The flash already exists** — `flashBlock(id)` in [`src/web/flash.ts`](../../src/web/flash.ts),
landed by the block-link work ([260928b](260928b-one-block-link-component-with-a-rich-tooltip-and-a-flash-on-arrival.md)).
It is reused; no second flash is built.

- **A row press** already flashes: it goes through `onJump` → `beginJump`, which flashes when the
  scroll settles.
- **‹ ›, ← →, the Next stop door, going round again, a depth change that moves you** call
  `scrollToBlock` directly and do not flash today. They get `scrollToBlock(block, "smooth", (o) =>
  o === "settled" && flashBlock(block))` — the same "flash when the scroll settles, not before" rule
  `beginJump` follows, so a flash never finishes mid-glide.
- **A deep link on load** (`?mode=trajectory&stop=…`) flashes once the stop's block is in place.
- **A depth change that keeps you on the same stop does not flash** — nothing was jumped to.
- **It does not replace the ring and bar** on the current stop. It is a pulse on arrival, over them.

**This is a deliberate exception to flash.ts's own rule** that stepping does not flash ("stepping
moves one item at a time and a flash on every step is noise"). That rule is about stepping to the
*adjacent* item. A Trajectory step is not adjacent: the route is out of paper order, so each ‹ ›
lands anywhere in the article — a jump, in all but name. Greg asked for it on every step. flash.ts's
header is updated to name the exception and the reason, so the two rules stay one argument.

### 5b. Where each stop sits in the article

Each stop row gets a **thin track with a dot**: the dot at the stop's position in the article,
0–100%. Muted, a few pixels tall, under or beside the section path. It is a hint, not a chart.

- **Measured in words, not blocks**: the position is the words before the stop's block plus half
  its own, over the article's total words (`Block.words`). A block count gives a heading, a caption
  and a 300-word paragraph equal weight, so a paper with many short blocks up front would look
  further through than it reads. Words are what "how far through" means to a reader, and they are
  what the spine's own sizes answer in.
- **Legible at a glance that the route jumps**: because every row has the same track at the same
  width, the dots down the list make a zig-zag when the route goes results → methods → introduction.
- The current row's dot takes the accent; the others are muted. Colours from the tokens
  ([design-css-overview.md](../project/design-css-overview.md)); checked in dark mode and at 420px.
- `aria-hidden`, plus a screen-reader phrase on the row: "about 70% of the way through".
- A pure function, tested: `positionOf(blockId, blocks) → 0..1`.

### 5c. The mode bar order

Quotes, then Trajectory, straight after Summary, in `MODES_UI` ([`Dock.tsx`](../../src/web/Dock.tsx)),
which is where new-mode.md says the order lives. Update any test or doc that lists the order, and the
comments on the Quotes and Trajectory rows that explain their old places.

### 5d. Quotes first — verify, then fix only what fails

trajectory.md says the band asks for Quotes and the route in one job when there are none
(`precededBy: ["quotes"]`). Checked in a real browser on an article with no Quotes, and by reading
three cases that could break it:

1. **No Quotes** — the ordinary case.
2. **A Quotes run already in flight** (started in Quotes mode) when Trajectory is opened.
3. **Stale Quotes** — Quotes exist but the article has changed under them; `noQuotes` is false, so
   the route would be planned on a stale set.

If any fails, opening Trajectory queues the Quotes run and then the route, and the band says what it
is waiting for. The result, and which case it was, go in Progress.

### 5e. A Regenerate button

`useTrajectory.regenerate()` exists and is used only by the outdated banner's "Plan it again". It is
added as a quiet button under a ready route, in the same shape the sibling modes use for theirs —
Ideas' `ideas-again`, Timeline's `tl-again`: `run("Plan it again", true)` in a small row. **It
rebuilds the route only, not the Quotes**: `trajectory` is in `FORCE_ONLY_WHEN_NAMED`, so the force
never sweeps Quotes in, and a reader who wants new Quotes has Quotes' own "Choose them again".
Rebuilding both would buy Quotes' larger call to get a new order, which is not what the button says.

### 5f. Out of Experimental

**Quotes is already out** — since 2026-09-06 (experimental-features.md § Quotes left the table).
Nothing changes for it except its place in the bar.

**Trajectory comes out**: `experimental: false` in `MODE_CATALOG`, its row removed from
experimental-features.md's table with a paragraph saying when and why (Greg's words above), and
`tests/dock-experimental-modes.test.tsx` § `BEHIND_THE_SWITCH` updated
([new-mode.md § Moving a mode in or out](../project/new-mode.md#moving-a-mode-in-or-out-of-the-switch)).

**What the switch gated, and what it did not.** The switch only decides whether the button is drawn.
Owner-only is a separate rule — `POLICY.trajectory` is `owners-only` in
[`visitor.ts`](../../src/web/visitor.ts) — and it stays. So after this:

- **An owner with the switch off** now sees the button, and pressing it starts a paid run (the route,
  and Quotes first if there are none), as Glossary, Ideas and Quotes already do.
- **A visitor** on a shared article or the public shelf sees the button (the bar draws the same modes)
  and gets the explanatory band, not a run — unchanged. The server's job route refuses a non-owner
  whatever the client does. Checked, not assumed.

### 5g. The card's sources, queued when Trajectory opens

The route needs only Quotes. The stop card reads Glossary, Ideas, FAQ and Timeline, and until now
showed only what already existed. Now **the first automatic open of Trajectory also queues whichever
of those are missing or stale**, each as its own ordinary unforced step job through the existing
queue (`enqueue`, as each mode's own button does) — not a new mechanism, and not chained into the
route's job. So:

- **The route does not wait on them.** It shows as soon as Quotes and the ordering are done; the card
  fills in as each lands (its read hooks revalidate when a job for their step finishes).
- **Each mode's own gate holds.** A mode is queued only if its control is available to this reader:
  Timeline and FAQ are behind the experimental switch, so they are queued only for a reader with it
  on — the same rule `canOpen` applies to the card's links.
- **Owner only**, as every paid run here; a visitor queues nothing.
- **Only on the automatic first run**, not on Regenerate, and not again once each has run: an
  unforced step whose artefact is current is skipped by `stepIsDone`, so a second open buys nothing.
- **The price is said before it is spent**: the empty state's hint names the extra modes it will make.
- The read-only hooks stay read-only (Sol F22): the queueing lives in the Trajectory controller, not
  in the card or its hooks.

**The cost**, measured on the entropy paper in stage 3: Glossary, Ideas, Timeline and FAQ together
came to $0.35, beside the route's ~$0.02 and Quotes'. That is what a first open adds for a reader with
the switch on; with it off, Glossary and Ideas only. Re-measured in this stage and recorded in
Progress.

**The simpler version not built**: leave the card as it was — show only what exists. It costs
nothing, but on a fresh article the card is simply absent, and Greg asked for the others to run.

### Done when

- tests red first for `positionOf`, the flash on each step path (a spy on `flashBlock`), the order,
  the promotion table, the regenerate button, and which card sources are queued for which reader;
- a browser check (Sonnet, Playwright) at 1440, 820 and 420, light and dark: the flash on every step
  path, the track and dots, the order in the bar, Regenerate, a fresh article opened with the switch
  off and on, and a visitor;
- Sol's plan review and code review; the gates; committed and pushed to `dev`.
