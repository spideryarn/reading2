/**
 * **An answer's words without its machinery**: block references taken out of
 * prose, and how an answer begins as one plain line.
 *
 * Pure, and imported by both sides: the server cuts a thread summary's
 * `lastLine` with `answerOpening` (src/routes.ts § `summarise`), the browser
 * cuts the collapsed chat card's line with it (src/web/ChatDialog.tsx §
 * `cardLine`), and Live's seed uses `withoutBlockIds` (src/live.ts). Nothing
 * here may import a server module.
 */
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";

import { webLinks } from "./urls.js";

/**
 * Take our block ids out of a line of prose, leaving it readable.
 *
 * **Not `splitCitations` from src/web/citations.ts**, and the difference is the
 * job rather than the pattern. That one has to know *where* each citation sits
 * so the renderer can put a chip there; this one only has to make the text
 * safe to say out loud, and deleting is strictly simpler than locating. Sharing
 * the harder function to get the easier answer would drag the client's
 * rendering rules onto the server for nothing.
 *
 * **Links are protected**, for the reason `citedBlockIds` gives: a URL a model
 * found on the web can contain something id-shaped, and mangling somebody's
 * link is worse than leaving an id in a place nobody reads aloud. That was a
 * real bug in the first version of this function and the test that caught it is
 * `leaves an id inside a URL alone`.
 */
export function withoutBlockIds(text: string): string {
  return tidy(stripBlockIds(text));
}

/** Citation removal without trimming a text leaf's boundary spaces. */
function stripBlockIds(text: string): string {
  /* **Links are held out of the way first, and this was a bug before it was a
     comment.** The first version stripped ids from the raw string, so
     `https://example.com/notes/spya-k3m9qt` came back as
     `https://example.com/notes/` — a stranger's URL quietly broken, in an
     answer the reader might follow. `webLinks` is the SAME matcher the renderer
     and the citation counters use (src/urls.ts), so the three agree about what
     a link is rather than each deciding for itself.

     Spans are collected and skipped rather than blanked-then-restored, because
     `withoutWebLinks` replaces a link with spaces of equal length — right for
     counting offsets, useless when the text has to survive. */
  const spans = webLinks(text).map((l) => [l.index, l.end] as const);
  const insideLink = (at: number): boolean => spans.some(([from, to]) => at >= from && at < to);

  return text.replace(
    /* A bracketed citation, or a bare id. One pass, so a bracket cannot be
       eaten by the first rule and its contents by the second. */
    /\[\s*(?:spya-[a-z0-9]{6}[\s,;]*)+\]|spya-[a-z0-9]{6}/g,
    (match, offset: number) => (insideLink(offset) ? match : ""),
  );
}

function tidy(text: string): string {
  return (
    text
      /* Tidy the holes. A stripped citation otherwise leaves a double space and
         a space before the full stop — and a text-to-speech pass does hear the
         difference. */
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([.,;:!?])/g, "$1")
      .trim()
  );
}

/**
 * A markdown tree's words, one block to a line. An explicit stack survives
 * deeply nested markdown without falling back to source markers.
 *
 * A link gives its label and an image its alt text; a rule and a link
 * definition give nothing. Code and raw HTML give their own characters,
 * because that is what the chat draws for them (src/web/Cited.tsx §
 * `drawBlock`, `drawPhrase`). Blocks, list items and hard breaks are parted
 * by a newline so the caller's "first line" is the first block's first line.
 * Strip citations
 * only from ordinary text leaves, before joining: a link label, code or image
 * alt is literal text, and joining leaves can manufacture an id-shaped string.
 */
function* words(root: Nodes): Generator<string> {
  const stack: ({ node: Nodes; literal: boolean } | string)[] = [{ node: root, literal: false }];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (typeof frame === "string") {
      yield frame;
      continue;
    }
    const { node } = frame;
    const literal = frame.literal || node.type === "link" || node.type === "linkReference";
    switch (node.type) {
      case "text":
        yield literal ? node.value : stripBlockIds(node.value);
        break;
      case "break":
        yield "\n";
        break;
      case "image":
      case "imageReference":
        yield node.alt ?? "";
        break;
      case "code":
      case "inlineCode":
      case "html":
        yield node.value;
        break;
      default: {
        if (!("children" in node)) break;
        const blocks = ["root", "blockquote", "list", "listItem"].includes(node.type);
        for (let i = node.children.length - 1; i >= 0; i--) {
          if (blocks && i < node.children.length - 1) stack.push("\n");
          stack.push({ node: node.children[i]!, literal });
        }
        break;
      }
    }
  }
}

/** A letter or a digit: what a line needs to be worth showing. */
const HAS_WORDS = /[\p{L}\p{N}]/u;

/**
 * **How an answer begins, in plain words**: its first line with markdown
 * formatting and prose citations taken out. The one line a chat's mark and
 * the collapsed chat card show. Literal code, link labels and image alt text
 * keep their characters, including anything id-shaped.
 *
 * Parsed with the parser the reader's own view of the answer uses
 * (src/web/Cited.tsx), so the line agrees with the chat about what is
 * markdown and what is an asterisk. Clipping to a width is the caller's CSS.
 *
 * **A line with no words is skipped for the next that has some**, within a
 * paragraph as well as between blocks, so an answer opening on a rule or a
 * lone `[spya-…]` still has a preview. `undefined`, not an empty string, when
 * no line has any: the caller's test is `if (line)`.
 */
export function answerOpening(text: string): string | undefined {
  const head = openingOf(headOf(text));
  /* A head with no words in it (rules, lone citations) is rare enough to pay
     for the whole answer. */
  return head !== undefined || headOf(text) === text ? head : openingOf(text);
}

/**
 * How much of an answer is parsed to find its opening. The parser's cost is
 * the whole string's length, and the summaries route pays it once per thread
 * on every fetch: 18 ms for a 4 KB answer on the box, measured in
 * docs/plans/261006f-code-review-sol.md § F8.
 */
const HEAD_CHARS = 1000;

/**
 * The answer up to the first blank line past `HEAD_CHARS`, so the cut never
 * falls inside a paragraph. **The price**: a reference link in the opening
 * whose definition is past the cut keeps its source characters, `[Label][ref]`.
 */
function headOf(text: string): string {
  const blank = /\r?\n[ \t]*\r?\n/g;
  blank.lastIndex = HEAD_CHARS;
  const cut = blank.exec(text);
  return cut ? text.slice(0, cut.index) : text;
}

function openingOf(text: string): string | undefined {
  let raw = "";
  for (const part of words(fromMarkdown(text))) {
    const lines = part.split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
      raw += lines[i];
      if (i < lines.length - 1) {
        const line = tidy(raw);
        if (HAS_WORDS.test(line)) return line;
        raw = "";
      }
    }
  }
  const line = tidy(raw);
  return HAS_WORDS.test(line) ? line : undefined;
}
