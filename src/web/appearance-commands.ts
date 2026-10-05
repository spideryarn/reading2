/**
 * **Light, Dark and System, as the command bar names them** — the words of the
 * bar's three *Appearance* rows, and what Enter does. Greg, 2026-10-04
 * (spya-c5wdn7):
 *
 * > Add a command in the command bar to be able to switch between dark and
 * > light mode, and I guess system mode as well.
 *
 * A second door to the one setting, not a second setting: the press is
 * `setAppearance` (appearance.ts), the function /profile's radios call, and the
 * names are that control's — *Appearance*, and *System / Light / Dark*
 * (AppearanceSetting.tsx).
 *
 * **All three rows are always offered, and the one in force is marked
 * `current`.** Archive
 * and the experimental switch draw one row whose label follows the state, so
 * there is never a row that does nothing; those are two-state toggles, and
 * this is a choice among three. Hiding the current one would answer a reader in
 * Dark who types `dark mode` with *No command matches.*, which reads as the
 * feature being missing. Pressing the row in force sets the same value again.
 *
 * docs/plans/261005d-theme-commands-in-the-command-bar.md.
 */
import type { Appearance } from "./appearance.js";
import type { ActionOutcome, Command } from "./command-match.js";

interface AppearanceWords {
  readonly label: string;
  readonly description: string;
  readonly aliases: readonly string[];
}

/* What all three answer to, so `theme` lists the choice rather than one of it. */
const SHARED = ["theme", "colour scheme", "color scheme"];

/**
 * The order is the order they are listed in for a word all three share: the
 * two Greg named first, then the one he added.
 */
const WORDS: Record<Appearance, AppearanceWords> = {
  dark: {
    label: "Appearance: Dark",
    description: "Light text on a dark page.",
    aliases: ["dark mode", "dark theme", "night mode", ...SHARED],
  },
  light: {
    label: "Appearance: Light",
    description: "Dark text on a light page.",
    aliases: ["light mode", "light theme", "day mode", ...SHARED],
  },
  system: {
    label: "Appearance: System",
    description: "Follow this device's light or dark setting.",
    aliases: ["system mode", "system theme", "auto theme", "os theme", "match device", ...SHARED],
  },
};

const ORDER: readonly Appearance[] = ["dark", "light", "system"];

/**
 * The muted word on the row whose choice is in force — the row's `marker`
 * (command-match.ts § `CommandWords.marker` says why it is not in the
 * description).
 */
export const APPEARANCE_CURRENT = "current";

/** /profile's own sentence for a choice the device would not keep (AppearanceSetting.tsx). */
export const APPEARANCE_NOT_SAVED = "Couldn't save it on this device, so it lasts until you close this page.";

/**
 * **One row** — exported for the collision matrix
 * (tests/command-match-arguments.test.ts), as `experimentalCommand` is.
 *
 * `generates: false`: saving a preference calls no model. `typedOnly`, so the
 * list the bar opens on did not grow by three. `opensOnly: false`: it changes
 * a setting, so a row a model picked from a sentence is drawn and waits for a
 * press (CommandBar.tsx § `onlyMovesTheReader`).
 */
export function appearanceCommand(
  choice: Appearance,
  inForce: boolean,
  run: () => ActionOutcome | Promise<ActionOutcome>,
): Command {
  const words = WORDS[choice];
  return {
    kind: "action",
    id: `appearance-${choice}`,
    label: words.label,
    description: words.description,
    ...(inForce ? { marker: APPEARANCE_CURRENT } : {}),
    aliases: words.aliases,
    generates: false,
    typedOnly: true,
    opensOnly: false,
    run,
  };
}

/**
 * **The three rows, for the choice in force.** `set` is `setAppearance`: it
 * saves, repaints at once, and answers whether the save reached the device. A
 * refused save has still changed the page, so the bar stays open to say it
 * will not last rather than closing on a promise it cannot keep.
 */
export function appearanceRows(current: Appearance, set: (choice: Appearance) => boolean): readonly Command[] {
  return ORDER.map((choice) =>
    appearanceCommand(choice, choice === current, (): ActionOutcome =>
      set(choice) ? { kind: "close" } : { kind: "stay", message: APPEARANCE_NOT_SAVED },
    ),
  );
}
