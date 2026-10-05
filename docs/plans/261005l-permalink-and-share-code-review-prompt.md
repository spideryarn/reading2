# Code review: the permalink, and sharing, while an article is importing

Repo: this worktree. You may fix what you find **inside this change** (`--sandbox workspace-write`);
report anything wider for me to decide. Do not run git commands that write. Do not touch server
code (`src/routes.ts`, `src/store/**`, `src/jobs.ts`): the change is meant to be browser only, and
if you think it needs a server change, say so and stop there.

## The candidate

One commit, `4c6f2cc5b`: `git show 4c6f2cc5b --stat`, `git show 4c6f2cc5b`. The plan it was built
from is `docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md`, and your own
review of that plan is `docs/plans/261005l-permalink-and-share-plan-review-sol.md`.

## What it is meant to do

Read the plan's § What we build. In short: (1) `JobCard` gets a copy-the-link button for an import
job; (2) the signed-in owner opening `/read/<slug>` before publication sees the import's card and
then the article, not "Not shared"; (3) the add page offers "Make it public" with the Metadata
card's own confirmation, one `ShareAtAdd` per slug.

## The implementer's own list of departures and doubts (check these, do not take them on trust)

1. `settle()` takes no slug and is called in AddPage's completion effect, only when
   `share.slug === completionSlug`.
2. A share disposed while its publish request is still out sends `private` when that request
   answers; a last-confirmed-public `refused` is taken back too.
3. Once held at *Ready* for sharing, the page stays until *Open the article*, even after the share
   turns `on`.
4. The box stays drawn outside the offer interval once the reader has acted on it.
5. `OwnerNotShared` follows the job by id once found; a Retry under another slug navigates to
   `/read/<new slug>`; an 8-second fallback to `NotSharedPage` if no fresh list arrives.
6. An in-place address change from `/add/A` to `/add/B` disposes A's share with take-back.
7. A reload of the add page after sharing shows the box unticked while the article is public
   (nothing published, so the probe is still 404). Re-ticking is idempotent.
8. Share `on`, the import fails, the reader leaves: the slug stays public with nothing published.
9. Minimal-paper jobs (`fetch`, `metadata`) count as import jobs.
10. The probe is `GET /api/metadata/:slug`, status only; an offline-cache copy counts as unknown.

## What I want from you

An independent pass first. Then:

- Each of your nine plan-review findings: is it actually closed in the code, with a test that
  would fail if it were reopened? Try mutating the code to see a test go red where you doubt it.
- Can any path send `{visibility:"public", rightsConfirmed:true}` for a slug the owner did not tick
  and press for? Can any path leave a slug public while the page says it is not, or the reverse?
- React: side effects started in render, StrictMode double mounts, stale closures, timers that
  outlive their owner, a request answered after dispose or unmount.
- `StillBeingAdded.tsx`: wrong page for a visitor, a loop, a flash of "Not shared", a job list
  that never arrives.
- Is there a simpler form of any of this that loses nothing?
- Items 7 and 8 above: are they acceptable for a v1, or is one a defect?

Run single test files with `npx vitest run tests/<file>` as the sandbox allows; a red test inside
the sandbox is not yet a finding, so say which you could not run.

For each finding: severity (P0-P3), file and line, what you did about it (fixed, or left for me and
why). End with the list of files you changed and a verdict line.
