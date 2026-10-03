**Land after fixes.** Scoped fixes are in the working tree; nothing committed.

1. **P2 — Late scan findings lost the established announcement path. Fixed.**  
   [RefereeMode.tsx:248](/home/greg/code/spideryarn2/.claude/worktrees/fbvbeyse-referee-ui-cleanup/src/web/modes/referee/RefereeMode.tsx:248) mounted the scan’s polite live region already populated. Screen readers generally observe changes to an existing region. [MDN explains this prerequisite](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions). Added a persistent, initially empty status. The new test failed before the fix and passed afterwards. Actual screen-reader speech remains unverified.

2. **P2 — Panel-only retry coverage missed the band’s wiring. Fixed coverage.**  
   [CandidatesPanel.tsx:238](/home/greg/code/spideryarn2/.claude/worktrees/fbvbeyse-referee-ui-cleanup/src/web/CandidatesPanel.tsx:238) correctly passes `reload`, but changing this to `startBrief` escaped the panel test. Added band tests covering two failed reads followed by success, with both an empty result and a stored thread. That mutation fails both tests. Retries make GETs only; Build or the composer starts the subsequent POST.

3. **P3 — Two additional mutations survived. Fixed coverage.**  
   [referee-notices.test.tsx:193](/home/greg/code/spideryarn2/.claude/worktrees/fbvbeyse-referee-ui-cleanup/tests/referee-notices.test.tsx:193) stayed green when Notices acquired `role="radio"`, and when the colour explanation disappeared from the (i). Added semantic and content assertions; both mutations now fail.

4. **P3 — Touched comments and introductory documentation described the previous UI. Fixed.**  
   Corrected chip-triggered Candidates descriptions, scan placement, the removed header, and the count of inert chips. The opening paragraphs of [referee-mode.md:56](/home/greg/code/spideryarn2/.claude/worktrees/fbvbeyse-referee-ui-cleanup/docs/project/referee-mode.md:56) now describe the current controls. Explicitly historical sections remain history.

Mutation evidence—all changes restored:

| Source mutation | Tests observed failing |
|---|---|
| `noticesChoice ?? false` | Notices’ two late-finding cases; band default guard |
| Move scan below confidentiality paragraphs | Notices order; band-fit order |
| Restore Candidates in `REFEREE_TARGET` | Chip arming; command-bar literal expectations |
| Retry button calls `onStart` | Candidates panel retry |
| Band passes `startBrief` as `onReload` | Both new band retry cases |
| Move lead outside `.ref-panel` | All four lead cases |
| Remove Referee’s `mode` and `about` props | Both surface test files |
| Remove only `RefereeAbout` | Originally green; strengthened colour test now fails |
| Give Notices `role="radio"` | Originally green; strengthened semantic test now fails |
| Remove Candidates’ persistent warning | Panel warning before/after the first turn |
| Force Notices open; ignore user choice; disable toggle; remove confidentiality paragraph | Corresponding closed-state, choice and disclosure cases |
| Use scan `warn` instead of `open` | Labelled late-finding case |
| Empty the persistent announcement | New live-region test |
| Stop keyboard-event propagation on Notices | New navigation-key test |
| Corrupt the start-button tooltip | Both changed Candidates tooltip cases |
| Disconnect composer `onAsk` | Candidates Enter and keyboard-release cases |
| Remove Lightbox’s `close-x` | Changed close-cross inventory test |

No tested mutation remains green after strengthening coverage.

Candidates’ mount trace is sound: empty result → Build; stored thread → conversation/composer; failed read → Try again; successful retry → Build or stored conversation. I found no unpressed turn and no settled state without a usable recovery/start control.

For Candidates, `subModeTarget = null`, `subModeGenerates = false`, and `bandTarget = null`. Referee’s `modeGenerates` is false, and the add page does not queue it. Notices passes article navigation keys through. The (i) remains first, and omitting `aria-controls` is allowed by the [disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/).

Wider things noticed and left unchanged:

- **P2 — Published copy:** `src/mode-catalog.ts:274` is no longer precise enough: only Claims arms itself. The criterion-only clause also misdescribes preserved non-Criteria views. `src/web/help/help-modes.tsx:330` still puts Hidden instructions “at the top”; Help should explain Notices and Candidates’ Build button, under `docs/project/help-page.md:74`.
- **P3 — Stale statements outside touched files:** `docs/project/mode.md:202` retains Referee’s (i) exemption; `docs/project/security.md:1039` promises an always-visible scan headline; `src/web/useAutoRun.ts:12`, `src/web/useChat.ts:211`, and `tests/referee-copy-is-about-the-model.test.ts:375` retain old Candidates/placement descriptions.
- Deleted APIs have no live consumers. The obsolete browser key is harmless. `tests/store-migration-witness.json:911` is a dated measurement, so its deleted-test entry should remain.

Validation: **13 focused files, 286 tests passed**. Follow-up Notices/doc-links check: **33 passed**. Lint passed with two existing CSS warnings; `git diff --check` passed. No full suite or typecheck run.

Files changed:

- `src/web/modes/referee/RefereeMode.tsx`
- `src/web/CandidatesPanel.tsx`
- `src/web/SourceScanNotice.tsx`
- `src/web/activation.ts`
- `src/web/styles/referee.css`
- `tests/referee-notices.test.tsx`
- `tests/referee-candidates-press.test.tsx`
- `docs/project/referee-mode.md`
- [Postmortem](/home/greg/code/spideryarn2/.claude/worktrees/fbvbeyse-referee-ui-cleanup/docs/postmortems/261003e-a-live-region-mounted-with-its-message-has-no-update-to-announce.md)