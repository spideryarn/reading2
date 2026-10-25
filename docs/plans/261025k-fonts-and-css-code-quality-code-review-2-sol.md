Found and fixed one issue; no commit was made.

- **D1 — P1 — fixed:** The new prose-measure guard only scanned reading-view sheets, omitting `styles/tokens.css`. Consequently, [`.reading-column`](/var/tmp/spideryarn-worktrees/fonts-code-quality/styles/tokens.css:352) still measured `ch` in `--font-ui`, and the test passed.
  - Red: expanding [the guard](/var/tmp/spideryarn-worktrees/fonts-code-quality/tests/prose-centred-in-its-cell.test.ts:94) to the complete stylesheet graph produced `styles/tokens.css: .reading-column`.
  - Green: `.reading-column` now uses `--font-author`; focused test passes 10/10.
  - The guard now checks all sheets, catches `min()`/`clamp()`/`calc()` uses, calibrates against both root and prose sheets, and no longer mistakes `.prose-card` for `.prose`.
  - Root cause recorded in the existing [postmortem](/var/tmp/spideryarn-worktrees/fonts-code-quality/docs/postmortems/261025b-matter-stub-measured-in-the-wrong-face.md:37).

Review conclusions:

- No Item 2 cascade regression found. App/base conflicts are still beaten by voices, utilities still beat voices, there are no relevant `!important` or ID-selector conflicts, and the `.passage-whole` rules override inherited faces directly.
- The jsdom shim is non-vacuous: the chat-heading witness needs the simulated layer to pass. It omits generated utilities, but current witnesses/voice targets have no same-element font utility, and utility precedence is intentionally unchanged.
- No live use of the removed font aliases remains. Historical documentation mentions and a third-party RFC fixture remain appropriately. Tailwind’s `--font-sans: var(--font-ui)` mapping is intentional.

Checks:

- Requested Vitest run: 253/254 passed. The remaining test could not execute because the sandbox denies its `spawnSync git` call with `EPERM`; manually checking its invariant found only the two permitted `./tailwind.css` imports.
- `npm run typecheck`: blocked by sandbox denial of tsx’s IPC socket. Equivalent `node --import tsx scripts/typecheck.ts` passed all 4,020 files.
- Biome on changed code/CSS: passed.
- `git diff --check`: passed.
- No wider findings to report.