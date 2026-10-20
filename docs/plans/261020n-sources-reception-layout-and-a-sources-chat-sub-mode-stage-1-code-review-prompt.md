# Code review: plan 261020n, Stage 1

You are reviewing the uncommitted working-tree diff in this worktree: `git diff HEAD`, 14 files. It
builds **Stage 1** of `docs/plans/261020n-sources-reception-layout-and-a-sources-chat-sub-mode.md`,
the default-collapsed Reception. Read that plan first, including § GPT Sol's plan review: F1 to F4
and F8 apply to this stage. Then read `CLAUDE.md`, the header of `src/web/ReceptionAndClaimsPanel.tsx`
and `docs/postmortems/261003h-*`.

What changed, in brief:
- Reception's thread filter became sections: an AI-labelled frame holding Key sources and the
  themes, then Every page (open by default), then Cited by.
- Rows are two lines until opened.
- `receptionSelection` and `sourcesCounts` in `src/web/sources-counts.ts` changed.
- `?receptionthread=` now opens a section and scrolls to it rather than filtering.
- The tests are updated, with new ones added.

**Fix what you find inside this stage**, then run `npm run typecheck` and the touched test files.
Don't run the full suite: the box is shared. Use
`npx vitest run tests/reception-and-claims-panel.test.tsx tests/reception-threads.test.ts tests/reception-navigation.test.tsx tests/registry-client.test.tsx tests/public-network-trace.test.tsx tests/voices-css.test.ts tests/every-mode-draws-its-surface.test.tsx tests/url-state.test.ts`,
and check docs/project/testing.md if the runner needs flags. Do not commit, and do not run any git
command that discards work. Report anything wider than this stage instead of building it.

Look especially for:
1. **A row hidden by a default.** Is every stored Reception row, title-only ones included, in the DOM
   and visible before any press, on the owner's path and the visitor's? (Postmortem 261003h.)
2. **Counts that can disagree.** Can the chip, a section's summary count, the rows under it and the
   (i) sentence ever disagree? Are themes made only of Claims rows kept out of Reception (F4)? Has
   the Claims count or the Claims filter changed by accident?
3. **`?receptionthread=` handling.** Arrival, a later change, a search that arrives late, a stale id.
   Does it ever scroll the page or the window instead of the list's own scroller? Does it loop, or
   drag the list back on a re-render?
4. **The AI fence and voices.** Is every model-written string still labelled as the AI's, in the
   model's face (`docs/project/fonts.md`)? Are strangers' strings still rendered as text? Do links
   keep `noreferrer noopener`?
5. **Accessibility.** The disclosure's name and `aria-expanded`/`aria-controls`, a link inside a
   `<summary>`, and keyboard use.
6. **Claims rows.** Claims' older-search rows and claim-check findings use the same `Row`. Are they
   still right, with *bears* as their AI word?
7. **Tests that cannot fail.** Tests that pass without testing what they say, and stale comments.
8. **Simplicity.** Anything built more complicated than the plan needs.

Write your findings to
`docs/plans/261020n-sources-reception-layout-and-a-sources-chat-sub-mode-stage-1-code-review-sol.md`
**before** you start fixing. Number them F1, F2 and so on, give each a severity and file:line
evidence, and say per finding whether you fixed it. End with the test and typecheck results you saw.
