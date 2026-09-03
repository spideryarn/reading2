/**
 * Parsing JSON without putting the JSON in the log.
 *
 * ## The problem this exists for
 *
 * **V8's own `JSON.parse` error message quotes the input back at you.**
 *
 *     JSON.parse("I'm sorry, I can't summarise that article")
 *     → SyntaxError: Unexpected token 'I', "I'm sorry"... is not valid JSON
 *
 * Every string this app parses is either the article's prose, the reader's own
 * writing, or a model's answer about one of those. So the quoted characters are
 * exactly what docs/project/logging.md § What never gets logged says never goes
 * into a line — and a `SyntaxError` that reaches a `catch` gets written down
 * *twice*, because `safeError` in src/log.ts keeps `message` and `stack`, and
 * the message is embedded in the stack.
 *
 * Two details make it worse than "about ten characters", both measured on
 * node v26.7.0 rather than remembered:
 *
 * - Up to twenty characters the input is quoted **in full**, no ellipsis. A
 *   short corrupt file, or a short model refusal, is echoed whole.
 * - It only fires when the content is malformed **from the start** — which is
 *   precisely what a truncated write looks like, and what a model that answered
 *   in prose looks like. The two commonest real failures are the two that leak.
 *
 * The other message shape gives nothing away, because it is positional:
 *
 *     Expected ':' after property name in JSON at position 14 (line 1 column 15)
 *
 * So the target is narrow, and this module is the whole of it: **keep the
 * offset, drop the quotation, and name the artefact instead.**
 *
 * ## Why a new error rather than a wrapped one
 *
 * `cause` is deliberately **not** set, and that is the one thing to know before
 * editing this file. src/log.ts follows `cause` chains on purpose, so wrapping
 * the `SyntaxError` — the reflex fix, and the one a reviewer will ask for — puts
 * the quotation straight back into the line under a different key. The original
 * error is dropped on the floor, and everything worth keeping from it (the
 * offset, and whether the input ran out) is copied across as numbers and fixed
 * phrases first. `tests/parse-json.test.ts` asserts on the absent `cause`.
 *
 * ## What a developer loses, and why that was the right trade
 *
 * A person debugging a malformed model response at a terminal genuinely wants to
 * see the response, and those quoted characters were the only place it appeared:
 * the stages write `tree.json`, `arc.json` and the rest **after** parsing
 * succeeds, so a response that fails to parse is not written anywhere. Checked,
 * because the obvious assumption is that it is on disk somewhere and it is not.
 *
 * The trade is smaller than it looks, and the reason is `diagnose` below. The
 * quoted characters are the *first* ten, and after a code fence is stripped the
 * first ten characters of a model's JSON are `{"summaries` — identical on every
 * run, successful or not. What actually distinguishes the failures is their
 * *shape*: the answer ran out mid-object (the token ceiling), or it was never
 * JSON at all (a refusal, or a preamble), or a complete document had something
 * after it, or it broke at a specific offset. All four are sayable without a
 * character of the content, and that is what this throws. The one real loss is a
 * model refusal's wording, and its shape — "does not begin with { or [" — is the
 * half that tells you where to look.
 *
 * There is deliberately **no environment variable** that turns the quotation
 * back on for local runs. That is the same mechanism logging.md § No transports
 * rejected for pino-pretty: something dangerous, living in the program, one
 * wrong environment variable away from production. If a raw response ever really
 * does need keeping, the answer is a deliberate write of it beside the artefact
 * — a decision about debugging artefacts, made on purpose — not a side effect of
 * an error message that also reaches the log.
 *
 * **That question was asked properly on 2026-09-03 and the answer was still no**,
 * on the strength of src/db/schema.ts § `aiCalls` (*"`raw_response` is gone"*):
 * a failed-only capture is the same sensitive store under a narrower filter. The
 * shape it would take if it is ever built, and the one observation that would
 * trigger building it, are written down in
 * docs/plans/260903k-model-json-answer-extraction-in-the-shared-parse-seam.md §
 * Decided. Which is why `diagnose` below has to earn its sentence: it is the only
 * evidence the next failure leaves behind.
 *
 * ## Using it
 *
 *     parseJsonFrom<Meta>(await readFile(file, "utf8"), "meta.json for " + slug)
 *     parseJsonAnswer<Tree>(raw, "the table-of-contents response")
 *
 * The first is for an artefact — a file, a column, anything whose whole content
 * is meant to be JSON. The second is for a **model's answer**, which is not:
 * see `parseJsonAnswer` below.
 *
 * The second argument is **the caller's promise that this string is safe to log**
 * — it goes into the message verbatim, where redaction can never reach it
 * (src/log.ts rule 3). A file name, a slug, a stage name. Never a URL, never a
 * title the model wrote, never anything out of the article.
 *
 * Read the string yourself and pass it in. `parseJsonFrom` does not open files,
 * so `ENOENT` still arrives from `readFile` with its own `code` intact and the
 * callers that treat "absent" as an ordinary answer keep working unchanged.
 * `readJsonOrNull` at the bottom is the single exception, and its docstring says
 * why it is allowed to be one.
 *
 * ## The helpers around it
 *
 * `parseJsonAnswer`, `stripFence`, `objectEnd` and `readJsonOrNull` live here
 * rather than in the stages that used to each own a copy, because every one of
 * them is a step in the same one job — turning bytes we did not write into a
 * value, without the bytes reaching a log. Splitting them across the callers is
 * how eight versions of the same three lines, and five verbatim copies of the
 * same fifteen-line explanation, came to exist.
 *
 * `objectEnd` is the newest arrival and the clearest case for the rule. It was
 * private to `parseHits` in src/search.ts, which was the only caller that dug
 * its JSON out of a longer response — and this file said so, and said the
 * others did not need to. On 2026-09-03 the hierarchy and timeline steps both
 * died in production proving that wrong, so the scan moved here and eleven
 * stages now reach it through `parseJsonAnswer`.
 * docs/plans/260903k-model-json-answer-extraction-in-the-shared-parse-seam.md.
 */

