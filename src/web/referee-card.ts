/**
 * Whether to show the "How Referee mode works" card, and remembering that you
 * shut it.
 *
 * One bit, on this device. The card explains a mode Greg met as *"very
 * confusing"* (docs/plans/260902f-make-referee-mode-understandable.md § Stage
 * 3); a referee who has read it once should not meet it on every paper, and the
 * button in the mode header brings it back.
 *
 * ## Why this is `localStorage` when the band's own docstring says that is banned
 *
 * `RefereeBand` in src/web/App.tsx said `localStorage` was "banned outright",
 * citing docs/project/url-state.md, and that was the flat version of a real
 * rule rather than the rule. The distinction the rule is actually drawing:
 *
 * - **View state — *how you are looking at an article* — goes in the URL.**
 *   Which mode is open, which criteria are ticked, which ramp. Every one of
 *   those has to survive a reload and has to travel when the address is pasted
 *   to somebody else, and a per-device store does neither.
 * - **A per-device "I have read this" bit is neither of those.** It is not about
 *   this article, it is not worth linking to, and pasting it to somebody else
 *   would be pasting your own reading history at them. `?how=0` in every
 *   address a referee copies is noise about them, not about the paper.
 *
 * `InstallHint` is the same shape and is already the exception
 * (src/web/install-hint.ts); this is the second, and it is the same kind of
 * thing rather than a new kind. The two places that would otherwise hold it are
 * both worse: the URL for the reason above, and a reader-profile column is a
 * migration for a checkbox.
 *
 * **What it is not.** It is not a way to dismiss the confidentiality notice.
 * That notice collapses and is never dismissed, remembers nothing, and starts
 * shut on every visit — `RefereeBand`'s docstring argues all three at length.
 * This card is a separate box in a separate part of the band for exactly that
 * reason: a closable card beside a non-closable one invites closing the wrong
 * one.
 *
 * The pure half lives here rather than in the component for `install-hint.ts`'s
 * reason: `localStorage` needs guarding at every touch, and a guard is only
 * testable where it can be called on its own.
 */

const KEY = "spya.refereeHow.dismissed";

/**
 * Has this reader shut the card on this device?
 *
 * Wrapped for the three reasons `install-hint.ts` gives: Safari's private mode
 * throws outright, site data may be blocked, and under vitest with jsdom
 * `localStorage` is shadowed by Node's own global and reads `undefined`, so an
 * unguarded `.getItem` is a `TypeError` in the suite rather than in a browser.
 *
 * `false` for "cannot tell", which is the right way round: not knowing means
 * showing the explanation, and an explanation nobody needed costs one press.
 */
export function howCardDismissed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Remember the state of the one bit — **both ways**.
 *
 * Reopening from the header clears the dismissal rather than opening the card
 * for this mount only. That is what makes it one bit rather than two: a referee
 * who presses "How this works" is telling us they want it, and finding it gone
 * again on the next paper would read as the button not having worked.
 */
export function rememberHowCard(dismissed: boolean): void {
  try {
    if (dismissed) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    /* See `howCardDismissed`. The card simply comes back on the next visit. */
  }
}
