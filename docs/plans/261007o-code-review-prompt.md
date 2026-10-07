You are the code reviewer-fixer for plan docs/plans/261007o-the-guide-acts-without-a-press-and-opens-every-new-article.md (read it, including "After the plan review" and "As built", and your own plan review at docs/plans/261007o-plan-review-sol.md).

The work is two commits on this worktree's HEAD: `git diff a373ada00..HEAD` (stage 1 `6830d4317`: the first-open default becomes the guide; stage 2 `bc94cf25a`: the guide's first move-only chip presses itself). Ignore merge noise outside those two commits.

Review for correctness and security, then FIX what you find that is inside this work, narrowly, writing a failing test first where a fix changes behaviour. Report — do not fix — anything wider. Do not commit; do not run git commands that discard work (no checkout/restore/reset/stash/clean). Do not edit docs/user-feedback or the Overseer queue. Never invent a quote from Greg; any quote you add must already exist verbatim in the repo.

You have no network: tests that need Postgres will not run for you. These run without it and you may run them:
npx vitest run tests/guide-acts-rules.test.ts tests/guide-acts-controller.test.ts tests/guide-acts-chips.test.tsx tests/guide-acts-conversation.test.tsx tests/guide-acts-live-stream.test.tsx tests/first-open-purpose.test.tsx tests/purpose-prompt.test.tsx tests/first-open-default-wiring.test.tsx tests/last-view.test.ts tests/guide-kind.test.ts tests/chat-command-chips.test.tsx
and `npm run typecheck`.

Things I am least sure of (check these last, after your own reading):
1. src/web/CommandChip.tsx: the effect that presses; `pressRef` assigned during render; deps; whether the press inside an effect can run against a stale executor; whether a chip that is disabled at the first commit and enabled a moment later is correctly NOT acted on.
2. src/web/ChatPanel.tsx Conversation: `drawnAct` gating; the subscription's deps (`onAnswered` identity from useChat is stable? `visible`); the Conversation remount at the begin frame when a new guide thread is named (ChatPanel keys Conversation by thread id).
3. src/web/chat/controller.ts: emitting Answered inside dispatch before commands run; a retry/edit shape; a superseded op.
4. Whether any `mode` that modeActsAlone allows actually spends or writes when its band mounts (check activation.ts MODE_TARGET and subModeGenerates against the bands: plain, structure, chat, referee, learn and its sub-modes).
5. Stage 1: first-open-purpose.ts's run() now applies without an outcome; any case where the modal and the guide both show, or neither, on a marked first open.

Write your answer to the output file: a verdict (land / land with your fixes / do not land), each finding with an id CR1.., severity P0–P3, file:line, what you changed (if anything) and the test that shows it, and a separate list of wider things you did not fix.
