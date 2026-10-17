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
 * hover intent, detach and dismiss logic; `READING_LINE` is the one
 * branch that differs, plus where the card is placed (`referenceFor`). That
 * logic has lived in useDelegatedCard.tsx since 2026-10-17, shared with
 * TipCard.tsx, and this file keeps only what is its own.
 * docs/plans/261001r-reading-time-line-gets-a-rich-card-and-grows-lighter-cross-references-quieter-than-the-glossary.md.
 *
 * **The gutter's controls were here from 2026-10-02 to 2026-10-17**:
 * the mark, the permalink, chat, the bookmark, the "?" and the "…". Each had a
 * native `title`, which reads as no tooltip at all — Greg (spya-jc0vm6): *"Make
 * sure they all have tooltips"*. Each now carries its one sentence in
 * `data-tip` (docs/plans/261002e-mode-corner-icons-and-gutter-icon-polish.md).
 * When every native `title` in the app became a `data-tip`, the attribute
 * stopped being the gutter's, and its card moved to TipCard.tsx, which draws
 * every `[data-tip]` on every page (plan 261017g).
 *
 * **And Marginalia's notes** (`MARG_NOTE`, since 2026-10-02): each shut line
 * and question carries `data-marg-tip`, a key into marginalia/tips.ts, and the
 * card says what the note is and where it came from — Greg (spya-atv4nx):
 * *"Make sure all annotations have rich tooltips … explaining their origin"*.
 * A column of dozens of notes, so the same reason as the gutter.
 * docs/plans/261002g-marginalia-head-in-plain-words-and-every-note-says-where-it-came-from.md.
 */
import { useEffect, useState, type ReactNode } from "react";
import type { Block, BlockId } from "../types.js";
import { snippet } from "./citations.js";
import {
  BLOCK_CARD_TRIGGERS,
  BlockLinkContext,
  CONTROL_SHAPED,
  MARG_NOTE,
  READING_LINE,
  type BlockLinkEntry,
  type BlockLinkIndex,
} from "./block-link-index.js";
import { BlockExcerpt } from "./Excerpt.js";
import { MARG_TIPS, isMargTipKey } from "./marginalia/tips.js";
import type { Section } from "./position.js";
import { SAFE_ID, spentWords } from "./reading-time.js";
import { ControlTip } from "./Tooltip.js";
import { useDelegatedCard } from "./useDelegatedCard.js";
import type { ReadingTimeFor } from "./useReadingTime.js";
import { XREF_SELECTOR, type XrefResolver } from "./xref.js";

/* The index's types and context live in block-link-index.ts, so `Excerpt`
   can read them without importing this card (plan 261009k). */
export { type BlockLinkEntry, type BlockLinkIndex, useBlockLinks } from "./block-link-index.js";

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
    index.set(block.id, { text: block.text, section: title === "" ? undefined : title, block });
  }
  return index;
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

/* The triggers — block links, cross-reference marks, the reading-time line and
   Marginalia's notes — are named in block-link-index.ts, where TipCard.tsx can
   read them without importing this card. A cross-reference mark is only a
   candidate: `contentFor` asks the resolver, which checks the nonce, and a
   forged one gets no card. */

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
function referenceFor(el: Element, clientY: number | undefined) {
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
  el: Element,
  index: BlockLinkIndex,
  resolveXref: XrefResolver | undefined,
  readingTimeFor: ReadingTimeFor | undefined,
): ReactNode | null {
  if (el.matches(READING_LINE)) {
    const row = el.closest("tr[data-block]")?.getAttribute("data-block") ?? null;
    const id = row !== null && SAFE_ID.test(row) ? (row as BlockId) : null;
    return <ReadingCard key={id ?? ""} id={id} timeFor={readingTimeFor} />;
  }
  if (el.matches(MARG_NOTE)) {
    const key = el.getAttribute("data-marg-tip");
    if (!isMargTipKey(key)) return null;
    const tip = MARG_TIPS[key];
    return <ControlTip head={tip.head} what={tip.what} how={tip.how} />;
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
          // The block's own markup, maths and italics kept (plan 261009k).
          <p className="tip-cite-text">
            <BlockExcerpt block={entry.block} words={shown} />
          </p>
        ))}
    </>
  );
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
  const { card, controls, open } = useDelegatedCard({
    selector: BLOCK_CARD_TRIGGERS,
    contentFor: (el) => contentFor(el, index, resolveXref, readingTimeFor),
    referenceFor,
    /* Not on a trigger hidden from assistive technology — the reading-time
       line is decoration, and nothing about reading time is announced. (The
       hook skips an `aria-hidden` trigger itself; said here so the reason is
       beside the card it is about.) */
    cardClass: (el) => (el.matches(CONTROL_SHAPED) ? "tip-soon" : "tip-cite"),
  });

  /* A new article/index can change the words under an anchor even if React
     preserves that node. Refresh the open card from the new source; the real
     Reader keeps this map stable across position renders, so this runs only
     when its source changes. The cross-references are a source too: a mark
     whose links were replaced may now resolve elsewhere, or nowhere. */
  useEffect(() => {
    controls.refresh();
  }, [controls, index, resolveXref, readingTimeFor]);

  /* **A card a press opened goes on the next scroll** (touch.md, the rule the
     spine and the glossary keep): no finger is resting on the line, so it would
     ride with the paragraph to the edge of the screen. A hovered card is held by
     the pointer and is left alone. Capture, because a scroll does not bubble.
     Plan 261003c. */
  useEffect(() => {
    if (!open || !controls.pressed()) return;
    const close = () => {
      if (controls.current() === open) controls.close();
    };
    document.addEventListener("scroll", close, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", close, { capture: true });
  }, [open, controls]);

  /* **A press on the reading-time line opens its card** — the one way a finger
     can, since nothing hovers on a touch screen (Greg, spya-vskqfn; plan
     261003c). The line does nothing when pressed, so there is no second tap
     to commit and no need to ask what made the press: a mouse's click on a
     line whose card is already open changes nothing, and on one whose card
     is still waiting out its delay it opens it a moment early. That is also
     why the iPad's mislabelled click (`mouse` for a finger, WebKit 282988)
     cannot touch it. A lift fires `pointerout` before the click and schedules
     a close (touch.md § a lift fires the hover events); `openNow` comes after,
     and cancels it, which is what keeps the card up. Opened this way, it
     goes on the next scroll, for no finger is resting on it — the effect
     above. The next tap anywhere closes it through the hook's `pointerover`. */
  useEffect(() => {
    const press = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.(READING_LINE);
      if (!el) return;
      controls.openNow(el, e.clientY, el === controls.current() ? controls.pressed() : true);
    };
    document.addEventListener("click", press);
    return () => document.removeEventListener("click", press);
  }, [controls]);

  return card;
}
