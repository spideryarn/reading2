# Code review: Trajectory becomes Skim (261001r), with write access

You are reviewing AND fixing, in this worktree. Read CLAUDE.md, then the plan
docs/plans/261001r-trajectory-becomes-skim-and-marginalia-rename-audit.md (including § After the plan
review, which records your own plan review and what was accepted/overruled), then the work:

- Stage 1, FAQ snippets removed from the stop: `git show 7e43dac60`.
- Stage 2, the rename: `git show cdbf30beb` (176 files; most are mechanical — focus on the parts
  below). Then a merge of origin/dev, 03f2071ad (one doc conflict resolved in
  docs/project/high-powered-ai.md).

Do not commit. Never run git commands that discard work (no checkout/restore/stash/reset/clean). You
have no network: you cannot reach Postgres, so do not try pg tests; unit tests (`npx vitest run
<file> --maxWorkers=2`) and `npm run typecheck` you can run.

**Fix what is inside this stage, narrowly and red-first** (write or adjust a test that fails, then
fix). **Report, do not fix,** anything wider you notice.

Look hardest at:
1. drizzle/20261001211832_skim.sql — correctness on real rows: the RENAME, the CHECK ordering
   (drop → update → add), the jobs.steps / jobs.reset jsonb rewrites (order preserved, NULL `reset`,
   `reset` without `regenerate`, an empty array, a job whose steps contain both names), the
   postcondition. Does anything else persisted need rewriting that was missed? Was `work_key` left
   alone deliberately (plan F5)?
2. The kept old spellings: src/modes.ts RETIRED_MODES, src/mode-catalog.ts alias, src/feedback-payload.ts
   RETIRED_STEPS / normalisation, src/cost-categories.ts RENAMED, PROMPT_VERSION "trajectory/7" and the
   "trajectory-input\n" namespace in src/skim.ts. Are they all reached on every path, and does any
   kept spelling leak somewhere it should not (e.g. a stale tab's step being stored as `trajectory`)?
3. Anything the mechanical rename broke: a Greg quotation respelled (his words must stay verbatim),
   a string that is persisted or user-facing renamed in a way that reads badly, CSS classes in TSX
   that no longer match the stylesheet, `.mode-band.skim` selectors, the public DTO field rename and
   any client that reads the old field, the export bundle (skim.json) and its README, API route
   `/api/skim/` in both src/routes.ts and src/web/lib/api.ts allowlists.
4. Stage 1: is anything left that existed only for the FAQ snippets, or was anything removed that
   something else still needs?
5. Docs: docs/project/skim.md and the other evergreen docs — do they now match the code (names,
   paths, functions)? Check `visibleCounts`, `skimInputHash`, the kept-spellings list.

Severity scale: P0 (ships broken / data loss), P1 (real defect likely), P2 (worth fixing), P3 (nit).
Give each finding an ID (C1, C2, ...), file:line evidence, whether you FIXED it (and the test that
went red→green) or only REPORTED it. End with the list of files you changed and a one-line verdict.
