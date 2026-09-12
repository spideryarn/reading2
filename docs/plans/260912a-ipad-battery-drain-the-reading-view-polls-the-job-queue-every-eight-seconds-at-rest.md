# iPad battery drain: the reading view polls the job queue every eight seconds at rest

*Started 2026-09-12 from Sentry
[SPIDERYARN-READING2-36](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-36), queue item
`qi-wf7v2jdx`. Feedback note:
[260912_0814-ipad-battery-still-drains-fast.md](../user-feedback/260912_0814-ipad-battery-still-drains-fast.md).*

> It is still draining the battery on my iPad really fast for  some reason
>
> — Greg, 2026-09-12, from
> `/read/entropy-24-00930-spya-bmvfyb?at=spya-hnr33h&mode=summary&remember=quiz&deep=2`, build
> `607b57a0`, an iPad, production

## What can and cannot be measured from here

An iPad's battery cannot be measured from the Hetzner box, and nor can Safari: Playwright's WebKit
is on disk but will not launch, because the box is missing about twenty system libraries
(`libflite`, `libavif`, `libx264`, …) and installing them is a change to the box, which is Greg's
call. So everything below is **Chromium**, headless, sometimes emulating an iPad Pro 11 in landscape
(touch, `hover: none`, the iPad user agent, device pixel ratio 2). **These runs establish this
build's requests and its instrumented timers and renders, plus Chromium's CPU categories under
emulation. They do not establish Safari's scheduling, what a request costs an iPad's radio or a
repaint its GPU, or causality.** Repeated polling is a plausible contributor to the reported drain;
the unattributed Chromium work below is a lead for a device trace. (GPT Sol, plan review F5.)

The article in the report is not in the local database. The measurements use
`replication-crisis-spya-hrjamq` (551 blocks, 13,304 words), in the reported state:
`?mode=summary&remember=quiz&deep=2`. (`remember=quiz` does nothing outside Remember mode —
`Reader.tsx` mounts the quiz only when `mode === "remember"` — so the reported URL is Summary mode
with a stale parameter.)

## What was found

### 1. At rest, every owner's reading view asks `/api/jobs` every eight seconds, for ever

The production build (`npm run build` + `vite preview`), signed in as the article's owner, nothing
running, nobody touching the page, the in-page probe (`?perf=1`, `__perf.report()`) over 30 seconds:

| at rest, 30 s | desktop | iPad emulation |
|---|---:|---:|
| `/api/jobs` requests per minute | **8** | **8** |
| timers per minute | 18 | 18 |
| instrumented component renders | 0 | 0 |
| whole renderer process, % of one core (`/proc`) | 3.2 | 3.3 |
| main thread, % of one core (`measure-cpu.ts`, CDP) | 0.9 | — |

Every recurring timer in that window is either the poll or the Supabase SDK's own 30-second token
tick. Plain mode is the same; so is Summary. It is not the mode, the article or the device: it is the
page.

**The cause.** [`jobEngine.ts`](../../src/web/jobEngine.ts) polls every eight seconds while *any*
`useJobs` subscriber is mounted, and stops when none is — its header says an owner reading an
article with nothing running "costs one poll at session start and then silence". That sentence
was written on 2026-09-01 (`2a0ae3d9`) and was never true, because three days earlier
(`f42a8771`, *Adding an article stops waiting for the arc*) `OwnedReader` in [`ArticlePage.tsx`](../../src/web/article/ArticlePage.tsx) calls
`useArc(slug, article.arc)` for every owner's article, and `useArc` calls `useStepJob`, which calls
`useJobs`. So one subscriber is mounted for as long as an owner has an article open, and the engine
sits on its idle cadence for ever.

The comment immediately above that line explains why glossary and quotes were split so that their
job subscribers stay *down in their bands*: *"a job subscriber mounted here would hold the job engine
to its idle cadence for every reader of every article"*. The arc is the one that slipped past the
rule, and nothing enforces the rule; `tests/idle-work.test.ts` and
`tests/public-network-trace.test.tsx` both check the engine or a visitor, never an owner's reading
view at rest.

