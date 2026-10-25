/**
 * **Front and back matter by its authored labels, with no model call** — GPT
 * Sol's "simpler version" in the plan review of 261018a, measured beside the
 * classifier (src/matter.ts) as the second baseline. If it matches the
 * classifier with no prose folded, it is what gets built.
 *
 * Four sources, then the classifier's own shared checks (`holdStretches`):
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
 * - **A contents list with no label** (`linkedContentsRuns`, plan 261024h):
 *   short lines that each link to one of the article's later headings, placed
 *   as a *Contents* label would be. A page's label can be lost before this
 *   (Readability dropped `<h1 class="toc-header">`, spya-jk0xw5) or never be
 *   there at all.
 * - **A summary the author put at the front** (`summaryAt`, plan 261025f): an
 *   *Executive summary*, *Key points*, *Highlights*, *Significance* or
 *   *Author summary* label in the opening that nothing of the article's own
 *   outranks, and its run. Only this rule finds them; the model is not asked.
 */
import {
  BACK_MATTER_FROM_SHARE,
  CONTENTS_LEADING_SHARE,
  CONTENTS_MAX_ENTRY_WORDS,
  type MatterAdmitted,
  type MatterArticle,
  type MatterCandidate,
  type MatterKind,
  MAX_RANGE_WORDS,
  contentsEntryMatchesHeading,
  holdStretches,
  labelKinds,
  labelledSection,
  matterWindows,
  stretchEvidence,
  summaryAt,
} from "./matter.js";
import { inPageHrefs } from "./matter-current.js";
import type { Block, BlockId } from "./types.js";
import { type FrontMatterArticle, frontMatter } from "./web/front-matter.js";

/** Kinds that belong at the top. */
const FRONT: ReadonlySet<MatterKind> = new Set(["abstract", "keywords", "contents", "authors"]);
/** Kinds that may sit either side: "Details" at the top of a report, "Acknowledgements" at the end of a paper. */
const EITHER: ReadonlySet<MatterKind> = new Set(["acknowledgements", "funding", "declarations"]);
/** Substantive previews that may link to their later sections but are never a contents list: at the front, one is a summary (`summaryAt`). */
const CONTENTS_PREVIEW_LABEL = /^\s*(?:key points?|highlights?|significance|executive summary|author summary)\s*:?\s*$/iu;

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

  /* An entry of a linked contents list is not a label: one that reads
     "Abstract" would otherwise label the next entry as the abstract and take
     the start of the list (review of 261024h). */
  const linked = placedLinkedContentsRuns(blocks, (start) => placed(start, ["contents"]));

  for (let i = 0; i < n; i++) {
    const block = blocks[i]!;
    if (block.kind !== "heading" && block.kind !== "text") continue;
    if (insideRun(i, linked)) continue;
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
  /* A front summary under its label (`summaryAt` holds where it sits and how far it runs). */
  for (let i = 0; i < w.openEnd; i++) {
    const run = summaryAt(article, i);
    if (typeof run !== "string") candidates.push({ item: item++, ...run, kinds: ["summary"], headedBy: null, shape: "range" });
  }
  for (const run of inlineLabelRuns(blocks, placed)) candidates.push({ item: item++, ...run, headedBy: null, shape: "range" });
  for (const run of linked) candidates.push({ item: item++, ...run, kinds: ["contents"], headedBy: null, shape: "range" });
  return holdStretches(article, candidates, echo);
}

/** A contents list with no label links to at least this many distinct headings. */
export const LINKED_CONTENTS_MIN_ENTRIES = 3;

function placedLinkedContentsRuns(
  blocks: readonly Block[],
  placed: (start: number) => boolean,
): { start: number; end: number }[] {
  const followsPreviewLabel = (start: number): boolean => {
    let i = start - 1;
    while (i >= 0 && blocks[i]!.words === 0) i--;
    return i >= 0 && CONTENTS_PREVIEW_LABEL.test(blocks[i]!.text);
  };
  return linkedContentsRuns(blocks).filter((run) => placed(run.start) && !followsPreviewLabel(run.start));
}

const insideRun = (index: number, runs: readonly { start: number; end: number }[]): boolean =>
  runs.some((run) => index >= run.start && index < run.end);

/**
 * **Tables of contents with no label** (plan 261024h): runs of short text
 * blocks, empty blocks allowed between, each linking to a heading of the
 * article that comes after it, together naming at least
 * `LINKED_CONTENTS_MIN_ENTRIES` distinct headings. Each entry's text must name
 * the heading that its own link targets. A labelled "Key points" list is never
 * contents even when it meets this structural rule: the caller vetoes that
 * label, and a front one folds as a summary instead. Where a run sits is the
 * caller's to check, and the shared checks still hold it to its entries naming
 * the headings (`stretchEvidence`'s unlabelled contents).
 * `[start, end)`, ending at the last entry.
 */
export function linkedContentsRuns(blocks: readonly Block[]): { start: number; end: number }[] {
  const headingAt = new Map<string, { index: number; block: Block }>();
  blocks.forEach((b, i) => {
    if (b.kind === "heading") headingAt.set(b.id, { index: i, block: b });
  });
  const runs: { start: number; end: number }[] = [];
  let start = -1;
  let last = -1;
  let named = new Set<string>();
  const close = () => {
    if (start >= 0 && named.size >= LINKED_CONTENTS_MIN_ENTRIES) runs.push({ start, end: last + 1 });
    start = -1;
    named = new Set();
  };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.words === 0 && b.kind !== "heading") continue;
    const target =
      b.kind === "text" && b.words <= CONTENTS_MAX_ENTRY_WORDS
        ? inPageHrefs(b.html).find((id) => {
            const heading = headingAt.get(id);
            return heading !== undefined && heading.index > i && contentsEntryMatchesHeading(b, heading.block);
          })
        : undefined;
    if (target === undefined) {
      close();
      continue;
    }
    if (start < 0) start = i;
    named.add(target);
    last = i;
  }
  close();
  return runs;
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
