# Review: A8 stage 1 — the geometry instrument, and the verdict it produced

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/a8-shared-geometry`, branch
`worktree-a8-shared-geometry`. TypeScript + ESM, React 19 client under `src/web/`, Vite, vitest.

This is your **second pass** on this job. You reviewed the plan; this reviews the code and the
measurement built from it. Weight this pass higher than the first: a plan-stage review cannot find an
instrument that reports a confident number for the wrong reason.

## The candidate

Committed: `5fdf1065` (the plan) then **`914f59c4`** (stage 1 — the code and the result).

```
git diff 5fdf1065..914f59c4
```

Changed paths in the stage-1 commit:

```
scripts/measure-geometry.ts            (new, ~2000 lines — the harness)
src/web/geometry-cost.ts               (new — the counter module)
tests/geometry-cost.test.ts            (new)
tests/measure-geometry-refusals.test.ts (new)
src/web/App.tsx  src/web/ContextPanel.tsx  src/web/DiagramPanel.tsx  src/web/Spine.tsx
src/web/keynav.ts  src/web/perf.ts  src/web/safe-area.ts  src/web/scroll.ts
src/web/useColumnContext.ts            (instrumentation only)
docs/plans/260906d-share-measured-geometry-after-profiling-scroll-and-layout-reads.md
```

**Start with** `src/web/geometry-cost.ts`, then § "Stage 1 result, 2026-09-06" in the plan doc, then
the instrumented call sites. That is where to begin, not the limit of scope.

`src/web/annotation-cost.ts` is the module this was modelled on, and
`docs/plans/260905i-measure-annotation-computation-before-optimising-it.md` is the prior job whose
discipline it imitates.

## What it is meant to do

Stage 1 measures and decides. It must **not** change behaviour — a probe that changes the page
measures a page that does not exist. The decision rule was precommitted in the plan before the run
(§ "Decision rule"), and the verdict is **optimise**.

The accounting convention, which everything downstream depends on: **`reads` are exclusive** (a parent
counts only what it performs itself; nested leaves own theirs, so reads sum across all ten sites with
no double-counting) and **`ms` is inclusive** (so the ten ms values must never be summed).

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. You can run
`npx vitest run tests/geometry-cost.test.ts` — it is jsdom-only and needs nothing outside the tree.
**Please actually run it**, and please try to break it: mutate an instrumented call site in your own
`/tmp` copy and see whether the suite notices.

You have no network, not even loopback, so you cannot run the harness — it needs a Vite preview server
and Chrome. The raw harness output is at these paths, which will exist for the length of this session
only (they are session scratch, and I am naming them because there is nowhere durable to put 1.5MB of
run logs):

```
/tmp/claude-1000/-home-greg-code-spideryarn2/bccde256-313a-4664-a395-6f473c2f4fff/scratchpad/
  a8harness-b-kuhn.txt     a8harness-b-deep.txt     a8harness-b-repl.txt
  a8harness-kuhn-phone.txt a8harness-kuhn-gestures.txt
  (and .json siblings with the raw per-repetition vectors)
