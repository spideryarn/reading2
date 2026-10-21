One finding, fixed. No wider findings.

- **D1 — P2 — [tests/chat-send-is-the-primary-control.test.tsx:158](/var/tmp/spideryarn-worktrees/fby4yhnp-iphone-minimum-sizes/tests/chat-send-is-the-primary-control.test.tsx:158) — fixed.** Adding the coarse-pointer selector to the allowlist weakened the state guard because nothing enforced the “size only” comment. A mutation adding `background: red` still passed. The test now requires the rule to remain inside `any-pointer: coarse`, contain only `width` and `height`, and retain both 40px floors. [tap-target.test.tsx:201](/var/tmp/spideryarn-worktrees/fby4yhnp-iphone-minimum-sizes/tests/tap-target.test.tsx:201) now also pins Send, microphone, Live, and its arrow.

Review conclusions:

- The composer sizing rule wins. Later `.prof-mic` is less specific; Learn changes only ordering; Quiz changes only paint; no later sheet overrides these dimensions.
- Learn’s wrapping layout accommodates the extra 4px. Quiz is unaffected because its `.chat-send` buttons are outside `.chat-composer`.
- `.rcp-view-count { font-size: max(var(--text-min), 0.9em) }` is correct: desktop remains unchanged while coarse pointers enforce the floor.
- The Latest-pill edit did not weaken protection. Every matching rule is still checked for positioning/offsets; only the shared flex assertions exclude device-specific at-rules.
- The 261021b merge added no font-size, `tw:text-[…]`, new small control, or new interactive markup requiring coverage.

Validation:

- Requested suites: **4 files, 34 tests passed**
- Direct TypeScript checks: all four projects passed
- Touched-file Biome check and `git diff --check`: passed
- Full `npm test`: blocked before collection because local Postgres is unavailable
- Changes remain uncommitted because this environment exposes the worktree’s Git metadata read-only.