# Review: a plan to record what work was running when box load rose, and draw it beside the health trend

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/resource-history` (a linked git worktree),
branch `worktree-resource-history`. TypeScript + ESM throughout, run with `tsx`, tested with vitest.
It is an internal fleet dashboard for a single always-on Linux box that runs many coding-agent
sessions at once; it has no untrusted users. Nothing here touches the product's reader-facing code.

## The candidate

Committed: commit `0d3398e1`
           `git show 0d3398e1`
           changed paths: `docs/plans/260910a-resource-history-what-was-running-when-load-rose.md`
           (one new file, the plan itself — that is the whole candidate)

Start with the plan. This is where to begin, not the limit of scope: the plan makes claims about
existing code, and those claims are in scope and are the most valuable thing to check. The files it
claims things about:

- `tools/fleet/health-history.ts` — the 24h on-disk store (rotation, lock, torn-line repair)
- `tools/fleet/health.ts` — the collector and `computeVerdict`
- `tools/fleet/health-wiring.ts` — the composition root for the store
- `tools/fleet/refresh.ts` — the loop that calls `retainHealth`
- `tools/fleet/overseer-status.ts` — reads the Overseer's checkpoint; holds `parsePaneWork`
- `tools/fleet/wire.ts` — the server↔browser types (`PaneWork`, `PaneJob`, `OverseerWork`)
- `tools/overseer/work.ts`, `tools/overseer/work-reading.ts` — the classifier the plan reads from
- `tools/fleet/web/src/history-series.ts`, `HealthHistory.tsx`, `health-view.ts`, `HealthPanel.tsx`
- the roadmap stage it implements: `docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md`
  § "Stage: Resource history — show what was happening when load rose"

## What it is meant to do

The box runs many agent sessions concurrently. When load spikes, nobody can afterwards say what was
running. A 24-hour health trend already exists (load per core, memory used, swap used, IO wait,
drawn with gaps hatched and unknown readings kept distinct from zero). What does not exist is any
record of **what work was running**, because the Overseer daemon's `checkpoint.work` field is
present-tense only and is overwritten every checkpoint.

The plan's target sentence, from the roadmap: *the page can relate a resource spike to the observed
concurrent work, with its timestamp and its uncertainty.* v1 is simple trend charts or tables — no
metrics backend, no forecasting.

**The invariant the whole area is built on, and which this plan must not break:** an absence that was
never measured must never render as good news. A failed command is not a zero; "no scan was taken"
is not "nothing was running"; a truncated list is not a complete one; a gap in the record is drawn
as a gap and never interpolated. `tools/fleet/health.ts`'s header and
`tools/fleet/health-history.ts`'s "four states" header are the authoritative statements of this.

**Deliberately out of scope:** per-job CPU or memory cost (the daemon's probe reads
`ps -eo pid=,ppid=,etimes=,args=`, which carries neither, and this stage may not change what the
daemon writes); any second `ps` per pane; a metrics backend; enforcement or admission decisions.

**Constraints this plan is under:** it may not change what the Overseer daemon writes; it may not
restart the live dashboard or daemon; two other sessions are concurrently editing
`tools/fleet/` (one is adding a different section to the same Box Health panel), so the plan
deliberately minimises edits to shared files.

## What you can and cannot run, and what you may change

**The tree is read-only. Do not change any file.** This is a plan review.

/tmp and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`), and you can build
a throwaway harness under /tmp. You have no network, not even loopback, so anything needing Postgres
or a local service will skip — none of the files above needs either.

## Attack it

Independently, before you read my questions below.

**The invariant to break: find a state of the world in which this design draws, stores or ranks
something that reads as an answer when nothing was measured** — or in which a bounded thing loses its
bound. Concretely, the shapes worth hunting:

- a sequence of events after which the stored record implies coverage it does not have;
- a size or growth argument in the plan that does not hold (the rotation invariant in
  `health-history.ts` depends on a record having a bounded size, and that argument has already been
  broken once in this file's history);
- a join between two clocks that the plan treats as one;
- a claim the plan makes **about the existing code** that is false — these are the most valuable,
  because the whole plan is built on the reading and I may have misread. Check especially: that
  `classifyPaneWork` really does stop the walk at a recognised job (the plan's no-double-counting
  guarantee rests entirely on this); that `projectRegister` really does cap its session list; that
  `computeVerdict` and `health-view.ts`'s `THRESHOLDS` really do declare the same numbers twice with
  nothing relating them; that `parseDisk` and `attribution` really are collected and never drawn.

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is **established** or **reasoned**
  - (a) the concrete scenario the plan does not handle, or the authoritative contract it contradicts
  - (b) the smallest change that closes it — exact replacement wording for the plan, or a code block

Severity is by consequence, not by the file the defect is in — a defect in this plan's prose that
will cause user-visible wrong behaviour to ship is a P1, not a P3:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

A finding with no (a) goes last. Refuse only on an established P0 or P1, and name what established
it. "Established" means direct evidence with no unresolved material inference — an exact source path
that demonstrates it, or an authoritative contract the plan directly contradicts.

**Give the question its floor.** The plan's central guarantee, stated at what I believe is its true
strength, is this:

> Every number this feature draws is either a reading somebody took, or a stated absence naming why
> no reading exists. The work half additionally guarantees only that *these job groups were observed
> running at these sampled instants* — it never claims how much of the load they caused, and it never
> claims a job absent from the record did not run.

**Is that statement accurate for the design as written?** Not "is the design sound" — that question
has no floor. If the statement is too strong, say exactly which word fails and give the wording that
is true.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself. Spend
most of the run elsewhere.

1. **Riding on the health sample.** I chose to add an optional `work` field to the existing
   `HealthSample` rather than open a second JSONL file, to reuse the one writer, lock, rotation and
   reader. I think the size arithmetic holds (~2.2 KB every 5 minutes against a 1 MB/day baseline and
   an 8 MiB rotation cap), but the rotation invariant is *"the cap must comfortably exceed a window's
   worth of samples"* and I have moved the numbers under it. Is my arithmetic right, and is there a
   pathological case — a box with far more sessions than today's eighteen — where it stops holding?
2. **Absent vs. unavailable vs. gap.** A sample with no `work` field means "not a work turn"; a
   sample with `work: {kind:"unavailable"}` means "we tried and could not"; a missing sample entirely
   is a gap. Three states, and the browser has to keep them apart with only `WORK_EVERY_MS` to tell
   it what spacing to expect. Is there a fourth I have collapsed, or a sequence in which two of the
   three are indistinguishable?
3. **The cadence and the honesty sentence.** Sampling every five minutes means a two-minute `codex`
   run can be entirely invisible. The plan's answer is a sentence on the page. Is a sentence enough,
   or does the five-minute default make the feature claim more than it can support — and would a
   change-triggered write (record when the set of groups changes, not on a timer) be better enough
   to be worth the complexity?
4. **The one out-of-file-set edit.** I plan to add `export` to `parsePaneWork` in
   `overseer-status.ts` rather than write a second parser for the same JSON. Is reusing it actually
   safe here — does it carry any assumption that only holds inside `projectRegister`'s bounded,
   ranked context?
5. **Extracting the thresholds.** Stage 1 moves `computeVerdict`'s literals and `health-view.ts`'s
   `THRESHOLDS` into one module. That changes a function the live daemon's verdict depends on. Is
   there any way that extraction changes behaviour rather than merely relocating it?

Do not change any file.
