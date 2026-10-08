# Code review and fix: 261008i stage 1, Debate's press searches for Reception only

Repo: Spideryarn, this worktree. Candidate: commit `41ad4b649` (one commit on top of
`1835ede7b`). See it with `git show 41ad4b649` and `git show --stat 41ad4b649` (27 files). Start
with `src/debate.ts`, `src/types.ts` (`DebateClaims`, `isDebateDocument`), `src/public/dto.ts`,
`src/web/activation.ts`, `src/web/DebatePanel.tsx`, `src/web/Dock.tsx`; the list does not limit
scope.

The plan: `docs/plans/261008i-debate-claims-picked-by-the-reader.md` § 1 and § Stages, stage 1;
the plan review and its ledger are in the same folder. House rules: `CLAUDE.md`. Read
`docs/project/mode.md` (activation and PROMPT_VERSION rules) and `docs/project/security-map.md`.

## What to do

An independent pass first. Is stage 1 correct and complete as the plan's § 1 defines it? In
particular: does any reader (owner panel, visitor DTO, marginalia, chat tools, export, the
registry, the eval) still treat a not-run claims group as "searched and found nothing", or read
`counts` it no longer has; does a legacy document (no marker) read and draw exactly as before;
can any press, link, Back, restore or command still arm the Reception search while landing on
Claims, or fail to arm it on Reception; does the public DTO change weaken any refusal; is the
copy true.

**You may fix what you find inside this stage**, narrowly and red first (write the failing test,
see it fail, fix, see it pass). Run the test files you touch with `npx vitest run <file>` (tests
needing Postgres may not run in your sandbox: say so rather than skipping silently). Do not
commit. Report, do not fix, anything wider than stage 1.

Severity: P0 data loss, exploitable security, incorrect charging, broadly unusable; P1
user-visible wrong behaviour or an authoritative contract violated; P2 design/maintainability
risk; P3 prose. Mark each finding established or reasoned, with an ID (C1, C2 …), file:line, and
what you changed (or why not).

Your final answer: the findings, the list of files you edited, the test commands you ran with
their results, and a one-line verdict ("land", "land with the fixes made", "do not land").

## My own suspicions (worth less)

- The builder said `modeStep("debate")` is now null and `subModeGenerates` changed: check that
  nothing that counts generating modes (auto modes, the command bar's "generates" badge, rerun
  steps) now misbehaves for Debate's Reception.
- The not-run copy in the (i) for a visitor: is it true for a legacy document?
