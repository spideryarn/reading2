/**
 * Pipeline stage 5b — the **arc**: one article-level sentence per part, saying
 * where the argument stands there. See docs/project/granularity-zoom.md#the-arc.
 *
 *   npm run arc -- data/noema-mythology-of-conscious-ai
 *
 * Why this exists. The L0 column used to render the root node, and a tree has
 * one root, so the column was a single cell: a constant along an axis whose
 * whole meaning is "this changes as you move down the article". It cost a
 * column's width and told you nothing you hadn't read in the masthead.
 *
 * The arc is the one kind of content that is genuinely *article-level* and
 * still varies vertically. An L1 gist says what this part says, in the part's
 * own terms. An arc sentence says what the piece has established by the time
 * you reach it and what it still owes you — a claim about the whole, written
 * from a position in it.
 *
 * **A separate artefact, not a field on the tree.** `tree.json` is stage 4's
 * (architecture.md#stage-ownership) and a re-run of `npm run toc` rewrites it
 * wholesale, which would silently drop anything we had merged in. So the arc
 * lives in its own `arc.json` and is joined back on at load time — by block
 * range, never by node id, because node ids are positional and a re-run
 * renumbers them. An entry whose range no longer matches a part is *dropped*
 * rather than attached to whichever part now sits at that index: a stale arc
 * line beside the wrong part is a lie the reader has no way to detect, and an
 * empty cell is one they do.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Arc, ArcEntry, Block, Tree, TreeNode } from "./types.js";

const MODEL = "claude-opus-5";
const PROMPT_VERSION = "arc/2";

const SYSTEM = `You are writing the leftmost, coarsest column of a reading view for a long
article. The reader sees, side by side: your column, then a one-sentence gist
per PART, then one per SECTION, then the full text.

Your column is the ARC. One sentence per part, in order. It is the only column
written from the point of view of the WHOLE PIECE.

WHAT AN ARC SENTENCE IS

Where the argument stands as this part opens: what the piece has established so
far, and what it still owes the reader. It is a claim about the whole article,
made from a position inside it.

  part gist (the next column): "Feeling is metabolic, not computational."
  arc  (yours):                "Intelligence has been cut loose from
                                consciousness; what remains is to say what
                                consciousness is made of."

RULES

- Exactly ONE sentence per part. Same number of sentences as there are parts,
  in the same order. No numbering, no part titles.
- NEVER restate the part's own gist. That sentence is already on screen an inch
  to the right, and two columns saying the same thing is why this column exists
  at all. If your sentence would still make sense with the rest of the article
  deleted, it is a gist and it is wrong.
- Every sentence must be RELATIONAL: it names something settled earlier, or
  something still unresolved, or the turn between them. Words like "having",
  "with", "what remains", "still", "now that", "before" earn their place here.
- NEVER make the article the subject. No "the piece", "the article", "the
  argument", "the essay", "the author", "this section". Those words spend a
  clause saying that you are summarising something, which the reader can see.
  Write the state of the argument directly, in the article's own terms.
    bad:  "The piece opens by asking whether machines could be conscious."
    good: "Whether machines could be conscious is still open, and their moral
           status turns on the answer."
    bad:  "Having shown brains are not Turing machines, the argument turns to
           the substrate."
    good: "Brains are not Turing machines; what is left is to say what the
           substrate must be."
- The first part's sentence says what is at stake and unsettled. The last
  part's says what has been settled and what deliberately has not.
- Use the author's own distinctive vocabulary. Those words are the reader's
  handholds.
- No empty meta-narration: never "this section explores", "the author then
  turns to", "we are told that", "then", "next", "goes on to". Naming the state
  of the argument is the job; narrating the prose is not.
- Every word must carry content. Cut any opening clause that only announces
  that a summary is coming.
- Say what the ARTICLE argues, not what a reader should feel. No advice.

OUTPUT

JSON only, no prose, no code fence:

{"arc": ["...", "...", ...]}

Exactly one string per part, in order.`;

/** The parts — depth-1 nodes in document order, per the tree's own child list. */
export function partsOf(tree: Tree): TreeNode[] {
  const root = tree.nodes[tree.rootId];
  if (!root) throw new Error(`rootId "${tree.rootId}" is not in nodes`);
  return root.children.map((id) => tree.nodes[id]).filter((n): n is TreeNode => !!n);
}