import { readFile } from "node:fs/promises";

/**
 * A file or a response that would not parse. Thrown by `parseJsonFrom`.
 *
 * `code` exists so a filter can find these without depending on the wording of
 * a message — and because `code` is on src/log.ts's `SAFE_ERROR_PROPS`
 * allowlist, so it is one of the few properties that survives into the line.
 * Nothing else is attached: every own property of a thrown error is a candidate
 * for the log, and the reason that allowlist exists is that the property nobody
 * thought about is always the one that leaks.
 */
export class MalformedJson extends Error {
  readonly code = "malformed_json";

  constructor(message: string) {
    super(message);
    this.name = "MalformedJson";
  }
}

/** `at position 37` → `37`. Digits only, so nothing but a number comes out. */
function offsetIn(message: string): number | undefined {
  const found = /at position (\d+)/.exec(message);
  return found?.[1] === undefined ? undefined : Number(found[1]);
}

/**
 * Did the input simply run out? Measured from the offset, not from the wording.
 *
 * V8 has at least three ways of saying it and only one of them says it —
 * `Unexpected end of JSON input`, `Unterminated string in JSON at position 10`,
 * and `Expected ',' or '}' after property value in JSON at position 7` are all
 * the same event, a file or a response that stopped early. Matching that English
 * is a list that goes stale in a Node upgrade with no test failing, which is the
 * shape docs/reusable/silent-success.md is about.
 *
 * So it is arithmetic instead: **breaking at or past the last character means
 * there was nothing left to read**, whatever the message called it. Trailing
 * junk after a complete document reports an offset well short of the end, so it
 * does not get mistaken for truncation.
 */
function ranOut(text: string, message: string): boolean {
  const at = offsetIn(message);
  // No offset at all is V8's `Unexpected end of JSON input`, which is only ever
  // this. Anything else without an offset failed at the first token, and that
  // is the case below.
  if (at === undefined) return message.includes("Unexpected end of JSON input");
  return at >= text.trimEnd().length;
}

