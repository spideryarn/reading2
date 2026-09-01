# Adversarial review: splitting `data/` into scratch, test fixtures and eval resources

**You are asked to play devil's advocate.** Greg's instruction was a "devil's advocate adversarial
review". So argue the other side wherever there is one, and say plainly if the answer is "don't do
this, or don't do it now". A verdict of "this is mostly right" is fine only if you have genuinely
tried to break it first. Do not edit any files.

## The problem

`data/` (64 MB) + `output/` (11 MB) are gitignored and doing two jobs at once: the pipeline's
disposable scratch store, and the test suite's fixture corpus. Four separate pieces of work have hit
this and each worked around it:

1. `scripts/deploy.ts:592` — a gate worktree without them gave "13 failures and 202 cascade-skips at
   every commit, so `--force-gate=test` became the only way anyone deployed. An override that is
   required every time is not an override."
2. `docs/project/remote-box.md:225` and `docs/plans/260831x-remote-box-dev-environment.md:445` — ~19
   test files need an article a fresh clone does not have; "recorded rather than done, because
   Greg's call was to sync the fixtures and keep moving". Still open.
3. `gjd-remote doctor` proves the browser stack with a committed smoke script rather than the suite,
   because the box cannot run the suite from a clean checkout.
4. `docs/plans/260828r-worktrees.md` — every git worktree would need a 75 MB copy.

And `docs/project/deployment.md:213` already names the intended fix: *"The debt is a small committed
fixture corpus under `tests/fixtures/`"*.

## My measurement, which you should attack first

I cloned `data/`+`output/` to scratch and ran the full suite twice via `SPIDERYARN_DATA_ROOT`
(`src/store/data-root.ts:81`), once against the full corpus and once against an empty one:

```
FULL corpus    7171 tests   21 failed   157 skipped   14 failing files
EMPTY corpus   7171 tests   34 failed   403 skipped   16 failing files
```

So an empty corpus costs **13 extra failures and 246 extra silent skips**, and only two files go red
that were not already red (`tests/artefact-copy.test.ts`, `tests/store-roundtrip.test.ts`). I claim
this reproduces deploy.ts's documented "13 failures and 202 cascade-skips" and therefore validates
the rig.

**Attack this.** Is a two-run diff on a machine with ~20 other agent sessions hammering one shared
Postgres sound evidence? 14 files failed in *both* runs — if the tree is that noisy, what does the
delta actually establish? Does "246 tests skipped" mean 246 tests lost coverage, or are some of them
skipping for unrelated reasons? What would a stronger experiment have been?

## The proposed design (from a Fable-model design pass)

- **`fixtures/` at the repo root, committed, shaped as a literal data-root** — `fixtures/data/<slug>/`
  and `fixtures/output/…` — so the existing `SPIDERYARN_DATA_ROOT` seam reaches it with **zero new
  seam code**.
- **Scratch `data/` + `output/` stay exactly as they are**, gitignored, until stage 4 of the store
  migration demolishes them.
- **Evals keep `evals/*/fixtures/`.** One rule: *bytes live in exactly one committed place, and the
  other suite points at it by a named path constant.* Concretely `fixtures/` never holds a
  `raw.pdf`; a test needing ball-lightning's bytes reads the byte-identical committed
  `evals/pdf/harder/source.pdf`.
- **Corpus membership v1:** `example`, `article` (both tiny), `greatwork` (284 KB), `noema` (640 KB),
  `constitution` (1.26 MB, kept deliberately as the *negative* fixture — no `sourceHash`, the article
  the publication gate refuses), maybe `consciousness` (2.2 MB). Total ~4–5 MB of text.
- **Two seams:** a vitest `globalSetup` copies `fixtures/` to a per-run temp dir and points
  `SPIDERYARN_DATA_ROOT` at it (hermetic, writable, and these store-shaped tests die at stage 4
  anyway); plus a `fixtureArticle(slug)` helper wrapping `readArticleFromDir`, which the migration
  plan explicitly preserves past stage 4.
