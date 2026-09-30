/**
 * **The paper's own figures, as ingredients for the Illustrated plates.**
 *
 * > For the illustrated diagrams, make sure we feed in the figures from the
 * > paper, and perhaps it can try and sort of create or incorporate those
 * > somehow as part of the montage.
 * >
 * > — Greg, 2026-09-30 (SPIDERYARN-READING2-5X)
 *
 * Stage 4.5 already stores the figures a PDF came with
 * (docs/project/article-images.md). This finds the stored ones, in reading
 * order, and loads their bytes so the brief can name them and the illustrator
 * can be handed them as `input_references` — the same field the zoom plates
 * already use for the overview's style (src/illustrated.ts § `drawPlates`).
 * docs/plans/260930f-illustrated-diagram-draws-on-the-paper-figures.md.
 *
 * ## PDF figures only, and web images deliberately not
 *
 * A PDF figure is a picture the paper printed, paired to its own caption by
 * stage 4.5 (`<figure>` with a `<figcaption>`, the block's own text). A web
 * article's `<img>` is anything at all — a portrait, a banner, a logo — and its
 * caption, when it has one, is usually a *separate* block after it. Telling a
 * figure from decoration there, and finding its caption, is its own piece of
 * work; the plan defers it (GPT Sol's plan review, finding 3).
 *
 * ## Found by the same walk the assets step uses
 *
 * `pdfFigureMarkersIn` (src/collect-assets.ts), never a second reading of the
 * attribute. It is run over the whole article first, because a ref two blocks
 * carry is refused by that walk and must be refused here too, and then per
 * block, because a figure has to carry the id of the block it sits in.
 *
 * ## An ingredient, not a promise
 *
 * A figure whose bytes will not load, that is too small to be a figure, or too
 * large to send inline, is left out and counted — never an error. The plates
 * are drawn either way; with no figures, exactly as they were before.
 */
import type { AssetExt, Assets } from "./assets.js";
import { imageDimensions } from "./assets.js";
import { pdfFigureMarkersIn } from "./collect-assets.js";
import type { Block, BlockId } from "./types.js";

/**
 * **At most this many figures are offered to the brief** — the first ones in
 * reading order. The brief model has to hold the list beside the Sketch, and a
 * paper with forty figures is not made better by listing forty.
 */
export const MAX_FIGURES_OFFERED = 8;

/**
 * **Under this many pixels on the long side, it is not a figure** — a journal
 * logo or a licence badge that the PDF route lifted with a caption beside it.
 */
export const MIN_FIGURE_EDGE = 300;

/**
 * **Over this, one figure is not sent.** The images endpoint takes each
 * reference inline as base64 in the JSON body, which inflates it by a third.
 * The largest PDF figure in the local corpus was 0.76 MB (article-images.md).
 */
export const MAX_FIGURE_BYTES = 4 * 1024 * 1024;

/** How much of a caption the brief sees. The whole caption is in the article it already has. */
export const MAX_FIGURE_CAPTION_CHARS = 300;

/**
 * The formats handed to the illustrator. Stage 4.5 re-encodes every PDF figure
 * as PNG, so this is a statement about the manifest's type rather than a
 * filter anything is expected to trip.
 */
const MEDIA_TYPE: Partial<Record<AssetExt, string>> = { png: "image/png", jpeg: "image/jpeg" };

/** One stored picture, before its bytes are loaded. */
export interface FigureCandidate {
  block: BlockId;
  caption: string;
  sha256: string;
  ext: AssetExt;
}

/** One figure the brief may use and the illustrator may be handed. */
export interface ArticleFigure {
  /**
   * `FIGURE A`, `FIGURE B`, … — **letters, not numbers**, so the label can never
   * be read as the paper's own "Figure 1", which is usually a different picture.
   */
  label: string;
  block: BlockId;
  caption: string;
  sha256: string;
  ext: AssetExt;
  /** `data:image/png;base64,…`, ready for `input_references`. */
  dataUrl: string;
  /** Of the bytes, for the per-plate budget. */
  bytes: number;
}

/** What `loadArticleFigures` found, and what it left out and why — for the log. */
export interface FigureSurvey {
  figures: ArticleFigure[];
  /** Stored figures the article has, before any filter. */
  stored: number;
  skipped: { tooSmall: number; tooBig: number; unreadable: number; format: number; overCap: number };
}

/** `FIGURE A` … `FIGURE Z`. The cap is far below 26, so this never runs out. */
export function figureLabel(index: number): string {
  return `FIGURE ${String.fromCharCode(65 + index)}`;
}

