# Stage 2b task: three corrections a plan review found after Stage 2 was dispatched

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/resource-history` (a linked git worktree),
branch `worktree-resource-history`. TypeScript + ESM, run with `tsx`, tested with vitest.

**You wrote Stage 2 and it is committed at `509f29d4`.** It is good work and none of this is a
rejection of it — a cross-family plan review landed *after* that run was dispatched and raised three
things the brief you were given did not ask for. Treat what is on disk as someone else's unreviewed
code, and read it before changing it.

**Read first:**

1. `docs/plans/260910a-resource-history-what-was-running-when-load-rose.md` — the plan, revised. §
   "The stored shape" now has the shapes below; § "The plan review, and what was done with it" is the
   disposition table.
2. `docs/plans/260910a-resource-history-plan-review-sol.md` — the review itself: **F2, F4 and F7**.
3. `git show 509f29d4` — what is being corrected.
4. `tools/fleet/overseer-status.ts` — `resolveWork`, `registerWork`, `project`.
5. `tools/fleet/health-history.ts` — `boundWhy`, `MAX_WHY_CHARS`, `MAX_LINE_BYTES`,
   `MAX_FILE_BYTES` and its rotation invariant. **F4 is about that invariant.**

## F2 — an unavailable work reading must keep the event's own clock

`StoredWork`'s unavailable arm is `{ kind: "unavailable"; why }`. The daemon distinguishes three
things and stamps each with a different clock — `not-yet-run.at`, `probe-failed.attemptedAt`,
`scan.scannedAt` — and `resolveWork` currently flattens the first two into one sentence.

**Why it matters, concretely.** The work probe fails at 10:00. The daemon then stops producing fresh
scans while its checkpoint keeps that failure. Health retention reads it at 10:05, 10:10 and 10:15.
The store now holds three unavailable work records with nothing to say they came from **one** 10:00
attempt: keying them by the carrier sample's clock invents three attempts, and merging them invents
continuous measurement. The same applies to a stale **success** — three samples carrying one
`scannedAt` are one observation, not three.

Change `StoredWork` to:

```ts
export type StoredWork =
  | { kind: "not-yet-run"; asOf: string; why: string }
  | { kind: "probe-failed"; attemptedAt: string; sourceCollectedAt: string; why: string }
  /** We could not read the checkpoint, or could not accept its scan. OUR clock, not the daemon's. */
  | { kind: "checkpoint-unavailable"; checkedAt: string; why: string }
  | { kind: "scan"; scannedAt: string; groups: StoredWorkGroup[]; groupsDropped: number;
      panes: { work: number; none: number; cannotTell: number } };
