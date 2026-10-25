Found and fixed three issues:

- [CommandBar.tsx:1531](/var/tmp/spideryarn-worktrees/extension-findable/src/web/CommandBar.tsx:1531): the coarse-pointer command-bar gate had no effective test; injecting an already-gated URL could not catch its removal. Exported the actual gate with a test URL seam and added fine/coarse plus null/non-null coverage in [extension-findable.test.tsx:122](/var/tmp/spideryarn-worktrees/extension-findable/tests/extension-findable.test.tsx:122).
- [CommandBar.tsx:1519](/var/tmp/spideryarn-worktrees/extension-findable/src/web/CommandBar.tsx:1519): “How, in Help.” was stilted. Changed it to “Opens instructions in Help.” and regenerated the command catalogue.
- [add-page-upload-instead.test.tsx:93](/var/tmp/spideryarn-worktrees/extension-findable/tests/add-page-upload-instead.test.tsx:93): corrected the stale claim that null is today’s production state.

No other correctness findings:

- `SUGGESTS_EXTENSION` contains exactly the failures the extension can bypass.
- Add-page offer is correctly gated by failure, store URL, and fine pointer.
- Command row is typed-only, an action, correctly ordered, and opens Adding an article.
- Help renders the stable sentence in both states, with either the store link or “not yet.”
- Existing `media`, `helpHref`, and block-token machinery are reused.

Verification:

- Required suites with the real ID: 153 passed, 3 skipped.
- Flipped ID to `null`: 153 passed, 3 skipped; generated files remained valid.
- Restored `eeedpogihlbbjghpanopajebiencekak` exactly.
- Typecheck: all five projects passed; all 4,008 source files covered. `npm run typecheck`’s `tsx` wrapper was blocked by sandbox IPC permissions, so the identical script was run directly with Node.
- Lint: no errors; three pre-existing complexity notices.
- Full `npm test` could not start because the local Postgres/Docker service was unavailable. The scoped suites passed independently.

Nothing wider needs a product decision.

**SHIP WITH FIXES (made)**