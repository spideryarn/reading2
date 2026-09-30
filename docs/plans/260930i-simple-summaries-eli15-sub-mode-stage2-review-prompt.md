You are GPT Sol, doing the CODE review of stage 2 (client side) of plan
docs/plans/260930i-simple-summaries-eli15-sub-mode.md in the Spideryarn repo (this worktree). Read CLAUDE.md,
the plan (ledger included), your plan review (…-review-sol.md) and stage-1 review (…-stage1-review-sol.md),
docs/project/new-mode.md, and the new section of docs/project/summaries.md ("Simple — a plain-words orientation").

The stage is commits 5bcbe6ad and 3286c269 (view each with `show`). Templates it copied: FAQ's client
(0e947eb4, 81905905) and Remember's Quiz chip (src/web/QuizPanel.tsx, src/web/useQuiz.ts).

Look hardest for: spending on arrival (URL, Back, restore, last-view) rather than only on the Simple chip
press; the arm-before-check rule so a second press recovers; ModeBoundary / bandTarget token retirement;
the owner/visitor seam (a visitor must make NO request and see no job verbs); stale shown vs outdated
silent; the passage chips per paragraph (hover, jump, the right ids); rendering as plain text (no HTML
injection path); the Depth control's state under Simple and switching back; accessibility of the switch
(a real control, labelled, focus); the docs contradicting themselves (summaries.md's "does not have" list,
url-state.md); tests that could pass while the behaviour is broken (silent success).

The house rule: you FIX what you find inside this stage's scope, and report anything wider for me. Do not
commit. Do not run the full suite; run scoped tests (npx vitest run <files>) and the typecheck wrapper
(judge by exit code). Postgres-backed suites may be unreachable from your sandbox: say so rather than
treating that as a pass.

Final answer: findings numbered S2-1, S2-2… with severity P0/P1/P2, file:line evidence, and what you changed
(or why not); then the test commands you ran and their counts.
