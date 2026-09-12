Refuse as written because F1 is an established P1. The core diagnosis and chosen quiet-subscription design are otherwise sound.

### Findings

#### F1 — P1 — Established: a transient reconciliation failure can strand an arc job

(a) After `queue.run()` succeeds, `actionSucceeded()` calls `poke()` ([useJobs.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb36-ipad-battery-drain/src/web/useJobs.ts:308)). If that `/api/jobs` request fails while the previous snapshot is empty, the catch schedules `IDLE_MS`; `schedule()` then sees no busy job and no ordinary subscriber and declines to arm the timer ([jobEngine.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb36-ipad-battery-drain/src/web/jobEngine.ts:420)).

The server may therefore contain the newly created arc job, while this tab never discovers or drives it. On Vercel that can leave the arc job stalled and `useStepJob.starting` stuck until focus, visibility change, or another action.

This also applies to a non-401 action failure because a failed client request does not prove the server did not commit it.

(b) Courtesy polling may stop after a successful idle reconciliation, but an action must create a reconciliation obligation that survives failed polls. Use a version rather than a boolean so an older in-flight poll cannot discharge a newer action:

```ts
let reconciliationRequested = 0;
let reconciliationCompleted = 0;

// In actionSucceeded, and non-401 actionFailed:
reconciliationRequested += 1;
poke();

// Capture when a poll begins:
const requestedAtStart = reconciliationRequested;

// Only after that poll succeeds:
reconciliationCompleted = Math.max(reconciliationCompleted, requestedAtStart);

// In schedule:
const reconciliationOwed =
  reconciliationCompleted < reconciliationRequested;

if (
  !isBusy(snapshot.jobs) &&
  subscribers.size === 0 &&
  !reconciliationOwed
) return;
```

Reset both counters in `teardown()`. Add a test where the arc POST succeeds, the first post-action `/api/jobs` fails, and the retry discovers and completes the job.

#### F2 — P2 — Established: the purported lifecycle test neither starts nor completes an arc job

(a) The busy case in [arc-idle-poll.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb36-ipad-battery-drain/tests/arc-idle-poll.test.ts:180) supplies an arc in the payload, injects a running job after `jobEngine.start()`, and makes every advance return `busy`. It therefore tests neither “the job the arc starts on arrival” nor completion announcement.

With the live no-`wake()` implementation, it is also internally mismatched: the session-start response was constructed while `queue` was empty, and the later quiet mount deliberately does not reconcile. The injected job need not be discovered at all.

(b) Replace that case with the real lifecycle:

```text
GET /api/arc -> 404
POST /api/jobs -> returns job J
first post-action GET /api/jobs -> transient 500
retry GET /api/jobs -> J queued
POST /api/jobs/J/advance -> done; server list becomes J done
next GET /api/jobs -> J done
completion callback -> refresh GET /api/arc -> valid arc
```

Assert one job POST, at least one advance, the refreshed arc is present, and `working` returns to false. This test also closes F1.

#### F3 — P2 — Established: `useArc` is not the only possible Plain/Summary subscriber at rest

(a) On a clean, untouched Plain or Summary page, `useArc` is the only job subscriber. Summary itself only derives data from the article ([SummaryMode.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb36-ipad-battery-drain/src/web/modes/summary/SummaryMode.tsx:38)).

However, an addable external-link card mounts `WithAddToShelf`, which calls ordinary `useJobs()` ([ProseHoverCard.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb36-ipad-battery-drain/src/web/ProseHoverCard.tsx:757)). On touch, an external-link card remains open after the first tap. An iPad left resting in that state will continue the eight-second cadence after this fix.

(b) Either narrow the plan’s guarantee to “a clean reading view with no job-aware transient surface open,” explicitly naming the card, or make that subscription quiet until an add is actually pending:

```ts
const watchesQueue =
  state?.kind === "sending" || state?.kind === "queued";

const queue = useJobs(undefined, { idle: watchesQueue });
```

That second change is separable work; acknowledging the exception is sufficient for this plan.

