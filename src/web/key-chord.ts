/**
 * **The two questions every keyboard shortcut here asks first**: is the reader
 * writing, and is this press the chord we mean?
 *
 * A leaf module on purpose — it imports nothing. `isTyping` had three private
 * copies (keynav.ts, Dock.tsx, TermJump.tsx) because the only shared home was
 * keynav.ts, and importing that drags `position.ts` and `scroll.ts` — the
 * article's geometry — into the bottom bar's import graph and every test that
 * renders it. A module with no imports has no such edge, so one copy is
 * finally cheaper than three. docs/project/keyboard.md;
 * docs/plans/260929g-shelf-search-focus-and-metadata-chord.md § Consolidating.
 */

/**
 * **Is the reader writing?** Then the key is the text box's, not ours.
 *
 * TermJump's version, the strictest of the three: it also honours a
 * `contenteditable` *host* above the element, because jsdom has no
 * `isContentEditable` and a future composer may put the event target below
 * its editing host. The nearest explicit value wins, so `false` starts a
 * non-editable island inside an editor.
 *
 * `SELECT` is in the list for the reason PlaceOnCriterion gives: a native
 * dropdown is a control taking its own keys, whatever it looks like.
 */
export function isTyping(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") {
    return true;
  }
  if (target.isContentEditable === true) return true;
  const host = target.closest<HTMLElement>("[contenteditable]");
  return host !== null && host.getAttribute("contenteditable")?.toLowerCase() !== "false";
}

/**
 * **⌘ + key on a Mac, Ctrl + key everywhere else**, and nothing more.
 *
 *  - **Shift and Alt are rejected, not ignored.** Ctrl-Shift-K is Firefox's
 *    Web Console and Alt-Enter on a link is a download; matching them would
 *    steal a browser feature and `preventDefault()` it.
 *  - **Not on auto-repeat** — keyboard.md § Auto-repeat is ignored.
 *  - **Not during IME composition**, where some engines still expose the
 *    physical key; `keyCode` 229 is the older composition sentinel.
 *  - **A single letter matches either case**, because Caps Lock is not a
 *    modifier and turns `k` into `K`. A named key (`Enter`) matches exactly.
 *
 * Whether the press is *claimed* — typing, an open dialog, a focused link — is
 * the caller's policy, not this function's.
 */
export function isModChord(e: KeyboardEvent, key: string): boolean {
  const matches = key.length === 1 ? e.key.toLowerCase() === key.toLowerCase() : e.key === key;
  if (!matches) return false;
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.repeat) return false;
  return !isImeComposing(e);
}

/**
 * **⌘⌥ + key on a Mac, Ctrl+Alt + key everywhere else** — `isModChord`'s
 * sibling for the one chord that wants Alt: ⌘⌥T, fold or unfold every section
 * (fold.ts; Greg, spya-skqwg8). A sibling rather than a flag on that one,
 * because its refusal of Alt is a rule with reasons and every other chord
 * keeps it.
 *
 * Matched on `code`, the physical key, not `key`: ⌥ turns `t` into `†` on a
 * Mac, and Ctrl+Alt is AltGr on many layouts, which produces a character of
 * its own. Shift, auto-repeat and IME composition are refused as above.
 */
export function isModAltChord(e: KeyboardEvent, code: string): boolean {
  if (e.code !== code) return false;
  if (!(e.metaKey || e.ctrlKey) || !e.altKey || e.shiftKey || e.repeat) return false;
  return !isImeComposing(e);
}

/**
 * A key press as either a DOM or a React event, as far as these helpers read it.
 * React's synthetic event has no `isComposing` of its own — only `nativeEvent`
 * does — so both places are named and `isImeComposing` reads both. (Measured: drop
 * the `nativeEvent` read and every component-level IME test goes red.)
 */
interface KeyPress {
  key: string;
  shiftKey: boolean;
  keyCode?: number;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean };
}

/**
 * **Is an IME mid-composition?** Then Enter accepts a candidate word, and is
 * the IME's. `keyCode` 229 is the older sentinel some engines send instead of
 * the flag.
 */
export function isImeComposing(e: Pick<KeyPress, "keyCode" | "isComposing" | "nativeEvent">): boolean {
  return e.isComposing === true || e.nativeEvent?.isComposing === true || e.keyCode === 229;
}

/**
 * **Enter sends, in a chat-style box** — Enter without Shift, and not the Enter
 * that ends an IME composition, which a reader typing Japanese or Chinese
 * presses to pick a word, not to send half a question.
 *
 * ⌘/Ctrl are deliberately not refused: ⌘/Ctrl-Enter sends in every other box
 * that sends, so it sends here too. Paragraph boxes (Feedback, Comment, …) do
 * not use this — Enter is their newline. docs/project/keyboard.md § Enter in a
 * text box.
 */
export function isSendEnter(e: KeyPress): boolean {
  return e.key === "Enter" && !e.shiftKey && !isImeComposing(e);
}
