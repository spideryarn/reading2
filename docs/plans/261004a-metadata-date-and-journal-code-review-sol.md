- **C1 — P1 — [article-registry.ts:99](src/article-registry.ts:99): Fixed.** Shared title prefixes and erased maths operators let another work’s facts through. Matching now requires the complete title and preserves operators.
- **C2 — P1 — [article-registry.ts:131](src/article-registry.ts:131): Fixed.** Surnames matched ordinary byline words or words across different authors. Matching now requires corroborated names.
- **C3 — P1 — [pipeline.ts:2076](src/pipeline.ts:2076): Fixed.** Ordinary re-extraction inherited stale dates and journals. Carry-over now requires the minimal-to-full transition and an agreeing title, checking HTML presence through `read`.
- **C4 — P2 — [article-registry.ts:76](src/article-registry.ts:76): Fixed.** Meta-tag parsing extracted DOIs from unrelated URLs and retained closing brackets. It now parses the whole declared identifier and removes wrapping punctuation.
- **C5 — P2 — [schema.ts:6576](src/db/schema.ts:6576): Fixed in code.** NULL-state claims passed the CHECK with a publication day. Schema, migration and snapshot now reject them; database regression unrun.
- **C6 — P2 — [Metadata.tsx:733](src/web/Metadata.tsx:733): Fixed.** Duplicate fact values produced duplicate React keys; surrounding whitespace defeated journal/site deduplication.

**80 targeted tests passed.** Runnable regressions were seen red first. No public-field leak or additional live-registry-dependent test found.

Run `tests/minimal-paper.test.ts` and `tests/bibliographic-pg.test.ts` against Postgres. If the migration was already applied, replace its installed CHECK too. Changes remain uncommitted.

**Verdict: not yet.**