# Review: recording what work was running when box load rose, and drawing it beside the health trend

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/resource-history` (a linked git worktree),
branch `worktree-resource-history`. TypeScript + ESM, React 18, vitest. An internal fleet dashboard
for one always-on Linux box running many coding-agent sessions at once. No untrusted users; nothing
here touches the product's reader-facing code or its database.

## The candidate

Committed: `git log --oneline 243d108a..HEAD` — the branch's own commits, in order:

- `0d3398e1` the plan
- `b76e…`/`509f29d4`/`0af436e6`/`3f49da1c`/… stages 1, 2, 2b, 3 and 4
  (**this list is filled in exactly before the review runs; do not trust it if the shas below
  disagree with `git log`**)

    git log --oneline --first-parent 243d108a..HEAD
    git diff 243d108a..HEAD --stat

Changed paths: whatever `git diff --name-only 243d108a..HEAD` prints. **Start with**
`tools/fleet/work-groups.ts`, `tools/fleet/health-history.ts`, `tools/fleet/health-wiring.ts` and
`tools/fleet/web/src/work-series.ts` — that is where to begin, not the limit of scope; the manifest
is.

## What it is meant to do

When load spikes on this box, nobody can afterwards say what was running. A 24-hour health trend
already existed (load per core, memory used, swap used, IO wait, with gaps hatched and unknown
readings kept distinct from zero); what did not exist was any record of **what work was running**,
because the Overseer daemon's `checkpoint.work` field is present-tense only and is overwritten every
checkpoint.

This branch adds: one shared policy module for the health cutoffs, which the collector and the
browser previously declared separately; a read-only projection over `checkpoint.work`; a bounded
work summary written onto the existing health sample at a five-minute cadence; disk as a fifth chart
series; and the rendering, including a live "current work" field that is deliberately **not** derived
from the history.

**The invariant the whole area is built on, and which this must not break:** an absence that was
never measured must never render as good news. A failed command is not a zero. "No scan was taken" is
not "nothing was running". A truncated list is not a complete one. A gap in the record is drawn as a
gap and never interpolated. `tools/fleet/health.ts`'s header and `tools/fleet/health-history.ts`'s
"four states" header are the authoritative statements of it.

**Deliberately out of scope:** per-job CPU or memory (the daemon's probe reads
`ps -eo pid=,ppid=,etimes=,args=`, which carries neither, and this branch may not change what the
daemon writes); a metrics backend; any admission or enforcement decision.

## What you can and cannot run, and what you may change

**You may edit this worktree.** Fix what is inside the stages under review — each finding red-first,
with the test that reproduces it — and leave anything wider as a finding for me to decide. **Do not
commit.** List every file you changed at the end.

Do not restart or kill anything: the fleet dashboard on port 8787 and the Overseer daemon are live
and other people depend on them. Do not touch `tools/overseer/`. `npm run check` and `npm test` take
about 25 minutes here; run focused suites instead. The full-suite and typecheck output I ran is
recorded in the plan doc.

## Attack it

Independently, before you read my questions below.

**The invariant to break: find a state of the world in which this stores, ranks or draws something
that reads as an answer when nothing was measured** — or in which a bounded thing loses its bound.
Shapes worth hunting:

- a sequence after which the stored record implies coverage it does not have;
- two clocks treated as one — there are at least four in play (the health sample's `at`, the health
  survey's sequential commands under one `collectedAt`, the daemon's `scannedAt`/`attemptedAt`, and
  the browser's own), and a previous review found three of them conflated in a single sentence;
- a bound that is enforced on a proxy rather than on the bytes that are actually written;
- a renderer that turns one observation into several, or several into one;
- **a claim in a comment or a plan that the code does not support** — these are the most valuable.

For each finding give:
  - an ID (F9, F10, … — **F1–F8 are taken** by the plan review at
    `docs/plans/260910a-resource-history-plan-review-sol.md`; number above the highest issued)
  - a severity (P0/P1/P2/P3) and whether it is **established** or **reasoned**
  - (a) the input or mutation I can run that shows it fails its own claim
  - (b) the smallest change that closes it

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Severity is by consequence, not by the file the defect is in. A finding with no (a) goes last.
Refuse only on an established P0 or P1, and name what established it.

## Previous findings — this is a second pass on the same work

The plan review's eight findings and their dispositions are in the plan doc under "The plan review,
and what was done with it". **Treat the fixes as unreviewed code written by someone else**, and spend
most of the run on what has changed since. Two of them are worth re-checking specifically, because
both were closed by argument rather than by measurement:

- **F4's byte budget.** `MAX_STORED_WORK_BYTES` is enforced by encode-drop-re-encode. Is the
  enforcement actually on the bytes that get written, including the envelope the store adds around
  the value? The rotation test models a day — is its model right?
- **F7's `timing` union.** The review said to null both aggregates whenever any job's timing is
  unknown; I refused that and used a three-armed union instead, on the grounds that one unknown job
  in six should not erase the other five. **If you think the review was right, say so.**

## Give the question its floor

The branch's central guarantee, stated at what I believe is its true strength:

> Every displayed measurement, and every exact count derived from a reading, is either something
> somebody measured or a stated absence naming why no reading exists. A work record says its listed
> groups were observed at **its own `scannedAt`**, and never that they were running at the health
> reading's instant or throughout the interval between samples. Repeated copies of one source
> timestamp are one observation.

**Is that statement accurate for the code as written?** Not "is it sound" — that question has no
floor. If it is too strong, name the word that fails and give wording that is true.

## My own suspicions — read last

Already my doubts, so confirming them is worth less than anything you find yourself.

1. The cadence state is process-local and starts unset, so the first turn after every restart is due.
   A dashboard restarting faster than five minutes would write one every turn. I accepted that as a
   louder problem than a dense history — is it?
2. `seed-health-history.ts` writes `{kind:"not-due"}` on every seeded sample. Synthetic history has
   no true answer here, and both available ones are fictions. Is `not-due` the less misleading?
3. The oversize retry replaces the work result with a `checkpoint-unavailable` carrying the size that
   refused it. Is that arm being borrowed for something it does not mean?
4. `currentWork` is threaded through `state.ts` → `FleetState` → `App` → `HealthPanel`. Is it
   genuinely never derived from the history, and does the composition test actually prove the thread
   rather than the prop?
5. The disk series is a second rendering of a reading that already has a tile. Do the two agree at
   every boundary, given that the tile and the chart take their cutoffs from the same policy but draw
   them differently?
