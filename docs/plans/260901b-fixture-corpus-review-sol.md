## Verdict: revise before building

Split scratch from committed fixtures now, because the deploy gate and worktrees are already paying for the defect. But do not build the proposed root-level corpus, `globalSetup`, or 76-file sweep as designed.

The strongest case against waiting applies to committing a small corpus and repairing the gate. The strongest case for waiting applies to the broad path migration: doing that immediately before stage 4 deletes both filesystem seams would make many tests move twice.

The weakest empirical claim is that the two-run experiment reproduces and validates the deploy failure. The weakest architectural claim is that `readArticleFromDir` survives stage 4. It explicitly does not.

### 1. Critical: the experiment is split-brain, not a clean-clone simulation

`SPIDERYARN_DATA_ROOT` redirects the filesystem adapters through `fsLocations()` ([artifacts-fs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-fs.ts:78)). It does not redirect tests that compute `ROOT/data` or `ROOT/output` themselves.

The two newly red files expose that mismatch:

- `artefact-copy` reads its source through `fsArtifacts`, which follows the override, but compares it with `ROOT/data/writes` from the unchanged laptop corpus ([artefact-copy.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/artefact-copy.test.ts:103)).
- `store-roundtrip` enumerates and reads `ROOT/data` directly ([store-roundtrip.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-roundtrip.test.ts:238)) while downstream store operations can follow the override.

Thus the “empty” run means “some consumers see empty; others still see all laptop data.” A clean deploy worktree means both see empty. The fact that only these two files newly fail is evidence of the split, not evidence that only two files need fixtures.

Likewise, `246 skipped` does not establish 246 independent pieces of lost coverage. It may include:

- tests skipped after one `beforeAll` failure;
- Postgres readiness skips;
- explicit or platform skips;
- tests never reached because another assertion in their file failed first.

The 14 common failing files cannot simply be labelled Postgres contention without comparing their exact test IDs and failure reasons. Common failures can mask corpus failures lower in the same files.

A stronger experiment would:

1. Use one clean worktree at one exact SHA and physically install or remove `data/` and `output/` there, so direct paths and store adapters see the same state.
2. Run `FULL → EMPTY → EMPTY → FULL`, preferably several times, against an isolated database or during a quiet period.
3. Save Vitest JSON output and diff every test’s status and skip reason, not aggregate counts.
4. First run the roughly 19 implicated files alone, then the full suite to expose interactions.
5. Remove one required fixture from the full arm and prove the intended guard turns red.

Until then, the documented deploy incident and remote-box experiment are better evidence than the new aggregate counts.

### 2. Critical: “coverage by construction” is not yet constructed

The proposed corpus is selected by size, mention count, and broad state labels—not by the contracts the tests exercise.

The concrete giveaway is `writes`: it is absent from the proposed v1, yet `artefact-copy`, one of the two files cited as proof of the problem, explicitly requires `data/writes`, enumerates its owned artefacts, and requires both output files ([artefact-copy.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/artefact-copy.test.ts:55)). The proposed membership therefore cannot repair its own headline failure.

Similarly:

- `data/example` is only reader state.
- `data/article` is only metadata.
- `greatwork` and `consciousness` are partial pipeline states.
- `constitution` spends 1.2 MB testing principally that `labels.json` lacks `sourceHash`.

The laptop corpus is not legitimate deterministic coverage; accidental richness is not a test contract. But deleting it becomes a rationalisation for lost coverage unless each retained fixture has assertions proving the property for which it was retained: full artefact set, legacy label state, PDF origin, missing fetch state, footnotes, tables, nested lists, uncommon block kinds, optional reader state, and capacity boundaries.

Named must-have slugs are insufficient. A slug may remain while its distinguishing field disappears. Each consuming suite should assert its fixture’s semantic precondition before asserting behaviour. Derive those properties from the bytes; do not maintain a second prose “capabilities” list that can drift.

### 3. High: the claimed durable seam is factually contradicted by stage 4

The fixture plan says the migration “explicitly keeps” `readArticleFromDir` ([fixture plan](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260901b-committed-fixture-corpus.md:129)). The migration plan explicitly deletes it, immediately before deleting `dataRoot()` too ([stage 4 plan](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260831b-finish-the-database-move.md:838)).

Therefore:

- `fixtureArticle()` must not wrap `readArticleFromDir` if it is intended to survive.
- A literal data-root reached through `SPIDERYARN_DATA_ROOT` is transitional infrastructure.
- “Zero new seam code” is not an advantage when the reused seam is condemned.

