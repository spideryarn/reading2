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
 * JSON at all (a refusal, or a preamble), or it broke at a specific offset. All
 * three are sayable without a character of the content, and that is what this
 * throws. The one real loss is a model refusal's wording, and its shape —
 * "does not begin with { or [" — is the half that tells you where to look.
 *
 * There is deliberately **no environment variable** that turns the quotation
 * back on for local runs. That is the same mechanism logging.md § No transports
 * rejected for pino-pretty: something dangerous, living in the program, one
 * wrong environment variable away from production. If a raw response ever really
 * does need keeping, the answer is a deliberate write of it beside the artefact
 * — a decision about debugging artefacts, made on purpose — not a side effect of
 * an error message that also reaches the log.
 *
 * ## Using it
 *
 *     parseJsonFrom<Meta>(await readFile(file, "utf8"), "meta.json for " + slug)
 *
 * The second argument is **the caller's promise that this string is safe to log**
 * — it goes into the message verbatim, where redaction can never reach it
 * (src/log.ts rule 3). A file name, a slug, a stage name. Never a URL, never a
 * title the model wrote, never anything out of the article.
 *
 * Read the string yourself and pass it in. This does not open files, so
 * `ENOENT` still arrives from `readFile` with its own `code` intact and the
 * callers that treat "absent" as an ordinary answer keep working unchanged.
 */

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
 * Why it would not parse, in a sentence that contains none of it.
 *
 * The order matters. A response that never began as JSON is reported as that
 * even when it also ran out, because "the model answered in prose" is the
 * headline and "it was cut off" is a detail of it — and because V8 gives such a
 * response no offset, so the alternative reads like precision and carries none.
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
  if (at !== undefined) return `it breaks at position ${at} of ${chars}`;
  return chars;
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