**Is this the battery drain?** It is a plausible share of it and cannot be shown to be all of it.
What it costs is certain: about 450 requests an hour per open tab (eight seconds after each
response, so at most 7.5 a minute), every one a serverless function invocation and a database query
of ours, to learn that nothing has changed. What it costs the iPad is not measured: a radio asked for
something every eight seconds has less chance to settle into its low-power state, which makes it a
plausible share of the drain, not a demonstrated one. It stops when the tab is hidden
(Safari also suspends hidden tabs), so it is paid while the article is open on screen — which is
exactly when Greg is reading.

### 2. Scrolling costs about 55–60% of a desktop core, and our JavaScript is a small part of it

Same production build, 30 seconds of synthetic wheel scrolling, 500 events × 120px, `measure-cpu.ts
--scroll`:

| scrolling, 30 s, prod build | Plain | Summary |
|---|---:|---:|
| main thread busy, % | 55.3 | 60.0 |
| of which script | 8.4 | 8.9 |
| of which style | 8.4 | 7.4 |
| of which layout | 0.9 | 0.9 |
| `Reader` / `SummaryPanel` / `Spine` renders | 110 / — / 77 | 82 / 82 / 51 |
| p95 frame | 33ms | 33ms |

Under iPad emulation the whole renderer read 95–98% of a core during the same scroll, plus 25–35% in
a second process (compositing, in software, headless). **About 38–43 points of the main-thread
figure are neither script, style nor layout** — the same unattributed bucket
[performance.md § What is left, and it is not script](../project/performance.md#what-is-left-and-it-is-not-script)
found on 2026-09-04 and left open: paint, compositing commit, hit-testing. This is what reading
*actively* costs, and on an iPad it is GPU and battery. It is also not an afternoon's work: finding it
needs a Chrome trace with paint attribution (`LayerTree.layerPainted` does not fire under headless —
tried), and the obvious levers (fewer re-renders on `?at=`) move the 8% that is script, not the 40%
that is not.

### 3. Ruled out, with the reason

- **CSS animations.** 20 infinite `animation`s in the stylesheets, and none running at rest in either
  state: `document.getAnimations()` returned zero running under iPad emulation. Every spinner is
  unmounted when idle rather than hidden with opacity. The logo animations ignore touch
  `pointerenter` and end 4.5s after a long press (`logo-animation.ts`).
- **A stuck job polling at one second for ever.** Bounded, but not by one lease: `REQUEUE_BUDGET = 2`
  permits three 760-second lease windows (`src/jobs.ts`), about 38 minutes, before terminal
  settlement. That rules out an hours-long steady loop; with no production database access from this
  box, Greg's own queue was not checked, so a busy job contributing during the reported session is
  not ruled out. (GPT Sol, plan review F6.)
- **Observers, touch listeners, media.** Every scroll, touch and wheel listener is passive; no
  `selectionchange`; `visualViewport` only while a dialog is open; no WebSocket, EventSource, worker or
  microphone at rest; Sentry runs with `defaultIntegrations: false` and no replay or tracing.
- **The Summary band.** Re-renders on every `?at=` write by design (it follows the reader), 82 times
  in 30 seconds of scrolling; its cost sits inside the 8.9% script above.

## What we are doing — stage 1

**A job subscriber that does not buy the idle cadence, used by the arc.**

`jobEngine.subscribe` gains a sibling, `subscribeQuietly`: the same notifications, the same snapshot,
but it does not count towards `subscribers.size` in `schedule`. `useJobs(onFinished, { idle: false })`
subscribes through it; `useStepJob` passes the option through; `useArc` uses it. Everything else is
unchanged, including every mode band, which still asks for the eight-second courtesy while it is open.

What the arc keeps, because busy polling does not depend on subscribers at all: the job it starts on
arrival is still polled every second while it runs, still driven, and its completion is still
announced (the poll that sees it `done` is a busy poll). What it gives up: an arc job started by
*another* tab while this one sits idle is not noticed until the next poke, focus or visibility change.
That is the trade the mode bands already make whenever they are closed.

**Tests, red first.**

1. A hook-level test beside `tests/idle-work.test.ts`: mount `useArc` with an arc in the payload, a
   bound session and an empty queue; after the mount poll, a fake minute passes with **zero**
   requests. Red today (about seven).
2. **The class guard**, which is the part that matters: an *owner's* reading view, whole `App`,
   signed in, nothing running — after the session's first `/api/jobs`, a fake minute passes with no
   further `/api/jobs`. Its positive control is the same view with a mode band open that subscribes
   normally, so a harness that sees nothing cannot pass. This is the check that would have failed on
   2026-08-29, and it catches the next job subscriber mounted at the top of the reading view,
   whichever feature brings it. Hosted in `tests/public-network-trace.test.tsx` if its `App`
   harness can take fake timers, otherwise in a new file with the same harness.
3. Mutation check at the end: swap `useArc` back to a normal subscription and watch 1 and 2 go red.

**Instrument.** `measure-cpu.ts` prints a `fetches:` line from the in-page probe beside `renders:`, so
the standard recipe shows a page's at-rest network cost without anyone opening a console — the thing
nobody saw for two weeks was a request every eight seconds, not a CPU number.

**Docs.** The engine header's "one poll at session start and then silence" becomes true again and
says what keeps it true; `useStepJob`'s *"the cost, said out loud"* gains the quiet form;
`ArticlePage.tsx`'s comment on `useArc` says why it is quiet; a dated section in
[performance.md](../project/performance.md) with the before/after and the measuring method, including
the WebKit dead end.

**Done looks like:** `npm test` and `npm run typecheck` green; the production-build measurement above
re-run showing `/api/jobs` at 0 per minute at rest (from 8), with the positive control still polling in
a mode band; GPT Sol code review.

## Stage 2 — the write-up

Postmortem under `docs/postmortems/` naming the class; the feedback note; the queue item marked done;
this plan updated with what landed.

## The simpler option passed over

**Slow the idle poll down** — eight seconds to sixty, one constant. It is one line and it cuts the
cost by seven-eighths. Passed over because it is still an unbounded loop on a page that has asked for
nothing, which is the shape the engine's hidden-tab rule already refused (`jobEngine.ts` §
`schedule`: "the clock **stops** rather than slowing, since a 'gentler' hidden interval is still an
unbounded loop"), and because it would also slow every
mode band's cross-tab progress, which is the one thing the idle cadence is for.

**Moving the arc's job half into a component mounted only while there is no arc** — the way glossary
and quotes were split — was the other candidate. It is the house pattern, but the arc's `working`
flag is read by `Reader` through the capability, so the split would thread a second piece of state
up through `OwnedReader` for a hook that is otherwise one call. A quiet subscription is fewer moving
parts, and it is reusable by the next surface that wants job state without the cadence.

## Plan review, GPT Sol, 2026-09-12

[260912a-ipad-battery-drain-review-sol.md](260912a-ipad-battery-drain-review-sol.md). Refused as
written on one established P1, and agreed the quiet subscription is the best of the three designs.

| ID | Finding | Disposition |
|---|---|---|
| F1 | P1: with only a quiet subscriber, a failed poll right after the arc's job POST stops the engine, and the job is never found or driven | Taken. An action leaves a versioned reconciliation obligation that only a *successful* poll discharges; red test first |
| F2 | The "watches its own job" test never starts or finishes one | Taken: the real lifecycle, 404 → POST → failed poll → retry → done → refreshed arc |
| F3 | An external-link hover card left open on touch mounts an ordinary `useJobs()` | Acknowledged, not built: the guarantee is "a reading view with no job-aware card open". Making the card quiet until an add is pending is named below |
| F4 | The whole-`App` guard covers Plain only, on an arc read as `{}` | Taken: Plain and Summary, with a valid payload arc |
| F5 | Device and browser claims exceed the measurements | Taken, wording above |
| F6 | One lease lapse does not fail a job; three windows do | Taken, wording above |
| F7 | "480 an hour" was 8/min × 60; it is at most 450 | Taken |

Not calling `wake()` from a quiet subscription: Sol agreed — session start already reconciles, the
arc's own POST pokes, and a mount wake would add a request per later quiet mount.

## Deferred, named

- **The external-link hover card's subscription** (Sol F3). On touch, a card stays open after the
  first tap, and while it is open its `useJobs()` holds the idle cadence. Quiet until an add is
  actually sending or queued is a two-line change in `ProseHoverCard.tsx`, but it changes the card's
  state logic and the card is not what the report was about.
- **Confirmation on the device.** Nothing here proves the iPad's battery. The check is Greg's and
  takes a minute: open an article with `?perf=1` added, leave it on screen for a minute, and run
  `__perf.report()` in the Web Inspector (Safari on a Mac, *Develop → iPad*) — `topFetches` should
  show no `/api/jobs` after the first. If the battery still drains, the next suspect is item 2.
- **Scrolling's paint and compositing bucket** (item 2): a Chrome trace with paint rectangles over a
  scroll on a DPR-2 viewport, to find what repaints. Its own piece of work.
- **WebKit on the box**, so this can be measured in Safari's engine: about twenty system packages,
  and a line in the box's build file — Greg's decision.

## Log

- 2026-09-12 — diagnosis and plan.
- 2026-09-12 — `measure-cpu.ts` now prints `fetches:`. The before, with the standard recipe on the
  production build, 60 s at rest in the reported state:
  `fetches: 8/min — /api/jobs=8`, main thread 0.5% of a core.
- 2026-09-12 — the red tests: `tests/arc-idle-poll.test.ts` (7 polls in a fake minute, 0 expected;
  controls green) and `describe("an owner's reading view, left alone")` in
  `tests/public-network-trace.test.tsx` (the whole `App`, Plain: 7 against 0; the Glossary band
  control sees 7). With `useArc` stubbed out the whole-`App` case saw 0 and the control still 7, so the
  red is the arc's. One harness trap: switching on fake timers *after* the page settles passes over
  the bug, because the next poll is already waiting on a real timer — the clock goes on before
  `open()`.
- 2026-09-12 — implementation started while the Sol plan review was still running: the change is
  small and pinned by the red tests. Any plan finding is folded in before the code review.
- 2026-09-12 — stage 1 built (F1, F2, F4 folded in). Mutation: `useArc` back to an ordinary
  subscription turns 4 cases red — the arc at rest, the stated trade, and the owner-at-rest guard in
  Plain and Summary. F1's obligation disabled turns the arc lifecycle case red at "the job was still
  driven". Typecheck exit 0.
- 2026-09-12 — **the after**, same recipe, rebuilt production bundle (`index-B-Ce-z3L.js`, before was
  `index-BMzXmwV9.js`), 60 s at rest:

  | at rest, 60 s, prod build | before | after |
  |---|---|---|
  | Summary, the reported state | `fetches: 8/min — /api/jobs=8` | **`fetches: 0/min — none`** |
  | Plain | 8/min (30 s spike run) | **`0/min — none`** |
  | Glossary band open — the positive control | — | `8/min — /api/jobs=8`, as it should |
  | main thread, % of one core | 0.5 | 0.4–0.5 |

  CPU did not move and was never going to: the cost removed is requests, not script.
- 2026-09-12 — full `npm test`: 5 files red of 1,101 (6 tests of 23,919).
  - **Mine, and the intended effect:** `tests/the-ideas-extraction-changed-no-requests.test.tsx`
    records each mode's exact request trace. It expected a second `GET /api/jobs` between the
    article and the record-open POST — which was the arc's subscription polling as it mounted — and
    in the Ideas case the band's own `/api/jobs` now shows where the arc's used to hide it. Both
    fixtures updated, with the reason written beside them; a `/api/jobs` reappearing between the
    article and the POST is now itself the signal that something subscribes the ordinary way again.
  - **Not mine, environment:** `fleet-composed-access` (no `tools/fleet/web/dist` in a fresh
    worktree), `fleet-decisions-route` and `fleet-reports-route` (`process.exit(2)` in their
    `server.ts` wiring case), `models.test.ts` (an override variable unset). Each still red when run
    alone, and none of the four imports or names anything this change touches.
- 2026-09-12 — stage 1 committed, `44504398`.
- 2026-09-12 — **code review, GPT Sol, round 1**, write-capable
  ([260912a-ipad-battery-drain-code-review-sol.md](260912a-ipad-battery-drain-code-review-sol.md)).
  Exit 0, answer present, no self-review provenance line. Its fixes were read and re-run (15 files,
  150/150; typecheck exit 0) before committing.

  | ID | Finding | Disposition |
  |---|---|---|
  | F8 | P1: a failed session-start poll strands a job left by a reload or another tab when every subscriber is quiet | Fixed by Sol: `start()` owes a reconciliation |
  | F9 | P2: closing the last watching band leaves one trailing idle poll | Fixed by Sol |
  | F10 | P1: a list poll in flight when `/advance` 401s overwrites the auth error | Fixed by Sol: `pollWasOvertaken` on both continuations |
  | F11 | P1: the obligation was paid before `apply(jobs)` ran | Fixed by Sol: paid only after apply |
  | F12 | P2: the default still bundles the cadence into every `useJobs()`; the guard covers Plain and Summary, not the class | **Taken as stage 2**, and it overrules the postmortem's "wait for a third quiet caller" |

  Sol confirmed both trace-fixture edits are the intended effect, not a regression papered over.
  Committed as `2099d6da`.
- 2026-09-12 — merged `origin/dev` as `46259459`, clean: its 16 commits touch none of this change's
  files. It did change `src/web/useCitations.ts`, a `useStepJob` caller, so stage 2 covers the
  merged version.
- 2026-09-12 — **stage 2 built.** `QueueCadence = "watches-queue" | "quiet"`, a required first
  argument to `useJobs` and a required fourth to `useStepJob`, mapped to the engine's two stable
  subscribe methods through an exhaustive `switch` with a `never` arm. All sixteen call sites checked
  by hand against the source, not the diff's list: fifteen watch the queue (the shelf, the add page,
  the hover card's add-to-shelf, the Metadata rerun rows, `Tweets`, and every mode band's hook,
  including the merged `useCitations`), and `useArc` alone is quiet — so no caller's behaviour
  changed. `tests/queue-cadence-is-a-required-choice.test.ts` holds it at the type level: four
  `@ts-expect-error` calls, which fail the typecheck as unused the moment the argument becomes
  optional. Mutation, run by the builder: a default of `"watches-queue"` turned the tests-project
  typecheck red on exactly those lines. The postmortem's long-term section now says done, and why
  a required choice beat a quiet default.

  **The builder's own test run is not counted as evidence.** It launched a 79-file vitest run in tmux
  and ended its turn; that session's log stayed at 0 bytes with a blank pane for several minutes,
  and it then reported `EXIT=0` with no `Test Files` or `Tests` line in it. An exit code with no sign
  that any test ran is the shape docs/reusable/silent-success.md is about, so the stage-2 gate is a
  fresh full `npm test` in a session of mine instead.

  **Four mocks had to change with the signature**, found by that builder's first run (12 failures):
  `artefact-read-race`, `background-reload-keeps-the-list`, `citations-find-late-reply` and
  `glossary-one-fetch` mocked `useJobs` and read the completion callback as its first argument,
  which is now the cadence. They read the second now. Their fix landed at 12:27, while my full run
  was starting, so that run may have read either version of them; re-run alone with the new type
  test afterwards, 5 files, 26/26.
