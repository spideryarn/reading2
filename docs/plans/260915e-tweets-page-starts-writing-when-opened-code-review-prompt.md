You are reviewing BUILT CODE in the Spideryarn repo (the current working directory), and you may
fix what you find, inside this change's scope. Work in this order:

1. FIRST write your findings — before changing anything — to
   docs/plans/260915e-tweets-page-starts-writing-when-opened-code-review-sol.md: each with severity
   (P0 / P1 / P2), file:line, a concrete failure scenario, and the fix. End with a verdict line.
2. THEN fix every P0/P1 that is inside scope, and any P2 that is cheap. Do not commit. Do not run
   git commands that discard or move work (no checkout/restore/stash/reset/clean/rebase). Anything
   wider than this change — especially anything touching billing, rate limits, auth, or a defence
   listed in docs/project/security-map.md — you REPORT only; do not edit it.
3. Append to the same file a section "## What I changed" listing each edit and which finding it
   answers, and the commands you ran to check it (e.g. `npx vitest run <files>`,
   `npm run typecheck`). Do NOT run the full `npm test` suite (the box is shared); scoped vitest
   files only.

The change: the commit at HEAD on this branch (`git show HEAD`), plus anything uncommitted
(`git diff HEAD`). Scope it with `git show --stat HEAD`. The plan it builds is
docs/plans/260915e-tweets-page-starts-writing-when-opened.md; your own plan review is
docs/plans/260915e-tweets-page-starts-writing-when-opened-plan-review-sol.md, and the plan's text
records how each of your findings was answered — check each answer against the code.

What it does: the Tweets page (`/read/<slug>/tweets`, src/web/Tweets.tsx) now writes the thread on
any owner arrival that finds none, via a new `useAutoRunOnArrival` in src/web/useAutoRun.ts (one
attempt per (slug,"tweets") per page load through jobEngine.beginAutoAttempt; one re-read after a
failed read; callbacks in refs). The press-arming for Tweets is removed: the Dock link's and the
command bar row's `onNavigate`, `DockLink`'s and `Link`'s `onNavigate` prop, command-match.ts's
field, and `armActivationForTweets`.

Evidence: tests/tweets-press-starts-it.test.tsx (7 cases, real Dock/Link/router/Tweets under
StrictMode). The two arrival cases were red before the change; the two failed-read cases went red
with the re-read line removed; the press case went red with the hook call removed. Scoped runs
green: tweets-press-starts-it, pressing-a-chip-arms-it, command-bar, modes-that-start-themselves,
public-network-trace, tooltip-on-link, dock-mode-tooltips, dock-corner-controls,
every-mode-draws-its-surface, step-job-force, refused-job-reason-survives, artefact-read-race
(12 files, 289 tests). `npm run typecheck` green.

The conclusion I'd least like to be wrong about: **that no path now spends twice, or spends for
somebody who is not the article's owner.** Specifically check: StrictMode double effects in the
new hook; an accepted job that later fails (does anything re-fire?); a job completing →
`refresh` → `ready` → nothing; the reload/re-read path when the GET fails then 404s; visitor and
signed-out pages (PublicPages.tsx VisitorTweetsPage) — they must still make no POST; and whether
removing `Link.onNavigate` changed click behaviour for any other Link (⌘-click, target=_blank,
defaultPrevented).

Also: an accepted-job-later-fails test is missing from the new file (your plan review asked for it)
— add it if the harness allows (the posed `useJobs` returns `jobs`; a job object for `tweets` with
status `failed` may be enough — see src/types.ts `Job` and src/web/useStepJob.ts for what it reads).
Check the prose I changed (docblocks in activation.ts, useAutoRun.ts, auto-run-targets.ts,
Tweets.tsx, Dock.tsx, Link.tsx, CommandBar.tsx, and docs/project/reading-view-overview.md,
new-mode.md, web-client.md) for anything now false, and grep for any remaining claim that the Tweets
link or row arms a run.
