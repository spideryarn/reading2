/**
 * **A Back the reader can press, naming the place it goes.**
 *
 * A reader clicks a glossary term, lands three thousand words away, and cannot
 * find their way home. On a desktop browser they press Back and it mostly
 * works; added to an iOS home screen — `"display": "standalone"` in
 * public/site.webmanifest, which is how Greg reads — there is no Back to press.
 * Stage B of docs/plans/260906g-back-to-where-you-jumped-from.md.
 *
 * ## It moves the position, and nothing else
 *
 * Every deliberate jump pushes a history entry (url-state.md § Position
 * replaces history) stamped with where the reader was standing
 * (jump-history.ts), and the stamp rides along on every later push that stays
 * on this article. So this component is a *view* of one fact — the origin on
 * `history.state`, through `useJumpOrigin` — and pressing it calls `onReturn`,
 * which is `useReadingPosition`'s `returnToOrigin`: a push of today's address
 * with only `?at=` changed, and the move (keynav.ts § `beginReturn`).
 *
 * > I think it would be better if it just changed the position, and so if I
 * > changed modes since, those modes would stay as they are currently.
 * >
 * > — Greg, 2026-10-08 (spya-q3dfmw)
 *
 * Until then it was `history.go(-depth)`, a Back that walked to the entry the
 * jump left — and that entry's `?mode=` came back with its position.
 * docs/plans/261008g-the-way-back-chip-moves-the-position-and-leaves-the-modes-alone.md.
 *
 * **Nothing here scrolls anything**: the one mover is `beginReturn`, beside
 * `beginJump`, and a `scrollToBlock` here would race it.
 *
 * Repeated presses unwind the journeys in order — the dropdown Greg imagined
 * when the chip was built, carried on the stamp as `earlier`.
 *
 * ## The prose has to be visible to land in
 *
 * The origin is always a place in the prose (keynav.ts § `measureOrigin`
 * measures only the article's own rows), never inside a mode's band. On a phone
 * an open band lies over the whole article, so a return there would move prose
 * nobody can see; the reader view's `onReturn` steps such a band aside first —
 * the same `bandAway` a passage link in a band uses (Reader.tsx §
 * `returnFromJump`) — leaving the mode itself as it is.
 *
 * ## When it is not there
 *
 * Exactly when the current entry carries no usable stamp, and there is **no
 * hide rule of any other kind** — not distance, not "you are already in that
 * section", and since 2026-09-16 not a depth limit either. A citation five
 * paragraphs away is a genuine pushed jump inside one section, and hiding the
 * chip there would suppress a real return: GPT Sol F2, 2026-09-06. The things
 * that *do* remove it are the reader leaving the article, the reader saying so
 * (the ×), and since 2026-10-18 thirty seconds without interacting with it,
 * which is the × pressed for them (`RETURN_CHIP_MS`, Greg's number). Hover or
 * focus pauses that clock. That is time, not an inferred place, so F2's reason
 * does not reach it: a reader who has left it alone for thirty seconds is not
 * going to press it (spya-vzrjju).
 * docs/plans/261018e-a-tap-on-a-cross-reference-shows-its-card-first-and-the-way-back-chip-goes-after-thirty-seconds.md.
 *
 * A stamp naming a block this article no longer has — the reader jumped, the
 * piece was re-extracted, the id went — draws nothing rather than a button that
 * would do nothing, which is the same graceful nothing `scrollToBlock` gives a
 * stale `?at=`.
 */
import { X } from "lucide-react";
import { useEffect, useState } from "react";

import type { BlockId } from "../types.js";
import type { JumpOrigin } from "./jump-history.js";
import { type Section, sectionIndexContaining } from "./position.js";
import { dismissJumpOrigin, jumpStampKey, useJumpOrigin, useJumpStampKey } from "./router.js";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * **How long the chip waits to be pressed before it goes by itself** — Greg,
 * 2026-10-17 (spya-vzrjju): *"after a while, if I haven't clicked it, probably
 * I'm never gonna … 30 second timeout on it, and after that it just
 * disappears"*. It goes as the × does, so Back is untouched.
 */
export const RETURN_CHIP_MS = 30_000;
/** Its fade on the way out, `.return-chip-going` in dock.css. */
const FADE_MS = 500;

