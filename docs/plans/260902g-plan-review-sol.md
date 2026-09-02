Verdict: not ready. The diagnosis is sound, but Stage 2 currently unifies different contracts, misclassifies `labels-progress.json`, and cannot itself end green.

## Critical findings

1. Stage 2 derives the round-trip list from the wrong authority.

`HOMES` answers “where does this filesystem concept live in Postgres?” ([store-artefact-manifest.test.ts:145](/Users/greg/dev/spideryarn/reading2/tests/store-artefact-manifest.test.ts:145)). `ARTEFACTS` answers “which JSON files does this particular import/export round trip preserve exactly?” ([store-roundtrip.test.ts:51](/Users/greg/dev/spideryarn/reading2/tests/store-roundtrip.test.ts:51)). They are intentionally different:

- `HOMES` includes `raw.html`, `raw.pdf`, and `raw.json`. The first two are bytes, while `raw.json` is reconstructed rather than preserved exactly; round-trip therefore gives them purpose-built tests ([store-roundtrip.test.ts:579](/Users/greg/dev/spideryarn/reading2/tests/store-roundtrip.test.ts:579), [store-roundtrip.test.ts:655](/Users/greg/dev/spideryarn/reading2/tests/store-roundtrip.test.ts:655)).
- `HOMES` includes `labels-progress.json`, although the file is no longer produced.
- It includes referee files deliberately excluded from `ARTEFACTS` because dedicated tests manufacture the required rows ([store-artefact-manifest.test.ts:202](/Users/greg/dev/spideryarn/reading2/tests/store-artefact-manifest.test.ts:202)).
- If a mechanically derived list puts `raw.html` into `it.each(ARTEFACTS)`, the round-trip will try to parse HTML as JSON at [store-roundtrip.test.ts:558](/Users/greg/dev/spideryarn/reading2/tests/store-roundtrip.test.ts:558).

I would make an explicit `ROUNDTRIP_JSON_ARTEFACTS` in a test helper and import it from both `store-roundtrip` and `fixture-corpus`. It should be the authority for the export-preservation question, not derived from production export code or `HOMES`.

If you want one richer source, use a test-owned policy map whose entries classify each filename as:

- corpus JSON round-trip;
- custom corpus round-trip, such as raw source;
- dedicated behavioural test;
- retired filesystem representation;
- temporarily awaiting coverage.

Then derive `ROUNDTRIP_JSON_ARTEFACTS` from that classification. Do not derive it merely from the keys of `HOMES`.

2. Stage 2 cannot end committable in the proposed order.

Stage 2 deliberately makes every uncovered round-trip artefact red, but `quiz.json` is not added until Stage 3 ([plan:70](/Users/greg/dev/spideryarn/reading2/docs/plans/260902g-corpus-evidence-for-artefact-coverage.md:70), [plan:80](/Users/greg/dev/spideryarn/reading2/docs/plans/260902g-corpus-evidence-for-artefact-coverage.md:80)). Therefore Stage 2 must finish red.

Put the quiz corpus change before the shared-list enforcement, or combine them. My preferred order is:

1. Postmortem and revised plan.
2. Statusline and doc-link blockers.
3. Add and validate the quiz fixture.
4. Introduce the shared round-trip list.
5. Separately clean up the manifest’s classifications and evidence scan.
6. Run the unforced dry-run gate.

There is another immediate ordering problem: the plan links to a postmortem that does not exist ([plan:61](/Users/greg/dev/spideryarn/reading2/docs/plans/260902g-corpus-evidence-for-artefact-coverage.md:61)). `doc-links` scans every `docs/**/*.md` and rejects missing targets ([doc-links.test.ts:45](/Users/greg/dev/spideryarn/reading2/tests/doc-links.test.ts:45), [doc-links.test.ts:182](/Users/greg/dev/spideryarn/reading2/tests/doc-links.test.ts:182)). Committing this plan before the postmortem creates another deterministic gate red.

3. Moving `labels-progress.json` to `NOT_MIGRATED` records a false decision.

The file is gone, but its contents are migrated and wired to `checkpoints`; the current manifest says exactly that ([store-artefact-manifest.test.ts:169](/Users/greg/dev/spideryarn/reading2/tests/store-artefact-manifest.test.ts:169)). `NOT_MIGRATED` is documented as “we decided not to” ([store-artefact-manifest.test.ts:236](/Users/greg/dev/spideryarn/reading2/tests/store-artefact-manifest.test.ts:236)).

Give it a separate classification such as `RETIRED_FILE_REPRESENTATIONS`, pointing to the durable checkpoint test. The existing `pdf-chunks` entry already strains `NOT_MIGRATED`; it is not a good precedent to extend.

## High findings

4. `raw.pdf` is not currently proved by the alternative tests strongly enough to deserve a permanent exemption.

The dedicated export test uses `writes`, whose source is `raw.html` ([store-export-raw.test.ts:64](/Users/greg/dev/spideryarn/reading2/tests/store-export-raw.test.ts:64)). The PDF cases in `store-roundtrip` test `rawFileName` directly, not an end-to-end `exportArticle` ([store-roundtrip.test.ts:769](/Users/greg/dev/spideryarn/reading2/tests/store-roundtrip.test.ts:769)). A mutation that made `writeRawDocument` always write `raw.html` could therefore evade the proposed corpus exemption.

Before putting `raw.pdf` in `NO_CORPUS_EXAMPLE`, add or identify an actual PDF `exportArticle` test. It can use small synthetic PDF bytes or an already committed eval PDF; the corpus README explicitly says not to duplicate the large PDFs ([README.md:32](/Users/greg/dev/spideryarn/reading2/tests/fixtures/data-root/README.md:32)).

