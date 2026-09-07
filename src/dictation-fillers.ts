/**
 * **Taking the ums out of a transcript without editing what was said.**
 *
 * Greg, from inside the Feedback dialog, 2026-09-05:
 *
 * > The microphone input (eg for Feedback dialog box) sometimes includes
 * > superfluous ums and ahs. Can we tweak the prompt or otherwise to
 * > ignore/remove these?
 *
 * The reasoning, the web research behind it and everything it defers are in
 * [260905c](../docs/plans/260905c-dictation-filler-words-and-mic-offline.md).
 * The three things worth knowing from here:
 *
 * ## Why this is not a line in the system prompt
 *
 * Which was the report's own first suggestion, and the obvious move. The
 * industry does not do it that way either — Deepgram, AssemblyAI, Speechmatics
 * and Gemini's own transcription API all expose filler removal as a
 * **parameter**, a word-level classification inside the model, rather than as
 * an instruction. None of those was reachable when this was written: the app
 * talked to a *chat* model through OpenRouter, because the dedicated
 * transcription route ignored the vocabulary and the vocabulary is the whole
 * reason the feature works ([transcribe.ts](./transcribe.ts)).
 *
 * That left the system prompt or this. The system prompt was not a neutral
 * place to put an instruction: it was one long argument that the model is a
 * transcriber and must not be helpful — the word **verbatim**, three sentences
 * forbidding it from answering the audio, and a JSON schema whose comment said
 * the failure mode is *"a perfectly good answer to a question nobody asked"*.
 * *"Remove the filler words"* is an **editing** instruction in a prompt whose
 * one job is to refuse to edit, and a model that takes the hint too far returns
 * a fluent paraphrase, which is indistinguishable from a good transcript by any
 * test anybody can write.
 *
 * **On 2026-09-07 the prompt went away entirely** and this file did not move.
 * Dictation is now `openai/gpt-transcribe` on `/v1/audio/transcriptions`, which
 * takes the vocabulary as a `keywords` array — so the premise above is a
 * historical one, and the conclusion survives it twice over: there is no prompt
 * to put the instruction in, and nobody has looked up whether this model exposes
 * a filler parameter of the kind the four above do. If one turns up, it is
 * strictly better than this file and this file should go.
 * docs/plans/260907c-dictation-onto-an-openai-transcriber.md.
 *
 * **GPT Sol disagreed**, and the disagreement is recorded in the plan rather
 * than settled here: it held that the prompt already set a non-verbatim
 * convention (*"sensible punctuation and capitalisation"*) and that a narrow
 * rule would be safe. It was probably right that the experiment was worth
 * running; what it needed was an audio corpus with real hesitations in it, which
 * still does not exist. The prompt it was arguing about is gone, so the argument
 * is now the parameter one above — but the corpus is what both of them wait on.
 * This is the version whose safety can be checked today.
 *
 * ## So it deletes, and it can only delete
 *
 * A closed list of tokens, removed where they stand. It never adds a word,
 * never reorders one, and never chooses a different word — and because that is
 * a property rather than an intention,
 * [`tests/dictation-fillers.test.ts`](../tests/dictation-fillers.test.ts)
 * asserts it: the words that come out are the words that went in with filler
 * occurrences removed, each survivor byte for byte.
 *
 * **What it deliberately leaves alone**: `like`, `you know`, `I mean`, `sort
 * of`, `right`, `so`. Those are real words doing real work, and a reader who
 * said them meant them. Stutters and false starts too — *"I— I think"* — because
 * nothing deterministic can tell a stutter from an emphatic repetition, and the
 * only thing that can is a model editing a reader's words.
 *
 * ## The three rules that keep it off real words
 *
 * All three exist because GPT Sol's plan review found the first draft deleting
 * English:
 *
 * 1. **`err` is not on the list.** *"To err is human"* — it is a verb. The
 *    doubled spellings of the others are here (`umm`, `uhh`) because no English
 *    word is spelt that way; `err` is the one that collides.
 * 2. **Capitals are matched exactly, never case-insensitively.** A filler is
 *    written lower-case, or capitalised because it opened a sentence. `ER` is a
 *    hospital, `UM` and `AH` are initialisms, and a case-insensitive match ate
 *    all three.
 * 3. **A capitalised spelling is only a filler when it opens a sentence *and* is
 *    followed by a comma.** `Ah` is the ampere-hour and `Er` is erbium, and the
 *    first version of rule 2 deleted both — *"The battery stores 100 Ah"* and
 *    *"Er is erbium"*, reproduced by GPT Sol's code review. A capital in the
 *    middle of a sentence is a unit or a name, never a hesitation; and a capital
 *    that opens one is only a hesitation if the pause that follows it was
 *    written down, which is what the comma is.
 * 4. **`ah` is only a filler mid-sentence**, and therefore — with rule 3 — a
 *    capitalised `Ah` is never a filler at all. *"Ah, now I see"* is somebody
 *    reacting and deleting it changes what the sentence does; *"it was, ah,
 *    difficult"* is hesitation. Position is the only signal available without
 *    asking a model what the reader meant.
 *
 * ## The limit that is not fixed
 *
 * **This assumes English.** German `er` and `um`, and Portuguese `um`, are
 * ordinary high-frequency words, and nothing here knows what language a
 * transcript is in — the app's interface is English and its vocabulary is
 * English, but a reader may dictate whatever they like. Named in the plan as a
 * known limit rather than guarded against, because the only real guard is a
 * language signal this app does not have.
 */