- 2026-09-12 — **stage 2's full `npm test`**: 3 files red of 1,103 (2 tests of 23,946), all three
  the fleet tests red before this stage for the environment (no `tools/fleet/web/dist`, and
  `process.exit(2)` in the `server.ts` wiring case). `models.test.ts`, red on the stage-1 run, is
  green since the merge of `dev`. The four rewritten mocks pass inside the full run as well.
- 2026-09-12 — **the mutation, re-run by me rather than taken from the builder's report**:
  `cadence: QueueCadence = "watches-queue"` in `useJobs` turns `npm run typecheck` to exit 1, on
  `tests/queue-cadence-is-a-required-choice.test.ts` line 27 (an unused `@ts-expect-error` — `jobs()`
  now compiles) and line 45 (the `expectTypeOf` on the parameter, which now admits `undefined`).
  Reverted, and the typecheck re-run.
  The pattern across F1, F8, F10 and F11 is worth one sentence: **the courtesy poll was silently
  retrying everything a failed request missed**, so declining it exposed each of those at once.

## Stage 2 — every caller says whether it watches the queue (Sol F12)

`useJobs` and `useStepJob` take the choice as a required argument, so the compiler refuses a caller
that has not made it: the fourteen that watch a queue (the shelf, the add page, each mode band, the
Metadata rerun rows, the hover card's add-to-shelf) say so, and the arc says it does not. The class
in the postmortem — a cost bought by default by whoever forgot to decline it — then cannot recur
silently at any call site, not only at the top of the reading view the whole-`App` guard watches.
Chosen over flipping the default to quiet, because a quiet default would make the *opposite* mistake
silent: a new band that forgot to ask would stop showing another tab's run and look broken.
