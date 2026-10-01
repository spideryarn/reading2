Findings:

- P2 — [sub-modes.ts:216](/home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/src/web/sub-modes.ts:216): metadata links explicitly wrote parser defaults (`remember=recall`, `diagram=sketch`, `referee=criteria`) while nuqs removed them. Fixed by representing defaults as `null` on both navigation paths.
- P2 — [command-bar-sub-modes.test.tsx:345](/home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/tests/command-bar-sub-modes.test.tsx:345): tests stopped at a mocked `onMode`, so they did not prove nuqs produced one history entry. Added a Dock → CommandBar → Reader-shaped nuqs harness proving one `pushState`, atomic thread clearing, and one-Back restoration.
- No P0/P1 findings. No wider changes needing a decision.

Verification:

- Targeted five-file Vitest run: 121 passed.
- Typecheck: all four projects passed; all 2,511 source files covered.
- Biome: clean.
- Diagram mutation correctly caused both relevant tests to fail; mutation restored.
- `npm test` could not start the database lanes because sandbox networking returned `EPERM` for local Postgres. The requested unit files remain green.

Verdict: ship after these fixes; activation, spending, command-kind exhaustiveness, labels, gating, and Reader side effects look correct.