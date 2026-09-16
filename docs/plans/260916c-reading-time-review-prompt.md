# Plan review: where you have spent time reading (260916c)

You are reviewing a **plan, before anything is built**. Read-only.

## The candidate

Live pre-commit candidate on base `7c39e670` (branch `worktree-fb41-reading-time-heatmap`). One
untracked file is the whole of it:

- `docs/plans/260916c-show-where-you-have-spent-time-reading-in-the-spine-and-gutter.md`

The request it answers is quoted at its top (Greg, the product owner, 2026-09-12). Repo rules are in
`CLAUDE.md`; the docs the plan leans on are `docs/project/privacy.md`, `docs/project/database.md`,
`docs/project/sql.md`, `docs/project/experimental-features.md`, `docs/project/export.md`.

Code the plan names, to start from (not a limit on scope): `src/web/Spine.tsx`, `src/web/spine-marks.ts`,
`src/web/BlockGutter.tsx`, `src/web/styles/gutter.css`, `src/web/styles/spine.css`,
`src/web/TableView.tsx`, `src/web/reader/Reader.tsx`, `src/web/article/ArticlePage.tsx` (`OwnedReader`),
`src/web/reader-capability.ts`, `src/web/lib/api.ts` (`apiFetch`, `leavingFetch`), `src/web/useProfile.ts`
(existing hide/pagehide flush), `src/web/scroll.ts` (`stickyOffset`), `src/db/schema.ts`
(`blockIdentities`, `citationFinds`), `src/store/pg-citation-finds.ts`, `src/store/article-rows.ts`
(`ARTICLE_TABLE_COVERAGE`), `src/routes.ts`, `src/web/PrivacyPage.tsx`,
`tests/public-network-trace.test.tsx`, `tests/store-export-covers-tables.test.ts`,
`tests/db-schema-drift.test.ts`.

## What to do

An independent attack on the plan first. Is the design right, is anything in it false about the code,
will it do what Greg asked, and what is the simpler or better version? In particular check every
factual claim the plan makes about existing code against the code.

Severity by consequence:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

For each finding: severity, the claim, the evidence (file:line), and the fix you would make to the plan.
A refusal ("do not build this as planned") must say what would have to change. End with a one-line
verdict.

## My own suspicions — already mine, worth less; spend most of the run elsewhere

1. The generated `<style>` element for the gutter instead of props into `TableView`. Is that sound
   (CSP? a `style-src` that forbids inline styles? specificity against existing gutter rules?), or is
   there an existing cheaper path to per-row state that does not re-render every row?
2. The composite FK `(article_id, block_id) → block_identities`. Are block_identities rows ever deleted
   or rewritten (re-extraction, the rollback in `src/store/export.ts`, the importer), which would cascade
   away reading time?
3. No `owner_id` column, unlike every sibling table. Does anything (a test, an RLS policy, an admin
   view, the export rollback) assume per-article tables carry one?
4. Is putting both recording and display behind the experimental switch right, and is the privacy
   bullet wording true of the plan?
5. The level scale (`expected = max(3 s, words / 230 wpm)`, crediting every on-screen block fully):
   will the spine actually show "I got 40% through" or will it just be uniformly thick near anywhere
   the reader has been?
