# Sixth sweep, S5: a citation-depth defect, one block-row mapper, three dead null-checks

Cluster S5 of [the sixth codebase sweep](261006j-sixth-codebase-sweep-umbrella.md), as changed by
its review (U7 and U8 there). Built 2026-10-06, in four stages, one commit each (the third is two).

## What landed

### 1. The server counts a citation's depth the way the screen nests it

`src/web/Cited.tsx` draws a chat answer; `citableText` in `src/citable.ts` is the server's account
of where in that answer a citation chip can be. Each had `MAX_DEPTH = 12` and a comment saying the
other was kept in step. The numbers were equal and the two still disagreed, because they counted
different things:

| | what one level is |
|---|---|
| the renderer | a block inside a block: a quote's contents, or the contents of a list item that holds more than one paragraph |
| `citableText`, before | every level of the parsed tree: the paragraph, the list *and* its item, each `strong` and `emphasis` |

So the server stopped earlier than the screen. An id eleven quotes deep, or six lists deep, or five
lists deep in bold italics, was a chip on screen and nothing to the server.

**What a reader could have seen go wrong: nothing.** `citableText` has three callers and none of
them draws anything: `citedBlockIds` and `unknownCitedIds` in `src/converse.ts` (the chat log line
that says how many ids an answer cited and how many it made up, and two evals), and `unknownIds` in
`src/web/citations.ts`, which its own comment says renders nothing. The cost was to the numbers we
watch: a citation the reader was shown went uncounted, and an invented id that deep went
unreported. At the depths a model actually writes (0 to 3) the two always agreed.

**The fix changes the server and leaves the screen alone**, because `citableText` is defined as "the
text a reader will actually be offered a citation in", which makes the renderer right by
definition. Depth now moves only where the renderer's does. The walk became a work list instead of
recursion: with inline nesting no longer counted against the cap, a recursive walk would be exposed
to `*` × 6,000, which parses to a tree 3,000 deep (measured; the work list returns the id).

**Red first.** Eighteen shapes either side of the cap in `tests/chat-markdown-render.test.tsx`
§ *agrees at the depth cap*, each painted with React and counted on both sides. Eight failed before
the fix: 11 quotes, 6 lists, 12 lists, a one-paragraph item 11 quotes deep, a two-paragraph item 10
quotes deep, bold italics 11 quotes deep, bold italics 5 lists deep, a heading 11 quotes deep.

**Then the constant was shared.** `MAX_BLOCK_DEPTH` is exported from `src/citable.ts` and imported
by `Cited.tsx`. The client already imported that module (`src/web/citations.ts` takes
`citableText`), and `tests/eager-client-graph.test.ts` and `tests/sanitize-client.test.ts` pass.
Both comments now say that the shared number is not what keeps the two walks together; the parity
test is.

### 2. Three null-checks the `FetchedDocument` union made dead

`|| doc.text === null` in `src/link-previews.ts` and `src/chat-tools.ts`, and `doc.text ?? ""` in
`src/paper-text.ts`. Each narrowing was confirmed with the compiler first: a
`const x: string = doc.text` at the first HTML use typechecked in all three, and the same line moved
above the `kind` test in `paper-text.ts` failed with TS2322, so the probe could have said no.

### 3. One block-row mapper where there were five

