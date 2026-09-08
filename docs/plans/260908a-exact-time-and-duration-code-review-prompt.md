Review **built code**, before it is committed, in the repo at
/home/greg/code/spideryarn2/.claude/worktrees/fb2k-metadata-step-timings.

## The candidate — live, pre-commit

Base commit: `8e78a20e64ff9a5dfad8a2d79ce971521dfbca21` (branch
`worktree-fb2k-metadata-step-timings`). Nothing is committed yet, so
`git diff 8e78a20e -- <paths>` is the change for the tracked files and the untracked ones are
listed separately — a diff command alone would show you nothing for those.

**Modified:**

- `src/types.ts` — `StageState.startedAt` added.
- `src/store/pg.ts` — `articleMetadata` sends it (one line plus a comment, near the `stages` map).
- `src/web/Metadata.tsx` — `Wrote` takes `began`; new exported `tookFor` and `howLong` beside
  `exactly` and `weight`.
- `tests/metadata-page-order.test.tsx`, `tests/metadata-rerun-section.test.tsx` — fixtures gained the
  field.
- `tests/store-carry-forward.test.ts` — new case *"gives the page both stamps of one run, carried
  unchanged"*, and its `step()` helper now writes the two stamps 8.4s apart.

**Untracked (a pathspec cannot name these — read them directly):**

- `tests/metadata-step-timing.test.tsx`
- `docs/plans/260908a-exact-time-and-duration-on-the-metadata-step-rows.md`
- `docs/user-feedback/260907_1917-exact-time-and-duration-on-the-step-rows.md`

Start with `Metadata.tsx` and the plan doc; that is a reading order, not a scope limit.

## What it is

Feedback report `SPIDERYARN-READING2-2K` from the administrator: on the metadata page's
*What we did to it* list of pipeline steps, *"a tooltip for exactly when it happened … And also, how
long it took"*. The exact-time card already existed (verified in a browser); the duration did not,
and was missing from the wire rather than from the database. So `revision_step_runs.started_at`
joins `StageState` beside `ranAt` (which is `finished_at`), and the card subtracts.

The plan doc holds the design, the null cases, the touch ruling, and the evidence — including the
plan-stage review you gave, the two findings taken, and the one overruled.

## Run something yourself

Your sandbox has no network and no Postgres, so:

- `npx vitest run tests/metadata-step-timing.test.tsx` needs nothing outside the tree — please run
  it, and attack the *assertions* rather than trusting the green.
- `tests/store-carry-forward.test.ts` needs a database; I ran it. Raw output:
  `Test Files 1 passed (1) / Tests 11 passed (11)`. I also verified it goes red by mapping
  `startedAt` to `finishedAt` in `pg.ts` — one failure, *"gives the page both stamps of one run,
  carried unchanged"*.
- `npm run typecheck` is clean.
- Ten real step rows on a local dev server, hovered one at a time, gave
  `blocks … took 92ms`, `quotes … took 14.2s`, `ideas … took 1m 47s`, `timeline … took 1m 49s`.

## What I want

An independent pass first. In particular:

1. **Correctness of the numbers.** `tookFor` and `howLong` in `Metadata.tsx`. Is there an input that
   makes the card state something false, or crash the page? Is any formatter boundary still wrong?
2. **The wire and the store.** Is `startedAt` mapped right, is its documented contract in
   `src/types.ts` actually true of the code in `src/store/pg-revisions.ts`, and does anything else
   construct a `StageState` that I missed?
3. **The tests.** Which of them would still pass if the feature were broken? The jsdom card tests in
   particular — is `cardText` reading the card it thinks it is?
4. **The prose.** The plan doc and the user-feedback note make factual claims about the code and
   about what a browser did. Any claim that is not true of the tree in front of you is a finding.

## Severity — put one on every finding, with an ID (`P0-1`, `P1-1`, …)

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Say plainly if it is fine. End with a verdict: land as is / land with these changes / do not land.

## My own suspicions — already mine, worth less, spend most of the run elsewhere

- `Wrote` renders nothing at all when `ranAt` is null, so a step still `running` shows no time and no
  duration. I think that is right and unchanged, but say if the new field makes it wrong.
- The card's second line still says *"When this stage last finished"* and the first now says
  *"took 1m 47s"*. For a **carried-forward** row both describe a run that happened in a previous
  revision. I decided that is what `ranAt` already does and needs no new sentence — you agreed at
  plan stage, but you were reading a plan and not the card.
- `howLong` is exported purely so a test can reach it. Say if that is the wrong seam.

## Added after the first dispatch (which was killed by the box running out of memory)

The tree gained one more change before this run: **`howLong` was a second copy of a function
`src/web/Tweets.tsx` had already exported since 2026-08-26.** Both are now one function in
`src/web/relative-time.ts`, which also holds `timeAgo` and `exactly`. So also modified:

- `src/web/relative-time.ts` — `howLong` added at the end.
- `src/web/Tweets.tsx` — its copy deleted, imports the shared one; a comment where it stood.
- `tests/tweets-page.test.ts` — imports from `relative-time.js`; its five cases unchanged.
- `tests/metadata-step-timing.test.tsx` — imports `howLong` from `relative-time.js`.

The merged function keeps **both** behaviours the two copies disagreed on: milliseconds below a
second (the metadata page needs it; Tweets never gets there), and `an unknown time` for a non-finite
or negative input (why Tweets has it at all; the metadata card declines in `tookFor` before it can).
The plan doc § There was already a `howLong` has the reasoning.

**Please check that merge as hard as the rest**: is any Tweets-page behaviour changed that I have
not named, and is `an unknown time` genuinely unreachable from the metadata card?
`npx vitest run tests/tweets-page.test.ts tests/metadata-step-timing.test.tsx` runs with nothing
outside the tree — 58 tests green here across four files, including the two above.
