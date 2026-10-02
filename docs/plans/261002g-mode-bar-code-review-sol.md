## Findings

- **P0 — None.**

- **P1 — Left:** [Dock.tsx:2761](/home/greg/code/spideryarn2/.claude/worktrees/fb96-mode-click-toggles-off/src/web/Dock.tsx:2761) still exposes modes as radios, but activating the checked radio selects Plain instead. The declined rationale only preserves “exactly one checked”; it does not address the radio contract that activating an option selects that option. The proper fix is the deferred `aria-pressed`/group migration across code, tests, and documentation, so I did not expand this review into that wider change.

- **P1 — Fixed:** [Reader.tsx:3067](/home/greg/code/spideryarn2/.claude/worktrees/fb96-mode-click-toggles-off/src/web/reader/Reader.tsx:3067) ignored the new `toggle=false` intent for Marginalia. Selecting an already-open Marginalia from Cmd-K closed it. It is now idempotent while retaining the narrow-window swap that brings a hidden column forward.

- **P2 — Fixed:** [Reader.tsx:3097](/home/greg/code/spideryarn2/.claude/worktrees/fb96-mode-click-toggles-off/src/web/reader/Reader.tsx:3097) and [Reader.tsx:3121](/home/greg/code/spideryarn2/.claude/worktrees/fb96-mode-click-toggles-off/src/web/reader/Reader.tsx:3121) issued same-value `nuqs` pushes for Plain-with-nothing-open, a current-mode command, and restoring a stepped-aside band. Those created invisible history entries. Same-destination writes are now skipped.

- **P2 — Fixed tests:** [a-second-press-closes-the-mode.test.tsx:330](/home/greg/code/spideryarn2/.claude/worktrees/fb96-mode-click-toggles-off/tests/a-second-press-closes-the-mode.test.tsx:330) now verifies raw `?mode=` removal, command-bar idempotence, no empty history pushes, surviving inner separators, and count-based frame sizing. [a-band-link-steps-the-band-aside-on-a-phone.test.tsx:426](/home/greg/code/spideryarn2/.claude/worktrees/fb96-mode-click-toggles-off/tests/a-band-link-steps-the-band-aside-on-a-phone.test.tsx:426) now covers restoring a stepped-aside band through its Dock button without a history push.

No other production `Dock.onMode` caller exists.

## Checks

- Focused suite: **10 files, 275 tests passed**
- Final changed-test rerun: **2 files, 19 tests passed**
- Typecheck: all **2,733** source files passed through `node --import tsx scripts/typecheck.ts`
- `npm run typecheck` itself was blocked before checking by sandbox IPC `EPERM`.
- Lint checked the three touched files: no errors; three advisory complexity notices.
- Full `npm test` could not start because the sandbox could not connect to the local Postgres port.
- No commit made.

**Verdict:** changes requested because the P1 radio-semantics mismatch remains; otherwise the implementation is sound after the fixes above.