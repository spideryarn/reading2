# Auto-generate the main modes after an import

Status: plan, 2026-09-30. Sentry SPIDERYARN-READING2-5Y (report `spya-sufetx`), from Greg (admin,
verified by account id). Note:
[260930_0553](../user-feedback/260930_0553-main-modes-generate-after-import.md).

> When I start importing a paper, and the import process is running and I can see it's doing a bunch
> of stuff, give me a tick box that's probably default-true that will automatically run the
> generation for all of the main modes, i.e. the ones that are not experimental features. So in
> other words, it'll automatically generate the structure and the summary and the quotes and ideas
> and trajectory and glossary. Probably trajectory will be last because it depends on all of those
> others. And we really want the import process to be as fast as possible. So in an ideal world, it
> would do the absolute bare minimum and open the paper and then immediately kick off all of those
> other activities, you know, perhaps in parallel. So even now, I think it first generates the
> structure and the summary before it opens. In an ideal world, it would open the paper before
> they're ready and immediately kick them off. And those modes would say something like, Ah, you
> know, it's still in progress. I don't know how complicated that would be. So if that's making this
> much harder, do the simpler thing first of just a way to automatically kick off the other modes
> once the paper is open, because I know that that's already possible, I think.
>
> — Greg, 2026-09-30

## What this ships, and what it leaves

**Ships: Greg's fallback.** A tick box on the add page (`/add/<url>` and `/add/upload/<id>`), on by
default, shown while the import is running. When the import finishes and the page opens the article,
if the box is ticked, the page queues one job per main mode. The modes already run in parallel
(4C, [260929c](260929c-modes-generate-in-parallel-on-one-article.md)), and a mode opened while its
job is queued or running already shows that job's progress rather than a Generate button, because
`useStepJob` finds the active job writing its step.

**Deferred: opening the paper before Structure and Summary exist.** Structure and Summary are not
generated separately: both read the tree that the `hierarchy` step builds, and that step is inside
the import (`DEFAULT_INGEST_STEPS`, src/pipeline.ts). Opening before it would mean publishing an
article with blocks but no tree, and teaching the reading view, the spine, Structure, Summary, the
shelf card and the public page what an article with no tree looks like. That is exactly the "much
harder" Greg names, so it is not in this piece. What it would buy: `hierarchy` is the only slow
thing left in an import (locally a median of 44 s, 254 s at worst over the last three weeks;
`labels` already left the blocking path on 2026-09-06). See § Deferred.

## Which modes are "main"

Read from the code, not from Greg's list, as the brief asks. The main modes are those with
`experimental: false` in `MODE_CATALOG` (src/mode-catalog.ts): Plain, Chat, Glossary, Search,
Summary, Ideas, Quotes, Structure, Trajectory, Tweets. Of those, the ones that **make** something
on a press are the ones `MODE_TARGET` (src/web/activation.ts) gives a step:

