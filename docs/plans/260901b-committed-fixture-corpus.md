# One directory doing two jobs: splitting `data/` into scratch, fixtures and eval inputs

**Status, 2026-09-01: built and landed.** The corpus is committed and tracked — 57 files, 1.13 MB,
five articles under `tests/fixtures/data-root/`. The deploy gate materialises from it rather than
from a laptop, and **its `fixtures` check now passes without `--force-gate=test` for the first time**.

```
  the deploy gate's test failures, in a worktree with no laptop state
  ────────────────────────────────────────────────────────────────────
  before      50
  after        3      and each of the three is a defect the corpus exposed,
                      not a regression it caused
```

What shipped, in order: `5c503e5` the `.gitignore` anchor · `417dc1f` the corpus ·
`30e2b1b` the gate reading the commit rather than the laptop · `6b325c2`, `755264a`, `fe0e7cc` the
vacuous enumerators · `3b40441` the parity test that was passing on an archived shelf ·
`2258f87` the id defect and the README.

**The deferred half is deliberately still deferred.** The ~76 test files that compute their own
`ROOT/data` were not swept, so a bare `npm test` in an unprepared checkout is still not hermetic.
That was Greg's call on 2026-09-01, on the review's advice, because stage 4 of the store migration
deletes both filesystem seams and sweeping now would move the same files twice.

### What the corpus found, which is the point

Every remaining failure is the same species — **a test that was green because of something on one
laptop**, invisible until a checkout without that laptop's state ran it:

| | |
|---|---|
| `store-parity` ×2 | green because `data/constitution/shelf.json` carries `archivedAt` — Greg archived it on 2026-08-27, so the filesystem library never listed it and the comparison never met it. Fixed in `3b40441`. |
| `store-roundtrip` | the synthesised reader-state ids were `spya-fix…`; `src/ids.ts` excludes `i`, `l`, `o` and `1`, and Postgres enforces it as `chat_threads_id_format`. Fixed in `2258f87`. |
| `store-artefact-manifest` | `raw.pdf` and `labels-progress.json` read as unhomed, because the corpus carries neither. **Closed 2026-09-02** by [260902g](260902g-corpus-evidence-for-artefact-coverage.md) — but it widened first, to five names, and cost a production deploy with `--force-gate=test` before anyone looked. The fix was not a corpus example for each: it was that this test gathered its evidence from the laptop's `data/`, so the same commit answered differently on different machines. `labels-progress.json` is migrated-but-retired, `raw.pdf` still has no honest coverage and says so. |
| `doc-links` | `260828l-dictation-vocabulary-review-sol.md` links to `../../data/reader.json`, which is gitignored — so it resolves here and nowhere else. **Closed 2026-09-02**: the link is prose now, and `never link into gitignored runtime output` rejects the shape rather than waiting for the file to go missing ([260902g](260902g-corpus-evidence-for-artefact-coverage.md)). It broke twice more the same day from a different direction — Sol's `file:line` citations pasted in as markdown links — so the rule alone is not the whole answer. |

That last one is the tidiest illustration of the whole problem: `doc-links` was run four times during
this work and called green each time. It was green because the file it points at happens to exist on
this machine. [deployment.md](../project/deployment.md) had already named that exact seam — "the
`doc-links` test will accept a link into gitignored `output/`, which nobody else can follow" — and it
took a corpus to make it visible.

Two more surfaced late, both worth knowing before anyone runs the corpus suite:

- **`tests/statusline.test.ts`** ("names the git branch it is standing in") fails in a detached-HEAD
  worktree, which is what the gate builds. It arrived in `28abfdf` and belongs to that work, not this
  one — but it will fail the gate for everybody until it tolerates a detached HEAD.
- **`tests/pdf-bundle-trace.test.ts`** needs a build first. It passes *in* the gate, which runs
  `build` before `test`, and fails in a bare worktree run. Not a defect; a reason a bare run and the
  gate disagree.

### The gate links `.env.local`, so a corpus run writes into the laptop's database

