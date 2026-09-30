## Findings

- **C1 — P2 — [QuizPanel.tsx:397](/home/greg/code/spideryarn2/.claude/worktrees/quiz-build-up/src/web/QuizPanel.tsx:397)**  
  A replacement batch could clear the verdict map and then immediately restore an old completed verdict during the same effect flush when question IDs were reused. That could hide a premise using evidence from the previous batch.  
  **Changed:** track which batch the verdict-recording effect has seen and make its first pass on a new batch reset-only.  
  **Proof:** [quiz-panel.test.tsx:780](/home/greg/code/spideryarn2/.claude/worktrees/quiz-build-up/tests/quiz-panel.test.tsx:780) failed before the fix and passes afterward.

- **C2 — P2 — [messages.ts:151](/home/greg/code/spideryarn2/.claude/worktrees/quiz-build-up/src/messages.ts:151)**  
  Removing `quiz-spread` from `CODE_KINDS` made historical `[quiz-spread]` errors cease to count as authored/classified application messages.  
  **Changed:** added a separate retired-code map at [messages.ts:616](/home/greg/code/spideryarn2/.claude/worktrees/quiz-build-up/src/messages.ts:616), preserving history without claiming the live message still exists.  
  **Proof:** [messages.test.ts:280](/home/greg/code/spideryarn2/.claude/worktrees/quiz-build-up/tests/messages.test.ts:280) failed with `null` before the fix and now returns `retry`.

- **C3 — P2 — [evals/quiz-build-up.ts:151](/home/greg/code/spideryarn2/.claude/worktrees/quiz-build-up/evals/quiz-build-up.ts:151)**  
  Commit `443dbac9` treated `after` versus `after-2` as a control comparison and refused it because their prompt hashes differed. A concurrent workspace edit already corrected this to apply the identical-prompt requirement only to `before*` arms. I did not alter that edit. The generated `pairs-after-vs-after-2` artifacts demonstrate the corrected command completes, but there is no automated regression test.

Also corrected the stale “one-week bridge” comment at [routes.ts:7791](/home/greg/code/spideryarn2/.claude/worktrees/quiz-build-up/src/routes.ts:7791).

The other suspicions checked out: leading drops intentionally count because they have a kept successor; the CSS selector matches direct sibling elements; compatibility bands remain response-only and preserve real old bands; the marker receives only `question.question`; premises remain outside the list; difficulty/verdict wording is not rendered.

## Wider issues not fixed

- **W1 — P1 — prompt quality:** the latest dense-paper run still breaks the premise contract. In [the neural-paper result:29](/home/greg/code/spideryarn2/.claude/worktrees/quiz-build-up/evals/results/quiz-build-up/after-2/entropy-24-00930-spya-pywwkq.json:29), and repeatedly afterward, premises introduce context that the preceding question never established; several preview their own question’s answer. The blind read counted this in 15 of 19 premises. I did not edit `QUIZ_SYSTEM`, as instructed.

- **W2 — P2 — evaluation integrity:** [quiz-build-up.ts:175](/home/greg/code/spideryarn2/.claude/worktrees/quiz-build-up/evals/quiz-build-up.ts:175) silently omits cited block IDs absent from the current article while claiming to include every cited passage. It also does not bind the source pack to the article revision used for generation.

- **W3 — P2 — incomplete eval guard:** [quiz-build-up.ts:94](/home/greg/code/spideryarn2/.claude/worktrees/quiz-build-up/evals/quiz-build-up.ts:94) requires `outputTokens` and `maxTokens`, but not `elapsedMs` or the 14k answer allowance. A new arm can therefore silently print missing timing evidence as `-`, and the promised answer-room value is not recorded.

Verification: 7 pure suites passed, **168 tests**; all TypeScript projects passed; production builds passed; `git diff --check` passed. Postgres-backed route suites could not run because no local database was available. No commit made.

**Verdict: runtime code is sound after C1–C2, but the dense-paper premise failure remains a P1 product-quality risk.**