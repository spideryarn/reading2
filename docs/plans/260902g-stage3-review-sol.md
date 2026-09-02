Verdict: **not fine to commit as-is.** The fixture itself is coherent and closes the export-coverage gap, but the central evidence assertion still has a silent-success path.

## Findings

1. **High — the evidence loop can pass while checking no actual evidence text.**

At [fixture-corpus.test.ts:424](/Users/greg/dev/spideryarn/reading2/tests/fixture-corpus.test.ts:424), `checked` counts evidence entries, not valid anchors. If every `e.quote` is changed to `""`, then:

```ts
block.text.slice(e.start, e.start + e.quote.length) === ""
```

Every comparison passes, `wrong` remains empty, and `checked` remains 13. I reproduced exactly that result in memory.

It also permits individual questions with `evidence: []` as long as another question has evidence, and does not validate that `start` is a non-negative integer; JavaScript coercion can accept malformed JSON values.

The guard at [fixture-corpus.test.ts:448](/Users/greg/dev/spideryarn/reading2/tests/fixture-corpus.test.ts:448) genuinely prevents the all-empty loop reported in the mutation table, but it does not enforce the producer’s invariant that every question has at least one non-empty, validly offset quote.

Before commit, assert for every question:

- `evidence.length > 0`;
- `quote.length > 0`;
- `Number.isInteger(start) && start >= 0`;
- then the exact slice equality.

2. **Low — the builder records the wrong generation route.**

[build-corpus.ts:88](/Users/greg/dev/spideryarn/reading2/tests/fixtures/data-root/build-corpus.ts:88) says the quiz was generated through `POST /api/jobs`. Per the supplied provenance, it was generated in-process through `enqueue(...)` because HTTP authentication was blocked. The comment should record what actually happened.

3. **Low — two comments misstate measurements.**

- [fixture-corpus.test.ts:364](/Users/greg/dev/spideryarn/reading2/tests/fixture-corpus.test.ts:364) says store-roundtrip preserves “the bytes”; that suite explicitly performs semantic JSON comparison after normalization at [store-roundtrip.test.ts:572](/Users/greg/dev/spideryarn/reading2/tests/store-roundtrip.test.ts:572).
- [build-corpus.ts:64](/Users/greg/dev/spideryarn/reading2/tests/fixtures/data-root/build-corpus.ts:64) still says the whitelisted `writes` files total 55 KB. They now total 63,481 bytes, approximately 62 KiB.

The README’s exact corpus count is correct: **56 data/output files totaling 1,166,037 bytes**. Its “1.14 MB” is only an informal continuation of its previous unit convention; conventionally that total is 1.17 MB or 1.11 MiB. Likewise, the `writes` “104 KB” is not its logical byte size.

## What is sound

The reported mutation table is otherwise accurate:

- `slug → "todo"` fails [fixture-corpus.test.ts:384](/Users/greg/dev/spideryarn/reading2/tests/fixture-corpus.test.ts:384).
- `questions → []` fails both the non-empty assertion and the global evidence guard.
- Altering `sourceHash` fails because the right-hand side is independently recomputed from committed blocks, tree, and metadata at [fixture-corpus.test.ts:403](/Users/greg/dev/spideryarn/reading2/tests/fixture-corpus.test.ts:403). The quiz field is only the left operand; this is not self-comparison.
- Unknown evidence IDs and shifted offsets fail [fixture-corpus.test.ts:430](/Users/greg/dev/spideryarn/reading2/tests/fixture-corpus.test.ts:430).
- Changing block text changed the recomputed fingerprint’s first segment from `1ee2ebde490b347e` to `87d09cfd56b53124`.
- Reformatting `blocks.json` leaves the fingerprint unchanged because `hashBlocks` hashes parsed semantic fields at [source-hash.ts:114](/Users/greg/dev/spideryarn/reading2/src/source-hash.ts:114).
- Removing `quiz.json` throws from the module-scope requirement at [fixture-corpus.test.ts:58](/Users/greg/dev/spideryarn/reading2/tests/fixture-corpus.test.ts:58), before the `describe` at line 116.

The fixture itself is honest:

- Stored and recomputed hash both equal `1ee2ebde490b347e.9fa0a24e110d45f7.1118017b0bf914f6` ([quiz.json:5](/Users/greg/dev/spideryarn/reading2/tests/fixtures/data-root/data/writes/quiz.json:5)).
- 10 questions, 13 evidence entries, bands 3 easy / 3 medium / 4 hard, all dropped counters zero.
- Every batch, question, and evidence block ID satisfies `isSpideryarnId`.
- Every current quote resolves exactly at its recorded start.
- No reader data, credentials, email addresses, tokens, or secrets appear.
- At 8,268 bytes it is smaller than the 18,847-byte timeline and 20,223-byte sketch, but not suspicious for a 19-block article and ten-question batch.

It also genuinely closes the export gap. The fixture enters Postgres through the declared quiz artefact mappings, and [export.ts:443](/Users/greg/dev/spideryarn/reading2/src/store/export.ts:443) writes it back. If that line stops writing `quiz.json`, the `writes › preserves quiz.json exactly` case at [store-roundtrip.test.ts:558](/Users/greg/dev/spideryarn/reading2/tests/store-roundtrip.test.ts:558) fails at `expect(returned).toBeDefined()` on line 572. The coverage test at line 420 only proves a source carrier exists; it is not the test that catches the export mutation.

Verification completed:

- `tests/fixture-corpus.test.ts`: 21/21 passed.
- All three TypeScript projects passed, with all 1,009 source files covered.

Fix the vacuous evidence case and the provenance comment, then it is fine to commit.