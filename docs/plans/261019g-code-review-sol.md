## Findings

No P0 findings.

### P1

- [src/feedback-payload.ts:615](/var/tmp/spideryarn-worktrees/fbq645m0-dim-mode-and-text-size/src/feedback-payload.ts:615) — The maximum feedback-body calculation omitted the two new device fields, so a valid maximum-sized report could be rejected before validation. The allowance now derives from all five device vocabularies; the largest-report route fixture includes the new fields.
- [tests/styles-entry-is-imports-only.test.ts:240](/var/tmp/spideryarn-worktrees/fbq645m0-dim-mode-and-text-size/tests/styles-entry-is-imports-only.test.ts:240) — `reading-comfort.css` was missing from the authoritative stylesheet manifest, making the full test gate fail. Added it in the correct final position.

### P2

- [src/web/reading-comfort.ts:125](/var/tmp/spideryarn-worktrees/fbq645m0-dim-mode-and-text-size/src/web/reading-comfort.ts:125) — A failed-write choice was skipped on bfcache restoration instead of being repainted. It now reapplies the volatile in-memory value. Startup also reconciles storage before React mounts, closing the head-script/module race ([line 154](/var/tmp/spideryarn-worktrees/fbq645m0-dim-mode-and-text-size/src/web/reading-comfort.ts:154)).
- [tests/reading-comfort.test.ts:199](/var/tmp/spideryarn-worktrees/fbq645m0-dim-mode-and-text-size/tests/reading-comfort.test.ts:199) — The px guard missed `font:` shorthand, uppercase units and multiline declarations; its whole-file exemption also allowed new px sizes silently. It now recognizes those forms and pins the exact three permitted declarations.
- [tests/reading-comfort.test.ts:58](/var/tmp/spideryarn-worktrees/fbq645m0-dim-mode-and-text-size/tests/reading-comfort.test.ts:58) — The original test did execute the real inline script, but did not compare its behavior directly with the module for absent, junk and throwing storage. Added those comparisons and verified the script precedes the app.
- [tests/feedback-diagnostics.test.ts:409](/var/tmp/spideryarn-worktrees/fbq645m0-dim-mode-and-text-size/tests/feedback-diagnostics.test.ts:409) — Added explicit round-trip, invalid-value and old-report coverage. Old reports correctly produce `null`; the admin JSON view and reporter script need no changes.
- [src/web/styles/reading-comfort.css:47](/var/tmp/spideryarn-worktrees/fbq645m0-dim-mode-and-text-size/src/web/styles/reading-comfort.css:47) — The comment incorrectly claimed filtering a dialog did not affect containing blocks. Documented the actual behavior and the existing fixed Feedback toast exception.
- [docs/plans/261019g-reading-comfort-on-profile-brightness-and-text-size.md:56](/var/tmp/spideryarn-worktrees/fbq645m0-dim-mode-and-text-size/docs/plans/261019g-reading-comfort-on-profile-brightness-and-text-size.md:56) — Corrected stale CSS counts, superseded brightness values, dialog inventory, function names and expected pixel/light measurements. Related design docs were aligned.

The overlay remains non-interactive, print disables both dimming mechanisms, dialog filtering has no currently broken fixed descendant, snapshots are stable primitives, imports are SSR-safe, and resize dispatch cannot feed back into itself or occur during render.

Wider but unchanged: the browser evidence still says the image Lightbox was not opened under Dimmest. Static coverage is generic, but that real-browser acceptance check remains outstanding. The px guard intentionally covers stylesheets only, not inline TSX/Tailwind/SVG sizes.

Tests:

- Requested Vitest command: **4 files passed, 135 tests passed**.
- Additional manifest tests: **2 passed**.
- Additional maximum feedback-route tests: **2 passed**.
- `npm run typecheck`: the `tsx` CLI was blocked by the sandbox’s Unix-socket restriction (`listen EPERM /tmp/tsx-1000/14.pipe`).
- Equivalent `node --import tsx scripts/typecheck.ts`: **passed all projects and all 3,843 covered source files**.
- Targeted lint: no errors or warnings; one pre-existing informational complexity notice.
- `git diff --check`: passed.

SHIP AFTER MY FIXES