[`deploy.ts:593`](../../scripts/deploy.ts) symlinks the real `.env.local` into the gate worktree —
"only the tests need the personal state, so only they get it". That state includes `DATABASE_URL`,
so **a gate run against the corpus writes corpus-derived reader state into the same local Postgres
the laptop uses.** Observed rather than predicted: after a corpus worktree run, a local
`store-parity` failed on `writes > agrees about glossary`, the filesystem holding Greg's real lookups
and Postgres holding the fixture's.

Nothing is lost — running `store-roundtrip` re-seeds and restores it — but it is surprising, and it
is one of the two honesty limits `deployment.md` now records rather than hides.

It also exposed a **cross-suite dependency the laptop's real data had always hidden**:
`store-parity` never seeds glossary lookups itself and depends on `store-roundtrip` having run first.
On a machine with a rich `data/` that is invisible, because the filesystem side always had lookups to
compare. Against a small corpus it is load-bearing, and it is the kind of ordering dependency that
makes a suite pass in one order and fail in another for reasons no failure message mentions.

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

## The measurement that was supposed to reframe the problem, and why it does not

An experiment was run and **it was invalid**. It is kept here in full, because the way it failed is
more instructive than the numbers were, and because the numbers were quoted onward before the flaw
was found.

The suite was run twice — against a clone of `data/`+`output/`, then against an empty directory —
through the `SPIDERYARN_DATA_ROOT` override that
`src/store/data-root.ts` documents as existing for exactly this
("for tests that want a scratch tree… without moving anything"). The real `data/` was not touched.

```
  FULL corpus    7171 tests    21 failed    157 skipped    14 failing files
  EMPTY corpus   7171 tests    34 failed    403 skipped    16 failing files
```

That looked like "an empty corpus costs 13 failures and 246 silent skips", and it looked corroborated,
because [`scripts/deploy.ts:592`](../../scripts/deploy.ts) records **13 failures** and 202
cascade-skips from what seemed to be the same situation.

**It is not the same situation.** `SPIDERYARN_DATA_ROOT` redirects the filesystem *adapters*, through
`fsLocations()` in `artifacts-fs.ts`. It does not redirect a test
that computes its own root — and the tests that matter most here all do:

```
tests/store-roundtrip.test.ts:48   const ROOT = path.resolve(import.meta.dirname, "..");
tests/artefact-copy.test.ts:55     const ROOT = path.resolve(import.meta.dirname, "..");
tests/store-parity.test.ts:109     const ROOT = path.resolve(import.meta.dirname, "..");
```

So the "empty" run was **split-brain**: the store adapters saw an empty corpus while the direct-path
readers went on reading the full laptop `data/`. A real clean checkout has both halves empty. The
fact that only two files newly failed is therefore evidence *of the split*, not evidence that only
two files need fixtures.

Two further reasons not to trust the numbers, both from the review:

- **`246 skipped` is not 246 pieces of lost coverage.** It bundles tests skipped after one `beforeAll`
  failed, Postgres-readiness skips, platform skips, and tests never reached because an earlier
  assertion in their file failed.
- **The 14 files failing in both arms cannot be waved away as Postgres contention** without comparing
  test ids and reasons. A failure common to both arms can mask a corpus failure lower in the same file.

The lesson is one already written down here: **agreement is not corroboration.** The rig reproduced
deploy.ts's "13" and that coincidence was taken as validation, when the two situations differ in
exactly the way that matters. [silent-success.md](../reusable/silent-success.md).

**What still stands**, on evidence that does not depend on this experiment: the deploy incident
recorded in `deploy.ts` itself, and the remote-box finding at
[260831x:445](260831x-remote-box-dev-environment.md) that ~19 test files need an article a fresh
clone lacks and that *"only two of the nineteen name the real problem"*. Those are direct
observations of a clean checkout, and they are why the conclusion survives its evidence being
withdrawn: **the failure mode is quiet, not loud.**

### The experiment worth running instead

Designed by the review, and it must happen before the corpus membership is fixed:

1. One clean worktree at one exact sha, physically adding and removing `data/`+`output/` there, so
   direct paths and store adapters see the same state.
2. `FULL → EMPTY → EMPTY → FULL`, repeated, against an isolated database or in a quiet period.
3. Diff **every test's status and skip reason** from the JSON output, never aggregate counts.
4. The ~19 implicated files alone first, then the whole suite, so interactions show up.
5. Remove one required fixture from the full arm and watch the intended guard turn red.