/**
 * The article as a skeleton plus its full text.
 *
 * Both, deliberately. The skeleton is what makes relational writing possible —
 * you cannot say "what remains" without seeing what comes after — and the full
 * text is what keeps the sentences in the author's own words rather than in a
 * summary of a summary.
 */
function renderPrompt(tree: Tree, blocks: Block[]): string {
  const parts = partsOf(tree);
  const skeleton = parts
    .map((p, i) => {
      const subs = p.children
        .map((id) => tree.nodes[id])
        .filter((c): c is TreeNode => !!c && !!c.gist)
        .map((c) => `      - ${c.title}: ${c.gist}`)
        .join("\n");
      return `PART ${i + 1}: ${p.title}\n  gist: ${p.gist ?? "(none)"}\n${subs}`;
    })
    .join("\n\n");

  const text = blocks.map((b) => b.text).filter(Boolean).join("\n\n");

  return `The article has ${parts.length} parts. Write ${parts.length} arc sentences.

=== STRUCTURE ===

${skeleton}

=== FULL TEXT ===

${text}`;
}

/**
 * Pair the model's sentences with the parts they belong to.
 *
 * A length mismatch throws rather than zipping as far as it can. Zipping would
 * put every sentence after the missing one against the wrong part, and each of
 * those cells would still look perfectly plausible — the failure would only be
 * visible to someone who read the article closely enough not to need the
 * column.
 */
export function buildArc(
  sentences: string[],
  tree: Tree,
  slug: string,
): Arc {
  const parts = partsOf(tree);
  if (sentences.length !== parts.length) {
    throw new Error(
      `Model returned ${sentences.length} arc sentences for ${parts.length} parts. ` +
        `Refusing to guess which part each belongs to.`,
    );
  }
  const entries: ArcEntry[] = parts.map((p, i) => ({
    range: p.range,
    // In range because the lengths were checked equal immediately above; that
    // check is the whole reason this function refuses to guess.
    text: sentences[i]!.trim(),
  }));
  return { version: PROMPT_VERSION, generator: MODEL, slug, entries };
}

/** Strip a stray code fence if the model wraps its JSON despite instructions. */
function parseJson(raw: string): { arc: string[] } {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  return JSON.parse(text);
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: tsx src/arc.ts <dir with blocks.json + tree.json>");
    process.exit(1);
  }
  const { blocks } = JSON.parse(
    await readFile(path.join(dir, "blocks.json"), "utf-8"),
  ) as { blocks: Block[] };
  const tree = JSON.parse(await readFile(path.join(dir, "tree.json"), "utf-8")) as Tree;
  const parts = partsOf(tree);

  console.log(`${parts.length} parts, ${blocks.length} blocks → ${MODEL}`);
  const started = Date.now();

  const client = new Anthropic();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system: SYSTEM,
    messages: [{ role: "user", content: renderPrompt(tree, blocks) }],
  });

  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") {
    throw new Error(`Model refused: ${JSON.stringify(message.stop_details)}`);
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("Hit max_tokens — the JSON is truncated. Raise it and retry.");
  }

  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const arc = buildArc(parseJson(raw).arc, tree, tree.slug);
  const outFile = path.join(dir, "arc.json");
  await writeFile(outFile, JSON.stringify(arc, null, 2), "utf-8");

  const u = message.usage;
  console.log(`\nTokens:    ${u.input_tokens} in, ${u.output_tokens} out`);
  console.log(`Elapsed:   ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`Wrote:     ${path.resolve(outFile)}\n`);
  arc.entries.forEach((e, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${parts[i]?.title ?? ""}\n    ${e.text}\n`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
