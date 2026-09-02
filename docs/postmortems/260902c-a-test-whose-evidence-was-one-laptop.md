# A test whose evidence was one laptop

**2026-09-02.** `3efd70e` shipped to production with `--force-gate=test`. Four tests were red in the
deploy gate's clean worktree. None was a regression from that day's work; two had been true since
2026-09-01, and one had been true at *every commit* for longer than that.

## The class

**A check whose evidence lives outside the commit.**

The check reads a directory that git does not track, so its verdict is a property of one machine at
one moment rather than of the code. It goes green when somebody happens to produce a file, and red
later when that file is deleted — with no commit in between, and nobody to attribute it to. It is
[silent-success.md](../reusable/silent-success.md) in its reporting form: the check agreed with the
code because both were reading the same laptop.

The tell is that the check and the thing it checks share a source of truth that the repository does
not own.

## What actually happened

`tests/store-artefact-manifest.test.ts` maps 24 artefact filenames to where each lives in Postgres
(`HOMES`) and asserts every name still has an example file somewhere. It gathers "somewhere" from the
developer's gitignored `data/` and from `example/` — **never from the tracked corpus at
`tests/fixtures/data-root/`** (`:416`).

1. `b7b7aa5` registered the quiz step and parked `quiz.json` in `NOT_YET_WRITTEN`, the escape hatch
   for "a step too new to have produced an example".
2. The quiz work generated a real quiz into `data/fowler-phrenology` so its browser pass had
   something to look at. The paired assertion — "an exemption whose file has arrived must be deleted"
   — duly fired.
3. `1c441ab` deleted the exemption. **Correct by the rules as written.** The file had arrived. But it
   had arrived in a gitignored directory, and the tracked corpus never gained one.
4. `0606e0d` gave `referee-claims.json` a home in `HOMES` on the same kind of evidence.
5. `data/fowler-phrenology/quiz.json` has since gone. Nobody edited a line of code. The gate simply
   began failing, for everyone.

The exemption-clearing check is **structurally incapable** of asking whether the tracked corpus got an
example, because it never reads the tracked corpus at all. The mechanism did exactly what it was
built to do, and what it was built to do was wrong.

While confirming this, `npm run doc-links` on this laptop reported one broken link — a dangling one
in a plan doc written the same afternoon — and passed the link
`260828l-dictation-vocabulary-review-sol.md → ../../data/reader.json`, which is the one the *gate*
fails on. The same test, the same commit, two verdicts, ten minutes apart. That is the class in a
single command.

## The commit that introduced it

Not `1c441ab`, which followed the rules. The defect is older: the evidence source was chosen when the
two assertions were written, and
[260901b-committed-fixture-corpus.md](../plans/260901b-committed-fixture-corpus.md) had already named
it. That plan's own status table lists `store-artefact-manifest` — "`raw.pdf` and
`labels-progress.json` read as unhomed, because the corpus carries neither" — and marks it **Open**.
Its ranked silent failures include the general form: *"The curated corpus omits an artefact or block
shape and the enumerating suites stay green."*

So this was foreseen, written down, and deferred on review advice, because stage 4 of the store
migration was expected to delete the filesystem seams anyway. The deferral was reasonable. What it
did not account for is that the hole kept widening while it waited: `quiz.json` and the two referee
files joined `raw.pdf` and `labels-progress.json`, and the cost arrived as a forced production deploy.

## The one that was worse, and nobody had noticed

`tests/statusline.test.ts` › "names the git branch it is standing in" derives its expected value with
`git rev-parse --abbrev-ref HEAD`, which returns the literal string `"HEAD"` in a detached checkout.
The deploy gate always builds its worktree with `git worktree add --detach`.

**So the gate failed this test on every run, at every commit.** The script under test is fine — it
prints the short sha and the worktree name, which is better than printing `HEAD`. The test was
asserting against the wrong command.

This is the same class wearing a different hat: the expectation was computed from the environment the
test happened to run in, rather than from the contract. And its real cost was not one red test — it
was that **a gate which can never pass teaches everyone to force it**. The three artefact failures
could sit in plain sight for a day because the summary line they appeared in was one people had
already learned to override.

## What would have caught it, ranked by ease and value

1. **Make the coverage checks read only tracked bytes.** Highest value, low effort. If "does an
   example exist" is answered from `tests/fixtures/data-root/` alone, the verdict is identical on
   every machine, and the 2026-09-01 exemption deletion would have gone red immediately instead of a
   day later on somebody else's checkout.
2. **One list, not two.** `store-roundtrip.test.ts`'s `ARTEFACTS` (18 entries) and
   `fixture-corpus.test.ts`'s own copy (17) have already drifted: the latter lacks `quiz.json`, so the
   one test whose job is "the corpus covers what the round trip claims to preserve" was blind to
   exactly this gap. Cheap to fix, and it removes a whole failure mode.
3. **Never let a test compute its expectation from ambient git state.** A temporary repository with
   an attached case and a detached case tests the contract; `rev-parse` in the checkout you happen to
   be standing in tests the checkout.
4. **Treat a permanently-forced gate as a defect in its own right.** The override exists for "this
   is not mine"; it had become the only way to deploy. A gate nobody can pass is not a gate, and the
   habit it builds is what let three real reds go unread.
5. **Ban doc links into gitignored roots.** Three links into `data/` and `output/` currently resolve
   only because the corpus happens to carry those slugs. They are one corpus trim from red, and
   [deployment.md](../project/deployment.md) had already named this seam.

Fixed in [260902g-corpus-evidence-for-artefact-coverage.md](../plans/260902g-corpus-evidence-for-artefact-coverage.md).
