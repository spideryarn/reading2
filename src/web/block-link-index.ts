/**
 * **Every block of the article, by id, for anything in the reading view** —
 * the index's types and its context, on their own.
 *
 * They lived in BlockLinkCard.tsx until 2026-10-09 and moved for a structural
 * reason: `Excerpt` (Excerpt.tsx) reads the index, and the block-link card
 * draws an `Excerpt`, so with the context inside the card the two imported
 * each other (plan 261009k). BlockLinkCard.tsx builds the index, provides it
 * and re-exports these names, so none of its callers had to move.
 */
import { createContext, useContext } from "react";
import type { Block, BlockId } from "../types.js";
import { XREF_SELECTOR } from "./xref.js";

/** What a card says about one block. */
export interface BlockLinkEntry {
  /** The block's plain text — `""` for an image or a figure. */
  text: string;
  /** The title of the section it sits in, or undefined where that has none. */
  section: string | undefined;
  /**
   * The block itself, as the prose draws it, so an excerpt anywhere in the
   * reading view is drawn from its markup (Excerpt.tsx, plan 261009k). Absent
   * in an index built from text alone, and then an excerpt is a string.
   */
  block?: Block;
}

/** Every block of this article, by id. Also the "is this id real" check. */
export type BlockLinkIndex = ReadonlyMap<BlockId, BlockLinkEntry>;

export const BlockLinkContext = createContext<BlockLinkIndex | null>(null);

/** The index, or null outside the reading view — where a link cannot know. */
export function useBlockLinks(): BlockLinkIndex | null {
  return useContext(BlockLinkContext);
}

/** The gutter's reading-time line (BlockGutter.tsx, gutter.css § reading time). */
export const READING_LINE = ".blk-gutter > span.blk-read";
/** A note in Marginalia's column (MarginaliaColumn.tsx), whose card is `MARG_TIPS[data-marg-tip]`. */
export const MARG_NOTE = ".marg-note [data-marg-tip]";
/**
 * **Everything BlockLinkCard.tsx draws a card for**: a block link, a
 * cross-reference mark, the reading-time line, a Marginalia note. Here rather
 * than in the card so TipCard.tsx can leave them alone without importing it —
 * a `[data-tip]` inside one of these would otherwise open two cards at once.
 */
export const BLOCK_CARD_TRIGGERS = `[data-block-link], ${XREF_SELECTOR}, ${READING_LINE}, ${MARG_NOTE}`;
/** The ones that are not links, and draw a control's card rather than a passage's preview. */
export const CONTROL_SHAPED = `${READING_LINE}, ${MARG_NOTE}`;
