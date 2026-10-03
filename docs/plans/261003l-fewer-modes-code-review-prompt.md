# Code review: 261003l — Tweets becomes Summary's Thread

**Candidate (committed)**: exactly one commit, `655cd40a1`, in this worktree. Diff:
`git show 655cd40a1`; changed paths: `git show --stat --name-only 655cd40a1` (74 files). Start with
`src/web/activation.ts`, `src/web/modes/summary/SummaryMode.tsx`, `src/web/Tweets.tsx`,
`src/web/Dock.tsx`, `src/web/reader/Reader.tsx`, `src/web/router.ts`, `src/web/last-view.ts`,
`src/web/auto-modes.ts`, `src/web/command-match.ts`, `src/web/rerun-commands.ts`,
`src/web/shared-inventory.ts`, `src/web/params.ts`, and the two new tests
`tests/summary-thread-press.test.tsx` and `tests/old-tweets-addresses.test.tsx`. That list does not
limit scope.

**What it is for**: the `tweets` top-level reading mode is retired into `summary`. Summary's
three-stop slider became a three-way control Brief | Fuller | Thread
(`?summary=brief|fuller|thread`). The plan is
`docs/plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md`; your own plan review
is `docs/plans/261003l-fewer-modes-plan-review-sol.md` (F1–F7, all accepted). The code was written
by an Opus subagent, not by me, and has had no review.

**You may write.** Fix what is inside this stage, narrowly, each finding red-first with the test
that reproduces it. Report, do not fix, anything wider. Do not commit. You have no network and no
Postgres: run single files with `npx vitest run tests/<one>.test.tsx`; do not run `npm test` or
`npm run typecheck`. State of the gates when I committed: `npm run typecheck` clean; the
implementer's one full-suite run was 3 red of 31,719, all three since addressed (a doc link to a
note that now exists, an import direction fixed by moving `TweetsMode.tsx`, a test that lists
tracked files and saw a deleted-but-uncommitted file); the full suite has not been re-run since.

## What I want

An independent attack first. Above all:
- any way to **spend money without a press**, or to leave an **armed token unclaimed** that a later
  navigation collects (your F1) — including the real `Reader`/`Dock` wiring, not only the test
  harness: `Dock`'s `summary` prop is optional with an address fallback;
- any old address (`?mode=tweets`, `/read/<slug>/tweets`, with or without a carried `summary=`) that
  does not end on the thread, on cold load, client navigation and Back/Forward (F4);
- a visitor on a public article losing a stored thread, or being shown an owner-only control;
- a last-view restore that opens the thread;
- the add page's queue, the command bar's "tweets" + Enter, and "rerun tweets" / "rerun summary";
- docs changed in this commit that now disagree with the code (`docs/project/summaries.md`,
  `tweets.md`, `mode.md`, `reading-view-overview.md`, `url-state.md`).

Severity by consequence: **P0** data loss, security, incorrect charging, service unusable · **P1**
user-visible wrong behaviour or an authoritative contract violated · **P2** design or
maintainability risk, no wrong behaviour today · **P3** prose defect. Mark each *established* or
*reasoned*. Continue the ID sequence from the plan review: new findings start at `F8`; reuse F1–F7
only for the same finding. For each: what you found, whether you fixed it, the test that was red.
End with a one-line verdict.

## My suspicions (already mine, worth less; spend most of the run elsewhere)

- The implementer says the "Summary command row while already in Summary" case is tested only in
  its harness, not through the real `Reader`.
- `Dock` still reads `diagram` from `location.search` at render — your F1's shape, for Diagram.
  Report, don't fix, unless it is one line.
- mode.md § Retiring a mode step 2 says the successor takes the retired name as an alias; per F3
  the aliases went on the Thread row instead. The rule text is unchanged.
- The thread band's aria-label is now "Summary" and its class `summ gloss tweets`.
