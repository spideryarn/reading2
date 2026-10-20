/**
 * **Learn's three parts, one line each** — what Learn's (i) says after
 * the mode's two catalog sentences, in Recall and Explore
 * (ChatPanel.tsx). Greg, 2026-10-04 (spya-usyhwy), about that card when it was
 * one 110-word paragraph walking through every sub-mode: *"Prefer smaller
 * paragraphs or bullet points because it's much clearer."*
 *
 * Each chip has its own card now (QuizPanel.tsx § `LEARN_VIEW_HOW`), and
 * the three are still listed here because **a chip's card never opens under a
 * finger** — a tap presses the chip — while this (i) opens on a tap. The words
 * are the command bar's, so there is no third description of a sub-mode.
 *
 * **In its own file, not in BandAbout.tsx**, where it was first written:
 * BandAbout is also reached from the lazy /admin and /design routes, and
 * importing sub-modes.ts there put that module in both graphs
 * (tests/eager-client-graph.test.ts). Plan 261004f.
 *
 * **It lists the parts the chip row draws**, which is all three since Explore
 * came out of the experimental-features switch on 2026-10-11; a part put
 * behind it again would lose its line too, since a line about a part with no
 * chip would describe something the reader cannot find. The hook
 * is read here rather than handed down because this is a component of its own,
 * so only a Learn band subscribes. `current` is the part the band is on.
 */
import type { LearnView } from "./params.js";
import { LEARN_SUB_MODES, visibleLearnViews } from "./sub-modes.js";
import { useExperimental } from "./useExperimental.js";

export function LearnSubModesAbout({ current }: { current: LearnView }) {
  const { on } = useExperimental();
  return (
    <ul className="band-about-list">
      {visibleLearnViews(on, current).map((view) => {
        const { label, description } = LEARN_SUB_MODES[view];
        return (
          <li key={view}>
            <strong>{label}</strong>: {description}
          </li>
        );
      })}
    </ul>
  );
}
