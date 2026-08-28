# The rollback tool that dropped the reader's own words

**2026-08-28.** Found while checking a seeder field-by-field against `db:import` — not from a report,
and not by a test. No test could have found it: the field it loses has no fixture.

> **Fixed the same day** in [`src/store/export.ts`](../../src/store/export.ts), with a red test first
> in [`tests/store-roundtrip.test.ts`](../../tests/store-roundtrip.test.ts). See
> [the fix](#what-landed).

`ShelfState.purpose` is *"why you're reading this one"* — the per-article half of the reader profile
([reader-profile.md](../plans/reader-profile.md)), typed by the reader in their own words, fed to
glossary, summaries, chat, explain and tweets. It lives on `articles.purpose` rather than on the
revision, deliberately, so a re-extraction cannot undo it: the same argument
[`src/shelf.ts`](../../src/shelf.ts) makes about a renamed title.

`db:export` writes `data/<slug>/` back out of Postgres, and **is the rollback mechanism** for the
whole migration — the reason the importer and exporter were written and tested together
([postgres-migration.md § The order of work](../plans/postgres-migration.md)). It wrote four of the
five shelf columns:

```ts
const shelf = compact({
  archivedAt: article.archivedAt?.toISOString() ?? null,
  title: article.titleOverride,
  opens: article.opens,
  lastOpenedAt: article.lastOpenedAt?.toISOString() ?? null,
});                                       // ← no purpose
if (article.archivedAt || article.titleOverride || article.opens > 0) {
  await put("shelf.json", shelf);         // ← and no purpose here either
}
```

## Two losses, and the second is the worse one

**The value.** An article with other shelf state exported a `shelf.json` with the purpose quietly
missing. Restore from that archive and the reader's sentence is gone, with nothing anywhere saying a
field was dropped.

**The file.** The condition decides *whether there is a shelf file at all*, from the same four
columns. So an article whose only shelf state is a purpose — never archived, never renamed, never
opened, which is exactly an article somebody wrote a purpose for and has not read yet — exported **no
`shelf.json`**. Not a file with a missing field: no file.

## The root cause is a second list

The bug is not the missing line. It is that the **condition was a hand-written copy of the object's
keys**, so the two could disagree and nothing would notice. Adding a field to the object was one edit
and adding it to the condition was another, and the person adding the field had no reason to know the
second edit existed.

The column landed in `f31ad63` *"Tell the model who is reading, and let it change only the
emphasis"*, 2026-08-26 — the commit that introduced `purpose`. It touched
`src/store/export.ts` (+5 lines), `src/store/import.ts` (+113) and `src/db/schema.ts`, and put
`purpose` in `ShelfState`, in `pgShelfStore`, in the schema and in the prompts. The five lines it
added to the exporter were elsewhere in the file. **`db:import` did not import it either**, so a
filesystem → Postgres → filesystem round trip lost it at both ends, which is why the two halves
cancelled and the round-trip suite stayed green.

## Why nothing caught it

`tests/store-roundtrip.test.ts` compares every exported file against `data/`. It is a good test and it
could not see this:

> **No `shelf.json` in `data/` has a `purpose`.** Every assertion in that file compares the export
> against the corpus, and the corpus is silent about this field.

That is a general shape worth naming: **a round-trip test over real data can only see fields the real
data has.** Its coverage is a property of the fixtures, not of the code, and it does not report which
fields it exercised. The same file already has a warning for exactly this about review threads — *"on
a laptop with none, every assertion below passes while covering nothing, and nothing says so"* — and
that warning covers one field because somebody thought of that one field.

## What landed

The object gains `purpose`, and the condition is **derived from the object** rather than written
beside it:

```ts
if (article.opens > 0 || Object.keys(shelf).some((key) => key !== "opens")) {
  await put("shelf.json", shelf);
}
```

`compact` has already dropped the nulls, so "is there anything to say" is "is there a key other than
`opens`" — and a sixth column added tomorrow is covered without anybody remembering to add it twice.
`opens` is special-cased because it is always present and `0` is not something to say.

The test is in `store-roundtrip` and covers both halves at once: set only a purpose on an article,
export, and assert the file exists and carries it. It was watched to fail twice — once for the missing
file, and again with only the object's line removed, for the missing value.

## What would have caught the class

- **A test that asserts the export writes every column it is given.** The repo already has this shape
  for a different table: `META_COLUMNS` and `RAW_COLUMNS` in
  [`src/store/artifacts-pg.ts`](../../src/store/artifacts-pg.ts) are declared lists checked against
  the object at runtime, and `tests/store-revision-columns.test.ts` asserts the policy map is
  exhaustive against `getTableColumns`. Nothing equivalent guards the five shelf columns, and the
  same argument applies to them: a column added to the schema should fail a test until somebody says
  whether the exporter writes it.
- **Never deriving a "should I write this" condition from a copy of the data.** Where the check and
  the payload are two lists, they will differ eventually and the failure is silent.
- **Round-trip suites saying what they covered.** The `reviews === 0` warning in
  `store-roundtrip` is the right instinct applied to one field by hand. The general version is a
  fixture that carries *every* optional field at least once, so "the corpus does not exercise this"
  becomes a red rather than a green.

## Related

- [silent-success.md](../reusable/silent-success.md) — the same family: a write that reports success
  while doing nothing, with the obvious check agreeing because it shares an assumption with the code.
- [the-config-file-is-not-the-bucket.md](the-config-file-is-not-the-bucket.md) — a declaration and the
  thing it is supposed to describe, drifting apart with nothing comparing them.
