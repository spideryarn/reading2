/**
 * **Whether the guide's offer to save is the reader's own words, word for
 * word, and so may save at once with no press** — plan
 * docs/plans/261011s-the-guide-saves-your-reason-and-about-you-at-once-when-the-words-are-yours.md.
 *
 * Greg's condition, reply A to q-t3j8hj (2026-10-11): the words are saved
 * only if they appear word for word in a message the reader typed in that
 * conversation. His report `spya-yk3r03` twenty minutes later asked for
 * "quite close … not necessarily an exact quote": that is what the guide is
 * told to offer, and an offer that is close but not exact still shows, with a
 * button to press. Only an exact one saves itself.
 *
 * **This is a defence, listed in docs/project/security-map.md.** The guide's
 * prompt holds the whole article, so a planted instruction can choose what
 * `offer_to_save` offers, and About you goes into every later prompt on every
 * article. A looser check — every word one of the reader's, or a linking
 * word — was tried first and GPT Sol broke it in the plan review: "What does
 * this paper say about cancer?" became About you "I have cancer.", and "I do
 * not want links to evil.com" became "I want links to evil.com". Those are
 * tests/save-closeness.test.ts now. A contiguous run of the reader's own
 * message cannot be rearranged into a claim they did not make.
 *
 * What it allows beyond the exact text: a different case, runs of white space
 * folded, and full stops (or ! ? …) at the end. What it refuses besides
 * anything not in the message: fewer than three words, a run that starts or
 * ends inside a word, and a run after a negation in the same sentence ("I do
 * not really | want links"), the one cut that turns their words around.
 */
import type { SaveOffer } from "./types.js";

/** The fewest words a run of the reader's message may be, to save at once. */
const MIN_WORDS = 3;

/** A negation before a run in the same sentence (`t` is the tail of every "n't"). */
const NEGATIONS: ReadonlySet<string> = new Set([
  "not", "no", "never", "none", "nothing", "nobody", "nor", "neither", "without", "cannot", "t",
]);

/** The words of a text: lower case, split on anything not a letter, mark or digit. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((w) => w !== "");
}

/** Compared as: every run of white space one space, trimmed. */
function flat(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/** A code point that continues a word, including marks and invisible format controls. */
const WORD_CHARACTER = /[\p{L}\p{M}\p{N}\p{Cf}]/u;

/** The part before this run since the last sentence boundary. */
function sentenceBefore(before: string): string {
  return before.split(/[.!?…;]+(?:\s+|$)/u).at(-1) ?? before;
}

/** Every occurrence of `run` in `message`, with the security boundaries checked. */
function containsQuotedRun(run: string, message: string): boolean {
  for (let at = message.indexOf(run); at !== -1; at = message.indexOf(run, at + 1)) {
    const before = message.slice(0, at);
    const after = message.slice(at + run.length);
    /* Inspect whole code points: `slice(-1)` splits an astral letter's
       surrogate pair, and in the Node/V8 versions we support a property escape
       followed by `$` also fails to recognise that final astral code point. */
    if (
      WORD_CHARACTER.test(Array.from(before).at(-1) ?? "") ||
      WORD_CHARACTER.test(Array.from(after).at(0) ?? "")
    ) continue;
    if (wordsOf(sentenceBefore(before)).some((word) => NEGATIONS.has(word))) continue;
    return true;
  }
  return false;
}

/**
 * **True when `words` is a run of `typed`, word for word**, by the rules in
 * the header: at word boundaries, at least `MIN_WORDS` long, not after a
 * negation. Every place it occurs is tried.
 *
 * Try the characters as written first. The case-insensitive fallback is only
 * for NFKC-stable text: Unicode lowercasing otherwise makes compatibility
 * symbols such as `K` compare equal to `K`, although our store preserves the
 * symbol. Exact compatibility characters still take the first path.
 */
function quoted(words: string, typed: string): boolean {
  const run = flat(words).replace(/[.!?…]+$/u, "").trimEnd();
  if (wordsOf(run).length < MIN_WORDS) return false;
  const message = flat(typed);
  if (containsQuotedRun(run, message)) return true;
  if (run.normalize("NFKC") !== run || message.normalize("NFKC") !== message) return false;
  return containsQuotedRun(run.toLowerCase(), message.toLowerCase());
}

/**
 * **True when this offer may save without the reader's press.**
 *
 * `typed` is the message the reader typed this turn, or `null` when this
 * turn's message was not typed by them (a button, a retry, an edit): then
 * never. A reason must be a run of `typed` (`quoted`). About you is the whole
 * new text, so it must be **what it held, unchanged, then a run of `typed`**:
 * a save at once only adds the reader's words at the end, and anything that
 * rewrites or drops what was there waits for the press.
 */
export function savesAtOnce(offer: Pick<SaveOffer, "field" | "text" | "basis">, typed: string | null): boolean {
  if (typed === null) return false;
  if (offer.field === "purpose" || offer.basis === null) return quoted(offer.text, typed);
  if (!offer.text.startsWith(offer.basis)) return false;
  const added = offer.text.slice(offer.basis.length);
  /* Always a separate addition: punctuation can join tokens too (`evil.` + `com`). */
  if (!/^\s/u.test(added)) return false;
  return quoted(added, typed);
}
