/**
 * **Blind judging materials for the thinking-effort eval** (plan 261001p).
 * Free: it reads what run.ts (or the Hierarchy harness) wrote and spends
 * nothing.
 *
 *   npx tsx evals/thinking-effort/lineup.ts --results <dir> --mode sketch
 *   npx tsx evals/thinking-effort/lineup.ts --results <dir> --mode hierarchy --hierarchy-run evals/results/hierarchy-structure/<run>
 *
 * Per article, ONE lineup of every arm's output under shuffled labels (W, X,
 * Y, Z for four) — GPT Sol's review, F8: a lineup ranked with ties, not three
 * pairs that each repeat the same base output and so make it recognisable.
 * The shape is evals/hierarchy-structure/blind.ts's.
 *
 * Written under `<results>/judging/<mode>/`:
 *
 * - `article-<slug>.md` — the article, with block ids, rendered the way the
 *   generators were shown it (`articleWithIds` over the body evidence).
 * - `lineup-<slug>.md` — the candidates, each rendered readably: Sketch as the
 *   PNG's path plus its scene JSON; Ideas as their JSON with each occurrence's
 *   block text resolved beside its id; Illustrated as its brief; Hierarchy
 *   through blind.ts's `renderForJudging`.
 * - `keys/key-<slug>.json` — label → arm. **Never shown to a judge**, which is
 *   why it is in its own directory: point a judge at `judging/<mode>/*.md`.
 * - `keys/seed.json` — the seed every shuffle came from.
 *
 * Labels are drawn by Fisher-Yates from one recorded seed, salted per
 * (mode, article), so each article gets a fresh order and every order can be
 * reproduced. Provenance fields a judge could read an arm off (`generator`,
 * hashes, `version`) are stripped from what is shown.
 */
import { randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { articleWithIds } from "../../src/article-prompt.js";
import { isBodyEvidence } from "../../src/block-policy.js";
import { isMain } from "../../src/is-main.js";
import type { Block, Idea, Meta, Tree } from "../../src/types.js";
import { renderForJudging } from "../hierarchy-structure/blind.js";
import { DEFAULT_ARMS, MODES, seededShuffle } from "./arms.js";
import { readRows } from "./run.js";

const JUDGED_MODES = [...MODES, "hierarchy"] as const;
type JudgedMode = (typeof JUDGED_MODES)[number];

/** The Hierarchy harness's four, in its own arm names. */
export const HIERARCHY_ARMS = ["incumbent", "incumbent-repeat", "smart-off", "smart-off-repeat"] as const;

/** W, X, Y, Z for four; onward from A when there are more than four. */
export function labelsFor(n: number): string[] {
  const start = n <= 4 ? "W".charCodeAt(0) : "A".charCodeAt(0);
  return Array.from({ length: n }, (_, i) => String.fromCharCode(start + i));
}

/** What a judge could read an arm off, removed from what is shown. */
const PROVENANCE = new Set(["version", "generator", "sourceHash", "profileHash", "slug", "promptVersion"]);

export function stripProvenance(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => !PROVENANCE.has(k)));
}

/** Each occurrence's block text beside its id, so a judge can check the quote. */
export function ideasForJudging(ideas: { ideas: Idea[] }, blocks: readonly Block[]): unknown {
  const text = new Map(blocks.map((b) => [b.id, b.text]));
  return ideas.ideas.map((idea) => ({
    ...idea,
    occurrences: idea.occurrences.map((o) => ({ ...o, blockText: text.get(o.blockId) ?? "(no such block)" })),
  }));
}

interface Options {
  results: string;
  mode: JudgedMode;
  hierarchyRun: string | null;
  arms: string[] | null;
  seed: number | null;
}

function parseArgs(argv: string[]): Options {
  let results = "";
  let mode = "";
  let hierarchyRun: string | null = null;
  let arms: string[] | null = null;
  let seed: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const next = (): string => {
      const v = argv[++i];
      if (!v) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--results") results = next();
    else if (a === "--mode") mode = next();
    else if (a === "--hierarchy-run") hierarchyRun = next();
    else if (a === "--arms") arms = next().split(",");
    else if (a === "--seed") seed = Number.parseInt(next(), 10);
    else throw new Error(`unknown argument ${a}`);
  }
  if (!results) throw new Error("--results <dir> is required: the directory run.ts wrote");
  if (!(JUDGED_MODES as readonly string[]).includes(mode)) throw new Error(`--mode must be one of ${JUDGED_MODES.join(", ")}`);
  if (mode === "hierarchy" && !hierarchyRun) throw new Error("--mode hierarchy needs --hierarchy-run <evals/results/hierarchy-structure/run dir>");
  return { results, mode: mode as JudgedMode, hierarchyRun, arms, seed };
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf-8")) as T;
}