| Mode | Step it makes | Note |
|---|---|---|
| Glossary | `glossary` | |
| Quotes | `quotes` | |
| Ideas | `ideas` | |
| Trajectory | `trajectory` | reads Quotes and Ideas, so it waits for them (4C's line) |
| Tweets | `tweets` | Greg did not name it, but it is not behind the switch, so it is a main mode |
| Structure, Summary | none | read the import's tree; nothing to make |
| Plain, Chat, Search | none | nothing to make until the reader types |

So the tick box queues **`tweets`, `glossary`, `quotes`, `ideas`, `trajectory`**, in `STEP_ORDER`.
The list is **derived**, not written out: non-experimental modes, mapped through `MODE_TARGET` to
the step each makes. A mode moved in or out of the switch changes what the box queues with no second
edit, and a test pins today's answer so a change is noticed.

`arc` (the L0 gist column) is not in the list. It is not a mode, and `useArc` already queues it when
the owner opens the article, which this flow does straight away.

## The design

1. **`src/web/auto-modes.ts`** — a client leaf:
   - `autoModeSteps(): StepName[]` — derived as above, sorted by `STEP_ORDER`.
   - `readAutoModes() / writeAutoModes(on)` — the reader's choice, in `localStorage`, default on,
     every access in try/catch (private windows throw).
   - `queueAutoModes(run, slug)` — one `queue.run` per mode. Four are single-step (`tweets`,
     `glossary`, `quotes`, `ideas`) and are posted together; **Trajectory's job is
     `["quotes", "ideas", "trajectory"]`** and is posted after those four have answered. One job per
     mode, not one job with five steps, because one job runs its steps one after another and the
     point is to run them side by side.

     *Changed after Sol's plan review (P1, P3).* The first draft posted five single-step jobs one
     after another and relied on Trajectory's job being the youngest, so the line would make it wait
     for Quotes and Ideas. But `created_at` comes from the app server's clock, so two POSTs handled
     by two instances can land out of order, and a Trajectory job that claims first refuses for want
     of Quotes. Carrying Quotes and Ideas in its own job makes it correct in any order. Normally it
     is younger, waits for the two jobs because it writes what they write, then skips both steps as
     current. It is also exactly the request the Trajectory panel posts when it has neither
     (`precededBy`, src/web/useTrajectory.ts), so opening the mode while it is queued joins this job
     (same work key) instead of adding a second. The dependency is read from `STEP_READS` in
     auto-modes.ts. That is a copy of `STEP_SHARING`'s `reads`, because src/sharing-steps.ts takes a
     type from src/store/ and the browser may not import it, even for a type. A test keeps the two
     copies equal.
2. **`AddPage.tsx`** — the tick box, under the progress card while the job is queued or running;
   and in the `done` effect, when ticked, `void queueAutoModes(...)` **and navigate at once**. The
   POSTs are not awaited before navigating: the router is client-side, so the fetches carry on, and
   the reader gets the article without waiting on five round trips. The job engine is app-wide, so
   the jobs are driven from the reading view.
3. **The copy** says what it does and that it costs: *"Generate the main modes when it's ready"*,
   with a line naming them. No price in the bar, per the house rule in `MODE_CATALOG.how`.

Nothing on the server changes. `POST /api/jobs` with `{ slug, steps }` is the route every mode
press already uses, spends no billing slot (docs/project/billing.md: only a request carrying a `url`
does), and de-duplicates on the work key, so opening Quotes while its auto job is queued joins that
job rather than making a second one.

### What the reader waits on, honestly

The import's publication queues the free `labels` successor, and `labels` is not a sharing step
(src/sharing-steps.ts), so every mode job queued after it waits for it. Locally `labels` takes a
median of 21 s (max 28 s). So the modes start about half a minute after the article opens, not at
once — the same wait a reader who opens Quotes straight after an import has today. Making `labels`
overlap is 4C's recorded deferral (it rewrites `tree`), not this piece's.

The machine-wide cap of three running jobs (`SPIDERYARN_JOB_CONCURRENCY`) is unchanged, so of the
five, three run at a time.

## What it costs

Every mode is a paid call through OpenRouter ([ai-gateway.md](../project/ai-gateway.md)). Per job,
from the local `ai_calls` ledger over the last three weeks (small samples, local fixture articles —
a long paper costs more):

| Step | Median | Max seen |
|---|---|---|
| ideas | $0.131 | $0.183 |
| glossary | $0.072 | $0.073 |
| quotes | $0.070 | $0.096 |
| tweets | $0.023 | $0.100 |
| trajectory | $0.016 | $0.036 |
| **Total per import** | **≈ $0.31** | **≈ $0.49** |

That is on top of the import itself and the `arc` and `labels` calls it already makes. It is paid
for every import with the box ticked, whether or not the reader ever opens those modes; default-on
is Greg's call ("probably default-true"). There is no per-reader spend cap
([ai-gateway.md § What stops a reader spending our money](../project/ai-gateway.md#what-stops-a-reader-spending-our-money-and-what-does-not)),
and this adds none: a reader could already press all five buttons.

## The simpler and harder options passed over

- **Queue the mode jobs on the server, at the import's publication** — the way a reset queues its
  regenerations (`enqueueSuccessorIn`, src/store/pg-revisions.ts). More robust: it would not need
  the add page to be open when the import finishes. But the tick box is shown *while the import
  runs*, so the choice would have to be written onto a running job (a new column, a migration, a
  route to change it, and the publication reading it under the fence). Passed over for v1; it is the
  natural second step if readers close the add page mid-import and miss their modes.
- **One job carrying all five steps.** Runs them one after another. Slower, and it is what 4C was
  built to avoid.
- **Store the choice on the reader's profile.** A column and a `PATCH` for one checkbox; the
  `localStorage` version is per browser, which is fine for a default.

## What it does not do

- **If the add page is closed before the import finishes, nothing is queued.** The import still
  finishes (the job engine drives it from any page), but the modes are not queued. The same is true
  of a tab closed in the second or so while the POSTs are going out, and of a POST that fails. After
  the page has gone nothing reports the failure. The mode then shows its ordinary Generate button
  (Sol P4). Closing that gap is the server-side option above.

### When Quotes or Ideas do not come out (Sol P2)

| State | What Trajectory's job does |
|---|---|
| Quotes and Ideas jobs succeed | waits for both, skips its first two steps, makes the route |
| The Quotes job fails | runs Quotes once more itself. If that fails too, the job fails, and the Trajectory band shows the failure with the ordinary retry, as it does after a press |
| Quotes succeed, but there is no body quote to route through | refuses with `TRAJECTORY_NO_QUOTES` — the same answer a press gets |
| Re-add of an article that already has current Quotes and Ideas | both skip; Trajectory runs if it is missing, else skips |

A failed automatic Trajectory is shown exactly as a failed pressed one is. That seemed right rather
than something to add machinery for.
- **Re-adding a URL already on the shelf** goes through the same `done` path, so with the box ticked
  it queues the five jobs; each finds its artefact current and skips without a model call, except
  for a mode the article never had, which is then made. That is what the box says.
- **The home page's own add box** navigates to the add page, so it gets the box too; nothing else
  starts an import.

## Tests

- `tests/auto-modes.test.tsx`: the derived list is exactly the five, in order, and every one is a
  non-experimental mode's step. Trajectory's request is `["quotes", "ideas", "trajectory"]`, and
  `STEP_READS` equals `STEP_SHARING`'s reads. Trajectory is posted only after the other four have
  answered. `queueAutoModes` carries on past a failed POST. The choice is remembered.
- In the same file, the add page: the box is shown while the import runs and is ticked by default;
  on `done` it queues the jobs and opens the article, and when unticked it only opens the article.
  Each assertion that guards a decision was watched red by breaking the code.
- Browser check in a Sonnet subagent: import an article locally with the box ticked, confirm the
  modes open showing progress, then the content.

## Deferred

1. **Open before `hierarchy`.** The ideal Greg describes. Needs: publish after `blocks` (+`assets`),
   `hierarchy` as a successor, and every tree reader handling "no tree yet" with a "still in
   progress" line. A plan of its own.
2. **Queue on the server at publication**, so closing the add page does not lose the modes.
3. **Let `labels` overlap mode jobs** (4C's deferral), which would take ~20 s off when the modes
   start.

## Review record

**GPT Sol on the plan** (`gpt-5.6-sol`, high, read-only; exit 0, answer file fresh):
[260930c-…-plan-review-sol.md](260930c-auto-generate-the-main-modes-after-import-plan-review-sol.md).
Verdict *build with changes*. Every finding taken:

- **P1** — relying on job age for Trajectory is unsound across instances. Fixed by the request shape
  above.
- **P2** — the failure states listed in the table above.
- **P3** — opening Trajectory would have added a second job. Fixed by the same shape.
- **P4** — a lost POST goes unreported. The four independent POSTs now go together, to shorten the
  window, and the gap is recorded above. Making it durable is Deferred 2.

Sol also confirmed the derived list, that a bare-slug job spends no ingest slot, and that nothing
caps a reader's active jobs beyond the machine-wide three.

(GPT Sol on the code: to be filled.)