/**
 * The fillers, and nothing else will ever be added here without a reason
 * written beside it.
 *
 * Four sounds with their stretched spellings: a model transcribing hesitation
 * writes `um`, `umm` or `ummm` depending on how long it was. `erm` is the
 * British spelling of `um` and is not `er` with a letter on the end, so it is
 * named rather than derived.
 *
 * **`hmm` and `mm` are missing on purpose.** They are answers — agreement,
 * doubt, thinking-about-it — and deleting one changes what a sentence says.
 * Same for `oh` (surprise), `eh` (a question), and `err` (a verb).
 */
const ANYWHERE = ["um", "umm", "ummm", "uhm", "uh", "uhh", "uhhh", "er", "erm", "ermm"];

/** Rule 4 above: hesitation in the middle of a sentence, an interjection at the start of one. */
const MID_SENTENCE_ONLY = ["ah", "ahh", "ahhh"];

const ALL = [...ANYWHERE, ...MID_SENTENCE_ONLY];
const MID_ONLY = new Set(MID_SENTENCE_ONLY);

/** `um` and `Um`, never `UM`. Rule 2. */
function spellings(words: string[]): string[] {
  return words.flatMap((w) => [w, (w[0] ?? "").toUpperCase() + w.slice(1)]);
}

/**
 * One filler, standing on its own.
 *
 * The two guards either side are the whole of the safety, and both are about
 * letters that are *part of another word*:
 *
 * - `(?<![\p{L}\p{N}'’-])` and its mirror stop `umbrella`, `Ahmed`, `her`,
 *   `were`, `summer` and `mahogany`, and — the case that actually matters —
 *   **`uh-huh` and `uh-uh`, which mean yes and no**. A hyphen either side is a
 *   refusal to match.
 * - `\p{L}` rather than `\w`, so that a letter with an accent counts as a
 *   letter. `\w` is ASCII-only, so `\bum\b` would happily fire inside `über`.
 *   Unicode property escapes need the `u` flag, which is here.
 * - Both apostrophes are in the class — the typewriter one and the typographic
 *   one a model actually emits — so `er` inside a contraction is left alone.
 *
 * No `i` flag, deliberately: see rule 2. Matching is only half the decision;
 * `isFiller` below is the other half.
 */
const FILLER = new RegExp(
  `(?<![\\p{L}\\p{N}'’-])(?:${spellings(ALL).join("|")})(?![\\p{L}\\p{N}'’-])`,
  "gu",
);

/**
 * Is the character run before `at` the end of a sentence, or the start of the
 * text?
 *
 * Closing quotes and brackets are skipped over, so that `"…finished." Ah, yes`
 * counts as sentence-initial the same way `finished. Ah, yes` does. An *opening*
 * bracket counts too — `He replied (Ah, now I see)` starts a sentence inside the
 * parenthesis as far as this question is concerned, which is what stops that
 * `Ah` being taken for hesitation.
 */