- **`tests/helpers/corpus-ready.ts`** modelled on the existing `pg-ready.ts` (used by 47 files) but
  **throwing rather than skipping** — the argument being that Postgres may legitimately be absent
  while a committed fixture never can be, so a miss is a broken checkout, not a reason to opt out.
- **Named must-have assertions** on every enumerating suite, because seven suites `readdir` the
  corpus rather than naming slugs and go quiet rather than red when it shrinks.
- **Migration path:** (1) commit the corpus + `corpus-ready`; (2) point the deploy gate at it and
  watch it pass *without* `--force-gate=test` for the first time; (3) mechanically sweep ~76 test
  files that compute their own `ROOT/data` onto one helper; (4) prune scratch with Greg's sign-off;
  (5) stage 4 inherits it.

## Verified facts you can rely on

- `readdir(...).catch(() => [])` at `tests/store-artefact-manifest.test.ts:215,256,267` — an absent
  `data/` makes that suite pass having checked nothing. A live vacuity bug.
- `data/ball-lightning/raw.pdf` is byte-identical (sha256) to the committed
  `evals/pdf/harder/source.pdf`; `data/fowler-phrenology/raw.pdf` to `evals/pdf/much-harder/source.pdf`.
  Four slugs share one identical 144 KB PDF.
- `example/` is already committed — 76 KB, a real article sliced to "a clean seam" with a README
  saying how real each file is. `tests/fixtures/sketch-noema.json` (20 KB) is already committed too.
- `data/example` is 8 KB (`chat.json`, `shelf.json`) and `data/article` is 4 KB (`meta.json`) — the
  high mention-counts for those slugs are mostly tests constructing them, not reading them.
- Stage 4 of `docs/plans/260831b-finish-the-database-move.md` deletes `src/store/data-root.ts`
  **entirely**, along with the fs adapters and `raw_bytes`. The session that owns it says the plan
  "does NOT have an answer for what the tests read after stage 4 — it names that as the biggest
  unsolved chunk and stops."

## What I most want you to attack

1. **Should this be done at all, now?** Stage 4 will rewrite the deploy-gate copying and delete the
   fs store regardless. Is committing a filesystem-shaped corpus days before the filesystem store is
   deleted building on a condemned foundation? Make the case for *waiting* and doing it once, inside
   stage 4. Then make the case against waiting. Which is stronger?
2. **`fixtures/` at root versus `tests/fixtures/`.** The design says root; `deployment.md:213` — the
   written debt — says `tests/fixtures/`, which already exists and already holds a committed fixture.
   Is the root location justified by "it must be a data-root", or could `tests/fixtures/data/` serve
   identically with less repo-root clutter and consistency with what is written down?
3. **A direct contradiction of Greg's instruction.** Greg said: *"Ideally pick/truncate to create
   small files, unless we really need the occasional big file because we're testing
   performance/capacity."* The design refuses to truncate, arguing that "a truncated `blocks.json`
   is a fixture the pipeline never wrote" and that truncation manufactures corpus drift on day one.
   Who is right? Is there a way to have both — e.g. regenerate from a shorter *source* so the
   artefact is genuinely pipeline-written but small? What does that cost?
4. **"Coverage by construction" versus accidental richness.** The design replaces "every article on
   this laptop" with four or five deliberately chosen states, calling that a stronger matrix. Is that
   true, or is it a rationalisation for losing coverage? What would be lost that nobody would notice?
5. **`corpus-ready` throwing rather than skipping.** Is fail-closed right? What breaks — a fresh
   clone doing a partial checkout, a shallow clone, someone running one test file, CI on a machine
   with an LFS-less checkout?
6. **The ~76-file sweep.** That is the bulk of the labour and the likeliest place to introduce
   silent breakage. Is there a way to get most of the benefit without it? What is the smallest change
   that makes the deploy gate pass honestly and lets a worktree run the suite?
7. **What in this design fails silently**, ranked. Assume we will get one thing wrong; which one
   costs most and shows least?

Return a verdict — proceed / revise before building / don't do this yet — then findings ordered by
cost × silence. Be specific about which claim is weakest.
