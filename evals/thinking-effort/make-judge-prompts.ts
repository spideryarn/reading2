/**
 * Fill judge-rank.md and judge-score.md for one mode — free, no model calls.
 *
 *   npx tsx evals/thinking-effort/make-judge-prompts.ts --results <dir> --mode sketch|illustrated|ideas|hierarchy
 *
 * Writes `<dir>/judging/<mode>/prompt-rank.md` and `prompt-score.md`. The prompt
 * files sit beside the lineups so the judgement can be reproduced from the
 * results directory alone.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_SLUGS } from "./arms.js";

const SECTION: Record<string, string> = {
  sketch: "Sketch — a model's drawing of the shape of the argument",
  illustrated: "Illustrated — the Sketch, painted (judged on the brief)",
  ideas: "Ideas — the propositions this piece needs you to hold",
  hierarchy: "Hierarchy — the tree Structure, the zoom and the gists all read",
};

const PICTURES: Record<string, string> = {
  sketch:
    "- Each candidate has a rendered picture (a PNG) at the path its lineup gives. **Look at it** —\n  the picture is what a reader sees; the scene JSON is its source, useful for checking block ids.",
  illustrated: "- There are no pictures: you judge the written brief an image model would paint from.",
  ideas: "- There are no pictures.",
  hierarchy: "- There are no pictures.",
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const results = path.resolve(argv[argv.indexOf("--results") + 1] ?? "");
  const mode = argv[argv.indexOf("--mode") + 1] ?? "";
  if (!SECTION[mode]) throw new Error(`unknown mode ${mode}`);
  const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
  const judging = path.join(results, "judging", mode);
  const rel = (p: string) => path.relative(repo, p);
  for (const kind of ["rank", "score"] as const) {
    const template = await readFile(path.join(repo, "evals", "thinking-effort", `judge-${kind}.md`), "utf-8");
    const abs = kind === "score";
    const filled = template
      .replaceAll("{MODE}", mode)
      .replaceAll("{RUBRIC_SECTION}", SECTION[mode] as string)
      .replaceAll("{JUDGING_DIR}", abs ? judging : rel(judging))
      .replaceAll("{RESULTS_DIR}", abs ? results : rel(results))
      .replaceAll("{REPO}", repo)
      .replaceAll("{PICTURE_NOTE}", PICTURES[mode] as string)
      .replaceAll("{SLUGS}", DEFAULT_SLUGS.map((s) => `\`${s}\``).join(", "))
      .replaceAll("{ANSWER_FILE}", path.join(judging, "verdict-score.json"));
    await writeFile(path.join(judging, `prompt-${kind}.md`), filled);
    console.log(`wrote ${rel(path.join(judging, `prompt-${kind}.md`))}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
