# Code review: Sources › Links (261011d)

You are reviewing an uncommitted change in this working tree (the Spideryarn repo). The house
workflow: **fix what you find inside this change** (edit the files directly), and report anything
wider for me to decide. Do not commit, do not run git commands that change state, do not touch
`src/chat-tools.ts` or `src/link-previews.ts` (a security defence, deliberately untouched), and do
not touch the database or `.env.local`.

Read: the plan `docs/plans/261011d-sources-links-sub-mode-the-articles-own-hyperlinks.md` (including
§ Plan review, your earlier review's findings and what was done with each), then the diff
`docs/plans/261011d-sources-links-sub-mode-code-review.diff` (`git diff HEAD`; new files included).

Check especially:
1. `src/web/outbound-links.ts`: correctness of the parse and grouping, the `workAt` join (address,
   then DOI/arXiv identity), anything that could throw on hostile markup or a malformed href and
   take the band down, and parity with `articleLinks` in `src/chat-tools.ts`.
2. `src/web/LinksPanel.tsx` and `SourcesMode.tsx`: keys (duplicate React keys?), accessibility,
   the empty states, the visitor band, memoisation (`useMemo` on `article.blocks` — is the array
   identity stable across renders in Reader.tsx, or will this re-parse every render?).
3. Every place a new Sources sub-mode must be told about: did anything get missed (command bar,
   last-view, router lifts, `item-focus.ts`, `thread-source.ts`, `Dock.tsx`, `auto-modes.ts`,
   `ModeBoundary.tsx`, `Reader.tsx` `subModeViews`, tests that enumerate sub-modes)?
4. Does anything now fetch, or widen what our server fetches? It must not.
5. Docs accuracy: `docs/project/sources.md` § Links and § Visitors, the help page
   `src/web/help/pages/modes/sources.md`, `src/mode-catalog.ts` `how`.

After fixing, run `npm run typecheck` and `npx vitest run tests/outbound-links.test.ts
tests/links-panel.test.tsx tests/public-network-trace.test.tsx tests/command-bar-sub-modes.test.tsx
tests/url-state.test.ts tests/last-view.test.ts tests/every-mode-draws-its-surface.test.tsx
tests/a-broken-mode-leaves-the-article-readable.test.tsx` and report the results.

Output: a numbered list of findings with severity (P1/P2/P3), evidence (file:line), and what you
changed (or why you left it). End with one line: VERDICT: "ship", "ship after my fixes", or "do
not ship".
