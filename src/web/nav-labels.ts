/**
 * **Whether to draw the paragraph label layer at all.**
 *
 * One rule, in one place, for the surfaces that draw leaf `navLabel`s:
 * Structure's list face at rung 5 and its columns' paragraph rows. The spine's
 * hover card degrades on its own and is left alone.
 * `docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md` § F8 is why
 * the layer is withheld rather than drawn.
 *
 * **Withholding, not announcing.** Structure climbs to the paragraph rung on
 * its own, so where the labels are not there the rung simply is not either and
 * nothing is said. (Until 2026-09-29 Hierarchy's `Paragraphs` pill and leaf
 * column said a sentence instead, because a reader had asked for the layer by
 * name there; both went with that mode, and the sentence with them —
 * docs/plans/260929d-remove-hierarchy-mode-and-heading-numbers.md.)
 *
 * ## Why withhold rather than draw what there is
 *
 * A `navLabel` is optional on a `TreeNode`, and an absent one has always meant
 * *deliberately unlabelled* — a caption, a pull-quote, a rule. Every consumer
 * reads it that way and is right to: a paragraph row renders
 * `navLabel ?? title`, and on a leaf `title` is normally `""`, so a missing
 * label is **a visible blank row**. `src/web/tree.ts` already names the shape
 * of that failure — *"a run of forty blank leaf cells"*.
 *
 * So while the labels have not landed, drawing the layer would report **our
 * unfinished work as the article's own structure**: forty blank rows that read
 * as forty paragraphs nobody could name. Nothing errors, nothing logs, and the
 * reader has no way to tell it from an article that is simply like that
 * (docs/reusable/silent-success.md). Withholding the whole layer is the honest
 * answer.
 *
 * `failed` is withheld exactly as `pending` is: both mean *these are not
 * here*, and a reader can act on neither.
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
