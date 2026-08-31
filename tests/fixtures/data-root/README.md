# `tests/fixtures/data-root/` — the committed fixture corpus

Five articles, 55 files, **1.13 MB**, tracked in git. This is the thing a fresh clone has been
missing: `data/` and `output/` are gitignored, and around nineteen test files plus the deploy gate
need an article that a fresh clone therefore does not have —
[260901b-committed-fixture-corpus.md](../../../docs/plans/260901b-committed-fixture-corpus.md).

The directory is called **`data-root`** because that is exactly what it is: the thing
`SPIDERYARN_DATA_ROOT` points at, with `data/` and `output/` hanging off it, the same shape
[`dataRoot()`](../../../src/store/data-root.ts) returns. The name is deliberately ugly, so that the
temporary coupling to the old filesystem-store layout is visible in the path rather than hidden
behind a friendlier word. When stage 4 finishes the database move, this layout is what changes.

> Ideally pick/truncate to create small files, unless we really need the occasional big file because
> we're testing performance/capacity. Let's tidy this up once and for all.
>
> — Greg, 2026-09-01

## What is *not* here, and why that is the important part

**No reader state was copied.** `chat.json`, `comments.json`, `searches.json`,
`glossary-lookups.json` and `shelf.json` under `data/` hold a real reader's questions, notes and
searches, and the model's answers to them — 92 KB of it for one article alone. None of it is derived
from public article text and none of it goes in git.

`writes` carries a hand-authored stand-in instead, written from the types in
[`src/types.ts`](../../../src/types.ts) and obvious about being fake. Two locks keep it that way:
[`build-corpus.ts`](build-corpus.ts) throws if asked to copy one of those five filenames, whatever a
whitelist says, and [`tests/fixture-corpus.test.ts`](../../fixture-corpus.test.ts) asserts on the
*committed bytes* that exactly one article carries any of them.

**No PDF.** The two large ones are already committed once, byte-identically, at
`evals/pdf/harder/source.pdf` and `evals/pdf/much-harder/source.pdf`. Point at those.

## The articles, and what each is here for

Membership was derived from the code — what a test *requires*, not how often a slug is mentioned or
how big it is. Every property in the right-hand column is asserted by
[`tests/fixture-corpus.test.ts`](../../fixture-corpus.test.ts), derived from the bytes rather than
kept as a second prose list that can drift from this one.

