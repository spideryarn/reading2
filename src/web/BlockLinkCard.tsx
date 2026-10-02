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
 *
 * **And a cross-reference mark in the prose** (`mark.xref[data-xref]`, since
 * 2026-09-30) gets the same card, with its target found through the
 * `resolveXref` the provider is handed rather than an attribute on the mark —
 * xref.ts, and
 * docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md.
 *
 * **And the gutter's reading-time line** (`.blk-gutter > span.blk-read`, since
 * 2026-10-01), which is not a link at all. It wants exactly this card's shape —
 * one trigger per block, hundreds of them, so one panel rather than a Floating
 * UI instance each — and Greg asked for a rich card where it had a `title`
 * (spya-mn3ruw). A second delegated-card file would have been a copy of the
 * hover intent, detach and dismiss logic below; `READING_LINE` is the one
 * branch that differs, plus where the card is placed (`referenceFor`).
 * docs/plans/261001r-reading-time-line-gets-a-rich-card-and-grows-lighter-cross-references-quieter-than-the-glossary.md.
 *
 * **And every control in the gutter** (`GUTTER_CONTROL`, since 2026-10-02):
 * the mark, the permalink, chat, the bookmark, the "?" and the "…". Each had a
 * native `title`, which reads as no tooltip at all — Greg (spya-jc0vm6): *"Make
 * sure they all have tooltips"*. Each now carries its one sentence in
 * `data-tip`, and the card draws it, re-reading it if it changes while open
 * (the permalink's *Copied*, the "…" turning into ✕). It adds no
 * `aria-describedby` there, because the sentence is the control's own name,
 * near enough, and would be read twice.
 * docs/plans/261002e-mode-corner-icons-and-gutter-icon-polish.md.
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
import { SAFE_ID, spentWords } from "./reading-time.js";
import { ControlTip, TipNote } from "./Tooltip.js";
import type { ReadingTimeFor } from "./useReadingTime.js";
import { XREF_SELECTOR, type XrefResolver } from "./xref.js";

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
export function BlockLinkProvider({
  index,
  resolveXref,
  readingTimeFor,
  children,
}: {
  index: BlockLinkIndex;
  /**
   * **Where a cross-reference mark in the prose goes**, or null when the mark
   * is not one of ours — `xrefTarget` bound to the owner's links (xref.ts).
   * Absent outside the reading view and for a visitor, and then every
   * `mark.xref` gets no card at all.
   *
   * A resolver rather than a `data-block-link` on the mark, deliberately
   * (docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md
   * § The card): the target comes from the artefact through a nonce the
   * article cannot know, never from an attribute it could have written.
   */
  resolveXref?: XrefResolver | undefined;
  /**
   * The seconds behind each reading-time line, for its card — the owner's
   * `useReadingTime().timeFor`. Absent for a visitor, who has no lines, and
   * then the card explains the line without a time.
   */
  readingTimeFor?: ReadingTimeFor | undefined;
  children: ReactNode;
}) {
  return (
    <BlockLinkContext.Provider value={index}>
      {children}
      <BlockLinkCard index={index} resolveXref={resolveXref} readingTimeFor={readingTimeFor} />
    </BlockLinkContext.Provider>
  );
}

/** `Tooltip.tsx`'s delays, so this card feels like every other one. */
const DELAY = { open: 240, close: 90 } as const;
/* A block link, or a cross-reference mark in the prose. The second is only a
   candidate: `contentFor` asks the resolver, which checks the nonce, and a
   forged one gets no card. */
/** The gutter's reading-time line (BlockGutter.tsx, gutter.css § reading time). */
const READING_LINE = ".blk-gutter > span.blk-read";
/** A control in the gutter (BlockGutter.tsx), whose words are its `data-tip`. */
const GUTTER_CONTROL = ".blk-gutter > button[data-tip], .blk-gutter > a[data-tip]";
const SELECTOR = `[data-block-link], ${XREF_SELECTOR}, ${READING_LINE}, ${GUTTER_CONTROL}`;
/** The two that are not links, and draw a control's card rather than a passage's preview. */
const CONTROL_SHAPED = `${READING_LINE}, ${GUTTER_CONTROL}`;

/**
 * **`ReadingCard` — what the reading-time line is, and how long you have spent
 * beside it.** Greg asked for the time (spya-d940uu).
 *
 * **Live**: `timeFor` reads the running totals on every render, and the card
 * re-renders once a second while it is open — the recorder's own resolution.
 * Read once, it would go stale while the card stayed open (Sol, plan review of
 * 261001r). Keyed by block where it is made (`contentFor`), so moving straight
 * from one line to the next is a new card rather than the old one's last tick.
 *
 * "Stronger", never "darker": the page is dark and the line is `--ink`, so it
 * gets *lighter* — the `title` said darker, and Greg saw it brighten
 * (spya-mn3ruw). The conditions are useReadingTime.ts's and Reader's.
 */
function ReadingCard({ id, timeFor }: { id: BlockId | null; timeFor: ReadingTimeFor | undefined }) {
  const [, setTick] = useState(0);
  const live = id !== null && timeFor !== undefined;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [live]);
  const time = id !== null ? (timeFor?.(id) ?? null) : null;
  return (
    <ControlTip
      head="Reading time"
      state={
        time
          ? `You have spent ${spentWords(time.seconds)} here. It takes about ${spentWords(time.expected)} to read.`
          : undefined
      }
      what="This line grows stronger the longer you spend reading the passage beside it: nothing for a glance, faint after one read, clearest after reading it slowly, or several times."
      how="It counts while the passage is visible in the reading view, the page is visible, and you have been active in the last five minutes. Only you see it."
    />
  );
}

