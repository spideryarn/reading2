# Summary's controls in one row, two plain-words levels, shaped by who is reading

Investigation write-up: [docs/investigations/261002b-how-simple-is-written-effort-levels-one-call-or-three-and-opus.md](../investigations/261002b-how-simple-is-written-effort-levels-one-call-or-three-and-opus.md).

Three admin reports about the same controls, batched into one piece of work (Overseer queue entry
`qi-pnsnh6yy`): [SPIDERYARN-READING2-78](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-78)
(`spya-rsgpfm`), [-7A](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-7A) (`spya-pppdan`)
and [-7B](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-7B) (`spya-a5yxnt`), all on
`/read/dongetal25-spya-vfmvmm?mode=summary&summary=simple`, build `fe57a1ea`. Greg's words:

> In Summary mode, move the new Gists and Simple pill to the same row as Parts and Sections. Remove
> the "Article" pill, and the "View" text.
>
> — Greg, 2026-09-30 (78)

> In the Summary mode, let's somehow group Parts & Sections together, get rid of the Gists button
> (since clicking on Parts or Sections is enough), and perhaps remove the "Simple" button and replace
> it with a couple of grouped buttons for something like Very-Simple and Moderately-Complex (but come
> up with better names). ... the main thing I'm trying to do is avoid wasting vertical space, and use
> the UI design to give the user a clue about how they work and are related to each other. Also, the
> Very-Simple and Moderately-Complex summaries should take into account User-Profile and
> Why-are-you-reading-it. ... If it's ELI12, maybe it should be ELI15, and then the
> Moderately-Complex might be +3 or something.
>
> — Greg, 2026-09-30 (7A — supersedes 78's layout)

> Remove "Written by AI in plain words to help you get your bearings. The article says it better, and
> each paragraph links to where." from Summary mode. And make a note in the new-mode.md (or similar)
> that we don't want these mode descriptions - they waste space. Either put them as tooltips for an
> (i) icon, or just try and make things self-explanatory.
>
> — Greg, 2026-09-30 (7B)

**Amended mid-build by two later reports**, relayed by the Overseer and folded in
([-7J](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-7J), `spya-nr6gqu`, 23:21Z, and
[-7F](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-7F), `spya-hkf2bs`, 23:15Z):

> Ok, I've slightly changed my mind re Summary mode UI & buttons yet again. For the new sub-modes
> that show simple text summaries, let's provide a UI-slider with 3 level (short & very-simple,
> just-under-current-length and fairly-simple, just-over-current-length and moderately-complex).
>
> — Greg, 2026-09-30 (7J)

> For the Very-Simple summary, tweak the prompt to output slightly shorter in length. The
> Moderately-Complex summary can be about the current length or ever so slightly longer.
>
> — Greg, 2026-09-30 (7F)

So **what shipped is three levels on a slider** — Brief, Simple, Fuller — where the sections below
still describe two pills. 7J is the later and wins where they differ: Fuller sits just over the first
version's length. § *What shipped* at the end is the current design; the sections in between are the
reasoning as it was reviewed, kept rather than rewritten.

The brief adds that Greg saw *"Some AI models, called large language models"* in Simple despite an
*About you* that says he is a CTO with a cognitive-science background — Simple has no profile in v1
([260930i](260930i-simple-summaries-eli15-sub-mode.md) § The prompt: *"No reader profile in v1"*).

## Checked first

`docs/plans/`, `docs/user-feedback/`, `git log origin/dev`, `gjd-remote ls`, 2026-10-01:

- **Simple itself** is [260930i](260930i-simple-summaries-eli15-sub-mode.md), shipped on dev the day
  before (note `260930_0238`). It deferred exactly two of the things asked here — *"ELI12, the
  shorter and simpler second level"* and *"Profile-aware levels"* — so this is the follow-up it named.
- **The profile machinery already exists and is what this reuses.** Every job carries the reader's
  rendered *About you* + *Why you're reading this one* as one string, `ctx.profile`
  (`renderProfile`, src/profile.ts). Profiled stages append the constant `PROFILE_RULES` to their
  system prompt and put `profileSection(profile)` in the last user part; the artefact records
  `profileHash`; the owner's GET adds `profiled` / `profileChanged` through `withProfileChanged`
  (src/routes.ts); the panel shows the `WrittenForYou` badge; and `ProfileCarrying` (src/store/pg.ts)
  puts any artefact with a `profileHash` into the owner's *make public* dialog as personalised.
  Glossary, Ideas, Quotes, Sketch and Tweets all use it.
