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
 * - **A mode that generates is a press.** `generates` is the catalogue's bit,
 *   which is `modeGenerates` / `subModeGenerates` (src/web/activation.ts;
 *   tests/command-pick-catalogue.test.ts pins the two together): opening it
 *   arms a paid run.
 * - **Search is a press too, though it generates nothing** (GPT Sol's F1 on
 *   the plan): opening it tidies the reader's remembered quick and thorough
 *   searches, and its swap deletes a superseded quick result
 *   (src/web/modes/search/auto-thorough.ts, SearchMode.tsx). Free, but a write.
 */

/** Search and every one of its sub-modes, by catalogue key (`mode:search`, `submode:search:…`). */
const SEARCH = /^(?:mode:search|submode:search:[a-z-]+)$/;

/** May the guide open the mode with this catalogue key without a press? */
export function modeActsAlone(key: string, generates: boolean): boolean {
  return !generates && !SEARCH.test(key);
}
