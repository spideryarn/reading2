/**
 * **Debate's identification bar — the three stops, in order, and the one pass
 * that applies them.**
 *
 * A group-one row carries `identifies`, every piece of evidence found that the
 * page it names is about *this* article, and `identificationLevel` names the
 * strongest of them: it **links** the address, it **quotes** the article's own
 * words, or it **names** the title. Greg asked for a threshold on that:
 *
 * > I think it's important that the commentary be about the article being read
 * > here. However, it's not always obvious whether different urls are hosting
 * > the exact same version as possible. So perhaps report some kind of score for
 * > "how sure we are that this is about this particular exact version" … And
 * > then the user can threshold by that in the "Prioritised" sub-mode?
 * >
 * > — Greg, 2026-09-06
 *
 * It is **not** Prioritised, and it is not a score. It is the same threshold bar
 * Glossary (`?gate=`), Quotes (`?bar=`) and Search (`?conf=`) already share
 * ([`threshold.ts`](threshold.ts)), moved onto one named fact — so the rank
 * below is internal machinery for `applyThreshold`, never a number the reader is
 * shown and never a number in the URL. `?name=` carries the **word**.
 *
 * ## Why this is a module of its own
 *
 * Exactly [`referee-views.ts`](referee-views.ts)'s reason: `?name=` is a
 * categorical parameter, so src/web/params.ts and the panel both need the
 * vocabulary, and a vocabulary spelled twice is one that eventually disagrees
 * with itself. `visibleDirect` comes with it because the ordering and the
 * filtering are the same fact, and because a test can then read the rule without
 * a DOM.
 *
 * docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md
 * § "The bar, and what 'Prioritised' turns out to mean".
 */
import {
  type DirectDebateRow,
  type IdentificationLevel,
  identificationLevel,
} from "../types.js";
import { applyThreshold, type ThresholdResult } from "./threshold.js";

/**
 * **The stops, weakest first** — which is left-to-right on the slider, so left
 * shows everything and right shows only the pages that link this article's
 * address. The same direction as every other bar in the app.
 *
 * Unlike Quotes' `barStops`, these are **not derived from the list**: they are
 * the three facts a row can carry, so a stop can be inert on a given article
 * (nothing here links the piece, say) where Quotes guarantees every adjacent
 * pair shows a different list. That is the right trade for a categorical bar —
 * the stop names a fact rather than a position, so a word in a link means the
 * same thing on every article, which is precisely what an index into a
 * data-derived track cannot promise.
 */
export const IDENTIFICATION_STOPS = ["named", "quoted", "linked"] as const;

/**
 * **Lower is weaker**, and this is the only place the order becomes arithmetic.
 *
 * `applyThreshold` keeps `score >= threshold`, so a row survives when its own
 * level is at least the level the reader asked for. A `Record` over the union
 * rather than `indexOf`, so a fourth kind of evidence is a compile error here
 * and somebody has to place it in the order — the same discipline `strengthOf`
 * in src/types.ts keeps on the other side of the same fact.
 *
 * **Not shown, not stored, not in the URL.** The reader sees the word; a number
 * on screen would be the composite this feature refused
 * (docs/project/quotes.md, and the plan's § 2).
 */
const RANK: Record<IdentificationLevel, number> = {
  named: 0,
  quoted: 1,
  linked: 2,
};

/**
 * **Where the bar sits when nobody has touched it: `quoted`.**
 *
 * Greg's reason — *"important that the commentary be about the article being
 * read here"* — and the decoy is what it costs to get wrong. On
 * `claudes-constitution-spya-cr8bzk` the whole of the web's commentary answers
 * the **January 2026** document at a different URL, and the title the two share
 * is enough to keep a row: at `named` the panel offers a page about a different
 * document, with a small chip on it that a first-time reader takes for
 * reception.
 *
 * **Re-measured on the corpus before it was kept**, because a default that hides
 * a genuine reply is a worse failure than the one it prevents. Layer 1 replay
 * over the three journals, 2026-09-06: `writes` keeps its one verified rebuttal
 * (hamtyped, `quoted`), Cargo Cult has no direct rows to hide, and the
 * constitution's single kept row — the one false positive the plan's § "The
 * corpus" identified — is `named`-only and goes. **No genuine reply loses its
 * row at this default**, and the numbers are in the plan under § Stage P.
 *
 * `linked` was refuted by the same measurement: it would hide hamtyped's
 * rebuttal, which quotes the essay at length and simply does not link it.
 *
 * The panel resolves an absent `?name=` to this, rather than the parser
 * carrying it, so the constant lives in one file — the call `?gate=`, `?bar=`
 * and `?conf=` all make (docs/project/url-state.md).
 */
export const DEBATE_LEVEL_DEFAULT: IdentificationLevel = "quoted";

/**
 * **Is this string one of the three?** An unrecognised value is not an error —
 * `nameParam` parses it to `null` and the panel reads that as untouched, so a
 * link from a version with a fourth level still opens the mode.
 */
export function isIdentificationLevel(
  value: string | null | undefined,
): value is IdentificationLevel {
  return (
    value !== null &&
    value !== undefined &&
    (IDENTIFICATION_STOPS as readonly string[]).includes(value)
  );
}

/**
 * **The bar applied to the direct rows, once**, and everything the panel needs
 * comes out of this one result.
 *
 * `applyThreshold`'s whole argument (threshold.ts § *Why an outcome object*):
 * the visible list, the `N of M`, the hidden count and the foot line all come
 * from one pass, because *a count that disagrees with the list under it is this
 * feature's worst failure*.
 *
 * **Claim rows are not passed to this and never can be.** The type says so: a
 * `ClaimDebateRow` has no `identifies`, carries no level, and answers a claim
 * the article makes whether or not its author has heard of the piece — so there
 * is nothing for this bar to be about. They are not hidden by it, not in its
 * `N of M`, and not in its foot line. The signature is the guard.
 */
export function visibleDirect(
  rows: readonly DirectDebateRow[],
  level: IdentificationLevel,
): ThresholdResult<DirectDebateRow> {
  return applyThreshold(rows, RANK[level], (row) => RANK[identificationLevel(row)]);
}

/** Where a level sits on the track, for the slider's index. */
export function stopIndex(level: IdentificationLevel): number {
  return RANK[level];
}

/** The level at a track position, for the slider's `onChange`. */
export function stopAt(index: number): IdentificationLevel {
  return IDENTIFICATION_STOPS[index] ?? DEBATE_LEVEL_DEFAULT;
}