The referee exemptions are more defensible: `store-export-covers-tables` inserts sentinel rows and proves they arrive in the declared files ([store-export-covers-tables.test.ts:724](/Users/greg/dev/spideryarn/reading2/tests/store-export-covers-tables.test.ts:724)), while `store-export-referee` checks criterion shape and values.

5. The temporary exemption was not the root defect; its evidence source was.

Deleting `NOT_YET_WRITTEN` is not justified by this incident. Its auto-clearing test consulted mutable laptop state ([store-artefact-manifest.test.ts:402](/Users/greg/dev/spideryarn/reading2/tests/store-artefact-manifest.test.ts:402)); that is what failed.

For a complete feature, “red everywhere until there is corpus or dedicated-test coverage” is correct. For staged development, where registration and the first real generation may land separately, having no deterministic pending state encourages exactly the forced-gate habit this work is trying to stop.

I would retain a narrowly named `PENDING_CORPUS_EXAMPLE`, with a reason and plan reference, and make both its arrival check and the stale check consult only the tracked corpus. Once that happens, `seen` versus `outsideFixtures` no longer earns its keep: tracked corpus directories contain no concurrent `data/test-*` fixtures. Delete `outsideFixtures`, the generous scan, and probably the ENOENT race handling that existed for mutable shared `data/` ([store-artefact-manifest.test.ts:403](/Users/greg/dev/spideryarn/reading2/tests/store-artefact-manifest.test.ts:403)).

## Quiz fixture

Committing a real model-generated quiz is reasonable, provided it is generated for an unsliced corpus article such as `writes` and its size is measured first. A normal quiz is likely small beside the existing 18–20 KB timeline and sketch artefacts, so trimming would buy little and could make `dropped` metadata dishonest.

The plan is wrong that `sourceHash` is simply over the committed blocks. Quiz freshness covers blocks, tree, and selected metadata ([quiz.ts:215](/Users/greg/dev/spideryarn/reading2/src/quiz.ts:215), [source-hash.ts:338](/Users/greg/dev/spideryarn/reading2/src/source-hash.ts:338)). Nor is it byte-for-byte hashing of `blocks.json`: the block hash deliberately uses semantic fields rather than raw JSON bytes ([source-hash.ts:20](/Users/greg/dev/spideryarn/reading2/src/source-hash.ts:20)).

Stage 3 needs fixture assertions that:

- `sourceHash === inputFingerprint(committed blocks, tree, meta)`;
- every evidence block id exists;
- every evidence quote and start point resolve in that block;
- the slug matches;
- questions are non-empty.

The current store check at [artifacts.ts:270](/Users/greg/dev/spideryarn/reading2/src/store/artifacts.ts:270) proves only that `questions` is a non-empty array. “Real model output” is provenance, not ongoing schema validation.

A hand-written literal would indeed be weak. A small fixture passed through the real `buildQuiz`, using real committed blocks and `inputFingerprint`, is perfectly defensible—the repository already uses that pattern at [quiz-mark-route.test.ts:109](/Users/greg/dev/spideryarn/reading2/tests/quiz-mark-route.test.ts:109). I would still choose a full real output unless its measured size is anomalous; it fits the corpus’s “copied whole when small” convention and avoids inventing another builder category.

## Statusline fork

The script is right; the test is wrong.

The script already prints the symbolic branch when attached and falls back to the short commit SHA when detached ([provision.sh:617](/Users/greg/dev/spideryarn/reading2/infra/hetzner/provision.sh:617)). It also prints the linked-worktree name ([provision.sh:630](/Users/greg/dev/spideryarn/reading2/infra/hetzner/provision.sh:630)). A short SHA plus worktree name is better than displaying literal `HEAD`.

The test derives its expected value with a different command that returns `HEAD` when detached ([statusline.test.ts:177](/Users/greg/dev/spideryarn/reading2/tests/statusline.test.ts:177)). Do not merely “tolerate” that result. Replace the environment-dependent test with a temporary Git repository and two explicit cases:

- attached branch → branch name;
- detached commit → short SHA.

That tests the script’s actual contract and prevents another checkout-specific failure.

## Deferral and other misses

The 76-file deferral is compatible with this work if the change remains surgical: corpus coverage and manifest staleness can read `FIXTURE_ROOT`, while the actual round-trip continues to consume materialised `ROOT/data` until the larger migration. The prior plan explicitly accepts that remaining split ([260901b:20](/Users/greg/dev/spideryarn/reading2/docs/plans/260901b-committed-fixture-corpus.md:20), [README.md:174](/Users/greg/dev/spideryarn/reading2/tests/fixtures/data-root/README.md:174)).

However, the new plan overstates `store-parity`: laptop data can change its verdict, not merely make it do more work. It enumerates every complete article in mutable `ROOT/data` ([store-parity.test.ts:243](/Users/greg/dev/spideryarn/reading2/tests/store-parity.test.ts:243)) and then runs behavioural comparisons over those slugs. Leave it deferred if that remains Greg’s decision, but describe it honestly as remaining non-hermetic. The deploy gate is deterministic because its detached worktree starts clean and materialises the tracked corpus ([deploy.ts:656](/Users/greg/dev/spideryarn/reading2/scripts/deploy.ts:656)).

The plan should also add:

- updates to the corpus README’s membership, counts, provenance, and coverage table;
- updates to the manifest header and referee comments that still name the old local `ARTEFACTS`;
- red-control checks: corpus quiz absent, laptop-only quiz present, and `export.ts`’s quiz write removed;
- an explicit admission that the “unknown filename” scan may still inspect scratch `data/`, if retained. That can remain a useful local discovery canary, but it is not commit-derived gate evidence.

Stage 2 is also too conceptually broad. Split “share the round-trip contract” from “redesign manifest classifications and evidence.” They touch related filenames but answer different questions—the same distinction the current plan risks erasing.