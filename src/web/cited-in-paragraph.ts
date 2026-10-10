/**
 * **The works a claim's paragraph cites** — Sources' bridge between its
 * halves (plan 261009l § C1): under each claim in Claims, the works the article
 * cites in the paragraph the claim was found in, each a press away from its
 * Bibliography row.
 *
 * > I'm inclined to go with B and then C1 to begin with.
 * >
 * > — Greg, 2026-10-09 (spya-vcvxu5)
 *
 * **What the join proves is only that they share a paragraph.** Two claims in
 * one paragraph both get all of its works, and nothing here says a work
 * supports the claim — so the line is headed *Cited in this paragraph*, never
 * *supports this claim*, and carries no verdict (the plan's § Passed over).
 *
 * The key is the block id, the one contract (docs/project/block-ids.md): a
 * claim stores the paragraph its quote was re-found in (`ListedClaim.blockId`),
 * and a cited work every body paragraph that cites it (`CitedWork.citedAt`).
 * **Best-effort, not complete** (GPT Sol's F6): a work's direct mentions are
 * capped, so a heavily cited work can be missing from a late paragraph. The
 * works keep the Bibliography's stored order — each work's first citation in
 * the whole piece — not their order inside this paragraph.
 */
import type { BlockId } from "../types.js";
import { shortAuthors } from "./BibliographyPanel.js";

/** The fields of a cited work the line reads — the owner's `CitedWork` and a visitor's `PublicCitedWork` both have them. */
export interface CitableWork {
  id: string;
  title: string;
  authors?: string;
  year?: string;
  citedAt: readonly BlockId[];
}

/** What Claims needs to draw the line: the article's cited works, and the move to one's Bibliography row. */
export interface CitedInParagraph {
  works: readonly CitableWork[];
  onOpen(workId: string): void;
}

/** The works whose citing paragraphs include `blockId`, in Bibliography's stored order. */
export function worksCitedIn<W extends CitableWork>(blockId: BlockId, works: readonly W[]): W[] {
  return works.filter((work) => work.citedAt.includes(blockId));
}

/** A title longer than this is cut at a word for the line; the whole title is in the press's tooltip. */
const TITLE_SHOWN = 48;

/**
 * **A work's name on the line**: *Smith et al. 2019* when the article gives
 * authors, the title (cut short) when it does not, and the year after either
 * when there is one. The article's own bibliography fields, never the
 * registry's: this is a pointer to the row, which says where each field came
 * from.
 */
export function workShortName(work: Pick<CitableWork, "title" | "authors" | "year">): string {
  const authors = work.authors?.trim() ? shortAuthors(work.authors.trim()) : "";
  const year = work.year?.trim() ?? "";
  const lead = authors !== "" ? authors : cut(work.title.trim());
  return year !== "" ? `${lead} ${year}` : lead;
}

function cut(title: string): string {
  if (title.length <= TITLE_SHOWN) return title;
  const head = title.slice(0, TITLE_SHOWN);
  const space = head.lastIndexOf(" ");
  return `${space > TITLE_SHOWN / 2 ? head.slice(0, space) : head}…`;
}
