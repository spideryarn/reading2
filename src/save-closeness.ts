/**
 * **Whether the guide's offer to save is the reader's own words, word for
 * word or lightly reworded, and so may save at once with no press** — plans
 * docs/plans/261011s-the-guide-saves-your-reason-and-about-you-at-once-when-the-words-are-yours.md
 * and docs/plans/261012c-the-guide-saves-a-close-rewording-by-itself-the-safest-form-of-b.md.
 *
 * Greg's condition, reply A to q-t3j8hj (2026-10-11): the words are saved
 * only if they appear word for word in a message the reader typed in that
 * conversation. His report `spya-yk3r03` twenty minutes later asked for
 * "quite close … not necessarily an exact quote": that is what the guide is
 * told to offer, and an offer that is close but not exact still shows, with a
 * button to press. Only an exact one, or the light rewording below, saves itself.
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
 * What the exact route allows beyond the exact text: a different case, runs of
 * white space folded, and full stops (or ! ? …) at the end. What it refuses
 * besides anything not in the message: fewer than three words, a run that
 * starts or ends inside a word, a run after a negation in the same sentence
 * ("I do not really | want links"), the one cut that turns their words around,
 * and a run in a sentence that is a question.
 *
 * **A second route, `reworded`, since 2026-10-17.** Greg, reply `spya-v33gfs`
 * to q-pm2j66: "I want the agent to be able to reword lightly". One **whole
 * sentence** the reader typed, about themselves, changed only in spelling: a
 * contraction from a fixed table with one reading each, the first letter's
 * case, the closing full stop, and for a reason a lead-in (*it's for* →
 * *Preparing for*). No word added, dropped or swapped: Opus and GPT Sol broke
 * every looser rule, because articles, commas and where a sentence is cut
 * carry meaning too. Apart from the reason's fixed lead-in, every reworded
 * save is a string the exact route would save with a contraction spelled
 * differently, so its risk is the exact route's, which Greg accepted.
 * tests/save-closeness-reworded.test.ts.
 *
 * **Both routes refuse** (`refused`): a message that quotes anyone, any link,
 * address, markup or invisible character, words about the model's own
 * machinery ("ignore", "instructions"), and an About you addition that says
 * "you" — the shape of an instruction to the model.
 */
import type { SaveOffer } from "./types.js";

/** How an offer may save without the press, and for `reworded`, the reader's sentence it came from. */
export type SavedAtOnce = { route: "exact" } | { route: "reworded"; source: string };

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

/**
 * **The sentences of a flat message**, as `[start, end)` spans: each ends at
 * a run of `.` `!` `?` `…` followed by a space or the end. `;`, `:`, a comma
 * and a line break (folded to a space by `flat`) are not boundaries, so a
 * qualifier before them stays in the sentence.
 */
function sentenceSpans(message: string): [number, number][] {
  const spans: [number, number][] = [];
  let start = 0;
  for (const end of message.matchAll(/[.!?…]+(?= |$)/gu)) {
    const stop = end.index + end[0].length;
    spans.push([start, stop]);
    start = stop + 1;
  }
  if (start < message.length) spans.push([start, message.length]);
  return spans;
}

/** Words that open a question, with or without its mark. */
const QUESTION_STARTS: ReadonlySet<string> = new Set([
  "what", "why", "how", "when", "where", "who", "which",
  "do", "does", "did", "is", "are", "am", "can", "could", "should", "would", "will",
]);

/** A question: its closing marks include `?`, or its first word is a question word. */
function isQuestion(sentence: string): boolean {
  if (/\?[.!?…]*$/u.test(sentence.trimEnd())) return true;
  return QUESTION_STARTS.has(wordsOf(sentence)[0] ?? "");
}