## Four workarounds, and a debt already written down

This is not a new problem and not a worktrees problem. It is an old defect that four pieces of work
have each stepped around:

| | |
|---|---|
| [`scripts/deploy.ts:592`](../../scripts/deploy.ts) | The gate worktree lacked both directories: "13 failures and 202 cascade-skips at every commit, so `--force-gate=test` became the only way anyone deployed. **An override that is required every time is not an override.**" |
| [hetzner-remote-server-box.md:225](../project/hetzner-remote-server-box.md) · [260831x:445](260831x-remote-box-dev-environment.md) | ~19 test files need an article a fresh clone does not have. "Worth fixing at the source; recorded rather than done, because Greg's call was to sync the fixtures and keep moving." Still open. |
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
  writes            148 KB    16 files. THE load-bearing one — artefact-copy.test.ts:56 hardcodes
                              it, and deploy-checks.ts:574 uses it as the gate's sentinel set
  constitution     1264 KB    the deliberate negative: labels.json with no sourceHash
  consciousness    2212 KB    lacks tree.json, so store-parity already skips it
  noema…            640 KB    the richest — 17 files including optional artefacts
  greatwork         284 KB    clean HTML article
  example              8 KB    reader state only (chat.json, shelf.json)
  article              4 KB    metadata only (meta.json)
  ────────────────────────
  ≈ 4–5 MB of text, against a 116 MB .git — and less once fixtures are cut to a
  clean seam rather than kept whole
