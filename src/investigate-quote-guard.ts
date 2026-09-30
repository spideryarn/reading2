/**
 * **The quote guard inside *Investigate*'s stream** — nothing quote-shaped
 * reaches the reader until code has found it in a text we allow.
 * docs/plans/260930a-citations-investigate-one-work-on-demand.md § No quotes
 * from sources, checked inside the stream.
 *
 * *Investigate* writes prose from web search extracts, and a quotation from a
 * page the reader has not seen would be shown as the paper's own words with
 * nothing checking it. So the prompt allows quotation marks only around the
 * article's own words and the work's title, and this is what holds it to that,
 * **before** the text is sent rather than after — an earlier design checked the
 * finished answer, by which time the reader had watched the unchecked quote
 * arrive (Sol's Q-1, the plan's P0).
 *
 * ## What is held, and what is released
 *
 * - From an opening `"`, `“` or `‘` (U+2018) to its close — `"` toggles, `“`
 *   closes on `”`, `‘` on `’`. **A `’` followed by a letter or digit is an
 *   apostrophe, not a close** (*what’s*), so it cannot end a span early and let
 *   the unchecked rest of it out; that needs one character of lookahead, so a
 *   `’` at the very end of a delta waits for the next one.
 * - Any line whose first non-blank character is `>`, to the end of the line.
 * - Leading blanks on a line, until the first other character says whether the
 *   line is a block quote.
 *
 * A held span is released only if its words — trimmed, with trailing `, . ; :
 * ! ?` dropped (the probe's `"…what's possible,"` false positive) — are found
 * by `quoteFinder(…, "spaced")` in one of the allowed texts: the strict pass,
 * because this is a claim that the words were copied, not a best effort at
 * drawing a mark (src/quote-match.ts § `findQuote`). An empty pair is released.
 *
 * **A span not found, or still open past `QUOTE_SPAN_CAP` characters or at the
 * end of the stream, fails**, and the caller stops the answer there: the span
 * is never released and nothing is stored. After a failure the guard stays
 * failed.
 *
 * What this does not guard, said plainly because the plan says it: straight
 * single quotes (left to the prompt — they are apostrophes far more often than
 * quotation marks), and verbatim prose without quotation marks, which carries
 * no attribution and is what the provenance's *instructed not to quote* covers.
 *
 * Pure, and imports nothing that calls a model — so every rule is a unit test
 * (tests/investigate-quote-guard.test.ts).
 */
import { quoteFinder } from "./quote-match.js";

/** The longest a held span may grow before it is refused as unclosed. */
export const QUOTE_SPAN_CAP = 400;

/** Why a stream was stopped — counted in the log line, never with the words. */
export type QuoteStopCause = "not-found" | "unclosed";

/**
 * `text` is what may be sent now. On a failure it is the safe prose that came
 * before the refused span in the same delta — never any of the span.
 */
export type GuardStep = { ok: true; text: string } | { ok: false; cause: QuoteStopCause; text: string };

export interface QuoteGuard {
  /** Take the next delta; return what may be sent now, or the failure. */
  push(delta: string): GuardStep;
  /** The stream ended: release what is held if it checks, or fail. */
  end(): GuardStep;
}

type Mode =
  /** Ordinary prose. */
  | "text"
  /** Blanks at the start of a line, held until the line shows whether it is a block quote. */
  | "indent"
  | "straight"
  | "curly-double"
  | "curly-single"
  | "blockquote";

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const TRAILING_PUNCTUATION = /[\s,.;:!?]+$/u;

/**
 * @param allowed the texts a quotation may come from — the article's blocks,
 *   the work's title and reference entry, and in the matched branch *Look it
 *   up*'s two verified quotes.
 */
