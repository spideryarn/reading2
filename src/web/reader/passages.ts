/**
 * **Which passages the article is marked with, and which of them is rung —
 * decided once, for every mode.**
 *
 * Five bands resolve passages and push a `Found[]` up to `Reader`: Ideas,
 * Quotes, Timeline, Referee and Search. They keep five separate slots on
 * purpose — an outgoing band's cleanup must not erase an incoming band's
 * publication, and the history of that is in `Reader` beside each `useState`
 * and in docs/plans/260826ac-ideas-mode.md. This file is the other half: given
 * the mode, **which slot is the page actually drawing from**.
 *
 * ## Why it is a function, and why it is total
 *
 * It was two independent ternary chains inside `Reader` until 2026-09-06:
 *
 * ```ts
 * const passages    = mode === "ideas" ? ideaFound : … : found;
 * const openPassage = mode === "ideas" ? openOccurrence : … : openHit;
 * ```
 *
 * Two things were wrong with that, and only one of them was cosmetic.
 *
 * - **They agreed by coincidence.** Two chains testing `mode` in the same order
 *   and ending in the same slot is a convention, not a check, so a mode added
 *   to one and not the other would have marked one band's passages and rung
 *   another band's key. Returning both halves together makes that unsayable:
 *   `buildHitMarks(found, openKey, …)` can only ever be handed one slot's pair.
 * - **Nine modes inherited Search's results.** Both chains ended `: found` /
 *   `: openHit`, so Plain, Hierarchy, Chat, Glossary, Summary, Diagram,
 *   Remember, Outline and Debate were all reading Search's slot. That drew one
 *   painted frame of Search's marks on the way into Plain until 2026-09-06,
 *   when `usePassageLifecycle` made every producer's unmount clear a *layout*
 *   cleanup — so **the frame was already gone before this file existed**. What
 *   was left is worse-wearing than a frame: nine modes that are correct only
 *   because a producer in another file says goodbye properly. The switch below
 *   answers `NOTHING` for those nine, so they no longer depend on it.
 *
 * The `never` default is the idiom in visitor.ts § `visitorGap`: a fifteenth
 * mode is a compile error here rather than a mode that quietly shows the last
 * band's marks. That, and the exhaustive `band()` switch in Reader.tsx, are what
 * docs/project/new-mode.md now sends a maintainer to.
 *
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md
 * § Stage 4b, and docs/plans/260905e-main-app-architecture-review.md § A3.
 */
import type { Mode } from "../../modes.js";
import type { Found } from "../search-hits.js";

/**
 * One producer's pair: the passages it has published, and which of them the
 * reader last pressed.
 *
 * `openKey` is `null` for a band that has nothing rung — and for Claims, which
 * has no key at all, that is the only value it can take. The two fields travel
 * together everywhere, which is the point of the type.
 */
export interface PassageSlot {
  readonly found: Found[];
  readonly openKey: string | null;
}

/**
 * The five slots `Reader` holds, named by the mode that writes each one.
 *
 * `referee` is written by two bands — Criteria and Claims — which is the one
 * slot shared by a pair of producers, and why the passage lifecycle clears in a
 * layout cleanup (docs/postmortems/260906d-one-publication-slot-two-producers-two-commit-phases.md).
 * `search` is the slot whose band names its half `openHit`/`onOpenHit`; the
 * name stops at the band's props, and here it is a key like the others.
 */
export interface PassageSlots {
  readonly ideas: PassageSlot;
  readonly quotes: PassageSlot;
  readonly timeline: PassageSlot;
  readonly referee: PassageSlot;
  readonly search: PassageSlot;
}

/**
 * **No passages, as one array for the life of the module.**
 *
 * Not a fresh `[]` per call, and this is a performance fact rather than
 * tidiness: `hitMarks`, `hitStrength`, `hitHues` and `hitBlocks` are all memos
 * keyed on this array by identity, so a new empty array every render would
 * rebuild every block's marks on every render — in Plain, where there is
 * nothing to draw at all. Same rule as `NO_EVENTS`, `NO_QUOTES`, `NO_TERMS` and
 * `NO_SEARCHES`, and the same rule the empty slots in reader-capability.ts
 * follow.
 *
 * Exported so a test can assert the nine non-producers share it *by identity*,
 * which is the only way that property can be checked at all.
 */
export const NO_FOUND: Found[] = [];

/**
 * The answer for a mode with no passage producer — one object, for the same
 * reason `NO_FOUND` is one array.
 */
const NOTHING: PassageSlot = { found: NO_FOUND, openKey: null };

/**
 * **The mode → slot mapping, total over `Mode`.**
 *
 * Every arm returns a whole `PassageSlot` rather than picking a field out of
 * one, so the marks and the ring can never come from different bands.
 */
export function selectPassages(mode: Mode, slots: PassageSlots): PassageSlot {
  switch (mode) {
    case "ideas":
      return slots.ideas;
    case "quotes":
      return slots.quotes;
    case "timeline":
      return slots.timeline;
    case "referee":
      return slots.referee;
    /* **Named rather than fallen into**, which is the whole change: this arm
       used to be the end of a ternary chain, and nine other modes reached it. */
    case "search":
      return slots.search;
    /* The nine with nothing to mark. `plain` and `hierarchy` have no band at
       all; `chat`, `glossary`, `summary`, `diagram`, `remember`, `outline` and
       `debate` have one that publishes no passages — verified rather than
       assumed for chat and remember when they moved
       (docs/plans/260906c… § Stage 2), and `glossary`'s selection is a
       different currency (`termSelections`) that never reaches this state. */
    case "plain":
    case "hierarchy":
    case "chat":
    case "glossary":
    case "summary":
    case "diagram":
    case "remember":
    case "outline":
    /* Structure marks nothing in the prose, and it is beside Outline here for
       the same reason: it is navigation over the tree, so every row of it is
       already a door into a passage rather than a claim about one. A mode that
       lit its own rows' blocks in the prose would mark the whole article. */
    case "structure":
    case "debate":
      return NOTHING;
    default: {
      /* The compiler being made to say that every mode has been given an
         answer. A fifteenth mode goes red here, at the point it is added,
         rather than silently drawing whichever slot the last arm happened to
         name. visitor.ts § `visitorGap` is the same idiom. */
      const unhandled: never = mode;
      return unhandled;
    }
  }
}
