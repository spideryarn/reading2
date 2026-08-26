/**
 * `‹ 2 / 4 ›` — stepping between the places in the article that one thing
 * appears.
 *
 * Greg, 2026-08-26, asking for it in both modes at once:
 *
 * > There should also be a way in both Ideas and Glossary modes to jump to
 * > prev/next exemplifying block
 *
 * Which is why this is a component rather than a piece of either panel. A
 * glossary term's occurrences and an idea's occurrences are different shapes —
 * one is a list of block ids computed by matching the term's own text, the
 * other is a list of quoted passages the model named — so what they share is
 * exactly this: an ordered list of somewhere-to-go, and a reader part-way
 * through it.
 *
 * ## Three decisions, and two of them are conventions rather than choices
 *
 * **It does not wrap.** At the last item, *next* is disabled. The plan's first
 * draft had it wrap, on the perfectly reasonable grounds that a greyed-out
 * arrow explains what "4 / 4" already says — and that is the wrong argument to
 * win here, because `stepComment` in comment-nav.ts deliberately does not wrap
 * and two steppers a few inches apart behaving differently on the same gesture
 * is worse than either rule on its own. The reason written down there is also
 * good: from the last one, wrapping flings the reader to the top of the
 * article, which is a big move to get from a small button.
 *
 * **Stepping does not jolt.** `onJump` is called only when the target is not
 * already on screen. That is `goToComment`'s rule rather than a search result's
 * — and the two really are different gestures. Pressing a *result* is arriving
 * somewhere, so it always moves ("I pressed it and nothing moved" is the
 * complaint that makes a results list feel broken); stepping ‹ › is moving
 * between neighbours, and scrolling to something the reader is already looking
 * at is the jolt.
 *
 * **No key bindings.** ↑ / ↓ belong to the article (docs/project/keyboard.md),
 * and putting them inside the band needs a focus story the band has not got —
 * the same gap that has kept the glossary's term list un-navigable by keyboard.
 * That is a "not yet" rather than a "no".
 *
 * The counter carries `aria-live="polite"`, copied from `CommentDialog` along
 * with the rest of the treatment, so a screen-reader user hears the position
 * change rather than only seeing it.
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { isBlockOnScreen } from "./scroll.js";
import type { BlockId } from "../types.js";

interface Props {
  /**
   * Where to go, **in document order**, one entry per place.
   *
   * Two entries may name the same block: one idea can be needed twice in the
   * same paragraph, and collapsing those would make the counter say "3 of 5"
   * and step through four. The caller orders this — `orderFound(…,
   * "document")` for ideas, `entry.blocks` for a glossary term, both of which
   * are already in `blocks.json` order.
   *
   * **Never sort this by block id.** The warning at the top of comment-nav.ts
   * applies here too: an id is random by construction, so sorting by the string
   * compiles, runs, and is meaningless.
   */
  targets: readonly Target[];
  /** Which one the reader is on, or null for "not started". */
  currentId: string | null;
  onGo(id: string, blockId: BlockId): void;
  /** "occurrence" / "passage" — what the tooltip calls the thing. */
  noun: string;
}

export interface Target {
  id: string;
  blockId: BlockId;
}

/**
 * Where the stepper is, and where its two arrows go — **the whole of the
 * component's logic, as a function**.
 *
 * Pulled out because the first test of this tested `stepComment` from
 * comment-nav.ts instead, which `BlockNav` does not call: the two agreed about
 * the middle of a list and disagreed about a `currentId` that is not in it at
 * all. `stepComment` returns null both ways; this treats an unknown id as
 * "before the first", so *next* still goes somewhere. Both are defensible and
 * only one of them is what runs. GPT Sol, 2026-08-27: *pick one contract and
 * test the component*.
 *
 * `position` is 1-based, and **0 means "not on one of them"** — which the
 * caller draws as "–". That is now a rarer state than it was: selecting an idea
 * opens its first passage, so the reader arrives already on 1. It survives for
 * the case it is honest about, which is a `currentId` that no longer resolves.
 */
export function navState(
  targets: readonly Target[],
  currentId: string | null,
): { position: number; prev: Target | null; next: Target | null } {
  const at = targets.findIndex((t) => t.id === currentId);
  return {
    position: at + 1,
    prev: (at > 0 ? targets[at - 1] : null) ?? null,
    /* From "before the first", *next* is the first — not the second. Reading
       `at + 1` off a -1 would land on index 0 by accident rather than by rule,
       which is the same answer for the wrong reason and would break the moment
       anyone changed the sentinel. */
    next: (at + 1 < targets.length ? targets[at + 1] : null) ?? null,
  };
}

export function BlockNav({ targets, currentId, onGo, noun }: Props) {
  /* Only worth the room once there is somewhere to go. One occurrence needs no
     stepper, and drawing a permanently dead pair of arrows beside it is chrome
     explaining that there is nothing to do. Same rule as `total > 1` in
     CommentDialog. */
  if (targets.length < 2) return null;

  const { position, prev, next } = navState(targets, currentId);

  const go = (target: Target | null) => () => {
    if (!target) return;
    onGo(target.id, target.blockId);
  };

  return (
    <span className="cmt-nav block-nav">
      <button
        type="button"
        onClick={go(prev)}
        disabled={!prev}
        title={`Previous ${noun}, up the article`}
        aria-label={`Previous ${noun}`}
      >
        <ChevronLeft size={15} />
      </button>
      <span className="cmt-count" aria-live="polite">
        {position || "–"} / {targets.length}
      </span>
      <button
        type="button"
        onClick={go(next)}
        disabled={!next}
        title={`Next ${noun}, down the article`}
        aria-label={`Next ${noun}`}
      >
        <ChevronRight size={15} />
      </button>
    </span>
  );
}

/**
 * Bring a block into view **only if it is not already there**.
 *
 * Exported beside the control rather than inlined, because the panels call it
 * for the occurrence chips too and the rule has to be the same one: a chip and
 * an arrow that land on the same paragraph should behave identically.
 *
 * This is `goToComment`'s rule (App.tsx), not a search result's. See the header.
 */
export function nudgeTo(blockId: BlockId, jump: (id: BlockId) => void): void {
  if (!isBlockOnScreen(blockId)) jump(blockId);
}
