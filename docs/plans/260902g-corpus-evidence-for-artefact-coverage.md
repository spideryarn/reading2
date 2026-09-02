# The gate that asked one laptop whether an artefact exists

**Status, 2026-09-02: planning.** Written after a production deploy that needed `--force-gate=test`.

## What happened

`3efd70e` shipped to `main` on 2026-09-02 with the `test` gate forced. Reproduced in a worktree set
up exactly as the gate does — corpus materialised, `.env.local` linked, `build` run first — the gate
sees **four genuine failures**, all deterministic:

| Test | What it says |
|---|---|
| `statusline` › names the git branch it is standing in | `git rev-parse --abbrev-ref HEAD` returns the literal `"HEAD"` in a detached worktree |
| `doc-links` › point at files that exist | `260828l-dictation-vocabulary-review-sol.md` links to `../../data/reader.json`, which is gitignored |
| `store-artefact-manifest` › does not list artefacts that no longer exist anywhere | `raw.pdf`, `labels-progress.json`, `quiz.json`, `referee-criteria.json`, `referee-claims.json` |
| `store-roundtrip` › has at least one article carrying each artefact it claims to preserve | `quiz.json` |

Two more failed in a bare `npm test` and are not gate reds: `load-article-serialisation` (a local
Storage 500 under parallel load — passes in isolation) and `pdf-bundle-trace` (needs `build` first,
which the gate runs).

**The first one matters most and was not on anyone's list.** The gate always builds its worktree with
`git worktree add --detach`, so `statusline` fails on *every gate run, at every commit*. The gate has
been structurally unpassable since that test arrived in `28abfdf` on 2026-09-01.

It did not *start* the forcing habit, and an earlier draft of this plan said it did.
[deployment.md](../project/deployment.md) records the origin: the gate's first day materialised
`data/` but not `output/`, giving 13 failures at every commit, and `--force-gate=test` became the only
way anybody deployed. This test kept the gate red **after** that was fixed, so the habit outlived its
cause — which is why the other three reds could sit there unread.

## The mechanism behind the artefact reds

`tests/store-artefact-manifest.test.ts` owns `HOMES` — 24 artefact filenames mapped to where each
lives in Postgres — and asserts every name has an example file *somewhere*. It gathers "somewhere"
from the developer's gitignored `data/` and from `example/` — **never from the tracked corpus**
(`:416`). So the verdict is a function of one machine's working directory at one moment:

1. `b7b7aa5` registered the quiz step and parked `quiz.json` in `NOT_YET_WRITTEN`, the escape hatch
   for "a step too new to have produced an example".
2. The quiz work generated a real quiz into `data/fowler-phrenology` so its stage 4 had something to
   look at in a browser. The "an exemption that has arrived must be deleted" check duly fired.
3. `1c441ab` deleted the exemption — **correct by the rules as written**. The file had arrived. But
   it arrived in a gitignored directory, and the tracked corpus never gained one.
4. `0606e0d` gave `referee-claims.json` a home in `HOMES` on the same kind of evidence.
5. That quiz file has since gone. Nobody edited a line of code; the gate simply started failing.

The exemption-clearing check is **structurally incapable** of asking whether the tracked corpus got an
example, because it never reads the tracked corpus at all.

There is a second copy of the problem: `store-roundtrip.test.ts`'s `ARTEFACTS` (`:60-84`, 18 entries)
includes `quiz.json`; `fixture-corpus.test.ts` keeps its **own** hand-maintained `ARTEFACTS`
(`:426-444`, 17 entries) for the self-check whose entire job is "the tracked corpus covers everything
the round trip claims to preserve" — and that copy never gained `quiz.json`. The one test that exists
to catch this gap is blind to it, because the list was written down twice.

## The class

**A gate whose evidence lives outside the commit.** The check reads a directory that is not tracked,
so the same commit is green on the machine that happened to produce a file and red everywhere else,
and it flips without anyone touching code. `doc-links` is the same class in a different costume — a
plan doc linking into gitignored `data/` resolves on one laptop and nowhere else. The 2026-09-01
corpus plan already named the class and marked two instances **Open**; it deferred the fix, on
review advice, to stage 4 of the store migration.

