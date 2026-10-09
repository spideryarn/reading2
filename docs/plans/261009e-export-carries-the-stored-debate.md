# 261009e — the rollback export carries the stored Debate

Queue item **qi-mv7wk6ap**, found by GPT Sol in 261008i stage 1's code review (C5).

## The bug

`exportArticle` ([`src/store/export.ts`](../../src/store/export.ts), the rollback into
`data/<slug>/`) writes one `await put(…)` per whole artefact on `article_revisions`. The
`debate` column had none, so an exported article silently lost its stored debate — legacy
(`claims` searched) and current (`debate/7`, `claims: {pass: "not-run"}`) alike. Older than
261008i; the column has been there since the debate stage landed.

The zip a reader downloads ([`export-bundle.ts`](../../src/store/export-bundle.ts)) was never
affected: `debate` is not in `REVISION_WRITTEN_ELSEWHERE`, so it ships inside
`content/revision.json`'s row.

## The fix

- One line: `if (revision.debate) await put("article_revisions", "debate.json", revision.debate);`
  beside `debate-claims.json`. The filename is the one the old filesystem store used
  (`tests/helpers/fixture-artefacts.ts` § `debate`).
- A test in [`tests/store-export-bundle.test.ts`](../../tests/store-export-bundle.test.ts) that
  plants a `debate/7`-shaped Debate on the fixture revision and requires it back, whole, from both
  the bundle's `content/revision.json` and the rollback's `debate.json`. Seen red first (ENOENT on
  `debate.json`), green after.

## What this passes over

**The simpler option taken.** The class — *a new artefact column with no line in the put-chain
exports nothing and says nothing* — is listed in [mode.md](../project/mode.md) with *Nothing* as
its check. A column-level guard (every JSONB artefact column on `article_revisions` either put by
the rollback or excused with a reason, as `COLUMNS_LEFT_OUT` does for the bundle) would close it.
Not built here: it is a new mechanism, not the bug, and is reported to the Overseer as a
recommendation instead.

**Moving `debate` into the bundle's `augmentations/debate.json`.** Its neighbours are written
there whole; `debate` sits in the revision row. That is a consistency change to a reader-facing
file layout, not a fix, so it is left alone.
