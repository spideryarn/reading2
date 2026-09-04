/**
 * **Throwaway spike for docs/plans/260904d-deepen-fat-sections.md stage 2.**
 *
 * One scoped expansion call: a single section of a book, its ancestor chain and
 * the frozen global outline, asked for one level of children — and a verdict per
 * child about whether that child still needs a level of its own.
 *
 * The questions it exists to answer are in the plan: are the boundaries and
 * titles as good as the whole-document call's, and does the self-assessment
 * discriminate or does it say "deeper" to everything.
 *
 * Delete this once stage 2 has its answer.
 *
 * Usage:
 *   npx tsx scripts/spike-expand-section.ts <structure.json> <blocks.json> <rank> <out.json>
 *
 * `rank` is 0 for the fattest section by words, 1 for the next, and so on.
 */
import { readFile, writeFile } from "node:fs/promises";

import type Anthropic from "@anthropic-ai/sdk";

import { loadEnvLocal } from "../src/env.js";
import { PRODUCTION_EFFORT } from "../src/hierarchy.js";
import { streamMessage } from "../src/messages-stream.js";
import { parseJsonAnswer, parseJsonFrom } from "../src/parse-json.js";
import type { Block, Tree, TreeNode } from "../src/types.js";

/**
 * The scoped prompt. Deliberately close to `SYSTEM` in src/hierarchy.ts — same
 * boundary rules, same title and gist contract — with three differences that
 * are the whole point of the experiment:
 *
 * 1. **Starts only.** The parent's range is fixed and every end is derived by
 *    `normaliseExpansion`, so an end is a second statement of a boundary and a
 *    second chance to disagree with yourself.
 * 2. **One level.** The wave decides what happens next, not this call.
 * 3. **A verdict per child.** The instrument this plan is testing.
 */
const EXPAND_SYSTEM = `You are extending a nested table of contents for one section of a longer
work. The section's boundaries and title are already fixed. Your job is to
divide it into its immediate children — one level, no deeper.

You are shown the whole work's top-level outline for context, the chain of
titles above this section, and the section's own blocks as a numbered list.
Each block has an id (e.g. spya-k3m9qt), a tag, and its text. Some are marked
NOT-GISTABLE.

RULES

- Give each child the id of the block it STARTS at. Do not give an end — ends
  are computed from the next child's start, and the last child ends where the
  section ends.
- The first child must start at the section's first block.
- The article's own headings are HARD boundaries. A child must begin at a
  heading block wherever one exists inside this section. Never merge across a
  heading.
- Aim for 5-9 children so the level is an even stride. Fewer only if the
  section genuinely has fewer parts.
- Do NOT go deeper than one level. Do not emit grandchildren.

TITLES AND GISTS

- title: 2-6 words, a landmark scanned at a glance. Where the author gave the
  child a heading, use that heading's text UNCHANGED and repeat it in
  "sourceHeading". Rewrite it ONLY if it shares no content word with the body,
  or is a stock label ("Introduction", "Background"). Rewriting should be rare.
- gist: exactly ONE sentence, a CLAIM or a MOVE rather than a topic label.
  Keep the work's own words for the things it names and ordinary words for
  everything else.
- Your titles must distinguish these children from EACH OTHER and from the
  sibling sections in the outline above. Four children that all mean
  "Background" is the failure to avoid.

THE VERDICT

For each child, say whether it is finished or still wants a level of its own:

- "needsDeeper": true only when the child holds several distinct movements a
  reader would want to navigate between — not merely because it is long. A
  child that is one sustained argument is finished however many paragraphs it
  runs to.
- "why": at most 12 words, the reason.

Most children of most sections are finished. A section where every child needs
deepening is a section you have not really divided.

OUTPUT

JSON only, no prose, no code fence:

{"children": [{"start": "<blockId>", "title": "...", "gist": "...",
               "sourceHeading": "...", "needsDeeper": false, "why": "..."}]}

Use only block ids that appear in the section's blocks. Do not invent ids.`;

interface SpikeChild {
  start: string;
  title: string;
  gist?: string;
  sourceHeading?: string;
  needsDeeper?: boolean;
  why?: string;
}

function renderForSpike(blocks: Block[]): string {
  return blocks
    .map((b, i) => `[${i}] ${b.id} <${b.tag}>${b.gistable ? "" : " NOT-GISTABLE"}: ${b.text}`)
    .join("\n\n");
}

function ancestors(tree: Tree, node: TreeNode): TreeNode[] {
  const chain: TreeNode[] = [];
  let at = node.parent ? tree.nodes[node.parent] : undefined;
  while (at) {
    chain.unshift(at);
    at = at.parent ? tree.nodes[at.parent] : undefined;
  }
  return chain;
}

