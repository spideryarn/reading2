/**
 * **One item to bring into view in a band, once** — the way back from a chat
 * to the item it was started from lands here (plan
 * docs/plans/261009k-ask-in-chat-replaces-dig-deeper-and-a-chat-goes-back-to-its-item.md,
 * stage 2, and GPT Sol's F3: *selecting is not landing*).
 *
 * Citations had this first, as `CiteFocus` (plan 261004b): something outside
 * the band asks for a row, the band scrolls to it once it is drawn, and hands
 * the request back so that coming back to the band later does not scroll
 * again. Glossary, Ideas and Claims' claims take the same shape, so it lives
 * here and `CiteFocus` is this type under its old name.
 *
 * **Not a selection and not a URL parameter.** A selection (`?term=`,
 * `?idea=`) is what the row shows; this is only *where the band is
 * scrolled*, which nothing should reproduce on a reload. `n` tells two
 * requests for the same item apart, so a second press scrolls again.
 */
import { type RefObject, useEffect, useRef } from "react";
import type { BandMode } from "../modes.js";
import { flashElement } from "./flash.js";
import type { SourcesView } from "./params.js";

export interface ItemFocus {
  /** What the band's rows carry in their data attribute. */
  id: string;
  /** Raised on every request, so two for the same item are two. */
  n: number;
}

/** The next request for `id`, as a state updater: `setFocus(focusOn(id))`. */
export function focusOn(id: string): (was: ItemFocus | null) => ItemFocus {
  return (was) => ({ id, n: (was?.n ?? 0) + 1 });
}

/**
 * Forget the request that was served, and only that one: a second press may
 * have replaced it while the first was waiting. A state updater:
 * `setFocus(focusTaken(taken))`.
 */
export function focusTaken(taken: ItemFocus): (now: ItemFocus | null) => ItemFocus | null {
  return (now) => (now?.id === taken.id && now.n === taken.n ? null : now);
}

/**
 * **Land on the focused row once the band has drawn it**, then hand the
 * request back. The three steps `BibliographyPanel` takes, said once:
 *
 * - nothing happens until the band's list is `ready` (a list still loading
 *   answers nothing yet);
 * - an item the ready list does not `know` is dropped, not waited for: the
 *   band opens on its list, which is the honest way back to an item that was
 *   renamed or re-run away (the plan's F6);
 * - an item it knows but has not `drawn` yet (a filter about to be lowered)
 *   waits for the render that draws it.
 *
 * The row is found inside `scope` by `attribute`, **centred in its own
 * scroller where its scroll range permits, and flashed** (`centreInScroller`,
 * flash.ts § `flashElement`). The first and last rows naturally clamp at the
 * list's ends; the flash still identifies them without adding blank half-list
 * gutters to every band.
 * Greg, 2026-10-17, spya-m53cdk: *"can we scroll to the right source (perhaps
 * centred in the scrollable area), and flash it"*. It was `block: "nearest"`
 * until then, so a row already on screen did not move — and a reader who had
 * just pressed *Open in Sources* could not tell which of forty rows it was.
 * All four lists land this way on purpose: one job, one look (controls.md §
 * Controls that do the same job look the same). Plan
 * docs/plans/261017h-sources-go-to-a-work-lands-and-flashes-and-a-blurb-per-cited-work.md.
 * `onLand` may do one more thing to it first (Claims unfolds a claim), and it
 * is measured after that.
 */
export function useLandOnItem({
  focus,
  ready,
  known,
  drawn,
  scope,
  attribute,
  onTaken,
  onLand,
}: {
  focus: ItemFocus | null | undefined;
  ready: boolean;
  /** Whether the ready list has `focus.id` at all. */
  known: boolean;
  /** Whether the row for it is drawn now. */
  drawn: boolean;
  scope: RefObject<HTMLElement | null>;
  /** The data attribute each row carries its id in, e.g. `data-idea-id`. */
  attribute: string;
  onTaken?: ((focus: ItemFocus) => void) | undefined;
  onLand?: ((row: HTMLElement) => void) | undefined;
}): void {
  /* Through refs, so a caller's inline callbacks do not re-run the effect. */
  const taken = useRef(onTaken);
  taken.current = onTaken;
  const land = useRef(onLand);
  land.current = onLand;
  useEffect(() => {
    if (!focus || !ready) return;
    if (!known) {
      taken.current?.(focus);
      return;
    }
    if (!drawn) return;
    let watch: ResizeObserver | null = null;
    const attempt = () => {
      for (const row of scope.current?.querySelectorAll<HTMLElement>(`[${attribute}]`) ?? []) {
        if (row.getAttribute(attribute) !== focus.id) continue;
        land.current?.(row);
        const scroller = scrollerOf(row);
        /* A band that is stepped aside measures zero. Keep the focus rather
           than flashing it invisibly and reporting it served; its scroller's
           first non-zero layout gets the same landing attempt. */
        if (scroller && !centreInScroller(row, scroller)) {
          if (typeof ResizeObserver === "function" && watch === null) {
            watch = new ResizeObserver(() => {
              if (scroller.clientHeight <= 0) return;
              watch?.disconnect();
              watch = null;
              attempt();
            });
            watch.observe(scroller);
          }
          return;
        }
        flashElement(row);
        taken.current?.(focus);
        return;
      }
    };
    attempt();
    return () => {
      watch?.disconnect();
      watch = null;
    };
  }, [focus, ready, known, drawn, scope, attribute]);
}

