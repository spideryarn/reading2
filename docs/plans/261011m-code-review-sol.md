F1 — Medium — [src/guide.ts:99](/var/tmp/spideryarn-worktrees/fbgae0zv-guide-suggests-not-jumps/src/guide.ts:99): “never … run anything yourself” contradicted the Guide’s read-only article tools. Changed it to distinguish article-reading tools from app actions; updated the prompt test.

F2 — Medium — [dialogs.css:154](/var/tmp/spideryarn-worktrees/fbgae0zv-guide-suggests-not-jumps/src/web/styles/dialogs.css:154): the raised composer background was invisible inside ChatDialog because both used `--surface-raised`. Added a `--panel` override, giving the block-chat/marginalia card visible separation in both themes.

F3 — Low — [Reader.tsx:4091](/var/tmp/spideryarn-worktrees/fbgae0zv-guide-suggests-not-jumps/src/web/reader/Reader.tsx:4091), [chat-llm-help-commands-vision.md:294](/var/tmp/spideryarn-worktrees/fbgae0zv-guide-suggests-not-jumps/docs/project/chat-llm-help-commands-vision.md:294): removed stale wording implying the Guide still acts. Also corrected a stale short-viewport test name and indentation drift in `useChat`.

No remaining deletion/wiring issue found: `opensFree`, `Answered`, unarmed activators, and act modules have no production references; ordinary and Referee-behind-switch buttons retain the armed `ModeDoor` path.

Checks: 388 focused tests pass; typecheck passes across all 3,688 source files; diff check passes. Reviewed the supplied desktop, phone, landscape, next-step, and block-chat screenshots. The database-backed suite could not start without local Supabase; broader unit execution encountered unrelated sandbox/git-fixture failures.

VERDICT: ship after my fixes