/** One candidate's rendering, or a neutral line when the arm produced nothing. */
async function render(opts: Options, slug: string, arm: string, label: string, blocks: Block[]): Promise<string> {
  const head = `## Candidate ${label}`;
  const missing = `${head}\n\nThis candidate produced no usable output.`;
  const base = path.join(opts.results, opts.mode, `${slug}.${arm}`);
  switch (opts.mode) {
    case "sketch": {
      if (!existsSync(`${base}.json`)) return missing;
      const scene = stripProvenance(await readJson(`${base}.json`));
      /* Copied under the label: the run's own filename names the arm, and a
         path is the easiest place for a key to leak. */
      let png = "(no picture rendered — judge from the scene)";
      if (existsSync(`${base}.png`)) {
        const shown = path.join(opts.results, "judging", opts.mode, `picture-${slug}-${label}.png`);
        await copyFile(`${base}.png`, shown);
        png = path.resolve(shown);
      }
      return [head, "", `Picture: ${png}`, "", "Scene:", "", "```json", JSON.stringify(scene, null, 2), "```"].join("\n");
    }
    case "ideas": {
      if (!existsSync(`${base}.json`)) return missing;
      const ideas = await readJson<{ ideas: Idea[] }>(`${base}.json`);
      return [head, "", "```json", JSON.stringify(ideasForJudging(ideas, blocks), null, 2), "```"].join("\n");
    }
    case "illustrated": {
      if (!existsSync(`${base}.brief.json`)) return missing;
      const brief = stripProvenance(await readJson(`${base}.brief.json`));
      return [head, "", "```json", JSON.stringify(brief, null, 2), "```"].join("\n");
    }
    case "hierarchy": {
      const file = path.join(opts.hierarchyRun as string, "trees", `${arm}.${slug}.json`);
      if (!existsSync(file)) return missing;
      /* blind.ts's own heading, renamed to this lineup's. */
      return renderForJudging(blocks, await readJson<Tree>(file), label).replace(/^## Tree /, "## Candidate ");
    }
    default: {
      const never: never = opts.mode;
      throw new Error(`unknown mode ${String(never)}`);
    }
  }
}

const ASK: Record<JudgedMode, string> = {
  sketch: "a picture of how the article is put together, for a reader who has not read it yet",
  ideas: "the ideas a reader needs in order to get this article, each tied to the passages that carry it",
  illustrated: "a brief for an illustrator: plates that paint the article's argument, each vignette tied to a real quote",
  hierarchy: "a table of contents that carves the article into sections a first-time reader would navigate by",
};

async function main(opts: Options): Promise<void> {
  const outDir = path.join(opts.results, "judging", opts.mode);
  const keyDir = path.join(outDir, "keys");
  await mkdir(keyDir, { recursive: true });

  const seedFile = path.join(keyDir, "seed.json");
  const seed = existsSync(seedFile)
    ? (await readJson<{ seed: number }>(seedFile)).seed
    : (opts.seed ?? randomInt(2 ** 31));
  await writeFile(seedFile, `${JSON.stringify({ seed }, null, 2)}\n`, "utf-8");

  const arms: string[] =
    opts.arms ?? (opts.mode === "hierarchy" ? [...HIERARCHY_ARMS] : [...DEFAULT_ARMS]);
  const slugs =
    opts.mode === "hierarchy"
      ? [...new Set((await readJson<{ results: { slug: string }[] }>(path.join(opts.hierarchyRun as string, "run.json"))).results.map((r) => r.slug))]
      : [...new Set((await readRows(path.join(opts.results, "runs.jsonl"))).filter((r) => r.mode === opts.mode).map((r) => r.slug))];
  if (slugs.length === 0) throw new Error(`nothing to line up for ${opts.mode} in ${opts.results}`);

  for (const slug of slugs) {
    const corpus = path.join(opts.results, "corpus", slug);
    const { blocks } = await readJson<{ blocks: Block[] }>(path.join(corpus, "blocks.json"));
    const meta: Meta = existsSync(path.join(corpus, "meta.json"))
      ? await readJson<Meta>(path.join(corpus, "meta.json"))
      : ({ title: slug } as Meta);

    await writeFile(
      path.join(outDir, `article-${slug}.md`),
      `# The article: ${meta.title ?? slug}\n\n${articleWithIds(meta, blocks.filter(isBodyEvidence))}\n`,
      "utf-8",
    );

    const order = seededShuffle(arms, seed, `${opts.mode}/${slug}`);
    const labels = labelsFor(order.length);
    const rendered: string[] = [];
    for (const [i, arm] of order.entries()) rendered.push(await render(opts, slug, arm, labels[i] as string, blocks));

    await writeFile(
      path.join(outDir, `lineup-${slug}.md`),
      [
        `# ${order.length} candidates for "${meta.title ?? slug}"`,
        "",
        `Each candidate is ${ASK[opts.mode]}. They are labelled ${labels.join(", ")} in an order that`,
        "says nothing about how any of them was made. The article itself, with its block ids, is",
        `\`article-${slug}.md\` beside this file.`,
        "",
        rendered.join("\n\n"),
        "",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(
      path.join(keyDir, `key-${slug}.json`),
      `${JSON.stringify(Object.fromEntries(order.map((arm, i) => [labels[i], arm])), null, 2)}\n`,
      "utf-8",
    );
    console.log(`${slug}: ${order.length} candidates`);
  }
  console.log(`Wrote ${outDir}/ (keys in ${keyDir}/ — never shown to a judge)`);
}

if (isMain(import.meta.url)) {
  await main(parseArgs(process.argv.slice(2)));
}
