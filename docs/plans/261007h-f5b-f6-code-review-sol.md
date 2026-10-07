# Review of 6f357c3e5 — findings before fixes

- **D1 · P1 · Skip activation during the entrance delay does nothing.**
  `SkipToModes.tsx` calls `focus()` on a radio inheriting `visibility: hidden`
  from `.dock.dock-enter` for the first second. The passive Tab delay was
  accepted in plan 261007c; an explicit skip action failing was not. The test
  substitutes visible radios for Dock, so it cannot detect this interaction.
  Fix within scope: finish the entrance for the dock and its install hint before
  moving focus; retain that state through subsequent focus changes.
- **D2 · P2 · The link has no native destination.** `href="#"` is prevented
  for normal clicks, but auxiliary/native link activation can open the article
  at its top. Reader state uses query parameters, so this is not an established
  query-state corruption bug. Give the existing radiogroup a real fragment
  destination without editing the other builder's `Dock.tsx`.
- **D3 · P2 · A focused skip link prints.** The focus rule expands a fixed
  control, with no print override. Hide it in print within `dock.css`.
- **D4 · P3 · /help promises the open mode even for More.** The actual
  fallback is the first available mode radio. Correct the keyboard help.
- **D5 · P2 · Elevation migration is partial (wider, report only).** Distinct
  remaining shadows include docked/in-column chat (`dialogs.css`, 0 4px 14px),
  the Ask chip (`annotations.css`, 0 6px 18px), the revealed gutter (`gutter.css`,
  0 2px 8px), the dock drawer (`dock.css`, upward shadow), the mode herald
  (`mode-band.css`) and chat's latest-message pill (`chat-actions.css`). The
  three proposed silhouettes cannot preserve these dark literals unchanged.
  Extending the token families or deliberately changing their silhouettes is
  wider than the candidate's literal replacements; do not change these here.
- **D6 · P3 · Wider stale grey descriptions.** `outline-mode.css` still
  describes 0.63 and 4.44:1 as current. `tooltips.md` records a dated browser
  measurement, so its 0.63 is historical. The gutter comment explicitly marks
  its figures as historical. Report the outline comments, do not edit files
  outside the candidate.

Initial checks: the requested palette, token, skip, dock-fit and article-arrow
tests passed (235 assertions); the Tailwind compiler suite passed separately
(4 assertions). Browser verification is blocked: system Chrome exits with
`setsockopt: Operation not permitted` / SIGTRAP under this sandbox. A Sonnet
browser delegation was attempted through the prescribed wrapper.

No corner logo is mounted alongside a loaded Reader (ArticlePage's ready
branch). While article access is loading, neither Reader nor a mode dock
exists: the skip link is consequently absent, and HomeLogo is the available
navigation. Extending skip navigation to that state would require a separate
loading-page contract outside this commit.

- **D7 · P3 · Shadow documentation omits CommandBar's dark change.** The
  design overview says dark values are unchanged without naming the known
  `tw:shadow-lg` → dialog-shadow exception. Correct that factual claim.

## Fixes made

- **D1 fixed:** explicit skip activation marks the dock as arrived before
  focusing its radio. CSS cancels the decorative entrance for that dock and
  its install hint. The marker persists for the mount, so blur cannot restart
  the delay. Focus uses `preventScroll` while the narrow-window focus guard
  brings the hidden bar back.
- **D2 fixed:** the first radio receives `id="reader-mode-switch"` during
  layout, and the link points there. Normal activation still selects the
  checked radio; native activation has a real fallback destination. Removed
  the invalid-anchor lint suppression. The temporary id is cleaned up on
  unmount.
- **D3 fixed:** print hides the skip control regardless of focus.
- **D4 fixed:** /help now describes the first-radio fallback for More.
- **D7 fixed:** the design overview names CommandBar's dark-theme change.
- **D5 and D6 reported only:** no wider shadow redesign or edits to
  `outline-mode.css` / `tooltips.md`.

The root cause was reviewed independently and recorded in
[the postmortem](../postmortems/261007j-navigation-tests-replaced-the-destinations-lifecycle.md).

## Evidence

- New native-destination, entrance-readiness and print tests were seen red
  against the candidate, then green with the fixes. The entrance test uses the
  actual CSS and models jsdom's missing refusal to focus hidden elements; it
  does not substitute for browser verification.
- Mutation checks removed the component, focus transfer, More fallback,
  entrance marker and print rule in turn. Each produced the expected failed
  assertions; every mutation was restored. Removing focus fails both original
  destination tests. Removing the component fails the original first-stop
  test. Removing the fallback fails the original More test.
- Reverting grey to 0.63 failed the new dark raised-surface assertion at
  **4.440141:1**, below 4.5. The current 0.64 was restored.
- Seven targeted suites passed **279 assertions**. The requested
  `tests/dock-fit.test.tsx` does not exist; the actual
  `tests/dock-fit.test.ts` was run. CSS-token and Tailwind compiler suites were
  also checked separately.
- All eleven CSS replacements and four popover Tailwind replacements use the
  same three old dark shadow silhouettes. The token literals are
  byte-identical after whitespace normalization for multiline declarations.
  CommandBar is the declared exception: Tailwind's old two-layer 10% shadow
  becomes `0 12px 32px / 55%` in dark and `/ 20%` in light. No non-elevation
  shadow was moved. The light selector is the existing
  `:root[data-theme="light"]`.
- A separate real compiler probe emitted both
  `tw:shadow-[var(--shadow-pop)]` and `tw:shadow-[var(--shadow-dialog)]`, with
  the corresponding `--tw-shadow` values used by `box-shadow`.
- Focus-outline contrast is **5.72:1 dark / 5.98:1 light** against the raised
  control, and **7.29 / 5.73** against the page. Its text is **14.25 / 18.10**
  on its background. The native anchor retains the name “Skip to modes” and
  link role. Loaded Reader has no corner logo; its fixed stacking layer is
  above the bars and ordinary tooltips. TagEditor's 110 layer is on shelf and
  metadata pages, not this reading view. Native modal dialogs properly take
  focus above the reader instead.
- Lint passed on the changed code, CSS and tests. `npm run typecheck` was
  blocked by the `tsx` CLI's IPC socket; invoking the same script with
  `node --import tsx scripts/typecheck.ts` passed all four projects and its
  source-coverage guard.
- `npm test` could not initialize the required Postgres test database: the
  sandbox cannot ask Docker for its port or connect to that service. No
  database changes were made. Chrome cannot launch in this sandbox; the
  prescribed Sonnet delegation also failed to reach its API (`EAI_AGAIN`).
  Real page Tab traversal, narrow-window paint, animation timing and native
  fragment navigation remain unverified in a browser.

Final verification after restoring all mutations passed **eight suites / 299
assertions**, including doc links. `Reader.tsx` and `styles/tokens.css` have no
remaining review diff. `git diff --check` also passed on the changed tracked
files.

## Files changed

- `src/web/reader/SkipToModes.tsx`
- `src/web/styles/dock.css`
- `src/web/help/help-topics.tsx`
- `tests/skip-to-modes.test.tsx`
- `docs/project/design-css-overview.md`
- `docs/plans/261007h-f5b-f6-code-review-sol.md` (this answer)
- `docs/postmortems/261007j-navigation-tests-replaced-the-destinations-lifecycle.md`

No commit was made. Other builders' files were left untouched.

VERDICT: ready with these fixes
