/**
 * Blinded judging materials for the finalist trees — the primary outcome's
 * input, since every mechanical measure in score.ts can be won by a worse arm
 * (the phase-2 review has the table).
 *
 *   npx tsx evals/hierarchy-structure/blind.ts data/scaling-hypothesis \
 *     evals/results/hierarchy-structure/<run>/trees/incumbent.scaling-hypothesis.json \
 *     evals/results/hierarchy-structure/<run>/trees/cheap-high.scaling-hypothesis.json \
 *     --out /tmp/judging
 *
 * **The judge is a model, not Greg — his call, 2026-08-30 — with a budget of
 * about ten comparisons**, spent where arms disagree (the hard documents are
 * worth more than four easy ones where every arm concurs). The known weakness
 * is stated in evals/README.md rather than here alone: a model judging model
 * output tends to prefer writing that resembles its own, so the standing rule
 * is that a judge who cannot separate the arms by more than the noise floor
 * yields to latency, cost and simplicity — that is a result, not a failure.
 *
 * What this file does about the weakness:
 * - **Arm zero is always in the lineup**, added here rather than by the
 *   caller so it cannot be forgotten: the free heading tree is a non-model
 *   anchor, and a judge that ranks it above a paid arm is saying something no
 *   style preference explains.
 * - **Labels are shuffled per document** (Fisher-Yates — the same reasoning
 *   as evals/hierarchy-labels.ts § printShuffled: a sort-comparator shuffle leaks
 *   positional bias) and the mapping goes to a separate key file the judge
 *   prompt never contains.
 *
 * This emits materials only. The judge call itself is a paid call and follows
 * the phase-2 rules like any other.
 */

import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isBody } from "../../src/block-policy.js";
import { isMain } from "../../src/is-main.js";
import { parseJsonFrom } from "../../src/parse-json.js";
import { supplementIndex } from "../../src/supplement.js";
import type { Block, Tree, TreeNode } from "../../src/types.js";
import { buildHeadingTree } from "../../src/heading-tree.js";

interface Lineup {
  label: string;
  source: string; // file path, or "headings (built in place)" for arm zero
  tree: Tree;
}

/** One tree, rendered for judging: L1 outline plus sampled deep gists. */
export function renderForJudging(blocks: Block[], tree: Tree, label: string): string {
  const index = new Map(blocks.map((b, i) => [b.id, i]));
  const supplement = supplementIndex(tree);
  const root = tree.nodes[tree.rootId];
  const firstSentence = (startId: string): string => {
    const at = index.get(startId) ?? 0;
    for (let i = at; i < blocks.length; i++) {
      const b = blocks[i]!;
      if (isBody(b) && b.kind !== "heading" && b.text.trim()) {
        return `${b.text.split(/(?<=[.!?])\s/)[0] ?? b.text.slice(0, 160)}`;
      }
    }
    return "";
  };

  const lines: string[] = [`## Tree ${label}`, ""];
  const parts = (root?.children ?? [])
    .map((id) => tree.nodes[id])
    .filter((n): n is TreeNode => !!n && n.children.length > 0 && !supplement.has(n.id));
  /* Said out loud, not left blank: a flat tree is a real candidate (arm zero
     on an article whose headings carry no structure), and an empty section
     under its label would read as a rendering fault rather than as its answer. */
  if (parts.length === 0) {
    lines.push(
      "This tree proposes NO sections: one flat list of paragraphs under the title, with no " +
        "intermediate structure to navigate by.",
    );
  }
  for (const [i, part] of parts.entries()) {
    lines.push(`${i + 1}. **${part.title || "(untitled)"}**`);
    lines.push(`   gist: ${part.gist ?? "(none — this tree writes no gists)"}`);
    lines.push(`   opens: "${firstSentence(part.range[0])}"`);
  }

  /* A few deep gists beside the prose they compress — sampled, because
     judging every node is what makes a rubric too big to ever run. */
  const deep = Object.values(tree.nodes).filter(
    (n) => n.children.length > 0 && n.depth >= 2 && n.gist && !supplement.has(n.id),
  );
  const sampled: TreeNode[] = [];
  const pool = [...deep];
  while (sampled.length < 3 && pool.length > 0) {
    sampled.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]!);
  }
  if (sampled.length > 0) {
    lines.push("", "Sampled deeper gists, each beside the prose it stands in for:");
    for (const node of sampled) {
      const lo = index.get(node.range[0]) ?? 0;
      const hi = index.get(node.range[1]) ?? lo;
      const prose = blocks
        .slice(lo, hi + 1)
        .filter((b) => isBody(b))
        .map((b) => b.text)
        .join(" ")
        .slice(0, 400);
      lines.push(`- gist: ${node.gist}`, `  prose: "${prose}…"`);
    }
  }
  return lines.join("\n");
}

