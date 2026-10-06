# Review: sixth sweep clusters S7 (the deploy's robots.txt check) and S8 (the readiness panel's poll)

## The candidate

Your working directory is the clusters' own git worktree. Two commits: `e7b6411a9` (S7, with the
plan doc) and `d8052282b` (S8). `git show --stat e7b6411a9`, `git show e7b6411a9`,
`git show d8052282b`. The plan: `docs/plans/261006j-sixth-codebase-sweep-umbrella.md` § "What the
review changed" U10 and § For Greg item 10 (S7); S8 came from your own S3 review (C1 there). The
builder's record: `docs/plans/261006j-sixth-sweep-s7-s8-robots-check-and-readiness-poll.md`.

**Both touch tooling that runs on a higher standard than the app**: the deploy script (only the
Overseer runs it; a wrong check either passes a bad production file or fails every deploy), and
the fleet dashboard (the thing people reach for when something else is broken).

## What it is meant to do

- **S7**: `scripts/deploy.ts` § `verifyRobots` now judges the served `/robots.txt` with the
  group-aware `judgeRobotsTxt` (from `scripts/check-public-shell.ts`) through a new pure seam
  `judgeServedRobots(status, contentType, body)` in `scripts/deploy-checks.ts`; the per-line
  `hasDisallowAll` and its tests are deleted.
- **S8**: `tools/fleet/web/src/ReadinessPanel.tsx` — the panel now follows the server's
  `refreshMs`; the fetch and the timer became two effects in a small `useReadinessView` hook.

## What you can run, and what you may change

No network, no database. Run `node --import tsx scripts/typecheck.ts`, the deploy-check tests
(`grep -l "deploy-checks\|judgeServedRobots" tests`), `npx tsx scripts/check-public-shell.ts
--self-test` if it needs no network (read its header first), `tests/fleet-readiness-poll.test.tsx`
and the other readiness tests. **You may fix narrowly inside these commits' files, red-first.** Do
not commit. Do not run a deploy.

## Attack it

### S7
1. Feed the REAL `public/robots.txt` on disk through `judgeServedRobots` yourself. It must pass.
   Then what Vercel actually serves for it: content type (`text/plain; charset=utf-8`? what does
   `judgeRobotsTxt` accept — exact match, prefix, case?), a trailing newline or CRLF, a BOM, a
   redirect or a 304. Would any normal production response for the correct file now FAIL
   verification? That would fail every deploy after it has shipped.
2. Is the new check at least as strict as the old on everything the old one caught, and does it
   catch the reproduced case (a Twitterbot-only restriction beside an unrestricted
   `User-agent: *`)?
3. `verifyRobots` is also reachable with `--verify-only --host <host>`: any host for which the
   new judge is the wrong spec?
4. Importing `scripts/check-public-shell.ts` into the deploy's module graph: any top-level side
   effect, env read, or heavy import that now runs on every deploy start, or that can throw before
   the deploy's own argument checks?
5. `tests/public-readable-sharing-page.test.tsx` asserts `deploy.ts` does not name
   `check-public-shell`, and still passes because the import is in `deploy-checks.ts`. Is that
   test's intent still honoured, or is it now passing on a technicality? And the reader-facing
   page it guards (in `src/web`) — the builder says it now under-claims; is anything on it FALSE?
6. The builder edited a postmortem (`docs/postmortems/261005j-*`) "as facts". A postmortem is a
   record: is the edit a dated follow-up note, or did it rewrite history?

### S8
7. Is the two-effect hook right? One fetch per interval, no duplicate timers, no busy loop when
   successive answers alternate between two intervals, the timer restarted when the interval
   changes, cleanup on unmount, no state update after unmount, a failed fetch does not stop
   polling, and the existing 15 s – 10 min clamp and 120 s fallback are intact.
8. "Refresh no longer restarts the timer, it only fetches" is a behaviour change nobody asked
   for. Is it harmful (a fetch immediately followed by the scheduled one), harmless, or better?
   Could the old behaviour have been kept at no cost?
9. **Is this fix worth its size?** The defect is invisible unless `FLEET_READINESS_REFRESH_MS` is
   set (the server default equals the client fallback). The builder says the one-line fix (the
   interval in the single effect's deps, as `UsageHistory.tsx` does) fails six of seven tests
   including a busy loop. Verify that claim. If a materially smaller correct fix exists, say what
   it is. If the honest answer is "delete the server-supplied interval, since nothing sets it" —
   say that too; it would be a proposal for the product owner, not something to build here.

## Format

Verdict line first, **one per cluster**: **ship**, **ship with these fixes (applied)**, or **do
not ship**. Findings with ids (C1, …), severity P0–P3, `file:line`, reproduced or reasoned, fixed
(name files) or reported. Under 1,000 words.
