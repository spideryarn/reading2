/**
 * **A Back the reader can press, naming the place it goes.**
 *
 * A reader clicks a glossary term, lands three thousand words away, and cannot
 * find their way home. On a desktop browser they press Back and it mostly
 * works; added to an iOS home screen — `"display": "standalone"` in
 * public/site.webmanifest, which is how Greg reads — there is no Back to press.
 * Stage B of docs/plans/260906g-back-to-where-you-jumped-from.md.
 *
 * ## It draws the browser's own stack, and keeps no stack of its own
 *
 * Every deliberate jump pushes a history entry (url-state.md § Position
 * replaces history) and Stage A put a stamp on that entry saying where the
 * reader was standing (jump-history.ts). So this component is a *view* of one
 * fact — `readStamp(history.state)`, through `useJumpOrigin` — and pressing it
 * calls `history.back()` and nothing else. **Nothing here scrolls anything:**
 * `popstate` restores the predecessor's `?at=`, nuqs hands it to the `at`
 * parameter, and `useReadingPosition`'s restore effect moves the page, which is
 * the same path a pasted link takes. Adding a `scrollToBlock` here would be a
 * second mover racing that one.
 *
 * Repeated presses walk the chain backwards, which is the dropdown Greg
 * imagined without any of its machinery — and the machinery is not optional,
 * since JavaScript can see `history.length` and nothing else in the stack.
 *
 * ## When it is not there
 *
 * Exactly when the current entry carries no usable stamp, and there is **no
 * hide rule of any other kind** — not distance, not "you are already in that
 * section". A citation five paragraphs away is a genuine pushed jump inside one
 * section, and hiding the chip there would suppress a real return: GPT Sol F2,
 * 2026-09-06. The two things that *do* remove it are the reader taking the
 * stack onwards (any push strips the stamp) and the reader saying so (the ×).
 *
 * A stamp naming a block this article no longer has — the reader jumped, the
 * piece was re-extracted, the id went — draws nothing rather than a button that
 * would do nothing, which is the same graceful nothing `scrollToBlock` gives a
 * stale `?at=`.
 */
import { X } from "lucide-react";

import type { BlockId } from "../types.js";
import type { JumpOrigin } from "./jump-history.js";
import { type Section, sectionIndexContaining } from "./position.js";
import { dismissJumpOrigin, useJumpOrigin } from "./router.js";

export function ReturnChip({
  sections,
  rowOf,
}: {
  sections: readonly Section[];
  /** The article's block → row index, which is how a stamp is placed. */
  rowOf: ReadonlyMap<BlockId, number>;
}) {
  const origin = useJumpOrigin();
  const label = origin === null ? null : labelFor(origin, sections, rowOf);
  if (label === null) return null;

  return (
    /* `role="note"` and no live region, for `InstallHint`'s reason: this is a
       standing affordance rather than an announcement, and interrupting a
       screen-reader user mid-sentence to describe a pill they can reach in the
       ordinary tab order would be the wrong trade. */
    <div className="return-chip" role="note">
      <button
        type="button"
        className="return-chip-go"
        /* `history.back()`, and that really is the whole handler — see the
           header. It is also why this is a button rather than a link: there is
           no href for "the entry before this one". */
        onClick={() => history.back()}
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
        title="Hide this"
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