const QUESTIONS = `Answer in JSON only, no prose outside it:

{
  "ranking": ["<best label>", "…", "<worst label>"],
  "unusable": ["<labels whose tree you would not navigate by at all>"],
  "boundaryFaults": { "<label>": ["<a boundary that cuts an argument mid-thought, or welds two unrelated ones — quote the two titles it sits between>"] },
  "missingCuts": ["<a cut the article needed that no tree here makes — or leave empty>"],
  "titles": { "<label>": "names" | "generic" },
  "gists": { "<label>": "claims" | "topic-labels" | "invented" | "none" }
}

Rank by ONE question: reading this article for the first time with the tree as
your only map, which carving would you actually navigate by? Boundaries first,
titles second, gists third. A tree with no gists can still win on boundaries —
say so in the ranking and "none" in gists rather than marking it down twice.`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outIx = args.indexOf("--out");
  const outDir = outIx >= 0 ? args[outIx + 1]! : ".";
  const positional = args.filter((a, i) => !a.startsWith("--") && i !== outIx + 1);
  const [articleDir, ...treeFiles] = positional;
  if (!articleDir) {
    console.error(
      "Usage: tsx evals/hierarchy-structure/blind.ts <article-dir> <tree.json>… [--out <dir>]\n" +
        "Arm zero (the free heading tree) is always added to the lineup here — do not pass it.",
    );
    process.exit(1);
  }

  const { blocks } = parseJsonFrom<{ blocks: Block[] }>(
    await readFile(path.join(articleDir, "blocks.json"), "utf-8"),
    "blocks.json",
  );
  const meta = await readFile(path.join(articleDir, "meta.json"), "utf-8").then(
    (raw) => parseJsonFrom<{ title?: string }>(raw, "meta.json"),
    () => ({ title: undefined }),
  );
  const slug = path.basename(articleDir);

  const lineup: Lineup[] = [
    {
      label: "",
      source: "headings (built in place)",
      tree: buildHeadingTree(blocks, slug, meta.title).tree,
    },
  ];
  for (const file of treeFiles) {
    lineup.push({
      label: "",
      source: file,
      tree: parseJsonFrom<Tree>(await readFile(file, "utf-8"), file),
    });
  }

  /* Fisher-Yates, then labels in the shuffled order — so label A says nothing
     about which file came first on the command line. */
  for (let i = lineup.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [lineup[i], lineup[j]] = [lineup[j]!, lineup[i]!];
  }
  lineup.forEach((entry, i) => {
    entry.label = String.fromCharCode(65 + i);
  });

  const prompt = [
    `# Which table of contents serves this article best?`,
    "",
    `The article is "${meta.title ?? slug}" (${blocks.length} blocks). Below are ` +
      `${lineup.length} candidate tables of contents for it, labelled ${lineup
        .map((l) => l.label)
        .join(", ")}. You do not know how any of them was produced.`,
    "",
    ...lineup.map((entry) => renderForJudging(blocks, entry.tree, entry.label)),
    "",
    QUESTIONS,
  ].join("\n\n");

  await mkdir(outDir, { recursive: true });
  const promptFile = path.join(outDir, `judging-${slug}.md`);
  const keyFile = path.join(outDir, `key-${slug}.json`);
  await writeFile(promptFile, `${prompt}\n`, "utf-8");
  await writeFile(
    keyFile,
    `${JSON.stringify(
      Object.fromEntries(lineup.map((l) => [l.label, l.source])),
      null,
      2,
    )}\n`,
    "utf-8",
  );
  console.log(`Wrote ${promptFile}`);
  console.log(`Key (never shown to the judge): ${keyFile}`);
}

if (isMain(import.meta.url)) {
  await main();
}
