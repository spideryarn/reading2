# Review: a plan to let the Earlier tab's page link also carry the reading position (`?at=<block id>`)

Repo: this worktree, branch `worktree-qi-hwkfga7y-earlier-link-carries-at`, cut from `dev` at 734bd681a.
TypeScript + ESM, a Node server and a React client. This is a **plan review**: nothing is built yet.

## The candidate

Live pre-commit: base 734bd681a; untracked: `docs/plans/261006b-earlier-link-carries-the-paragraph.md`
(the plan; read it first, it is short). Not durable; the commit SHA will be recorded in the plan.

Start with: the plan, then `src/feedback-page.ts`, `src/web/FeedbackEarlier.tsx`,
`src/store/pg-feedback.ts` § `listMine`, `GET /api/feedback` in `src/routes.ts`, `src/ids.ts`,
`src/types.ts` § `EarlierFeedback`, and the earlier plan
`docs/plans/261005m-earlier-tab-links-the-page-and-marginalia-tips-say-what-to-press.md`.
That is where to begin, not the limit.

## What it is meant to do

The reader's own Earlier tab shows each report with a link to the page it was filed from. The stored
address is never sent to the client because its query can carry search terms; only a path label is.
The plan adds exactly one thing from the query: the `at` block id, validated by shape on the server
and again on the client, so the link opens the article at the paragraph. The invariant: **nothing
from the stored address reaches the client except the existing path label and a value that passes
`isSpideryarnId`**, and the link can never leave this site.

Out of scope: restoring the mode or any other parameter; checking the block still exists.

## What you can and cannot run

The tree is read-only. /tmp is writable; you may run one test file (`npx vitest run tests/<one>.test.ts`)
or a small script. No network, not even loopback, so anything needing Postgres will skip.

## Attack it

Independently, before reading my suspicions. Is the statement of the invariant above accurate for the
design in the plan? Is anything in the plan false about the existing code? Is there a simpler design
that does the same? Is a test missing that would let a defect through?

For each finding: an ID (P1-F1, P1-F2, …), a severity, and whether it is established or reasoned.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give (a) the concrete scenario the plan does not handle or the contract it contradicts, and (b) the
exact replacement wording or smallest design change. A finding with no (a) goes last. Refuse only on
an established P0 or P1. End with a one-line verdict.

## My own suspicions — read last

Already mine, so worth less than what you find yourself.

- Whether the new/old build compatibility (a missing `at` field read as null) is right in both
  directions: a new server answering an old tab sends an extra field the old validator ignores.
- Whether `/read/public?at=…` or `/read/<slug>/metadata?at=…` should be refused as the plan says, or
  whether that is a needless special case.
- Whether a block id in the reader's own list tells them anything they did not already have (I think
  not: it is their own report's own address).

Do not change any file.