/**
 * **The scroller a band row is in**: the nearest ancestor whose computed
 * `overflow-y` scrolls — `.tl-scroll` (Bibliography), `.gloss-list`
 * (Glossary), `.ideas-scroll` (Ideas), `.rcp-scroll` / `.rcp-listed-wrap`
 * (Claims). Asked of the computed style, as ViewportProbe.tsx § `scrollerIn`
 * does, rather than of a class list four panels would have to keep in step.
 * **It stops at the band** (`.mode-band`) and never reaches the document: a
 * row in no scroller of its own is left where it is.
 */
function scrollerOf(row: HTMLElement): HTMLElement | null {
  for (let el = row.parentElement; el && el !== document.body; el = el.parentElement) {
    if (el.classList.contains("mode-band")) return null;
    const o = getComputedStyle(el).overflowY;
    if (o === "auto" || o === "scroll") return el;
  }
  return null;
}

/**
 * **Put `row`'s centre at the centre of its scroller's visible box**, at once,
 * where the scroller's range permits it. The browser clamps a first or last
 * row at the corresponding edge; centring those too would require persistent
 * blank scroll room at both ends of all four lists.
 * The scroller's own `scrollTop`, never `scrollIntoView`, which scrolls every
 * scrollable ancestor too, the page included (GPT Sol's F1 on plan 261017h;
 * list-step.ts § `useFollowRow` keeps the same rule). Instant because there is
 * no travel worth watching — the band has just opened, or the reader pressed
 * for this row — so the flash can start straight away rather than wait for a
 * settle. A row taller than the scroller (an unfolded claim) starts at its top,
 * so its head is not the part cut off. Clamped at 0; the browser clamps the
 * other end. Nothing moves while the scroller measures nothing (a band
 * stepped aside).
 */
function centreInScroller(row: HTMLElement, scroller: HTMLElement): boolean {
  if (scroller.clientHeight <= 0) return false;
  const box = row.getBoundingClientRect();
  /* `getBoundingClientRect()` starts at the border box; scrolling starts at
     the padding edge. Without `clientTop`, a bordered scroller lands high by
     exactly its top border (chat-steps.ts § turnStarts uses the same origin). */
  const top =
    box.top - (scroller.getBoundingClientRect().top + scroller.clientTop) + scroller.scrollTop;
  const height = scroller.clientHeight;
  const to = box.height > height ? top : top + box.height / 2 - height / 2;
  scroller.scrollTop = Math.max(0, Math.round(to));
  return true;
}

/**
 * **What a claim of Claims' is focused by**: its block and its words, the
 * pair that is its identity (`ClaimOrigin`; reception-order.ts), as one string.
 * Each claim row carries it in `data-claim-key`.
 */
export function claimFocusKey(claim: { blockId: string; quote: string }): string {
  return `${claim.blockId} ${claim.quote}`;
}

/** The lists a focus can bring a row into view in, one piece of state each (Reader.tsx).
    `finding` is the literature search's dossier (plan 261024o), in *Where it
    sits* since plan 261025h (in Investigate before): a margin *literature*
    line's *Open in Sources*, and a finding or overview chat's way back.
    `explanation` is a margin *Explained* line's *Open in Explanations* (plan 261028c). */
export type FocusSlot = "term" | "cite" | "idea" | "claim" | "finding" | "explanation";

/** Where the reader is, as far as a focus cares: the mode, and Sources' sub-mode. */
export interface FocusPlace {
  mode: BandMode;
  sources: SourcesView;
}

/** The list a place shows, if it is one a focus can land in. */
function slotAt(place: FocusPlace): FocusSlot | null {
  switch (place.mode) {
    case "glossary":
      return "term";
    case "ideas":
      return "idea";
    case "explanations":
      return "explanation";
    case "sources":
      return place.sources === "bibliography"
        ? "cite"
        : place.sources === "claims"
          ? "claim"
          : place.sources === "where"
            ? "finding"
            : null;
    default:
      return null;
  }
}

/**
 * **Which focuses a move forgets** — the one the reader has just left, if
 * they left its list. A focus belongs to one visit: a reader who leaves while
 * the list is still loading (or a filter is being lowered) never lets the panel
 * hand it back, and an ordinary later visit would jump to the old chat's item.
 *
 * **Asked of the list, not the mode**, since 2026-10-09: Bibliography and
 * Claims are two sub-modes of Sources, and moving between them does not
 * change `mode` (GPT Sol's F7 on plan 261009l). Arriving forgets nothing, so a
 * focus set in the same tick as the move that shows its list survives it.
 */
export function focusesLeft(was: FocusPlace, now: FocusPlace): FocusSlot[] {
  const left = slotAt(was);
  return left !== null && left !== slotAt(now) ? [left] : [];
}