async function main(): Promise<void> {
  const [, , structPath, blocksPath, rankArg, outPath] = process.argv;
  if (!structPath || !blocksPath || !rankArg || !outPath) {
    console.error(
      "Usage: npx tsx scripts/spike-expand-section.ts <structure.json> <blocks.json> <rank> <out.json>",
    );
    process.exit(1);
  }
  loadEnvLocal();
  const { tree } = parseJsonFrom<{ tree: Tree }>(await readFile(structPath, "utf-8"), "structure");
  const { blocks } = parseJsonFrom<{ blocks: Block[] }>(
    await readFile(blocksPath, "utf-8"),
    "blocks.json",
  );
  const index = new Map(blocks.map((b, i) => [b.id, i]));
  const words = blocks.map((b) => b.text.trim().split(/\s+/).filter(Boolean).length);

  const kids = (n: TreeNode): string[] => n.children;
  const sections = Object.values(tree.nodes).filter(
    (n) =>
      n.treatment !== "supplement" &&
      kids(n).length > 0 &&
      kids(n).every((c) => (tree.nodes[c]?.children ?? []).length === 0),
  );
  const ranked = sections
    .map((n) => {
      const a = index.get(n.range[0]) ?? 0;
      const z = index.get(n.range[1]) ?? 0;
      return { node: n, a, z, nw: words.slice(a, z + 1).reduce((p, q) => p + q, 0) };
    })
    .sort((p, q) => q.nw - p.nw);
  const target = ranked[Number(rankArg)];
  if (!target) throw new Error(`no section at rank ${rankArg} (there are ${ranked.length})`);

  const slice = blocks.slice(target.a, target.z + 1);
  console.log(
    `expanding "${target.node.title}" — ${slice.length} blocks, ${target.nw.toLocaleString()} words`,
  );

  const outline = tree.nodes[tree.rootId]!.children
    .map((id) => tree.nodes[id])
    .filter((n): n is TreeNode => n !== undefined)
    .map((n, i) => `${i + 1}. ${n.title}${n.gist ? ` — ${n.gist}` : ""}`)
    .join("\n");
  const chain = ancestors(tree, target.node)
    .map((n) => `${n.title}${n.gist ? ` — ${n.gist}` : ""}`)
    .join("\n  ↳ ");

  const user =
    `THE WHOLE WORK'S TOP-LEVEL OUTLINE\n\n${outline}\n\n` +
    `THE CHAIN ABOVE THIS SECTION\n\n  ${chain}\n  ↳ ${target.node.title}` +
    `${target.node.gist ? ` — ${target.node.gist}` : ""}\n\n` +
    `THE SECTION'S BLOCKS\n\n${renderForSpike(slice)}`;

  const started = Date.now();
  const call = streamMessage("hierarchy", {
    max_tokens: 16_000,
    thinking: { type: "adaptive" },
    output_config: { effort: PRODUCTION_EFFORT },
    system: EXPAND_SYSTEM,
    messages: [{ role: "user", content: user }],
  });
  const message: Anthropic.Message = await call.finalMessage();
  const elapsed = Math.round((Date.now() - started) / 1000);
  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  // Saved before anything parses it — see spike-book-structure.ts for why.
  await writeFile(
    outPath,
    JSON.stringify(
      {
        section: { title: target.node.title, blocks: slice.length, words: target.nw },
        elapsed,
        usage: message.usage,
        stop: message.stop_reason,
        raw,
      },
      null,
      2,
    ),
    "utf-8",
  );

  console.log(
    `stop=${message.stop_reason} in=${message.usage.input_tokens} out=${message.usage.output_tokens} elapsed=${elapsed}s`,
  );

  const { children } = parseJsonAnswer<{ children: SpikeChild[] }>(raw, "the expansion");
  const bad = children.filter((c) => !index.has(c.start)).length;
  const outside = children.filter((c) => {
    const at = index.get(c.start);
    return at !== undefined && (at < target.a || at > target.z);
  }).length;
  const deeper = children.filter((c) => c.needsDeeper).length;
  console.log(
    `\n${children.length} children — ${bad} invented id(s), ${outside} outside the section, ` +
      `${deeper} marked needsDeeper`,
  );
  /* A child's span is the distance to the NEXT child's start — the ends are
     derived, so a child's own size is not knowable until its successor is read.
     The first version of this printed the distance from the previous start on
     the current row, which labels every span with the wrong child. */
  const starts = children.map((c) => index.get(c.start));
  let prev = target.a - 1;
  children.forEach((c, i) => {
    const at = starts[i];
    const order = at === undefined ? "??" : at <= prev ? "OUT-OF-ORDER" : "ok";
    if (at !== undefined) prev = at;
    const next = starts[i + 1] ?? target.z + 1;
    const span = at === undefined || next === undefined ? 0 : next - at;
    const nw = at === undefined ? 0 : words.slice(at, at + span).reduce((p, q) => p + q, 0);
    console.log(
      `  ${c.needsDeeper ? "▼" : "·"} [${String(at ?? "?").padStart(4)}] ${order === "ok" ? "" : order + " "}` +
        `${c.sourceHeading ? "§ " : "  "}${c.title.padEnd(42)} ${String(span).padStart(3)}b ${String(nw).padStart(6)}w`,
    );
    if (c.why) console.log(`      why: ${c.why}`);
  });
}

void main();
