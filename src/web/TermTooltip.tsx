/**
 * The card that appears when the pointer rests on an underlined glossary term
 * in the prose.
 *
 * ## Why this is not `Tooltip.tsx`
 *
 * `Tooltip` takes a React element as its trigger and clones event handlers onto
 * it. The marks here are not React elements: the verbatim column is injected
 * with `dangerouslySetInnerHTML` (annotate.ts cuts the text nodes and labels
 * the pieces), so there is no component to hand a ref to, and there are
 * hundreds of them on a long article — one `<Tooltip>` per occurrence would be
 * hundreds of Floating UI instances for the one the reader is pointing at.
 *
 * So this is **one** floating panel for the whole page, positioned against
 * whichever `<mark class="term">` the pointer is on, and the hover is a single
 * delegated listener on the document. Floating UI still does the part that is
 * genuinely hard — flip, shift, and repositioning while the page scrolls — and
 * the hover intent is fifteen lines of timers here rather than
 * `useHover`/`getReferenceProps`, which want a React trigger we have not got.
 *
 * ## The card takes the pointer, unlike every other tooltip here
 *
 * `.tooltip-anchor` is `pointer-events: none` (styles.css) because the spine's
 * tooltips must never sit under the pointer and keep themselves open. This one
 * carries a link out to the term's canonical page and a button into the
 * glossary, so the pointer has to be able to reach it — hence `interactive`,
 * and hence the close delay being long enough to cross the gap.
 *
 * See docs/project/glossary.md § The underline is always there.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { BookA, ExternalLink, Globe } from "lucide-react";
import {
  FloatingArrow,
  FloatingPortal,
  arrow,
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
} from "@floating-ui/react";
import type { GlossaryEntry } from "../types.js";
import { entryProse, hostOf } from "./GlossaryPanel.js";

/**
 * Longer to open than `Tooltip`'s 240ms, and for a reason that is particular to
 * this one: every term in the article is underlined now, so a pointer crossing
 * a paragraph on its way to the scrollbar passes over several of them. The
 * delay is what keeps that from being a card that flashes three times.
 *
 * Closing is slow enough to cross the 10px gap between the words and the card,
 * because unlike the spine's tooltips this one can be pointed at.
 */
const DELAY = { open: 320, close: 220 } as const;

/** Once a card is open, the next term the pointer lands on swaps in at once. */
const WARM_MS = 60;

export function TermTooltip({
  entries,
  onOpen,
}: {
  entries: GlossaryEntry[];
  /** Show this term in the glossary band — the card's one way out to the list. */
  onOpen(id: string): void;
}) {
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const [shown, setShown] = useState<{ el: HTMLElement; ids: string[] } | null>(null);
  const arrowRef = useRef<SVGSVGElement>(null);

  const { refs, floatingStyles, context, isPositioned } = useFloating({
    open: shown !== null,
    placement: "top",
    // The reference is a `<mark>` in a scrolling table, so it moves against the
    // viewport on every scroll event and the panel has to follow it.
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip({ padding: 12, fallbackAxisSideDirection: "end" }),
      shift({ padding: 12 }),
      arrow({ element: arrowRef, padding: 8 }),
    ],
  });

  /* `setPositionReference` rather than `setReference`: the reference is a plain
     DOM node we found by hit-testing, not something React rendered, so there is
     no ref to give it.
     
     Belt and braces with the call in the handler below, which is the one that
     matters: this one catches the clear on close. Setting it in an effect
     *only* would mean the card mounts one frame before its reference exists,
     and Floating UI's first `floatingStyles` put an unpositioned element at the
     top-left of the page — a card that flickers in the corner on its way to the
     word. `isPositioned` closes the same gap from the other end. */
  useEffect(() => {
    if (!shown) refs.setPositionReference(null);
  }, [refs, shown]);

  /* The whole interaction: which mark the pointer is on, with hysteresis.

     Delegated on the document rather than bound per mark, because the marks are
     injected HTML that React re-creates whenever the prose re-renders — a
     listener attached to one would be attached to a node that no longer exists
     the next time the reader searches for something.

     `pointerover` on *everything*, not `pointerout` on the marks: every element
     the pointer enters fires it, so "left the term" needs no `relatedTarget`
     arithmetic — it is simply an over event on something that is neither a mark
     nor the card. That is also what makes moving between two adjacent terms one
     swap rather than a close and an open. */
  useEffect(() => {
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    /* Read inside the handlers rather than through `shown`, which would put
       state in the dependency list and rebind these listeners on every hover. */
    let current: HTMLElement | null = null;

    const stop = () => {
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
    };

    const close = () => {
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        current = null;
        setShown(null);
      }, DELAY.close);
    };

    const over = (event: PointerEvent) => {
      /* Mouse and pen only. A touch fires `pointerover` on the tap and never
         fires the leaving one, so on an iPad this would open a card that stays
         until something else is tapped — and the tap the reader made was
         probably the start of a selection. docs/project/touch.md. */
      if (event.pointerType === "touch") return;
      const target = event.target as Element | null;
      const mark = target?.closest?.("mark.term") as HTMLElement | null;
      if (mark) {
        const ids = (mark.getAttribute("data-term") ?? "")
          .split(" ")
          .filter((id) => byId.has(id));
        // A mark whose entry is not in the list we hold — the band regenerated
        // and the prose has not caught up. Nothing to show, so show nothing
        // rather than an empty card.
        if (ids.length === 0) return close();
        if (mark === current) return stop();
        stop();
        openTimer = setTimeout(
          () => {
            current = mark;
            /* Before the state, so the reference exists by the time React
               mounts the panel — see the effect above. */
            refs.setPositionReference(mark);
            setShown({ el: mark, ids });
          },
          current ? WARM_MS : DELAY.open,
        );
        return;
      }
      // Inside the card: the reader is reaching for the link. Cancel the close
      // that entering it would otherwise have already started.
      if (target?.closest?.(".term-card")) return stop();
      if (current) close();
    };

    /* Leaving the window entirely, which fires no `pointerover` at all. */
    const leave = () => {
      if (current) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !current) return;
      stop();
      current = null;
      setShown(null);
    };

    document.addEventListener("pointerover", over);
    document.addEventListener("pointerleave", leave);
    document.addEventListener("keydown", key);
    return () => {
      stop();
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerleave", leave);
      document.removeEventListener("keydown", key);
      /* And close, because this cleanup runs when the list itself changes —
         the reader generated more terms, or reset them — and the `<mark>` the
         card is anchored to has been replaced by a new node with the same
         words. Following it is not an option: the old node is detached, and a
         panel pinned to a detached node sits wherever that node last was, which
         reads as the card having come unstuck from the text. */
      setShown(null);
    };
  }, [byId, refs]);

  if (!shown) return null;
  const found = shown.ids.map((id) => byId.get(id)).filter((e): e is GlossaryEntry => e !== undefined);
  if (found.length === 0) return null;

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        /* Hidden until Floating UI has measured, which is asynchronous. Without
           it the first frame paints at the top-left corner of the page. */
        style={{ ...floatingStyles, visibility: isPositioned ? "visible" : "hidden" }}
        className="tooltip-anchor interactive"
        role="tooltip"
      >
        <div className="tooltip term-card">
          {/* More than one only where two terms overlap the same words —
              "attention" inside "attention head", which is commoner now that
              the whole list is drawn rather than one entry of it. Both are
              shown: picking one would be picking for the reader, and which one
              matched the longer phrase is not a thing the mark records. */}
          {found.map((entry) => (
            <TermCard key={entry.id} entry={entry} onOpen={() => onOpen(entry.id)} />
          ))}
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

