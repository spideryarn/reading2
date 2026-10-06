# Sixth sweep, cluster S2: false comments, and three tutorial banners

Cluster S2 of the [sixth codebase sweep](261006j-sixth-codebase-sweep-umbrella.md) (§ S2, and U2 and
U10 of § "What the review changed"). Built 2026-10-06, feedback report `spya-p5p3qx`.

**What it was for.** A comment that says something false about today's tree sends the next reader
to a file that is not there, or to a store that was deleted a month ago. This cluster rewrites those
comments to be true, briefly. **No line of behaviour changes**: comments only, plus one dated banner
on each of three tutorials. A comment that records history ("was X until 2026-09-05") stays.

**The simpler option passed over.** Deleting every stale comment outright. Not taken, because most of
them carry the reason a piece of code has its shape; the reason is still right and only its tense or
its pointer is wrong.

## What landed

109 files changed, +393 −354 lines, plus this doc.

| # | Item | Before | After |
|---|---|---|---|
| 1 | `styles.css § <section>` pointers (`grep -rn "styles\.css §" src tools scripts tests`) | 83 | 1 |
| 2 | Filesystem-store wording (`filesystem store`, `SPIDERYARN_STORE`, `fs store`, `files adapter`, `filesystem adapter`, case-insensitive, in `src scripts tools vite.config.ts`) | 192 | 179 |
| 3 | `Hierarchy` in `src` (`.ts`, `.tsx`, `.css`) | 55 | 48 |
| 3 | `gist column` in `src scripts tools` | 52 | 52 |
| 5 | Dead repo paths in the seven named files | 16 | 1 |

The counts in rows 2 and 3 barely move on purpose: most fixes turn a present-tense sentence into a
dated past-tense one, which still matches the grep. What changed is what the lines say.

1. **`styles.css §` pointers: 82 rewritten in 49 files** (18 of them in `tests/`). Each now names
   the file under `src/web/styles/` that holds the section, in the bare-filename form the tree
   already used (`narrow-window.css § a band with no room`). The one left is
   `tests/doc-links.test.ts`, where the string is a parser input.
   - The two tokens files share a name, so pointers to ours say `src/web/styles/tokens.css`.
   - Four section names never had a heading, even before the split of 2026-09-06, so each pointer
     now names the rule or the heading that really holds it: `§ plain, centred` →
     `narrow-window.css § .reader.text-alone`; `§ the modes segment` → `dock-fit.css § the mode
     switch`; `§ the floor` → `dock.css § the floor under the fit ladder`; `§ the floating panels` →
     `dialogs.css § the floating chat panel`.
   - Five `§ a narrow window` pointers were about the band covering the page, which lives in
     `narrow-window.css § a band with no room`. `crumbs.css` has a `§ a narrow window` of its own.
   - `layout.ts` said `--blk-slot` is in `§ tokens`; it is in `shell.css`.
2. **Filesystem-store comments: 71 passages in 34 files.**
   - *The named ones:* `src/store/contracts.ts` (four: `AdminStore`, `FeedbackStore`, the library
     search contract, the experimental-features timestamp), `src/messages.ts` (two), `src/chat.ts`,
     `src/types.ts` (four, below), `src/block-policy.ts`, `src/source-hash.ts`,
     `src/store/pg-searches.ts` (two), `src/fetch.ts`, `vite.config.ts`.
   - *Found in the sweep:* `src/jobs.ts`, `src/store/jobs.ts`, `pg-jobs.ts`, `pg-uploads.ts`,
     `uploads.ts`, `job-fence.ts`, `session.ts`, `pg.ts`, `pg-shelf.ts`, `pg-revisions.ts`,
     `pg-referee-claims.ts`, `blobs.ts`, `src/db/schema.ts`, `src/routes.ts`, `src/job-state.ts`,
     `src/billing/admission.ts`, `src/vercel-health.ts`, five files under `src/web/`,
     `scripts/db-reown.ts`, `scripts/deploy-checks.ts`.
   - **`src/types.ts`, why the fields are optional today.** `Article.visibility?`: the owner's read
     always sets it (`src/store/pg.ts`); what carries none is a visitor's payload, a `PublicArticle`
     drawn as an `Article` (`src/web/article/access.ts`, and `Masthead.tsx` already said so).
     `LibraryEntry.visibility?: "public"`: `describeArticle` keeps the key only for `public`, so
     absence is the one spelling of "not shared". `ArticleMetadata.sharing?`: Postgres always sends
     the block, so it is optional for historical reasons, and the comment now says that plainly. No
     type changed.
