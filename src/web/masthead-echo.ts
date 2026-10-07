/**
 * **The leading blocks that only repeat the masthead.**
 *
 * Greg, spya-t6cdve, 2026-10-06: *"Why does this article seem to show the title
 * twice on the page?"* The masthead (Masthead.tsx) draws the title, and block 0
 * of the prose is an `<h1>` with the same words.
 * docs/plans/261007b-the-title-is-drawn-once-and-the-masthead-loses-its-back-arrow.md
 * § The rule has the reasoning and the plan review this answers.
 *
 * This file only says which blocks; nothing is removed from the article, and
 * models, exports and the other bands still see every block.
 */
import { findMathSpans } from "../maths-tex.js";
import type { Article, Block, BlockId } from "../types.js";

/** As much of an article as the rule reads: an owner's and a visitor's both have it. */
export type EchoArticle = Pick<Article, "blocks" | "titleOverridden"> & {
  meta: Pick<Article["meta"], "title">;
};

const NONE: ReadonlySet<BlockId> = new Set();

/** Trimmed, whitespace collapsed, lower-cased: how two titles are compared. */
function sameWords(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(a) === norm(b);
}

/**
 * Whether a block's html is its own tag around text and nothing else.
 * `Block.html` is the element's `outerHTML`, so the outer tag and its stamped
 * id are expected; a second `<` anywhere inside is markup. Entities are text.
 */
function plain(block: Block): boolean {
  return /^<([a-z0-9]+)\b[^<>]*>[^<]*<\/\1>$/.test(block.html.trim());
}

/**
 * The debug page's `<div class="meta">` (src/extract.ts § `debugPage`), which
 * stage 3 stores as a `p`: `Author · Site · ~84 min read`, or `· ~26 min read`
 * when nobody was named. The words alone are not provenance: a newly extracted
 * article can open with its own byline in exactly that form. The legacy
 * template's line breaks and two-space indent survive in `Block.html`, so the
 * matcher requires those as well as the dot and suffix. An author's source
 * could imitate that exact whitespace, but ordinary authored paragraphs cannot
 * be mistaken for the wrapper merely because of what they say.
 */
const OUR_LINE = /·\s*~\d+ min read$/;
/* `[^<]*` and not `[^<\n]*`: a byline can run over several lines (an arXiv one
   does, and it is the reported article's). What the template fixes is how the
   paragraph opens and how it closes. */
const OUR_LINE_HTML = /^<p\b[^<>]*>\n {2}[^<]*\n {2}· ~\d+ min read\n<\/p>$/;

function isOurLine(block: Block): boolean {
  return (
    block.tag === "p" &&
    plain(block) &&
    OUR_LINE.test(block.text.trim()) &&
    OUR_LINE_HTML.test(block.html.trim())
  );
}

/**
 * **The ids of at most two leading blocks the prose table does not draw.**
 *
 * Two rules, and only ever blocks 0 and 1:
 *
 * - **The wrapper's shape**: an `h1` and then our reading-time line. Every web
 *   article imported before `debugPage` stopped writing a header starts this
 *   way, and both blocks are ours by construction, so the title is not
 *   compared: a visitor's payload has the tidied title, which need not equal
 *   the heading (GPT Sol, plan review F4).
 * - **The same words at block 0**: an `h1` of plain text that says what the
 *   masthead says. A PDF's own title, and a web article imported since.
 *
 * **A renamed article keeps its first heading** under both rules: the masthead
 * then shows the reader's name for the piece and the prose shows, once, the
 * author's (F3; `titleOriginal` cannot tell, `titleOverridden` can). Our line
 * goes either way, because it is never anybody's words but ours.
 *
 * Never a later heading: on a web page the author's own `<h1>` can be block 2,
 * with formatting the plain masthead does not have (F2).
 */
export function mastheadEcho(article: EchoArticle): ReadonlySet<BlockId> {
  const [first, second] = article.blocks;
  if (first === undefined || first.tag !== "h1") return NONE;
  const ourLine = second !== undefined && isOurLine(second) ? second : null;
  /* Maths is asked of the text because that is where it is: TeX stays in the
     words until the prose draws it (maths.ts), and the masthead never does. */
  const sameAsMasthead = () =>
    plain(first) && findMathSpans(first.text).length === 0 && sameWords(first.text, article.meta.title);
  const out = new Set<BlockId>();
  if (!article.titleOverridden && (ourLine !== null || sameAsMasthead())) out.add(first.id);
  if (ourLine !== null) out.add(ourLine.id);
  return out;
}