Postmortem: [260902c-a-test-whose-evidence-was-one-laptop.md](../postmortems/260902c-a-test-whose-evidence-was-one-laptop.md).

## Stages

Ordered so that **each one ends green**, which the first draft of this plan did not: it made every
uncovered artefact red in stage 2 and did not add the quiz fixture until stage 3, so stage 2 could
only finish red. The quiz fixture now lands before the enforcement that needs it. GPT Sol,
[review](260902g-plan-review-sol.md).

**Stage 1 — the postmortem and this plan.** [260902c](../postmortems/260902c-a-test-whose-evidence-was-one-laptop.md).
It comes first because the plan links to it, and `doc-links` rejects a dangling target — committing
the plan alone would be a fresh instance of the very class. Done = `npx vitest run tests/doc-links.test.ts`
green.

**Stage 2 — make the gate passable at all.** Two blockers, unrelated to each other and to the corpus:

- `statusline` — the **script is right and the test is wrong**. `provision.sh:621` already does
  `git symbolic-ref --short HEAD || git rev-parse --short HEAD`, so it prints a short sha and the
  worktree name when detached, which beats printing `HEAD`. The test derives its expectation with
  `git rev-parse --abbrev-ref HEAD` in whatever checkout it is standing in. Replace that with a
  temporary git repository and two explicit cases — attached → branch name, detached → short sha —
  so the test asserts the contract rather than the environment.
- `doc-links` — fix `260828l-dictation-vocabulary-review-sol.md`'s link into gitignored
  `data/reader.json`, and **ban the pattern**: three further links (`performance.md:187`,
  `content-extraction.md:78`, `open-questions.md:16`) point into `data/`/`output/` and resolve today
  only because the corpus happens to carry those slugs. A link nobody else can follow should fail as
  a link, not as luck.

Done = both red first, then green, and the gate's `test` step no longer fails for reasons unrelated
to what is being deployed.

**Stage 3 — a real `quiz.json` in the corpus.** Generate one with the real step against an unsliced
corpus slug (`writes`), add `"quiz.json"` to that slug's list in
`tests/fixtures/data-root/build-corpus.ts`, re-run the builder, commit the bytes. Measure its size
first and say so; a normal quiz should sit beside the existing 18–20 KB `timeline`/`sketch` artefacts,
and trimming would make its `dropped` metadata dishonest.

Real model output rather than a hand-written literal, but **provenance is not validation** — the
store's own check (`src/store/artifacts.ts:270`) proves only that `questions` is a non-empty array. So
the fixture gets assertions of its own: `sourceHash === inputFingerprint(committed blocks, tree, meta)`,
every evidence block id exists, every evidence quote and start point resolves in that block, the slug
matches, questions non-empty. Note the hash covers **blocks, tree and selected metadata**
(`src/quiz.ts:215`, `src/source-hash.ts:338`), and hashes semantic fields rather than raw
`blocks.json` bytes — the first draft of this plan had that wrong.

Done = the round trip proves `export.ts:443` writes `quiz.json`, which nothing else does.

**Stage 4 — one round-trip list, not two.** `store-roundtrip.test.ts`'s `ARTEFACTS` and
`fixture-corpus.test.ts`'s own copy have already drifted, and that drift is why the corpus self-check
was blind to `quiz.json`. Lift an explicit `ROUNDTRIP_JSON_ARTEFACTS` into a test helper and import it
from both.

**Not derived from `HOMES`.** The two lists answer different questions — `HOMES` is "where does this
filesystem concept live in Postgres", `ARTEFACTS` is "which JSON files does the export preserve
exactly" — and `HOMES` carries `raw.html`, `raw.pdf` and `raw.json`, which are bytes or are
reconstructed rather than preserved. Deriving mechanically would feed `raw.html` to a JSON parser at
`store-roundtrip.test.ts:558`. Done = one list, two importers, and adding a JSON artefact to it
without a corpus example is red everywhere.