**Extracted.** `src/store/block-rows.ts` has `publicBlockOf` (never reads a `note`; its row type has
no such column) and `blockOf` (the owner's; its row type requires the column, so it does not compile
against the visitor's SELECT). No argument chooses between them. The five reads call one or the
other, 94 lines out and 11 in across the five files. The id is passed by the caller, since some
reads alias `block_id` as `id` and some as `blockId`. The SELECT lists, what an empty result means,
and whether the HTML is cleaned stay where they were.

It earned its keep. The shared part was the whole fourteen-line mapping, identical in all five
apart from the `id` alias and the visitor's missing `note` line, and the type on `blockOf` is a
protection the copies did not have.

**Characterised first**, in its own commit: `tests/block-row-mapper-pg.test.ts` seeds three rows
(every optional column set; every one null; only a note) and reads them through the pipeline's
artefact read, the owner's article, the export's `blocks.json` and the visitor's article, with
`toStrictEqual`. Green on the five copies, and green unchanged after the move. Shown able to fail:

| the wrong mapper | what went red |
|---|---|
| `export.ts` copy without its `noteId` line (before the move) | the export case only |
| `level: row.level ?? undefined` in the shared mapper | the artefact and owner cases |
| `publicBlockOf` emitting the note | `tests/block-rows.test.ts` |

Key order is unchanged (`note` between `gistable` and `role`), which is the byte order of an
exported `blocks.json`; `tests/block-rows.test.ts` pins it.

### 4. Two decisions that lived only in commit bodies

- `docs/project/database.md` § *what a stage's cache is keyed on*: a stored run is stamped with the
  hash of the exact blocks it sent (`7fc1b41fb`).
- `docs/project/links.md`, beside the tab's summary cache: `forgetSummaries()` is a generation
  fence, and what it guarantees (`bddf8c0c8`).

Neither fact was in either doc before.

## Claims that turned out to be false, or narrower than written

- **"Rows covering context present / one half null / both null."** A row with one context half
  null cannot be seeded: the CHECK `revision_blocks_context` refuses it. The database test asserts
  the refusal; what the mapper does with such a row is a unit test.
- **"A test that drives all five real call paths."** Four. `storedBlocks` in `pg-revisions.ts` is
  private and its result goes only to the publication guard, which reads ids. Its copy was compared
  with the others by reading, and is now one line calling `blockOf`.
- **"Prove the test can fail against a mapper that emits `note` on the public path."** The database
  test cannot, and should not be read as if it could: with `note` added to the visitor's SELECT
  *and* the mapper emitting it, the visitor's case stayed green, because `publicBlock` in
  `src/public/dto.ts` rebuilds every block field by field on the way out. That is a second gate
  working. The mapper-level proof is the unit test, which did go red.
- **"Four are identical apart from whitespace"** (the umbrella): two of the four select the id as
  `id` and two as `blockId`, as U7 says.
- **The test needed a file outside the listed set.** `tests/store-migration-registry.ts` § `TEST_LANES`
  gets one line for the new database test; without it the file runs in the unit lane, which has no
  database.

## Left, and why

- **Three more null-checks of the same shape in `evals/`**: `evals/debate/verify-fallback.ts`
  (`|| doc.text === null`), `evals/arxiv-html-vs-pdf/run.ts` (`|| htmlFetch.doc.text === null`) and
  `evals/arxiv-html-vs-pdf/abs-repro.ts` (`doc.text ?? ""`). Outside this cluster's files. Not
  checked with the compiler; the third reads `doc.text` without narrowing on `kind` first, so it may
  be live.
- **The renderer's inline walk has no depth cap.** `strong` inside `emphasis` recurses without
  limit in `Cited.tsx`, and a 3,000-deep tree is reachable from 6,000 asterisks. Whether that
  overflows the render was not tested: the parse alone takes 6.7 seconds at that size, which is the
  library's cliff and arrives first. A cap there would change what a reader sees, so it is reported
  and not built.
- **Flat mode.** `CitedText` (the Quiz reply, the summary panel) draws only top-level paragraphs
  with chips and everything else as source, while `citableText` counts an id in a list or a quote.
  No caller counts citations in flat-mode text today. Not changed.

## Gates

- `npm run typecheck`: 0 errors, after each stage.
- `npx vitest run` on the touched files and their subjects: `chat-markdown-render`, `chat-commands`,
  `eager-client-graph`, `sanitize-client`, `answer-opening` (177 passed); `chat-tools`,
  `fetched-document-is-a-union`, the four `link-preview*`, `paper-text` (219 passed); the two new
  block-row files with `public-imports`, `public-dto`, `public-dto-owner-only-fields`,
  `public-visibility-pg`, three `store-export-*`, `store-roundtrip`, `store-artefacts-pg`,
  `store-publish-guards`, `pg-session-exact-base`, `store-pg-session`, `client-imports`,
  `store-migration-registry`, `reading-difficulty-pg`, `title-original-pg`,
  `freshness-deciders-agree` (600 passed); `doc-links`.
- `npx biome lint` on the touched files: nothing introduced. Two complexity notes in `pg.ts` and
  `pg-revisions.ts` were there before.
- The full `npm test` was not run here; the orchestrator runs it once on the branch.
