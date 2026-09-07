Stage 1 is structurally sound, with no P0 or P1 findings. I found four P2s and one P3.

## Findings

- **F1 — P2 — The source-of-truth move left active prose pointing at `MODES_UI`.**  
  [Dock.tsx:116](/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/src/web/Dock.tsx:116) still says experimental status is a question answered by a `MODES_UI` row. Its Diagram, Debate, and Remember comments still refer to “the blurb” as though it were in this list ([659](/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/src/web/Dock.tsx:659), [687](/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/src/web/Dock.tsx:687), [702](/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/src/web/Dock.tsx:702)), contradicting the new claim that the description reasoning moved to the catalog. The same stale ownership appears in [dock-experimental-modes.test.tsx:27](/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/tests/dock-experimental-modes.test.tsx:27), [diagram-kind-gating.test.tsx:13](/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/tests/diagram-kind-gating.test.tsx:13), [diagram.md:146](/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/docs/project/diagram.md:146), and [DiagramPanel.tsx:223](/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/src/web/DiagramPanel.tsx:223). Retarget experimental references to `MODE_CATALOG`; move or retarget the description-specific paragraphs while preserving the ordering rationales verbatim.

- **F2 — P2 — Alias uniqueness is checked before the matcher’s whitespace normalization.**  
  [mode-catalog.test.ts:55](/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/tests/mode-catalog.test.ts:55) compares raw strings, while [line 90](/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/tests/mode-catalog.test.ts:90) checks lowercase and outer trimming but not collapsed internal whitespace. I reproduced the hole: `"peer review"` and `"peer  review"` pass every present invariant yet normalize to the same Stage 2 query. Compare normalized claims and labels, and assert each stored alias already equals the canonical lowercase/trimmed/collapsed form.

- **F3 — P2 — `quiz` promises a sub-mode that the command bar cannot select.**  
  [mode-catalog.ts:244](/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/src/mode-catalog.ts:244) assigns `quiz` to Remember. Stage 2 is specified to behave exactly like pressing the mode button; that path only calls `onMode(m.mode)` ([Dock.tsx:1708](/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/src/web/Dock.tsx:1708)), while Remember defaults to Recall ([params.ts:1127](/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/src/web/params.ts:1127)). From a clean URL, typing “quiz” therefore opens Recall. Remove `quiz` until command targets can encode `{ mode: "remember", remember: "quiz" }`.

- **F4 — P2 — `claims` has a semantic collision with Referee’s exact “Claims” control.**  
  [mode-catalog.ts:235](/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/src/mode-catalog.ts:235) sends “claims” to Ideas, but Referee has a built sub-mode literally labelled “Claims” ([App.tsx:6086](/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/src/web/App.tsx:6086)). The textual uniqueness test cannot see this, and a reader familiar with that control can be sent to the wrong mode. Remove or replace the Ideas alias—`premises` is less overloaded—or defer it until sub-mode commands can be represented.

- **F5 — P3 — Stage 1 prose describes the Stage 2 command bar as already present.**  
  [mode-catalog.ts:75](/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/src/mode-catalog.ts:75) says it “draws” descriptions, [new-mode.md:36](/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/docs/project/new-mode.md:36) says it “matches” aliases, and [web-client.md:37](/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/docs/project/web-client.md:37) says the second reader “arrived.” Use future tense until Stage 2 lands. That last line should also say “the two pre-existing fields,” not “the first two fields.”

## Checked and cleared

- Mechanically compared against `3ac53baa`: all 14 descriptions and all 14 experimental booleans moved with zero differences.
- `Record<Mode, ModeCatalogEntry>` preserves totality. No optional field, `Partial`, index signature, or default weakens the decision.
- `icon`, `keepLabel`, ordering, `POLICY`, and `MODE_TARGET` remain where intended.
- The import direction is safe. The catalog imports only `modes.ts`; adding it to `SHARED` does not weaken checks on other modules. Both load-bearing import-boundary assertions passed.
- The catalog test is worthwhile: its runtime value invariants are not typechecker duplicates. Refusing to compare against `MODES_UI` and refusing to duplicate experimental membership are both correct.
- `review`/`reviewer` belong to Referee under the repository’s settled naming rationale. `tree` is defensible for Outline because Outline is the nested-list rendering, despite sharing the underlying tree with Hierarchy. `description` is a reasonable improvement over the more context-specific `blurb`.

Typecheck passed. The focused run produced 169 passing tests; the remaining test was blocked only by this sandbox making its temporary `node_modules/.import-scan-fixture.ts` location read-only. Your unrestricted 170/170 result covers it. No files were changed.