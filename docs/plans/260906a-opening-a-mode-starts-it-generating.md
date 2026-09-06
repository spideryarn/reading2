# Opening a mode starts it generating

> Make sure that each mode automatically starts generating when I open it. Most of them do, but a
> few still require an extra button-click after opening the mode, e.g. Tweets, Diagrams. By opening
> the mode, the user is implicitly indicating that they want what's already generated, or to
> generate it if needed.
>
> — Greg, 2026-09-06

This finishes the rule
[260902e](260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md) § 2b
started. That plan built the whole mechanism — [`activation.ts`](../../src/web/activation.ts),
[`useAutoRun.ts`](../../src/web/useAutoRun.ts),
[`jobEngine.beginAutoAttempt`](../../src/web/jobEngine.ts) — and wired five surfaces to it. Five
more were left on a button, four of them for reasons that were good at the time and one of them
because it predates the machinery. This wires those five.

**Nothing here invents a second way to start a run.** Every surface below joins the existing
`arm → claim → consume → beginAutoAttempt` path, which is the one place that decides whether a press
spends money. The work is almost entirely *widening a vocabulary and calling a hook*.

## Where it stands

| Surface | Reached by | Auto-runs today | Why not |
|---|---|---|---|
| Glossary, Ideas, Quotes, Timeline, Debate | Dock mode button | **yes** | — |
| Diagram → Sketch chip, Illustrated chip | chip inside Diagram | **yes** | — |
| **Diagram** → the Sketch it lands on | Dock mode button | no | left out of `MODE_TARGET` on cost |
| **Tweets** | Dock link, `/read/<slug>/tweets` | no | "a button, not an effect", 2026-08-25 |
| **Remember → Quiz** | sub-mode chip | no | never wired |
| **Referee → Claims** | sub-mode chip | no | a stream, not a job — no `StepName` |
| **Referee → Candidates** | sub-mode chip | no | fired on *mount*; cut to a button 2026-09-02 |

Everything else in `MODES` is free (Plain, Hierarchy, Outline, Summary — they read the tree that is
already there), stores nothing (Search, Chat), or waits on the reader's own words
(Remember → Recall, Referee → Criteria). Those stop here.

## The three reasons that were overruled, said out loud

Each of these is a decision written down in the code, and Greg has now decided the other way. They
are recorded so nobody re-derives the old answer from the old comment.