#### F4 — P2 — Established: the whole-App guard is feasible, but Plain alone is not the strongest version

(a) I ran the one permitted file:

```text
npx vitest run tests/public-network-trace.test.tsx
63 tests: 62 passed, 1 expected-red failure
Plain idle guard: received 7 polls, expected 0
```

The Glossary positive control passed. This establishes that the harness sees the regression and that the semantic guard would have failed against the 2026-08-29 behavior.

The current negative case covers only Plain ([public-network-trace.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb36-ipad-battery-drain/tests/public-network-trace.test.tsx:2908)). A subscriber introduced only inside Summary would pass it. The owner fixture also has no payload arc and accepts the mock’s malformed `{}` arc response as ready.

(b) Parameterize the negative case and serve a valid payload arc:

```ts
it.each(["plain", "summary"] as const)(
  "asks once and then stays silent in %s",
  async (mode) => {
    owned = () => json({ ...OWNED, arc: ARC });
    await open(`?mode=${mode}`);
    // existing first-poll and fake-minute assertions
  },
);
```

Keep Glossary as the positive control.

#### F5 — P3 — Reasoned: the device and browser claims exceed the measurements

(a) The evidence is headless Chromium, partly under device emulation. It does not establish that scheduling and rendering work are “the same on any browser,” that each request woke the iPad’s radio, that this is the costliest quiet-page operation, or that the unattributed Chromium work is iPad GPU cost. Likewise, the table’s “renders: 0” counts only components instrumented with `useRenderCount`, not every React render.

These statements could cause the next investigation to treat the battery cause as established when the plan correctly says it was not measured.

(b) Replace the relevant claims with:

> These runs establish this build’s fetches and instrumented timers/renders, plus Chromium’s measured CPU categories under emulation. They do not establish Safari scheduling, iPad radio or GPU cost, or causality. Repeated polling is a plausible contributor to the reported drain; the unattributed Chromium work is a lead for a device trace.

Label the table row “instrumented component renders.”

#### F6 — P3 — Established: one lease lapse does not fail a stuck job

(a) The plan says a lease lapses at 760 seconds “and the job is then failed.” `REQUEUE_BUDGET = 2` permits three lease windows in total ([jobs.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb36-ipad-battery-drain/src/jobs.ts:306)). A no-progress job can therefore remain active for roughly 38 minutes, provided polling/advancing continues to run the settlement sweep. Since the production job list was not inspected, that does not rule it out as a contributor during a shorter battery-drain episode.

(b) Replace it with:

> **A stuck job polling at one second indefinitely.** Bounded, but not by one lease: `REQUEUE_BUDGET = 2` permits three 760-second lease windows, about 38 minutes, before terminal settlement. This rules out an hours-long steady-state loop; without inspecting the production queue it does not rule out a busy job contributing during the reported session.

#### F7 — P3 — Established: the hourly request count is wrong

(a) An eight-second delay after each response is at most 7.5 polls/minute or 450/hour, slightly less once response time is included. “480 requests an hour” comes from multiplying the rounded display value of 8/minute.

(b) Replace every `480 requests an hour` with `about 450 requests an hour`.

###### Other conclusions

The quiet listener itself preserves snapshots, teardown, session fencing, `working`, busy polling, terminal-job observation, and completion draining: the live implementation includes quiet listeners in `emit()`, while `useJobs` retains the same completion cursor and effect. A terminal failure reaches `useStepJob.failed`, although `useArc` already discards that field rather than exposing it as its own `error`; the quiet change does not worsen that existing behavior.

Not calling `wake()` from `subscribeQuietly` is the better choice here. The arc’s own POST calls `poke()`, session start already reconciles initial state, and a mount wake would add one request per later quiet mount. The given-up case—discovering another tab’s job merely because this hook mounted—should be stated as part of the trade and tested accordingly.

Slowing the idle interval is worse: it preserves the unbounded loop and degrades mode-band cross-tab responsiveness. The component split is viable but adds state plumbing without improving correctness. After F1 is addressed, the quiet subscription remains the best of the three designs.