| Slug | Blocks | Size | Why it is here | The property it is kept for |
|---|---|---|---|---|
| `writes` | 19 | 96 KB | The load-bearing one. [`artefact-copy.test.ts`](../../artefact-copy.test.ts) hardcodes `SLUG = "writes"` with an explicit list of every file the store owns; [`deploy-checks.ts:574`](../../../scripts/deploy-checks.ts) uses the same set as the deploy gate's sentinels. Also [`helpers-load-article`](../../helpers-load-article.test.ts), [`helpers-seed-reader-state`](../../helpers-seed-reader-state.test.ts), [`store-block-roles-pg`](../../store-block-roles-pg.test.ts), [`store-export-raw`](../../store-export-raw.test.ts), [`pipeline-artifact-store`](../../pipeline-artifact-store.test.ts), and whichever article [`chat-anchor`](../../chat-anchor.test.ts) picks as the smallest that qualifies. | **≥ 19 blocks** (block-roles marks rows 16–18 as one note). **`labels.sourceHash` equals `hashBlocks(blocks)`**, or the publication gate refuses and every suite that asserts `published === true` fails. **`raw.json`'s `storedSha256` is the hash of `raw.html` beside it.** |
| `constitution` | 84 of 360 | 132 KB | The **negative fixture**, and the only sliced one. [`store-parity`](../../store-parity.test.ts) calls it `LEGACY_SLUG` and gives it its own block; [`store-roundtrip`](../../store-roundtrip.test.ts) excludes it and then asserts *why* it excluded it; `deploy-checks.ts:612` names `data/constitution/labels.json` as a gate sentinel. | **`labels.json` exists and has no `sourceHash`.** It was written before stage 4 recorded one, so `publishRevision` has nothing to check the table of contents against and correctly refuses. If this ever gains a stamp, retire the case — do not restore the file. store-parity says so in its own words. |
| `noema-…-conscious-ai` | 141 | 328 KB | [`store-parity`](../../store-parity.test.ts) names it `NO_FETCH_SLUG`; [`pipeline-artifact-store`](../../pipeline-artifact-store.test.ts) reads its `labels.json` by path. The corpus's only `sketch.json`. | **No `raw.json` at all, and a `meta.json` that still has `url` and `fetchedAt`.** Postgres reads those two from the columns stage 1 wrote and correctly has neither; the filesystem reads `meta.json` and has both. That asymmetry *is* the assertion, so an article with a manifest cannot stand in. |
| `openai-huggingface` | 95 | 176 KB | The only carrier anywhere in `data/` of **`quotes.json`, `timeline.json` and `assets.json`**. [`store-roundtrip`](../../store-roundtrip.test.ts) has a test whose whole job is to notice a corpus that has quietly stopped covering an artefact; without this slug three of its rows would assert only that the export invented nothing. | **Carries those three artefacts.** |
| `todo` | 10 | 28 KB | The smallest complete article there is, with **no arc, tweets, glossary or ideas** — so it is the fixture that exercises the *absent* branch of every "agrees about X, present or absent" row in store-parity. | **`raw.fetchedAt ≠ meta.fetchedAt`.** store-parity fails if no article in the corpus has the two clocks differ — otherwise dropping the field from its comparison would be free, and the day the two stores started disagreeing about it nothing would notice. `writes` has them equal, which is how tempting that is. |

`output/<slug>.html` and `output/<slug>.blocks.json` are committed for all five. Both halves or
neither: `copyArtefacts` refuses the whole `blocks` step when only one is there, so a corpus missing
one loses a *step* rather than a file, and the suites that assert `copied.length > 0` still pass.

## How real is each file?

The honest column, the way [`example/README.md`](../../../example/README.md) does it.

| Kind of file | How real | Which files |
|---|---|---|
| **Real, copied whole** | Genuine pipeline output, byte-identical to what the stage wrote. Small because the article was short, not because anything was cut. | Everything under `writes`, `todo`, `noema-…` and `openai-huggingface`, and the `output/` halves for those four. |
| **Real, sliced** | Genuine pipeline output cut at a clean semantic boundary — the article's first two top-level sections, ending at a real `<h2>`, the same technique `example/` uses. The tree is *pruned*, not rebuilt: kept nodes keep their own ids, ranges, titles and gists, and the root's range narrows to the last surviving block. `checkTree` — the same function `publishRevision` runs — is asserted over the result. | `constitution/{blocks,tree,labels}.json`, `output/constitution.{html,blocks.json}`. |
| **Synthesised** | Hand-authored from the types. Nothing produced these bytes. The block ids, quotes and offsets inside them *are* real, because `block_identities` has a format check and `comments_identity_fk` points at it — a comment on an invented id could not exist in Postgres, and the two stores would then disagree for a reason that is about the fixture. | `writes/{chat,comments,searches,glossary-lookups,shelf}.json`. |

Three things in the synthesised files are load-bearing, and each has a test that needs it:

- a thread with `kind: "review"` whose assistant message carries a `stance` — without one,
  store-roundtrip's review test warns and covers nothing, and `kind`/`stance` could vanish from
  `src/store/export.ts` with the round trip staying green;
- a comment anchored to **`zzzz00`**, which is not a `spya-` id. The seeder drops it and the
  filesystem store counts it, and that permitted difference is the one store-parity subtracts *by
  rule* rather than by a hardcoded number. With no such comment the rule is never exercised;