/**
 * One entry, as the hover card shows it.
 *
 * The same shape the open row in the panel has, and deliberately so — the two
 * are the same entry and a reader who has seen one should recognise the other.
 * `entryProse` is the shared rule about which fields to show and under which
 * label, so the provenance story ("in this piece" is the article, "background"
 * is the model) cannot come out differently in the two places.
 *
 * What it leaves out is the panel's *machinery*: the difficulty and centrality
 * scores, which belong to sorting a list, and the "check the web" button, which
 * spends money and therefore wants a deliberate press rather than a hover.
 * An answer that has *already* been fetched is shown, because by then it is
 * simply part of the entry.
 */
function TermCard({ entry, onOpen }: { entry: GlossaryEntry; onOpen(): void }) {
  const prose = entryProse(entry);

  return (
    <div className="term-card-body">
      <p className="term-card-head">
        <span className="term-card-name">{entry.name}</span>
        {entry.kind !== "term" && entry.kind !== "other" && (
          <span className="gloss-kind">{entry.kind}</span>
        )}
      </p>

      {prose.legacy ? (
        /* `glossary/1` wrote one blended field, and there is no honest label for
           a blend — see `entryProse`. It renders unlabelled here exactly as it
           does in the panel. */
        <p className="term-card-text">{prose.lead}</p>
      ) : (
        prose.sections.map((section) => (
          <div key={section.key} className={`term-card-part term-card-part-${section.key}`}>
            <p className="term-card-label">{section.label}</p>
            <p className="term-card-text">{section.text}</p>
          </div>
        ))
      )}

      {/* What the web said, if somebody has already asked. Kept under its own
          label for the reason the panel keeps it apart: a reader who cannot
          tell the checked answer from the remembered one has lost the thing
          the labels exist to give them. */}
      {entry.lookup && (
        <div className="term-card-part term-card-part-looked">
          <p className="term-card-label">
            <Globe size={9} />
            checked on the web
          </p>
          <p className="term-card-text">{entry.lookup.answer}</p>
        </div>
      )}

      <p className="term-card-foot">
        {entry.url && (
          /* `noreferrer` as well as `noopener`, as in the panel: the article's
             own URL is a reading history and a model-supplied link should not be
             handed ours. The scheme was checked server-side by `safeUrl`. */
          <a className="term-card-link" href={entry.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={10} />
            {hostOf(entry.url)}
          </a>
        )}
        {/* The way out to the full entry. Without it the underline is a
            dead end: the mark itself stays inert to a click, because pressing
            prose has always meant selecting it. */}
        <button type="button" className="term-card-open" onClick={onOpen}>
          <BookA size={10} />
          in the glossary
        </button>
      </p>
    </div>
  );
}