A test-owned loader may survive, but its contract should be fixture-shaped—“load this recorded article bundle”—rather than runtime-filesystem-shaped. Stage 4 can then load the same bundle into Postgres without preserving production filesystem code.

This mistake will eventually fail loudly at compile time, so it ranks below the silent coverage problems, but it creates the most avoidable rework.

### 4. High: the 76-file sweep should wait

Sweeping direct paths now and then revisiting them when stage 4 deletes the filesystem store is precisely the double migration the plan claims to avoid.

The smallest useful interim change is:

- Commit the exact required corpus, including `writes`, under `tests/fixtures/`.
- In the disposable deploy worktree, copy those tracked fixtures from that worktree into its temporary `data/` and `output/`. Stop copying personal laptop state. The existing deploy already performs this materialisation; only its source changes ([deploy.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/deploy.ts:614)).
- Make worktree setup materialise the same tracked corpus.
- Fix the known vacuous enumerators immediately, especially the `readdir(...).catch(() => [])` paths ([store-artefact-manifest.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-artefact-manifest.test.ts:205)).
- Defer the broad helper conversion until stage 4 provides the durable fixture-loading target.

That makes the deploy gate honest and worktrees usable without pretending the temporary data-root layout is permanent. It does not make a bare `npm test` in an otherwise unprepared checkout hermetic; if that is required immediately, either accept the sweep now or move stage 4 forward. Do not hide that trade-off inside `globalSetup`.

### 5. Medium: Greg is right about size; Fable is right only about arbitrary truncation

Hand-cutting independently generated `blocks.json`, `tree.json`, labels, hashes, and reader state can manufacture an impossible article. That objection is valid.

It does not justify retaining whole articles. The existing `example/` demonstrates the compromise: slice at a clean semantic boundary, state exactly which files are real or derived, and validate the resulting tree ([example README](/Users/greg/Dropbox/dev/experim/spideryarn2/example/README.md:12)).

Use three techniques:

- Regenerate ordinary fixtures from a deliberately short source.
- Record one actual pipeline run for model-generated artefacts; do not regenerate during tests.
- Construct negative fixtures by a named mutation from a valid small fixture. `constitution`’s missing `sourceHash` is intentionally not current pipeline output anyway, so “every byte must be pipeline-written” is the wrong standard.

The cost is a one-time pipeline/model run, provenance notes, and invariant/hash validation. That is modest compared with permanently carrying several megabytes for properties that could be expressed in kilobytes. Keep genuinely large inputs only where size or capacity is the subject.

### 6. Medium: fail-closed is right only at the consumption boundary

A missing committed fixture is a broken checkout, so skipping is wrong. But a global `corpus-ready` throw makes every test depend on the corpus, including a focused unit-test file that never reads it.

Prefer:

- `requireFixture(slug, requiredParts)` in suites that consume fixtures;
- one explicit failing test in enumerating suites when the required set is absent;
- errors naming the missing slug/file and expected location.

A normal shallow clone still contains tracked files. A sparse checkout that excludes test resources should fail when those tests are run. Git LFS is not part of this design—the existing large PDFs are ordinary tracked files—so “LFS-less checkout” should not drive the API.

### 7. Lower: `tests/fixtures/` wins; root `fixtures/` has no justification

`SPIDERYARN_DATA_ROOT` accepts any directory. `tests/fixtures/data-root/` serves the literal layout identically, matches the written deployment debt, and keeps test-only material out of the repo root ([deployment.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/deployment.md:207)).

If the final design is storage-neutral, prefer `tests/fixtures/articles/`. If the interim must mirror the old store, call it `tests/fixtures/data-root/` so the temporary coupling is visible.

Keeping the 11 MB and 5.8 MB PDFs in `evals/pdf/` is sensible. Expose their paths from a neutral test helper rather than importing an eval harness. “Exactly one committed copy” is worthwhile for those large files; it is not a law worth adding abstractions for every 144 KB duplicate.

## Ranked silent failures

Most costly and least visible:

1. Some tests read the temporary corpus while direct-path tests continue reading laptop `data/`.
2. A required slug survives but loses the semantic feature it was meant to cover.
3. The curated corpus omits an optional artefact or HTML/block shape and enumerating suites remain green.
4. `globalSetup` makes the filesystem adapters hermetic while leaving direct readers and writers shared.
5. A helper is introduced but several suites continue bypassing it.
6. Cross-linking to an eval PDF breaks after a rename—lower risk because this at least fails loudly.

No files were edited, and I did not rerun the already-confounded full suite.

