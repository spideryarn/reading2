# Code review: several Skim briefs, stages 3 and 4, the client and the picker (261027d)

You are reviewing, and may fix, code in the repo at the current directory (a worktree of Spideryarn). Candidate: **stage 3**, commit `626998085` (`git show 626998085`), and **stage 4**, the picker, uncommitted in the working tree (`git diff HEAD`, plus the untracked `src/web/SkimBriefPicker.tsx` and `src/web/ArmedDelete.tsx`, which is Chat's control moved out of ChatPanel.tsx unchanged). Greg chose the picker's option A: the *Reading for:* line gets a ▾ that opens the list (plan § The picker). The plan is `docs/plans/261027d-several-skim-briefs-per-article-and-a-picker-between-them.md`. Its Log's last two entries describe these stages, and the entries above it cover stage 2's server, which you reviewed in `docs/plans/261027d-several-skim-briefs-code-review-sol.md` and `-code-review-2-sol.md`. Both stages are client only, apart from `publicJob` now keeping `skimBrief` (your C4).

Start with `src/web/SkimBriefPicker.tsx`, `src/web/useStepJob.ts` (`writesStep`, `start`), `src/web/useSkim.ts`, `src/web/rewrite-hold.ts` (`keyOf`), `src/web/modes/skim/SkimMode.tsx` (`SkimBand`, `SkimRouteBand`), `src/web/SkimPanel.tsx`, `src/web/skim-briefs.ts`, `src/web/params.ts` (`briefParam`), and `src/web/last-view.ts`. This list does not limit scope.

## What I want

An independent attack on:
- **Job scoping (C4).** A brief's `skim` job must never show as the default's progress, completion, failure or Retry: in the default band, in Metadata's Skim row, in the command bar, or in any other `useStepJob` caller. The reverse holds too. A brief job's Quotes and Ideas steps should still count as Quotes' and Ideas' own jobs. Check every caller of `useJobs` and `writesStep`-like filters, not just `useStepJob`.
- **The hold and the auto-run.** Does switching routes release or inherit a hold? Can the band's automatic run ever spend on a brief?
- **URL and last-view (F7).** Brief, stop and depth are one position. Can a stop from one route be applied to another: on switch, on an unknown id, on a back/forward, or in a restored last view? Does a visitor ever act on `?brief=`?
- **The read.** Does a 404 for a deleted brief show as an error rather than an empty state with a button? Does the remount by `key` lose anything that must survive, or keep anything that must not?
- **The picker (stage 4).**
  - *New brief* creates the brief, switches to it, and plans it exactly once: no double job, and no plan for a brief that already has a route.
  - Deleting the brief on screen returns to the default.
  - *Edit* on a brief re-plans it, and the default's *Edit* still re-plans the default.
  - `useSkimBriefs`'s local overlay (for a read in flight across a create) is correct, and can neither bring back a deleted brief nor hide a real one.
  - The 12-brief limit.
  - Keyboard, phone width and touch.
  - controls.md's rule that controls doing the same job look the same.
- **Privacy.** Is the brief's sentence ever sent to a visitor, a log or the job wire?

## Fix as well as find

Fix what is inside this stage, narrowly and red-first: write or adjust a test that fails, then fix it. Report anything wider without fixing it. You have no network, so Postgres tests will not run for you; list any I should run. You can run `npm run typecheck` and the jsdom suites (`npx vitest run tests/skim-panel.test.tsx tests/skim-briefs-client.test.tsx …`), but they may also need the database lane. Say which of your fixes you could not run.

## Severity

P0 = would lose or corrupt reader data or open a security hole. P1 = would not work, or would ship a visible bug. P2 = worth fixing, not blocking. P3 = nit. Give every finding an ID (D1, D2, …), a severity, the evidence (file:line), and whether you fixed it.
