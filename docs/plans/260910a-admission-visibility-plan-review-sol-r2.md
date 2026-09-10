Verdict: **REFUSE as written.** F8–F12 are established P1s. F3 and F4 remain insufficiently closed; F6’s request-path repair creates a smaller but real recurring-cost problem.

## Findings

- **F8 — P1 — established — `review` is a false census label.**  
  The census defines `review` as “codex” ([plan:194](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md:194)), but `codex exec` means a generic batch job, not a review. This plan itself proposes using it for implementation. The existing vocabulary correctly calls it `codex-batch`, and `run-codex.ts` accepts arbitrary prompts. A Stage 1 implementation task would therefore appear on screen as a review.  
  Smallest fix: call the observed class `codex-batch` or “Codex runs.” Keep `AdmissionRequest.kind = "review"` as the caller’s declared intent, but do not infer that intent from the executable.

- **F9 — P1 — established — process presence does not establish “active heavy work.”**  
  The screen heading asks “What heavy work is already running?” ([plan:63](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md:63)), while §5 explicitly says reviews and browsers have no measured cost model ([plan:237](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md:237)). A Chrome root may also be alive but idle or deliberately reconnectable; the existing browser rules document that case ([actions.ts:1015](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/actions.ts:1015)). Conversely, unrecognised heavy processes are simply omitted, not placed in `uncertain`. Thus the census can truthfully count recognised live process roots, but not active or heavy work. This leaves F3 insufficient.  
  Smallest fix: label it “Recognised live process roots: tests, Codex batch jobs, browsers,” state the finite recogniser scope, and leave “heavy/active” to resource measurements. If “heavy” must remain, add per-root resource evidence.

- **F10 — P1 — established — the counts erase unobserved time.**  
  The proposed three-class union includes `unobserved`, but that is not a stored sample: it is the absence of one ([plan:283](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md:283)). The history contract says gaps are recoverable only from spacing and `nextDueMs` ([health-history.ts:17](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/health-history.ts:17)); `history-series.ts` performs span algebra to calculate them ([history-series.ts:545](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/web/src/history-series.ts:545)).  
  Concrete scenario: one hour contains 60 readable samples, followed by 23 hours with no samples. The proposed card can say “60 readable, 0 refused, 0 could not be replayed” while saying nothing about the missing 23 hours. That is reassuringly wrong under a last-day heading.  
  Smallest fix: reuse the canonical coverage calculation and report unobserved duration/coverage beside the counts. Do not create a second interpretation; extract/share the existing span calculation or attach the admission aggregate to the existing health-history payload.

- **F11 — P1 — established — `computedAtMs` is not history freshness.**  
  Rescanning an old file now produces a fresh `computedAtMs`. If retention stopped ten hours ago, the timer can report a seconds-old cache whose newest observation is ten hours old. The existing history UI carries `lastAttemptAt`, `lastSuccessAt`, failure, poisoning and lock state specifically to prevent that lie ([HealthHistory.tsx:780](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/web/src/HealthHistory.tsx:780)).  
  Smallest fix: carry and render both calculation time and source freshness—at minimum newest observed sample time, right-edge coverage, and retention condition. A current scan of stale data must remain visibly stale or unknown.

- **F12 — P1 — established — the cache has no top-level failure lifecycle.**  
  The plan models unreadable individual processes and unreplayable individual samples, but not failure to enumerate `/proc`, failure to read the history store, the interval before the first computation, or one cached half failing while the other succeeds. Stage 2 only tests item-level failures and a stale successful cache ([plan:386](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md:386)). That violates the dashboard’s authoritative rule that a reading which could not be taken must not render as a reading ([overseer-direction.md:861](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/docs/project/overseer-direction.md:861)).  
  Smallest fix: define independent discriminated cache states for census and replay: not-yet-computed, current value, and failed attempt with cause and any explicitly stale last-good value. Catch each producer separately; the recurring loop must never throw out into the server. Test startup, top-level `/proc` failure, store-unreadable, and one-half-only failure.

- **F13 — P2 — reasoned — the timer relocates blocking; it does not remove it.**  
  At the synthetic bound, the same Node event loop still freezes for roughly 250 ms plus the census, now every cadence even when nobody views Box health. When the tab is open, `HealthHistory` continues its own 60-second scan ([HealthHistory.tsx:159](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/web/src/HealthHistory.tsx:159)), so there are still two history scans. This makes F6’s latency fix incomplete operationally, although it does make the admission GET cheap.  
  Smallest fix: compute the replay during the already-required health-history read, or maintain it incrementally as samples append. Only the census then needs periodic caching. If it gets a loop, use end-chaining rather than a fixed interval, following the server’s existing non-overlap rule ([server.ts:515](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/server.ts:515)).

- **F14 — P2 — reasoned — the census omits the identity/race rules its data source requires.**  
  Reading each PID’s `stat` and `cmdline` separately can staple an old parent relation to a reused PID’s new argv. The current execution code uses start ticks and before/after bracketing because this exact composition can otherwise describe a process that never existed ([execution-identity.ts:133](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/execution-identity.ts:133)). The proposed tests do not cover PID reuse, Codex interactive/server commands, fake Codex paths, or Playwright MCP arguments.  
  Smallest fix: reuse or extract the existing Vitest/Codex/browser recognisers, retain start ticks in the census snapshot, and classify changed-under-read as uncertain.

- **F15 — P2 — established — the GET accepts a cost field that cannot affect its answer.**  
  `GET /api/admission?kind=test&cost=light` and `cost=heavy` both invoke the fixed Vitest model; for non-test kinds both return `not-modelled`. The comment admits that `cost` is unused ([plan:216](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md:216)). This is unnecessary API surface that looks semantically active.  
  Smallest fix: keep the future `AdmissionRequest` type if the roadmap requires it, but do not accept `cost` on the current read-only forecast endpoint until a consumer exists.

- **F16 — P3 — established — two absolute factual claims need admission scope.**  
  “There is no claim file anywhere in this repo today, and no lock” and “the only thing in the codebase that stops work starting” ([plan:164](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md:164)) are literally false: the tree has writer locks, readiness locks and scheduler occurrence reservations. The intended narrower claim is true.  
  Smallest fix: say “no resource-admission claim file or admission lock” and “the only resource gate that stops an ordinary Vitest launch.”

## The three suspicions

1. **The stage is too big in its present composition.** Keep the live test forecast. Keep a narrowly labelled census if it reuses existing recognisers. Fold the historical aggregate into the existing history read instead of building a second timer/cache. Also remove the inert `cost` query surface.

2. **Deferring the unqualified “last refusal” is correct.** There is no complete fleet-wide source. The readiness store is a bounded source for token-matched refusals made through `scripts/readiness-run.ts`, so it could honestly show “last refusal recorded by the readiness runner,” but that does not satisfy the roadmap’s unqualified checkbox and is probably not worth another partial mechanism.

3. **Mixing ages on one card is acceptable if each datum carries its source time and scope.** Forecast and census can coexist with separate observation times. For history, cache-computation age is insufficient; it needs newest-observation and coverage/retention state.

F1, F2, F5 and F7 are closed. F3 and F4 are not; F6 is improved but leaves F13. The machine facts I checked agree: 16 cores, 4 GB reserve, worker file 2, about 31 GB RAM and 32 GB swap. The live history was 1,847,643 bytes with 1,347 readable memory samples across the current 24-hour window.

No files were changed and no implementation tests were run.