3. **Gist columns and "Hierarchy": 24 passages in 19 files.** `library-hits.ts` (the default mode
   is `plain`, `DEFAULT_MODE` in `src/modes.ts`), `Dock.tsx` (two), `narrow-window.css` (two),
   `models.ts`, `mode-band.css`, `referee.css`, `StructurePanel.tsx` (two), `FeatureBoundary.tsx`,
   `ModeHerald.tsx`, `src/web/structure.ts`, `routes.ts` (the example URL), and from the sweep
   `useArc.ts`, `tokens.css` (`--head-h`), `shell.css` (three), `flash.ts`, `DiagramPanel.tsx`,
   `Reader.tsx`, `structure-mode.css`, `page-title.ts`.
4. **`tools/fleet/pause.ts`**: the TODO is gone. The comment now says `RateLimitReading` is a
   narrow local type on purpose and `rateLimitFrom` is the seam.
5. **Dead repo paths: 15 fixed.** `infra/hetzner/provision.sh` (1), `infra/hetzner/main.tf` (1),
   `supabase/config.toml` (7 lines, 6 distinct paths), `.env.example` (3), and one each in
   `tests/gjd-remote-env.test.ts`, `tests/chat-markdown-render.test.tsx`,
   `tests/overseer-usage.test.ts`. Also `scripts/gjd-remote-log.ts`, which named `remote-box.md`.
   The one left is `.env.example`'s `src/store/live.ts`, which is history ("that went on
   2026-09-06").
6. **Three tutorial banners**, each a `.callout.warn` (a class every one of the pages already has)
   under the "written" line: `import-pipeline-and-database.html`, `architecture.html`,
   `revisions-and-the-schema.html`. `docs/project/tutorials.md` already asks for this: *"say so in
   the doc if you find it has drifted"*.

## Claims in the plan or the brief that turned out false

- **"Each pointer is rewritten to the file that now holds the section."** Four sections had no
  heading to point at, in the split files or in the single file before it (item 1).
- **`src/structure.ts` uses "Hierarchy" as the step's current name.** It does not: its only hits are
  "(called `hierarchy` until 2026-10-02)" and file names of plans and eval results. The stale line
  was in `src/web/structure.ts`.
- **".env.example has four dead paths".** Three, plus one that is history.
- **"supabase/config.toml has six".** Six paths on seven lines.
- **"`mode-band.css` and `referee.css` … 'this file already gives twice'".** The fade rule that
  comment cites is in `shell.css` and `table.css`, not `referee.css`; the comment now says "these
  stylesheets".
- **`src/billing/admission.ts` and `src/store/blobs.ts`** both said `src/store/index.ts` refuses to
  boot on a filesystem store. It has no such refusal; the blob refusal is in `postgresBlobStore`.

## What was left, and why

Reported for the orchestrator to place; none is a comment I could make true without changing code
or leaving my file set.

- **Three pieces of code the comments were covering for.** (a) `FEEDBACK_NOT_AVAILABLE` and the
  `res.status === 501` branch in `src/web/FeedbackDialog.tsx`: nothing in `src/` sends a 501 any
  more. (b) `writeRawFiles` in `src/fetch.ts`: its only caller is
  `tests/stage2c-raw-bytes.test.ts`. (c) `schema === undefined` in `src/vercel-health.ts`:
  `cachedSchemaCheck` returns a `SchemaCheck`, never `undefined`. Each comment now says so.
