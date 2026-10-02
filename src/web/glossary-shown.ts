/**
 * **The one visible glossary list** — what is left once the owner's hidden
 * entries are taken out.
 *
 * Greg, 2026-10-02 (spya-yqfzkm): *"Give me a way to hide a Glossary entry
 * (e.g. because I know it already, and/or it keeps showing up too much)"* —
 * and *"Let's go with Hide for now"*, for him, not delete for everyone.
 * docs/plans/261002c-glossary-hide-an-entry-dig-deeper-from-the-card-hyphens-match-spaces.md § 2.
 *
 * **Defined once and used everywhere a term is drawn**: the prose underlines
 * and so the hover card and G (`terms` in Reader.tsx), Skim's stop cards
 * (src/web/stop-card.ts), and the band's list, counts, sorts and threshold
 * (GlossaryBand in modes/glossary/GlossaryMode.tsx). A hidden entry that
 * leaked into any one of them would be the hide working on one surface and
 * not on the next — GPT Sol's plan review, finding 2. The raw list is kept
 * only for the band's *Hidden (n)* section, where each one can be unhidden.
 *
 * `hidden` is attached by the owner's read alone (`loadGlossary`); a visitor's
 * list never carries it, so for them this returns what it was given.
 */

/**
 * The entries not hidden, **the same array when none are** — so the memos keyed
 * on the list's identity downstream (Reader's `termSelections`, the card's
 * index) do not rebuild for a filter that removed nothing.
 */
export function shownEntries<E extends { hidden?: true }>(entries: E[]): E[];
export function shownEntries<E extends { hidden?: true }>(entries: readonly E[]): readonly E[];
export function shownEntries<E extends { hidden?: true }>(entries: readonly E[]): readonly E[] {
  return entries.some((entry) => entry.hidden) ? entries.filter((entry) => !entry.hidden) : entries;
}

/** The ones the owner has hidden, in the list's own order — the *Hidden (n)* section. */
export function hiddenEntries<E extends { hidden?: true }>(entries: readonly E[]): E[] {
  return entries.filter((entry) => entry.hidden === true);
}
