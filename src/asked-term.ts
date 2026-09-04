/**
 * **The term a reader typed into the glossary's box**, checked before anything
 * is done with it.
 *
 * The box is the answer to a reader's request — *"I would like to be able to
 * type into a search box in the glossary for a particular term and for it to
 * look for that term"* (2026-09-04, `[SPIDERYARN-READING2-Y]`) — and this is
 * the whole of what stands between what they typed and the rest of the app.
 *
 * **It reaches the browser bundle**, like [`term-match.ts`](term-match.ts)
 * beside it, because both halves need it: the panel refuses on the same rule
 * the route refuses on, so a reader is never told *no* by the server for
 * something the box could have said before the request went. One rule, one
 * file — the split that made the glossary's own matching wrong once already.
 *
 * **So it imports nothing**, which is the qualification `tests/client-imports.test.ts`
 * checks rather than trusts. It briefly imported `MAX_TERM` from
 * [`vocabulary.ts`](vocabulary.ts) and that test caught it: a shared module has
 * to be a leaf, or the client bundle quietly gains whatever the leaf's
 * dependencies drag in. See {@link MAX_ASKED_TERM} for what that cost and how
 * the number is kept honest instead.
 *
 * ## What it does not do
 *
 * **No spelling correction, and none is smuggled in here.** The "tiny bit
 * robust" the reader asked for is exactly what [`term-match.ts`](term-match.ts)
 * already folds — case, plurals, possessives — and nothing more. A normaliser
 * that quietly rewrote what somebody typed would make the refusal untrue: the
 * sentence says *the article does not use these words*, and it has to be about
 * the words they actually asked for.
 */
/**
 * The longest a term may be, and **the same eighty characters a dictation
 * vocabulary allows one term** — `MAX_TERM` in [`vocabulary.ts`](vocabulary.ts).
 *
 * Its reasoning transfers exactly: *nothing anyone says is eighty characters of
 * one term*. What it stops here is a paragraph pasted into the box and handed
 * to a regex builder, and it stops it before anything is read from the store.
 *
 * **Written out rather than imported, and that is the rule rather than a
 * lapse.** This module reaches the browser, and a shared module has to import
 * nothing — `tests/client-imports.test.ts`, whose header says the fix is never
 * to widen the allowlist but to make the shared thing a leaf. Importing
 * `vocabulary.ts` for one number would put four hundred lines of dictation
 * assembly into the client bundle, which is the exact failure that test was
 * written after.
 *
 * **So it is two limits that agree, and a test says so** rather than a comment
 * hoping — `tests/glossary-asked-term.test.ts` § "the two eighties are one
 * number". They are genuinely two questions (how long may one entry of a
 * dictation vocabulary be; how long may a term a reader types be) that happen
 * to have one answer, and the day they part company somebody has to say which.
 */
export const MAX_ASKED_TERM = 80;

/**
 * Why a typed term was refused before it was looked for.
 *
 * A union rather than a sentence, for the reason
 * docs/postmortems/260904c-the-glossary-said-the-term-was-not-there.md gives at
 * the end: a refusal that is a value cannot quietly come to mean three things.
 */
export type AskedTermFault = "empty" | "too-long" | "unprintable";

export type AskedTerm =
  | { readonly ok: true; readonly term: string }
  | { readonly ok: false; readonly fault: AskedTermFault };

/**
 * Characters a term may not contain.
 *
 * `\p{Cc}` is the C0/C1 controls and `\p{Cf}` the invisible formatting ones —
 * bidirectional overrides among them, which can make a string render as
 * something other than what it is. None can be part of a term the article uses,
 * so refusing them costs a reader nothing and keeps a class of string out of a
 * regex builder, a log line and a screen.
 *
 * `\p{Cs}` (lone surrogates) is here because `String.prototype.normalize` will
 * carry one through and JSON will transport it.
 */
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}]/u;

/**
 * What each fault says to the reader — **one copy, reached by both halves.**
 *
 * It lives here rather than in [`messages.ts`](messages.ts) because it is the
 * one thing the client and the server must say identically: the box refuses on
 * `parseAskedTerm` and so does the route, so two sets of words for one rule
 * would be a reader told different things by the same check depending on which
 * side caught it. They were two sets for about an hour, and had already drifted.
 *
 * **No bracketed codes**, which is docs/project/copy.md's rule doing its actual
 * job: the box's own guards catch the first two before a request is made, so
 * anybody who meets one has a broken client rather than a report to file. That
 * is the opposite of the `[gl-ask-…]` refusals in `messages.ts`, which a reader
 * may reasonably question and which therefore carry codes.
 *
 * A `Record` over the union, so a fourth {@link AskedTermFault} is a compile
 * error rather than an `undefined` on a screen.
 */
export const ASKED_TERM_REFUSED: Record<AskedTermFault, string> = {
  empty: "Type a term to look up.",
  "too-long": `That is longer than a term — ${MAX_ASKED_TERM} characters at most.`,
  unprintable: "A term cannot contain control or formatting characters.",
};

/**
 * What the reader typed, made into something safe to search for — or the reason
 * it is not.
 *
 * Three steps and nothing clever:
 *
 * 1. **NFC**, because a decomposed `é` typed on one keyboard would otherwise
 *    never match a composed one in the prose, and the two look identical on
 *    screen. This is the only step that changes what was typed, and it changes
 *    the encoding rather than the word.
 * 2. **Whitespace collapsed and trimmed**, because a block's text has had its
 *    line breaks flattened to single spaces (`extractText`, src/blocks.ts) and
 *    `termPattern` matches a run of whitespace against a run of whitespace.
 * 3. **Bounded and screened**, above.
 *
 * The order matters: normalising after trimming would leave a normalised form
 * with untrimmed edges, and measuring before normalising would measure a length
 * the term does not have.
 *
 * **A non-string is `empty`, not a fourth fault.** Nothing a reader can do
 * produces one — it is a malformed request — and inventing a sentence for it
 * would put a case on the screen that only a broken client can reach.
 */
export function parseAskedTerm(raw: unknown): AskedTerm {
  if (typeof raw !== "string") return { ok: false, fault: "empty" };
  const term = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (term.length === 0) return { ok: false, fault: "empty" };
  if (term.length > MAX_ASKED_TERM) return { ok: false, fault: "too-long" };
  if (UNPRINTABLE.test(term)) return { ok: false, fault: "unprintable" };
  return { ok: true, term };
}
