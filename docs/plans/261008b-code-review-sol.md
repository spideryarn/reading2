## Findings and fixes

- **F6 — P1:** An overflowing unsaved Live transcript displayed a row of three disabled navigation buttons despite containing no stored message turns. The controls now require at least one turn. Added a regression test at [chat-streamed-answer-stays.test.tsx:543](/var/tmp/spideryarn-worktrees/fbpd9fnc-chat-phone-nav-and-model-info/tests/chat-streamed-answer-stays.test.tsx:543).

- **F7 — P2:** The rollback/round-trip fixture seeder silently discarded the new `effort` field, leaving round-trip coverage incomplete. The seeder now preserves it at [seed-reader-state.ts:306](/var/tmp/spideryarn-worktrees/fbpd9fnc-chat-phone-nav-and-model-info/tests/helpers/seed-reader-state.ts:306), with a PostgreSQL regression at [helpers-seed-reader-state.test.ts:239](/var/tmp/spideryarn-worktrees/fbpd9fnc-chat-phone-nav-and-model-info/tests/helpers-seed-reader-state.test.ts:239).

- **F8 — P2:** The streamed-answer hold path measured every turn after changing spacer height and `scrollTop`, forcing a second synchronous layout. It now gathers turn positions with the existing read phase and reuses them after the writes at [ChatPanel.tsx:1644](/var/tmp/spideryarn-worktrees/fbpd9fnc-chat-phone-nav-and-model-info/src/web/ChatPanel.tsx:1644). The remaining scroll-handler measurements are grouped reads, not repeated layout thrashing. Regression at [chat-streamed-answer-stays.test.tsx:244](/var/tmp/spideryarn-worktrees/fbpd9fnc-chat-phone-nav-and-model-info/tests/chat-streamed-answer-stays.test.tsx:244).

- **F9 — P3:** `models.ts` still claimed display names lived in that file. The comment now points to the client-safe `model-names.ts` owner at [models.ts:64](/var/tmp/spideryarn-worktrees/fbpd9fnc-chat-phone-nav-and-model-info/src/models.ts:64).

The stored effort is correct for both `candidates` and `guide`: the request and persisted completion both derive effort from the same `jobFor(kind)` result. Spoken answers intentionally have no recorded model/effort.

Verification:

- Focused suite: **103 tests passed**
- Typecheck: **3,507 source files covered, passed**
- Targeted lint: no errors or warnings
- Diff whitespace check: passed
- New PostgreSQL seeder regression was typechecked but not run locally
- Fixes remain uncommitted; unrelated concurrent feedback files were untouched

**VERDICT: approve with changes** — fixes F6–F9 listed above.