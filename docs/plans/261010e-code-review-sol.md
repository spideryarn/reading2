Found and fixed one functional issue; no wider decision is needed.

C1 — medium — `Open in Sources` pushed an empty history entry when Bibliography was already active but stepped aside. The regression failed before the fix. [Reader.tsx](/var/tmp/spideryarn-worktrees/fbzux9w6-tooltips-open-their-mode/src/web/reader/Reader.tsx:1696) now skips the URL write when already at the destination while still restoring the band and landing the row. Covered at [a-band-link-steps-the-band-aside-on-a-phone.test.tsx](/var/tmp/spideryarn-worktrees/fbzux9w6-tooltips-open-their-mode/tests/a-band-link-steps-the-band-aside-on-a-phone.test.tsx:740).

C2 — low — the promised history/own-mode integration coverage was missing. Added whole-App tests proving Quotes changes mode and selection in one push, remains available in Quotes, and restores a stepped-aside band without an empty push ([test](/var/tmp/spideryarn-worktrees/fbzux9w6-tooltips-open-their-mode/tests/a-band-link-steps-the-band-aside-on-a-phone.test.tsx:631)). Citation coverage now also verifies row landing and band restoration. Added an accessibility assertion for the shared button’s `type` and hidden icon ([citation-hover-card.test.tsx](/var/tmp/spideryarn-worktrees/fbzux9w6-tooltips-open-their-mode/tests/citation-hover-card.test.tsx:730)).

C3 — low — citation wrapping remained duplicated under the old citation-specific rule after the shared-class rename. Removed it so `.prose-card-foot-wraps` / `.prose-card-acts` are the single owners, and corrected stale comments ([prose-hover-card.css](/var/tmp/spideryarn-worktrees/fbzux9w6-tooltips-open-their-mode/src/web/styles/prose-hover-card.css:379)).

The remaining reviewed paths are sound: cards close before navigation; visitor citation controls stay absent; Skim’s `TermCard` remains valid; `termFocus` survives arrival in Glossary; visitor focus is consumed; quote navigation is atomic; old CSS selectors are gone; and the new `tooltips.md` section matches the code and accurately records the deferred gaps. The prior plan-review findings were taken correctly.

Checks:

- Touched tests: 9 files, 361 tests passed.
- Typecheck: all four projects passed; all 3,641 source files covered. The literal npm wrapper was blocked by the sandbox denying `tsx`’s IPC socket, so the same checker ran via `node --import tsx scripts/typecheck.ts`.
- `npm test`: could not start because the shared Postgres service was unavailable and sandboxed port access returned `EPERM`.
- `git diff --check`: passed.

APPROVE WITH FIXES (made)