```

That means `ResolvedWork`'s `unavailable` arm has to carry the source discriminant and its timestamp
rather than only a sentence. **Widen it and have `registerWork` flatten to the card's existing
one-sentence shape** — the register card is right to show one sentence; the history is what needs the
structure. Do not add a second parse or a second `resolveWork` call: there is exactly one call site
today (overseer-status.ts:232) and that is a correctness property, stated in the file.

Where an inventory mismatch or an unreadable checkpoint has no daemon-side clock to quote, use
`checkpoint-unavailable` with our own `checkedAt`, and make sure the caller has a clock to pass —
inject it, do not call `Date.now()` inside a pure projection.

Add to `work-groups.ts`'s header, because nothing downstream can enforce it:

> **The renderer keys an event by its source discriminant and its source timestamp.** Repeated copies
> of one `scannedAt` or one `attemptedAt` are one observation, never several.

## F4 — the bound must be in bytes, and the arithmetic must be a test

`MAX_GROUPS = 30` caps the number of groups and **caps no bytes**. `session` and `why` are arbitrary
non-empty strings to every parser here, so the only limit actually in force is `MAX_LINE_BYTES`
(64 KiB). At one work record every five minutes that is about **18 MiB/day**, which rotates an 8 MiB
live file in **under eleven hours** — and `MAX_FILE_BYTES`'s comment states the invariant it breaks:
*the cap must comfortably exceed a window's worth of samples*. A blank chart at the moment somebody is
trying to find out what went wrong is the exact failure this feature exists to prevent.

(The review also measured the ordinary case: one group serialises to about **173 bytes**, not the 70
the plan claimed, so 30 groups is ~5.35 KB. The conclusion survived; the proof did not.)

So:

```ts
export const MAX_STORED_WORK_BYTES = 4 * 1024;
```

- Enforce it **on the encoded value**: encode, and while it is over budget drop the lowest-ranked
  group and re-encode, incrementing `groupsDropped`. A bound on a proxy for the bytes is what failed
  here once already.
- Bound `why` and every identifier string visibly, the way `boundWhy` does — a truncation that says
  it happened.
- If no useful bounded projection fits at all, return a bounded `checkpoint-unavailable` saying so
  rather than something oversized.
- **Replace the plan's paragraph of arithmetic with a test**: build 288 maximum-sized work records
  plus a pessimistic day of ordinary health samples and assert the total is comfortably under
  `MAX_FILE_BYTES`. This module has already had this invariant broken once by a 40,000,420-byte file
  that every comment said could not exist, so a comment claiming a rate is not the check.

## F7 — a group's timing is a three-way answer, not a nullable pair

Two jobs can share a `(session, recogniser)` group with one having a known start and the other
`startedAt: null`. Taking the min/max over only the known ones makes `oldestStartedAt` and
`longestRanForMs` read as exhaustive.

The review's fix was to null both aggregates unless every job is known. **We are not doing that** —
one unknown job in six should not erase the other five. Instead the dishonest rendering becomes
impossible to write:

```ts
export type StoredWorkGroup = {
  session: string;
  recogniser: string;
  jobs: number;
  timing:
    | { kind: "known"; oldestStartedAt: string; longestRanForMs: number }
    /** Some jobs' timing was unavailable. `knownJobs` is how many of `jobs` these aggregates cover. */
    | { kind: "partial"; knownJobs: number; oldestStartedAt: string; longestRanForMs: number }
    | { kind: "unknown" };
};
```

A renderer cannot print a `partial` as though it were a `known` without naming the arm. Note the
producer's own invariant, which you should rely on rather than re-derive: `paneWorkFitsScan` requires
`startedAt === null` and `ranForMs === null` together, so a job's timing is known or unknown as a
pair — there is no half-known job.

The ranking in `projectStoredWork` sorts on `longestRanForMs`; rework it for the union without
letting an `unknown` group sort as though it had run for zero milliseconds. Say in a comment what
order you chose for the unknown arm and why.

## Tests

Extend `tests/fleet-work-groups.test.ts` and `tests/fleet-overseer-status.test.ts`. Red first, each
one, for the right reason.

1. `probe-failed` keeps `attemptedAt` and `sourceCollectedAt`, not just a sentence.
2. A checkpoint with no `work` key at all gives `not-yet-run`-or-equivalent with its own clock, and
   the `why` still says the checkpoint predates work scans.
3. An inventory mismatch gives `checkpoint-unavailable` with the injected `checkedAt`, and the
   register card still shows its one sentence unchanged.
4. **The register and the history still agree**: on one checkpoint, when the register says work is
   unavailable, the work feed is unavailable too and for the same reason. This test exists already —
   make sure it survives the widening rather than being weakened to fit.
5. A group with one known and one unknown start → `timing.kind === "partial"`, `knownJobs: 1`, and
   the aggregates from the known job.
6. A group where every job's timing is unknown → `timing.kind === "unknown"`, and it does not sort
   above a group that ran for an hour.
7. The byte budget: a projection whose groups are individually enormous is reduced until the encoded
   value fits, with `groupsDropped` counting what went, and the encoded result is asserted to be
   under `MAX_STORED_WORK_BYTES` **by measuring it**, not by trusting the loop.
8. The rotation budget test described under F4.

## Constraints

- **Do not change anything under `tools/overseer/`**; do not restart or kill anything; **do not
  commit**, and do not run `git` commands that change state.
- **Do not touch** `tools/fleet/refresh.ts`, `routes-actions.ts`, `routes-new.ts`, `scripts/`, or any
  readiness file. Other agents are working in `tools/fleet/` concurrently.
- `npm run check` and `npm test` take ~25 minutes here — **do not run them**. Run the focused suites,
  including every other caller of `readCheckpointFeeds`, since widening a shared type breaks fixtures
  in files you did not open.
- If you conclude one of these three corrections is wrong, say so plainly with your reasoning rather
  than implementing it badly. F7 in particular is a deliberate departure from the review's own
  recommendation, and if you think the review was right I want to hear the argument.

## When you are done

List every file you changed, the tests you wrote, the exact command that runs them and its summary
lines, and say for each of F2/F4/F7 whether you saw a test fail first.
