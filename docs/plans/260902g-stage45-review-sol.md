Not fine to commit yet. The root direction is correct, but the new classification guard still has silent-success paths.

## Findings

1. High — “no name classified twice” does not include `NOT_MIGRATED`.

`CLASSIFIED` contains only the three new exemption maps ([store-artefact-manifest.test.ts:450](/Users/greg/dev/spideryarn/reading2/tests/store-artefact-manifest.test.ts:450)). The duplicate loop therefore ignores `NOT_MIGRATED` ([store-artefact-manifest.test.ts:626](/Users/greg/dev/spideryarn/reading2/tests/store-artefact-manifest.test.ts:626)).

Concrete mutation: add `labels-progress.json` back to `NOT_MIGRATED` while leaving it in `RETIRED_FILE_REPRESENTATIONS`. Every assertion remains green, despite two contradictory classifications.

Include `NOT_MIGRATED` in duplicate detection, and separately assert:

- `NOT_MIGRATED` is disjoint from `HOMES`.
- The three exemption maps contain only `HOMES` keys.

A `HOMES` key with no corpus example and no exemption does correctly fail everywhere at the `stale` assertion ([store-artefact-manifest.test.ts:598](/Users/greg/dev/spideryarn/reading2/tests/store-artefact-manifest.test.ts:598)). No classification is expected when the corpus actually carries the artefact.

2. Medium — the evidence check is too weak for the claim made about it.

The test only runs `existsSync(path.join(ROOT, evidence))` ([store-artefact-manifest.test.ts:642](/Users/greg/dev/spideryarn/reading2/tests/store-artefact-manifest.test.ts:642)). An unrelated—or even untracked—existing file satisfies it. That partially recreates this incident’s class: local state can validate committed policy.

The current entries are substantively sound on inspection:

- The referee-criteria test exports and reads the exact file.
- The referee-claims test inserts a sentinel and requires it through the declared projection.
- The checkpoint test exercises real `hierarchy-labels` resumption across store instances.

But the generic guard does not establish any of that. A cheap improvement is an evidence object such as `{ file, contains }`, requiring the tracked evidence file to contain an artefact-specific needle: `raw.pdf`, `hierarchy-labels`, `referee-criteria.json`, or `referee_claims`. Also require the evidence path to be tracked or at least constrained to repository-relative `tests/`/`docs/` paths. The current comment calling existence “the one with teeth” overclaims ([store-artefact-manifest.test.ts:622](/Users/greg/dev/spideryarn/reading2/tests/store-artefact-manifest.test.ts:622)).

3. Medium — corpus evidence counts directory names as files.

`scanFixtureCorpus()` uses plain `readdir`, adding every immediate entry name without checking its type ([store-artefact-manifest.test.ts:483](/Users/greg/dev/spideryarn/reading2/tests/store-artefact-manifest.test.ts:483)). A committed `raw.pdf/placeholder` directory would:

- trigger the pending-arrival assertion;
- satisfy the subsequent staleness check;
- provide no PDF artefact.

Use `readdir(..., { withFileTypes: true })` and accept actual files only. This is otherwise corpus-only and complete over the present corpus.

4. Medium — keeping `pdf-chunks` in `NOT_MIGRATED` preserves a false classification for tidiness.

The list’s contract is “deliberately NOT migrated” ([store-artefact-manifest.test.ts:269](/Users/greg/dev/spideryarn/reading2/tests/store-artefact-manifest.test.ts:269)), while its own `pdf-chunks` explanation says it is migrated to checkpoints ([store-artefact-manifest.test.ts:292](/Users/greg/dev/spideryarn/reading2/tests/store-artefact-manifest.test.ts:292)). The argument that moving it would violate the `HOMES`-key invariant ([store-artefact-manifest.test.ts:314](/Users/greg/dev/spideryarn/reading2/tests/store-artefact-manifest.test.ts:314)) confuses two jobs:

- exemptions from `HOMES` corpus coverage;
- names the discovery scan must recognize, including directories.

Give `pdf-chunks` an honest discovery-only classification such as `RETIRED_DIRECTORY_REPRESENTATIONS`; include it in `known`, but not in the `HOMES` exemption set.

5. Low — three comments are stale or incorrect.

- “Two of the three” is now wrong: there are four tests ([store-artefact-manifest.test.ts:43](/Users/greg/dev/spideryarn/reading2/tests/store-artefact-manifest.test.ts:43)).
- The mutable `data/writes` measurement says 16 files / 148 KB ([store-artefact-manifest.test.ts:146](/Users/greg/dev/spideryarn/reading2/tests/store-artefact-manifest.test.ts:146)); it currently has 17 files / 120,980 bytes. A fixed measurement of mutable data should probably be removed.
- The helper points to nonexistent `tests/store-carry-forward.ts`; the file is `tests/store-carry-forward.test.ts` ([roundtrip-artefacts.ts:47](/Users/greg/dev/spideryarn/reading2/tests/helpers/roundtrip-artefacts.ts:47)).

## Requested confirmations

- The stale and pending-arrival checks both use only `tests/fixtures/data-root/data/`; no path to `data/` or `example/` survives in those verdicts ([store-artefact-manifest.test.ts:574](/Users/greg/dev/spideryarn/reading2/tests/store-artefact-manifest.test.ts:574)).
- The two mutable-`data/` tests cannot clear an exemption or make staleness green. They can still make the overall suite red—intentionally as discovery canaries—so “cannot turn a gate verdict” is false if interpreted literally.
- No test-time consumer writes into the tracked corpus. Consumers read it or copy outward; only manually invoked `build-corpus.ts` writes it.
- The shared list is correct: exactly the old round-trip suite’s 18 JSON entries, including `quiz.json`; the former fixture-corpus copy gains only `quiz.json` ([roundtrip-artefacts.ts:51](/Users/greg/dev/spideryarn/reading2/tests/helpers/roundtrip-artefacts.ts:51)). Both importers use it ([store-roundtrip.test.ts:67](/Users/greg/dev/spideryarn/reading2/tests/store-roundtrip.test.ts:67), [fixture-corpus.test.ts:578](/Users/greg/dev/spideryarn/reading2/tests/fixture-corpus.test.ts:578)). No non-JSON artefact enters the JSON loop.
- `raw.pdf` remains pending, not falsely exempted as covered elsewhere. `labels-progress.json` is correctly retired rather than `NOT_MIGRATED`.

Verification: the focused manifest/corpus run passed 25/25 tests. All three TypeScript projects passed, covering 1,013 source files. I did not run the Postgres-dependent round-trip suite.