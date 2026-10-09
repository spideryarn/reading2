/**
 * **Which modes the guide may open without the reader pressing anything** —
 * one rule, read by the guide's prompt on the server (src/guide.ts §
 * `modeWordsSection`, which marks each mode *Opens at once* or *Button*) and by
 * the page that does the opening (src/web/guide-acts.ts), so the two cannot
 * disagree about which sentence the model may write: *"I've opened it"* or an
 * offer. Plan docs/plans/261007p-the-guide-acts-without-a-press-and-opens-every-new-article.md.
 *
 * Greg, 2026-10-07, on q-tyvutf: *"yes. err on the side of capability for the
 * guide, unless there's high risk/stakes"*. The line is the brief's: free and
 * inside the article acts; anything that spends or reaches outside it stays a
 * press, because the guide's context holds the article and an article can
 * carry a planted instruction.
 *
 * - **A mode that generates is normally a press.** `generates` is the catalogue's bit,
 *   which is `modeGenerates` / `subModeGenerates` (src/web/activation.ts;
 *   tests/command-pick-catalogue.test.ts pins the two together): opening it
 *   arms a paid run. `OPENS_FREE_ONCE_MADE` below names the exceptions the
 *   guide may open unarmed when the server found their artefact stored.
 * - **Search is a press too, though it generates nothing** (GPT Sol's F1 on
 *   the plan): opening it tidies the reader's remembered quick and thorough
 *   searches, and its swap deletes a superseded quick result
 *   (src/web/modes/search/auto-thorough.ts, SearchMode.tsx). Free, but a write.
 * - **So is a mode offered from behind the experimental switch** (plan 261009u):
 *   `modeActsAlone` below.
 */
import { offeredBehindTheSwitch } from "./mode-catalog.js";

/** Search and every one of its sub-modes, by catalogue key (`mode:search`, `submode:search:…`). */
const SEARCH = /^(?:mode:search|submode:search:[a-z-]+)$/;

/**
 * May the guide open this catalogue key without needing a stored artefact?
 *
 * **Never a mode it offers from behind the switch**, nor its sub-modes (plan
 * 261009u, GPT Sol's F3 on it; src/mode-catalog.ts § `offeredBehindTheSwitch`).
 * The guide offers one because it inferred who the reader is, and an inference
 * is the reader's to confirm: a planted paragraph saying "this reader is a
 * referee" must not be able to move them into a hidden mode by itself.
 */
export function modeActsAlone(key: string, generates: boolean): boolean {
  return !generates && !SEARCH.test(key) && offeredBehindTheSwitch(key) === undefined;
}

/**
 * **The generating modes that open free once their artefact is stored** —
 * plan docs/plans/261008a-guide-opens-glossary-and-summary-when-already-made.md
 * (qi-ztp3w9az). A reader's press on one of these keys arms a run. The guide's
 * act instead opens it unarmed (`CommandExecutor.openModeUnarmed`); neither
 * band spends on mount without an activation (src/web/useAutoRun.ts). The
 * server's stored-artefact snapshot allows the act, but does not guarantee the
 * artefact will still exist when the band reads: if it vanished, the band
 * shows its empty state without buying a run. Without that snapshot the key
 * stays the *Button* `modeActsAlone` says it is.
 *
 * By the artefact each key's band reads. Not the bare `mode:summary`: it lands
 * on whatever `?summary=` says, and the Thread view writes on arrival. Not
 * Diagram or Marginalia: they spend on mount whatever is stored. A new row
 * needs the store read on the server (src/routes.ts § `MADE_READS`,
 * `guideMade`) and a band whose unarmed opening spends and writes nothing.
 */
export const OPENS_FREE_ONCE_MADE = {
  glossary: ["mode:glossary"],
  simple: ["submode:summary:brief", "submode:summary:fuller"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

/** An artefact whose being stored lets some generating mode open free. */
export type MadeArtefact = keyof typeof OPENS_FREE_ONCE_MADE;

/** The catalogue keys that open free, given which artefacts are stored. */
export function keysOpenFree(made: Iterable<MadeArtefact>): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const artefact of made) for (const key of OPENS_FREE_ONCE_MADE[artefact]) keys.add(key);
  return keys;
}
