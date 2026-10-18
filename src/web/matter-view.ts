/**
 * **The stretches the reading view folds, and the words on each one's stub** —
 * front and back matter: title, authors, abstract, keywords, contents, dates,
 * acknowledgements, funding, declarations, references.
 *
 * Greg, 2026-10-17 (`spya-ftsqsn`): *"Mark it up as being less interesting
 * … And default-collapse it"*; and `spya-k7gm2b`: *"delicate UI (including an
 * information-button/tooltip) so that they don't get in the way, but that the
 * user can notice/discover them if needed."*
 * docs/plans/261018a-front-and-back-matter-marked-at-import-and-folded-by-default.md
 * § Stage 3.
 *
 * Pure, so the prose table (TableView.tsx), Structure (StructureMode.tsx) and
 * the tests all ask the same question of the same article. The fold store
 * (fold.ts) does the hiding; this only says which blocks and what the stub
 * says. **Nothing here comes from a model's words**: a label is built from the
 * closed list of kinds, a count from the blocks (plan review F4).
 */
import type { Article, Block, BlockId, MatterKindName } from "../types.js";
import { type FrontMatterArticle, frontMatter } from "./front-matter.js";

/**
 * The kinds in the order `MATTER_KINDS` (src/matter.ts) has them, which is the
 * order a label names them in. A copy because src/matter.ts reaches the
 * server's model gateway and must not be imported here;
 * tests/matter-view.test.ts holds the two equal.
 */
export const MATTER_KIND_ORDER: readonly MatterKindName[] = [
  "title",
  "authors",
  "abstract",
  "keywords",
  "contents",
  "dates",
  "acknowledgements",
  "funding",
  "declarations",
  "references",
];

/** As much of an article as this reads. A visitor's has `matter` under the owner's rule (plan 261018l), and no `authors`. */
export type MatterViewArticle = FrontMatterArticle & { matter?: Article["matter"] | undefined };

/**
 * One stretch to fold: its blocks in document order (never an echo row), the
 * index of its first and last block, and what it is.
 */
export interface ViewStretch {
  ids: readonly BlockId[];
  /** Index of the first block, which is the stub's row. */
  start: number;
  /** Index of the last block, inclusive. */
  end: number;
  kinds: readonly MatterKindName[];
}

const NO_STRETCHES: readonly ViewStretch[] = [];

/** A stretch as the block indices it spans, inclusive: what Structure's rows are measured against. */
export type MatterRange = Pick<ViewStretch, "start" | "end">;

/**
 * **Every stretch to fold, in document order.** One function, so the table and
 * Structure cannot disagree about what is folded:
 *
 * - the stored `matter` when the article carries it (the owner's read hands it
 *   over only when it is valid and about these very blocks, and a visitor's
 *   under the same rule; src/matter-current.ts § `matterForReader`). An empty
 *   list is an answer: nothing to fold;
 * - otherwise today's byline rule (front-matter.ts), as one `authors` stretch,
 *   so every article that folded before this still folds — an old article and
 *   a failed step, for an owner and a visitor alike.
 *
 * **Resolved by index, never by comparing ids** (block-ids.md § The cost we
 * accepted). A stretch whose ends are not current blocks, or whose `from` comes
 * after its `to`, is dropped; one that overlaps an earlier stretch is dropped
 * too. The read checked all of this already; it is checked again because a
 * stretch the table cannot draw would be a stub over nothing.
 *
 * **The masthead's echo is subtracted** (plan review F7). The echo is hidden
 * for good and never revealed, so a stub on an echo row could never be seen or
 * opened. What is left of a stretch keeps its kinds, bar the title: the echo
 * is the title, and the masthead shows it, so a stub over the byline that is
 * left reads *Authors and affiliations*, not *Title and authors*. A stretch
 * that was only echo is dropped.
 */
export function matterStretches(
  article: MatterViewArticle,
  echo: ReadonlySet<BlockId>,
): readonly ViewStretch[] {
  const { blocks } = article;
  if (article.matter === undefined) {
    const run = frontMatter(article, echo);
    if (run.length === 0) return NO_STRETCHES;
    const index = indexOf(blocks);
    const start = index.get(run[0]!);
    const end = index.get(run[run.length - 1]!);
    if (start === undefined || end === undefined) return NO_STRETCHES;
    return [{ ids: run, start, end, kinds: ["authors"] }];
  }
  const index = indexOf(blocks);
  const out: ViewStretch[] = [];
  let last = -1;
  for (const s of article.matter) {
    const from = index.get(s.from);
    const to = index.get(s.to);
    if (from === undefined || to === undefined || from > to || from <= last) continue;
    last = to;
    /* Each unbroken run of non-echo blocks is a stretch. The echo is a leading
       run, so this is one stretch or none; the loop costs nothing for the case
       that cannot happen and keeps a stretch contiguous if it ever does. */
    let run: BlockId[] = [];
    let runStart = -1;
    /* The echo is the title, so a stretch that lost its echo row no longer
       holds the title: the masthead shows it. Its stub would otherwise read
       *Title and authors* over the byline alone. */
    let kinds: readonly MatterKindName[] = s.kinds;
    if (kinds.length > 1 && blocks.slice(from, to + 1).some((b) => echo.has(b.id))) {
      kinds = kinds.filter((k) => k !== "title");
    }
    const flush = (endAt: number) => {
      if (run.length > 0) out.push({ ids: run, start: runStart, end: endAt, kinds: [...kinds] });
      run = [];
    };
    for (let i = from; i <= to; i++) {
      const id = blocks[i]!.id;
      if (echo.has(id)) {
        flush(i - 1);
        continue;
      }
      if (run.length === 0) runStart = i;
      run.push(id);
    }
    flush(to);
  }
  return out;
}