function startsSentence(text: string, at: number): boolean {
  const before = text.slice(0, at).replace(/[\s"'’)\]]+$/, "");
  return before === "" || /[.!?…:;([{—–]$/.test(before);
}

/** Whether this particular occurrence is hesitation rather than a word. */
function isFiller(match: string, text: string, at: number): boolean {
  const lower = match.toLowerCase();
  const capitalised = match !== lower;
  const opens = startsSentence(text, at);
  if (capitalised) {
    /* Rules 3 and 4. A capital mid-sentence is a unit (`100 Ah`) or a symbol
       (`Er`); a capital opening one is hesitation only if the pause after it
       was written down as a comma. `Ah` fails rule 4 either way. */
    if (MID_ONLY.has(lower)) return false;
    return opens && /^\s*,/.test(text.slice(at + match.length));
  }
  return MID_ONLY.has(lower) ? !opens : true;
}

/**
 * Remove the fillers from one transcript.
 *
 * Returns the original **byte for byte** when there was nothing to remove.
 */
export function stripFillers(text: string): string {
  const cuts: { from: number; to: number; fill: string }[] = [];
  for (const m of text.matchAll(FILLER)) {
    const at = m.index;
    if (at === undefined || !isFiller(m[0], text, at)) continue;
    const floor = cuts[cuts.length - 1]?.to ?? 0;
    cuts.push(widen(text, Math.max(at, floor), at + m[0].length, floor));
  }
  if (cuts.length === 0) return text;

  let out = "";
  let read = 0;
  for (const { from, to, fill } of cuts) {
    out += text.slice(read, from) + fill;
    read = to;
  }
  out += text.slice(read);
  const cut = out.trim();
  /* **"Empty" means no words left, not no characters left.** An early version
     asked `if (!cut)`, and `"um."` strips to `"."` — which is truthy, so a
     dictation consisting of one hesitation came back as a full stop. */
  if (!/[\p{L}\p{N}]/u.test(cut)) return text;
  return recapitalise(text, cut);
}

/**
 * **The one place punctuation is touched, and it can only reach the characters
 * around a deletion.**
 *
 * This replaced a pass that tidied the whole transcript, which GPT Sol's code
 * review broke twice over: `Um, run --help to see it.` came back as
 * `Run -help to see it.` — a command that now means something else — and
 * `Um, what?—No, wait.` lost its dash. A global rewrite triggered by a local
 * deletion is a licence to change text nobody touched, and no list of rules
 * fixes that; the shape has to change.
 *
 * So a deletion consumes: the whitespace on either side of it, **one** trailing
 * `,` `;` or `:` that has lost the word it separated, a matched pair of
 * parentheses left empty, or **one** of two dashes it was sitting between.
 * Nothing further away than that is legible from here, and nothing further away
 * is our damage.
 *
 * `fill` is a single space when the deletion sat between two non-space
 * characters *and* whitespace was consumed — so `I um, think` closes to
 * `I think` while `I—um—no` closes to `I—no`.
 *
 * @param floor the end of the previous cut, so two fillers in a row cannot
 * produce overlapping ranges and eat the text between them twice.
 */
function widen(text: string, start: number, end: number, floor: number): { from: number; to: number; fill: string } {
  let from = start;
  let to = end;
  let ate = false;

  while (from > floor && /[^\S\n]/.test(text[from - 1] ?? "")) {
    from--;
    ate = true;
  }

  /* An empty pair of brackets is the deletion's doing, so both go. */
  if (/[([{]$/.test(text.slice(floor, from)) && /^\s*[)\]}]/.exec(text.slice(to))) {
    from -= 1;
    to += (/^\s*[)\]}]/.exec(text.slice(to)) ?? [""])[0].length;
    while (from > floor && /[^\S\n]/.test(text[from - 1] ?? "")) from--;
    return { from, to, fill: "" };
  }

  const after = text.slice(to);
  const separator = /^([^\S\n]*)([,;:])/.exec(after);
  if (separator) {
    /* **Does not set `ate`.** `ate` asks whether *whitespace* was swallowed, and
       so whether one space has to be put back to keep two words apart. Eating a
       comma leaves the space after it, which is already the separator. */
    to += separator[0].length;
  } else {
    const gap = /^[^\S\n]+/.exec(after);
    if (gap) {
      to += gap[0].length;
      ate = true;
    }
  }

  /* Two dashes with nothing between them any more: `Well — um — no`. Only one
     goes, and only when there is one on each side. */
  if (/[-–—][^\S\n]*$/.test(text.slice(floor, from))) {
    const dash = /^[^\S\n]*[-–—][^\S\n]*/.exec(text.slice(to));
    /* Also does not set `ate`, and for a sharper reason: `I—um—no` has no
       whitespace anywhere near it, and putting a space back there would give
       `I— no`. Whether a space is needed is a question about the spacing that
       was there, not about the dash. */
    if (dash) to += dash[0].length;
  }

  const left = text[from - 1];
  const right = text[to];
  const joins = ate && left !== undefined && right !== undefined && !/\s/.test(left) && !/\s/.test(right);
  return { from, to, fill: joins ? " " : "" };
}

/**
 * Give back the capital the deleted word was carrying.
 *
 * *"um, the thing"* becomes *"the thing"*, and a sentence that starts lower-case
 * looks like a bug rather than like speech. So the first letter is raised — and
 * then twice refused:
 *
 * - **only if the original's first letter was a capital**, because a transcript
 *   that genuinely began lower-case should stay that way, and a rule that always
 *   capitalises has stopped reporting and started deciding;
 * - **only if the new first word is entirely lower-case.** `eBay` and `iPhone`
 *   carry their own capitals and `EBay` is a different word from the one the
 *   reader said. GPT Sol's plan review, F8.
 *
 * Mid-sentence capitals are deliberately not restored. *"He said. um, no."* →
 * *"He said. no."* is the case this does not fix, and fixing it would mean
 * deciding where sentences begin, which is a judgement about the reader's words
 * rather than a repair to our own damage.
 */
function recapitalise(original: string, cut: string): string {
  const first = original.trimStart()[0];
  if (!first || first !== first.toUpperCase()) return cut;
  const word = /^[\p{L}\p{N}'’-]+/u.exec(cut)?.[0];
  if (!word || word !== word.toLowerCase()) return cut;
  return cut[0] ? cut[0].toUpperCase() + cut.slice(1) : cut;
}
