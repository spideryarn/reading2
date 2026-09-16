The build is broadly right. I found three P1s and one P2; all four are fixed. Full findings are in [the review output](/home/greg/code/spideryarn2/.claude/worktrees/fb3k3m-citations-marks-and-find-it/docs/plans/260916b-citations-marked-in-the-prose-and-a-clearer-find-it-button-code-review-sol.md).

1. **P1** — An older citations GET could erase a successful *Find it* patch. [useCitations.ts:249](/home/greg/code/spideryarn2/.claude/worktrees/fb3k3m-citations-marks-and-find-it/src/web/useCitations.ts:249). Fixed with `armRefresh()` and a regression test.

2. **P1** — A citation inside an internal article link swallowed every subsequent touch tap. [ProseHoverCard.tsx:451](/home/greg/code/spideryarn2/.claude/worktrees/fb3k3m-citations-marks-and-find-it/src/web/ProseHoverCard.tsx:451). Fixed: the second tap now jumps, after note/glossary precedence.

3. **P1** — The tooltip said the Scholar fallback remained “either way,” contradicting successful replacement. [CitationsPanel.tsx:613](/home/greg/code/spideryarn2/.claude/worktrees/fb3k3m-citations-marks-and-find-it/src/web/CitationsPanel.tsx:613). Fixed in code, test, and documentation.

4. **P2** — Bibliography-only works said “cited in 0 paragraphs.” [ProseHoverCard.tsx:1695](/home/greg/code/spideryarn2/.claude/worktrees/fb3k3m-citations-marks-and-find-it/src/web/ProseHoverCard.tsx:1695). Fixed to say “only in the references.”

I rechecked all six earlier findings:

- Unique rendered occurrence, no `start`: correct. Identical repeats are safely omitted by design.
- No whole-block fallback: correct.
- Citation touch/block-selection pairing: correct after the internal-link fix.
- Sanitizer attribute, reserved class, and version 7: complete; no migration or extra cache change is needed.
- Hook split and F14 guard: structurally correct; the complementary stale-GET race is now fixed.
- *Find it* copy: no call count, fixed price, or “own page” claim; conditional fallback wording is now accurate.

The unconditional GET remains owner-only. The exact public network trace passed. `sourceOf` creates no cycle and the client production build passes. Required `works` props and the `NO_WORKS` memoization are correct.

Verification:

- 10 files / 222 scoped tests passed.
- Direct full typecheck passed, covering 2,191 TypeScript files.
- Production client build passed.
- Full `npm test` could not start because the sandbox was denied access to local Postgres.
- Repository-wide lint remains red on its existing baseline; the new hook/test edits lint cleanly.
- No visual verdict—the `/design` overlap specimens still need browser inspection.