1. **Diagram's price.** [`activation.ts`](../../src/web/activation.ts) § `MODE_TARGET`:
   *"Adding `diagram: "sketch"` to this table would turn every press of a bar button that is now in
   front of every reader into a ~$0.20, two-minute job."* That is exactly what this plan does, and
   the sentence stays true — it is now the intended behaviour rather than the thing being avoided.
   Diagram came out from behind the experimental switch on 2026-09-04, so this is in front of
   everybody. Named at the point of choosing, per
   [vision.md § Simpler first](../project/vision.md#simpler-first); Greg named Diagram explicitly.

2. **Tweets' generate-fail-generate loop.** [`Tweets.tsx`](../../src/web/Tweets.tsx) § `Empty`:
   *"Theirs generated automatically when the page became visible, and the effect that did it
   re-fired on every failure … Greg asked for a button, which removes that bug structurally."*
   The button is no longer the only structural fix: `jobEngine.beginAutoAttempt` is one attempt per
   `(slug, target)` per session, and `claimActivation` ties the spend to the press. Both of those
   postdate that comment. The loop is closed by the machinery now, so the button can stop being the
   thing that closes it — and it stays on screen for the reader who wants a rewrite.

3. **Candidates and the search engine.** This is the one that is *not* only about money, and it is
   worth reading before signing off. [`CandidatesPanel.tsx`](../../src/web/CandidatesPanel.tsx)
   § `startBrief`, 2026-09-02: a first turn may run a web search, which sends terms drawn from
   **an unpublished manuscript** to a search engine — *"a different third party at a different time"*
   from the model provider the band's notice covers. Firing that on a mount was the bug; firing it
   on a press is what Greg has asked for, and a press is a real gesture by somebody who read the
   chip's tooltip. But a referee clicking along four one-word chips to find out what they mean will
   now cause it. **Debate is the precedent** — it reaches the open web and auto-runs on a mode press
   already — so this is not a new class of thing, only a new instance of it.
   **The mitigation the plan proposed was wrong and the review said so** — see § As built, finding 4.
   The chip's `ControlTip` does say *"may run a web search"*, but this repo has already written down,
   after a browser pass, that *a tooltip is not read by anybody in a hurry, which is what a referee
   is*. What the disclosure needed was to be **visible before the gesture**, so it moved above the
   chips. If Greg wants this one left on a button after all, it is two lines: the `candidates` row in
   `REFEREE_TARGET`, and the notice that goes with it.

## What is being built

### Stage 1 — the target vocabulary widens

`AutoRunTarget` is `Extract<StepName, …>` today, which buys a real guarantee: a target is spelled
the same as the pipeline step `beginAutoAttempt` is keyed on. Two of the five new targets — `claims`
and `candidates` — are **not** pipeline steps; they are SSE streams with no job behind them. So the
guarantee has to be re-stated rather than dropped.

New file [`src/web/auto-run-targets.ts`](../../src/web/auto-run-targets.ts), a vocabulary that
imports nothing at runtime — the same shape as [`src/modes.ts`](../../src/modes.ts) and
[`src/web/referee-views.ts`](../../src/web/referee-views.ts), and for the same reason: two modules
now need the union and one of them (`jobEngine.ts`) cannot import `activation.ts`, which imports it.

```ts
type StepTarget<T extends StepName> = T;

type StepAutoRunTarget = StepTarget<
  | "glossary" | "ideas" | "quotes" | "timeline" | "debate"
  | "sketch" | "illustrated" | "tweets" | "quiz"
>;

export type AutoRunTarget = StepAutoRunTarget | "claims" | "candidates";
```

`StepTarget` is the load-bearing line: misspell a step-shaped target — `"tweeets"` — and it fails
**on that literal, in this file**. The first draft of this plan used a
`Record<Exclude<AutoRunTarget, StepName>, true>` instead, on the theory that a misspelling would fall
out of `StepName` and leave the record short of a key. It would not: `Extract` silently *erases* a
name it does not recognise, so the record stays intact and the error surfaces at some unrelated call
site, or nowhere. GPT Sol, § As built, finding 9.

`activation.ts` re-exports `AutoRunTarget`, so no existing importer changes.
`jobEngine.beginAutoAttempt(slug, target: AutoRunTarget)` widens from `StepName` — it is only ever a
`Set` key, and this is what stops the two vocabularies drifting.

Then `MODE_TARGET` gains one row: `diagram: "sketch"`.

*Evidence:* a new case in
[`tests/modes-that-start-themselves.test.tsx`](../../tests/modes-that-start-themselves.test.tsx) —
pressing Diagram in the bar POSTs `sketch` once; pasting `?mode=diagram` POSTs nothing.

### Stage 2 — a press on a Dock *link*, and Tweets

Tweets is a `DockLink`, not a mode button, and `Link` fires its `onClick` **before** it decides
whether it is going to navigate in-page — so a ⌘-click would arm a token in a tab that is not going
anywhere. [`Link.tsx`](../../src/web/Link.tsx) gains an `onNavigate` prop called only on the branch
that actually calls `navigate()`. Three lines, and it is the honest seam: "this link is about to
take over" is a fact only `Link` knows.

Then `Tweets.tsx` calls `useAutoRun(slug, "tweets", loaded.status, ensure, reload)`. Its `write` is
already the unforced verb when called with no arguments (`write(force = false)`), which is what
`useAutoRun` requires — a forced and an unforced request are different `work_key`s and
`enqueueOrGet` will not collapse them, so an automatic run racing a button press would be charged
twice. `ensure` is written out as `() => write(false, true)` rather than passed as `write`, so a
later reader cannot make it forced by changing a default.

The `Empty` state's button stays exactly where it is. It is what the reader presses after a failure,
and after `beginAutoAttempt` has spent this session's one automatic try.

*Evidence:* `tests/tweets-page.test.ts` grows a mount-vs-press pair.

### Stage 3 — Remember → Quiz

[`useQuiz`](../../src/web/useQuiz.ts) has exactly one verb, `write`, and it is **always forced** —
correct for the button it was written for, wrong for an automatic run, for the double-charge reason
above. It gains `ensure` (unforced) beside `write` (forced), which is
[`useIdeas`](../../src/web/useIdeas.ts)'s `ensure`/`regenerate` split named the same way, and then
`useAutoRun(slug, "quiz", status, ensure, reload)`.

`RememberBand`'s `onChange` arms `quiz` on the way through, next to the `setBoth` that is already
there. Recall arms nothing — it is the reader's own words.

### Stage 4 — Referee → Claims and Candidates

Both are streams rather than jobs, so the work is mapping what they have onto the four-state
`ArtefactStatus` `useAutoRun` reads, and giving each a re-read for the failed-GET path.

- **Claims.** [`useClaims`](../../src/web/useClaims.ts) fetches inside a `useEffect` keyed on slug
  and exposes no way to ask again. The fetch moves into a `useCallback` the effect calls, and
  `reload` joins the interface. Status: `!loaded` → `loading`, `loadFailed` → `error`, `run !== null`
  → `ready`, else `none`. `ensure` is `pull`, which already refuses a second run while one is in
  flight (`running` ref) — so the auto-run and a fast button press cannot both start one.
- **Candidates.** [`useChat`](../../src/web/useChat.ts) has `loaded`/`loadFailed` already; it gains
  `reload`, which dispatches a second `load.started` — safe by construction, because registering a
  second load drops the first from the map in `reduce.ts`. Status is the same mapping against
  `firstCandidatesThread(threads)`. `ensure` is `startBrief`, which already guards on
  `!loaded || thread`.

`RefereeViews` arms `claims` or `candidates` in the chip's own `onClick`, via `REFEREE_TARGET` — a
partial record in `activation.ts` beside `MODE_TARGET`, so the two tables read the same way. Criteria
and Mirror arm nothing. It ended up *in* `RefereeViews` rather than one level up in `RefereeBand`
because that is where `Dock` and `DiagramPanel` already do it, and because it keeps the button and
the token in one file, which is what makes the seam testable.

*Evidence:* `tests/referee-candidates-press.test.tsx` already asserts the press-not-mount rule for
Candidates and is the file this stage has to keep green; it grows the positive case.

### Stage 5 — the docs, and the review

- [`activation.ts`](../../src/web/activation.ts) header: "five surfaces" → the new count, and the
  `MODE_TARGET` docstring rewritten — the paragraph arguing Diagram out is now the paragraph
  arguing it in.
- [`useAutoRun.ts`](../../src/web/useAutoRun.ts) header: same count.
- [`Dock.tsx`](../../src/web/Dock.tsx)'s `diagram` row comment and
  [`params.ts`](../../src/web/params.ts)'s `diagramParam` comment both assert *opening Diagram buys
  nothing*. Both become false and both must change.
- [`Tweets.tsx`](../../src/web/Tweets.tsx) § `Empty` — the "a button, not an effect" note keeps its
  history and gains what changed.
- [`CandidatesPanel.tsx`](../../src/web/CandidatesPanel.tsx) § `startBrief` — the same, and it keeps
  the search-engine warning at full strength.
- [`diagram.md`](../project/diagram.md), [`quiz.md`](../project/quiz.md),
  [`referee-mode.md`](../project/referee-mode.md), [`new-mode.md`](../project/new-mode.md) —
  new-mode.md's residue list should name arming as a thing a new artefact-backed mode has to decide.
- GPT Sol review of the built code, per
  [code-quality-overview.md](../project/code-quality-overview.md).

## The simpler option this passed over

**Fire from `status === "none"` on mount and delete the activation machinery**, which is what Greg's
sentence — *"by opening the mode, the user is implicitly indicating…"* — literally describes. It is
a much smaller change: five hooks, five effects, no vocabulary, no token.

Not taken, and the reason is in
[`activation.ts`](../../src/web/activation.ts) § Why a mount is not a click. A panel mounts with
nobody having pressed anything on a pasted link, a bookmark, a Back step, a Forward step, and a link
in from the metadata page. GPT Sol found this in the first version of the feature and it was rebuilt
because of it. Greg's sentence is about a reader *opening* a mode, and Back is not opening — the
reader is retracing. Firing on mount would make every history step through `?mode=` a paid job, and
it is a step somebody takes without thinking.

So: the same rule, the same gesture seam, five more surfaces.

## As built — what the plan-stage review changed

GPT Sol reviewed this before anything was written and **would not approve it**. Four blockers, all
real, all confirmed against the code. They are recorded here rather than quietly fixed, because
three of them are traps a later change could walk back into.

1. **Diagram would have spent after a Back step, with no press.** The plan's `diagram: "sketch"` row
   assumed opening Diagram lands on the Sketch, and `?diagram=` survives leaving the mode. Press
   Illustrated, leave for Plain, press Diagram → a *sketch* token is minted, `IllustratedView`
   mounts, nobody claims it, and it sits in the map because nothing expires an unclaimed token. A
   Back step onto `?diagram=sketch` then claims and spends it.
   **Fixed** by arming the picture the press will land on:
   `armActivationForDiagram` reads `?diagram=` out of the bar's own `location.search`. The row is a
   function now, not a table entry. `tests/modes-that-start-themselves.test.tsx` § *spends nothing on
   a Back step after opening a picture it did not arm* was watched going red on the fixed target
   before it was watched going green.

2. **Quiz would have charged twice.** Splitting `useQuiz.write` into `ensure`/`write` was necessary
   and not sufficient: `QuizPanel`'s one `run()` helper called the **forced** verb for the empty
   state as well as for the rewrite, so the automatic unforced run and a press beside it are two
   `work_key`s and `enqueueOrGet` collapses neither. **Fixed** by making the verb an argument to
   `run()`, `ensure` under the empty state and `write` under the two rewrites.

3. **The Quiz chip missed a real press.** The plan armed from `onChange`, which
   `RememberSubModeToggle` calls only when the sub-mode actually changes — so pressing Quiz *while in
   Quiz* armed nothing, and that is the one control a reader has after a failed read (the press is
   kept, and nothing re-fires without a fresh nonce). **Fixed** by arming above that check and
   leaving `onChange` below it. The bar's own mode buttons have always behaved this way.

4. **Candidates would have lost its pre-spend disclosure.** The plan leaned on the chip's
   `ControlTip`, and [referee-mode.md](../project/referee-mode.md) says outright, in a section
   written after a browser pass, that *a tooltip is not read by anybody in a hurry, which is what a
   referee is* — the button's **visible words** were what named the search engine before it was
   reached, and a chip press reaches it before the panel is drawn. **Fixed** by moving the sentence
   rather than dropping it: `REFEREE_CANDIDATES_REACHES_SEARCH` sits under the confidentiality notice
   above the chips, in the future tense, and outside the collapse.

Four more findings changed the build without blocking it:

- **`Record<Exclude<AutoRunTarget, StepName>, true>` was theatre.** `Extract` *erases* a name it does
  not recognise, so a misspelled step literal leaves the record intact and the error, if it comes at
  all, surfaces somewhere else. Replaced with `StepTarget<T extends StepName>`, which fails on the
  literal, in the file that is wrong.
- **`useClaims.reload` needed ordering, and did not need to be public.** A naïve second read is the
  race `useOrderedRead` exists for and that eight other readers already route around. The read now
  goes through it, and `useAutoRun` moved *inside* `useClaims`, so `ClaimsApi` is unchanged and the
  typed test fixtures did not have to grow a field.
- **`startBrief` had no atomic guard.** Its `!loaded || thread` test is a render-time value, so the
  automatic run and the still-visible button can both pass it in one tick and mint two threads.
  A synchronous `asking` ref now latches it.
- **Mirror is a sixth surface, and is deliberately excluded.** It streams from the referee's existing
  comments and needs no new text, so it *could* be armed — but it stores nothing, so there is no
  "already generated" for a press to find, and `beginAutoAttempt` would make the second open of a
  session behave unlike the first. Named here so the omission is a decision rather than an oversight.

Sol also settled two questions the plan had guessed at: the `{status:"pending"}` placeholder
`useClaims.pull` installs does **not** break the `none` gate (it is written after the token is
consumed, and the next render reads `ready`), and `Link.onNavigate` is the right Tweets seam because
the router uses `pushState`, so the module holding the activation map stays loaded across the
navigation.

**The inventory, after all of it: twelve initiating surfaces backed by eleven targets.** Diagram's
bar button and its Sketch chip are two surfaces sharing one target, which is why those two numbers
differ.

## The second review, of the built code

The same reviewer, on the diff. It found the four blockers *substantively fixed* and then found a
fifth, in the fix for the first one — which is the argument for the second review in one sentence.

**Blocker: a link naming a picture that was cut opened the Sketch and armed nothing.**
`diagramParam` degrades an unrecognised `?diagram=` to the default rather than throwing — the rule
every parser in `params.ts` follows — so a link from August saying `?diagram=tree` opens the
**Sketch**. The bar was handing `armActivationForDiagram` the *raw* query value, which matches
neither `sketch` nor `illustrated`, so it armed nothing: the mode opened on the empty state and the
press did nothing, which is precisely the extra button-click this whole change exists to remove.
Fixed with `diagramInSearch` in [`params.ts`](../../src/web/params.ts), which applies the parser's
own rule from the parser's own constants; the default is now named once as `DEFAULT_DIAGRAM` so the
two readers cannot drift. Test watched red, then green.

**And the test harness had the same bug as the code**, which is worth saying because it is the
class [silent-success.md](../reusable/silent-success.md) is about: the new case first failed for the
*wrong reason* — the fake band in
[`modes-that-start-themselves.test.tsx`](../../tests/modes-that-start-themselves.test.tsx) also read
`?diagram=` literally, so with `tree` in the address bar it mounted no band at all and the assertion
was vacuous rather than discriminating. It goes through `diagramInSearch` now, and was re-checked
against the buggy `Dock` afterwards.

Two findings taken as **follow-ups rather than scope**:

- **A failed opening Candidates turn has no retry.** `CandidatesPanel`'s `Turn` renders the error
  text and does not expose `useChat.retry`, so a thread whose first turn failed counts as `ready` for
  ever and every later chip press is consumed without spending. This predates the change — the same
  hole was reachable from the button — but the automatic run makes reaching it likelier, so it is
  worth fixing next. Mapping it to `none` would be wrong: `startBrief` would either refuse or mint a
  duplicate thread. The repair is to wire retry for the failed opening turn.
- **`Link.onNavigate`'s contract is slightly overstated.** `navigate()` itself returns early for the
  URL it is already at, so "this link is taking over" is true of every case *except* that one. The
  Tweets caller compensates with `view === "tweets"`, so there is no bug today; a second caller would
  need to know.

**The disclosure moved again after the browser pass.** Sol flagged that `.ref-brief` is a
40%-height scroller and asked for a check at the minimum viewport; the browser pass found the
sentence correct when the notice is collapsed at 1400px and 390px, and below the fold when it is
**expanded**. It is now drawn *above* the collapsible paragraphs rather than below them, so an
expanded notice cannot push it out of sight while the Candidates chip stays on screen.

Verdict after the fixes: the tests Sol still wants are listed in its review
([-code-review-sol.md](260906a-opening-a-mode-starts-it-generating-code-review-sol.md)); the two
highest-value ones — the malformed `?diagram=` case, and Quiz's forced/unforced request bodies in
[`step-job-force.test.tsx`](../../tests/step-job-force.test.tsx) — are written. The rest are
recorded there rather than built.

## What would catch a mistake here

The failure this change makes possible is **spending money on a gesture that was not a press**, and
the check is `tests/modes-that-start-themselves.test.tsx`, whose negative cases settle the artefact
GET before asserting — [silent-success.md](../reusable/silent-success.md)'s rule, and the reason a
vacuous "no POST" assertion is worthless here. Each new surface gets both halves: the press runs it
once, and the paste runs nothing.