/**
 * Was everything before `at` already a complete JSON document?
 *
 * Asked by re-parsing the prefix, which is arithmetic on the offset rather than
 * a reading of V8's English — the same choice, for the same reason, as `ranOut`
 * above. There is a wording for this shape (`Unexpected non-whitespace
 * character after JSON at position N`) and matching it is a list that goes
 * stale in a Node upgrade with nothing failing.
 *
 * The error is **caught and discarded**, so V8's quotation of the prefix goes
 * nowhere — the same guarantee, stated the same way, as `readJsonOrNull` at the
 * bottom of this file. Only the boolean escapes.
 */
function completeDocumentBefore(text: string, at: number): boolean {
  try {
    JSON.parse(text.slice(0, at));
    return true;
  } catch {
    return false;
  }
}

/**
 * Why it would not parse, in a sentence that contains none of it.
 *
 * The order matters. A response that never began as JSON is reported as that
 * even when it also ran out, because "the model answered in prose" is the
 * headline and "it was cut off" is a detail of it — and because V8 gives such a
 * response no offset, so the alternative reads like precision and carries none.
 *
 * ## Why the trailing-material case earns its own sentence
 *
 * **Nothing keeps the response.** Not on disk, not in `ai_calls` (src/db/schema.ts
 * § `raw_response` is gone), not in the error. So this sentence is the entire
 * evidence a future debugger gets, and it has to be worth reading.
 *
 * *"It breaks at position 5409 of 13547 characters"* is what the hierarchy step
 * said on 2026-09-03, and it is indistinguishable from a syntax error part-way
 * through a document. In fact the tree was whole at 5409 and 8,138 characters of
 * something else followed it — so the sentence sent the diagnosis after a
 * token-ceiling theory for half an hour. Naming the shape costs a re-parse of a
 * prefix on a path that is already throwing, and stores nothing.
 */
function diagnose(text: string, message: string): string {
  if (text.trim() === "") return "it is empty";

  const chars = `${text.length} characters`;
  const first = text.trimStart()[0];

  if (first !== "{" && first !== "[") {
    return `it does not begin with { or [ — ${chars}, so this is probably not JSON at all`;
  }
  if (ranOut(text, message)) return `it ends part-way through — cut off after ${chars}`;

  const at = offsetIn(message);
  if (at === undefined) return chars;
  if (completeDocumentBefore(text, at)) {
    return (
      `a complete JSON document ends at position ${at}, and ${text.length - at} more ` +
      `characters follow it — ${chars} in all. So what surrounds the document is the ` +
      `problem, not the document`
    );
  }
  return `it breaks at position ${at} of ${chars}`;
}

/**
 * `JSON.parse`, with the content kept out of whatever gets thrown.
 *
 * `source` names the thing being parsed and is copied into the message as
 * given — see the header: it is the caller's promise that the string is safe to
 * log. Anything `JSON.parse` throws that is not a `SyntaxError` is passed
 * straight through untouched, on the grounds that this function knows nothing
 * about it and inventing a message would lose whatever it was.
 */
export function parseJsonFrom<T>(text: string, source: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    throw new MalformedJson(`${source} is not valid JSON: ${diagnose(text, err.message)}`);
  }
}

