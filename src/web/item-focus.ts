/**
 * **One item to bring into view in a band, once** — the way back from a chat
 * to the item it was started from lands here (plan
 * docs/plans/261009i-ask-in-chat-replaces-dig-deeper-and-a-chat-goes-back-to-its-item.md,
 * stage 2, and GPT Sol's F3: *selecting is not landing*).
 *
 * Citations had this first, as `CiteFocus` (plan 261004b): something outside
 * the band asks for a row, the band scrolls to it once it is drawn, and hands
 * the request back so that coming back to the band later does not scroll
 * again. Glossary, Ideas and Debate's claims take the same shape, so it lives
 * here and `CiteFocus` is this type under its old name.
 *
 * **Not a selection and not a URL parameter.** A selection (`?term=`,
 * `?idea=`) is what the row shows; this is only *where the band is
 * scrolled*, which nothing should reproduce on a reload. `n` tells two
 * requests for the same item apart, so a second press scrolls again.
 */
import { type RefObject, useEffect, useRef } from "react";

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
  return (now) => (now?.n === taken.n ? null : now);
}

/**
 * **Land on the focused row once the band has drawn it**, then hand the
 * request back. The three steps `CitationsPanel` takes, said once:
 *
 * - nothing happens until the band's list is `ready` (a list still loading
 *   answers nothing yet);
 * - an item the ready list does not `know` is dropped, not waited for: the
 *   band opens on its list, which is the honest way back to an item that was
 *   renamed or re-run away (the plan's F6);
 * - an item it knows but has not `drawn` yet (a filter about to be lowered)
 *   waits for the render that draws it.
 *
 * The row is found inside `scope` by `attribute` and scrolled into view with
 * `block: "nearest"`, so a row already on screen does not move. `onLand` may
 * do one more thing to it first (Debate unfolds a claim).
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
    for (const row of scope.current?.querySelectorAll<HTMLElement>(`[${attribute}]`) ?? []) {
      if (row.getAttribute(attribute) !== focus.id) continue;
      land.current?.(row);
      /* Optional call: jsdom has no `scrollIntoView`. */
      row.scrollIntoView?.({ block: "nearest" });
      break;
    }
    taken.current?.(focus);
  }, [focus, ready, known, drawn, scope, attribute]);
}

/**
 * **What a claim of Debate's is focused by**: its block and its words, the
 * pair that is its identity (`ClaimOrigin`; debate-order.ts), as one string.
 * Each claim row carries it in `data-claim-key`.
 */
export function claimFocusKey(claim: { blockId: string; quote: string }): string {
  return `${claim.blockId} ${claim.quote}`;
}
