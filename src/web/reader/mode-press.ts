/**
 * **What a press on one of the bar's bands does** — Marginalia's toggle aside
 * (`marginaliaPress`), and a sub-mode row aside, which always moves to that
 * sub-mode. Greg, 2026-10-01 (SPIDERYARN-READING2-96): *"If I click the
 * "Plain" mode, it should close both left-hand and right-hand column modes.
 * And if I click a mode that's already active, it should deactivate that
 * mode."*
 *
 *  - `plain` — Plain was pressed: close the band **and** the notes.
 *  - `close` — the band on screen was pressed again: close it, and leave the
 *    notes as they are (Greg asked to deactivate *that* mode).
 *  - `open` — anything else, including the band you are in while it has
 *    stepped aside on a narrow window (`bandBack`), where the press brings it
 *    back: the reader cannot see it, so there is nothing to close. And the
 *    command bar (`toggle` false), which names a destination: choosing the
 *    mode you are in leaves you in it (GPT Sol, plan review).
 *
 * docs/plans/261002g-plain-closes-both-columns-a-second-press-closes-a-mode-and-plain-and-marginalia-in-frames-of-their-own.md.
 */
import type { BandMode } from "../params.js";

export type ModePress = "plain" | "close" | "open";

export function modePress({
  next,
  current,
  bandBack,
  toggle,
}: {
  next: BandMode;
  current: BandMode;
  /** The current band has stepped aside and its back pill is showing. */
  bandBack: boolean;
  /** A press on the bar's own button, rather than a command-bar row. */
  toggle: boolean;
}): ModePress {
  if (next === "plain") return "plain";
  if (toggle && next === current && !bandBack) return "close";
  return "open";
}
