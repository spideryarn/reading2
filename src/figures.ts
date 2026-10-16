/**
 * **Which blocks are the article's figures, tables and media** — the stops of
 * Skim's *Figures* walk and the marks on Structure's rows (Greg, spya-sb0c7e:
 * *"I would quite like to be able to jump to all the tables and figures and
 * media easily"*). docs/plans/261011b-skim-figures-walk-and-structure-figure-marks.md.
 *
 * Read off the stored blocks alone: no model call, no pipeline step, nothing to
 * cache. Pure, so the server and the browser can both ask it.
 *
 * **What stage 3 hands us** (src/blocks.ts § classify, describeBlock): a
 * `<figure>`, `<img>`, `<hr>` or `<iframe>` is `kind: "media"`, and so is a
 * paragraph holding only an image; a `<table>` is `kind: "other"`; a paragraph
 * reading *"Figure 2: …"* beside a picture is its own `kind: "caption"` block.
 * So `kind` alone over-counts — an `<hr>` and a pull-quote's `<figure>` are
 * media too — and under-counts, missing every table. Hence the markup.
 */

import type { Block, BlockId } from "./types.js";
import { RESERVED_ATTRS } from "./reserved.js";

/** What a reader would call it — the icon and the noun on its row. */
export type FigureKind = "figure" | "table" | "media";

export interface Figure {
  blockId: BlockId;
  /** Index into `blocks` — what a range check counts with (block-ids.md). */
  row: number;
  kind: FigureKind;
  /**
   * The author's caption — its own `<figcaption>` / table `<caption>`, else the
   * caption paragraph beside it — or `null` when it has none, and the row says
   * *"Table 2"*.
   */
  caption: string | null;
  /** 1-based, among figures of the same kind: *"Figure 3"* when there is no caption. */
  ordinal: number;
}

const PICTURE = /<(img|svg|picture|canvas)\b/i;
const TABLE = /<table\b/i;
const PLAYER = /<(video|audio|iframe)\b/i;
const IMG = /<img\b[^>]*>/gi;
const OWN_CAPTION = /<(?:figcaption|caption)\b[^>]*>([\s\S]*?)<\/(?:figcaption|caption)>/i;

/**
 * **An image shorter than this is lettering, not a figure.** Paul Graham's
 * essays set their title as a 190 × 18 GIF; a figure that small says nothing.
 * Only a height the markup declares counts — an image with none is kept.
 */
const MIN_HEIGHT = 48;

/** Whether a block is a figure, a table or a medium, and which — or `null`. */
export function figureKindOf(block: Block): FigureKind | null {
  const tag = block.tag.toLowerCase();
  const html = block.html;
  if (tag === "hr") return null;
  if (tag === "table") return isLayoutTable(html) ? null : "table";
  /* Not leaves in stage 3, so one carrying text of its own (a title, a
     fallback line) arrives as a block of whatever kind; an empty one is
     dropped there and never reaches us (GPT Sol, plan review F1). */
  if (tag === "video" || tag === "audio") return "media";
  if (tag === "svg" || tag === "canvas") return "figure";
  if (block.kind !== "media") return null;
  /* A pull-quote set in a <figure> — with a portrait beside it or not. */
  if (/<blockquote\b/i.test(html)) return null;
  if (TABLE.test(html)) return isLayoutTable(html) ? null : "table";
  if (PLAYER.test(html)) return "media";
  /* A PDF's figure carries its marker before its picture is fetched — the
     image arrives later (src/web/rehost.ts), and the place is a figure either way. */
  if (html.includes(RESERVED_ATTRS.pdfFigure)) return "figure";
  if (!PICTURE.test(html)) return null; // a pull-quote's <figure>
  if (onlyLettering(html)) return null;
  return "figure";
}

/**
 * **A table that is not a table of data**: LaTeXML sets each displayed
 * equation as `<table class="ltx_equation ltx_eqn_table">` (src/latexml.ts
 * rewrites only the equation *groups*), and a page laid out in a table says
 * `role="presentation"`. Display maths is not a figure (plan § What counts).
 */
