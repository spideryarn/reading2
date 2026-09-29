# Remove Hierarchy mode; strip the article's own numbers from the headings we number

Two feedback reports from Greg, one session, because both are about the structure stage and how it
is drawn.

> Remove the Hierarchy mode altogether. I think the Structure mode is better/sufficient. P.S. Does
> that simplify our Import process at all?
>
> — Greg, 2026-09-29, feedback SPIDERYARN-READING2-4B (overseer queue `qi-e9zj8t23`)

> Sometimes the headings (e.g. in Structure mode) have numbers at the beginning, which is weird
> because the system *also* adds its own numbered headings/levels. This looks silly/duplicative, and
> confusing (because they don't always agree). So perhaps we should remove numbers from the
> beginning of headings, either with a regex (which might need to also find `1. ` and `1) `, or with
> the LLM that does the Structure mode).
>
> — Greg, 2026-09-29, feedback SPIDERYARN-READING2-4Q (overseer queue `qi-ac2z88kt`)

Both are from an admin, so this is "build it", simplest version first
([feedback-reports.md § Who sent it](../project/feedback-reports.md#who-sent-it)).

Ancestors: [260912e](260912e-hierarchy-behind-the-experimental-switch.md) (Hierarchy behind the
switch), [260910g](260910g-structure-mode-subsumes-outline.md) (the precedent: Outline retired into
Structure through `RETIRED_MODES`), [260903b](260903b-one-structure-mode-hierarchy-and-outline-merged.md)
(the merge that was deferred, not rejected).

## The P.S.: does it simplify import? Hardly — no pipeline step becomes unused

Hierarchy mode is a *view* of the tree, and has had no artefact of its own since the arc left its L0
column on 2026-09-05. Every step in `STEP_ORDER` still has a consumer after the mode goes:

| Step / field | Who still reads it |
|---|---|
| `fetch`, `extract`, `blocks` | everything |
| `hierarchy` (tree.json: `title`, `range`, `depth`) | Spine, Structure (both faces), Summary, Diagram, `outline.ts`, keynav |
| tree `gist` at every depth | Summary (with its depth cut-off), Structure rungs 2–5, Spine cards, hover cards, Masthead, Metadata, shelf/library, page head, public reader; and server-side as context for arc, glossary, ideas, quotes, timeline, quiz, faq, tweets, sketch, trajectory, link-summary |
| tree `question` | Summary |
| root `summary` | Metadata, public reader |
| the deepen / expand / cascade passes inside `hierarchy` | the deep levels are still Structure's section and paragraph rows and Summary's depths |
| `labels` (leaf `navLabel`) | Spine, Structure's paragraph rungs (`structure.ts`, `outline.ts`) — not Hierarchy-only |
| `arc` | Structure's narrow face, rung 4 (`buildArcColumn` → OutlinePanel) |
| every other step | its own mode (or Remember / Diagram) |

So the ingest pipeline, its model calls and its cost are unchanged. **What does get simpler is the
client**: the gist columns beside the prose (`ColumnPanels` in TableView, ContextPanel/ContextList
and their fisheye CSS), the fitting of those columns in `layout.ts`, the `?cols=` and `?text=`
parameters and their rewrites, the Parts / Sections / Paragraphs controls bar, and the ←/→ column
stride. That is a large deletion — the tabular view was the first thing this app drew — and it is
the real answer to "does it simplify".

A pipeline simplification would need a product change beyond this one — e.g. dropping leaf
`navLabel`s would need Structure's paragraph rung to go too. Not proposed; named here so it is a
choice rather than a surprise.

## Decisions

1. **`?mode=hierarchy` opens Structure**, through `RETIRED_MODES` in `src/modes.ts` — the same route
   `?mode=outline` takes. Structure is the view Greg named as its replacement, and it draws the same
   tree. The old `?mode=hierarchy&text=0 → structure` special case in `readMode`, the router's
   `hidesProse` rewrite and last-view's version of it collapse into that one rule.
2. **The aliases `toc` and `contents` move to Structure** in `MODE_CATALOG`, so somebody typing
   "contents" into the command bar still lands on the structural view. (The catalog refused
   `structure` as a Hierarchy alias because an alias that is another mode's name is misleading; the
   reverse move has no such problem.)
3. **`?cols=` and `?text=` stop meaning anything.** They are read nowhere once the mode goes, and a
   stale one is ignored like any unknown parameter — the `liftStrandedText` rewrite that tidied
   `text=0` goes with the mode rather than being kept to tidy a parameter nothing reads. Likewise
   `mode=hierarchy` stays in an old URL and parses as Structure, as `mode=outline` does. Old links
   keep working; they are just not canonical.
4. **The gist-column machinery is deleted, not left dormant.** Greg said "altogether", and dead code
   that draws a whole view is the most expensive kind to leave lying around. Shared pieces stay:
   `useColumnContext`'s focus sampling (Structure), `context.ts`'s `Tier` (outline.ts),
   `buildArcColumn`, `fitMode` / `bandCoversProse` / `structureColumnsBand`, ↑/↓ keynav and the
   helpers DiagramPanel, TermJump and swipe share. `knip` and the typechecker find the rest.
5. **The pipeline step keeps its name, `hierarchy`**, and so do the tree, `hierarchy.md`, and
   CLAUDE.md's line that Hierarchy and the granularity-zoom tree are one structure. That line is
   about the tree and is still true.
6. **Heading numbers (4Q): a regex, applied where we number, not where the article arrives.**
   Not the LLM: a regex is deterministic, free, needs no re-run of any article, and fixes the
   articles already on the shelf the moment the build ships. Not in the pipeline either: the stored
   tree keeps the article's own words. The seam is `buildSummaryTree` (`src/web/tree.ts`), which is
   where our numbers are minted and which Summary, both Structure faces and Diagram all read:
   `SummaryNode` gains a derived display `title`, stripped only when its own `number` is non-empty,
   and those surfaces draw it instead of `node.title`. The Spine, which draws a title with no number
   of ours beside it, keeps the article's wording. The prose is never touched.
   (First draft put this at the payload seam beside `sanitizeArticle`; GPT Sol's plan review F1
   pointed out that also rewrote the Spine, which has no number of ours to duplicate.)
7. **The controls bar stays for visitors.** It is mostly Hierarchy's (the Parts / Sections /
   Paragraphs pills), but it also carries `ViewOnlyChip`, which on narrow mode views is the only
   thing telling a visitor they are read-only (Sol F2). The Hierarchy half goes; the chip keeps its
   bar.
8. **←/→ keep Trajectory.** Only the gist-column stride goes from `useArrowNav`; the dispatch to
   Trajectory's stop controller stays, with its test (Sol F4).

### The regex

Strip a leading enumerator only when it is followed by whitespace and then more text, and keep the
title as it was if nothing would remain:

- `1 Intro`, `1. Intro`, `1) Intro`, `(1) Intro`, `1: Intro`, `1 – Intro`
- `3.2 Methods`, `3.2. Methods`, `A.1 Proofs`
- roman numerals (I, V, X only) with a `.` or `)`: `IV. Results`, `ii) Setup` — but a single
  letter followed by a lower-case word is kept, since `V. cholerae` and `X. laevis` are species
  (Sol F3)
- non-breaking spaces count as spaces; `(3.2) Methods` and `1.2.3 Methods` strip

Deliberately **not** stripped:

- anything with a component of three or more digits — `2008 financial crisis`, `1984 and after`
- a bare letter — `C. elegans`, `A Quick Tour`, `U.S. policy` (the appendix `A. Proofs` keeps its
  letter; cheaper than mis-stripping a word)
- a bare roman numeral with no punctuation — `I think`, `V for Vendetta`
- the root's title, which is the article's title, not a section
- `Section 3:` / `Chapter 2 —` — not what was reported; deferred

A listicle heading like `10 things` does lose its `10`, which is fine: in a listicle the number is
the ordinal, and ours is beside it.

## Stages

1. **Heading numbers (4Q).** A pure function `withoutOwnNumber(title)` with a table-driven test
   (red first) covering the list above; `SummaryNode.title` derived in `buildSummaryTree`
   (stripped only where `number` is non-empty); Summary, Structure (both faces, rows and cards) and
   Diagram draw it. A test that the Spine and the raw `TreeNode.title` are unchanged. Small and
   independent of the mode work, so it runs in parallel with stage 2.
2. **Retire the mode (4B).** `MODES`, `MODE_CATALOG`, `MODE_LABEL`, Dock `MODES_UI`, visitor
   `COSTS`, activation, ModeBoundary, passages, Reader's `modeBand` case, the Features page's
   "Zoom, in Hierarchy mode" showcase; `RETIRED_MODES.hierarchy = "structure"`; aliases to
   Structure; `inMode` gone from Reader (always true); the controls bar reduced to the visitor's
   `ViewOnlyChip`; the `text=0` rewrites
   gone. Mode-specific tests edited to the new rule (address-settling, public-read-rewrite,
   last-view, router, url-state, command-match, visitor-gaps, mode-herald-wiring,
   dock-experimental-modes, a-broken-mode, every-mode-draws-its-surface, page-head), and a new
   assertion that `?mode=hierarchy` opens Structure with the right tab title.
3. **Delete what is now dead.** TableView's column parts, ContextPanel, ContextList,
   `column-context.css`, `colsParam` / `textParam` / `parseAsDepths`, `fitView`'s gist arm,
   `offerableGists`, `barHasContent`, `columnLabel` / `columnHint`, the paragraph pill and notice,
   the gist-column swipe and the ←/→ stride — and their tests (layout, aimed-column, column-names,
   context, paragraph-labels-withheld, bar-motion, the stride half of keynav). Fixtures that set
   `cols=` are checked one by one. `npm run knip` is the sweep.
4. **Docs.** reading-view-overview, experimental-features (Hierarchy's row and section become
   "retired on 2026-09-29"), granularity-zoom (a status banner: the tree is live, the tabular view
   is gone — the doc stays as the tree's reference and the history of the view), url-state (`cols`,
   `text`), keyboard, touch, new-mode, web-client, architecture, narrow-windows, summaries,
   performance, page-titles, browser-testing, export, diagram, reader-profile — each a line, not a
   rewrite. Notes in `docs/user-feedback/` for both reports.

Each stage: `npm run typecheck`, the touched tests, a commit. After stage 3: the full suite, a GPT
Sol code review (write-capable), and a browser check at desktop and phone widths —
`?mode=hierarchy` lands in Structure, Plain is still the bare article, and Structure's headings
carry one number.

## What is deferred

- Any pipeline change (above): none is needed, and the only one on offer is a product change.
- `Section 3:` / `Chapter 2` style prefixes, and headings whose number sits at the end.
- Renumbering Structure to *match* the article's own numbers instead of stripping them. It would
  keep "3.2" meaning what the paper means, which is attractive for papers cross-referencing
  "see §3.2" — but the article's numbering is often partial or inconsistent, which is what Greg
  found confusing. Stripping is the simple version; this is the one to revisit if a reader misses
  the paper's own numbers.

## Status

- 2026-09-29: plan written. GPT Sol plan review (read-only): no P0; P1s F1 (seam) and F2 (visitor
  chip) and P2s F3 (species names) and F4 (Trajectory ←/→) all taken into decisions 3, 6, 7, 8 and
  the regex list above; F5 (stale-parameter wording) clarified in decision 3. It confirmed the P.S.
  answer, noting only that Masthead, Metadata, library and page head read the *root* gist.
- 2026-09-29: stages 1–4 built (`bd7db73b`), by two Opus subagents in parallel and a Sonnet docs
  pass. What differed from the plan:
  - The heading function lives in its own module, `src/web/heading-number.ts`, and `scatter.ts`
    (Diagram's scatter) reads the stripped title too. Summary's aria-labels and Structure's card
    child names use it, so the words match what is drawn beside them.
  - The controls bar is now **only** the visitor's: `showBar = owner === null`, holding
    `ViewOnlyChip`. An owner has no bar.
  - `hierarchy` joined `toc` and `contents` as a Structure alias, as `outline` did in 260910g.
  - The Zoom showcase came off both the Features page and the Landing page (they shared one shot),
    and the screenshot was deleted.
  - Deleted whole: `ContextPanel.tsx`, `ContextList.tsx`, `swipe.ts`, `column-context.css`,
    `touch.css` (it held only the swipe rule), and their tests. The keynav aim became a ref, so a
    pointer move no longer re-renders the reader.
  - Known false positive, accepted: a section title that begins with a decimal ("1.5 million
    people") loses the "1.5". The rules cannot tell it from "3.2 Methods".
  - Net: 110 files, −6,412 / +834 lines. The import pipeline is untouched.
- 2026-09-29: GPT Sol code review, round one (write-capable), on `bd7db73b`: one real bug, C1 —
  Structure's focus sampler dropped a first measurement of row 0 after a layout change, leaving a
  stale row highlighted; fixed with a test, which I saw red without the fix and green with it. C2–C4
  were stale tests, C6 swipe-only branches left in `scroll.ts`. All fixed in `bc68cbfb`. It confirmed
  ↑/↓, Trajectory's ←/→, the visitor chip, prose touch and centring, and the title seam, and found no
  test weakened to pass.
- Vitest was refused for most of the session by the box's memory admission guard (swap full). The
  50 touched test files ran once memory cleared: 48 green, and the three failures in the other two
  (doc links to deleted files, and shared-inventory's tree row) are fixed in `bc68cbfb`.
- 2026-09-29: GPT Sol round two, on `bd7db73b..bc68cbfb` only: PASS, no open P0 or P1. Its one
  finding (R1, P3) was two stale comments in `scroll.ts`, fixed. Discovery closed.
- Full suite after merging `origin/dev`: 1186 files green, 6 red. Two were the known fresh-worktree
  pair (`cold-start-lazy-imports`, `pdf-bundle-trace`), which pass after `npm run build`. Three were
  the fleet dashboard's tests, which need a fleet build this worktree never made, so they are not
  this change. One was real: `eager-client-graph`'s `SHARED_WITH_READER` still listed `pill.ts` and
  `ui/toggle.tsx`, which only the Hierarchy bar had pulled into the reader's startup; both lines were
  removed. `npm run build` passes.
- Browser check (Playwright, 1400px and 390px, a numbered-heading paper): `?mode=hierarchy` (with
  and without `cols`/`text`) opens Structure; there is no Hierarchy button, even with the switch on;
  "toc" and "hierarchy" in the command bar find Structure; Plain is centred, with no gaps; ↑/↓ step;
  "2.1. Defining Key Dimensions" draws as "3.1 Defining Key Dimensions"; Summary and Diagram render;
  a signed-out visitor keeps the View-only chip; no new console errors. As decision 3 accepts, the
  address keeps `mode=hierarchy`, and so does a stored last view.