/**
 * **Where the card points.** A link is a few words, so the element itself. The
 * reading-time strip is the whole block's height, and a card above a long
 * paragraph's top is nowhere near the pointer — so it is the strip at the
 * height the pointer came in, recomputed on every read so a scroll moves it
 * with the strip (a frozen `clientY` would not follow, `contextElement` or
 * not). Sol, plan review of 261001r.
 */
function referenceFor(el: HTMLElement, clientY: number | undefined) {
  if (clientY === undefined || !el.matches(READING_LINE)) return el;
  const offset = clientY - el.getBoundingClientRect().top;
  return {
    contextElement: el,
    getBoundingClientRect() {
      const r = el.getBoundingClientRect();
      const y = r.top + Math.min(Math.max(offset, 0), r.height);
      return new DOMRect(r.left, y, r.width, 0);
    },
  };
}

/** What the card draws for one link, or null when it would have nothing to say. */
function contentFor(
  el: HTMLElement,
  index: BlockLinkIndex,
  resolveXref: XrefResolver | undefined,
  readingTimeFor: ReadingTimeFor | undefined,
): ReactNode | null {
  if (el.matches(READING_LINE)) {
    const row = el.closest("tr[data-block]")?.getAttribute("data-block") ?? null;
    const id = row !== null && SAFE_ID.test(row) ? (row as BlockId) : null;
    return <ReadingCard key={id ?? ""} id={id} timeFor={readingTimeFor} />;
  }
  if (el.matches(GUTTER_CONTROL)) {
    const tip = el.getAttribute("data-tip")?.trim() ?? "";
    return tip === "" ? null : <TipNote>{tip}</TipNote>;
  }
  /* A cross-reference's target comes from the resolver and only from there —
     never `data-block-link`, `data-block-missing` or `data-block-preview` off
     the mark. Since 2026-10-01 the sanitiser drops all three from an
     article's own markup (src/sanitize-policy.ts § `ARTICLE_DATA_ATTRS`); the
     resolver is the second line. */
  const xref = el.matches(XREF_SELECTOR);
  const id = xref ? (resolveXref?.(el) ?? null) : el.getAttribute("data-block-link");
  if (id === null) return null;
  if (!xref && el.hasAttribute("data-block-missing"))
    return <p className="tip-cite-empty">{MISSING_BLOCK}</p>;
  const entry = index.get(id as BlockId);
  if (!entry) return null;
  const preview = xref || el.getAttribute("data-block-preview") !== "off";
  const shown = snippet(entry.text);
  /* By subtraction (tooltips.md): a link whose own words already name its
     section — a summary entry's title — is not told the section again. */
  const head =
    entry.section !== undefined && !(el.textContent ?? "").includes(entry.section)
      ? entry.section
      : undefined;
  if (head === undefined && !preview) return null;
  return (
    <>
      {head !== undefined && <div className="tip-cite-head">{head}</div>}
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

function BlockLinkCard({
  index,
  resolveXref,
  readingTimeFor,
}: {
  index: BlockLinkIndex;
  resolveXref: XrefResolver | undefined;
  readingTimeFor: ReadingTimeFor | undefined;
}) {
  const [shown, setShown] = useState<{ el: HTMLElement; content: ReactNode } | null>(null);
  const cardId = useId();
  const arrowRef = useRef<SVGSVGElement>(null);
  const currentRef = useRef<HTMLElement | null>(null);
  const indexRef = useRef(index);
  indexRef.current = index;
  const resolveRef = useRef(resolveXref);
  resolveRef.current = resolveXref;
  const readingRef = useRef(readingTimeFor);
  readingRef.current = readingTimeFor;

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
    /* Not on a trigger hidden from assistive technology — the reading-time
       line is decoration, and nothing about reading time is announced — nor
       on a gutter control, whose card says its own name again. */
    if (!el || el.getAttribute("aria-hidden") === "true" || el.matches(GUTTER_CONTROL)) return;
    const had = el.getAttribute("aria-describedby");
    el.setAttribute("aria-describedby", had ? `${had} ${cardId}` : cardId);
    return () => {
      if (had) el.setAttribute("aria-describedby", had);
      else el.removeAttribute("aria-describedby");
    };
  }, [shown, cardId]);

  /* React can remove a hovered link without sending `pointerout` — closing a
     dialog and replacing a streamed answer both do it. Floating UI otherwise
     keeps the detached node as its reference and leaves the card at its last
     coordinates. Observe only while a card is open, and dismiss only the card
     whose own anchor disappeared. */
  useEffect(() => {
    const el = shown?.el;
    if (!el) return;
    const closeIfDetached = () => {
      if (el.isConnected || currentRef.current !== el) return;
      currentRef.current = null;
      setShown((open) => (open?.el === el ? null : open));
    };
    closeIfDetached();
    const observer = new MutationObserver(closeIfDetached);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    /* **A gutter control's words can change under an open card** — the
       permalink says *Copied*, the "…" becomes ✕ — on the same element, so
       nothing above would notice. Re-read them, and only the open one's. */
    const reword = new MutationObserver(() => {
      if (currentRef.current !== el) return;
      const content = contentFor(el, indexRef.current, resolveRef.current, readingRef.current);
      if (content === null) {
        currentRef.current = null;
        setShown(null);
      } else {
        setShown({ el, content });
      }
    });
    if (el.matches(GUTTER_CONTROL)) reword.observe(el, { attributes: true, attributeFilter: ["data-tip"] });
    return () => {
      observer.disconnect();
      reword.disconnect();
    };
  }, [shown]);

  /* A new article/index can change the words under an anchor even if React
     preserves that node. Refresh the open card from the new source; the real
     Reader keeps this map stable across position renders, so this runs only
     when its source changes. The cross-references are a source too: a mark
     whose links were replaced may now resolve elsewhere, or nowhere. */
  useEffect(() => {
    const el = currentRef.current;
    if (!el) return;
    const content = contentFor(el, index, resolveXref, readingTimeFor);
    if (content === null) {
      currentRef.current = null;
      setShown(null);
    } else {
      setShown({ el, content });
    }
  }, [index, resolveXref, readingTimeFor]);

  /* Delegated on the document: the links are in every panel and come and go
     with them, and one listener pair costs the same however many there are.
     Hysteresis as in useHoverCard.ts: `pending` is the link an open timer is
     armed for, `current` the one showing. */
  useEffect(() => {
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    let pending: HTMLElement | null = null;

    const shut = () => {
      currentRef.current = null;
      setShown(null);
    };
    const close = () => {
      clearTimeout(openTimer);
      pending = null;
      clearTimeout(closeTimer);
      if (currentRef.current) closeTimer = setTimeout(shut, DELAY.close);
    };
    const show = (el: HTMLElement, clientY?: number) => {
      pending = null;
      if (!el.isConnected) return shut();
      const content = contentFor(el, indexRef.current, resolveRef.current, readingRef.current);
      if (content === null) return shut();
      currentRef.current = el;
      // Before the state, so the reference exists when the panel mounts.
      refs.setPositionReference(referenceFor(el, clientY));
      setShown({ el, content });
    };
    const arm = (el: HTMLElement, wait: number, clientY: number) => {
      clearTimeout(closeTimer);
      if (el === currentRef.current) {
        /* The reading strip is a paragraph tall. Leaving it for the table cell
           schedules a close, and re-entering before that delay expires keeps
           the same card open; move its virtual reference to this new entry
           height instead of leaving the arrow at the old one. A link's real
           element reference is unchanged, as before. */
        if (el.matches(READING_LINE)) refs.setPositionReference(referenceFor(el, clientY));
        return;
      }
      if (el === pending) return;
      clearTimeout(openTimer);
      pending = el;
      openTimer = setTimeout(() => show(el, clientY), wait);
    };

    const hit = (target: EventTarget | null) =>
      (target as Element | null)?.closest?.(SELECTOR) as HTMLElement | null;

    const over = (e: PointerEvent) => {
      /* A finger fires `pointerover` too, on the tap that follows the link. No
         card for it: the flash and the return chip are the confirmation, and a
         card left behind over the panel would be one more thing to dismiss. */
      if (e.pointerType === "touch") return close();
      const el = hit(e.target);
      if (el) arm(el, currentRef.current ? 0 : DELAY.open, e.clientY);
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
      if (e.key === "Escape" && (currentRef.current || pending)) {
        clearTimeout(openTimer);
        pending = null;
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
      currentRef.current = null;
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
  /* A native modal dialog lives in the browser's top layer. A portal under
     `<body>` cannot paint above it at any z-index, so keep the card inside the
     open dialog when its own anchor is there. Outside a dialog, FloatingPortal
     retains its ordinary body root. */
  const portalRoot = drawn.el.closest<HTMLDialogElement>("dialog[open]") ?? undefined;
  return (
    <FloatingPortal root={portalRoot}>
      <div
        ref={refs.setFloating}
        id={cardId}
        role="tooltip"
        className="tooltip-anchor"
        style={{ ...floatingStyles, visibility: isPositioned ? "visible" : "hidden" }}
      >
        {/* A control-shaped card (ControlTip) wants `.tip-soon`'s width and
            paragraphs; a link's preview wants `.tip-cite`'s. */}
        <div className={`tooltip ${drawn.el.matches(CONTROL_SHAPED) ? "tip-soon" : "tip-cite"}`} style={styles}>
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
