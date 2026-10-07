**land after fixes (made)**

1. **P2 — [RefereeMode.tsx:324](/home/greg/code/spideryarn2/.claude/worktrees/fb-referee-panel-rules/src/web/modes/referee/RefereeMode.tsx:324): closing could be undone by pending hover.** Mouse entry schedules opening; two quick clicks open then close; the pending timer reopens it. The new regression test failed before the fix and passes now. **Fixed locally** with a dismissal guard. This fault is shared with [BandAbout.tsx:67](/home/greg/code/spideryarn2/.claude/worktrees/fb-referee-panel-rules/src/web/BandAbout.tsx:67), which remains unchanged because it is outside scope.

2. **P2 — [mode-catalog.ts:275](/home/greg/code/spideryarn2/.claude/worktrees/fb-referee-panel-rules/src/mode-catalog.ts:275): the sentence overstated activation.** Claims retires its activation without running when results already exist. Also, persistent `?referee=` means the opening panel need not wait for a criterion. **Fixed:** “This button starts no model call; inside, only the Claims chip can start one.” Corrected the activation explanation too.

3. **P3 — [referee-notices.test.tsx:388](/home/greg/code/spideryarn2/.claude/worktrees/fb-referee-panel-rules/tests/referee-notices.test.tsx:388): Mirror duplication escaped testing.** Restoring its sentence to `MirrorView` left the original tests green because the frame harness rendered a placeholder panel. **Fixed:** added a real Mirror render; the same mutation now fails. Added event-path tests and exact paragraph-count assertions.

4. **P3 — [referee-mode.md:725](/home/greg/code/spideryarn2/.claude/worktrees/fb-referee-panel-rules/docs/project/referee-mode.md:725), [referee-mode.md:835](/home/greg/code/spideryarn2/.claude/worktrees/fb-referee-panel-rules/docs/project/referee-mode.md:835), [referee-criteria-panel.test.tsx:529](/home/greg/code/spideryarn2/.claude/worktrees/fb-referee-panel-rules/tests/referee-criteria-panel.test.tsx:529): stale descriptions.** These still described Candidates starting on its chip or explanations remaining above the list. The current handlers and render paths contradict them. **Fixed.**

5. **P3 — [referee-claims.ts:315](/home/greg/code/spideryarn2/.claude/worktrees/fb-referee-panel-rules/src/referee-claims.ts:315): wider stale comment.** It says the sentence is always printed above the list and never folded away. The sentence now renders in `HowToRead`. **Reported, left unchanged outside scope.**

Event tracing and tests cover touch focus followed by tapping, hover followed by clicking, keyboard focus followed by Enter’s click, outside taps, Escape, and keyboard refocus. Touch focus does not pre-open through the browser’s `:focus-visible` branch. Keyboard focus opens the card; Enter closes it as a toggle.

All four sentences remain word for word. The button inside `<p>` is valid phrasing content, and the open tooltip supplies `aria-describedby` containing the sentences. CSS inspection found no 390px overflow mechanism or dead rule in the new styles.

Mutations tried:

| Mutation | Result |
|---|---|
| Remove rank sentence from the record | Caught |
| Remove `onClick` | Caught |
| Make `HowToRead` uncontrolled | Caught |
| Drop `key={view}` | Caught |
| Restore Claims sentence to panel | Caught |
| Restore Mirror sentence to panel | Missed originally; caught after added test |

**Validation:** all six requested files passed, **124 tests**. Typechecking passed across all four projects using `node --import tsx scripts/typecheck.ts`; `npm run typecheck` itself was blocked by the sandbox denying `tsx`’s IPC socket. Scoped lint and diff whitespace checks passed.

I did not perform browser, physical-touch or screen-reader testing, review concurrently added screenshots, or run the full repository suite. No commit, push or deploy was performed.