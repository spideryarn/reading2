# Code review and fix: 261008i stage 2, Debate's claims list

Repo: Spideryarn, this worktree. Candidate: commit `905c46ff6`, one commit on top of the merge
`5e8acca43`. See it with `git show --stat 905c46ff6` and `git show 905c46ff6` (about 80 files; do
not diff against the merge-base, which sweeps in other people's commits). Start with
`src/debate-claims.ts`, `src/web/useDebateClaims.ts`, `src/web/DebatePanel.tsx`,
`src/web/modes/debate/DebateMode.tsx`, `src/web/activation.ts`, `src/public/dto.ts`,
`src/store/public-reader.ts`, `src/store/pg.ts` (`shareableArtefacts`, `isCurrent`),
`src/public-artefacts.ts`, `src/store/export.ts`, `drizzle/20261008222555_debate_claims.sql`,
`tests/debate-claims.test.ts`. The list does not limit scope.

The plan: `docs/plans/261008i-debate-claims-picked-by-the-reader.md` § 2, § 4, § 5, § Stages
(stage 2), and its review ledger; stage 1 is `41ad4b649` and `4cb7933e0`. House rules:
`CLAUDE.md`. Read `docs/project/mode.md` § The artefact, if the mode shows one (the checklist this
stage follows), `docs/project/security-map.md`, `docs/project/block-ids.md`, and
`docs/project/prompting-guide.md` for the prompt.

## What to do

An independent pass first. Is stage 2 correct and complete? In particular:

- **Spend**: can the list job, or the Reception search, start without a press (link, Back,
  reload, last-view restore, a visitor, a stale list, two tabs, StrictMode)? Does a Claims press
  ever arm `debate`, or a Reception press `debate-claims`?
- **The public boundary**: the projection must expose exactly `claims[].{id, blockId, quote,
  statement}`. The builder also changed what counts as Debate being present for a visitor
  (`shareableArtefacts` in pg.ts, `artefactsIn` in public-artefacts.ts: debate OR a usable list).
  Is that a weakening of any refusal, or only an inventory? Say plainly; if it alters a defence
  named in security-map.md, **do not fix it, report it** as a finding for Greg.
- **The block-id contract**: are quotes re-found and replaced as the referee rule does; can a
  claim reference a block the article does not show?
- **The checklist**: every table and route mode.md names, the migration matching the schema's
  hand-kept CHECK, export, carry policy, the stamp and `outdated`.
- **States**: none, pending, done, done-empty, error, stale; owner and visitor; Claims reachable
  with no stored debate; Reception's own states unaffected.
- **The prompt**: is it what prompting-guide.md asks for?

**You may fix what you find inside this stage**, narrowly and red first (write the failing test,
see it fail, fix, see it pass). Run test files with `npx vitest run <file>` (Postgres-backed tests
may not run in your sandbox; say so rather than skipping silently). Do not commit. Report, do not
fix, anything wider than stage 2 and anything touching a security-map defence.

Severity: P0 data loss, exploitable security, incorrect charging, broadly unusable; P1
user-visible wrong behaviour or an authoritative contract violated; P2 design/maintainability
risk; P3 prose. Mark each finding established or reasoned, with an ID (D1, D2 …), file:line, and
what you changed (or why not).

Your final answer: the findings, the files you edited, the test commands you ran with results,
and a one-line verdict ("land", "land with the fixes made", "do not land").

## My own suspicions (worth less)

- The builder notes the stamp hashes the tree although the prompt sends no outline, so renaming a
  section makes the list stale. Is that right, or should the stamp be blocks-only?
- `useDebateClaims` and `useDebate` are both mounted in both sub-modes: any double fetch or
  cross-arming?
