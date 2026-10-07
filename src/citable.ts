/**
 * **The text a reader will actually be offered a citation in** — one definition,
 * for the renderer's counterpart and for the server's counters.
 *
 * A block id has no syntax: `spya-k3m9qt` is a citation because of its *shape*
 * (src/web/citations.ts § splitCitations). So "how many ids did this answer
 * cite" is a question about where in the answer an id can appear, and two places
 * ask it:
 *
 *  - the reader's screen, where a chip either appears or does not;
 *  - the log, where `citedBlockIds` and `unknownCitedIds` in src/converse.ts
 *    record how many the model cited and how many it invented.
 *
 * **Those two numbers have to mean the same thing.** Where they drift, the one
 * that gets watched is quietly wrong: a citation the reader never saw, or a
 * hallucination that never happened.
 *
 * ## Why this parses, when the old version matched
 *
 * It used to be a regex — `withoutWebLinks`, later plus a code-span pass — and
 * that was defensible while the renderer was a regex too. It stopped being
 * defensible the day the client started parsing (docs/plans/chat-markdown.md).
 * A GPT Sol review, 2026-08-31, found four inputs where a raw matcher and an
 * AST disagree, and the point is that there is no fifth patch that fixes the
 * class:
 *
 *  - `https://x.example/_spya-k3m9qt_` — the client sees `emphasis` and chips the
 *    id; the raw matcher reads the whole thing as one URL and blanks it.
 *  - `[spya-k3m9qt](https://x.example "title")` — the client sees a link label and
 *    draws no chip; the raw matcher does not know about titles, so it blanked
 *    the address and counted the label.
 *  - a code span with a newline in it, and a fenced code block — no chip either
 *    way; both counted.
 *
 * > The responsibility split is wrong here. Keep `webLinks` as the single
 * > bare-URL matcher, but parse Markdown on both sides and apply it only to the
 * > same citable text nodes. A second raw Markdown approximation cannot remain
 * > equivalent to mdast.
 * >
 * > — GPT Sol, 2026-08-31
 *
 * That is what this is. `webLinks` stays the single bare-URL matcher, and it is
 * applied to the same text the renderer applies it to.
 *
 * The pair is checked end to end rather than asserted here:
 * `tests/chat-markdown-render.test.tsx` § the client and the server agree renders
 * an answer, counts the chips on the screen, and compares that with what this
 * yields.
 */
import { fromMarkdown } from "mdast-util-from-markdown";
import type { ListItem, Nodes, Paragraph, RootContent } from "mdast";
import { splitCommandTokens, tokensOnOwnLine, withoutCommandTokens } from "./command-token.js";
import { withoutWebLinks } from "./urls.js";

/**
 * Nodes whose text is never a citation, because the renderer never chips inside
 * one.
 *
 * A **link's label** is the model's words for a destination, and a chip in it
 * would put a second, differently-behaved thing inside something the reader is
 * about to press. An **image's** alt text is drawn as its own source characters
 * and never rendered as an image at all. Both carry `text` children, which is
 * why they need naming: everything else that must not count — `inlineCode`, a
 * fenced `code` block, an `html` node, a `definition` — carries a `value` and no
 * children, so it is skipped by simply never being copied.
 */
const OPAQUE = new Set(["link", "linkReference", "image", "imageReference"]);

/**
 * **How many blocks deep the renderer reads structure** — a quote inside a list
 * inside a quote — before it draws the rest as its own characters, chips and
 * all (src/web/Cited.tsx § `drawBlock`, which has why there is a cap at all).
 *
 * The one copy, imported by the renderer. It counts **block nesting as the
 * renderer nests**, which is not levels of the tree:
 *
 *  - a quote's contents are one deeper than the quote;
 *  - a list item's contents are one deeper than the list, **unless** the item
 *    is a single paragraph, which the renderer draws in place (`drawList`);
 *  - a paragraph, a heading, `strong` and `emphasis` are no deeper at all.
 *
 * Until 2026-10-06 each side had its own `MAX_DEPTH = 12` and a comment saying
 * the other was kept in step. They were equal and still disagreed, because the
 * walk here counted every level of the tree: eleven quotes deep, or six lists,
 * the reader was shown a chip the log never counted. Equal constants cannot
 * hold two walks together; `tests/chat-markdown-render.test.tsx` § agrees at the
 * depth cap does, by painting each shape and counting the chips.
 */
export const MAX_BLOCK_DEPTH = 12;

/**
 * The answer with everything uncitable blanked, character for character.
 *
 * **Spaces rather than deletion**, so every offset in the string is unchanged
 * and a caller can still say where in the answer it found something.
 */
