# Narrow check (may fix): R2-2 and R2-3, 261012d

Repo root: the current directory. Discovery is closed; this is not a new review round. Your narrow check of the round-2 fixes (docs/plans/261012d-round-2-fix-check-sol.md) left two P1s open. The fix is the latest commit (`git show HEAD`); the design is in its message.

- R2-2: after an uncertain pre-`begin` failure (empty stream, network loss) in an already-open conversation, is the composer usable again, with the submitted chips gone and the text not restored? Is this true on every surface that sends a mentioned question (Chat list, open conversation, ChatDialog, block chat card)? Can `mentionWaiting` still latch on any other path?
- R2-3: does every composer text mutation (typing, dictation, pick, chip ×, Escape, clear on send, restore on refusal, draft restore) go through the one anchor-updating `setText`? Do the persisted mentions round-trip safely across a remount, and is a stale anchor dropped rather than sent?

If a finding is real and the fix stays inside these files, fix it, with a test seen red first. You may run tests/chat-mention*.test.ts(x), tests/chat-mentions-client.test.tsx, tests/chat-draft*.test.tsx, other tests/chat*.test.tsx and `npm run typecheck`. Do not commit. Do not run the full suite.

For each: HOLDS, FIXED (what you changed) or STILL OPEN with severity, file:line and the concrete fix. End with one line: FIXES HOLD or STILL OPEN.
