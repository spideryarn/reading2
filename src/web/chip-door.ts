/**
 * **The modes a chat chip may open** — the rows `modeDoor`
 * (src/web/command-runners.ts) is built from, worked out here rather than
 * inside Reader.tsx's `useMemo` so that a test can hold them.
 *
 * Plan 261007j, GPT Sol's F3: the command bar's mode and sub-mode rows, from
 * the same two functions the Dock and the bar call — `visibleModes` with this
 * page's switch, mode and margin, then `subModeRows`. One deliberate
 * subtraction: those functions keep an experimental mode already open (or a
 * retained experimental sub-mode) visible as the reader's way out after the
 * switch is turned off. That escape hatch must not make a model-written token a
 * way *into* the hidden feature, so the rows lose every experimental target
 * while the switch is off.
 *
 * **The guide's door adds the named exceptions** (plan
 * docs/plans/261009u-the-guide-offers-referee-to-a-reader-who-says-they-are-refereeing.md):
 * `guideDoorRows`. Chat's door does not, so an old or planted Referee token in
 * an ordinary chat stays plain text with the switch off (GPT Sol's F1 on that
 * plan). Neither list is the bar's: the Dock and the command bar do not read
 * this file.
 */
import { MODE_CATALOG, OFFERED_BEHIND_THE_SWITCH } from "../mode-catalog.js";
import type { Mode as ModeWord } from "../modes.js";
import { subModeRows } from "./CommandBar.js";
import { commandId, modeCommand } from "./command-match.js";
import type { ModeCommand } from "./command-runners.js";
import type { DiagramKind } from "./diagram.js";
import { visibleModes } from "./Dock.js";
import type { BandMode, LearnView } from "./params.js";
import { subModeWords } from "./sub-modes.js";

export interface SubNav {
  readonly diagram: DiagramKind;
  readonly learn: LearnView | undefined;
}

/** Chat's chip rows: what the bar can reach, less every experimental one while the switch is off. */
export function chipDoorRows({
  experimentalOn,
  mode,
  marginOpen,
  subNav,
}: {
  experimentalOn: boolean;
  /** The mode the reader is in now, if any. */
  mode: BandMode | undefined;
  marginOpen: boolean;
  subNav: SubNav;
}): readonly ModeCommand[] {
  const reachable = visibleModes(experimentalOn, mode, marginOpen).map((m) => m.mode);
  return [...reachable.map(modeCommand), ...subModeRows(reachable, experimentalOn, subNav)]
    .filter((c): c is ModeCommand => c.kind === "mode" || c.kind === "submode")
    .filter(
      (c) =>
        experimentalOn ||
        (c.kind === "mode" ? !MODE_CATALOG[c.mode].experimental : !subModeWords(c.sub).experimental),
    );
}

/**
 * **The guide's chip rows**: chat's, plus every mode in
 * `OFFERED_BEHIND_THE_SWITCH` and all its sub-modes, whatever the switch says,
 * each once.
 */
export function guideDoorRows(chat: readonly ModeCommand[], subNav: SubNav): readonly ModeCommand[] {
  const offered = Object.keys(OFFERED_BEHIND_THE_SWITCH) as ModeWord[];
  const extra = [
    ...offered.map(modeCommand),
    /* `true`: every sub-mode of an offered mode, as the switch being on would show them. */
    ...subModeRows(offered, true, subNav),
  ].filter((c): c is ModeCommand => c.kind === "mode" || c.kind === "submode");
  const have = new Set(chat.map(commandId));
  return [...chat, ...extra.filter((c) => !have.has(commandId(c)))];
}