- a shelf entry with a real `opens` count and `lastOpenedAt`, neither of which `pgShelfStore.patch`
  can set — which is why `tests/helpers/seed-reader-state.ts` writes columns directly and says so.

### Files deliberately left out

- **`constitution`'s `arc.json`, `glossary.json` and `ideas.json`.** Each carries a `sourceHash` over
  the whole article, so keeping them beside sliced blocks would make all three stale — a fixture
  asserting something false about itself. Dropped rather than cut, and no test reads them for this
  slug. `fixture-corpus.test.ts` fails if one is ever copied back in.
- **`constitution`'s and `noema`'s `raw.html`.** Neither has a `raw.json` naming it, so nothing reads
  them; together they are 848 KB.
- **`openai-huggingface`'s `raw.json` *and* `raw.html`.** The pair goes together: the manifest is a
  reference, and `tests/helpers/load-article.ts` reads the file it names and rehashes it, so a
  manifest with no bytes beside it is the one thing that helper exists to refuse. The `raw.html` is
  219 KB of a Substack page's embedded configuration — public bytes with no credential and nothing of
  the reader's in them, but nothing any test reads either, and `writes` and `todo` already cover both
  clock cases. Without either, this article is simply a second one with no stage 1, which is a state
  the pipeline really produces.
- **`openai-huggingface`'s `summary.json`.** `writes` already covers that filename, which is all
  `store-artefact-manifest` needs it for.

## Using it

```ts
import { requireFixture } from "./helpers/require-fixture.js";

requireFixture("writes", ["blocks.json", "tree.json", "output.blocks.json"]);
```

At **module scope**, above the `describe`, and it **throws** rather than skipping — see
[`require-fixture.ts`](../../helpers/require-fixture.ts) for why that differs from
[`pg-ready.ts`](../../helpers/pg-ready.ts). Postgres may legitimately be absent; a file tracked in
git never can be. It parses each JSON part rather than stat'ing it, because `existsSync` waves
through a truncated file and the failure then surfaces three frames away inside the code under test.

There is deliberately **no global corpus check**: a focused unit test that never touches the corpus
must not be made to depend on it.

## What this does *not* yet do

**It does not make a bare `npm test` hermetic in an unprepared checkout**, and that is stated rather
than hidden. Around 76 test files compute their own root —
`const ROOT = path.resolve(import.meta.dirname, "..")` — and read the laptop's `data/` directly,
below the `SPIDERYARN_DATA_ROOT` override, which only redirects the store *adapters*. So do five
production readers: [`src/comments.ts:35`](../../../src/comments.ts),
[`src/chat.ts:51`](../../../src/chat.ts), [`src/searches.ts:50`](../../../src/searches.ts),
[`src/shelf.ts:45`](../../../src/shelf.ts) and [`src/api.ts:82`](../../../src/api.ts). Pointed at
this corpus, `loadComments("writes")` returns the laptop's eleven comments and not this fixture's
three — measured, not predicted, which is why `fixture-corpus.test.ts` checks the reader-state shapes
directly instead of through those loaders.

That sweep is deferred on purpose: stage 4 deletes both filesystem seams, and converting every test
now and again in a fortnight is the double migration this work exists to avoid
([260901b § What the review changed](../../../docs/plans/260901b-committed-fixture-corpus.md), point
4). What is finished here is the corpus itself, so that the deploy gate and worktree setup can
materialise `data/` + `output/` from tracked files rather than from somebody's laptop.

## Rebuilding it

```
npx tsx tests/fixtures/data-root/build-corpus.ts
```

**Provenance, not a build step.** Nothing runs it in CI and nothing depends on it at test time — the
committed bytes are the fixture. It exists so that "how was this file made?" has an answer you can
run rather than a paragraph you have to believe, and so that the one derived file set here is derived
by a program instead of by hand. It reads `data/` and `output/` and never writes to them, so it needs
a laptop that still has those five articles.