function isLayoutTable(html: string): boolean {
  const open = /<table\b[^>]*>/i.exec(html)?.[0] ?? "";
  return /\bltx_eqn|\bltx_equation/.test(open) || /\brole\s*=\s*["']?(presentation|none)\b/i.test(open);
}

/** Every `<img>` declares a height under `MIN_HEIGHT`, and nothing else is drawn. */
function onlyLettering(html: string): boolean {
  if (/<(svg|picture|canvas)\b/i.test(html)) return false;
  const imgs = html.match(IMG) ?? [];
  if (imgs.length === 0) return false;
  return imgs.every((img) => {
    const h = /\bheight\s*=\s*["']?(\d+)/i.exec(img);
    return h !== null && Number(h[1]) < MIN_HEIGHT;
  });
}

/**
 * **A table drawn as a picture is still a table.** A PDF's table the model
 * could not copy cell by cell arrives as a picture, and some journals publish
 * theirs as images; the markup says *figure*, the author's caption says
 * *"Table 1."*, and a reader asking for the tables means it (Greg,
 * spya-s8pf4r: *"Do we include Tables as well as Figures in Skim mode?"*).
 * The number is required, so *"Tables and chairs…"* stays a figure; on
 * purpose that also misses a bare letter (*"Table A"*).
 */
const TABLE_CAPTION = /^(?:(?:supplementary|supplemental|extended data)\s+)?table\s+(?:[a-z]?\d+[a-z]?|[ivxlcdm]+)\b/i;

/** The article's figures, tables and media, in reading order. */
export function figuresOf(blocks: readonly Block[]): Figure[] {
  const out: Figure[] = [];
  const counts: Record<FigureKind, number> = { figure: 0, table: 0, media: 0 };
  const claimed = new Set<number>();
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const drawn = figureKindOf(block);
    if (drawn === null) continue;
    const caption = captionOf(blocks, i, claimed);
    const kind = drawn === "figure" && caption !== null && TABLE_CAPTION.test(caption) ? "table" : drawn;
    counts[kind] += 1;
    out.push({ blockId: block.id, row: i, kind, caption, ordinal: counts[kind] });
  }
  return out;
}

/**
 * **The figure's caption**: its own `<figcaption>` / table `<caption>`, else a
 * caption paragraph straight after it, else one straight before it (a table's
 * is usually above) that no figure before has already taken.
 */
function captionOf(blocks: readonly Block[], i: number, claimed: Set<number>): string | null {
  const own = ownCaptionOf(blocks[i]!);
  if (own !== null) return own;
  for (const j of [i + 1, i - 1]) {
    const near = blocks[j];
    if (near?.kind === "caption" && !claimed.has(j) && near.text.trim()) {
      /* A table's caption sits above it: one between a picture and a table
         of data is the table's, not the picture's — but only if that table
         will really take it rather than its own or a following caption. */
      if (j === i + 1 && TABLE_CAPTION.test(near.text.trim()) && tableClaimsCaptionBefore(blocks, j + 1, claimed)) {
        continue;
      }
      claimed.add(j);
      return near.text.trim();
    }
  }
  return null;
}

/** A non-empty caption nested in the figure/table block itself. */
function ownCaptionOf(block: Block): string | null {
  const own = OWN_CAPTION.exec(block.html);
  if (!own) return null;
  return textOf(own[1]!) || null;
}

/**
 * Whether this table will fall back to the caption immediately before it.
 * Look through runs of `caption → table`: a following caption is unavailable
 * when that next table genuinely needs it, but not when the next table has a
 * caption of its own. The recursion only moves forward, one table at a time.
 */
function tableClaimsCaptionBefore(blocks: readonly Block[], i: number, claimed: Set<number>): boolean {
  const block = blocks[i];
  if (!block || figureKindOf(block) !== "table" || ownCaptionOf(block) !== null) return false;

  const afterIndex = i + 1;
  const after = blocks[afterIndex];
  if (after?.kind === "caption" && !claimed.has(afterIndex)) {
    const text = after.text.trim();
    if (text) {
      const reservedForNext = TABLE_CAPTION.test(text) && tableClaimsCaptionBefore(blocks, afterIndex + 1, claimed);
      if (!reservedForNext) return false;
    }
  }

  const beforeIndex = i - 1;
  const before = blocks[beforeIndex];
  return before?.kind === "caption" && !claimed.has(beforeIndex) && Boolean(before.text.trim());
}

/** A fragment's text: tags out, the entities the sanitizer writes decoded, space collapsed. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (_, e: string) => {
      const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
      const lower = e.toLowerCase();
      if (lower in named) return named[lower]!;
      const code = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** *"Figure 3"*, *"Table 1"*, *"Media 2"* — a figure with no caption of its own. */
export function figureName(figure: Pick<Figure, "kind" | "ordinal">): string {
  return `${FIGURE_NOUN[figure.kind]} ${figure.ordinal}`;
}

export const FIGURE_NOUN: Record<FigureKind, string> = { figure: "Figure", table: "Table", media: "Media" };

/**
 * **How many of each kind lie in rows `start..end`, inclusive** — the mark on
 * a Structure row. By row index, never by comparing ids (block-ids.md).
 */
export function figuresInRange(
  figures: readonly Figure[],
  start: number,
  end: number,
): Record<FigureKind, number> {
  const counts: Record<FigureKind, number> = { figure: 0, table: 0, media: 0 };
  /* A scan, not a prefix sum: an article has tens of figures at most. */
  for (const f of figures) if (f.row >= start && f.row <= end) counts[f.kind] += 1;
  return counts;
}
