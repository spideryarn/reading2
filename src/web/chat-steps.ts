/**
 * **Where Chat's ↑ and ↓ buttons land** — the turn starts of a transcript, in
 * the scroller's own pixels, and which one a press goes to.
 *
 * Greg, spya-qd2agx, 2026-10-08: *"In the chat interface, we have a button to
 * scroll to the latest. It would be nice to have up and down buttons somehow,
 * and maybe even top to make it easier, especially on mobile, to scroll
 * between individual messages within the chat."*
 *
 * The rule is the article's ↑/↓, `stepTarget` in keynav.ts, not a second copy
 * of it: ↓ is the next turn; ↑ part-way into a turn goes to that turn's own
 * start, and only from its start to the one before. So inside a long answer ↑
 * takes you to where the answer began, which is the place you most likely
 * wanted, and ↓ then ↑ is a round trip.
 *
 * What this adds is pixels, and two ends. `stepTarget` compares integers
 * exactly; a scroller's `scrollTop` is fractional on a high-DPI screen and is
 * clamped by the browser, so a view we put exactly on a turn can read back
 * half a pixel either side of it. Within `SNAP` of a start counts as on it.
 * And a transcript holding a streamed answer has two bottoms: where its words
 * end (`end`), and how far the room under a held question lets it scroll
 * (`max`). A turn is stepped to wherever the room lets it reach — the held
 * question back at the top — but running out of turns goes to the words' end,
 * never down into the empty room.
 * docs/plans/261008c-chat-back-to-the-list-on-a-phone-the-model-in-the-thread-s-i-and-step-between-messages.md § 3.
 */
import { stepTarget } from "./keynav.js";

/** How close to a turn's start the view's top has to be to count as on it. */
export const SNAP = 2;

/** The two bottoms of a transcript, in `scrollTop` terms. */
export interface StepEnds {
  /** Where the transcript's own content ends: `scrollHeight - room - clientHeight`. */
  end: number;
  /** The furthest the scroller can go, room included: `scrollHeight - clientHeight`. */
  max: number;
}

/**
 * Where a press puts the scroller's top, or null for nowhere to go — which is
 * also what disables the button, so a button that is enabled always moves.
 *
 * `starts` are the turns' tops in scroll coordinates, ascending; `top` is the
 * current `scrollTop`.
 */
export function chatStep(starts: readonly number[], top: number, ends: StepEnds, dir: -1 | 1): number | null {
  const { end, max } = ends;
  const moves = (to: number) => Math.abs(to - top) > SNAP;
  if (starts.length === 0) return null;
  /* On a start, within the slack, is exactly on it — so ↑ from there is the
     turn before, not the same one again. */
  const on = starts.find((s) => Math.abs(s - top) <= SNAP);
  const at = on ?? top;
  const first = starts[0]!;
  if (dir === -1) {
    /* Above the first turn there is only the transcript's padding: nowhere. */
    if (at <= first) return null;
    const target = stepTarget([...starts], at, -1);
    return target !== null && moves(target) ? target : null;
  }
  /* `stepTarget` clamps a view above the first item to that item, so ↓ from
     there would skip it. The transcript's padding is above the first turn. */
  const target = at < first ? first : stepTarget([...starts], at, 1);
  if (target !== null) {
    const to = Math.min(target, max);
    if (moves(to)) return to;
  }
  /* Out of turns, or the next cannot move the view: the words' end, if the
     view is above it. */
  return top < end - SNAP ? end : null;
}

/**
 * The turns' starts, measured. Each turn is a `[data-turn]` child of the
 * scroller (ChatPanel.tsx `Turn`), and its top in scroll coordinates is its
 * offset from the scroller's top plus how far the scroller has scrolled.
 */
export function turnStarts(scroller: HTMLElement): number[] {
  const box = scroller.getBoundingClientRect().top + scroller.clientTop;
  const starts: number[] = [];
  for (const turn of scroller.querySelectorAll<HTMLElement>(":scope > [data-turn]")) {
    starts.push(turn.getBoundingClientRect().top - box + scroller.scrollTop);
  }
  return starts.sort((a, b) => a - b);
}
