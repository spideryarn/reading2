# One directory doing two jobs: splitting `data/` into scratch, fixtures and eval inputs

**Status, 2026-09-01: design under adversarial review. Nothing built, nothing moved.**

`data/` (64 MB) and `output/` (11 MB) are gitignored and doing two jobs at once — the pipeline's
disposable scratch store, and the test suite's fixture corpus. That is why the directory is
simultaneously too big to commit and too necessary to delete, and why four separate pieces of work
have each hit it and each worked around it rather than fixing it.

> I'm really hoping that we can either make `data/` completely superfluous (i.e. not needed, no big
> deal if it's missing), or if it really is important (e.g. for evals) then commit it to the repo.
>
> — Greg, 2026-08-31

> Separate out the stuff that's scratch (which should be gitignored, and not needed), resources for
> test fixtures (which should be stored in its own place), resources for evals (which might perhaps
> draw on the test fixtures to be parsimonious), etc. Ideally pick/truncate to create small files,
> unless we really need the occasional big file because we're testing performance/capacity. Let's
> tidy this up once and for all.
>
> — Greg, 2026-09-01

Both of Greg's wishes are reachable, but only by separating the two jobs. Neither is reachable while
one directory does both.

## The measurement that reframes the problem

The suite was run twice, against a clone of `data/`+`output/` and against an empty directory, through
the `SPIDERYARN_DATA_ROOT` override that [`src/store/data-root.ts`](../../src/store/data-root.ts)
documents as existing for exactly this ("for tests that want a scratch tree… without moving
anything"). The real `data/` was not touched.

```
  FULL corpus    7171 tests    21 failed    157 skipped    14 failing files
  EMPTY corpus   7171 tests    34 failed    403 skipped    16 failing files
```

Deleting the entire 75 MB costs **13 extra failures and 246 extra skips**, and only two files go red
that were not already red (`tests/artefact-copy.test.ts`, `tests/store-roundtrip.test.ts`).
[`scripts/deploy.ts:592`](../../scripts/deploy.ts) records "13 failures and 202 cascade-skips" from
the same situation, so the rig reproduces the documented number.

**The failures were never the problem. The 246 skips are.** A corpus that quietly shrinks does not
go red; it goes quiet, and a quarter of a thousand tests stop running while the reporter still looks
broadly fine. That is the same shape as `db:migrate` printing `✓ migrations applied` while applying
nothing ([database.md](../project/database.md)), and it makes **the declared inventory the first
design problem and the size the second**.

Fourteen files fail with the full corpus too. Those are pre-existing, mostly Postgres contention
from the twenty-odd other sessions in this tree, and are not ours.

## Four workarounds, and a debt already written down

This is not a new problem and not a worktrees problem. It is an old defect that four pieces of work
have each stepped around:

| | |
|---|---|
| [`scripts/deploy.ts:592`](../../scripts/deploy.ts) | The gate worktree lacked both directories: "13 failures and 202 cascade-skips at every commit, so `--force-gate=test` became the only way anyone deployed. **An override that is required every time is not an override.**" |
| [remote-box.md:225](../project/remote-box.md) · [260831x:445](260831x-remote-box-dev-environment.md) | ~19 test files need an article a fresh clone does not have. "Worth fixing at the source; recorded rather than done, because Greg's call was to sync the fixtures and keep moving." Still open. |
| `gjd-remote doctor` | Proves the browser stack with a committed smoke script rather than the suite, because the box cannot run the suite from a clean checkout. |
| [260828r-worktrees.md](260828r-worktrees.md) | Every git worktree would need a 75 MB copy of gitignored data. This is what brought it to a head. |

And the fix already has a name. [deployment.md:213](../project/deployment.md):

> The debt is a small committed fixture corpus under `tests/fixtures/`.

## The pattern already exists here, three times, in miniature

Worth knowing before designing anything, because none of this is greenfield:

- **[`example/`](../../example/README.md)** — 76 KB, committed, read by twelve test files. A real
  article's first 34 blocks, cut deliberately: "a clean seam: a self-contained argument with real
  heading structure, rather than an arbitrary cut". Its README carries a table saying **how real each
  file is** — `blocks.json` real, `tree.json` placeholder, `labels.json` derived — and is honest about
  `batches: null` meaning "no call produced these" where `[]` would have claimed a run of zero calls.
  This is the model for everything below.
- **`tests/fixtures/sketch-noema.json`** — 20 KB, committed, a copy of a real artefact.
- **`evals/extraction/fixtures/`** (7.8 MB, 33 files) and **`evals/pdf/{easy,harder,much-harder}/`** —
  small committed inputs with licence files, already self-contained.

So the discipline Greg is asking for is one this repo already invented and then stopped applying.

## What is actually in `data/`, measured

The first sizing of this was wrong and the correction matters. Counting how often a slug is
*mentioned* in `tests/` overstates it badly — `data/example` is mentioned 104 times and is **8 KB**
(`chat.json`, `shelf.json`); `data/article` is mentioned 76 times and is **4 KB** (`meta.json`).
Most of those mentions are tests constructing the slug, not reading it.

```
  constitution     1264 KB    the deliberate negative: labels.json with no sourceHash
  consciousness    2212 KB    lacks tree.json, so store-parity already skips it
  noema…            640 KB    the richest — 17 files including optional artefacts
  greatwork         284 KB    clean HTML article
  example              8 KB
  article              4 KB
  ────────────────────────
  ≈ 4–5 MB of text, against a 116 MB .git
```

**The two big PDFs are already committed.** `data/ball-lightning/raw.pdf` is byte-identical (sha256
`18d0d66a…`) to `evals/pdf/harder/source.pdf`, and `data/fowler-phrenology/raw.pdf` to
`evals/pdf/much-harder/source.pdf`. Four further slugs — `source`, `coolabah-memory`,
`revistes-ub-30977`, `source-2` — hold four copies of one identical 144 KB PDF. So the 11 MB that
made this look expensive is duplication, not content.

Everything else in `data/` — twenty-odd unreferenced slugs, a 25 MB `_ai-calls.test.jsonl`,
`_blobs`, `_jobs`, `_uploads` — is churn no test asks for.

## A live bug found on the way

[`tests/store-artefact-manifest.test.ts:215`](../../tests/store-artefact-manifest.test.ts), and again
at 256 and 267:

```js
const files = await readdir(path.join(ROOT, "data", entry.name)).catch(() => []);
```

An absent `data/` yields `[]` and the suite passes having checked nothing. This is the suite whose
whole job is to notice a new artefact filename arriving, and it is the one most likely to "still look
busy while testing nothing" — the store-migration session's own assessment.

## The proposed design

From a Fable design pass, **currently under adversarial review by GPT Sol**
([prompt](260901b-fixture-corpus-review-prompt.md)) — do not build from this section until that lands.

**The distinction to state everywhere, because readers will conflate them:** this preserves *tests
read files off disk*, which is fine forever and which the store-migration plan explicitly keeps
(`readArticleFromDir` is "the one filesystem read left"). It does **not** resurrect *the app reads
files at runtime*, which stage 4 removes. Fixtures are inputs a test hands to code; they are not a
store the application consults.

- **A committed corpus shaped as a literal data-root** — `<root>/data/<slug>/`, `<root>/output/…` —
  so the existing `SPIDERYARN_DATA_ROOT` seam reaches it with **zero new seam code**. *Location is
  contested: Fable says `fixtures/` at the repo root; the written debt and the existing
  `sketch-noema.json` say `tests/fixtures/`.*
- **Scratch stays exactly as it is.** `data/` + `output/` remain gitignored and disposable. Renaming
  something scheduled for demolition is churn.
- **Evals keep `evals/*/fixtures/`,** under one rule rather than one directory: **bytes are committed
  in exactly one place, and the other suite points at them by an exported path constant** — so the
  coupling has a name and breaks loudly. `fixtures/` never holds a `raw.pdf`.
- **Coverage by construction, not hoarding.** Choose slugs to represent states deliberately: one
  clean HTML article, one PDF-sourced, one carrying the optional artefacts, and `constitution` frozen
  as the negative case the publication gate refuses. Write the state list in the corpus README.
- **`tests/helpers/corpus-ready.ts`**, modelled on the existing
  [`pg-ready.ts`](../../tests/helpers/pg-ready.ts) (47 files use it) but **throwing rather than
  skipping**: Postgres may legitimately be absent, a committed fixture never can be. Assert per slug
  that each needed file exists **and parses**, because `existsSync` waves through a truncated file.
- **Named must-have assertions on every enumerating suite.** Seven suites `readdir` the corpus rather
  than naming slugs — `store-artefact-manifest`, `store-guarded`, `jobs`, `glossary-lookups`,
  `parse-json`, `ai-call`, `auth-users-fence` — and go quiet rather than red when it shrinks.

### The open tensions, handed to the review rather than settled

1. **Fable contradicts Greg directly on truncation.** Greg asked to "pick/truncate to create small
   files"; Fable refuses, arguing a truncated `blocks.json` is a fixture the pipeline never wrote and
   manufactures corpus drift on day one, and that shrinking should be done by regenerating from a
   shorter *source*. Both positions are reasonable and the review is asked to settle it.
2. **`fixtures/` versus `tests/fixtures/`** — see above.
3. **Whether to do this now at all.** Stage 4 of
   [260831b-finish-the-database-move.md](260831b-finish-the-database-move.md) deletes the filesystem
   store, `src/store/data-root.ts` included, and already commits to rewriting the deploy gate's copy
   step "because after it there is no `output/` to be missing". Committing a filesystem-shaped corpus
   days before the filesystem store dies deserves the argument for waiting to be made properly.

## Coordination

Agreed with the session that owns the store migration, 2026-08-31:

> the plan does NOT have an answer for what the tests read after stage 4 — it names that as the
> biggest unsolved chunk and stops. So design it once, and design it yours.

- Stage 4 is **not** starting tonight, and stage 2.5 turned out to need verification rather than a
  refetch, so it is not the moment to wait for.
- **`src/store/data-root.ts` is on stage 4's deletion list**, so the corpus seam must not be built
  into it. `tests/helpers/` survives.
- This work will not touch `drizzle/`, will not run `drizzle-kit generate`, and will not touch
  `scripts/deploy-checks.ts` (whose `migrationState`/`ledgerDivergence` moved to
  `scripts/migration-ledger.ts`).
- `scripts/deploy-checks.ts:574-614` holds the hardcoded sentinel list that is today's ground truth
  for "a healthy fixture set". It has to be rewritten to match whatever lands — and stage 4 plans to
  touch the same file, so whoever goes second must know.

## Docs that will need updating

Found by survey, not guessed: [deployment.md](../project/deployment.md) §"the gate needs both halves"
(190-214), [testing.md](../project/testing.md) (195-215, 320-345, 504-525),
[architecture.md](../project/architecture.md) (125-326),
[database.md](../project/database.md) (41-88), [setup-dev.md](../project/setup-dev.md) (363-366,
454-458), [supabase-local.md](../project/supabase-local.md) (line 7), `evals/README.md`, and
[remote-box.md](../project/remote-box.md)'s "Known" bullet at 225, which this work closes.

## How to check you have not broken anything

The rule this whole investigation kept proving: **the corpus must be emptied on purpose and watched
turning the enumerating suites red.** A corpus guard that has only ever been green is not evidence
([silent-success.md](../reusable/silent-success.md)) — and here the specific danger is not a green
that should be red, but a *skip* that should be a run.
