All fixes are uncommitted in the working tree.

- **F7 — P1 — established — fixed** in [Toast.tsx](/var/tmp/spideryarn-worktrees/qi-tdwvz53m-marginalia-notice-dismiss/src/web/Toast.tsx:44), [marginalia-narrow-notice.test.tsx](/var/tmp/spideryarn-worktrees/qi-tdwvz53m-marginalia-notice-dismiss/tests/marginalia-narrow-notice.test.tsx:90), and related prose. F4 ignored touch but treated Apple Pencil (`pointerType: "pen"`) as hover, contrary to the project’s input contract. The Pencil regression failed red before the shared direct-pointer predicate fixed it.

- **F8 — P1 — established — fixed** in [Toast.tsx](/var/tmp/spideryarn-worktrees/qi-tdwvz53m-marginalia-notice-dismiss/src/web/Toast.tsx:101) and [marginalia-narrow-notice.test.tsx](/var/tmp/spideryarn-worktrees/qi-tdwvz53m-marginalia-notice-dismiss/tests/marginalia-narrow-notice.test.tsx:101). Pointer enter filtered direct pointers, but pointer leave did not. On a hybrid device, a finger/Pencil lift could resume the timer while a mouse remained over the notice or toast. Both hybrid sequences failed red before leave adopted the same predicate.

- **F9 — P1 — established — fixed** in [MarginaliaColumn.tsx](/var/tmp/spideryarn-worktrees/qi-tdwvz53m-marginalia-notice-dismiss/src/web/marginalia/MarginaliaColumn.tsx:639), [marginalia.css](/var/tmp/spideryarn-worktrees/qi-tdwvz53m-marginalia-notice-dismiss/src/web/styles/marginalia.css:418), and the test. Explicit “Dismiss” left the sentence and Marginalia landmark in the accessibility tree. Timeout now remains accessible as F6 intended, while explicit dismissal adds `aria-hidden`; a later timer callback cannot undo it. The accessibility assertion failed red first.

- **F10 — P2 — established — fixed** in [marginalia-narrow-notice.test.tsx](/var/tmp/spideryarn-worktrees/qi-tdwvz53m-marginalia-notice-dismiss/tests/marginalia-narrow-notice.test.tsx:132). The F6 test treated `textContent` plus one CSS-rule inspection as proof of accessibility-tree retention. It now directly distinguishes timeout from explicit dismissal and checks `aria-hidden`/`hidden`.

- **F11 — P3 — established — fixed** in [narrow-windows.md](/var/tmp/spideryarn-worktrees/qi-tdwvz53m-marginalia-notice-dismiss/docs/project/narrow-windows.md:224), the plan, source comments, and `web-client.md`. Prose incorrectly implied every covering-band close redraws the line, named mouse handlers after they became pointer handlers, and described one state after dismissal required two semantic outcomes.

F1–F3 and F5 were implemented as claimed. F4 was incomplete until F7–F8; F6 handled automatic expiry correctly but missed explicit dismissal until F9–F10. Two root-cause postmortems were added under `docs/postmortems/`.

Verification:

- Focused timer/close suites: 33 passed.
- Page-level Marginalia cases: 12 passed.
- Documentation links: 17 passed.
- All four TypeScript projects passed; all 3,329 source files covered.
- Lint on touched code/tests passed.
- `git diff --check` passed.
- Full `npm test` could not start because this sandbox has no database and cannot query Docker; the database-free requested suites passed.

Nothing wider remains to report.

VERDICT: approve with the fixes made