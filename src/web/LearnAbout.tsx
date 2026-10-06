/**
 * **Learn's four parts, one line each** — what Learn's (i) says after
 * the mode's two catalog sentences, in Recall, Tutorial and Explore
 * (ChatPanel.tsx). Greg, 2026-10-04 (spya-usyhwy), about that card when it was
 * one 110-word paragraph walking through every sub-mode: *"Prefer smaller
 * paragraphs or bullet points because it's much clearer."*
 *
 * Each chip has its own card now (QuizPanel.tsx § `LEARN_VIEW_HOW`), and
 * the four are still listed here because **a chip's card never opens under a
 * finger** — a tap presses the chip — while this (i) opens on a tap. The words
 * are the command bar's, so there is no third description of a sub-mode.
 *
 * **In its own file, not in BandAbout.tsx**, where it was first written:
 * BandAbout is also reached from the lazy /admin and /design routes, and
 * importing sub-modes.ts there put that module in both graphs
 * (tests/eager-client-graph.test.ts). Plan 261004f.
 *
 * **It lists the parts the chip row draws, not always all four**: Explore is
 * behind the experimental-features switch since 2026-10-05, and a line about a
 * part with no chip would describe something the reader cannot find. The hook
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
