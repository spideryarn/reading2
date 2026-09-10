# Review round 2: the rewritten admission-visibility plan

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility` (a linked git worktree),
branch `worktree-admission-visibility`. TypeScript + ESM, `tsx`, vitest. Still a **plan** review —
no implementation code exists yet.

## The candidate

Committed: `d249354a` (the only commit on this branch beyond `origin/dev` at `b341a8c4`).

    git show d249354a --stat
    git show d249354a -- docs/plans/260910a-admission-visibility-explaining-why-heavy-work-should-wait.md

Changed paths: the plan doc, your round-1 prompt, your round-1 answer, and a stage-1 task prompt
(`docs/plans/260910a-stage1-server-task.md`) that is **out of date and not part of this review** —
it was written against the pre-review design and will be rewritten from whatever this round settles.

**Start with the plan doc.** Its final section, *Review dispositions — round 1*, is the ledger for
your F1–F7.

## What changed since round 1

You refused the plan with F1–F5 established P1s and F6–F7 as P2s. **All seven were taken**, and two
were verified by hand before being taken:

- **F5**: I read `logs/tmux-jobs/grfd-check3-0934-2389191.log` line 80. The refusal is there in
  full. Your finding stands and my premise was false.
- **F1**: I read `vitest.config.ts:88-101`. Its own comment says the worker number "is what the
  CONFIG asked for, and is deliberately not called the resolved one" because `--maxWorkers` beats
  it. Your finding stands.

The dispositions table says what each fix was. The largest design changes: outcomes renamed
`would-admit`/`would-reduce`/`would-refuse`; no field anywhere is called `enforced`; review and
browser kinds answer `not-modelled` and never reach `decideAdmission`; a version-indexed explanation
map that fails closed replaces the two-literals comparison; a conservative job-root `/proc` census
replaces the reused `ps` grouping; the replay obeys a three-class stored union; and **everything
expensive moved off the request path onto a timer in `admission-wiring.ts`**, with the route serving
a cache that carries its own age.

New measurements I took on this box and wrote into the plan (check them if you doubt them):

- job-root census over 425 processes: 37.7 ms median, 56.0 ms worst — and the naive parent-walk fold
  produced **33 "browser" roots**, which is plainly an over-count and is written into the plan as
  the failure to design against.
- tmux-job log trace scan: newest 40 tails at 32 KiB each, 4.3 ms median / 23.7 ms worst; all 136
  across every worktree, 10.5 ms median / 61.8 ms worst. Rejected on honesty, not cost — the one
  known refusal sits at line 80 of an 800 KB log, so neither a head nor a tail scan reliably finds
  one.

## What it is meant to do

Unchanged from round 1, and the invariant is the same: **this feature must not make any claim of
enforcement, reservation, coordination or record-keeping that does not exist.** The next roadmap
stage builds the admission owner; this one only explains.

## What you can and cannot run, and what you may change

**The tree is read-only. Do not change any file.** This is a plan review.

`/tmp` and the node_modules caches are writable; there is no network. You are on the machine the
plan describes, so `/proc`, `free -b`, `~/.config/spideryarn/`, `~/.fleet-health/` and
`logs/tmux-jobs/` are all real. (Round 1 could not start a focused vitest file because the sandbox
would not create `node_modules/.vite-temp`; a plain `node --import tsx <script>` under `/tmp` worked
and is the way to measure anything.)

## Attack it

**Spend most of this round on what changed**, and treat my fixes as unreviewed work by someone else.
Three places I would look first if I were you, named because they are where a fix creates a new
defect rather than closing an old one:

- the timer in §7 — I moved 56 ms of `/proc` walking and up to 250 ms of history scanning into a
  recurring task inside the one Node process the Overseer depends on, and traded a per-request cost
  for a periodic one plus staleness. That trade may be worse than the problem.
- the job-root census in §4 — I claim conservative classification plus an uncertain arm makes an
  over-count safe. Does it? An under-count is also a wrong number under a true label.
- §6's counts-not-coverage decision, which I chose specifically to avoid a second coverage
  calculation. Check that the counts are actually meaningful without one.

Then, independently: **find a sentence the plan proposes to put on screen, or a field name it
proposes to use, that is false or that a reader would reasonably misread as a promise.** That is the
question this plan keeps failing.

Also check the plan's remaining factual claims about the tree — several are new this round.

For each finding: an ID, a severity (P0/P1/P2/P3), whether it is **established** or **reasoned**,
(a) the concrete scenario or the contract-with-path it contradicts, and (b) the smallest change that
closes it. A finding with no (a) goes last.

**IDs continue from round 1: number new findings F8 and upward.** Reuse F1–F7 only to say a fix is
insufficient, and say which.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

"User-visible wrong behaviour" includes a true number under a false label.

Refuse only on an **established** P0 or P1, and name what established it.

## My own suspicions — read last

These are already my doubts; confirming them is worth less than what you find yourself.

1. **Is the stage now too big?** Three stages, a `/proc` census, a timer, a replay and a client
   section, for a read-only explanation. Your round-1 answer to my suspicion 6 said to drop the
   speculative machinery — I dropped the review/browser scoring but *added* the census, on your F3.
   If something here should be cut to land the rest, say which.
2. **The deferred "last refusal" checkbox.** I am leaving a roadmap checkbox unmet and reporting it
   upward rather than shipping a scanner that can silently miss. Is that the right call, or is
   there a bounded source I have not thought of that is complete enough to be honest?
3. **The forecast's freshness.** It is computed per request off a live `/proc/meminfo` read, while
   the census and replay come off a cache. One card, two ages. Is showing both ages enough, or does
   mixing them on one card mislead regardless of labels?

Do not change any file.