/**
 * Strip a stray code fence if the model wraps its JSON despite instructions.
 *
 * Every stage that asks a model for JSON needs this. Eight of them each carried
 * a copy — arc, glossary, ideas, labels, search, summarise, hierarchy and
 * tweets, in two spellings that were checked against each other on eighteen
 * awkward inputs (bare fence, `json` fence, CRLF, backticks inside a string, a
 * missing close fence, prose before, prose after, no fence at all, and ten
 * more) and agreed on every one. The divergence was accidental, so this is the
 * one of them. (`summarise` was deleted afterwards —
 * docs/plans/260831s-gist-only-summaries.md. The callers today are the eleven
 * listed on `parseJsonAnswer`, plus `parseHits` in src/search.ts.)
 *
 * It is deliberately blunt: an opening fence at the very start and a closing one
 * at the very end, nothing in between examined. Prose before the object survives
 * it untouched, and that is on purpose — the callers that go looking for the
 * first `{` themselves need the prose still there to look past.
 *
 * ## This docstring used to say that only `parseHits` needed to look
 *
 * It said `parseHits` in src/search.ts "is the caller that then goes looking for
 * the first `{` itself, and it is the only one that needs to". **That was
 * false**, and on 2026-09-03 it cost two paid production steps: eleven stages
 * spelled `parseJsonFrom(stripFence(raw), …)` on the strength of it, and a model
 * that puts prose before its fence, or a close fence after a complete document,
 * defeats both ends of this function at once. `parseJsonAnswer` below is what
 * those eleven call now.
 *
 * So **do not make this function cleverer** in order to fix that: the fix is
 * extraction around it, not leniency inside it. `tests/parse-json.test.ts` §
 * "leaves prose before the object alone" is the assertion that says why — take
 * the prose away here and the two callers downstream lose the thing they scan.
 *
 * ## Why the result goes through `parseJsonFrom` and never through `JSON.parse`
 *
 * This is the paragraph that used to be copy-pasted into five stage files, and
 * it is the reason both halves live here now.
 *
 * **Nothing in those stage files logs.** That is exactly what makes a bare
 * `JSON.parse` there dangerous rather than obviously wrong. A step that throws
 * is logged by src/jobs.ts with `errorFields`, which keeps `message` *and*
 * `stack` — and V8's own parse error quotes the first characters of whatever it
 * was handed. So a bare `JSON.parse` in a file that never calls the logger at
 * all still writes part of the model's writing about the article into the log.
 * An error is a value that travels, and where it is thrown is not where it is
 * written down.
 *
 * **And `redact` cannot save you**, because it is path-based: it walks the
 * fields of a log object by name, and the quotation is buried inside a string
 * that is itself embedded in another string. It reaches neither the message nor
 * the stack. src/labels.ts is where that was written down first.
 *
 * The history is the argument for one copy. src/hierarchy.ts learned this the hard
 * way; src/labels.ts was then written without it and a review caught it. Five
 * files carrying the same fifteen lines is five chances for the sixth file to be
 * written by someone who never read them.
 */
export function stripFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
}

/**
 * Where the structure starting at index 0 of `text` closes — the index of its
 * own matching `}` or `]` — or -1 if `text` runs out before it does.
 *
 * Lived in src/search.ts until 2026-09-03, private to `parseHits`, which was
 * the only caller that dug its JSON out of a longer response. It moved here
 * when `parseJsonAnswer` needed the same scan for the other eleven stages, and
 * it is the same one job as the rest of this module: turning bytes we did not
 * write into a value. `parseHits` imports it from here now.
 *
 * **Not a JSON validator** — it does not check that bracket TYPES match (`{`
 * closed by `]` still counts as the nesting returning to zero) or that what it
 * spans is otherwise well-formed. The `JSON.parse` right after it is what
 * validates, and reports that case as malformed rather than as cut off. This
 * answers only the narrower question both callers need: does the FIRST
 * structure in `text` close before the text runs out, and if so, exactly where.
 *
 * **Braces and brackets inside a quoted string do not count**, and neither does
 * a quote that is backslash-escaped. That is not decoration: every gist, quote
 * and glossary definition in an answer is article prose, and article prose
 * contains braces. `hitExtractor` in src/search-hits-stream.ts skips them the
 * same way, for the same reason.
 *
 * The two ways of getting this wrong were both tried first, in src/search.ts,
 * and each broke a real case — `lastIndexOf("}")` reads a truncated answer as a
 * complete one, and balancing the WHOLE remainder reads a chatty sign-off with a
 * stray `{` in it as an unfinished object. The docstring on `parseHits` has that
 * history in full; it is the reason to leave this alone.
 */
