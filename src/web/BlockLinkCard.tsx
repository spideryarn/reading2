/**
 * **The card every block link shares** — one panel for the whole reading view,
 * and the index it reads from.
 *
 * `BlockRef` (BlockRef.tsx) draws a block id, or a phrase, as a link to that
 * block. Hovering or focusing one shows what it points at: the section it sits
 * in, then the paragraph cut short — enough to recognise it and to check a
 * claim against it without leaving the sentence you are reading, not enough to
 * read instead of going there. That card used to be Cited.tsx's alone, one
 * `Tooltip` per chip; everywhere else had a native `title`, which tooltips.md
 * calls a regression.
 *
 * **One panel, not one per link** (Sol F4 on
 * docs/plans/260928b-one-block-link-component-with-a-rich-tooltip-and-a-flash-on-arrival.md):
 * the glossary draws a link per occurrence, literal search is uncapped, and the
 * table draws two per gist cell, so a Floating UI instance each would be
 * thousands of them for the one the reader is pointing at. So it is
 * `ProseHoverCard`'s shape — a delegated `pointerover` / `focusin` on
 * `[data-block-link]`, and `setPositionReference` against whichever element
 * that is. It does **not** share `useHoverCard` yet: that one carries a card a
 * pointer can enter and a tap-to-reveal gesture, and this card wants neither —
 * a tap on a block link simply follows it. tooltips.md § The second
 * implementation.
 *
 * It looks like every other card because it is drawn with `Tooltip`'s classes
 * (`.tooltip-anchor`, `.tooltip`, the arrow) and its delays.
 */
import {
  FloatingArrow,
  FloatingPortal,
  arrow,
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
  useTransitionStyles,
} from "@floating-ui/react";
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Block, BlockId } from "../types.js";
import { snippet } from "./citations.js";
import type { Section } from "./position.js";

/** What a card says about one block. */
export interface BlockLinkEntry {
  /** The block's plain text — `""` for an image or a figure. */
  text: string;
  /** The title of the section it sits in, or undefined where that has none. */
  section: string | undefined;
}

/** Every block of this article, by id. Also the "is this id real" check. */
export type BlockLinkIndex = ReadonlyMap<BlockId, BlockLinkEntry>;

/** The one sentence for a link to a block this article does not have. */
export const MISSING_BLOCK = "This passage is not in this version of the article.";

/**
 * **Every block's text and section, in one pass.**
 *
 * The section a block sits in is the last one starting at or above its row —
 * `sectionIndexContaining`'s answer (position.ts), and so the same place the
 * return chip names. Walked once here rather than asked per link, because a
 * link is drawn per glossary occurrence and per gist cell, and because the
 * result is then one value the provider can hand down unchanged while the
 * reader scrolls (Sol F5). Above the first section it answers the first
 * section, as `activeSectionIndex` does.
 */
export function buildBlockLinkIndex(
  blocks: readonly Block[],
  sections: readonly Section[],
): Map<BlockId, BlockLinkEntry> {
  const index = new Map<BlockId, BlockLinkEntry>();
  let at = 0;
  for (const [row, block] of blocks.entries()) {
    while ((sections[at + 1]?.row ?? Number.POSITIVE_INFINITY) <= row) at += 1;
    const title = sections[at]?.title.trim() ?? "";
    index.set(block.id, { text: block.text, section: title === "" ? undefined : title });
  }
  return index;
}

const BlockLinkContext = createContext<BlockLinkIndex | null>(null);

/** The index, or null outside the reading view — where a link cannot know. */
export function useBlockLinks(): BlockLinkIndex | null {
  return useContext(BlockLinkContext);
}

/**
 * Mounted once by Reader around the whole reading view. Portalled panels (the
 * chat dialog) are still inside it: context follows the React tree, not the DOM.
 */
export function BlockLinkProvider({ index, children }: { index: BlockLinkIndex; children: ReactNode }) {
  return (
    <BlockLinkContext.Provider value={index}>
      {children}
      <BlockLinkCard index={index} />
    </BlockLinkContext.Provider>
  );
}

/** `Tooltip.tsx`'s delays, so this card feels like every other one. */
const DELAY = { open: 240, close: 90 } as const;
const SELECTOR = "[data-block-link]";

/** What the card draws for one link, or null when it would have nothing to say. */
function contentFor(el: HTMLElement, index: BlockLinkIndex): ReactNode | null {
  const id = el.getAttribute("data-block-link");
  if (id === null) return null;
  if (el.hasAttribute("data-block-missing")) return <p className="tip-cite-empty">{MISSING_BLOCK}</p>;
  const entry = index.get(id as BlockId);
  if (!entry) return null;
  const preview = el.getAttribute("data-block-preview") !== "off";
  const shown = snippet(entry.text);
  if (entry.section === undefined && !preview) return null;
  return (
    <>
      {entry.section !== undefined && <div className="tip-cite-head">{entry.section}</div>}
      {preview &&
        (shown === "" ? (
          // An image, a figure. Saying so beats an empty card that looks like
          // a tooltip that failed to load.
          <p className="tip-cite-empty">This block has no text of its own.</p>
        ) : (
          <p className="tip-cite-text">{shown}</p>
        ))}
    </>
  );
}

