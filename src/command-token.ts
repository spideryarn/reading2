/**
 * **The shape of a command token in a model's answer** — `[cmd:<id>:<encoded
 * argument>]` — and nothing about what one means.
 *
 * A file of its own, outside `src/web/`, because two sides have to agree on
 * the shape and one of them is the server:
 *
 *  - the renderer (src/web/Cited.tsx) lifts a token out of a text node before
 *    it looks for citations, and draws it as a button or as its own characters;
 *  - `citableText` (src/citable.ts) blanks the same span, so the server's
 *    citation counters never count the block id inside
 *    `[cmd:bookmark:spya-k3m9qt]` as a citation the reader was shown.
 *
 * **The shape is opaque to citations whether or not the token is valid.** A
 * token that fails its command's own check is drawn as text, whole, and the id
 * in it is still not a chip. Validity depends on things the server cannot see
 * (which runners the page has), so the rule both sides share has to be the
 * shape alone. Meaning lives in src/web/command-proposal.ts §
 * `parseProposalToken`; which ids chat may propose in src/web/chat-commands.ts.
 * Plan 261003f, Stage 2.
 */

/** One token, unanchored. An id of lower-case letters and `-`; an argument of letters, digits, `%` and `-`. */
export const COMMAND_TOKEN_SOURCE = String.raw`\[cmd:([a-z-]+):([A-Za-z0-9%-]*)\]`;

/** A run of prose, or one token-shaped run exactly as the model wrote it. */
export type TokenRun =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "token"; readonly raw: string };

/** Split a run of text into prose and the token-shaped runs in it. No empty text runs. */
export function splitCommandTokens(text: string): TokenRun[] {
  const out: TokenRun[] = [];
  let last = 0;
  for (const match of text.matchAll(new RegExp(COMMAND_TOKEN_SOURCE, "g"))) {
    if (match.index > last) out.push({ kind: "text", text: text.slice(last, match.index) });
    out.push({ kind: "token", raw: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/**
 * **Which of these runs' tokens stand on a line of their own** — one answer
 * per token run, in order.
 *
 * A button is a row, and the chat prompt asks for the token on a line of its
 * own. The rule is in code as well because of what the eval found
 * (docs/investigations/261003b-chat-proposes-commands-as-chips.md): all 89
 * tokens a model wrote *for the reader* were on their own line, and the one
 * that was not was a hostile page's, quoted mid-sentence by a model that was
 * refusing it — `told me to add "[cmd:tag-add:sponsored]"`. Drawn as a button,
 * that sentence would have offered the very thing it declined.
 *
 * A line may hold several tokens and whitespace, and nothing else.
 * `startsLine` and `endsLine` say whether the runs' own first and last
 * characters are at a line's edge: a run that follows a link or a bold word
 * does not start a line, whatever its first character is.
 */
export function tokensOnOwnLine(runs: readonly TokenRun[], startsLine: boolean, endsLine: boolean): boolean[] {
  const text = runs.map((run) => (run.kind === "text" ? run.text : run.raw)).join("");
  const blank = withoutCommandTokens(text);
  const out: boolean[] = [];
  let at = 0;
  for (const run of runs) {
    const length = run.kind === "text" ? run.text.length : run.raw.length;
    if (run.kind === "token") {
      const before = text.lastIndexOf("\n", at - 1);
      const after = text.indexOf("\n", at + length);
      const line = blank.slice(before + 1, after === -1 ? text.length : after);
      out.push(line.trim() === "" && (before !== -1 || startsLine) && (after !== -1 || endsLine));
    }
    at += length;
  }
  return out;
}

/** The text with every token-shaped run blanked, character for character — `citableText`'s rule. */
export function withoutCommandTokens(text: string): string {
  return text.replace(new RegExp(COMMAND_TOKEN_SOURCE, "g"), (run) => " ".repeat(run.length));
}

/** Every prefix of a token that has not closed yet, touching the end of the text. */
const UNFINISHED = /\[(?:c(?:m(?:d(?::(?:[a-z-]+(?::[A-Za-z0-9%-]*)?)?)?)?)?)?$/;

/**
 * **Where a half-arrived token starts**, if the text ends in one — else `-1`.
 *
 * For the end of an answer that is still streaming: `[cmd:tag-add:to%20` is
 * about to be a button, and drawing those characters for the two frames before
 * it closes is a flash of raw syntax mid-sentence. The renderer leaves them
 * undrawn until the token closes or stops being one. A lone `[` qualifies, so
 * a bracket of any kind arrives one token late; nothing is ever withheld from
 * an answer that has finished.
 */
export function unfinishedTokenAt(text: string): number {
  return UNFINISHED.exec(text)?.index ?? -1;
}

/* A final line made only of one or more complete tokens. While an answer is
   still arriving, its right edge is not a line edge yet: the next delta may
   turn `[cmd:tag-add:x]` into quoted prose. The renderer holds this suffix
   until a newline or the end-of-stream settles it. */
const UNSETTLED_TOKEN_LINE = new RegExp(
  String.raw`(?:^|\n)[ \t]*(?:${COMMAND_TOKEN_SOURCE}[ \t]*)+$`,
);

/** Start of a complete token-only final line that has not been settled yet. */
export function unsettledTokenLineAt(text: string, startsLine: boolean): number {
  const match = UNSETTLED_TOKEN_LINE.exec(text);
  if (match === null) return -1;
  const afterBreak = match[0].startsWith("\n");
  if (!afterBreak && !startsLine) return -1;
  const token = match[0].indexOf("[cmd:");
  return token === -1 ? -1 : match.index + token;
}