export function ReturnChip({
  sections,
  rowOf,
  onReturn,
}: {
  sections: readonly Section[];
  /** The article's block → row index, which is how a stamp is placed. */
  rowOf: ReadonlyMap<BlockId, number>;
  /** The press: back to the origin, the position only — see the header. */
  onReturn: () => void;
}) {
  const origin = useJumpOrigin();
  const label = origin === null ? null : labelFor(origin, sections, rowOf);
  const stampKey = useJumpStampKey();
  if (label === null) return null;

  /* The stateful half unmounts whenever the chip disappears, which resets
     hover/focus before any later journey. Removing a focused or hovered DOM
     node does not promise a blur/pointerleave, so keeping these states in this
     always-mounted wrapper could exempt the next journey from its timeout
     forever. It stays mounted across a new journey that remains visible, so a
     pointer or focus still on the chip continues to hold it. */
  return <VisibleReturnChip label={label} stampKey={stampKey} onReturn={onReturn} />;
}

function VisibleReturnChip({
  label,
  stampKey,
  onReturn,
}: {
  label: string;
  stampKey: string;
  onReturn: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = hovered || focused;
  const [going, setGoing] = useState(false);

  /* The clock, per journey: keyed on the whole stamp, so a new jump starts it
     again even from the same block, and the cleanup plus the check at the end
     mean an older journey's clock can never strip a newer one's stamp (GPT
     Sol, plan review). Held while the reader is on the chip; a fresh thirty
     seconds once they leave it. Under reduced motion it goes without the fade. */
  useEffect(() => {
    setGoing(false);
    if (held || stampKey === "") return;
    const fadeMs = prefersReducedMotion() ? 0 : FADE_MS;
    const fade = setTimeout(() => setGoing(true), RETURN_CHIP_MS);
    const gone = setTimeout(() => {
      if (jumpStampKey() === stampKey) dismissJumpOrigin();
    }, RETURN_CHIP_MS + fadeMs);
    return () => {
      clearTimeout(fade);
      clearTimeout(gone);
    };
  }, [stampKey, held]);

  return (
    /* `role="note"` and no live region, for `InstallHint`'s reason: this is a
       standing affordance rather than an announcement, and interrupting a
       screen-reader user mid-sentence to describe a pill they can reach in the
       ordinary tab order would be the wrong trade. */
    <div
      className={going ? "return-chip return-chip-going" : "return-chip"}
      role="note"
      /* A mouse or a pen resting on it holds it; a finger rests nowhere, and on
         iOS its tap leaves a hover behind that would hold it for ever. */
      onPointerEnter={(e) => {
        if (e.pointerType !== "touch") setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <button
        type="button"
        className="return-chip-go"
        /* A button rather than a link: the address it writes is decided at the
           press, from whatever the reader has open by then. */
        onClick={onReturn}
      >
        {/* Decorative: the sentence beside it already says what the press
            does, so a screen reader reading "left arrow hook" first would only
            be in the way. */}
        <span aria-hidden="true">↩</span> {label}
      </button>
      <button
        type="button"
        className="return-chip-close"
        onClick={() => dismissJumpOrigin()}
        data-tip="Hide this"
        aria-label="Hide the way back"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/**
 * What the chip says, or `null` for "draw nothing".
 *
 * **The top of the article is not a section.** Naming the first one there would
 * promise a heading and deliver the masthead — the origin is `top` precisely
 * because `measureRow()` answers `0` whether or not any row has reached the
 * reading line (jump-history.ts § JumpOrigin, GPT Sol F8).
 *
 * Otherwise it is the *section's* title rather than anything about the block
 * itself: a block id is not a place a reader recognises, and the title is
 * two to six words by construction (tree.ts). `sectionIndexContaining` is the
 * helper, and `sectionContaining` is not — that one answers with the section's
 * first block, which is how the *address* spells a section and not how a
 * sentence does.
 *
 * A section with no title is not a reason to withhold a working return, so it
 * falls back to the generic. This is the only phrasing here that names no
 * place, and it is deliberately not the answer for a stamp the article cannot
 * resolve: that one has nowhere to go, and this one does.
 */
function labelFor(
  origin: JumpOrigin,
  sections: readonly Section[],
  rowOf: ReadonlyMap<BlockId, number>,
): string | null {
  if (origin.kind === "top") return "back to the beginning";
  const index = sectionIndexContaining(sections, rowOf, origin.blockId);
  if (index === null) return null;
  const title = sections[index]?.title.trim() ?? "";
  return title === "" ? "back to where you were" : `back to ${title}`;
}