/** Does this focused element show a focus ring — i.e. did a keyboard put it there? */
function focusVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    // An engine that cannot answer (jsdom): open, which is what a keyboard wants.
    return true;
  }
}

function BlockLinkCard({ index }: { index: BlockLinkIndex }) {
  const [shown, setShown] = useState<{ el: HTMLElement; content: ReactNode } | null>(null);
  const cardId = useId();
  const arrowRef = useRef<SVGSVGElement>(null);
  const indexRef = useRef(index);
  indexRef.current = index;

  const { refs, floatingStyles, context, isPositioned } = useFloating({
    open: shown !== null,
    placement: "top",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(10),
      flip({ padding: 10, fallbackAxisSideDirection: "end" }),
      shift({ padding: 10 }),
      arrow({ element: arrowRef, padding: 8 }),
    ],
  });
  const { isMounted, styles } = useTransitionStyles(context, {
    duration: { open: 120, close: 80 },
    initial: { opacity: 0, transform: "scale(0.97)" },
  });

  /* The card is the open link's description, and only the open link's. Set on
     the element rather than rendered, because the links belong to fifteen
     panels and none of them knows the card exists. Added to and taken from a
     list, so a description the link already had survives. */
  useEffect(() => {
    const el = shown?.el;
    if (!el) return;
    const had = el.getAttribute("aria-describedby");
    el.setAttribute("aria-describedby", had ? `${had} ${cardId}` : cardId);
    return () => {
      if (had) el.setAttribute("aria-describedby", had);
      else el.removeAttribute("aria-describedby");
    };
  }, [shown, cardId]);

  /* Delegated on the document: the links are in every panel and come and go
     with them, and one listener pair costs the same however many there are.
     Hysteresis as in useHoverCard.ts: `pending` is the link an open timer is
     armed for, `current` the one showing. */
  useEffect(() => {
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    let pending: HTMLElement | null = null;
    let current: HTMLElement | null = null;

    const shut = () => {
      current = null;
      setShown(null);
    };
    const close = () => {
      clearTimeout(openTimer);
      pending = null;
      clearTimeout(closeTimer);
      if (current) closeTimer = setTimeout(shut, DELAY.close);
    };
    const show = (el: HTMLElement) => {
      pending = null;
      if (!el.isConnected) return;
      const content = contentFor(el, indexRef.current);
      if (content === null) return;
      current = el;
      // Before the state, so the reference exists when the panel mounts.
      refs.setPositionReference(el);
      setShown({ el, content });
    };
    const arm = (el: HTMLElement, wait: number) => {
      clearTimeout(closeTimer);
      if (el === current || el === pending) return;
      clearTimeout(openTimer);
      pending = el;
      openTimer = setTimeout(() => show(el), wait);
    };

    const hit = (target: EventTarget | null) =>
      (target as Element | null)?.closest?.(SELECTOR) as HTMLElement | null;

    const over = (e: PointerEvent) => {
      /* A finger fires `pointerover` too, on the tap that follows the link. No
         card for it: the flash and the return chip are the confirmation, and a
         card left behind over the panel would be one more thing to dismiss. */
      if (e.pointerType === "touch") return;
      const el = hit(e.target);
      if (el) arm(el, current ? 0 : DELAY.open);
      else close();
    };
    const out = (e: PointerEvent) => {
      const el = hit(e.target);
      if (!el) return;
      const to = e.relatedTarget as Node | null;
      if (to && el.contains(to)) return;
      close();
    };
    const focusIn = (e: FocusEvent) => {
      const el = hit(e.target);
      if (!el || !focusVisible(el)) return;
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
      show(el);
    };
    const focusOut = (e: FocusEvent) => {
      if (hit(e.target)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && current) {
        clearTimeout(openTimer);
        clearTimeout(closeTimer);
        shut();
      }
    };

    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focusIn);
    document.addEventListener("focusout", focusOut);
    document.addEventListener("keydown", key);
    return () => {
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", focusIn);
      document.removeEventListener("focusout", focusOut);
      document.removeEventListener("keydown", key);
    };
  }, [refs]);

  useEffect(() => {
    if (!shown) refs.setPositionReference(null);
  }, [refs, shown]);

  /* What the card last said, so it can fade out saying it rather than blank. */
  const last = useRef(shown);
  if (shown) last.current = shown;
  const drawn = last.current;

  if (!isMounted || !drawn) return null;
  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        id={cardId}
        role="tooltip"
        className="tooltip-anchor"
        style={{ ...floatingStyles, visibility: isPositioned ? "visible" : "hidden" }}
      >
        <div className="tooltip tip-cite" style={styles}>
          {drawn.content}
          {/* fill and stroke are props, not CSS — Tooltip.tsx says why. */}
          <FloatingArrow
            ref={arrowRef}
            context={context}
            className="tooltip-arrow"
            width={12}
            height={6}
            tipRadius={1}
            fill="var(--surface-raised)"
            stroke="var(--rule-strong)"
            strokeWidth={1}
          />
        </div>
      </div>
    </FloatingPortal>
  );
}
