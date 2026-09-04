/**
 * **Throwaway spike for docs/plans/260904d-deepen-fat-sections.md stage 1.**
 *
 * The structure call only — no labels. The question is "what do a book's
 * sections look like", and the label pass is a batched second stage that costs
 * many times more and answers nothing about it.
 *
 * Delete this once the plan's stage 1 has its table. It is in `scripts/` rather
 * than the scratchpad only because it needs the repo's own module graph.
 *
 * Usage: npx tsx scripts/spike-book-structure.ts <blocks.json> <out.json>
 */
import { readFile, writeFile } from "node:fs/promises";

import type Anthropic from "@anthropic-ai/sdk";

import { buildTree, structureRequest, type BuildReport } from "../src/hierarchy.js";
import { loadEnvLocal } from "../src/env.js";
import { streamMessage } from "../src/messages-stream.js";
import { parseJsonAnswer, parseJsonFrom } from "../src/parse-json.js";
import { splitBlocks } from "../src/supplement.js";
import type { Block } from "../src/types.js";
import type { ModelNode } from "../src/hierarchy.js";

async function main(): Promise<void> {
  const [, , blocksPath, outPath] = process.argv;
  if (!blocksPath || !outPath) {
    console.error("Usage: npx tsx scripts/spike-book-structure.ts <blocks.json> <out.json>");
    process.exit(1);
  }
  loadEnvLocal();
  const { blocks } = parseJsonFrom<{ blocks: Block[] }>(
    await readFile(blocksPath, "utf-8"),
    "blocks.json",
  );
  const { body, groups } = splitBlocks(blocks);
  console.log(
    `${blocks.length} blocks (${body.length} body, ${groups.length} supplement group(s))`,
  );

  const { maxTokens, params } = structureRequest(body);
  console.log(`max_tokens = ${maxTokens.toLocaleString()}`);

  /* The prompt experiment: two of the five fat sections in the corpus carry no
     authored heading, so the model invented that boundary and then declined to
     split it. `SPIKE_SYSTEM_FILE` swaps the system prompt for the run without
     touching `SYSTEM` in src/hierarchy.ts — which is pinned verbatim by
     tests/hierarchy-structure-request-parity.test.ts, and should stay pinned
     until an experiment says what to change it to. */
  const override = process.env["SPIKE_SYSTEM_FILE"];
  if (override) {
    params.system = await readFile(override, "utf-8");
    console.log(`system prompt overridden from ${override}`);
  }

  const started = Date.now();
  let chars = 0;
  let last = 0;
  const call = streamMessage("hierarchy", params);
  call.onText((delta) => {
    chars += delta.length;
    const now = Date.now();
    if (now - last < 5000) return;
    last = now;
    process.stdout.write(
      `\r  ${Math.round(chars / 1000)}k chars, ${Math.round((now - started) / 1000)}s   `,
    );
  });
  const message: Anthropic.Message = await call.finalMessage();
  const elapsed = Math.round((Date.now() - started) / 1000);
  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  console.log(
    `\nstop_reason=${message.stop_reason} in=${message.usage.input_tokens} ` +
      `out=${message.usage.output_tokens} elapsed=${elapsed}s`,
  );

  const { root } = parseJsonAnswer<{ root: ModelNode }>(raw, "the table of contents");
  const report: BuildReport = { repairs: [], droppedChildren: [], droppedHeadings: [] };
  const tree = buildTree(root, {}, body, "spike", report);
  console.log(
    `tree: ${Object.keys(tree.nodes).length} nodes, ${report.repairs.length} repair(s), ` +
      `${report.droppedChildren.length} dropped`,
  );
  await writeFile(
    outPath,
    JSON.stringify({ elapsed, usage: message.usage, stop: message.stop_reason, raw, tree }, null, 2),
    "utf-8",
  );
  console.log(`wrote ${outPath}`);
}

void main();
