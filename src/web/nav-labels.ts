/**
 * **Whether to draw the paragraph label layer at all, and what to say instead.**
 *
 * One rule, in one place, because three surfaces read it and they must agree:
 * the `Paragraphs` pill in the controls bar, the leaf column of the table when
 * it is open, and Outline mode's rung 5. A fourth — the spine's hover card —
 * degrades on its own and is left alone, which is why it is not listed.
 * `docs/project/granularity-zoom.md` § the tabular view has the surfaces;
 * `docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md` § F8 is why
 * the layer is withheld rather than drawn.
 *
 * **Withholding is not the same as announcing.** Where the reader asked for the
 * layer by name — the pill, and the leaf column they already had open — one
 * sentence stands in for it. Where nobody asked — Outline's rung 5, which the
 * band climbs to on its own, and a leaf column that is not on screen at all —
 * the layer simply is not there and nothing is said. Saying it anyway is what
 * put a `<td>` into a table that had no column for it, and took the article's
 * prose off the right edge of the window (TableView § `withheldLeafCell`).
 *
 * ## Why withhold rather than draw what there is
 *
 * A `navLabel` is optional on a `TreeNode`, and an absent one has always meant
 * *deliberately unlabelled* — a caption, a pull-quote, a rule. Every consumer
 * reads it that way and is right to: the `Paragraphs` column renders
 * `navLabel ?? title`, and on a leaf `title` is normally `""`, so a missing
 * label is **a visible blank cell**. `src/web/tree.ts` already names the shape
 * of that failure — *"a run of forty blank leaf cells"*.
 *
 * So while the labels have not landed, drawing the layer would report **our
 * unfinished work as the article's own structure**: forty blank rows that read
 * as forty paragraphs nobody could name. Nothing errors, nothing logs, and the
 * reader has no way to tell it from an article that is simply like that
 * (docs/reusable/silent-success.md). Withholding the whole layer is the honest
 * answer, and where the reader has *asked* for it by name, one sentence saying
 * why is better than an empty column.
 *
 * ## `failed` is withheld exactly as `pending` is
 *
 * The only difference between them is the sentence. Both mean *these are not
 * here*, and a reader can act on neither — the labels arrive when a job runs,
 * and the owner is the only person who could start one. What `failed` must
 * never carry is a reason: a provider's error body is the one place an upstream
 * can echo the article back at us (docs/project/copy.md § rule 4), so the enum
 * is the whole of what crosses either DTO and there is nothing here to render.
 *
 * ## No bracketed code
 *
 * These are not failures a model call returned, so they follow the
 * `src/job-state.ts` family rather than `src/messages.ts` — see
 * docs/project/copy.md § The bracketed code, which argues the case for
 * *"Waiting to continue."* and it is the same case. A code on *"Paragraph
 * labels are still arriving"* would invite a bug report about a pipeline doing
 * exactly what a pipeline does.
 */
import type { NavLabelStatus } from "../types.js";

/**
 * May the paragraph label layer be drawn?
 *
 * **Written as `=== "ready"` and not as `!== "pending"`**, so that a value the
 * database's CHECK somehow let through — or a fourth member added to
 * `NavLabelStatus` and not thought about here — withholds the layer rather than
 * drawing blanks. The safe direction is the one where the reader sees less.
 */
export function paragraphLabelsReady(status: NavLabelStatus): boolean {
  return status === "ready";
}

/**
 * What to say where the reader asked for the layer by name — the `Paragraphs`
 * pill, and the leaf column when outline mode has made it the view.
 *
 * `null` when there is nothing to say, which is the ordinary case: the labels
 * are there and the column draws them.
 *
 * Short, plain, and it says whose problem it is without using the word — *still
 * arriving* is a thing that finishes, *aren't available* is a thing that does
 * not. Neither asks the reader to do anything, because there is nothing they
 * can do (docs/project/copy.md § rule 3: where the answer is "nothing", say
 * that too — here the sentence says it by not offering a way out).
 */
export function paragraphLabelNotice(status: NavLabelStatus): string | null {
  switch (status) {
    case "ready":
      return null;
    case "pending":
      return "Paragraph labels are still arriving.";
    case "failed":
      return "Paragraph labels aren't available.";
  }
}

/**
 * **What the controls bar puts where the `Paragraphs` pill goes** — the pill
 * itself, or the sentence standing in for it.
 *
 * The sentence replaces the pill rather than sitting in its tooltip, because a
 * touch reader cannot open a tooltip. But `toggle` in App.tsx is the **only**
 * caller of `setCols`, so replacing the pill also removes the only way to
 * *close* the column — and the leaf depth can already be open without the pill
 * having done it, from a `?cols=` that was shared or bookmarked. Such a reader
 * was left with a wide column of one repeated sentence and no way to shut it,
 * for ever if the status is `failed`.
 *
 * So the sentence stands in only while the column is **shut**, which is the case
 * it was written for: it stops the column being opened onto nothing. Once the
 * column is open the pill comes back, because the column is already carrying the
 * sentence (TableView § `withheldLeafCell`) and what the reader needs from the
 * bar is the way out. GPT Sol's F2 on stage 1, 2026-09-06.
 *
 * A function here rather than a ternary at the call site so it can be tested
 * without standing up the whole reading view — the defect it fixes is one a
 * component test of the table could not see.
 */
export function paragraphPill(status: NavLabelStatus, leafOn: boolean): "toggle" | "notice" {
  return paragraphLabelsReady(status) || leafOn ? "toggle" : "notice";
}
