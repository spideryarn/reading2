# Review: the plan for A8 — share measured geometry, but profile before building anything

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/a8-shared-geometry` (a git worktree),
branch `worktree-a8-shared-geometry`. TypeScript + ESM, React 19 client under `src/web/`, Vite,
vitest. This is **a review of a plan document, before any code is written.**

## The candidate

Live pre-commit; base `cc749e0f1061583f1a8877dc3db5b6c1b2c162e3`.

Untracked, and the only file to review:
`docs/plans/260906d-share-measured-geometry-after-profiling-scroll-and-layout-reads.md`

Read that first, in full. This is where to begin, not the limit of scope — the source files it
names are in the tree and you should read them.

The parent brief it must satisfy is
`docs/plans/260905e-main-app-architecture-review.md` — its § "A8. Share measured geometry without
forcing all navigation to mean the same thing" and its checklist under
"## Implementation stages and handoff" → "### Stage: Consolidate geometry only after the preceding
baseline". **That checklist is the authority; the plan under review is only how it gets run.**

The immediately preceding job, whose measurements and harness this plan builds on, is
`docs/plans/260905i-measure-annotation-computation-before-optimising-it.md` (A7). Its decision-rule
section and its "Stage 1a result" section are the shape this plan is imitating.

## What it is meant to do

The review item says: **profile the actual scroll and layout reads now that A7 has landed, and if
they are not material, close the stage as deferred with the evidence** — a new observer service has a
real maintenance cost. Only if the profile convicts does anything get built, and then only a pilot on
two consumers, with a standing instruction to stop if the subscription machinery outweighs a small
duplicated measurement.

The invariants the plan must not break, taken from the review item:

- **Three consumers do not all ask the same question.** The URL (`?at=`) tracks the section under the
  sticky line; the fisheye tracks its own focus line 40% down; explicit navigation owns a glide
  target. These must not collapse into one answer.
- **Fresh on-demand measurement is preserved for an explicit jump** until cached measurements have
  proved equivalent. A stale fast answer is the wrong optimisation for navigation.
- **Observing the article's total height is insufficient** — rows can redistribute while that height
  stays equal — so app-owned changes must invalidate explicitly.
- Tests must retain `src/web/position.ts`'s fine-grained `?at=` preservation inside a section,
  suppression during a programmatic glide, interruption by a real gesture, and link/history semantics.
- **Count layout reads and listener teardown, not only the resulting block ids.**
- Deliberately out of scope: prose virtualisation, replacing the HTML table, a new navigation state
  machine, restructuring `App.tsx` (a concurrent job owns that file), renames, `styles.css`.

The key source files: `src/web/App.tsx` § `useReadingPosition` (~line 1507),
`src/web/useColumnContext.ts`, `src/web/position.ts`, `src/web/rows.ts`, `src/web/fonts.ts`,
`src/web/scroll.ts`, `src/web/Spine.tsx` (§ `measure` and its scroll effect),
`src/web/keynav.ts` § `measureRow`, `src/web/DiagramPanel.tsx` § `useReaderRow`,
`src/web/ContextPanel.tsx` § `place`, `src/web/safe-area.ts`,
`src/web/annotation-cost.ts` and `src/web/perf.ts` (the instrumentation model),
`scripts/measure-annotation.ts` (the harness to be extended).

`docs/project/performance.md` § "Still open, ranked, with citations" item 4 is the prior art for the
optimisation the plan contemplates.

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`), and build a
throwaway harness under `/tmp`. You have **no network, not even loopback**, so anything needing
Postgres, the Vite preview server or a browser will fail — none of that has been run yet either,
because this is a pre-build plan review.

Two empirical claims in the plan came from subagent surveys I have not independently re-derived, and
you cannot re-derive the second one either. Treat them accordingly and say so if a finding leans on
them:

1. The layout-read census (which call site runs on which cadence). This one you **can** check against
   the source, and I would value you checking the load-bearing ones.
2. The corpus survey — `m1-kuhn-spya-a2zrjb` has 2,046 blocks and **1,237 sections** with gists;
   `replication-crisis-spya-hrjamq` has 551 blocks and 51 sections. This came from running the app's
   own `buildGeometry`/`buildSections` against the local Postgres, which you cannot reach.

## Attack it

Independently, before you read my questions below.

The thing to break: **this plan's ability to reach a wrong verdict and not notice.** It has a
precommitted decision rule with an "optimise" branch and a "defer" branch. Ask whether the rule, the
instrument it will be applied to, and the workload it will be applied on can produce a confident
answer that is wrong — in *either* direction. A7's own review found exactly this class twice (a
comfortable number on a workload too light to convict; a leaf-clock instrument that perturbed the
interval it was timing), and both fixes are quoted in this plan, so the question is whether they were
imported correctly or only cited.

Second: whether the plan's stage boundaries are honest. Stage 2 claims to run "whichever way Stage 1
decides" because it adds no machinery. Is that true, or does it smuggle in a behaviour change?

Third: whether Stage 3's design, if reached, actually preserves the three distinct questions and the
fresh-jump rule, or whether the plan's own wording leaves a route to collapsing them.

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is **established** or **reasoned**
  - (a) the concrete scenario the plan does not handle, or the authoritative contract it contradicts
  - (b) the smallest change that closes it — exact replacement wording
A finding with no (a) goes last.

Severity, graded by consequence:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

A defect in a *plan* that will cause a P1 to ship is a P1, not a P3 because it is made of prose.

Refuse only on an **established** P0 or P1, and name what established it. Established means direct
evidence with no unresolved material inference — an exact source path that demonstrates the
violation, or an authoritative contract the plan directly contradicts. If a load-bearing premise is
still inferred, the finding is **reasoned**: it ranks and informs, but does not block.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself. Spend
most of the run elsewhere.

1. **The 4ms per-frame threshold is invented.** I argued it down from A7's 8ms because this cost is
   paid every frame rather than once per gesture. Is a wall-clock-ms threshold even the right shape
   for a per-frame sampler, or should the rule be about dropped frames / long tasks, which is what a
   reader actually perceives? I have added long-task counts as a reported column but not as a
   threshold.
2. **The instrument may not be able to see what matters.** The plan itself argues that `S` rect reads
   inside one rAF callback with no interleaved write cost *one* forced layout plus `S` cheap lookups —
   so an inclusive wall-time timer around the sampler might correctly report a small number even
   though the browser is doing a large synchronous layout, because the layout is charged to whichever
   read happened to trigger the flush. Does timing these functions actually attribute layout cost, or
   does it only attribute the JS around it? If the latter, the whole Stage 1 measurement is
   mis-specified and I would rather know now.
3. **The heavy workload may be degenerate.** `m1-kuhn` has 1,237 sections over 2,046 blocks — nearly
   one section per two blocks, a very wide shallow tree. Is a verdict earned only on that article
   worth anything, given the next-heaviest real article has 51 sections? The plan says to measure both
   and report which produced the verdict, but does not say what to do if only the wide tree convicts.
4. **Stage 2 may not be free.** Caching `safe-area.ts`'s `getComputedStyle` changes when a safe-area
   inset is observed to change. On a phone, rotating or showing/hiding browser chrome changes it.
   Have I named enough invalidation triggers, and is "invalidated on resize/orientation change"
   actually sufficient?
5. **`DiagramPanel`'s `useReaderRow` was not in the review's scope** and I have added it to the
   measurement. Is that scope creep that will make this job unlandable, or is leaving out the heaviest
   per-frame consumer the worse error?

Do not change any file.
