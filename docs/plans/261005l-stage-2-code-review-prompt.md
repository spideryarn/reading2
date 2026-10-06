# Code review: stage 2 of import sharing (a private link at import, a visitor's "still being added")

Repo: this worktree. You may fix what you find **inside this change** (`--sandbox workspace-write`);
report anything wider for me to decide. Do not run git commands that write.

## The candidate

One commit, `dba7839f9`: `git show dba7839f9 --stat`, then the diff. The plan is
`docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md` § "Stage 2" as amended by
§ "What the stage 2 plan review changed"; your plan review is
`docs/plans/261005l-stage-2-plan-review-sol.md`.

## What it is meant to do

- **2a**: the add page draws its job card from the POST's answer, not only from the polled list.
- **2b**: one Sharing section on the add page, shut by default, with stage 1's *Make it public*
  and a new *Create a private link* (`src/web/add-share-link.ts`, `AddShareLink.tsx`,
  `AddSharing.tsx`); controllers scoped to the reader (`src/web/add-sharing-session.ts`).
- **2c**: the public article read answers 409 `still-being-added`
  (`src/store/public-reader.ts` § `publicPendingImportQuery`, `src/still-being-added.ts`,
  `declaredFields` in `src/routes.ts`) and a visitor's page waits on it
  (`src/web/article/StillBeingAddedVisitor.tsx`, `access.ts`, `public-api.ts`, `ArticlePage.tsx`).

Greg, the product owner, accepted that a link holder learns an unpublished article exists, and
asked that you check **nothing else leaks**.

## The implementers' own departures and doubts (check them, do not take them on trust)

Server:
1. Pending = `status = 'queued' or (status = 'running' and lease_expires_at > clock_timestamp())`,
   with `leaseIsLive` imported from `src/store/job-fence.ts`; `tests/public-imports.test.ts` now
   permits `jobs` in `public-reader.ts` and `job-fence.ts` only.
2. A running job with `cancelling = true` and a live lease still counts as pending.
3. No database test for the `current_revision_id is null` clause (only the SQL-text test), and no
   test that a minimal unpublished row cannot reach the 409.
4. The wire sentence is `STILL_BEING_ADDED_REFUSAL` in `src/messages.ts`, kind `retry`.

Browser:
5. Two controller classes (`ShareAtAdd`, `LinkAtAdd`), sharing only the registry, the probe and
   constants.
6. Reader identity reaches `AddPage` as a prop; a mounted page re-finds its controllers after a
   retire through an epoch; the `sessionStorage` mark key now carries the reader id.
7. Shut unmounts both controls (the key is not in the DOM while shut); an unsettled section
   cannot be shut.
8. The link treats a 5xx on create or turn-off as unknown; unknown has a *Check again* button and
   no automatic re-read; there is no *Turn off* from unknown.
9. The visitor page decides nothing itself: any answer other than still-being-added calls
   `reread`. It also asks at once when the tab becomes visible.
10. An unconfirmed session (owned read 401) with a public 409 passes through as
    still-being-added, not `reauth-required`.
11. Left alone, older than this stage: `HighPowerIntent`, the purpose session and `articleAnswer`
    in `AddPage` are not reader-scoped; after a direct A to B account switch on a mounted add page
    B sees "Queueing it…" and nothing re-posts.
12. A held job is a snapshot: if the list never contains that id the card stays at its POST-time
    status.

## What I want from you

An independent pass first. Then:

- **2c, the leak question.** Read the query and the error path as shipped. Can any requester get
  the 409 for an article they could not read once published? Does the 409's body, headers,
  logging, or timing say more than "a shared, unpublished article with a live import is here"?
  Is anything else in `public-reader.ts`, `routes.ts` or the public dispatcher changed in effect?
  Is the widened table permission as narrow as it can be? Mutate the query (drop the access
  predicate, the owner correlation, the lease, the null revision) and say which tests go red.
- **The private link's key.** Trace every place the key can reach: controller state, the DOM,
  storage, logs, the offline cache, a URL, another reader after an account switch, a late reply.
- Each of your six plan-review findings: closed, with a test that would fail if reopened?
- React lifecycle in the new code: side effects in render, StrictMode, timers and polls that
  outlive their owner, replies after retire or unmount.
- Items 2, 10, 11 and 12 above: acceptable, or a defect?
- Anything simpler that loses nothing.

Run single test files with `npx vitest run tests/<file>` as the sandbox allows; a red test inside
the sandbox is not yet a finding, so say which you could not run (database tests may be blocked).

For each finding: severity (P0-P3), file and line, and what you did (fixed, or left for me and
why). End with the list of files you changed and a verdict line.