export function objectEnd(text: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth++;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * A model's JSON answer, dug out of whatever the model wrapped around it.
 *
 * **This is what a stage that asks a model for JSON calls** — arc, glossary,
 * hierarchy, ideas, illustrated, labels, quiz, quotes, sketch, timeline,
 * tweets. All eleven used to spell `parseJsonFrom(stripFence(raw), …)` instead,
 * which assumes the JSON *is* the whole response — and on 2026-09-03 two paid
 * steps died in production because it is not. The **timeline** step got prose
 * before the fence, so `stripFence` — which only strips a fence at the very
 * start and the very end — left the whole thing alone and the first character
 * was a letter; the **hierarchy** step got a complete tree that ended at
 * position 5409 with another 8,138 characters after it. The two read as
 * unrelated bugs and were one.
 * docs/plans/260903k-model-json-answer-extraction-in-the-shared-parse-seam.md.
 *
 * `source` is the caller's promise that the string is safe to log, exactly as
 * for `parseJsonFrom` — see the header. Nothing about the response itself
 * appears in what is thrown, whichever attempt failed.
 *
 * ## Three conditions, and the third one is the whole design
 *
 * 1. **The stripped response is tried whole first**, so anything that parsed
 *    before this function existed parses identically now, byte for byte, and
 *    extraction is only ever reached on a response that was already going to
 *    throw.
 * 2. **The first `{` must open a structure that closes, and that span must
 *    parse.** `{` only, never `[`: all eleven prompts ask for a root object
 *    (`{"arc":…}`, `{"root":…}`, `{"labels":…}` and so on), so a root array has
 *    no caller — and looking for one would latch onto the `[1]` of a footnote
 *    marker in a preamble, which articles are full of.
 * 3. **A `[` ahead of that `{` is a refusal**, because the document is then
 *    array-rooted and the brace is somewhere inside it. See below.
 * 4. **Nothing outside the span may be another document.** If there is a second
 *    `{` after the span closes, this throws instead of choosing.
 *
 * ### The `[` rule is deliberately asymmetric, and that is not an oversight
 *
 * A `[` **before** the first `{` refuses; a `[` **after** the span is ignored
 * entirely. Both halves are load-bearing and the next reader will want to tidy
 * one of them away, so:
 *
 * - *Before*, because the answer is then the array and the `{` is a sub-value
 *   of it. `[{"a":1}]` with trailing prose returned `{"a":1}` — successfully —
 *   until this rule arrived: the same silent-success class as the bug this
 *   function exists to fix, one level down. `[{"a":1},{"a":2}]` happened to
 *   throw, but only because it contains a second `{`; that is luck, not a rule.
 * - *After*, because a model's closing remark about an article is full of `[1]`
 *   and `[2]` footnote markers, and refusing on those would throw away
 *   *"a document, then a sign-off"* — the main shape this whole change is for.
 *
 * **The *before* half refuses more than array roots, and that is known rather
 * than overlooked.** It is a plain `indexOf`, so a bracket anywhere in a
 * *preamble* refuses too — `See [1] below:` ahead of a perfectly good object
 * throws, even though nothing there is array-rooted. Two reasons to leave it.
 * Often it is the right answer anyway: `[1]` is itself valid JSON, so that
 * response genuinely does offer two documents and picking one is guessing. And
 * distinguishing the rest would mean asking whether the bracket opens something
 * that closes and parses — a second candidate hunt, for a shape nobody has
 * seen, against an instruction not to overengineer this. If a preamble with a
 * bracket in it ever shows up in the wild, that is the change to make, and
 * `diagnose` will name it.
 *
 * ### Why the third one, when "take the first document" is so much easier
 *
 * Because taking the first one turns a loud failure into a plausible wrong
 * answer, which is worse than the bug being fixed here — docs/reusable/silent-success.md.
 * The counterexample that killed it:
 *
 *     I first considered {"events":[]}.
 *     Final answer:
 *     {"events":[{…the real events…}]}
 *
 * "First document" hands back `{"events":[]}`, and src/timeline.ts treats zero
 * events as a legitimate result — so the wrong answer is *stored*, silently, and
 * the reader sees an article with no timeline and no error. Today that response
 * fails loudly. It has to keep failing loudly. Same for one complete document
 * followed by a truncated second one.
 *
 * The check needs no scanner of its own: there is no `{` *before* the span by
 * construction, since the span opens at the first one, and after the span
 * closes there are no JSON string literals left to hide a brace inside — the
 * region after a closed top-level structure is prose. So one `indexOf` past the
 * end is the whole of it. Braces inside the document's own strings are inside
 * the span and never examined; `objectEnd` is what skipped them.
 *
 * The cost is a shape that could have been read and now throws: trailing prose
 * with a brace in it, of the *"let me know if you want it as {…} instead"*
 * kind. That is the trade taken on purpose. **A refusal costs the reader a
 * Retry click; a wrong pick corrupts an artefact and says nothing.**
 *
 * **`parseHits` in src/search.ts reads that shape and this does not, and the
 * two must not be unified.** Search shows the reader its hits and empty is a
 * visible answer they can argue with; a stage writes an artefact that becomes
 * the article's furniture, unseen, for as long as the article exists. Same scan,
 * different tolerance for being wrong. tests/search.test.ts § "does not mistake
 * a stray brace in trailing prose for an unclosed object" is Search's side of
 * it, and it stays green.
 *
 * An extraction that fails any of the three drops what it learned without
 * comment and the *whole* response is diagnosed by `parseJsonFrom` instead,
 * because that is where V8's offset points and the offset is the useful half.
 * There is no automatic retry here: the reader's own Retry button is still
 * offered, because `MalformedJson` carries no `failureKind` and
 * src/job-failure.ts falls through to it.
 */
export function parseJsonAnswer<T>(raw: string, source: string): T {
  const text = stripFence(raw);
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    // Anything but a SyntaxError is not about the shape, so hunting for a
    // document would be answering a question nobody asked. Same reasoning as
    // the passthrough in `parseJsonFrom`.
    if (!(err instanceof SyntaxError)) throw err;
  }

  const from = text.indexOf("{");
  /* A `[` ahead of the first `{` means the document is array-rooted and the
     brace we found is somewhere *inside* it — so refuse rather than hand back a
     sub-value. Asymmetric on purpose: see the docstring. */
  const bracket = text.indexOf("[");
  const objectRooted = from !== -1 && (bracket === -1 || from < bracket);
  const end = objectRooted ? objectEnd(text.slice(from)) : -1;
  const to = from + end;
  const unambiguous = end !== -1 && text.indexOf("{", to + 1) === -1;
  if (unambiguous) {
    try {
      return JSON.parse(text.slice(from, to + 1)) as T;
    } catch {
      /* Discarded on purpose, and this is the one line in this function that
         has to stay that way: V8's message quotes the span, so letting it
         escape — as a `cause`, a log, or a richer message — puts the model's
         writing about the article into a line. See the header. */
    }
  }
  return parseJsonFrom<T>(text, source);
}

