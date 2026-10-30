## Findings

- **P1 — unresolved/wider:** [docs/user-feedback/261025_2109-signed-out-bar-under-the-clock-on-an-iphone.md:3](/var/tmp/spideryarn-worktrees/fbtfsjvq-landing-nav-under-the-clock/docs/user-feedback/261025_2109-signed-out-bar-under-the-clock-on-an-iphone.md:3) marks the report shipped, while lines 39–42 acknowledge the change may do nothing in the reported Safari-tab state. A real-phone `--safe-top` measurement is still needed; if it is zero, this requires a product decision.
- **P1 — fixed:** [tests/home-link-only-without-the-corner-logo.test.tsx:170](/var/tmp/spideryarn-worktrees/fbtfsjvq-landing-nav-under-the-clock/tests/home-link-only-without-the-corner-logo.test.tsx:170) assumed the inset lived in a single-declaration wrapper rule. The intended CSS move caused two existing gate tests to fail. The assertion now accepts the inset within the shared `.site-nav` block while still checking that its selector matches the rendered nav.
- **P2 — fixed:** [scripts/safe-area-check.ts:229](/var/tmp/spideryarn-worktrees/fbtfsjvq-landing-nav-under-the-clock/scripts/safe-area-check.ts:229) parsed `--top` with `parseFloat` and rounded geometry before comparison. Values such as `--top 3rem` could therefore silently test against `3px`. It now resolves the token through computed CSS, rejects invalid lengths, and compares unrounded coordinates.

What I changed:

- Fixed the existing document-page regression test.
- Hardened the new browser geometry check.
- Corrected the new test’s stale “painted check” comment.
- Changed “run the second one” to “run the matching `--break` command” in the Playwright instructions.

Verification:

- Focused tests: 41/41 passed; broader focused run: 189/189 passed.
- Typecheck passed for all 4,026 covered source files.
- Lint passed, with one unchanged advisory in the reader branch.
- `git diff --check` passed.
- Full `npm test` could not collect because this sandbox cannot reach local Postgres.
- Chrome could not launch under the sandbox’s socket restrictions, so I could not independently rerun `--site`; your supplied 7/7 and deliberate-break results remain the browser evidence.

No commit or Git-state operation was performed.