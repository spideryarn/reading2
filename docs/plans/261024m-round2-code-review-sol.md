## Findings

No P0–P3 findings; no R IDs or fixes were needed.

- The controller is owned by each `useChat` mount through a local `useRef`; a genuinely different mount creates a new controller. Only StrictMode’s synthetic cleanup/setup reattaches the same instance. All four navigation callbacks are gated, while retired-operation callbacks are pruned. [useChat.ts](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/web/useChat.ts:503) [controller.ts](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/web/chat/controller.ts:525)
- Cite-check validation uses parsed `sentOrigin`; only quiz rewrites `wantedOrigin`, which correctly feeds comparison and storage. Neither mode crosses into the other’s checks. [routes.ts](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/routes.ts:3707)
- `handoffThreadGone` correctly combines cite-check anchor removal with quiz’s refused-handoff bookkeeping.
- The migration retains both origin modes, quiz’s constraints/FK, cite-check’s shape and partial unique index, and the widened allowance bucket.

Verification:

- Requested and lifecycle suites: **168 passed**
- Additional pure origin/cite-check suites: **65 passed**
- Typecheck: **all 3,994 source files covered and passed**
- `git diff --check`: clean

`npm run typecheck` itself was blocked before checking by the sandbox denying `tsx`’s Unix socket. Running the identical script as `node --import tsx scripts/typecheck.ts` passed.

Verdict: **ready; no changes required.**

Files modified: **none**. No commit made. The two pre-existing untracked round-2 review documents remain untouched.