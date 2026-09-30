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
 * **The property, under any chunking of the stream:** no quote-shaped span that
 * is not found in the allowed texts ever appears in the output. A false refusal
 * costs the reader a retry; a leak shows them words we cannot vouch for. So
 * where the two trade, this refuses.
 *
 * ## The rules
 *
 * - **Straight `"` and curly `“…”`**: held from the opening mark to its close
 *   (`"` toggles, `“` closes only on `”`), then checked.
 * - **Block quotes**: a line whose first non-blank character is `>` is held to
 *   the end of the line and checked. `\n`, `\r`, U+2028 and U+2029 all end a
 *   line (Sol's G-1: a lone `\r` once let a `>` line through). Leading blanks
 *   on a line are held until the first other character says which it is.
 * - **Curly single quotes — the paragraph hold.** A `‘` (U+2018) in prose holds
 *   everything from it to the end of the paragraph: a blank line (two line
 *   breaks with only blanks between; `\r\n` counts as one break) or the end
 *   of the stream. The held paragraph is then decided whole. For each `‘`, the
 *   candidate closes are the `’` after it and before the next `‘` that are
 *   not followed by a letter or digit (so *what’s* is not a close). No
 *   candidate fails as `unclosed`; otherwise the span to the **farthest**
 *   candidate must be found, or it fails as `not-found`. If every `‘` passes,
 *   the paragraph is replayed through the other rules with `‘` as an ordinary
 *   character, so a `"` or a `>` line inside it is still guarded.
 * - A `’` with no `‘` before it in the paragraph is prose (*the authors’
 *   claim*) and is never held.
 *
 * **Why the paragraph hold.** `’` is both an apostrophe and a closing mark, so
 * `‘the dogs’ owners fabricated…’` (a leak if the first `’` is taken as the
 * close and "the dogs" is allowed — Sol's C-1) and `‘fitness’ is …` (a false
 * refusal if it is not — D-1, then G-2 and G-3) begin identically. Three rounds
 * of grammatical special cases each produced a new edge. Waiting for the
 * paragraph and taking the farthest close removes the guessing: the longest
 * reading is always the one checked. The cost, accepted and tested, is that a
 * quoted term followed later in the same paragraph by a plural possessive
 * (`‘fitness’ and the authors’ claim`) is refused.
 *
 * A held span is released only if its words — trimmed, with trailing `, . ; :
 * ! ?` dropped (the probe's `"…what's possible,"` false positive) — are found
 * by `quoteFinder(…, "spaced")` in one of the allowed texts: the strict pass,
 * because this is a claim that the words were copied, not a best effort at
 * drawing a mark (src/quote-match.ts § `findQuote`). An empty pair is released.
 *
 * **A span not found, or still open past its cap (`QUOTE_SPAN_CAP` for a
 * quote or a line, `PARAGRAPH_HOLD_CAP` for a paragraph hold) or at the end of
 * the stream, fails**, and the caller stops the answer there: the span is
 * never released and nothing is stored. After a failure the guard stays failed.
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

/** The longest a held quote or block-quote line may grow before it is refused as unclosed. */
export const QUOTE_SPAN_CAP = 400;

/** The longest a paragraph held for a `‘` may grow before it is refused as unclosed. */
export const PARAGRAPH_HOLD_CAP = 2000;

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
  /** From a `‘` to the end of its paragraph. */
  | "paragraph"
  | "blockquote";

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const TRAILING_PUNCTUATION = /[\s,.;:!?]+$/u;
const OPEN_SINGLE = "‘";
const CLOSE_SINGLE = "’";

function isLineBreak(c: string): boolean {
  return c === "\n" || c === "\r" || c === " " || c === " ";
}

function isBlank(c: string): boolean {
  return c === " " || c === "\t";
}

/**
 * @param allowed the texts a quotation may come from — the article's blocks,
 *   the work's title and reference entry, and in the matched branch *Look it
 *   up*'s two verified quotes.
 */
export function createQuoteGuard(
  allowed: readonly string[],
  cap: number = QUOTE_SPAN_CAP,
  paragraphCap: number = PARAGRAPH_HOLD_CAP,
): QuoteGuard {
  /* Prepared once per text: a long article is asked one question per span,
     and re-reducing every block each time is the cost quoteFinder exists to
     save. */
  const finders = allowed.filter((t) => t.trim() !== "").map((t) => quoteFinder(t, "spaced"));

  let mode: Mode = "text";
  /** The characters held back — the opening mark (or `‘`) included. */
  let held = "";
  /** A stream begins at the start of a line. */
  let atLineStart = true;
  /** In `paragraph`: a line break has been seen, with only blanks since. */
  let blankLineOpen = false;
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
    return out;
  }

  /** Every `‘` in a held paragraph, checked to its farthest candidate close. */
  function checkSingles(paragraph: string): QuoteStopCause | null {
    const chars = [...paragraph];
    for (let open = 0; open < chars.length; open += 1) {
      if (chars[open] !== OPEN_SINGLE) continue;
      let close = -1;
      for (let i = open + 1; i < chars.length && chars[i] !== OPEN_SINGLE; i += 1) {
        if (chars[i] === CLOSE_SINGLE && !LETTER_OR_DIGIT.test(chars[i + 1] ?? "")) close = i;
      }
      if (close === -1) return "unclosed";
      if (!found(chars.slice(open + 1, close).join(""))) return "not-found";
    }
    return null;
  }

  /**
   * Decide a held paragraph whole, then replay it through the other rules
   * with `‘` as an ordinary character.
   */
  function decideParagraph(): GuardStep {
    const paragraph = held;
    const cause = checkSingles(paragraph);
    if (cause) return { ok: false, cause, text: "" };
    held = "";
    mode = "text";
    atLineStart = false;
    blankLineOpen = false;
    let out = "";
    for (const c of paragraph) {
      const step = feed(c, true);
      out += step.text;
      if (!step.ok) return { ...step, text: out };
    }
    return { ok: true, text: out };
  }

  /**
   * One character in ordinary prose (or the first after an indent). Returns
   * what it adds to the output now.
   */
  function prose(c: string, singlesChecked: boolean): string {
    if (atLineStart && isBlank(c)) {
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
    atLineStart = isLineBreak(c);
    if (c === '"') return open("straight", indent, c);
    if (c === "“") return open("curly-double", indent, c);
    if (c === OPEN_SINGLE && !singlesChecked) {
      blankLineOpen = false;
      return open("paragraph", indent, c);
    }
    return indent + c;
  }

  function open(next: Mode, before: string, mark: string): string {
    mode = next;
    held = mark;
    return before;
  }

  /**
   * One character through the rules. `singlesChecked` is true while a
   * decided paragraph is replayed, so its `‘` do not open another hold.
   */
  function feed(c: string, singlesChecked: boolean): GuardStep {
    switch (mode) {
      case "text":
      case "indent":
        return { ok: true, text: prose(c, singlesChecked) };

      case "blockquote": {
        if (isLineBreak(c)) {
          const line = settle(held.replace(/^[\s>]+/u, ""));
          if (line === null) return { ok: false, cause: "not-found", text: "" };
          atLineStart = true;
          return { ok: true, text: line + c };
        }
        held += c;
        return held.length > cap ? { ok: false, cause: "unclosed", text: "" } : { ok: true, text: "" };
      }

      case "paragraph": {
        const previous = held.at(-1) ?? "";
        held += c;
        if (held.length > paragraphCap) return { ok: false, cause: "unclosed", text: "" };
        if (isLineBreak(c)) {
          /* `\r\n` is one break, not a blank line. */
          if (c === "\n" && previous === "\r") return { ok: true, text: "" };
          if (blankLineOpen) return decideParagraph();
          blankLineOpen = true;
        } else if (!isBlank(c)) {
          blankLineOpen = false;
        }
        return { ok: true, text: "" };
      }

      case "straight":
      case "curly-double": {
        held += c;
        if (held.length - 1 > cap) return { ok: false, cause: "unclosed", text: "" };
        const closes = (mode === "straight" && c === '"') || (mode === "curly-double" && c === "”");
        if (!closes) return { ok: true, text: "" };
        const span = settle(held.slice(1, -1));
        if (span === null) return { ok: false, cause: "not-found", text: "" };
        atLineStart = false;
        return { ok: true, text: span };
      }

      default: {
        const never: never = mode;
        throw new Error(`unhandled guard mode: ${String(never)}`);
      }
    }
  }

  function stop(step: Extract<GuardStep, { ok: false }>): GuardStep {
    failed = { ok: false, cause: step.cause, text: "" };
    return step;
  }

  function push(delta: string): GuardStep {
    if (failed) return failed;
    let out = "";
    for (const c of delta) {
      const step = feed(c, false);
      out += step.text;
      if (!step.ok) return stop({ ...step, text: out });
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
        return line === null ? stop({ ok: false, cause: "not-found", text: "" }) : { ok: true, text: line };
      }
      case "paragraph": {
        const decided = decideParagraph();
        if (!decided.ok) return stop(decided);
        /* The replay may have left a quote or a block-quote line open. */
        const tail = end();
        return { ...tail, text: decided.text + tail.text };
      }
      case "straight":
      case "curly-double":
        return stop({ ok: false, cause: "unclosed", text: "" });
      default: {
        const never: never = mode;
        throw new Error(`unhandled guard mode: ${String(never)}`);
      }
    }
  }

  return { push, end };
}
