## Findings

- **CR-1 — P1 — [Reader.tsx:422](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/src/web/reader/Reader.tsx:422):** `?mode=explanations` bypassed the experimental switch, mounted the owner band, and fetched `/api/explanations`. Visitors also saw the owner-only boundary. I added a fail-closed effective mode and remove the inert URL parameter after confirming the switch is off.

- **CR-2 — P2 — [FeaturesPage.tsx:76](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/src/web/FeaturesPage.tsx:76), [HelpPage.tsx:122](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/src/web/help/HelpPage.tsx:122), [help-mode-when.tsx:57](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/src/web/help/help-mode-when.tsx:57):** Features and Help exposed Explanations unconditionally. I gated the feature tile, Help contents, search, direct page, sidebar, previous/next links, related links, and mode table.

- **CR-3 — P2 — [ExplanationsPanel.tsx:109](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/src/web/ExplanationsPanel.tsx:109):** `outdated` incorrectly offered “Write it again.” I removed that condition; only profile changes and the existing stale/job states offer rewriting. The feature and plan docs now record Greg’s 2026-09-29 ruling.

- **CR-4 — P2 — [Reader.tsx:1262](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/src/web/reader/Reader.tsx:1262), [chat-handoff.ts:430](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/src/web/chat-handoff.ts:430):** a stale explanation whose block disappeared still sent that missing block ID, which the server rejects. Ask in chat now uses `findQuote` and its `start`, falls back to the whole existing block, and starts an unanchored chat if the block itself has gone. Hostile explanation text remains fenced as data.

- **CR-5 — P2 — [public-network-trace.test.tsx:3467](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/tests/public-network-trace.test.tsx:3467):** the existing positive test could remain green if arrival, rather than the press, started the paid job. I added explicit enabled-arrival GET/no-POST coverage, plus switch-off URL and margin-feed network tests.

- **CR-6 — P3 — [shared-inventory.test.ts:214](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/tests/shared-inventory.test.ts:214), [last-view.test.ts:231](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/tests/last-view.test.ts:231), [type-roles.test.ts:155](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/tests/type-roles.test.ts:155):** three manual mode enumerations omitted Explanations. I added its owner-only sharing policy, remembered URL, and quote/body/meta typography roles.

- **CR-7 — P2, not changed — [experimental-features.md:50](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/docs/project/experimental-features.md:50):** the operating manual still says every experimental URL remains reachable. Explanations is now the required exception. This is a rule doc with unrelated in-progress edits, so its exact wording needs a separately approved before/after edit.

- **CR-8 — P3, not changed — [help-chat-call.ts:38](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/src/help-chat-call.ts:38):** Help’s AI question feature still receives the complete generated corpus, including Explanations, regardless of the switch. Fixing this would alter the server contract and prompt-cache design, so I left it as a wider decision. The ordinary Help UI is gated.

The marginalia suppression, quote recheck, stale filtering, outdated/profileChanged visibility, placement, and ordering were correct. No AI cost figures reach reader-facing code.

## Files edited

- Docs: `docs/plans/261028c-explanations-of-confusing-passages-and-sources-feeding-the-margin.md`, `docs/project/explanations.md`
- Source: `src/web/ExplanationsPanel.tsx`, `FeaturesPage.tsx`, `chat-handoff.ts`, `help/HelpPage.tsx`, `help/help-mode-when.tsx`, `reader/Reader.tsx`, `useExplanations.ts`
- Tests: `chat-handoff.test.ts`, `explanations-panel.test.tsx`, `features-page-modes.test.tsx`, `help-page.test.tsx`, `last-view.test.ts`, `public-network-trace.test.tsx`, `shared-inventory.test.ts`, `type-roles.test.ts`

Pre-existing unrelated working-tree changes were left untouched.

## Checks

- Focused touched tests: all passed.
- Public network trace: 102 passed.
- Marginalia, cost-copy, Dock gating, mode surface/spend, and voice tests: 253 passed.
- Help and doc links: 93 passed.
- `node --import tsx scripts/typecheck.ts`: passed all projects, 4,064 files covered.
- Scoped lint: no errors; only existing complexity notices and two advisory Reader warnings.
- `git diff --check`: passed.
- `npm test`: could not start because the local database/Docker endpoint was unavailable (`EPERM`); no suites were skipped or falsely reported green.

**Verdict: stage 2 is ready with the fixes above; CR-7 and CR-8 remain explicit wider decisions.**