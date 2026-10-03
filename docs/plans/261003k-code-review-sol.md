- **F8 · P1 — fixed:** A pending pick could navigate after the bar unmounted. Added abort and revision invalidation. [CommandBar.tsx:1314](/home/greg/code/spideryarn2/.claude/worktrees/fbt0dg9u-command-bar-natural-language/src/web/CommandBar.tsx:1314)
- **F9 · P1 — fixed:** Removing a suggestion could shift Enter onto another command or glossary term. Changed choices now invalidate the suggestion. [CommandBar.tsx:1442](/home/greg/code/spideryarn2/.claude/worktrees/fbt0dg9u-command-bar-natural-language/src/web/CommandBar.tsx:1442)
- **F10 · P2 — fixed:** The disconnect test passed with signal forwarding removed. Its stub now observes the actual forwarded signal. [command-pick.test.ts:428](/home/greg/code/spideryarn2/.claude/worktrees/fbt0dg9u-command-bar-natural-language/tests/command-pick.test.ts:428)
- **F11 · P2 — reported:** The inherited chat gateway discards usage on non-2xx responses; a priced extraction error would lose its charge record. Left unchanged as wider scope. [ai-call.ts:1986](/home/greg/code/spideryarn2/.claude/worktrees/fbt0dg9u-command-bar-natural-language/src/ai-call.ts:1986)

837 offline tests pass, including all four requested files. Typechecking and scoped lint pass. Three mutations checked; all restored. No build, network, or Postgres checks.

Plan ledger updated. Fixes are uncommitted.

**Verdict: land after these fixes.**