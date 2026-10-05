- **C1 · P1 · [QuizPanel.tsx:854](/home/greg/code/spideryarn2/.claude/worktrees/fb-quiz-answers-kept/src/web/QuizPanel.tsx:854) — fixed.** Opening question 2 from the prose could fill its box with question 1’s kept answer. Restoration now waits for the arrival’s destination. The “restores the arrival’s question…” regression went red, then green.

- **C2 · P1 · [api.ts:825](/home/greg/code/spideryarn2/.claude/worktrees/fb-quiz-answers-kept/src/web/lib/api.ts:825) — fixed.** A GET with `attempts: null` erased previously cached answers, leaving empty boxes after an offline reload. It now leaves a complete same-batch copy untouched. Both the offline-reload regression and a concurrent-refresh race test went red, then green. New-batch isolation passes.

- **C3 · P3 · [quiz.md:570](/home/greg/code/spideryarn2/.claude/worktrees/fb-quiz-answers-kept/docs/project/quiz.md:570) — fixed.** The doc claimed a public promise about not storing verdicts; the rendered privacy page makes no such promise. Wording now describes the internal decision.

Validation: **228 focused tests passed**, typechecking passed, and both requested suites detected deliberate mutations. The broader unit run was stopped after CLI-wrapper failures; a separate control confirmed the sandbox’s `tsx` IPC restriction (`EPERM`). Database checks rely on your supplied evidence.

No ownership, logging, public-payload, export, or Greg-attribution defect found. Added two postmortems. No commits, remote database changes, or deploys.

approve with the fixes made