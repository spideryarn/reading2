# Code review: check-public-shell's HEAD request (stage review, write-capable)

You reviewed the plan for this; now the code. You may edit files in this worktree. **Fix what is
inside this stage, narrowly and red-first; report, do not fix, anything wider you notice.** Do not
commit. Do not attribute any words to Greg in anything you write.

## Candidate (committed)

- Commit `38c26ee01`. Diff: `git show 38c26ee01`.
- Changed paths, complete:
  - `scripts/check-public-shell.ts` — `HEAD_READS_TO_CLOSE`, `curlRequest` (now exported, with
    `maxTimeSeconds`), two new `--self-test` cases after "catches HEAD returning a body"
  - `tests/check-public-shell-head.test.ts` — new
  - `docs/plans/261006f-check-public-shell-head-request-waits-for-a-body.md` and its two
    `-review-plan-*` files
- Start with the first two. That does not limit scope.

## Evidence you cannot produce yourself

You have no network or loopback, so `tests/check-public-shell-head.test.ts` (a fake server on
127.0.0.1 in a child process, driven by real curl 8.5.0) will not run for you. Raw results, mine,
2026-10-06:

- Original code, `/honest`: `curl exited 28: curl: (28) Operation timed out after 5002 milliseconds with 0 out of 22 bytes received`
- `--head -o /dev/null` swapped in, `/lying`: `expected '' to be '<html>the shell</html>'`
- `--ignore-content-length` without `--raw`, `/chunked`: `expected '' to be '0\r\n\r\n'`
- Final code: 4 of 4 pass; `--self-test` 124 passed, 0 failed (you can run this one:
  `npx tsx scripts/check-public-shell.ts --self-test`); `npm run typecheck` clean.
- The real script against production, `--public-slug 2608-13566v1-spya-yurten`:
  `PASS HEAD matches GET`, `43 passed, 0 failed, 3 skipped`.

## What I want

An independent attack first. Can "HEAD matches GET" now pass when it should fail, or fail when it
should pass? Is the test's fake server honest about what it claims, and would each test go red for
the reason its name says? Anything the export or the new parameter breaks for the script's other
callers?

Severity: P0 the check passes when it should fail; P1 wrong or broken; P2 worth changing; P3 nit.
Every finding gets an id (C1, C2, …), a severity, and whether you fixed it. End with
`VERDICT: land it` or `VERDICT: not yet`, and a list of every file you edited.

## My own suspicions (already mine; spend most of the run elsewhere)

- A 1xx or a second response on the same connection being read as body under `--raw`.
- The test's dependence on curl being installed where the suite runs.
