/**
 * **The one-shot mark that asks "Why are you reading this?" when the article
 * first opens.**
 *
 * > Also, if they don't fill this in (e.g. because they didn't notice it), pop
 * > up an input box asking why they're reading it when the article loads for
 * > the first time.
 * >
 * > — Greg, 2026-10-01, spya-hbqezu
 *
 * The add page writes it (`markAskPurpose`) only when it opens an article by
 * itself with the box empty and never touched — the "didn't notice it" case.
 * The reading view, for the owner only, peeks at it (src/web/PurposePrompt.tsx)
 * and clears it once it knows the answer. docs/plans/261001s-imports-detail-on-home-and-why-reading-saved-state-and-first-open-prompt.md
 * § Stage 3.
 *
 * **Peek, then clear — never take on mount.** A read of the purpose that fails
 * must leave the mark for the next load, or the question is lost to a network
 * blip (GPT Sol's plan review, item 3). And clear only removes a mark naming
 * *this* slug: another add in the same tab may have written a newer one.
 *
 * **sessionStorage, so a tab is the unit**: it survives a reload of the article
 * and does not follow the reader to another device, which is right for a
 * question asked once. Every access is wrapped, because storage can throw
 * (Safari with site data blocked, a full quota) — and the cost of that is only
 * not being asked.
 */

export const ASK_PURPOSE_KEY = "spideryarn.ask-purpose";

/** Ask about `slug` the next time its reading view opens in this tab. */
export function markAskPurpose(slug: string): void {
  try {
    window.sessionStorage.setItem(ASK_PURPOSE_KEY, slug);
  } catch {
    /* Not asked, and nothing else lost. */
  }
}

/** Whether the mark names `slug`. Does not consume it. */
export function peekAskPurpose(slug: string): boolean {
  try {
    return window.sessionStorage.getItem(ASK_PURPOSE_KEY) === slug;
  } catch {
    return false;
  }
}

/** Remove the mark, but only if it names `slug`. */
export function clearAskPurpose(slug: string): void {
  try {
    if (window.sessionStorage.getItem(ASK_PURPOSE_KEY) === slug) {
      window.sessionStorage.removeItem(ASK_PURPOSE_KEY);
    }
  } catch {
    /* Nothing to do: a storage that cannot be read held no mark we could see. */
  }
}