export function createQuoteGuard(allowed: readonly string[], cap: number = QUOTE_SPAN_CAP): QuoteGuard {
  /* Prepared once per text: a long article is asked one question per span,
     and re-reducing every block each time is the cost quoteFinder exists to
     save. */
  const finders = allowed.filter((t) => t.trim() !== "").map((t) => quoteFinder(t, "spaced"));

  let mode: Mode = "text";
  /** The characters held back — the opening mark included. */
  let held = "";
  /** A stream begins at the start of a line. */
  let atLineStart = true;
  /** In `curly-single`: the last held character is a `’` that may be the close. */
  let pendingClose = false;
  let failed: Extract<GuardStep, { ok: false }> | null = null;

  function found(words: string): boolean {
    const wanted = words.trim().replace(TRAILING_PUNCTUATION, "").trim();
    if (wanted === "") return true;
    return finders.some((find) => find(wanted) !== null);
  }

  /** Check the held span; on success return it to be sent and go back to text. */
  function settle(words: string): string | null {
    if (!found(words)) return null;
    const out = held;
    held = "";
    mode = "text";
    pendingClose = false;
    return out;
  }

  /**
   * One character in ordinary prose (or the first after an indent). Returns
   * what it adds to the output now.
   */
  function prose(c: string): string {
    if (atLineStart && (c === " " || c === "\t")) {
      mode = "indent";
      held += c;
      return "";
    }
    if (atLineStart && c === ">") {
      mode = "blockquote";
      held += c;
      return "";
    }
    /* Whatever was held as an indent turned out to be ordinary blanks. */
    const indent = held;
    held = "";
    mode = "text";
    atLineStart = c === "\n";
    if (c === '"') return open("straight", indent, c);
    if (c === "“") return open("curly-double", indent, c);
    if (c === "‘") return open("curly-single", indent, c);
    return indent + c;
  }

  function open(next: Mode, before: string, mark: string): string {
    mode = next;
    held = mark;
    return before;
  }

  function fail(cause: QuoteStopCause, text = ""): GuardStep {
    failed = { ok: false, cause, text: "" };
    return { ok: false, cause, text };
  }

  function push(delta: string): GuardStep {
    if (failed) return failed;
    let out = "";
    for (const c of delta) {
      if (mode === "text" || mode === "indent") {
        out += prose(c);
        continue;
      }

      if (mode === "blockquote") {
        if (c === "\n") {
          const line = settle(held.replace(/^[\s>]+/u, ""));
          if (line === null) return fail("not-found", out);
          out += line + c;
          atLineStart = true;
          continue;
        }
        held += c;
        if (held.length > cap) return fail("unclosed", out);
        continue;
      }

      if (mode === "curly-single" && pendingClose) {
        pendingClose = false;
        if (!LETTER_OR_DIGIT.test(c)) {
          /* The `’` held last was the close. Check the span, then this
             character is ordinary prose again. */
          const span = settle(held.slice(1, -1));
          if (span === null) return fail("not-found", out);
          out += span + prose(c);
          continue;
        }
        /* An apostrophe inside the span: carry on holding. */
      }

      held += c;
      if (held.length - 1 > cap) return fail("unclosed", out);

      const closes =
        (mode === "straight" && c === '"') ||
        (mode === "curly-double" && c === "”");
      if (closes) {
        const span = settle(held.slice(1, -1));
        if (span === null) return fail("not-found", out);
        out += span;
        atLineStart = false;
        continue;
      }
      if (mode === "curly-single" && c === "’") pendingClose = true;
    }
    return { ok: true, text: out };
  }

  function end(): GuardStep {
    if (failed) return failed;
    switch (mode) {
      case "text":
        return { ok: true, text: "" };
      case "indent": {
        const out = held;
        held = "";
        mode = "text";
        return { ok: true, text: out };
      }
      case "blockquote": {
        const line = settle(held.replace(/^[\s>]+/u, ""));
        return line === null ? fail("not-found") : { ok: true, text: line };
      }
      case "curly-single": {
        if (!pendingClose) return fail("unclosed");
        const span = settle(held.slice(1, -1));
        return span === null ? fail("not-found") : { ok: true, text: span };
      }
      case "straight":
      case "curly-double":
        return fail("unclosed");
      default: {
        const never: never = mode;
        throw new Error(`unhandled guard mode: ${String(never)}`);
      }
    }
  }

  return { push, end };
}