- **The sibling, `fb6q2-quiz-adapts-to-profile-and-goal`**, has not started (waiting). The quiz's
  earlier goal work, [260930j](260930j-quiz-questions-shaped-by-the-readers-reading-goal.md), used
  its own `readerSection` rather than `profileSection` because the quiz *wants* the goal to change
  proportions. Simple does not need that: `profileSection`'s *"what you lead with and how much you
  explain"* is exactly the lever here. So Simple joins the shared machinery; no new plumbing.

## What changes, in one picture

Before (two rows, a label each, and a foot):

```
 VIEW   ( Gists ) ( Simple )
 DEPTH  ( article ) ( parts ) ( sections )
 ───────────────────────────────────────────
 …paragraphs…
 Written by AI in plain words to help you get your bearings. The article says…
```

After (one row, no labels, no foot):

```
 [ Parts | Sections ]   [ Simple | Fuller ]   ⓤ
 ───────────────────────────────────────────
 …outline, or paragraphs…
```

- **Two joined pairs.** Each pair is one segmented control — the pills share a border — so the shape
  says "these two are one choice". A gap between the pairs says "and this is a different choice".
  **Left is the outline, right is plain words; rightwards is more** in both pairs, so the row reads
  as two small ladders.
- **Parts | Sections is a ladder, not a switch.** Sections *adds* the sections under each part, so
  pressing Sections lights **both** pills (the whole segment washed), and pressing Parts lights
  Parts alone. That is Greg's "either or both on", and it is what `?deep=` already means (1 = parts,
  2 = sections, which includes the parts). Pressing Sections while it is lit steps back to Parts.
- **Simple | Fuller is a switch.** One at a time. Pressing either one leaves the outline (neither
  outline pill is lit); pressing Parts or Sections comes back to it. So the Gists pill has nothing
  left to do, as Greg said.
- **`article` depth goes** (78). `?deep=0` now reads as the default, `1`.
- **No `View` / `Depth` labels.** Each pair keeps a `<fieldset>` with a visually hidden `<legend>`
  (*Outline*, *In plain words*) so a screen reader still hears the grouping; nobody else sees it.
- **ⓤ is the existing `WrittenForYou` badge**, icon-only (the `compact` form Glossary uses), shown
  only on a plain-words level that was written for a profile. It is provenance, and its popover is
  where the profile is.
- **The foot goes** (7B). What it said moves into the pills' tooltip cards, which already exist
  (`ControlTip`): *what it is* and *how it is made*, including "each paragraph links to where the
  article says it".
- **Narrow band.** At `MODE_MIN` (18rem) the two pairs plus the badge fit on one line (four short
  words); the row still `flex-wrap`s, so the plain-words pair drops to a second line rather than
  scroll if it ever has to.

### The names: Simple and Fuller

Greg asked for better names than *Very-Simple / Moderately-Complex*. **Simple** keeps the name and
the URL value readers already have (`?summary=simple`, Greg's own link). **Fuller** is the notch
up: a little longer and admitting a little more of the piece's own complexity — the same relation
*Sections* has to *Parts*, which is the point of putting them side by side. Considered and passed
over: *Plain / Plainer* (the lit one would read as a comparison with nothing), *Easy / Deeper*
(*Deeper* promises depth two hundred words cannot give), *ELI15 / ELI18* (jargon Greg asked us to
replace). A rename is one table in `SummaryMode.tsx` and one URL value.

URL: `?summary=simple` (unchanged) and `?summary=fuller` (new); absent is the outline.
`SUMMARY_VIEWS` becomes `["gists", "simple", "fuller"]` — `gists` stays the name of the default in
code and the URL omits it, so nothing a reader sees says *Gists*.

## The two levels, and the reader

**One press, one call, both levels.** Pressing Simple *or* Fuller with nothing stored runs the
existing `simple` job, which now writes both levels in one model call; switching between them after
that is instant and free. Passed over: a call per level (a second step name, a second column, a
second CHECK widening and a second job for a 250-word artefact), and generating the other level
lazily on its own press (two waits for one reader). Cost: the answer roughly doubles (~350 → ~800
output tokens) and the wall clock grows by a few seconds; the article input, which dominates, is
paid once. Measured below.

**The pitch.** Greg: *"If it's ELI12, maybe it should be ELI15, and then the Moderately-Complex might
be +3 or something."* Simple is already ELI15, so:

- **Simple** — as for a bright fifteen-year-old; two to four paragraphs, about 200 words (as now).
- **Fuller** — as for a bright eighteen-year-old in their first year at university, not in this
  field; three to five paragraphs, about 320 words; it may keep more of the piece's own terms (each
  still said in plain words where it first appears) and one more layer of *how* or *why*.

