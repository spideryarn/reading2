# Review: built realtime chat repair

Read-only: do not edit files. Review the implementation independently, then the evidence below.
The user wants native two-way article conversation from Chat's Live button: start new or resume,
hang up and keep the same conversation for typing/dictation/resume, visible input feedback,
streaming transcripts, tools and useful fallback. Capability first; the existing provider-accepted
`gpt-realtime-2.1` remains configured.

Base: `39282f8ca7e616a212720a7469e1b680cdf874e3` on `worktree-realtime-chat-repair`.
The candidate is uncommitted. Read `git diff HEAD --` for these tracked paths:

- `src/web/live/useLiveConversation.ts`, `src/web/live/wiring.ts`, `src/web/live/LiveButton.tsx`
- `src/web/App.tsx`, `src/web/ChatPanel.tsx`, `src/web/preview-composer.tsx`, `src/web/styles.css`
- `tests/live-session-flow.test.tsx`, `tests/chat-live-handoff.test.tsx`, `tests/chat-list-composer.test.tsx`
- `docs/project/live-conversation.md`

Explicit new source/test files (untracked, absent from that diff):

- `src/web/live/tool-responses.ts`
- `src/web/live/LiveStatus.tsx`
- `src/web/PassageLinks.tsx`
- `tests/conversation-band-live.test.tsx`

New evidence/docs: `docs/plans/260906f-repair-realtime-chat.md`, the `-checks.md`,
`-runtime-results.txt`, `-ui-results.txt`, `-browser-results.md`, `-plan-review-sol.md`,
`-plan-review-followup-sol.md` siblings, and
`docs/postmortems/260906f-a-working-transport-mistaken-for-a-working-conversation.md`.
The two plan-review prompt siblings are retained as provenance. This prompt and your answer
are also new artifacts, not implementation.

Attack concrete failure paths, including asynchronous ownership, cancellation, persisted versus
provisional transcript rows, seed-before-listen, multiple tools and interruptions, and the actual
Chat entry point. Read neighboring ledger/controller code as needed. No new schema or store is
part of this change. Do not infer acoustic microphone/speaker success from synthetic tests.

Return READY or NOT READY explicitly. Stable F1 etc findings with severity P0=data loss,
security, incorrect charging, broad outage; P1=current user-visible wrong behavior or authoritative
contract violation; P2=maintainability without current wrong behavior; P3=prose. Refuse only
established P0/P1. For each finding supply the failing input/order and smallest adjustment,
with a test or mutation witness the implementer can reproduce before fixing. Separate established
findings from reasoned risks. Do not implement the patch.

You may run one local-only test file using
`node node_modules/vitest/vitest.mjs run tests/live-session-flow.test.tsx`.
No network/database is available to your sandbox. Root owns full gates and Postgres tests;
use their recorded raw evidence rather than attempting those again. A blocked temporary directory
is not a passing test. Keep the pass bounded; do not run broad suites.

Context to read after your independent pass: the plan received a substantive READY follow-up.
Its initial F1 assumed Remember had no existing Live control; git history proved that premise
stale, so existing open-thread Remember Live was retained. The new list-level entry is Chat only.
F2 optimistic/live duplicate ownership and F3 stale startup timers received watched regression
failures. Root review also found and repaired failure accounting before response teardown and
unmount during a pre-connection startup. Treat those fixes as fresh code to challenge, not as
proof. Browser reloads during development invalidate individual runs and are labelled as such.