export function citableText(answer: string): string {
  /* A command token (`[cmd:bookmark:spya-k3m9qt]`, src/command-token.ts) is
     lifted out of the link-free prose before the renderer looks for citations,
     so the block id inside is a button's argument and never a chip. */
  return withoutCommandTokens(linkFreeProse(answer));
}

/**
 * **The text a command-token shape can be found in**: ordinary text nodes, with
 * link labels, code and bare addresses blanked — `citableText` one step earlier,
 * before the tokens themselves are blanked. The renderer starts from these
 * nodes, then applies the structural rules this flat string cannot carry (own
 * line, and not inside a blockquote). The eval uses it to find attempts before
 * applying those rules (evals/chat-commands/run.ts).
 */
export function linkFreeProse(answer: string): string {
  const kept = new Array<string>(answer.length).fill(" ");
  const keep = (node: Nodes) => {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (from === undefined || to === undefined) return;
    for (let i = from; i < to && i < answer.length; i++) kept[i] = answer[i] ?? " ";
  };
  /* A list of work rather than a recursive walk. Block nesting stops at the cap
     below, but `strong` inside `emphasis` inside `strong` has no cap on either
     side, and a walk deep enough to overflow the stack would take the request
     with it. Order does not matter: every node writes only its own offsets. */
  const todo: { node: Nodes; opaque: boolean; depth: number }[] = [
    { node: fromMarkdown(answer), opaque: false, depth: 0 },
  ];
  for (let next = todo.pop(); next; next = todo.pop()) {
    const { node, opaque, depth } = next;
    /* Past the cap the renderer draws a block as its source and offers no chip
       in it, so counting one here would be counting what nobody was offered.
       `depth` moves exactly where the renderer's does — see MAX_BLOCK_DEPTH. */
    if (depth >= MAX_BLOCK_DEPTH) continue;
    if (node.type === "text") {
      if (!opaque) keep(node);
      continue;
    }
    if (!("children" in node)) continue;
    const inside = opaque || OPAQUE.has(node.type);
    const deeper =
      node.type === "blockquote" || (node.type === "listItem" && !isOneParagraph(node));
    for (const child of node.children) {
      todo.push({ node: child, opaque: inside, depth: deeper ? depth + 1 : depth });
    }
  }
  /* A bare address is not a citation either, and `webLinks` in src/urls.ts is
     the single matcher for that — the renderer runs it over exactly this text
     (src/web/Cited.tsx § leaf). No `remark-gfm`, so the parser leaves bare
     addresses in the text nodes for it to find. */
  return withoutWebLinks(kept.join(""));
}

/** A list item the renderer draws in place, without a level of its own (`drawList`). */
function isOneParagraph(item: ListItem): boolean {
  return item.children.length === 1 && item.children[0]?.type === "paragraph";
}

/**
 * **An answer without the lines that are only command buttons** — what *Copy
 * answer* writes to the clipboard (src/web/ChatPanel.tsx § `CopyAnswer`).
 *
 * The reader was shown a button there, not `[cmd:…]`, so the copy leaves the
 * line out, and one of the two blank lines that stood round it. The walk below
 * mirrors Cited.tsx's structural rules: a paragraph's direct text, including
 * one inside a list, but not a heading, nested mark, code block or blockquote.
 * `isButton` supplies its final, contextual `chipFor` gate — an invalid token
 * is text on screen and therefore text on the clipboard too.
 *
 * An answer with no button line comes back unchanged, byte for byte. Where a
 * line is removed, its neighbours keep their own line-ending spelling.
 */
export function withoutCommandLines(answer: string, isButton: (raw: string) => boolean): string {
  const byLine = commandTokensByLine(answer, isButton);
  if (![...byLine.values()].some((tokens) => tokens.some((token) => token.button))) return answer;
  const buttonLines = new Set(
    [...byLine].filter(([, tokens]) => tokens.every((token) => token.button)).map(([line]) => line - 1),
  );
  const lines = copyLines(answer);
  removeMixedButtonTokens(lines, byLine);
  const removed = linesBesideButtons(lines, buttonLines);
  let copied = lines.filter((_, i) => !removed.has(i)).map((line) => line.text).join("");
  if (removedAfterLastKept(lines, removed)) copied = copied.replace(/(?:\r\n|\r|\n)+$/, "");
  return copied;
}

interface SeenCommandToken {
  readonly raw: string;
  readonly button: boolean;
}