**The profile moves the floor, not the level.** A fifteen-year-old *who already knows what the reader
says they know*. So for Greg's profile neither level explains what a large language model is,
while both stay in plain words about the parts of the piece outside his field. The goal (*Why
you're reading this one*) changes **what the paragraphs lead with**, never what the piece says —
which is exactly `profileSection`'s wording (*"Let this change what you lead with and how much you
explain. It changes nothing about what the article says, and nothing about its proportions"*).
Mechanically, the shared route:

- `SIMPLE_SYSTEM` appends `PROFILE_RULES` (constant, with or without a profile — the cache and
  injection reasons in src/profile.ts), plus one Simple-specific rule inside the constant half: the
  reader's described background counts as everyday words at both levels.
- The user message becomes `renderPrompt() + profileSection(profile)` — empty for no profile, so a
  reader without one gets byte-for-byte today's user message.
- The artefact gains `profileHash: string | null` (`hashProfile(profile)`, null for none).
- **Not in the stamp**, as the quiz: a changed profile does not make the paragraphs stale or rewrite
  them. The owner's GET reports `profiled` and `profileChanged` (`withProfileChanged`), the ⓤ badge
  shows the changed state, and when it is changed a **Write it again** (the forced run, which
  resolves the profile at the press) appears where the stale notice's button does.
- **The make-public dialog** will list Simple as *written for your profile* — the compiler makes us
  (`ProfileCarrying` → `personalisedSteps` and `OWNED_ARTEFACT`): *"your plain-words summary"*.
  A visitor on a public article reads the owner's paragraphs, which were pitched at the owner; the
  paragraphs never mention the reader (`PROFILE_RULES`' *never address them, never mention the
  description*), and the dialog is where the owner is told. That is how every profiled artefact
  already works.

## The artefact

```ts
export const SIMPLE_LEVELS = ["simple", "fuller"] as const;
export type SimpleLevel = (typeof SIMPLE_LEVELS)[number];

interface SimpleSummary {
  version: "simple/2"; generator; slug; sourceHash; generatedAt; elapsedMs;   // as now
  profileHash: string | null;                                                // new
  levels: Record<SimpleLevel, SimpleParagraph[]>;                            // was `paragraphs`
}
```

- `Record<SimpleLevel, …>` so a third level would fail to compile everywhere a level is read.
- **Caps per level**, one table beside `SIMPLE_LEVELS` in src/types.ts: Simple 2–4 paragraphs,
  ≤320 words (as now); Fuller 3–5 paragraphs, ≤450 words; ≤3 ids per paragraph for both. Validation
  is the existing `toParagraphs`/`buildSimpleSummary` run once per level; **either level failing
  fails the whole run and stores nothing** (the same rule as today: nothing half-written).
- `isSimpleParagraphs` (the store/DTO guard) becomes `isSimpleLevels`, checking both levels against
  their caps.
- **A `simple/1` row reads as absent.** Its shape has no `levels`, so the guard refuses it:
  `loadSimpleSummary` says not found, the public DTO omits it, and the stamp's `promptVersion`
  (`simple/2`) makes it not-done, so the next press writes both levels. Nothing is deleted; the old
  JSON is simply replaced on that press. There are a handful of these, all a day old. Passed over:
  reading `simple/1` as a Simple level with no Fuller — a partly-present artefact, and every reader
  of it has to handle a hole.
- Public DTO: `{ levels: { simple: [{ text, ids }], fuller: [...] } }`, rebuilt field by field as
  now; `profileHash` never leaves the server (it is the owner's).

## The prompt

`simpleSystem()` loses its `pitch` parameter (the probe's ELI12 knob is replaced by the two real
levels) and asks for both:

```
{"simple": [{"text": "...", "ids": [...]}], "fuller": [{"text": "...", "ids": [...]}]}
```

- Each level written **independently**: Fuller is not "Simple plus more sentences" and does not refer
  to Simple, since the reader may read only one.
- The existing rules stay, for both levels: plainer means equally specific; only what the piece says;
  every paragraph a door with 1–3 ids; jargon explained where it appears; `plainWords("explain")`.
- `ANSWER_TOKENS` recomputed for nine paragraphs.

### Measuring it ([prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change))

The claim to test is narrow: **with a profile like Greg's, Simple stops explaining what that reader
already knows, without getting less faithful; with no profile it is as plain as today's; and Fuller
reads as a notch up from Simple.**

- Articles: three local ones, including one about AI (so a technical profile has something to
  skip) and the dense `entropy-24-00930` paper from 260930i's probe. `dongetal25` is not on this box.
- A synthetic profile shaped like Greg's (*CTO, background in cognitive science and machine
  learning*) and a goal — **not** Greg's real *About you*, which is his, and would land in the repo.
- Arms, separated in time on two commits: `before` = today's Simple, twice (the control); `after`
  = the new prompt with the profile, and with no profile.
- Blind judge in a fresh subagent, shuffled pairs with the key checked for balance: (a) *for the
  reader described here, which spends fewer words explaining what they already know?* (b) *did
  either lose, bend or blur a claim?* And a second pass on `after` alone: *is Fuller a notch above
  Simple — more of the piece, still plain?*
- Cheap screens: word and paragraph counts per level, dropped ids, and a grep for the explanatory
  shapes (*"called"*, *"which is a"*, *"a type of"*) on AI terms.
- Read every output. Results into this doc and `evals/simple/`.

## Stages

1. **Server + prompt** — types and caps, `simple-summary.ts` (both levels, profile), the pipeline
   step passing `ctx.profile` and recording `profileHash`, the GET through `withProfileChanged`,
   the guards, public DTO, export, `ProfileCarrying` / `OWNED_ARTEFACT`; tests (validation per
   level, either-level failure, v1 read as absent, no-profile user message byte-identical, profile
   section present, public DTO shape and no `profileHash`). The measurement. GPT Sol code review.
   Commit.
2. **Client** — the one row (two segmented pairs, the Sections-lights-both ladder, hidden legends),
   `SUMMARY_VIEWS` + `?deep=` minimum 1, `SimplePanel` taking a level, the foot deleted, the badge,
   *Write it again* on a changed profile, tooltip cards rewritten; tests; CSS; browser check in a
   Sonnet subagent at full width and at `MODE_MIN`. Docs: [summaries.md](../project/summaries.md),
   [url-state.md](../project/url-state.md), and **the rule in
   [mode.md](../project/mode.md)** — no description lines in a mode, Greg's words quoted; a
   tooltip on the control, or an (i), or nothing. GPT Sol code review. Commit.
3. **Land** — scoped tests, typecheck, one full suite under `tmux-job`, push to `dev`, the note in
   `docs/user-feedback/` with all three report ids, `feedback-endings.ts`.

## The simpler option passed over

**Only the layout and the foot (78 + 7B), no second level and no profile.** A few files of client
code. Passed over because 7A — which Greg says supersedes 78 — asks for the two levels and the
profile in so many words, and the profile is the fix for the thing he actually tripped on.

## Deferred

- **Streaming the first press**, still (260930i § A departure from CLAUDE.md). One call for both
  levels lengthens the wait by a few seconds; measured below, and named for Greg in the note.
- **A visitor's own level or profile.** A visitor reads the owner's paragraphs, as with every
  profiled artefact.

## Ledger

**Plan review, GPT Sol** ([review](261001b-summary-controls-plan-review-sol.md)) — *revise before
build*. What changed:

- **P1-1 fingerprint vs profile — taken.** `sourceHash` is the article plus the **profile-free**
  base prompt; the profile is recorded only as `profileHash`. A test holds two profiles to the same
  `sourceHash` and different request bytes, and a profiled artefact to `STEPS.simple.stamp`.
- **P1-2 Metadata calling a malformed `simple/2` row done — taken.** One guard, `isSimpleLevels`,
  used by Metadata's `isCurrent`, `store/artifacts.ts`, `loadSimpleSummary` and the public
  projection.
- **P1-3 Fuller missing from `bandTarget` — taken.** Both `simple` and `fuller` map to the
  `"simple"` target.
- **P1-4 token evidence wrong; one call's atomic failure unmeasured — taken as a gate.** The real
  one-level output is ~850–920 billed tokens at `high` (thinking included), so both levels will be
  ~1.5–2k. **Gate, declared before the runs:** across the *after* runs (three articles × at least
  four runs), at least 90% must store both levels; below that, split into two calls before
  building the client.
- **P1-5 evaluation does not isolate the goal — taken.** *About* held fixed, with three conditions:
  no goal, goal A, goal B (declared per article before running), plus a no-profile arm; equal
  repeats (two each). Judged separately: background not re-explained; goal-led emphasis; fidelity;
  no-profile plainness against `before`; Fuller a notch above Simple.
- **P2-6 "every job carries the profile" — taken, narrowed.** Ordinary reading-view slug jobs carry
  it unless `useProfile: false`; CLI runs and a URL ingest do not. `profiled` is derived by the
  client from `profileHash`.
- **P2-7 export count — taken** (both levels counted). **P2-8 separator — taken.**
- **P2-9 two grammars in one row — partly.** Parts|Sections stays a ladder, because the brief's
  *"either or both on"* and Greg's *"give the user a clue about how they … are related"* ask for
  it, but **`aria-pressed` marks only the chosen depth**; Parts under Sections gets a separate
  *included* style (a softer wash), so it does not read as a second selection. Legends use the
  existing `.sr-only`. `WrittenForYou`'s "compact, in Glossary only" note is widened.

**The before arm** ran on `origin/dev` `a99db5e9` before any code changed: `high-15-beforeA` and
`high-15-beforeB`, three articles each, all valid, 240–273 words, 9.5–17.8 s, $0.02–0.07 a run.

### Built, measured, and changed by what was measured

Every run is production's own `generateSimpleSummary` through `evals/simple/probe.ts`, on three local
articles (*The Scaling Hypothesis*, Olah's *Distributed Representations*, the Entropy PID paper), at
`high`, with a reader from [`evals/simple/readers.json`](../../evals/simple/readers.json) (a synthetic
CTO with a cognitive-science and ML background, and two declared goals per article — not anybody's
real profile). `npx tsx evals/simple/tally.ts <arm>` prints any arm's table; the files are under
`evals/results/simple/`.

1. **One call for two levels — failed on latency, not validity.** `*-after1`: 11 of 12 valid (just
   over the 90% gate), but reasoning went from 150–800 tokens to 1–15k and the wait from 9–18 s to
   **24–134 s**. Not shippable. → **A call per level, run side by side.**
2. **Two calls (`*-split1`)**: 10–39 s, but 2 of 11 failed on Simple's 320-word ceiling (333, 338) and
   Fuller reached 448 of 450 → the word asks lowered (the model runs about a third over any total).
3. **Then 7J and 7F arrived** → three levels, three calls: Brief (ask ~100 words, pitched at twelve),
   Simple (~170, fifteen), Fuller (~220, eighteen). `*-slider1`: 9 of 12; the losses were Fuller at
   431 words against a 420 ceiling, Brief at 210 against 200, and one answer with a stray character
   after its JSON (the shared strict parser, left alone). The ceilings were moved above the longest
   seen (240 / 360 / 480) — a ceiling is the orientation-versus-digest line, and the asks set the
   length. `*-slider2`: **12 of 12**.
4. **The gate, honestly counted** (GPT Sol's code review, P1-4: the first draft of this line said
   23 of 24 by re-scoring `slider1`'s failures against ceilings they never ran under; recorded, the
   two repeats are 21 of 24). A clean third repeat on the shipped prompt and ceilings,
   `*-slider3`: 10 of 12 — Brief at 241 words against 240, and a Fuller whose five paragraphs named
   no passage of the article. **On the shipped settings, `slider2` + `slider3`: 22 of 24 (92%)** —
   over the 90% gate, but all-or-none means about one press in twelve fails and the reader presses
   again. → **A level whose answer fails validation is asked once more, on its own**
   (`LEVEL_ATTEMPTS = 2` in `src/simple-summary.ts`); a failed *call* is not retried. Every loss
   seen — a word over, ids that match nothing, a stray character after the JSON — is a sample's
   problem, so a second sample nearly always clears it, and the cost is one extra call on the
   presses that need it. Not re-measured with paid runs: the tests drive both the second chance and
   the failure after it.

`split1` was 10 of 12 once its last run landed (the first draft said 2 of 11 failures, counted
while one was still running).

**The shipped design, across both slider repeats** (24 runs):

| | Brief | Simple | Fuller | first version |
|---|---|---|---|---|
| words | 118–191 | 155–318 | 192–370 | 240–273 |
| wait | 8–28 s for all three, side by side | | | 9–18 s |
| cost a press | $0.06–0.22 | | | $0.02–0.07 |

Greg's three lengths hold on average — Brief clearly shorter, Simple just under, Fuller just over —
though on one article Fuller and Simple came out the same length. **The cost is about three times the
first version's**, because each of three concurrent calls pays for the article; staggering them to
share a cache write would save most of it and add the cache write's latency. Named, not built.

**The blind read** — a fresh Opus subagent reading only
[`pairs.md`](../../evals/results/simple/judge-261001/pairs.md), sides by `crypto.randomInt` (balance
3/5, 4/12, 2/6), key and answers beside it, scored by `evals/simple/judge-score.ts`:

- **T1 — the profile.** Today's Simple against the new Simple written for the CTO reader: the new one
  spends fewer words on what the reader already knows in **5 of 5**. The cheap screen agrees: a
  sentence explaining a term the reader knows in **0 of 42** profiled sentences, against 8 of 59 in
  today's prompt and 5 of 48 in the new one with no profile (`evals/simple/screen.ts`).
- **T2 — the goal.** Given goal A and goal B, the judge picked the text written for A in **11 of 12**
  (Brief 4/4, Simple 3/4, Fuller 4/4): the goal changes what the paragraphs lead with.
- **T4 — the ladder.** One run's three levels shuffled, ordered simplest to most complex: **29 of 33**
  pairwise orders right, 7 of 11 exactly Brief < Simple < Fuller. The misses are Simple and Fuller
  swapping, which matches the one article where their lengths met.
- **T3 — plainness with no profile.** Today's Simple against the new Simple, no reader: the new one
  was judged easier in **1**, the old in **3**, the same in 2. So with no profile the new middle level
  is a shade less plain than the first version. That is Greg's *"fairly-simple"* for the middle stop,
  with the *"very-simple"* one now Brief — but it is a change a reader without a profile will see.
- **Fidelity, T1 and T3.** Flags fell on both arms alike (none new-only, none old-only; both texts in
  7 of 11 pairs, mostly small additions such as "mouse" for a culture study). One is a real
  terminology collision — *"synergy … grows with more feedback loops"* on the PID paper, where
  *feedback* names a different connection type whose effect goes the other way — and it is in the
  first version's outputs too (`high-15-beforeB`, and 260930i's `medium-15`), so it is a standing
  fault of the stage on that paper, not this change. Recorded, not fixed here; the likely mechanism, prompt
  wordings that did not make the fault rare enough to ship, and the guard proposed instead are
  [261001h](261001h-plain-words-summaries-keep-the-piece-s-contrasting-terms.md).

## What shipped

```
 [ Parts | Sections ]   ○──●──○ Simple   ⓤ
```

- **One row, no labels.** Parts | Sections, joined; Sections lights Parts as *included*
  (`aria-pressed` on the chosen depth only); pressing Sections while chosen steps back to Parts. No
  *Article*, *Gists*, *View* or *Depth*. Each group's `<legend>` is `.sr-only`.
- **The slider** (`<input type="range">`, three stops): Brief · Simple · Fuller, the level's name
  beside it. Faint while the outline shows, resting on Simple; a click, a drag or an arrow key opens
  the level it lands on, and arms the one `simple` step. Pressing Parts or Sections writes `?summary=`
  and `?deep=` in one history entry. URL: `?summary=brief|simple|fuller`.
- **ⓤ**, the owner's compact *written for you* badge, at the row's end; a changed profile also shows
  *Write it again* under the paragraphs.
- **No description line** (7B): the foot is gone, its sense moved into the slider's card, and
  [mode.md](../project/mode.md) carries the rule in Greg's words.
- **Artefact `simple/2`**: `levels: { brief, simple, fuller }` and `profileHash`, one guard
  (`isSimpleLevels`) at every read boundary, a `simple/1` row read as absent.