```

**`writes` was missing from the first proposed membership**, which is the single most useful thing the
review found: the corpus as designed could not have fixed the very failure cited as the reason for
building it.

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

## The design, after review

A Fable design pass, then a devil's-advocate review by GPT Sol
([prompt](260901b-fixture-corpus-review-prompt.md) ·
[answer](260901b-fixture-corpus-review-sol.md)). The review's verdict was **revise before building**,
and it changed the design in four places. What follows is the reconciled version.

**The distinction to state everywhere, because readers will conflate them:** this preserves *tests
read files off disk*. It does **not** resurrect *the app reads files at runtime*, which stage 4
removes. Fixtures are inputs a test hands to code; they are not a store the application consults.

### What survived the review

- **A committed corpus, in `tests/fixtures/`.** Not the repo root. `SPIDERYARN_DATA_ROOT` accepts any
  directory, so root buys nothing, and `tests/fixtures/` is both where
  [deployment.md:213](../project/deployment.md) already says the debt lives and where
  `sketch-noema.json` already sits. Name the interim directory `tests/fixtures/data-root/` **so that
  the temporary coupling to the old store layout is visible in the path**, rather than hidden.
- **Scratch stays exactly as it is.** `data/` + `output/` remain gitignored and disposable. Renaming
  something scheduled for demolition is churn.
- **Evals keep `evals/*/fixtures/`.** The two big PDFs stay there and are pointed at, not copied —
  but through a neutral test helper rather than by importing an eval harness. "Exactly one committed
  copy" is worth enforcing for an 11 MB file and **is not a law worth building abstractions around
  for a 144 KB duplicate**.
- **Fixing the vacuous enumerators immediately.** `readdir(...).catch(() => [])` and every
  count-without-`toContain`.

### What the review changed

**1. `writes` is the corpus, and it was missing.** The proposed membership could not have repaired
its own headline failure: [`tests/artefact-copy.test.ts:56`](../../tests/artefact-copy.test.ts) is
`const SLUG = "writes"` with an explicit list of every file the artefact store owns, and
`scripts/deploy-checks.ts:574-614` hardcodes `data/writes/*` as the deploy gate's sentinels. `writes`
is 148 KB and sixteen files — small, complete, and load-bearing. It goes in first.

**2. Named slugs are not coverage.** Choosing fixtures by size, mention-count and broad state labels
is not "coverage by construction", it is the same accidental selection with better prose. A slug can
survive while the field it was retained *for* quietly disappears. So **each consuming suite asserts
its fixture's semantic precondition before asserting behaviour**, and those properties are derived
from the bytes rather than maintained as a second prose list that can drift. `constitution` is kept
only if something asserts the missing `sourceHash` it exists to represent.

**3. `readArticleFromDir` does not survive stage 4 — this plan said it did, and was wrong.** Both the
design pass and the first draft of this document claimed the migration "explicitly keeps" it.
[260831b:838](260831b-finish-the-database-move.md) puts it on the deletion list by name, along with
`dataRoot()`. So a `fixtureArticle()` that wraps it is built on a condemned foundation, and **"zero
new seam code" is not an advantage when the reused seam is scheduled for demolition**. The test-owned
loader should take a fixture-shaped contract — *load this recorded article bundle* — so that stage 4
can load the same bundle into Postgres without preserving production filesystem code.

**4. The 76-file sweep waits.** Converting every test's private `ROOT/data` now, and revisiting it
when stage 4 deletes both filesystem seams, is the double migration this work claims to avoid. The
smallest change that makes things honestly better:

1. Commit the exact required corpus, **including `writes`**, under `tests/fixtures/`.
2. Make the deploy worktree materialise `data/`+`output/` **from those tracked fixtures** rather than
   from personal laptop state. [`deploy.ts:614`](../../scripts/deploy.ts) already does the
   materialising; only its source changes.
3. Make worktree setup materialise the same tracked corpus.
4. Fix the vacuous enumerators.
5. Defer the helper conversion until stage 4 provides a durable target.

That makes the deploy gate honest and worktrees usable. **It does not make a bare `npm test` hermetic
in an unprepared checkout** — and the review is explicit that this trade-off must be stated rather
than hidden inside a `globalSetup`. If hermetic `npm test` is wanted immediately, the choice is to
accept the sweep now or bring stage 4 forward. That is Greg's call, not an implementation detail.

**5. Fail-closed at the consumption boundary, not globally.** A global `corpus-ready` throw makes a
focused unit test that never touches the corpus depend on it. Instead `requireFixture(slug, parts)`
in the suites that consume fixtures, plus one explicit failing test in each enumerating suite when
the required set is absent, with errors naming the missing slug, file and expected location.

### Truncation: Greg is right, with one qualification

This was the sharpest disagreement — Greg asked to "pick/truncate to create small files"; the design
pass refused outright. The review split it, and the split is convincing:

> Hand-cutting independently generated `blocks.json`, `tree.json`, labels, hashes, and reader state
> can manufacture an impossible article. That objection is valid. **It does not justify retaining
> whole articles.**

[`example/`](../../example/README.md) already demonstrates the compromise, and is the template: slice
at a clean semantic boundary, say in a README exactly which files are real and which derived, and
validate the result. Three techniques, in order of preference:

- **Regenerate ordinary fixtures from a deliberately short source.** Small *because the input was
  small*, so every byte is still pipeline-written.
- **Record one real pipeline run** for model-generated artefacts — never regenerate during a test.
- **Construct negative fixtures by a named mutation** from a valid small one. `constitution`'s missing
  `sourceHash` is deliberately not current pipeline output anyway, so "every byte must be
  pipeline-written" is the wrong standard for it.

The cost is one pipeline run, provenance notes and hash validation — modest against permanently
carrying megabytes for properties expressible in kilobytes. Keep something genuinely large **only
where size is the subject**, which here means the PDFs, already committed once.

### Ranked silent failures, from the review

1. Some tests read the temporary corpus while direct-path tests still read laptop `data/` — the flaw
   that invalidated the experiment above, now a permanent hazard until the sweep happens.
2. A required slug survives but loses the semantic feature it was retained for.
3. The curated corpus omits an artefact or block shape and the enumerating suites stay green.
4. A `globalSetup` makes the adapters hermetic while direct readers and writers stay shared.
5. A helper is introduced and several suites go on bypassing it.
6. A cross-link to an eval PDF breaks after a rename — lowest, because it fails loudly.

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
[hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md)'s "Known" bullet at 225, which this work closes.

## How to check you have not broken anything

The rule this whole investigation kept proving: **the corpus must be emptied on purpose and watched
turning the enumerating suites red.** A corpus guard that has only ever been green is not evidence
([silent-success.md](../reusable/silent-success.md)) — and here the specific danger is not a green
that should be red, but a *skip* that should be a run.
