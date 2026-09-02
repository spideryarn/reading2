/**
 * The JSON artefacts a `data/` → Postgres → `data/` round trip preserves exactly.
 *
 * ## Why this is written down rather than derived
 *
 * It looks like a list that ought to come from somewhere — from `HOMES` in
 * tests/store-artefact-manifest.test.ts, or from the exporter itself — and both
 * of those would be wrong.
 *
 * **Not from `HOMES`.** That list answers a different question: *where does this
 * filesystem concept live in Postgres?* So it carries `raw.html`, `raw.pdf` and
 * `raw.json` — the first two are bytes and the third is reconstructed rather
 * than preserved, and all three have purpose-built tests in
 * tests/store-roundtrip.test.ts instead. Deriving this list from those keys
 * would hand `raw.html` to a `JSON.parse` in `preserves %s exactly`. It also
 * carries names deliberately kept out of the round trip because no committed
 * article has one (the referee pair), and names whose file is retired
 * (`labels-progress.json`). ⟨Sol⟩, 2026-09-02, on the review of
 * docs/plans/260902g-corpus-evidence-for-artefact-coverage.md.
 *
 * **Not from the exporter.** A list computed from src/store/export.ts would
 * agree with the exporter by construction, which is the one thing a test of the
 * exporter must not do.
 *
 * So it is a deliberate, test-owned list: *these* JSON files go in, and the
 * same JSON must come back out. Adding a name here with no article in the
 * committed corpus carrying it is red — `fixture-corpus`'s "carries every
 * artefact the round trip claims to preserve" says so.
 *
 * ## Why it is shared
 *
 * It used to be written twice — once in tests/store-roundtrip.test.ts and once,
 * by hand, in tests/fixture-corpus.test.ts, whose copy is the corpus's
 * self-check that it covers everything the round trip claims. The two drifted:
 * `quiz.json` was added to the round trip and never to the copy, so the one
 * test whose entire job was catching that gap was structurally blind to it, and
 * the deploy gate went red with no commit in between.
 * docs/postmortems/260902c-a-test-whose-evidence-was-one-laptop.md.
 */

/**
 * Every JSON artefact the round trip must return unchanged.
 *
 * **No `summary.json`.** The `summary` artefact kind went with stage 5e on
 * 2026-08-31 (docs/plans/260831s-gist-only-summaries.md): the store does not own
 * the file, so neither half of the round trip can move it. The column was kept
 * and is carried between revisions — tests/store-carry-forward.test.ts asserts that —
 * but it does not come back out as a file, and the corpus still carries two
 * copies of the file for other reasons.
 */
export const ROUNDTRIP_JSON_ARTEFACTS = [
  "meta.json",
  "blocks.json",
  "tree.json",
  "assets.json",
  "arc.json",
  "tweets.json",
  "glossary.json",
  "ideas.json",
  "quotes.json",
  "timeline.json",
  "quiz.json",
  "sketch.json",
  "labels.json",
  "comments.json",
  "chat.json",
  "searches.json",
  "glossary-lookups.json",
  "shelf.json",
] as const;
