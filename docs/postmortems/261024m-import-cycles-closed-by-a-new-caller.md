# Import cycles closed by a new caller, seen only by the gate sessions do not run

**What happened.** The readiness run at dev `2e1eee6b3` (2026-10-24 20:05 UTC) passed every test
and failed the `cycles` step of `npm run check` — Biome's `noImportCycles`, a gate since it reached
zero ([static-analysis.md § Cycles gate](../project/static-analysis.md#cycles-gate)). The last green
run was 2026-10-23 13:16 UTC. Two separate cycles had landed in between, on the same day, from two
pieces of work:

| Cycle | Closed by | Edge |
|---|---|---|
| `src/extract.ts` ⇄ `src/read-parts.ts` | `cff6e504e` (plan 261024p, multi-page import, stages 2–3) | `read-parts.ts` imported `readArticle` and `capabilityFloor` from `extract.ts`, whose `runExtract` imports `readParts` |
| `pipeline.ts` → `store/index.ts` → `store/pg-*.ts` → `store/pg.ts` → `pipeline.ts` | `8cf25115e` (plan 261024o, the situate step) | `situateStep` did `await import("./store/index.js")` for `fetchAllowanceStore`; `store/pg.ts` already imports `STEP_ORDER` and `STEPS` from `pipeline.ts` |

Found with `git log -S` on each edge. Biome reports the second one on a dozen files, every
`pg-*.ts` that imports `./pg.js`, but they are all one loop.

## Root cause

**A helper moved into its own module, or a new dependency added in a low-level file, that still
reaches back to the file that calls it.** `read-parts.ts` was written as a layer *above*
`readArticle` (it calls it once per page) and *below* `runExtract` (which calls it). Both of
those lived in `extract.ts`, so the new module had to import from its own caller. The situate
step's author saw the loop coming, said so in a comment, and went round it with a lazy
`import()`, believing that a dynamic import does not count. To Biome it does, and rightly: the
loop is still there at run time, it just closes later.

Why it reached `dev`: **the only check that sees cycles is one sessions do not run.** CLAUDE.md
tells a session to run `npm test` and `npm run typecheck` when it finishes a change. `npm run
cycles` takes four seconds, but it runs only inside `npm run check`, which readiness runs a day
later. Both commits went through code review, and neither review ran it either.

**The class: *an import cycle closed by a new caller*.** It comes in two forms: a module split
out of a file that still imports from that file, and a lazy `import()` used as a way round a
cycle the author had already spotted.

## The fix

The repo's existing move, the same one `store/owned-slug.ts` and `store/require-slug.ts` made:
**put the shared piece in a leaf, and re-export it from its old home so no importer moves.**

- **`src/read-article.ts`** (new) holds the read: `readArticle`, `readArticleWithProvenance`,
  `capabilityFloor`, `MIN_ARTICLE_CHARS`, `TooLittleTextToRead` and the DOM prep they share. The
  implementation is moved unchanged; comments point to the new home. Both `extract.ts` and
  `read-parts.ts` import it, and it imports neither.
  `extract.ts` keeps `runExtract`, the CLI and the error it alone throws, and re-exports the rest,
  so none of the ~40 importers changed.
- **`situateStep`** imports `pgFetchAllowanceStore` from `store/pg-rate-limit.ts` directly. That
  module is already a leaf as far as `pipeline.ts` is concerned, and it is already guarded at its
  export, so this is the same store object: `store/index.ts`'s `fetchAllowanceStore` calls the
  idempotent `guardDbStore` again, which returns the already-guarded object unchanged
  ([db-errors.ts](../../src/store/db-errors.ts)). Other modules outside `store/` already import
  `pg-*` adapters directly.

`npm run cycles` was watched red on both loops before the change and green after it.

This is also the right fix for the long term. The one alternative worth naming was to inject
`readArticle` into `readParts` as a parameter. That would have hidden the edge without fixing
the layering.

## What would have caught it, ranked by ease against value

1. **Run `npm run cycles` wherever a session runs `npm run typecheck`.** It takes four seconds
   and would have caught both commits. The cheapest way is to make it a step of
   `scripts/typecheck.ts`, so the command sessions already run covers it. The alternative is a
   line in CLAUDE.md's *Before you call it finished*. That is a rule-doc edit, so it is Greg's to
   approve, and a sentence is a weaker guard than a step. **Proposed, not done**: it changes what
   a gate command does, which is Greg's call.
2. **A lazy `import()` is still an edge.** This is now in the comment at the site (`situateStep`);
   `read-article.ts`'s header records the other loop and the layering that prevents it. Free,
   but only seen by someone who reads those files.
3. **The reviewer runs `npm run check`, or at least `npm run cycles`**, as part of the GPT Sol code
   review. Cheap, but it catches the problem only at review time, and reviews are where a
   four-second check is easiest to skip. Weaker than 1.
4. A pre-commit hook. **Rejected**: commits here are made by pathspec from several agents in
   shared trees ([version-control.md](../project/version-control.md)), there is no hook setup, and
   a hook only checks the committing tree, not the merged one. 1 is the same check for less.
