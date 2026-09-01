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
import type { Nodes } from "mdast";
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

/** Kept in step with `MAX_DEPTH` in src/web/Cited.tsx — see `citableText`. */
const MAX_DEPTH = 12;

/**
 * The answer with everything uncitable blanked, character for character.
 *
 * **Spaces rather than deletion**, so every offset in the string is unchanged
 * and a caller can still say where in the answer it found something.
 */
export function citableText(answer: string): string {
  const kept = new Array<string>(answer.length).fill(" ");
  const visit = (node: Nodes, opaque: boolean, depth: number) => {
    /* The same cap the renderer draws to (src/web/Cited.tsx § MAX_DEPTH), for
       the same two reasons: a walk deep enough to overflow the stack would take
       the request with it, and past that depth the renderer stops drawing chips,
       so counting them here would be counting what nobody was offered. */
    if (depth > MAX_DEPTH) return;
    if (node.type === "text" && !opaque) {
      const from = node.position?.start.offset;
      const to = node.position?.end.offset;
      if (from !== undefined && to !== undefined) {
        for (let i = from; i < to && i < answer.length; i++) kept[i] = answer[i] ?? " ";
      }
      return;
    }
    if ("children" in node) {
      const inside = opaque || OPAQUE.has(node.type);
      for (const child of node.children) visit(child, inside, depth + 1);
    }
  };
  visit(fromMarkdown(answer), false, 0);
  /* A bare address is not a citation either, and `webLinks` in src/urls.ts is
     the single matcher for that — the renderer runs it over exactly this text
     (src/web/Cited.tsx § leaf). No `remark-gfm`, so the parser leaves bare
     addresses in the text nodes for it to find. */
  return withoutWebLinks(kept.join(""));
}
