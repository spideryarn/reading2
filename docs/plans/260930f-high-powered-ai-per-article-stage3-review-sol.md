## Findings

- **S3-F1 — P1 — fixed.** The UI claimed all article AI moved to Opus and “each call” cost twice as much, but only capable-tier/Sonnet calls move; quick jobs, live voice, and Illustrated image generation do not. Corrected the UI, reference doc, and signposts. Evidence: [HighPowerSwitch.tsx:117](/home/greg/code/spideryarn2/.claude/worktrees/fb6c-high-powered-ai/src/web/HighPowerSwitch.tsx:117), [high-powered-ai.md:25](/home/greg/code/spideryarn2/.claude/worktrees/fb6c-high-powered-ai/docs/project/high-powered-ai.md:25). Files touched: component, high-powered AI doc, three signposts, plan, approval note.

- **S3-F2 — P1 — fixed.** A lost response after a committed PUT was reported as “Not saved” while displaying stale state. Transport/invalid-response failures now trigger an ordered metadata reread; explicit HTTP refusals still say “Not saved.” Evidence: [HighPowerSwitch.tsx:85](/home/greg/code/spideryarn2/.claude/worktrees/fb6c-high-powered-ai/src/web/HighPowerSwitch.tsx:85), [metadata-high-power-switch.test.tsx:345](/home/greg/code/spideryarn2/.claude/worktrees/fb6c-high-powered-ai/tests/metadata-high-power-switch.test.tsx:345). Files touched: component, test, plan.

- **S3-F3 — P2 — fixed.** The polite live region was empty while saving and after switching off. It now announces `Saving…`, `On since…`, or `Off.`; the native label, disabled double-click behavior, and live status are tested. Evidence: [HighPowerSwitch.tsx:104](/home/greg/code/spideryarn2/.claude/worktrees/fb6c-high-powered-ai/src/web/HighPowerSwitch.tsx:104), [metadata-high-power-switch.test.tsx:248](/home/greg/code/spideryarn2/.claude/worktrees/fb6c-high-powered-ai/tests/metadata-high-power-switch.test.tsx:248). Files touched: component, test, plan.

- **S3-F4 — P2 — fixed in documentation; not built.** Deferred billing conflated a new high-power import with upgrading an already-charged article. The corrected arithmetic is private `2 + 2 = 4` half-units, public `1 + 1 = 2`; one remaining private slot is enough for an existing article’s incremental upgrade, but not a new private high-power import. The plan now also requires atomic admission, charge, and switch under billing’s lock order, and notes that the admin route cannot become reader-facing through a client entitlement check alone. Evidence: [plan:344](/home/greg/code/spideryarn2/.claude/worktrees/fb6c-high-powered-ai/docs/plans/260930f-high-powered-ai-per-article.md:344), [plan:364](/home/greg/code/spideryarn2/.claude/worktrees/fb6c-high-powered-ai/docs/plans/260930f-high-powered-ai-per-article.md:364), [plan:379](/home/greg/code/spideryarn2/.claude/worktrees/fb6c-high-powered-ai/docs/plans/260930f-high-powered-ai-per-article.md:379). Files touched: plan and approval note.

Verification passed:

- `node --import tsx scripts/typecheck.ts`
- `npx vitest run tests/metadata-high-power-switch.test.tsx tests/doc-links.test.ts` — 22 tests
- Biome lint on the component and test
- `git diff --check`

No commit made. The pre-existing untracked Stage 3 review prompt was left untouched.

VERDICT: ship