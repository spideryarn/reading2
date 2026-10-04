/**
 * **Reception's two groups: the pages that link or quote this piece, and the
 * ones that only name it.**
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
 * ## It was a slider until 2026-10-03, and the slider hid what the search was for
 *
 * `?name=` was a three-stop bar defaulting to *quotes it*, because of a decoy:
 * on `claudes-constitution-spya-cr8bzk` the web's commentary answers a
 * different document with the same title and the same byline, and a title is
 * enough to keep a row. But a paper that **cites** the piece names it — a
 * reference-list entry — and almost never quotes it, and so does a published
 * reply. On *Attention is not Explanation* the one reception row kept in two
 * runs was the reply *Attention is not not Explanation*, `named` both times,
 * hidden both times under *"1 response is hidden"*.
 * docs/postmortems/261003h-debate-default-bar-hides-the-citing-papers-the-search-was-changed-to-find.md.
 *
 * **So the control became layout** (plan 261003o, step 3). Nothing is hidden.
 * The rows that link or quote come first; the title-only ones follow under a
 * heading that says so. The decoy is on screen and flagged, and so is the
 * genuine reply. Simply moving the default to `named` would have made the
 * decoy the first row of Reception, looking like reception (GPT Sol's F5).
 * The chip on each row still says which of the three it is.
 *
 * `?name=` is retired: a link carrying it shows every row.
 */
import {
  type IdentificationLevel,
  type IdentifiedRow,
  identificationLevel,
} from "../types.js";

/** Reception's rows, split by whether anything stronger than a title ties the page to this piece. */
export interface ReceptionSections<R> {
  /** Links this article's address, or quotes its own words. Drawn first. */
  confirmed: R[];
  /** Names it by title and nothing more. Drawn under its own heading. */
  titleOnly: R[];
}

/**
 * **The split, once** — every row in exactly one group, in the order it
 * arrived. It groups and never orders: the order inside each group is
 * `?debateby=`'s (debate-order.ts).
 *
 * `identificationLevel` is the strongest signal a row carries, not the first,
 * and reads a row stored before the field existed as `named` (src/types.ts §
 * `identifiesOf`) — so an old artefact's rows sit where the decoy does.
 *
 * **Claim rows are not passed to this and never can be.** A `ClaimDebateRow`
 * has no `identifies`: it answers a claim the article makes whether or not its
 * author has heard of the piece. The signature is the guard.
 */
export function receptionSections<R extends IdentifiedRow<{ kind: IdentificationLevel }>>(
  rows: readonly R[],
): ReceptionSections<R> {
  const confirmed: R[] = [];
  const titleOnly: R[] = [];
  for (const row of rows) (identificationLevel(row) === "named" ? titleOnly : confirmed).push(row);
  return { confirmed, titleOnly };
}
