/**
 * **Each heading's section, as block indices.** Pure and dependency-free, so
 * both the reading view's fold store (src/web/fold.ts) and the front- and
 * back-matter pass (src/matter.ts) ask one definition of "a heading's
 * section" (plan 261018a, review F8).
 *
 * A heading at level L owns every following block up to, not including, the
 * next heading whose level is L or coarser. So an H3 under an H2 is part of
 * the H2's section. A heading with no recorded level counts as the narrowest,
 * 6. Ranges are by array index, never by comparing ids (block-ids.md § The
 * cost we accepted).
 */

/** As much of a block as a section needs. Every `Block` satisfies it. */
export interface SectionBlock {
  id: string;
  kind: string;
  level?: number | null | undefined;
}

/** One heading's section: `start` is the heading's own index, `end` one past its last block. */
export interface SectionRange<Id extends string = string> {
  id: Id;
  start: number;
  end: number;
}

/** The level a heading with no recorded level counts as: the narrowest. */
export const NO_LEVEL = 6;

/** A heading's level for sectioning, or `null` when the block is not a heading. */
export function headingLevel(block: SectionBlock): number | null {
  return block.kind === "heading" ? (block.level ?? NO_LEVEL) : null;
}

/** Every heading's section, in document order. */
export function sectionRanges<B extends SectionBlock>(blocks: readonly B[]): SectionRange<B["id"]>[] {
  const out: SectionRange<B["id"]>[] = [];
  /** Headings whose section is still open, coarsest first, as indices into `out`. */
  const open: { at: number; level: number }[] = [];
  blocks.forEach((block, i) => {
    const level = headingLevel(block);
    if (level === null) return;
    while (open.length > 0 && open[open.length - 1]!.level >= level) out[open.pop()!.at]!.end = i;
    open.push({ at: out.length, level });
    out.push({ id: block.id, start: i, end: blocks.length });
  });
  return out;
}
