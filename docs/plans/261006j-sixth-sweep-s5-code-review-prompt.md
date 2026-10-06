# Review: sixth sweep cluster S5 — citation depth, one block-row mapper, three dead null-checks

## The candidate

Your working directory is the cluster's own git worktree. Five commits:
`a9ce12310` (1: citation depth, red first), `b327bf681` (2: three dead null-checks),
`6984cd8fa` (3a: characterisation test), `3b9d24ac4` (3b: the mapper extraction),
`8eb58077b` (4: two doc sentences and the plan doc).
`git log --oneline a9ce12310~1..HEAD`; `git diff a9ce12310~1 HEAD`; and per stage `git show <sha>`.
The plan: `docs/plans/261006j-sixth-codebase-sweep-umbrella.md` § S5 and § "What the review
changed" — **U7 and U8 are your own findings from the plan review**. The builder's record:
`docs/plans/261006j-sixth-sweep-s5-citation-depth-block-mapper-null-checks.md`.

## What it is meant to do

1. Make `citableText` (`src/citable.ts`, server: counts which block ids a chat answer cites) agree
   with the chip renderer (`src/web/Cited.tsx`) about nesting depth. The builder changed only the
   server walk to count block nesting as the renderer does, with a work list instead of recursion,
   and exported one `MAX_BLOCK_DEPTH` that the client imports.
2. Remove three null-checks the `FetchedDocument` union made dead.
3. Replace five copies of the `revision_blocks` row → `Block` mapping with
   `src/store/block-rows.ts`: `publicBlockOf` (row type has no `note`) and `blockOf` (row type
   requires `note`). Extraction only — no behaviour change.

## What you can run, and what you may change

No network, **no database**: the database-backed characterisation test cannot run in your
sandbox; the builder ran it. Run `node --import tsx scripts/typecheck.ts` and the database-free
tests: `npx vitest run tests/chat-markdown-render.test.tsx tests/block-rows.test.ts
tests/eager-client-graph.test.ts tests/sanitize-client.test.ts` and any citable/cited tests.
**You may fix narrowly inside this cluster's files, red-first.** Do not commit. Report wider things.

## Attack it

1. **Stage 1, parity.** Is U8 closed, and closed generally? Fuzz it: generate markdown with
   random nestings of blockquotes, ordered/unordered lists, list-in-quote, quote-in-list,
   emphasis/strong, code spans and fenced code (ids inside code must not count on either side),
   links, headings, tables if either side handles them, up to depth 14, each with block ids in
   the `spya-xxxxxx` form at various levels; compare the set of ids `citableText` reports with the
   set of chips the renderer draws (SSR). List every disagreement with a minimal input. The
   builder says flat-mode `CitedText` and `citableText` disagree about lists and quotes and that
   no caller counts citations there: verify "no caller".
2. **Stage 1, the new walk.** A work list replaced recursion: termination, order of reported ids
   (does any caller depend on order or on duplicates?), behaviour on pathological input (10,000
   nested `>`; very long lines) — time and no stack overflow. Did the change alter results at
   realistic depths 0–3 for ANY input shape? It must not. Does the client importing
   `MAX_BLOCK_DEPTH` from `src/citable.ts` pull any server-only module into the browser bundle
   (look at that module's imports)?
3. **Stage 2.** For each removed null-check, is `text` truly non-null on that branch for every
   member of the union, including any member added recently?
4. **Stage 3, the extraction.** `git show 3b9d24ac4`. For each of the five call sites, compare the
   old inline mapping with the new call, field by field, including key ORDER (some consumers hash
   or serialise blocks — does `hashBlocks`/source-hash or the export depend on key order or on
   absent-versus-undefined keys?), absent versus `undefined` for each optional field, and the
   `id`/`blockId` aliasing. The public path: can `note` reach a visitor by any route now —
   is `publicBlockOf`'s parameter type really unable to accept a row carrying `note` (structural
   typing accepts excess properties on non-literal values: a row object WITH `note` is assignable
   to a type WITHOUT it; so does `publicBlockOf` copy fields explicitly, never spread)? The
   builder reports the database test could not catch a note-emitting public mapper because
   `publicBlock` in `src/public/dto.ts` rebuilds every block on the way out; is the unit test in
   `tests/block-rows.test.ts` then a real guard — does it fail against a mapper that spreads its
   input?
5. **Does the extraction earn its keep as built?** You said yes in the plan review, "with a
   narrower contract". Is what was built that narrower thing?
6. The builder added a line to `tests/store-migration-registry.ts` (`TEST_LANES`) so the new
   database test runs in a lane with a database: correct lane?
7. The two doc sentences (`docs/project/database.md`, `docs/project/links.md`): true to the code?

## Format

Verdict line first: **ship**, **ship with these fixes (applied)**, or **do not ship**. Findings
with ids (C1, …), severity P0–P3, `file:line`, a minimal reproducing input where there is one,
reproduced or reasoned, fixed (name files) or reported. Under 1,000 words.