- **A reader-visible string:** `src/web/Metadata.tsx` has the tooltip *"…the rungs of the leftmost
  gist column"*. Not a comment, and reader-facing copy, so not this cluster's.
- **Strings, not comments:** eight `"…filesystem store…"` strings in `src/store/article-rows.ts`
  (the export manifest's own notes), and `"gist column"` in `src/vocabulary.ts`.
- **Legacy-layout parity, left as written:** `src/store/export.ts`, `export-bundle.ts`,
  `pg-chat.ts`, `pg-referee-criteria.ts`, `pg-shelf.ts` (one) and two columns in
  `src/db/schema.ts` say "what the filesystem store writes". They describe the export layout that
  `tests/store-roundtrip.test.ts` still pins byte for byte, so the sentence is about a format that
  is still live.
- **`styles.css` named without a `§`: 145 lines** in `src tools scripts tests`. Outside the grep
  this cluster was given; many are true (tests that read the import order).
- **Dangling `§ plain, centred` and `§ the modes segment` inside the stylesheets themselves** (eight
  lines in six CSS files). Same fault as item 1, in files the grep did not name.
- **`GIST_MIN` in `src/web/layout.ts`** is a constant named for a deleted thing, and still used for
  the narrow-window sum. Renaming it is code.
- **`structure-mode.css` says the panel does not scroll "the same rule as Outline"**, and
  `outline-mode.css` has a `§ a list that scrolls`. Not verified either way; only the gist-column
  half of that sentence was fixed.
- **`tests/`**: 211 lines mention the filesystem store. The brief scoped the sweep to `src`,
  `scripts` and `tools`.
- **Cluster S1's files** (`src/billing-plan.ts`, `scripts/store-migration-*`,
  `scripts/migrate-fs-toc-to-hierarchy.ts`, `knip.jsonc`) were not opened for editing.

## The check that no behaviour changed

For the 102 changed `.ts`, `.tsx` and `.css` files: compile the `HEAD` version and the working
version of each with esbuild (`transformSync`, `minifyWhitespace: true`, `legalComments: "none"`,
`jsx: "preserve"`), which drops every comment, and compare the output bytes.

```
compiled-identical: 102
DIFFERENT: 0 []
```

The check was seen to fail: adding one character to a string literal in `src/messages.ts` gave
`DIFFERENT: 1 [ 'src/messages.ts' ]`, and removing it gave 0 again. (A first run without
`minifyWhitespace` reported 19 files different; esbuild keeps some comments inside expressions
unless it is minifying whitespace.)

The other seven files, read by hand from `git diff HEAD`:

- `.env.example`, `supabase/config.toml`, `infra/hetzner/main.tf`: every changed line starts `#`.
- `infra/hetzner/provision.sh`: one line, inside the heredoc that writes the loopback block into
  `~/.ssh/config`, and it is a `#` comment in that generated file. The guard that decides whether
  to write the block greps for `gjd-remote-loopback`, which is unchanged, so a box that already has
  the block is not rewritten. **This is the one changed line a program writes out.**
- The three tutorials: 31 lines added, none removed.

## Gates

- `npm run typecheck`: clean (all projects, 3336 files covered).
- `npx vitest run` on the 18 test files whose comments changed, plus `doc-links`, `one-store-only`,
  `env-names-are-inventoried`, `gjd-remote-provision`, `touch-controls`, `hit-colours` and
  `fleet-pause`: 25 files, 909 tests, all passed.
- `npx biome lint` on the changed files: the baseline is not clean; no suppression comment was
  added, removed or moved (`grep` of the diff for `biome-ignore`, `eslint-disable`, `@ts-`: 0).
- The full `npm test` was not run; the orchestrator runs it on the branch.