function commandTokensByLine(
  answer: string,
  isButton: (raw: string) => boolean,
): Map<number, SeenCommandToken[]> {
  const byLine = new Map<number, SeenCommandToken[]>();

  const paragraph = (node: Paragraph) => {
    const edge = (i: number): boolean => {
      const beside = node.children[i];
      return beside === undefined || beside.type === "break";
    };
    for (const [i, child] of node.children.entries()) {
      if (child.type !== "text") continue;
      const runs = splitCommandTokens(child.value);
      const ownLine = tokensOnOwnLine(runs, edge(i - 1), edge(i + 1));
      let token = 0;
      let at = 0;
      for (const run of runs) {
        if (run.kind === "token") {
          if (ownLine[token++] === true) {
            const before = child.value.slice(0, at);
            const line = (child.position?.start.line ?? 1) + [...before.matchAll(/\r\n|\r|\n/g)].length;
            const tokens = byLine.get(line) ?? [];
            tokens.push({ raw: run.raw, button: isButton(run.raw) });
            byLine.set(line, tokens);
          }
          at += run.raw.length;
        } else {
          at += run.text.length;
        }
      }
    }
  };

  const blocks = (nodes: readonly RootContent[], depth = 0) => {
    if (depth >= MAX_BLOCK_DEPTH) return;
    for (const node of nodes) {
      if (node.type === "paragraph") {
        paragraph(node);
      } else if (node.type === "list") {
        for (const item of node.children) {
          const only = item.children.length === 1 ? item.children[0] : undefined;
          if (only?.type === "paragraph") paragraph(only);
          else blocks(item.children, depth + 1);
        }
      }
      /* A blockquote deliberately receives no command executor in Cited.tsx.
         Heading, code and every source fallback likewise contain no buttons. */
    }
  };
  blocks(fromMarkdown(answer).children);
  return byLine;
}

interface CopyLine {
  text: string;
  readonly content: string;
}

function copyLines(answer: string): CopyLine[] {
  const lines: CopyLine[] = [];
  for (const match of answer.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    const text = match[0];
    if (text === "" && match.index === answer.length) break;
    lines.push({ text, content: text.replace(/(?:\r\n|\r|\n)$/, "") });
  }
  return lines;
}

/* A line may contain several tokens. If some are buttons and some are text,
   remove only the literal button spans: dropping the line would lose prose,
   while keeping it would copy syntax the reader never saw. An escaped or
   entity-encoded token has no literal span to remove. That line is known to
   contain only tokens and whitespace after its optional list marker, so in
   that case reconstruct the visible invalid tokens rather than leak the
   encoded button or guess at source offsets. */
function removeMixedButtonTokens(lines: CopyLine[], byLine: ReadonlyMap<number, SeenCommandToken[]>): void {
  for (const [lineNumber, tokens] of byLine) {
    if (tokens.every((token) => token.button) || tokens.every((token) => !token.button)) continue;
    const line = lines[lineNumber - 1];
    if (!line) continue;
    let cursor = 0;
    const ranges: { from: number; to: number }[] = [];
    let foundAll = true;
    for (const token of tokens) {
      const from = line.content.indexOf(token.raw, cursor);
      if (from === -1) {
        foundAll = false;
        break;
      }
      const to = from + token.raw.length;
      if (token.button) ranges.push({ from, to });
      cursor = to;
    }
    const ending = line.text.slice(line.content.length);
    if (!foundAll) {
      const prefix = /^[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?/.exec(line.content)?.[0] ?? "";
      line.text = `${prefix}${tokens.filter((token) => !token.button).map((token) => token.raw).join(" ")}${ending}`;
      continue;
    }
    let content = line.content;
    for (const range of ranges.reverse()) content = content.slice(0, range.from) + content.slice(range.to);
    line.text = content + ending;
  }
}

/* Treat adjacent button lines as one run, then take at most one blank line
   beside the run. That is the paragraph gap the buttons occupied, not prose. */
function linesBesideButtons(lines: readonly CopyLine[], buttonLines: ReadonlySet<number>): Set<number> {
  const removed = new Set(buttonLines);
  const ordered = [...buttonLines].sort((a, b) => a - b);
  for (let p = 0; p < ordered.length; ) {
    const first = ordered[p] ?? 0;
    let last = first;
    while (ordered[p + 1] === last + 1) last = ordered[++p] ?? last;
    const after = lines[last + 1];
    const before = lines[first - 1];
    if (after && after.content.trim() === "") removed.add(last + 1);
    else if (before && before.content.trim() === "") removed.add(first - 1);
    p++;
  }
  return removed;
}

function removedAfterLastKept(lines: readonly CopyLine[], removed: ReadonlySet<number>): boolean {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!removed.has(i)) return [...removed].some((removedLine) => removedLine > i);
  }
  return removed.size > 0;
}