/**
 * A JSON artefact on disk, or `null` if it is missing, truncated or not JSON.
 *
 * The one thing in this module that opens a file, and the one place in it where
 * a bare `JSON.parse` is correct: **the error is caught and discarded**, so
 * V8's quotation never escapes this function and nothing can log it. Stated
 * precisely, because the loose version — "the error is never built" — is false
 * and would mislead somebody deciding whether a change is safe: `JSON.parse`
 * does throw, and the message does quote the file. What holds is that it goes
 * nowhere (GPT Sol, 2026-08-28).
 *
 * That is the whole justification, and it is load-bearing — if this is ever
 * changed to rethrow, or to warn, it must switch to `parseJsonFrom` in the same
 * edit, or it puts the leak this module exists to prevent straight back.
 *
 * "Missing" and "corrupt" deliberately give the same answer. Six stages
 * (glossary, ideas, quiz, quotes, sketch, timeline) read an artefact they are about to
 * regenerate anyway, and for them an unreadable file is worth exactly what an
 * absent one is worth: nothing.
 *
 * **Not for callers who need to tell those apart**, and one in the tree does, so
 * check before reaching for this. `readJson` in src/api.ts collects the
 * unreadable paths so the shelf can say which article broke. (There were two
 * until 2026-09-01: `readJson` in src/store/import.ts returned `undefined` for
 * `ENOENT` only and let a genuinely corrupt file throw, and went with that
 * file.) Folding that reader into this would turn a reported failure into a silent
 * one — docs/reusable/silent-success.md.
 */
export async function readJsonOrNull<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as T;
  } catch {
    return null;
  }
}