```

## Attack it

Independently, before you read my questions.

**The thing to break: whether this instrument earns the verdict it produced.** Specifically —

1. **Does the instrumentation change behaviour?** Any reordering, any extra read, any early-return
   moved, any closure capturing something it did not before. `noteGeometry` is called before an early
   return in `useReadingPosition` deliberately; check that and every other placement.
2. **Are the read counts right?** They are hand-maintained integers passed to `noteGeometry`, not
   observed. A wrong constant is invisible and would propagate into the plan's headline numbers. Check
   each site's claimed count against what the code actually reads, including the branches.
3. **Is the exclusive/inclusive accounting actually honoured** at every site, or does some parent
   count a read its leaf also counts?
4. **Can the harness report a plausible number for a page that did not render, or for the wrong
   article, or with the instrument absent?** A7 lost time to a 404 that looked like a very fast page.
5. **Does the verdict follow from the numbers under the precommitted rule** — including the parts of
   the rule that did *not* fire? Clause 2 (duty cycle) never fired and I said so; check I have not
   quietly leant on a clause that failed.

For each finding give:
  - an ID continuing from the first pass (next free is **F10**), a severity (P0/P1/P2/P3), and whether
    it is **established** or **reasoned**
  - (a) what shows it fails its own claim — the input, mutation or exact source path
  - (b) the smallest change that closes it
A finding with no (a) goes last.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

A measurement defect that will cause the wrong thing to be built is a P1, not a P2, because the
consequence is wrong work shipped.

Refuse only on an **established** P0 or P1, and name what established it.

## Previous findings — first pass, all accepted

| ID | Finding, in short | Disposition | What changed |
|----|-------------------|-------------|--------------|
| F1 | A self-timer attributes forced layout to whichever read flushed it, not the write that dirtied it | fixed | Three reported numbers; CDP `LayoutCount`/`TaskDuration` added; a counterfactual required before Stage 3 is authorised. Also spiked in a real browser before the plan was approved |
| F2 | Delayed image/font/viewport tests were required by the parent checklist and absent | accepted, not yet built | Added verbatim as a Stage 4 item; Stage 4 has not run |
| F3 | Stage 2 claimed to run "whichever way Stage 1 decides"; the cache is machinery | fixed | Stage 2 now runs only on an optimise; safe-area cache split into a conditional 2b |
| F4 | Combining all buckets lets an unrelated site authorise the pilot | fixed | Two verdicts; only `readingPosition` + `columnContext` may authorise Stage 3. This mattered: `contextPanelPlace` turned out to be the biggest cost and is now a separate follow-up |
| F5 | "Notify on selected-result change" is too narrow for `positionToWrite` | accepted, not yet built | Stage 3 rewritten; Stage 3 has not run |
| F6 | A median hides sparse bad frames; budgets not derived from a baseline; workload unpinned | fixed, with one modification | Workload pinned; p50/p95/max reported; refresh cadence measured as a noise floor. **Modification: the precommitted numbers stand and the baseline may only tighten them, never loosen them** — choosing the number after seeing the measurement is the failure a precommitted rule exists to prevent |
| F7 | Only the wide shallow heavy article was to be measured | fixed | Three articles; both heavy shapes measured, and both convicted |
| F8 | `ContextPanel`'s reflow-per-panel was asserted from call order alone | fixed and now established | Measured: 743ms in one gesture from 32 calls |
| F9 | No precommitted retain/revert rule for the pilot | fixed | Stage 5 rewritten as four conditions |

Treat the fixes as unreviewed code written by someone else, and spend most of the run on what has
changed since. F2 and F5 are accepted but **not yet built** — they belong to Stage 3/4, which do not
exist yet, so they are not defects in this candidate.

## My own suspicions — read last

Already my doubts, so confirming them is worth less than anything you find yourself.

1. **The read counts are hand-maintained constants.** `useColumnContext` computes `readsPerMeasure`
   once per effect from the resolved rows; `ContextPanel.place` passes a literal 9 or 8. Both are the
   kind of thing that is right today and silently wrong after the next edit. Is there a cheap way to
   make a wrong count go red, or is a comment the best available?
2. **Three sites are not covered by the suite** — `readingPosition`, `diagramReaderRow`,
   `contextPanelPlace` are module-local to large components. I have written that down rather than
   fixed it. Is that acceptable for a measurement instrument whose numbers authorise work?
3. **The verdict rests on clause 1 alone**, and clause 1's own justification was "as much as one
   subsystem may take before it is the reason a frame is missed". The frames here are 83–133ms, so the
   pilot is plainly *not* the reason they are missed. Is applying a precommitted absolute-ms clause
   sound when the frame it was reasoned against turns out to be 7× longer than assumed, or have I
   satisfied the letter of my own rule while missing its spirit? This is the finding I most want
   attacked.
4. **`contextPanelPlace` at 743ms dwarfs the thing I am about to build.** F4 correctly stops it
   authorising the pilot. But is it now perverse to build the pilot and leave that alone in the same
   file set?

Do not change any file.
