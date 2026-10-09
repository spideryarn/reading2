# Metadata's AI processing, named as the modes are

Report `spya-u62q09` (SPIDERYARN-READING2-FW), Greg, 2026-10-09, on the Attention paper's Metadata
page; queue item `qi-yckkzqah`.

> Can you make sure that the AI processing sections here map to whatever we're calling the nodes, or
> have a clear explanation of what they are?
>
> And in general, if you rename stuff, make sure that you've renamed it thoroughly. So not just in
> the UI, but also variables and comments and file names and database columns and whatever else.
>
> — Greg, 2026-10-09

## What is wrong today

*AI processing* (src/web/Metadata.tsx § `RerunSection`) has two lists, and they name the same steps
three different ways, none of which is reliably the name the reader meets in the bar:

| step | re-run row (`RERUN_LABEL`) | record row (`STEPS[step].label`, then the key) | where the reader meets it |
|---|---|---|---|
| `tweets` | Thread | Writing the thread · `tweets` | Summary › Thread |
| `sketch` | Sketch | Drawing the argument · `sketch` | Diagram › Sketch |
| `illustrated` | — | Painting the argument · `illustrated` | Diagram › Illustrated |
| `quiz` | Quiz | Writing the questions · `quiz` | Learn › Quiz |
| `faq` | FAQ | Finding the questions · `faq` | FAQ |
| `debate` | Reception | Asking the web · `debate` | Peer review › Reception |
| `citations` | Bibliography | Finding what it cites · `citations` | Peer review › Bibliography |
| `debate-claims` | — | Listing its claims · `debate-claims` | Peer review › Claims |
| `simple` | Simple summary | Writing it in plain words · `simple` | Summary › Brief and Fuller |
| `arc` | Arc | Writing the arc · `arc` | a sentence per part, in Structure |
| `relations` | Relation words | Reading how the paragraphs connect · `relations` | words beside paragraphs, in Marginalia |
| `crossrefs` | Cross-references | Linking the article to itself · `crossrefs` | links in the prose |
| `labels`, `blocks`, `assets`, … | — | present-tense labels | nowhere by that name |

*Writing the questions* and *Finding the questions* are two different modes; *Asking the web* does
not say Reception; nothing says what an *Arc* is.

## The change

**One table, `STEP_PLACE: Record<StepName, …>`, in a new client leaf `src/web/step-names.ts`**,
saying for every step where the reader meets what it makes:

- **a mode** (`glossary` → Glossary) — name `MODE_LABEL[mode]`, explanation the mode catalogue's
  `description`;
- **a sub-mode** (`tweets` → Summary › Thread) — name `Mode › Sub` exactly as the command bar
  already writes it (src/web/command-runners.ts), explanation the sub-mode's `description`
  (src/web/sub-modes.ts);
