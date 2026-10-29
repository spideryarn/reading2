Found and fixed three defects. No commit or git-state mutation was made.

### Findings

- High — comment/chat taps lost on overlapping marks: [ProseHoverCard.tsx](/var/tmp/spideryarn-worktrees/fbnjkskc-explanations-underline/src/web/ProseHoverCard.tsx:804)

  A mark such as `cmt term explained` or `chat term explained` was still captured by the older term/citation touch handlers. They swallowed the event before the reader’s comment/chat action ran. All term, citation, and explanation touch selectors now exclude `.cmt` and `.chat`. Triple-overlap regressions were added in [explained-prose.test.tsx](/var/tmp/spideryarn-worktrees/fbnjkskc-explanations-underline/tests/explained-prose.test.tsx:324).

  I also restored the pointer cursor for general chat marks in [dialogs.css](/var/tmp/spideryarn-worktrees/fbnjkskc-explanations-underline/src/web/styles/dialogs.css:794); otherwise the zero-specificity explanation rule could show a help cursor over a clickable chat mark.

- Medium — duplicate explanation GETs and competing snapshots: [MarginaliaColumn.tsx](/var/tmp/spideryarn-worktrees/fbnjkskc-explanations-underline/src/web/marginalia/MarginaliaColumn.tsx:1408)

  The feed refreshed when the band opened while the band made its own request. React StrictMode could also turn the feed’s “skip initial effect” ref into an extra initial GET. Besides wasted requests, independently completing reads could overwrite one another with different snapshots.

  The feed now refreshes after generation only while the band is closed. When open, the band’s existing read publishes its successful result to the feed through [ExplanationsMode.tsx](/var/tmp/spideryarn-worktrees/fbnjkskc-explanations-underline/src/web/modes/explanations/ExplanationsMode.tsx:36) and [Reader.tsx](/var/tmp/spideryarn-worktrees/fbnjkskc-explanations-underline/src/web/reader/Reader.tsx:4437). Failed band reads retain the last good marginalia snapshot. Tests cover StrictMode and closed-to-open request counts.

- Low — one-paint switch-off leak: [Reader.tsx](/var/tmp/spideryarn-worktrees/fbnjkskc-explanations-underline/src/web/reader/Reader.tsx:2459)

  Turning the experimental switch off could render once with the previous private explanation state because effect cleanup happens after render. Rendering is now gated synchronously by owner status and the current switch value before data reaches marginalia, prose annotation, or hover cards.

I updated the plan’s review record and the explanations documentation to describe the final refresh ownership.

### Wider review

No defect found in the `:where()` cascade or light theme:

- quote and search-highlight fills retain their intended backgrounds;
- term/comment/chat borders correctly outrank the zero-specificity explanation border;
- citation and xref decorations remain visible;
- the light theme defines its explanation token;
- TableView’s memo/cache inputs include the explanation map;
- visitors cannot mount the owner feed or receive explanation annotation data;
- xref, link second-tap, citation, quote, keyboard-focus, and ordinary term precedence remain intact.

One wider edge remains unchanged: entering the page initially with `?mode=explanations` mounts both the feed and band, so those separate hook owners can still issue two opening GETs. Ordinary band opening and generation completion no longer double-read. Eliminating the direct-entry duplicate cleanly would require a shared read controller or shared request cache.

### Verification

- Focused Vitest command: **6 files passed, 228 tests passed**.
- `git diff --check`: passed.
- `npm run typecheck`: the wrapper could not start its `tsx` IPC socket under the sandbox (`EPERM`). Running the same script through `node --import tsx` passed every configured TypeScript project, including web and tests. The wrapper still reported three unrelated pre-existing root files—`.check-tmp.ts`, `.check2-tmp.ts`, and `.seed-tmp.ts`—because they are outside any configured project.