/**
 * **Which figures this plate could have been drawn from, as one string** —
 * `""` when there are none, so an article without stored figures hashes
 * exactly as it did before figures were an input (src/illustrated.ts §
 * `inputFingerprint`).
 *
 * **From the manifest alone**, deliberately: the three places that ask whether
 * an illustration is current hold the `assets` column and not the blocks, and
 * every filter `loadArticleFigures` applies is a function of either the blocks
 * (which move the Sketch, and the Sketch is already in the hash) or the bytes
 * (which the hash names). So the stored entries' hashes and types, in manifest
 * order, decide it.
 *
 * Without this, a paper illustrated before stage 4.5 recovered its figures
 * would go on reporting its figureless picture as current once they arrived
 * (GPT Sol's plan review, finding 2).
 */
export function figuresFingerprint(assets: Assets | null | undefined): string {
  return (assets?.pdfFigures ?? [])
    .flatMap((entry) =>
      entry.status === "stored" && MEDIA_TYPE[entry.ext] ? [`${entry.sha256}.${entry.ext}`] : [],
    )
    .join(",");
}

/**
 * **Every stored PDF figure in the article, in reading order, each once** — no
 * bytes yet, and no filter but *stored*.
 *
 * `assets` absent is an article stage 4.5 never ran on, and it has no figures
 * here, which is what it had before.
 */
export function figureCandidates(
  blocks: readonly Block[],
  assets: Assets | null | undefined,
): FigureCandidate[] {
  const byRef = new Map<string, { sha256: string; ext: AssetExt }>();
  for (const entry of assets?.pdfFigures ?? []) {
    if (entry.status === "stored") byRef.set(entry.ref, { sha256: entry.sha256, ext: entry.ext });
  }
  if (byRef.size === 0) return [];

  /* The article-wide walk decides which refs are real; a ref carried by two
     blocks is refused there, and asking per block alone would see each copy
     once and accept both. */
  const allowed = new Set(pdfFigureMarkersIn(blocks).map((m) => m.ref));

  const found: FigureCandidate[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    if (!block.html) continue;
    for (const marker of pdfFigureMarkersIn([block])) {
      const stored = allowed.has(marker.ref) ? byRef.get(marker.ref) : undefined;
      if (!stored || seen.has(stored.sha256)) continue;
      seen.add(stored.sha256);
      found.push({ block: block.id, caption: captionOf(block), ...stored });
    }
  }
  return found;
}

/** The block's own text — the figure's caption — folded to one line and capped. */
function captionOf(block: Block): string {
  const text = block.text.replace(/\s+/g, " ").trim();
  if (!text) return "(no caption in the article)";
  return text.length > MAX_FIGURE_CAPTION_CHARS
    ? `${text.slice(0, MAX_FIGURE_CAPTION_CHARS - 1).trimEnd()}…`
    : text;
}

/** Reads one stored object. Injected, so the tests need no bucket. */
export type ReadFigureBytes = (sha256: string, ext: AssetExt) => Promise<Uint8Array | null>;

/**
 * **The figures, with their bytes, filtered and labelled** — what the brief is
 * offered and the illustrator may be handed.
 *
 * Labels are given *after* the filters, so the brief never sees a gap in the
 * lettering and never names a figure nobody can send.
 */
export async function loadArticleFigures(
  blocks: readonly Block[],
  assets: Assets | null | undefined,
  read: ReadFigureBytes,
): Promise<FigureSurvey> {
  const candidates = figureCandidates(blocks, assets);
  const skipped = { tooSmall: 0, tooBig: 0, unreadable: 0, format: 0, overCap: 0 };
  const figures: ArticleFigure[] = [];
  for (const candidate of candidates) {
    if (figures.length >= MAX_FIGURES_OFFERED) {
      skipped.overCap += 1;
      continue;
    }
    const mediaType = MEDIA_TYPE[candidate.ext];
    if (!mediaType) {
      skipped.format += 1;
      continue;
    }
    let bytes: Uint8Array | null;
    try {
      bytes = await read(candidate.sha256, candidate.ext);
    } catch {
      /* A `maxBytes` refusal lands here as well as an outage; both mean this
         figure is not an ingredient today, and neither is the plate's problem.
         The caller logs the count, and warns when every figure went this way. */
      bytes = null;
    }
    if (!bytes) {
      skipped.unreadable += 1;
      continue;
    }
    if (bytes.byteLength > MAX_FIGURE_BYTES) {
      skipped.tooBig += 1;
      continue;
    }
    const size = imageDimensions(bytes);
    if (!size) {
      skipped.unreadable += 1;
      continue;
    }
    if (Math.max(size.width, size.height) < MIN_FIGURE_EDGE) {
      skipped.tooSmall += 1;
      continue;
    }
    figures.push({
      label: figureLabel(figures.length),
      block: candidate.block,
      caption: candidate.caption,
      sha256: candidate.sha256,
      ext: candidate.ext,
      dataUrl: `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`,
      bytes: bytes.byteLength,
    });
  }
  return { figures, stored: candidates.length, skipped };
}