**Stage 5 — the manifest's classifications and its evidence.** Separate from stage 4: related
filenames, different question.

- Make the **stale** check and the exemption **arrival** check read the tracked corpus only. This is
  the actual root fix.

**Work from the gate's list, not this laptop's — they differ, which is the whole point.** After
stage 3, `npx vitest run tests/store-artefact-manifest.test.ts` on Greg's machine names two:
`referee-criteria.json`, `referee-claims.json`. The gate names **four**: those two plus `raw.pdf` and
`labels-progress.json`, because there `data/` *is* the corpus and the laptop's own copies of those two
are not there to cover for them. Stage 3's report read the shorter list as "`raw.pdf` and
`labels-progress.json` have dropped off", and they had not — they were never on the laptop's list.
Anyone sizing stage 5 from a local run will build for half the problem.
- Keep a narrowly named `PENDING_CORPUS_EXAMPLE` rather than deleting the escape hatch outright.
  Removing it entirely sounds principled but recreates the forced-gate habit: registration and the
  first real generation legitimately land in separate commits, and with no deterministic pending
  state the next person forces the gate instead. Entries carry a reason and a plan reference.
- `raw.pdf` goes in `PENDING_CORPUS_EXAMPLE`, **not** in a "covered elsewhere" list. The existing PDF
  tests check `rawFileName` directly rather than an end-to-end `exportArticle`
  (`store-roundtrip.test.ts:769`), and `store-export-raw.test.ts:64` uses `writes`, whose source is
  `raw.html` — so a mutation making `writeRawDocument` always write `raw.html` would evade the
  exemption. Claiming coverage we do not have is how this started.
- `labels-progress.json` gets its own classification, **not** `NOT_MIGRATED`. Its contents *are*
  migrated, to `checkpoints`; only the file is retired. `NOT_MIGRATED` means "we decided not to", and
  recording a false decision there is the same rot in a new list.
- Once the evidence is corpus-only, `seen` versus `outsideFixtures` stops earning its keep — the
  tracked corpus has no concurrent `data/test-*` fixtures — so delete the generous scan and the
  ENOENT race handling that existed for a mutable shared `data/`.

Each change gets a red control: corpus quiz absent, laptop-only quiz present, and `export.ts`'s quiz
write removed.

**Stage 6 — the docs and the proof.** Update the corpus README's membership, counts and coverage
table; the manifest header and referee comments that still name the local `ARTEFACTS`; and 260901b's
status table, since two of its "Open" rows close here. Then run `npm run deploy -- --dry-run` and show
the `test` gate green **without** `--force-gate`. Done = the gate passes on its own.

## What this deliberately does not do

**The 76-file sweep stays deferred.** Greg decided on 2026-09-01, on review advice, not to convert
every test that computes its own `ROOT/data`, because stage 4 of the store migration deletes both
filesystem seams and sweeping now moves the same files twice. Nothing here reopens that. Only three
files enumerate the whole of `data/` (`store-artefact-manifest`, `store-roundtrip`, `store-parity`),
and this plan changes *what two of them judge against*, not how the other ~20 resolve their own
scratch slugs.

**`store-parity` is left alone, and it stays non-hermetic.** It is the third whole-directory
enumerator (`:243`). Do not let the earlier draft's wording stand: a laptop's `data/` can change its
verdict, not merely make it do more work — it enumerates every complete article in a mutable `data/`
and then runs behavioural comparisons over exactly those slugs. It is deterministic *in the gate*
only because the detached worktree starts clean and materialises the tracked corpus
(`scripts/deploy.ts:656`). Leaving it is Greg's 2026-09-01 deferral, described honestly rather than
explained away.

## The simpler option, and why not

**Put the three names back in `NOT_YET_WRITTEN` and move on.** Two lines, gate green. Rejected: the
exemption list is the mechanism that failed, and re-arming it leaves the next artefact one deleted
file away from the same forced deploy. Its three uses each lasted a few hours and the third one is
this incident. What replaces it is a permanent list that says *why* a name has no corpus example and
which test covers it instead — a decision, not an IOU.
