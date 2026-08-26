/**
 * Finding a glossary term in a piece of text — **one definition, two sides.**
 *
 * The server uses it to record which blocks a term appears in
 * (src/glossary.ts § `findOccurrences`); the reading view uses it to underline
 * every occurrence of every term in the prose beside the panel
 * (src/web/TableView.tsx) — of the *selected* term until 2026-08-26, when the
 * underline became a standing property of the article rather than something a
 * press turned on (docs/project/glossary.md).
 *
 * Those two must agree, or the panel says a term is in
 * a block and the block shows nothing underlined — a
 * [silent success](docs/reusable/silent-success.md) in its most annoying form,
 * because the feature looks like it is working and is quietly lying about where
 * the words are.
 *
 * So this module holds the matching rule and nothing else. **It imports nothing
 * from node**, which is what lets it reach the browser bundle at all; the
 * moment it needs `node:fs` or `node:crypto` the client half breaks and the two
 * definitions drift apart again.
 *
 * See docs/project/glossary.md § Finding the term in the prose.
 */

/**
 * A boundary that is not `\b`.
 *
 * `\b` is defined against `[A-Za-z0-9_]`, so it puts a boundary in the middle
 * of `naïve` and `Gödel` and then matches half a word. These lookarounds ask
 * the question we actually mean — is the neighbouring character a letter or a
 * digit *in any script* — using Unicode property escapes, which need the `u`
 * flag on the pattern.
 */
const BEFORE = "(?<![\\p{L}\\p{N}])";
const AFTER = "(?![\\p{L}\\p{N}])";

/**
 * A plural or possessive on the end, allowed but not required.
 *
 * The prompt asks the model for aliases distinctive enough that a regex over
 * them finds all and only the references, and it does a decent job — but no
 * prompt reliably remembers to list the plural of every noun. Without this,
 * "attention head" silently fails to find the sentence that says "attention
 * heads", which is usually the sentence you wanted.
 *
 * **The honest cost:** `bus` matches the text `buss`, and `axi` would match
 * `axis`. Both are wrong, both are rare, and both fail in the harmless
 * direction — an extra block in a term's list, or an extra underline. The
 * opposite failure, missing the plural, is the common case and the one a reader
 * would notice.
 */
const SUFFIX = "(?:['’]s|s)?";

/** So that a term containing `.` or `(` is matched as text rather than as a pattern. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * One case-insensitive pattern matching any of `forms`, or null if there is
 * nothing to match.
 *
 * **Longest first.** The alternation is ordered by length so that where two
 * forms overlap — `nonreductive` and `nonreductive explanation`, the exact pair
 * that broke the original version's dedup — the longer one wins the match.
 * JavaScript's alternation takes the first branch that matches, not the
 * longest, so this ordering is the whole of that behaviour and not a tidy-up.
 *
 * Whitespace inside a form matches any run of whitespace, because the text a
 * block carries has been through `extractText` (src/blocks.ts) and a line break
 * in the original HTML is a single space there — but the model was given the
 * same text, so this mostly guards against the model normalising differently
 * from us.
 */
export function termPattern(forms: readonly string[]): RegExp | null {
  const cleaned = [...new Set(forms.map((f) => f.trim()).filter((f) => f.length > 0))];
  if (cleaned.length === 0) return null;
  cleaned.sort((a, b) => b.length - a.length);
  const body = cleaned.map((f) => escapeRegExp(f).replace(/\s+/g, "\\s+")).join("|");
  return new RegExp(`${BEFORE}(?:${body})${SUFFIX}${AFTER}`, "giu");
}

export interface Span {
  start: number;
  /** Exclusive. */
  end: number;
}

/**
 * Every place `pattern` matches `text`, as offsets into `text`.
 *
 * The pattern is reset before use rather than trusted: it carries `g`, so
 * `lastIndex` survives from whatever used it last, and a shared pattern that
 * quietly starts searching from the middle of the string is the sort of bug
 * that shows up as "the first paragraph never highlights".
 *
 * A zero-length match cannot happen — every branch of the alternation has at
 * least one character — but the guard is cheap and the alternative is an
 * infinite loop rather than a wrong answer.
 */
export function termSpans(text: string, pattern: RegExp): Span[] {
  pattern.lastIndex = 0;
  const spans: Span[] = [];
  for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
    if (m[0].length === 0) {
      pattern.lastIndex += 1;
      continue;
    }
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

/** Does this text use the term at all? Cheaper than collecting every span. */
export function termAppears(text: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

/**
 * Every form of a term, canonical name first.
 *
 * One place, because the server matches against blocks and the client matches
 * against rendered prose, and a term whose aliases were included on one side
 * and not the other would underline differently from the list it came from.
 */
export function formsOf(term: { name: string; aliases?: readonly string[] }): string[] {
  return [term.name, ...(term.aliases ?? [])];
}
