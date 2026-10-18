/**
 * **Front and back matter by its authored labels, with no model call** — GPT
 * Sol's "simpler version" in the plan review of 261018a, measured beside the
 * classifier (src/matter.ts) as the second baseline. If it matches the
 * classifier with no prose folded, it is what gets built.
 *
 * Two sources, then the classifier's own shared checks (`holdStretches`):
 *
 * - **Today's byline rule** (src/web/front-matter.ts § `frontMatter`), as one
 *   `authors` stretch. Its evidence test is its own, so it is trusted.
 * - **Exact authored labels** (`labelKinds`): *Abstract*, *Keywords*,
 *   *Contents*, *Acknowledgements*, *Funding*, *References*, *Bibliography*,
 *   the declaration labels. A label may be a heading or a short paragraph of
 *   only the label, as every label in arXiv 2308.08708's opening is. A heading
 *   takes its section (`labelledSection`, the classifier's rule); a paragraph
 *   takes the blocks after it up to the next label or heading, shrunk until
 *   its evidence holds. Each with positional evidence: front kinds in the
 *   opening window, references in the trailing part, the acknowledgements,
 *   funding and declarations family in either.
 * - **Inline labels**: a run of paragraphs that open "Funding: …",
 *   "Competing interests: …" (that family only), as one stretch.
 */
import {
  BACK_MATTER_FROM_SHARE,
  CONTENTS_LEADING_SHARE,
  type MatterAdmitted,
  type MatterArticle,
  type MatterCandidate,
  type MatterKind,
  MAX_RANGE_WORDS,
  holdStretches,
  labelKinds,
  labelledSection,
  matterWindows,
  stretchEvidence,
} from "./matter.js";
import type { Block, BlockId } from "./types.js";
import { type FrontMatterArticle, frontMatter } from "./web/front-matter.js";

/** Kinds that belong at the top. */
const FRONT: ReadonlySet<MatterKind> = new Set(["abstract", "keywords", "contents", "authors"]);
/** Kinds that may sit either side: "Details" at the top of a report, "Acknowledgements" at the end of a paper. */
const EITHER: ReadonlySet<MatterKind> = new Set(["acknowledgements", "funding", "declarations"]);

export type LabelsArticle = MatterArticle & FrontMatterArticle & { blocks: readonly Block[] };

export function matterByLabels(article: LabelsArticle, echo: ReadonlySet<BlockId>): MatterAdmitted {
  const { blocks } = article;
  const n = blocks.length;
  const w = matterWindows(blocks);
  const candidates: MatterCandidate[] = [];
  let item = 0;

  const byline = frontMatter(article, echo);
  if (byline.length > 0) {
    const at = blocks.findIndex((b) => b.id === byline[0]);
    candidates.push({ item: item++, start: at, end: at + byline.length, kinds: ["authors"], headedBy: null, shape: "range", trusted: true });
  }

  const placed = (i: number, kinds: readonly MatterKind[]): boolean => {
    const front = i < w.openEnd || i < n * CONTENTS_LEADING_SHARE;
    const back = i >= n * BACK_MATTER_FROM_SHARE;
    return kinds.every((k) => (FRONT.has(k) ? front : EITHER.has(k) ? front || back : back));
  };

  for (let i = 0; i < n; i++) {
    const block = blocks[i]!;
    if (block.kind !== "heading" && block.kind !== "text") continue;
    const kinds = labelKinds(block.text);
    if (kinds === null || !placed(i, kinds)) continue;
    if (block.kind === "heading") {
      if (kinds.includes("abstract") || kinds.includes("keywords") || kinds.includes("authors")) {
        /* Not section kinds: the heading labels the paragraphs after it, as a paragraph label would. */
      } else {
        const section = labelledSection(article, i, kinds);
        if (typeof section !== "string") candidates.push({ item: item++, ...section, kinds: [...kinds], shape: "section" });
        continue;
      }
    }
    /* A label paragraph: the blocks after it, to the next label or heading.
       An abstract takes one paragraph: an unlabelled introduction often
       follows it with no heading between (full-spya-vpm5g9 in the eval). */
    let end = i + 1;
    while (end < n && blocks[end]!.kind !== "heading" && labelKinds(blocks[end]!.text) === null) end++;
    if (kinds.includes("abstract")) end = Math.min(end, i + 2);
    /* Shrink until the evidence and the range cap hold: an abstract with no
       label after it must not take the introduction along. */
    let words = 0;
    for (let j = i; j < end; j++) {
      words += blocks[j]!.words;
      if (words > MAX_RANGE_WORDS) {
        end = j;
        break;
      }
    }
    while (end > i + 1 && stretchEvidence(article, i, end, kinds) !== null) end--;
    candidates.push({ item: item++, start: i, end, kinds: [...kinds], headedBy: null, shape: "range" });
  }
  for (const run of inlineLabelRuns(blocks, placed)) candidates.push({ item: item++, ...run, headedBy: null, shape: "range" });
  return holdStretches(article, candidates, echo);
}

const MATTER_ORDER: readonly MatterKind[] = ["acknowledgements", "funding", "declarations"];

/**
 * **Inline labels**: runs of paragraphs that each open with a known label of
 * the acknowledgements, funding and declarations family and a colon
 * ("Funding: …", "Competing interests: …"), as PLOS, PMC and eLife print
 * them. One stretch a run, so two short lines make one stub; empty blocks
 * between them do not break it.
 */
function inlineLabelRuns(
  blocks: readonly Block[],
  placed: (i: number, kinds: readonly MatterKind[]) => boolean,
): { start: number; end: number; kinds: MatterKind[] }[] {
  const n = blocks.length;
  const at = (i: number): readonly MatterKind[] | null => {
    const kinds = i < n ? inlineLabel(blocks[i]!) : null;
    return kinds !== null && placed(i, kinds) ? kinds : null;
  };
  const runs: { start: number; end: number; kinds: MatterKind[] }[] = [];
  for (let i = 0; i < n; i++) {
    const first = at(i);
    if (first === null) continue;
    const all = new Set<MatterKind>(first);
    let end = i + 1;
    for (;;) {
      let j = end;
      while (j < n && blocks[j]!.words === 0) j++;
      const next = at(j);
      if (next === null) break;
      for (const k of next) all.add(k);
      end = j + 1;
    }
    runs.push({ start: i, end, kinds: MATTER_ORDER.filter((k) => all.has(k)) });
    i = end - 1;
  }
  return runs;
}

/** The office kinds of a paragraph that opens "Label: …", or `null`. */
function inlineLabel(block: Block): readonly MatterKind[] | null {
  if (block.kind !== "text") return null;
  const m = /^([^:\n]{1,80}):\s+\S/u.exec(block.text.trim());
  if (!m) return null;
  const kinds = labelKinds(m[1]!);
  return kinds?.every((k) => EITHER.has(k)) ? kinds : null;
}
