/**
 * **A delimiter the document cannot forge.**
 *
 * Moved here from `src/referee-mirror.ts` on 2026-10-07 (plan 261007l) so the
 * Hidden text Opus check could fence what it sends the same way; Mirror's
 * behaviour is unchanged.
 *
 * Everything quoted into Mirror's prompt — the paper's words and the referee's —
 * used to sit between triple quotes, which is a string a paper can simply
 * contain. Mirror's cross-family review (finding 3) wrote the attack out: a
 * passage closes the delimiter, addresses the model, and asks for a
 * valid-schema remark whose note is a verdict on the paper.
 *
 * A fresh UUID per call is the standard answer and the honest one: the document
 * was written before this run existed, so it cannot contain this token, and the
 * model is told that only these lines delimit quoted material. What it does not
 * do is make the answer trustworthy; each caller's validator says what it does
 * and does not check.
 */
import { randomUUID } from "node:crypto";

/** A fresh fence for one call. */
export const newFence = (): string => `spya-fence-${randomUUID()}`;

/**
 * `text` between two `fence` lines.
 *
 * Removing the marker from the content is belt as well as braces: the token
 * is a fresh UUID that nothing in the document can guess, so this only
 * matters if one ever leaks — a retry that reused it, a fence echoed back in
 * an error. Cheap, and it makes the invariant "the number of marker lines is
 * decided by the caller" true by construction rather than by argument.
 */
export const fenced = (fence: string, text: string): string =>
  `${fence}\n${text.split(fence).join("")}\n${fence}`;
