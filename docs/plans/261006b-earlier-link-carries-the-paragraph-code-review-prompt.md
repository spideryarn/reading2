# Review: the Earlier tab's page link now carries the reading position (`?at=<block id>`)

Repo: this worktree, branch `worktree-qi-hwkfga7y-earlier-link-carries-at`. TypeScript + ESM, a Node
server and a React client. This is the **code review** of one small stage.

## The candidate

Committed: the single commit at `HEAD` whose subject starts `261006b:`.

    git show --stat HEAD
    git diff HEAD~1..HEAD

Changed paths: `src/feedback-page.ts`, `src/store/pg-feedback.ts`, `src/store/contracts.ts`,
`src/routes.ts`, `src/types.ts`, `src/web/FeedbackEarlier.tsx`, `docs/project/feedback.md`,
`docs/plans/261006b-earlier-link-carries-the-paragraph*.md`, and the tests
`tests/feedback-page.test.ts`, `tests/feedback-store.test.ts`, `tests/feedback-route.test.ts`,
`tests/feedback-dialog.test.tsx`.

Start with `src/feedback-page.ts` § `feedbackPageAt` and `src/web/FeedbackEarlier.tsx` (the
validator, `withLegacyPage`, and the link's `href` and `onClick`). That is where to begin, not the
limit. The plan is `docs/plans/261006b-earlier-link-carries-the-paragraph.md`; read it as a reviewer
of its claims too, including § What landed.

## What it is meant to do

The reader's own Earlier tab (Feedback dialog) links each report to the page it was filed from. The
stored address never reaches the client, because its query can carry search terms. This stage sends
one more thing beside the path label: the `at` block id from the stored address, so the link opens
the article at that paragraph.

The statements to test for accuracy:

1. Nothing from the stored address reaches the client except the existing path label and a value
   that passes `isSpideryarnId`, and only when the label is an article's reading page.
2. The link's `href` can never leave this site, and is exactly `page` or `page + "?at=" + at`.
3. An old server's answer (no `at` field) and a new server's answer to an old tab both still render.
4. A reader already on that page at that paragraph keeps their place: the dialog closes and nothing
   navigates. Every other ordinary click still navigates in-app and keeps an unsent Write draft; a
   modified click is left to the browser.

Out of scope: restoring the mode or any other parameter; checking the block still exists in the
article (a stale id opens at the top, by design).

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside this stage, narrowly, each finding red-first with the
test that reproduces it, and leave anything wider as a finding for me to decide. Do not commit. Do
not attribute any words to Greg that are not already in the tree. List every file you changed at the
end.

You have no network, not even loopback, so `tests/feedback-store.test.ts` (Postgres) will skip; I
ran it and it passes (the two store tests named for `at` and "exactly six fields"). You can run
`npx vitest run tests/feedback-page.test.ts`, `tests/feedback-dialog.test.tsx` and
`tests/feedback-route.test.ts`. If vitest cannot make its temp directory, set `TMPDIR=/tmp`.

## Attack it

Independently, before reading my suspicions. Try to get anything but a block id through
`feedbackPageAt`; try to make the client build an `href` that is not one of the two shapes; try to
find a click that loses the reader's place or a Write draft.

For each finding: an ID continuing the chain (C-F1, C-F2, …), a severity, and established or reasoned.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give (a) the input or mutation that shows it, and (b) the smallest change that closes it. A finding
with no (a) goes last. Refuse only on an established P0 or P1. End with a one-line verdict.

## Previous findings (the plan review)

| ID | Finding | Disposition | What changed |
|----|---------|-------------|--------------|
| P1-F1 | An unchanged `at` can land at the top: `navigate` scrolls to zero and `useReadingPosition` does not restore an `at` that did not change | fixed, differently from the proposal | The link's `onClick` calls `preventDefault` after closing the dialog when `location.pathname === page` and the address's `at` equals the row's; no `scrollToBlock` call |
| P1-F2 | The plan named the wrong route-test file | fixed | `tests/feedback-route.test.ts` extended |
| P1-F3 | The reason for passing over a server-built `href` was false | fixed | reworded |

## My own suspicions — read last

Already mine, so worth less than what you find yourself.

- The stay-put rule compares `location.pathname` to the label as text, so a trailing slash or an
  encoded slug in the address bar misses it and falls back to navigating (to the top). I accepted
  that as narrow; say if the router normalises these so it cannot happen, or if it is worse than I
  think.
- The stay-put rule reads the address's `at`, which is written debounced as the reader scrolls. If
  the address still holds a stale `at` equal to the row's while the reader has scrolled on, they
  stay where they are rather than going back to the paragraph.
- `feedbackPageAt` names `/read/public` as a literal.
