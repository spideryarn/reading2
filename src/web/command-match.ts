/**
 * **What the command bar shows when you have typed something**, as a pure
 * function of the words and the list.
 *
 * Its own module, importing no React and touching no browser API, because the
 * whole of the bar that can be *wrong* is in here and the whole of the bar that
 * needs a DOM is in CommandBar.tsx. A ranking rendered inside a component is a
 * ranking you can only test by rendering it, which means the interesting cases —
 * a tie, a word that is a prefix of one label and a substring of another — get
 * checked through three layers of markup or not at all.
 *
 * See docs/plans/260906h-mode-catalog-and-a-command-bar.md § The command bar,
 * and GPT Sol's F5 on that plan, which is why the ranking is written down as
 * five named tiers rather than left to whatever `filter` happened to do.
 */
import { MODE_CATALOG } from "../mode-catalog.js";
import { MODE_LABEL } from "../title-text.js";
import type { Mode } from "../modes.js";

/**
 * **The one form a typed word and a stored word are ever compared in**:
 * lowercase, trimmed, and internal runs of whitespace collapsed to one space.
 *
 * **This function is the shared one, and sharing it is the point.** It lived in
 * tests/mode-catalog.test.ts first, where it was checking that no two modes
 * claim the same alias; that test now imports this, so the table's uniqueness
 * and the matcher's comparison are provably the same rule rather than two
 * spellings that agree today. The collapse is the half that is easy to leave
 * out, and leaving it out opens the hole GPT Sol reproduced on 2026-09-07:
 * `"peer review"` and `"peer  review"` are different strings, so they pass a
 * uniqueness check on raw text, and identical queries, so they collide the
 * moment anybody types either.
 *
 * **Idempotent**, which is what lets `rankModes` below call it on input the
 * caller may already have canonicalised: `canonical(canonical(s)) === canonical(s)`.
 *
 * Deliberately *not* Unicode-folding, stripping accents or stemming. Every
 * alias in the catalog is ASCII and every mode label is English, so a folding
 * step would be machinery with nothing yet to do — and the first accented alias
 * is the moment to add it, with a test that shows what it buys.
 */
export function canonical(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * **The five ways a query can hit a mode, best first — and this list IS the
 * ranking.**
 *
 * One ordered array rather than a `switch` of `if`s and a number beside each,
 * because those are two statements of one fact and they drift: somebody
 * reorders the tests and forgets the numbers, and the bar quietly starts
 * offering a description match above a name. Here the position in the array is
 * the tier, so there is nothing to keep in step.
 *
 * The shape of the order: a **name** beats a **nickname**, either of those as a
 * *prefix* beats either as a *substring*, and the description comes last
 * because it is a sentence about the mode rather than a way of naming it.
 *
 * `name` is not read by the bar. It is here so a failing test can say *which*
 * tier it expected rather than printing a 3.
 */
const TIERS: readonly {
  readonly name: string;
  readonly hit: (query: string, mode: Mode) => boolean;
}[] = [
  { name: "label-prefix", hit: (q, m) => label(m).startsWith(q) },
  { name: "alias-prefix", hit: (q, m) => aliases(m).some((a) => a.startsWith(q)) },
  { name: "label-substring", hit: (q, m) => label(m).includes(q) },
  { name: "alias-substring", hit: (q, m) => aliases(m).some((a) => a.includes(q)) },
  {
    name: "description-substring",
    hit: (q, m) => canonical(MODE_CATALOG[m].description).includes(q),
  },
];

/** The mode's name, in the form a typed word is compared against. */
function label(mode: Mode): string {
  return canonical(MODE_LABEL[mode]);
}

/**
 * The mode's nicknames, likewise.
 *
 * They are already canonical in the table — tests/mode-catalog.test.ts asserts
 * that rather than trusting it — and they go through `canonical` here anyway,
 * because a matcher that only works on well-formed data is one whose
 * correctness depends on a test in another file continuing to exist. It is
 * idempotent, so this costs nothing and removes the coupling.
 */
function aliases(mode: Mode): readonly string[] {
  return MODE_CATALOG[mode].aliases.map(canonical);
}

/** Which tier a mode lands in, or `TIERS.length` for no match at all. */
function tierFor(query: string, mode: Mode): number {
  const found = TIERS.findIndex((tier) => tier.hit(query, mode));
  return found === -1 ? TIERS.length : found;
}

/**
 * **The modes a query matches, best first.**
 *
 * `modes` is the list to search and its **order is part of the answer**: two
 * modes on the same tier come back in the order they were handed in, so the
 * result is total and a test can state it. The caller hands in the list the
 * Dock is drawing, which is what makes "the bar lists exactly what the Dock
 * lists" true by construction rather than by a second copy of the
 * experimental-switch rule (`visibleModes` in Dock.tsx is the only copy).
 *
 * An **empty query returns every mode, in input order** — the bar opens showing
 * everything, so the reader can see what there is to ask for rather than having
 * to guess a first letter.
 *
 * The query is canonicalised here rather than trusted, so a caller passing raw
 * keystrokes and a caller passing an already-normalised string get the same
 * answer. `canonical` is idempotent; see it.
 *
 * **Not fuzzy, and that is a choice with a reason.** Subsequence matching
 * (`glsy` → Glossary) would widen what the bar accepts and would also make the
 * ranking a score, at which point the tie-break stops being "the order Greg put
 * the buttons in" and starts being an arithmetic nobody can predict. Fourteen
 * modes with short names do not need it. If it ever arrives, it arrives as a
 * sixth tier below these five, so exact matching keeps winning.
 */
export function rankModes(query: string, modes: readonly Mode[]): readonly Mode[] {
  const wanted = canonical(query);
  if (wanted === "") return [...modes];

  /* The index is carried rather than relied on. `Array.prototype.sort` has been
     stable since ES2019 and this would work without it — but "ties fall back to
     the order the Dock draws" is a promise this function makes, and a promise
     that rests on an engine's sort being stable is one no test failure would
     ever point at. Comparing the index says it out loud, and it is the line the
     mutation check breaks. */
  return modes
    .map((mode, index) => ({ mode, index, tier: tierFor(wanted, mode) }))
    .filter((row) => row.tier < TIERS.length)
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((row) => row.mode);
}