- **neither** (`arc`, `relations`, `crossrefs`, `simple`, `labels`, the pipeline's own steps) — its
  own short noun and one plain line saying what it is and where it shows.

Names and descriptions are **read from the tables that already own them**, never copied, so the
in-flight rename of Peer review to Sources (`qi-m9tmnpy3`, session `fbc2qmbg-rename-to-sources`)
changes these rows without touching this file. A `Record<StepName, …>` makes a new step a compile
error here.

Then:

1. **Re-run rows** draw `stepName(step)` and, under it, `stepWhat(step)` in the faint line the cost
   note already uses (the note stays, after it). `RERUN_LABEL` is derived from `stepName` rather than
   kept as a second list, so the command bar's *Run again* rows read `Summary › Thread › Run again`
   — the same form its *Open* rows use. The words that find a row keep the leaf name as well as the
   path, so `thread` still finds it.
2. **Record rows** ("What we did to it") lead with `stepName(step)`, keep the mono key beside it
   (what `npm run <step>` takes), and put `stepWhat(step)` first on the second line. The server's
   present-tense label (*Writing the arc*) leaves this row; it stays on the wire and in job progress,
   where *doing* is what it describes.

**Not done, and why.** The step keys themselves (`debate`, `citations`, `tweets`) are stored names;
`debate` and `citations` are being renamed by `qi-m9tmnpy3`, and `tweets` → `thread` is a separate
deep rename this report did not ask for. The mono key is shown as a key — what a command takes —
and the name before it is now the reader's. Renaming the server's `label` strings would be a second
vocabulary to keep in step; dropping them from this row is the simpler fix.

**The simpler option passed over:** rewording `RERUN_LABEL` and the server labels in place. That
leaves two lists of names for one set of steps, the drift that produced this report.

## The second paragraph: renaming thoroughly

Already a rule — AGENTS.md § Writing code and
[rename-or-move.md § A rename on screen is a rename all the way down](../reusable/rename-or-move.md#a-rename-on-screen-is-a-rename-all-the-way-down).
Its list says identifiers, files, URL words, CSS classes, tests, docs and stored values; it does
not name **comments** or **column and table names** (stored *values* is not columns), which Greg
named. A rule doc is edited only with his approval
([edit-important-docs.md](../reusable/edit-important-docs.md)), so the before/after goes to him as a
question file rather than an edit.

## Checks

- `tests/step-names.test.ts`: every step has a non-empty name and explanation; sub-mode and mode
  entries read the owning tables (change a label, the name follows); `Thread`'s row reads
  `Summary › Thread`.
- Existing command-bar re-run tests updated to the path label, and `thread` / `rerun terms` still
  find their rows.
- `npm test`, `npm run typecheck`; a screenshot of the section on desktop and at 390px.

## GPT Sol's plan review, and what changed

[The review](261009u-metadata-ai-processing-named-as-the-modes-are-plan-review-sol.md), five
findings, all taken except where said:

1. **The Sources rename renames the step keys and `peer-review` too** (P2). Taken in part: the
   labels follow on their own, and the keys in `STEP_PLACE` are a `Record<StepName, …>`, so
   whichever of the two lands second gets a compile error naming every row to move. Landing now
   rather than waiting a day or two for that session; it was told.
2. **Search names from the leaf, and `simple` is two leaves** (P2). Taken, except *keep the full
   path as an alias*: tried, and it broke `rerun peer review picks neither of its paid runs`
   (`rerun peer review › bibliography` answers `rerun peer review`). So the leaf only, plus
   `brief` and `fuller` for `simple`; a test types each sub-mode's name.
3. **Every row in the plan, Arc in Marginalia too, blocks are not only paragraphs** (P2). Taken:
   the table below; *Blocks*, not *Paragraphs*, the word At a glance already counts them by.
4. **`RESET_EXTRA_NAME` was a third list** (P2). Taken: deleted; the reset section names steps with
   `stepName`, and `tests/reset-extra-names.test.ts` went with it (its job, every extra named, is
   now `Record<StepName, …>` plus `tests/step-names.test.ts`).
5. **`npm run <step>` is not the general command** (P3). Taken: the comment names
   `npx tsx scripts/stage.ts <step> <slug>`.

Found by the existing suite, not the review: **a step this copy does not know** (a newer server,
or `__proto__`) must not be looked up blind. `stepName(step, fallback)` reads with `ownLabel` and
falls back to the server's label; `stepWhat` to nothing.

## As built: every step

| step | name | line under it |
|---|---|---|
| `fetch` | Source | The page or PDF, downloaded from where it lives |
| `metadata` | Title and abstract | The title, authors and abstract, read off a paper's first pages |
| `extract` | Article text | The article's own text, taken out of the page around it |
| `blocks` | Blocks | The text cut into paragraphs, headings, quotes and figures, each with the id everything else points at |
| `structure` | Structure | (the mode's own line) |
| `labels` | Paragraph labels | A few words naming each paragraph, shown down the spine and in Structure |
| `assets` | Figures | The article's own images, copied so they keep loading |
| `arc` | Arc | One sentence per part saying where the argument stands, shown in Structure and Marginalia |
| `tweets` | Summary › Thread | (the sub-mode's) |
| `glossary`, `quotes`, `ideas`, `timeline`, `faq`, `skim` | the mode | (the mode's) |
| `quiz` | Learn › Quiz | (the sub-mode's) |
| `relations` | Relation words | The small words Marginalia puts beside a paragraph where the argument turns (so, but, vs) |
| `sketch`, `illustrated` | Diagram › Sketch, Diagram › Illustrated | (the sub-modes') |
| `debate`, `debate-claims`, `citations` | Peer review › Reception, › Claims, › Bibliography | (the sub-modes') |
| `crossrefs` | Cross-references | Links in the prose from a claim to the passage it rests on |
| `simple` | Summary › Brief and Fuller | The piece in plain words, short and longer |