/** An apostrophe inside a word (`I'm`, `I’m`), which is not a quotation mark. */
const IN_WORD_APOSTROPHE = /(?<=[\p{L}\p{N}])['’](?=[\p{L}\p{N}])/gu;

/** Any quotation mark: straight or curly, guillemets, low quotes; an in-word apostrophe is not one. */
function quotes(message: string): boolean {
  return /["'“”‘’‚‛„‟«»‹›]/u.test(message.normalize("NFKC").replace(IN_WORD_APOSTROPHE, ""));
}

/** Words that speak of the model's own machinery rather than of the reader. */
const META_WORDS: ReadonlySet<string> = new Set([
  "ignore", "disregard", "instruction", "instructions", "prompt", "system", "assistant", "tool", "tools", "override",
]);

/**
 * **A sensitive token** in the words that would be saved, after NFKC: a link,
 * an address, markup, a dotted or coloned word (`evil.com`, `localhost:3000`,
 * `127.0.0.1`), any control other than a line break or tab, any format or
 * private-use character, a role label at the start of a line, or a meta word.
 */
function sensitive(words: string): boolean {
  const text = words.normalize("NFKC");
  if (/:\/\/|www\.|[@/\\<>[\]{}`|]/iu.test(text)) return true;
  if (/[\p{L}\p{N}][.:。．｡][\p{L}\p{N}]/u.test(text)) return true;
  if (/[\p{Cf}\p{Co}]|(?![\n\r\t])\p{Cc}/u.test(text)) return true;
  if (/(?:^|\n)\s*(?:system|assistant|user|developer)\s*:/iu.test(text)) return true;
  return wordsOf(text).some((word) => META_WORDS.has(word));
}

/** Words that, in About you, speak to the model rather than of the reader. */
const SECOND_PERSON: ReadonlySet<string> = new Set(["you", "your", "yours"]);

/**
 * **Refused on both routes**, whatever the words: the message quotes anyone;
 * the words to be saved hold a sensitive token; About you's addition says
 * "you".
 */
function refused(field: SaveOffer["field"], added: string, typed: string): boolean {
  if (quotes(typed) || sensitive(added)) return true;
  return field === "profile" && wordsOf(added).some((word) => SECOND_PERSON.has(word));
}

/** Every occurrence of `run` in `message`, with the security boundaries checked. */
function containsQuotedRun(run: string, message: string): boolean {
  const spans = sentenceSpans(message);
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
    /* Never from a question: no sentence the run touches may be one. */
    const end = at + run.length;
    if (spans.some(([from, to]) => from < end && to > at && isQuestion(message.slice(from, to)))) continue;
    return true;
  }
  return false;
}

/**
 * **True when `words` is a run of `typed`, word for word**, by the rules in
 * the header: at word boundaries, at least `MIN_WORDS` long, not after a
 * negation, not in a question. Every place it occurs is tried.
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

/** The fixed contractions, each with one reading. Not *I'd*, *it's* or *'s*, which have two. */
const CONTRACTIONS: Readonly<Record<string, string>> = {
  "i'm": "i am", "i've": "i have", "i'll": "i will",
  "don't": "do not", "doesn't": "does not", "didn't": "did not",
  "can't": "cannot", "won't": "will not",
  "isn't": "is not", "aren't": "are not", "wasn't": "was not",
};
const CONTRACTION = new RegExp(
  `(?<![\\p{L}\\p{N}'’])(?:${Object.keys(CONTRACTIONS).map((word) => word.replaceAll("'", "['’]")).join("|")})(?![\\p{L}\\p{N}'’])`,
  "giu",
);

/** Every contraction in the table spelled out, a capital first letter kept a capital. */
function expanded(text: string): string {
  return text.replace(CONTRACTION, (found) => {
    const out = CONTRACTIONS[found.toLowerCase().replace(/’/gu, "'")] ?? found;
    return /^\p{Lu}/u.test(found) ? out.charAt(0).toUpperCase() + out.slice(1) : out;
  });
}

/** A sentence's words without its closing marks. */
function core(text: string): string {
  return text.replace(/[.!?…]+$/u, "").trimEnd();
}

/** The same text, with only the first letter's case free to differ. */
function sameButFirstCase(a: string, b: string): boolean {
  return a.slice(0, 1).toLowerCase() === b.slice(0, 1).toLowerCase() && a.slice(1) === b.slice(1);
}

/** Openings that make a sentence a request, a pretence or a hypothetical rather than a statement. */
const NOT_A_STATEMENT: ReadonlySet<string> = new Set(["let", "please", "if", "imagine", "pretend", "suppose", "don"]);
/** At least one of these as a word: a statement about the reader. */
const FIRST_PERSON: ReadonlySet<string> = new Set(["i", "my", "me", "we", "our"]);
/** A subject that can open a first-person statement, rather than an imperative containing *me* or *my*. */
const FIRST_PERSON_START = /^(?:i(?:['’](?:m|ve|ll))?|my|we|our)$/iu;

/** The reason's lead-ins: what the reader typed, and what the guide may write in its place. */
const TYPED_LEAD_IN = /^(?:(?:it['’]s|it is|this is) )?for (.+)$/iu;
const OFFERED_LEAD_IN = /^(?:preparing|reading this|reading) for (.+)$/iu;

/** The core of a whole first-person statement admissible for this field. */
function statementCore(field: SaveOffer["field"], source: string): string | null {
  const terms = wordsOf(source);
  if (isQuestion(source) || NOT_A_STATEMENT.has(terms[0] ?? "")) return null;
  if (!terms.some((word) => FIRST_PERSON.has(word))) return null;
  const text = core(source);
  if (field === "profile" && !/^i(?:['’](?:m|ve|ll))?$/iu.test(text.split(" ")[0] ?? "")) return null;
  return text;
}

/**
 * **The sentence of `typed` that `words` lightly rewords**, or `null`: one
 * whole first-person statement, not a question, request or pretence, the same
 * character for character but for the contractions, the first letter's case,
 * the closing marks and, for a reason, the lead-in. About you starts with *I*.
 * Three to 30 words, at most 240 characters. NFKC-stable text only.
 */
function reworded(field: SaveOffer["field"], words: string, typed: string): string | null {
  const offer = flat(words);
  const message = flat(typed);
  if (offer.normalize("NFKC") !== offer || message.normalize("NFKC") !== message) return null;
  const said = core(offer);
  const count = said.split(" ").length;
  if (count < MIN_WORDS || count > 30 || offer.length > 240) return null;
  for (const [start, end] of sentenceSpans(message)) {
    const source = message.slice(start, end);
    const typedCore = statementCore(field, source);
    if (typedCore === null) continue;
    if (field === "purpose") {
      const typedLead = TYPED_LEAD_IN.exec(typedCore);
      const offeredLead = OFFERED_LEAD_IN.exec(said);
      if (typedLead && offeredLead) {
        if (expanded(typedLead[1] ?? "") === expanded(offeredLead[1] ?? "")) return source;
        continue;
      }
    }
    if (!FIRST_PERSON_START.test(typedCore.split(" ")[0] ?? "")) continue;
    if (sameButFirstCase(expanded(typedCore), expanded(said))) return source;
  }
  return null;
}

/**
 * **How this offer may save without the reader's press**, or `null` for the
 * press.
 *
 * `typed` is the message the reader typed this turn, or `null` when this
 * turn's message was not typed by them (a button, a retry, an edit): then
 * never. A reason must be a run of `typed` (`quoted`), or, while no reason is
 * saved, a light rewording of one of its sentences (`reworded`). About you is
 * the whole new text, so it must be **what it held, unchanged, then the
 * reader's words**: a save at once only adds at the end, and anything that
 * rewrites or drops what was there waits for the press. Any About you addition
 * also needs a clean join: what it held ends a sentence, then one space or one
 * line break. Both routes refuse what `refused` names first.
 */
export function savesAtOnce(offer: Pick<SaveOffer, "field" | "text" | "basis">, typed: string | null): SavedAtOnce | null {
  if (typed === null) return null;
  const { field, text, basis } = offer;
  let added = text;
  if (field === "profile" && basis !== null) {
    if (!text.startsWith(basis)) return null;
    added = text.slice(basis.length);
    /* Both routes append one new sentence at one clean separator. Without
       this, an exact run can complete an unfinished basis (`I do not` +
       `know much`), while folded whitespace admits joins the card never
       promised. */
    if (!/[.!?]$/u.test(basis) || !/^[ \n]\S/u.test(added)) return null;
    added = added.slice(1);
  }
  if (refused(field, added, typed)) return null;
  if (quoted(added, typed)) return { route: "exact" };
  /* Reworded: a reason only into an empty field; About you only after a whole sentence. */
  if (basis !== null) {
    if (field === "purpose") return null;
  }
  const source = reworded(field, added, typed);
  return source === null ? null : { route: "reworded", source };
}
