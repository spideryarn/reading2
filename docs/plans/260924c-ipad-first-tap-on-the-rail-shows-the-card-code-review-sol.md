F1 — P1 — A no-record click could still jump if the card was open. [Spine.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/web/Spine.tsx:451) now requires the click’s own press record; only pen retains its deliberate exception. The corrected pure contract is at [spine-tap.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/spine-tap.test.ts:113), and the cancelled-second-tap integration test is at [spine-hover.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/spine-hover.test.tsx:591). Both tests failed before the fix.

F4 — P1 — FIFO consumption could lend mouse/pen behaviour to a finger, or let an interleaved pointer steal another pointer’s click. This affected:

- An unclicked pen or mouse followed by an iPad tap.
- A delayed touch click arriving while a mouse was down.
- A real mouse click while a newer finger remained held down.

The queue now matches reliable touch/pen clicks by type and ID, and resolves WebKit’s mislabelled `mouse` click from the most recently released touch or mouse; grouped touches remain FIFO. See [Spine.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/web/Spine.tsx:383) and the rail handlers at [Spine.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/web/Spine.tsx:938). Red-first coverage is at [spine-hover.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/spine-hover.test.tsx:471), [spine-hover.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/spine-hover.test.tsx:489), and [spine-hover.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/spine-hover.test.tsx:506).

Real-mouse first-click behaviour is explicitly covered after ordinary pointerdown, hover-open, keyboard focus, a missing finger click, and both hybrid interleavings. Floating UI’s composed handlers run in these real-component tests. The glossary-inside-link test passes without changing `useHoverCard`; it closes F3’s evidence gap rather than detecting this stage’s old code.

Validation:

- Requested Vitest command: 97/97 passed.
- Biome lint and `git diff --check`: clean.
- Literal `npm run typecheck`: exit 1 because the sandbox denied `tsx`’s Unix socket with `EPERM`.
- The same typecheck script via `node --import tsx scripts/typecheck.ts`: exit 0; all four projects passed.

Verdict: Approve after fixes; no remaining P0/P1 findings.

Files edited: [Spine.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/src/web/Spine.tsx), [spine-hover.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/spine-hover.test.tsx), [spine-tap.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/tests/spine-tap.test.ts), [260924c plan](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/plans/260924c-ipad-first-tap-on-the-rail-shows-the-card.md).