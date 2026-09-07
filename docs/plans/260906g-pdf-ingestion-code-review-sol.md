# PDF ingestion code review

GPT Sol, 2026-09-07. First implementation review; code and synthetic fixtures only.

**NOTREADY**

- **PDF-INT-005 — P1:** Final dedup restores known duplicate/misattributed prose. [pdf-read.ts:2565](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/kuhn-pdf-integrity/src/pdf-read.ts:2565) falls back to every pre-fold record when dedup exposes a missing page. The candidate’s own test supplies page-1 prose labelled page 3 and confirms it appears twice in final HTML ([test:303](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/kuhn-pdf-integrity/tests/pdf-integrity.test.ts:303)). Recover/refuse the affected source page instead of restoring rejected records.

- **PDF-INT-006 — P1:** The completeness predicate has three reproduced false-safe cases at [pdf-integrity.ts:102](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/kuhn-pdf-integrity/src/pdf-integrity.ts:102): a lone `"1"` record counts as substantive; a year-dense concluding body page is classified as references; and document-wide `isScan` suppresses checking even a page with an independent text layer. The probe returned `content-warning`, `pass`, and `pass` respectively, so missing body prose publishes. Make exemptions page-local, strengthen reference identification, and prevent folios/tokens from satisfying substantive presence.

- **PDF-INT-007 — P1:** Record-type validation accepts prototype properties. `raw.type in RECORD_TYPES` at [pdf-integrity.ts:80](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/kuhn-pdf-integrity/src/pdf-integrity.ts:80) accepts `"constructor"`. The probe showed both validation and integrity checking return pass, while rendering drops the unknown type. Use `Object.hasOwn` or a `Set`.

- **PDF-INT-008 — P1:** Any nonempty finish reason is accepted except two blocklisted values. `"error"` validates, passes [requireFinished](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/kuhn-pdf-integrity/src/pdf-read.ts:2275), and an `"error"` checkpoint is reused at [pdf-read.ts:1865](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/kuhn-pdf-integrity/src/pdf-read.ts:1865). Allowlist `"stop"`; recover/refuse every other finish.

- **PDF-INT-009 — P1:** `{"records":[null]}` throws an untyped `TypeError` at [pdf-read.ts:1306](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/kuhn-pdf-integrity/src/pdf-read.ts:1306). It bypasses structural recovery because both catch sites only recognize `PdfReadingShapeError`. Validate each raw record before property access.

Prior findings: **001 partial**, **002 resolved**, **003 partial**, **004 resolved**.

Checks: required integrity test 16/16 passed; focused four-file run 128/128 passed. No repository files edited.

## Parent disposition

All five findings were verified against the implementation and accepted. Sol is fixing them
before the second review. Findings 005 and 006 exposed new permissive branches in the first
implementation; the presence of a page label alone cannot prove the content belongs there,
and neither document-wide scan classification nor year density can excuse a missing body page.
