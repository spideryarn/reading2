# Plan review: 261008i, Debate Claims picked by the reader

You are reviewing a **plan**, read-only, before anything is built. Repo: Spideryarn (this
worktree). Candidate: the untracked file `docs/plans/261008i-debate-claims-picked-by-the-reader.md`
on top of commit `4cc4f6a18` (dev). Nothing else is changed yet.

Read first: the plan; `CLAUDE.md`; `docs/project/debate.md`; `docs/project/mode.md`;
`docs/project/security-map.md`; `docs/project/sql.md`. Then the code the plan leans on:
`src/debate.ts` (`generateDebate`, `readClaimGroup`, `readShared`, `CLAIMS_SYSTEM`),
`src/types.ts` (Debate types), `src/pipeline.ts` (the `debate` step, its stamp), `src/routes.ts`
(`runRefereeClaims`, the debate routes), `src/db/schema.ts` (`referee_claims`, `article_revisions`),
`src/store/pg-referee-claims.ts`, `src/store/export.ts` (`ARTICLE_TABLE_COVERAGE`),
`src/store/public-reader.ts`, `src/web/DebatePanel.tsx`, `src/web/useDebate.ts`,
`src/web/modes/debate/DebateMode.tsx`, `src/referee-claims.ts`. These are where to start; they do
not limit scope.

Greg (the product owner) chose, in plain words: "C list the claims first, let them pick, and also
B allow them to input their own". The options he chose between are in
`docs/plans/261003o-debate-reception-and-claims-sub-modes-and-a-tidier-panel.md` § Q-claims-picker.
Do not relitigate that choice; do attack how the plan implements it.

## What to do

An independent pass first: is this plan right, buildable as written, and the simplest design that
does what Greg chose? Look in particular for: contracts it breaks (the stored debate, the public
reader, export, the stamp/freshness, the block-id contract), states it forgets (pending, error,
stale, sweep, two tabs, an old debate), spend that can happen without a press or twice for one
press, things a visitor could see that they should not, places in the code that "have to hear
about it" and are missing, and any simpler shape that gets the same result. Say where a stage
boundary is wrong.

Severity scale: P0 data loss, exploitable security, incorrect charging, or broadly unusable; P1
user-visible wrong behaviour or an authoritative contract violated; P2 design or maintainability
risk with no wrong behaviour today; P3 prose. Mark each finding established (direct evidence: the
exact source path) or reasoned. Give every finding an ID (F1, F2 …), the file and line you rely on,
and the change to the plan you would make.

**Write your findings as your final answer** (the caller saves it), ending with a one-line verdict:
"build as written", "build with these changes", or "rethink". Do not edit any file.

## My own suspicions (worth less; spend most of the run elsewhere)

- Whether removing pass B from the press without bumping `PROMPT_VERSION` is sound, or leaves a
  stamp/freshness lie somewhere.
- Whether the check rows can reuse `readShared`/`readClaimGroup` with a server-filled claim anchor
  without a second copy of the refusal logic.
- Whether the list running automatically on arrival in Claims is consistent with the repo's rules
  for spending on arrival (`armActivation`, Sketch's auto-runner, security-map).
- Whether a check (~90 s, a web-search call) can run in the request path on Vercel the way
  `runRefereeClaims` does, or must be a job.
