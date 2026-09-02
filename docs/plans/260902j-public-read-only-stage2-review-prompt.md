# Review requested: Cluster B as built — the metadata route deleted, its caller repointed

**Date:** 2026-09-02. **Asked of:** GPT Sol. **Mode:** read-only — do not edit files, do not run
state-changing git commands.

Your fifth pass on this plan. The four before it, all folded in:
[-review-sol.md](260902j-public-read-only-access-audit-review-sol.md) (the plan, BLOCKED),
[-build-forks-sol.md](260902j-public-read-only-build-forks-sol.md) (**Fork 1 is the decision this
stage implements**), [-stage1a-review-sol.md](260902j-public-read-only-access-audit-review-sol.md)
and [-stage1b-review-sol.md](260902j-public-read-only-stage1b-review-sol.md) (both BLOCKED, both
fixed), and [-cluster-e-review-sol.md](260902j-public-read-only-cluster-e-review-sol.md) (three
changes, all made — including `visibility?: "public"`, which you were right about).

## What to read

Worktree `.claude/worktrees/public-read-improvements`, branch
`worktree-public-read-improvements`. One commit:

    git show c5f6080
    git show c5f6080 --stat

The plan is
[260902j-public-read-only-access-audit-and-improvements.md](260902j-public-read-only-access-audit-and-improvements.md)
— **Tier 1, Cluster B**, and its Progress entry for this stage.

## What it does

`GET /api/public/metadata/:slug` is deleted, with `loadMetadata`, the `metadata` projection, the
`publicMetadata` DTO, the `PublicMetadata` type and the client's `loadPublicMetadata`.
`PUBLIC_ROUTE_NAMES` has one entry and the two module-load guards are untouched.
`PublicMetadataPage` — the `/read/:slug/metadata` UI — stays and draws from the article payload.

`scripts/check-public-shell.ts` is repointed at `GET /api/public/article/:slug`, reading
`meta.title`, per your Fork 1 answer. **The payload shape moved with the route**: metadata had
`title` at the top level, the article has it at `meta.title`. The parsing is now a pure exported
`articleTitleFrom` so `--self-test` can reach it, on the reasoning that a repoint keeping the old
key would report "no string title" against every healthy deployment — a checker failure wearing a
deployment failure's clothes.

References under the five needles: **61 → 8**, and every survivor is claimed to be deliberate — four
new assertions that must name the path in order to refuse it, four comments recording the deletion.

## Attack, specifically

1. **Did the deletion open a hole?** The one way it could: a path the dispatcher no longer matches
   falling through to the authenticated gate and answering 401, which reads as *sign in and you may
   see it* about an endpoint nobody may see. It is asserted 404 for every method with no `Allow` and
   `no-store` (`tests/public-dispatch.test.ts`), and over real HTTP against Postgres for both a
   private and a shared article (`tests/public-visibility-pg.test.ts`). Check the dispatcher itself
   (`src/public/routes.ts`) rather than the tests: is there any path, method, or encoding under
   `/api/public/` that now escapes the closed room?

2. **Is the repointed checker actually as strong?** You argued the article route is *more*
   independent of `loadHead` than the metadata route was. Now check the built version rather than
   the argument: `judgeTitleAgainstArticle` (~`:331`), `articleTitleFrom` (~`:365`),
   `fetchArticleTitle` (~`:903`), `checkPublicHead` (~`:924`). Two things I am unsure about — does
   the blank-title downgrade still trigger in the cases that matter now that the `<h1>` divergence
   is gone, and does fetching a ~200KB payload introduce any failure mode the small one did not
   (timeout, truncation, the curl invocation)?

3. **Was anything deleted that was load-bearing?** `loadMetadata` served a revision with a tree and
   no blocks that the other two reads refuse, and a fixture existed to pin that. The claim is that
   the fixture now asserts a better thing — both survivors refuse it, by two different mechanisms
   (`loadArticle` counts fetched rows, `loadHead` asks Postgres `has_blocks`). Is that true, and is
   the coverage genuinely equal or better?

4. **Are the eight survivors really deliberate?** `scripts/check-public-shell.ts:307`,
   `src/store/public-reader.ts:69`, `src/web/public-api.ts:112`,
   `tests/public-client-fetch.test.ts:173`, and the four assertions. Any of them stale, misleading,
   or a piece of the route still alive?

5. **`src/web/public-api.ts`'s generic `read<T>` now has one caller.** It was kept generic
   deliberately, on the argument that it holds the 404-is-an-answer rule which belongs to the
   namespace rather than to a route. Is that right, or is it now a wrapper pretending to be an
   abstraction?

6. **Name a mutation that still passes.** Four were run and killed: `requireReadMethod` allowing
   POST; the closed-room fallthrough answering 401; renaming `article` to `articles` in the
   inventory (which fails the file at *import*, before any test body runs); `publicSlug` replaced by
   bare slug equality; and `articleTitleFrom` reading the top-level key. What did I miss?

7. **The comments.** Two false ones were deleted — `App.tsx`'s *"stays for stage 2's link preview"*
   and `public-reader.ts`'s claim that the assets projection prevents hot-linking. Does anything
   that replaced them claim more than the code does?

## Evidence

- Reference count 61 → 8, recounted after the change.
- `npx tsx scripts/check-public-shell.ts --self-test` — **46 passed before, 50 after**, 0 failed.
- `npx vitest run` on the nine touched test files plus `public-imports`, `public-dispatch`,
  `public-page-request-scope`, `public-read-page`, `doc-links` — **223 passed, 11 files**, including
  `public-visibility-pg` against real local Postgres.
- `npm run typecheck` clean. A full `npm test` is running now on a quieter box and its result will
  go in the plan; you asked for that before the plan closes and you were right to.
- `docs/project/security-map.md` needed no edit: it names no route and counts no routes. Confirm.

`file:line`, how you know, ranked. Under ~1200 words. End with a verdict: BLOCKED with the blockers
named, or landed-and-fine with the changes you want.
