# Review: C7 — the three suites moved off `db:import`

You reviewed the fixture loader (`docs/plans/c7-fixture-loader-sol.md`) and gave ten findings, all
addressed. This is the next commit: the three suites that used `importArticle` purely as a fixture
loader now use the real write path instead. **Weight this higher than the plan-stage review** — this
is built code with evidence behind it.

Repository root: `/Users/greg/Dropbox/dev/experim/spideryarn2`. Read whatever you need. The scoped
diff is at `/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/cb1f6352-212a-4617-954a-5ead31cb1813/scratchpad/c7-suites.diff`, and the two new helper files are appended to it in full.

## What changed

- `tests/store-parity.test.ts` — `importArticle` → `loadArticleIntoPg`, plus a wipe, plus reader-state
  seeding, plus the exemptions below.
- `tests/store-roundtrip.test.ts` — same swap; the artefact half through the loader, the reader's own
  state seeded beside it.
- `tests/chat-anchor.test.ts` — same swap for its cloned scratch article.
- `tests/helpers/seed-reader-state.ts` — **new.** Shelf, chat, comments, searches, glossary lookups,
  written as rows from the files. Your decision 3: a seeder, kept separate, never composed into
  `loadArticleIntoPg`.
- `tests/helpers/corpus-lock.ts` — **new.** A Postgres advisory lock so only one suite at a time
  loads `data/`'s real articles.
- `docs/plans/delete-the-importer.md` — the write-up.

## The decisions I want you to attack

**1. The wipe deletes revisions, not articles.** `basedOn` is `articles.current_revision_id`, so
parity nulls the pointer and deletes every revision behind it, then asserts `basedOn === null` for
each article. I first deleted the article row and changed to revisions because the cascade takes
comments, chat, searches and block identities — and vitest runs files concurrently, so an article
that vanishes for two seconds fails whoever else is reading it. **Is deleting revisions enough to
make the parity claim honest?** What can carry forward that is not on `article_revisions`,
`revision_blocks` or `revision_step_runs`? The article row keeps `created_at` (set explicitly per
load), the shelf columns (re-seeded), `fixture`, and the sharing columns.

**2. Two clocks, exempted and paid for.** `src/extract.ts` writes `meta.fetchedAt = new Date()` on
every run, so the filesystem's "fetched at" is really "extracted at"; Postgres takes the column from
`raw.json`. Four of six corpus articles differ by minutes; `writes` agrees to the millisecond. So
`meta.fetchedAt` and `meta.url` come out of the deep comparison, and are replaced by: pg's value
equals `raw.json`'s, fs's equals `meta.json`'s, plus a test that at least one fixture genuinely
differs. Same treatment for `addedAt` on the library card, and for `meta.json` in the export round
trip. **Is that enough, or does the exemption still hide something?**

**3. The library order test is kept.** The two stores order the shelf from different clocks and
currently agree. I kept the equality with a comment saying that if it goes red, compare the two
timestamps before looking for a sort bug. **Is keeping a test that can go red for a non-bug the right
call, or should it assert something narrower?**

**4. Round-trip losses I decided to assert rather than fix.**
   - A round trip rewrites `meta.fetchedAt` from extraction time to fetch time. `db:export` is the
     rollback tool, so a restored directory is not byte-identical.
   - **An article with a raw document but no `raw.json` loses the document entirely.** The `raw`
     step's artefact *is* the manifest; `noema` has a bare `raw.html` from before manifests, so no
     `fetch` step is copied and there is nothing to export. `db:import` read the bare file into
     `article_revisions.raw_bytes`, which C6 dropped. **Is asserting this acceptable, or does C6 owe
     a backfill?**

**5. `constitution` is excluded by asking rather than by name.** `store-roundtrip` drops any article
whose `labels.json` has no `sourceHash`, and asserts each exclusion really has that defect. Parity
keeps it as a named legacy case with four assertions, per your decision 1.

**6. The seeder writes rows directly.** `pgShelfStore.patch` cannot set `opens` to 874 or archive
with last week's date; `pgCommentStore.create` makes a current unanswered comment. So it writes
columns and says so. **Does it write the same rows `db:import` did?** A field it silently drops is a
round trip that passes while losing data — check it against `src/store/import.ts` field by field,
especially chat messages and search runs.

## The evidence

Every new guard was mutated and watched to fail:

| mutation | result |
|---|---|
| remove the wipe | *"built every article from nothing"* red, first run, nothing else |
| remove both seeders | 7 red — archived articles back on the pg shelf, comment counts zero |
| pg's `fetchedAt` compared against `meta.json` | exactly 5 red (4 divergent + noema); `writes` stays green |
| fs's `fetchedAt` compared against `raw.json` | exactly 5 red |
| "at least one fixture's clocks differ" raised to `> 4` | red — so exactly 4 do |
| roundtrip's exported `fetchedAt` compared against `meta.json` | 5 red |
| the no-manifest raw branch inverted | 1 red (noema only) |
| drop the `blockIdentities` insert from the chat seeder | `chat-anchor`'s roundtrip red on the FK — the same mutation its header documents against `importArticle` |
| exclusion list asserted non-empty | passes, so the guard is live |

The advisory lock was proved by holding it in a separate process for 30s and watching the suite wait
(31.6s) rather than fail.

Ten suites, three consecutive runs, 230 tests passing. One real bug the rewrite introduced and the
suite caught: the first version subtracted the unanchored comment from **both** sides of the library
comparison, which cancels out and asserts nothing.

## What I am not asking

The loader itself (`tests/helpers/load-article.ts`) is unchanged from your last review. The importer
is still present — deleting it is a later commit.

## Output

Findings in order of severity, each with the file and what would go wrong. Say plainly if a claim in
the write-up is stronger than the code supports. End with PROCEED, PROCEED-WITH-CHANGES, or STOP.
