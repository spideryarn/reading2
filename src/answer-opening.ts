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

  const stripped = text.replace(
    /* A bracketed citation, or a bare id. One pass, so a bracket cannot be
       eaten by the first rule and its contents by the second. */
    /\[\s*(?:spya-[a-z0-9]{6}[\s,;]*)+\]|spya-[a-z0-9]{6}/g,
    (match, offset: number) => (insideLink(offset) ? match : ""),
  );

  return (
    stripped
      /* Tidy the holes. A stripped citation otherwise leaves a double space and
         a space before the full stop — and a text-to-speech pass does hear the
         difference. */
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([.,;:!?])/g, "$1")
      .trim()
  );
}

/**
 * How deep the walk below reads structure before it gives the rest as its own
 * characters. The same cap, for the same reason, as `MAX_DEPTH` in
 * src/web/Cited.tsx: the parser survives thousands of nested `>` and a
 * recursive walk over its tree does not.
 */
const MAX_DEPTH = 12;

/**
 * A markdown tree's words, one block to a line.
 *
 * A link gives its label and an image its alt text; a rule and a link
 * definition give nothing. Code and raw HTML give their own characters,
 * because that is what the chat draws for them (src/web/Cited.tsx §
 * `sourceOf`). Blocks, list items and hard breaks are parted by a newline so
 * the caller's "first line" is the first block's first line.
 */
function words(node: Nodes, source: string, depth: number): string {
  if (depth > MAX_DEPTH) {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    return from !== undefined && to !== undefined ? source.slice(from, to) : "";
  }
  const each = (children: readonly Nodes[], between: string): string =>
    children.map((child) => words(child, source, depth + 1)).join(between);
  switch (node.type) {
    case "break":
      return "\n";
    case "image":
    case "imageReference":
      return node.alt ?? "";
    case "root":
    case "blockquote":
    case "list":
    case "listItem":
      return each(node.children, "\n");
    default:
      if ("children" in node) return each(node.children, "");
      return "value" in node ? node.value : "";
  }
}

/** A letter or a digit: what a line needs to be worth showing. */
const HAS_WORDS = /[\p{L}\p{N}]/u;

/**
 * **How an answer begins, in plain words**: its first line with the markdown
 * and our block references taken out. The one line a chat's mark, the gutter
 * chip's hover and the collapsed chat card show.
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
  for (const raw of words(fromMarkdown(text), text, 0).split("\n")) {
    const line = withoutBlockIds(raw);
    if (HAS_WORDS.test(line)) return line;
  }
  return undefined;
}
