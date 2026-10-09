APPROVE WITH CHANGES

1. **P2 — `src/pipeline.ts:2192`** — DOI comparison was case-sensitive, so the same DOI with different capitalization discarded the existing journal. Changed to case-insensitive comparison and added a red-then-green regression at `tests/metadata-rerun-keeps-extract.test.ts:168`. Nothing left for the author.

No further findings. The `Record<keyof Meta, …>` is exhaustive; its casts do not bypass that check. Pairing/date rules, parallel-test isolation, and export compatibility look sound.

Verification: unit test passed (7/7), typecheck passed, scoped lint exited 0. Postgres tests could not run because the sandbox cannot reach the local database (`EPERM 127.0.0.1:54362`).