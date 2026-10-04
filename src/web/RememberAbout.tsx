/**
 * **Remember's four parts, one line each** — what Remember's (i) says after
 * the mode's two catalog sentences, in Recall, Tutorial and Explore
 * (ChatPanel.tsx). Greg, 2026-10-04 (spya-usyhwy), about that card when it was
 * one 110-word paragraph walking through every sub-mode: *"Prefer smaller
 * paragraphs or bullet points because it's much clearer."*
 *
 * Each chip has its own card now (QuizPanel.tsx § `REMEMBER_VIEW_HOW`), and
 * the four are still listed here because **a chip's card never opens under a
 * finger** — a tap presses the chip — while this (i) opens on a tap. The words
 * are the command bar's, so there is no third description of a sub-mode.
 *
 * **In its own file, not in BandAbout.tsx**, where it was first written:
 * BandAbout is also reached from the lazy /admin and /design routes, and
 * importing sub-modes.ts there put that module in both graphs
 * (tests/eager-client-graph.test.ts). Plan 261004f.
 */
import { subModesOf, subModeWords } from "./sub-modes.js";

export function RememberSubModesAbout() {
  return (
    <ul className="band-about-list">
      {subModesOf("remember").map((sub) => {
        const { label, description } = subModeWords(sub);
        return (
          <li key={sub.view}>
            <strong>{label}</strong>: {description}
          </li>
        );
      })}
    </ul>
  );
}