function indexOf(blocks: readonly Block[]): Map<BlockId, number> {
  return new Map(blocks.map((b, i) => [b.id, i]));
}

/**
 * **Whether a row from `start` to `end` (indices, inclusive) is wholly
 * matter** — Structure's faint rows (plan review F9): inside one stretch, or
 * inside stretches back to back with no block between them. "Title and
 * Abstract" is two stretches and nothing else, and pressing it opens both
 * (fold.ts § `openStretchesWithin`); the browser pass of 261018a found it
 * drawn as body text while everything it names was folded. A row that only
 * partly overlaps, or that crosses a gap between two, is not faint. By index,
 * never by comparing ids.
 */
export function coveredByStretches(start: number, end: number, stretches: readonly MatterRange[]): boolean {
  let next = start;
  for (const s of stretches) {
    if (s.start <= next && s.end >= next) next = s.end + 1;
    if (next > end) return true;
  }
  return false;
}

/* ------------------------------------------------------------ the stub -- */

/** What each kind is called on a stub, on its own. */
const KIND_LABEL: Record<MatterKindName, string> = {
  title: "Title",
  authors: "Authors and affiliations",
  abstract: "Abstract",
  keywords: "Keywords",
  contents: "Contents",
  dates: "Publication details",
  acknowledgements: "Acknowledgements",
  funding: "Funding",
  declarations: "Declarations",
  references: "References",
};

/** What each kind is, in one plain line, for the stub's ⓘ. */
const KIND_WHAT: Record<MatterKindName, string> = {
  title: "The title, as the page repeats it.",
  authors: "Who wrote it, where they work, and how to reach them.",
  abstract: "The authors' own summary of the paper.",
  keywords: "The keywords and subject codes it is filed under.",
  contents: "The piece's own table of contents.",
  dates: "When it was received, accepted and published, its DOI, licence and citation.",
  acknowledgements: "The authors' thanks.",
  funding: "Who paid for the work.",
  declarations: "Author contributions, competing interests, and where the data and code are.",
  references: "The works it cites.",
};

/** At most this many kinds are named; the rest are counted in the lines. */
const LABEL_KINDS = 3;

/**
 * The kinds a stub names, in `MATTER_KIND_ORDER` (so the title, when it is
 * there, comes first), and the first three.
 */
export function namedKinds(kinds: readonly MatterKindName[]): MatterKindName[] {
  return MATTER_KIND_ORDER.filter((k) => kinds.includes(k)).slice(0, LABEL_KINDS);
}

/**
 * **The stub's label**, sentence case: *Abstract*; *Authors and affiliations,
 * abstract and keywords*; *Title and authors*. Only from the closed kinds,
 * never from the article or the model.
 *
 * **A stretch with the title in it says so first**, and calls its authors just
 * *authors*. The browser pass of 261018a found the title-and-byline stretch and
 * the authors' list further down both reading *Authors and affiliations*, two
 * stubs a reader could not tell apart; and *Title and authors and
 * affiliations* does not read.
 */
export function stubLabel(kinds: readonly MatterKindName[]): string {
  const titled = kinds.includes("title");
  const label = (k: MatterKindName) => (titled && k === "authors" ? "Authors" : KIND_LABEL[k]);
  const named = namedKinds(kinds).map((k, i) => (i === 0 ? label(k) : lowerFirst(label(k))));
  if (named.length === 0) return "Folded";
  if (named.length === 1) return named[0]!;
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A block with nothing in it is not a line anybody would count. */
function isEmpty(block: Block): boolean {
  return block.text.trim() === "";
}

/**
 * **The stub's count**, from the blocks: *200 words* for an abstract on its
 * own, *251 entries* for references (every non-empty block that is not a
 * heading, so the *References* heading is not an entry), and *N lines*
 * (non-empty blocks) for everything else. References win over the abstract
 * when a stretch is somehow both, because a count of words in a bibliography
 * says nothing.
 */
export function stubCount(stretch: Pick<ViewStretch, "start" | "end" | "kinds">, blocks: readonly Block[]): string {
  const inside = blocks.slice(stretch.start, stretch.end + 1);
  const main = stretch.kinds.filter((k) => k !== "title");
  if (main.includes("references")) {
    return plural(inside.filter((b) => !isEmpty(b) && b.kind !== "heading").length, "entry", "entries");
  }
  if (main.length === 1 && main[0] === "abstract") {
    return plural(
      inside.filter((b) => b.kind !== "heading").reduce((n, b) => n + b.words, 0),
      "word",
      "words",
    );
  }
  return plural(inside.filter((b) => !isEmpty(b)).length, "line", "lines");
}

/** The ⓘ card's first paragraph: one plain line per kind the label names. */
export function stubWhat(kinds: readonly MatterKindName[]): string {
  return namedKinds(kinds)
    .map((k) => KIND_WHAT[k])
    .join(" ");
}

/**
 * The ⓘ card's second paragraph: what Spideryarn did, and that nothing is gone.
 * The opening matter folds "so the page starts with the article"; at the back
 * of the piece that would be untrue, so it says what is true there.
 */
export function stubHow(atFront: boolean): string {
  return atFront
    ? "Spideryarn folds this away so the page starts with the article. Nothing is removed."
    : "Spideryarn folds this away so the article ends where its own text does. Nothing is removed.";
}

/** The ⓘ card's action line. */
export const STUB_PRESS = "Press the line to read it here.";

/** Whether a stretch is opening matter rather than closing: it starts in the first half. */
export function atFront(stretch: Pick<ViewStretch, "start">, blocks: readonly Block[]): boolean {
  return stretch.start < blocks.length / 2;
}
