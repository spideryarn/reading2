# GPT Sol code review: plan 261018a (front and back matter marked at import and folded by default)

You are reviewing code in the git worktree `/var/tmp/spideryarn-worktrees/fbftsqsn-front-matter-folded`
(branch `worktree-fbftsqsn-front-matter-folded`). **Fix what you find inside this work**, and report
anything wider for me to decide. You can write files; you may not commit, push, deploy, stash,
reset, checkout, restore or rebase, and you may not touch `.env.local`, `infra/`, systemd or any
remote database. Make no paid model calls (no OpenRouter; `scripts/matter-eval.ts` without its
cache would make them, so do not run it). The local database is shared with other agents; tests
may go red for reasons that are not ours. Stay out of Sources mode / citation-blurbs code
(another session owns it).

## Read first

- `CLAUDE.md` (the working rules), `docs/project/block-ids.md` (range checks go by blocks.json
  index, never by comparing ids), `docs/project/security-map.md` (the public DTO
  `src/public/dto.ts` is a listed defence; a model's output on a stranger's text is untrusted).
- The plan: `docs/plans/261018a-front-and-back-matter-marked-at-import-and-folded-by-default.md`,
  including § The plan review, § What building changed and § Ledger. Your plan review was
  `docs/plans/261018a-plan-review-sol.md` (F1–F10); check its accepted findings were built.
- The area doc `docs/project/front-and-back-matter.md`; the eval
  `docs/investigations/261018b-front-and-back-matter-eval.md`.

## The code under review

The diff is `git diff f2eaaa86a HEAD` minus whatever came in from `origin/dev` in the two merges
(`4d0b93f72`, `07cb5235a`). The branch's own commits are (`git log --no-merges f2eaaa86a..HEAD`,
excluding `c288a99ff`, `b1f486d33`, `c1d9a5a61`, which are another session's):

- `2dbca0050` stage 4: a page with no declared authors takes authors and year from its own id's
  registry record (`src/article-registry.ts` `OwnIds`, `src/pipeline.ts`,
  `src/backfill-registry-facts.ts`). **This is an exception to "page metadata wins"; check the
  title-match guard cannot attach a different paper's authors.**
- `f85e5cdfd`, `f87620ee9`, `1bd7e790f`, `7471493c3`, `03251c96b` stage 1: `src/matter.ts`
  (classifier + every code check + `combineMatter` + `holdStretches`), `src/matter-labels.ts`,
  `src/section-ranges.ts`, `scripts/matter-eval.ts`.
- `80e7358e8` stage 2: `src/matter-step.ts`, `src/matter-shape.ts`, the migration
  `drizzle/20261018022626_matter.sql`, the successor job in `src/store/pg-revisions.ts`
  (`publishRevisionIn`), storage in `src/store/*.ts`, `matterForReader` in the owner read
  (`src/store/pg.ts`).
- `49c065cae`, `634920506` stage 3: the reading view. `src/web/fold.ts` (stretches,
  `isRowHidden`/`isContentHidden`, `visibleFrom`/`visibleNear`, `toggleStretch`, `jumpToRow`,
  `openStretchesWithin`, `tightStubs`), `src/web/matter-view.ts`, `src/web/MatterMark.tsx`,
  `src/web/FoldToggle.tsx` (`MatterStub`), `TableView.tsx`, `Masthead.tsx`, Structure/Outline
  panels, and every consumer (on-screen, marginalia, Reader, scroll, Spine, keynav,
  useReadingPosition, useColumnContext, position).
- `cf14ec4fa` tests driving the `matter` successor job with a fake step.

`git show <sha>` each. Read the code, not only the diff, where a seam needs it.

## What I most want checked

1. **Can it fold the article's own prose?** Any path by which the model's answer, the label rule,
   or `combineMatter` produces a stretch that passes the checks but holds the piece's own prose;
   any check done by id comparison rather than index; any cap that a claimed kind can switch off.
2. **Staleness and the read.** `matterInputHash` (`m1`) and `matterForReader`: can a stored value
   be shown for blocks it was not computed from (re-extraction with preserved ids, a draft copied
   from a published revision, a reset)? Does the successor job get queued exactly when it should,
   and can it loop (publish → matter → publish → matter)?
3. **The reading view.** Can the reading position (`?at=`, a reload) name a hidden block or a stub
   (F6)? Does any consumer use the wrong one of `isRowHidden` / `isContentHidden`? Does a jump
   (search hit, comment, Structure row, keynav) into a shut stretch open it? A stretch at the very
   end of the article?
4. **Defences.** Confirm `matter` reaches no visitor (`src/public/dto.ts` untouched; the public
   reader uses the old 261007d rule). Nothing the model writes is drawn, only ids it was shown.
5. **Tests that could not fail.** Any test here that would pass with the feature removed.

## Gates

`npm run typecheck`, and `npx vitest run` on `tests/matter*.test.ts tests/fold*.test.ts
tests/matter-view.test.ts tests/section-ranges.test.ts tests/article-registry*.test.ts
tests/open-before-structure-queue.test.ts` plus any test file for code you change. Report what you
ran and its result.

## Output

Severity scale: P0 (would ship broken or harm readers' data), P1 (a real defect to fix before
pushing), P2 (worth doing, not blocking), P3 (nit). Give each finding an ID (C1, C2…), a severity,
the evidence (file:line), and either "FIXED: <what you changed, which files>" or "NOT FIXED:
<why, and the fix you propose>". List every file you changed. End with a verdict line:
"VERDICT: push" or "VERDICT: push after the listed fixes" or "VERDICT: do not push".
