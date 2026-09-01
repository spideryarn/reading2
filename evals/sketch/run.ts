/**
 * **The Sketch prompt harness** — draw a few articles, measure what came back,
 * and leave a picture on disk that a person (or a subagent) can look at.
 *
 *   npx tsx evals/sketch/run.ts                          # the three defaults
 *   npx tsx evals/sketch/run.ts data/constitution        # one article
 *   npx tsx evals/sketch/run.ts --system evals/sketch/variants/hub.txt
 *   npx tsx evals/sketch/run.ts --render data/x/sketch.json   # free: no model call
 *
 * It spends money through `generateSketch`, which is the shipping stage — **not
 * through a copy of the prompt**. A harness with its own copy of the prompt
 * measures a recipe nothing runs, which is the trap `evals/hierarchy-structure/`
 * names in its header. `--system` is the one exception and it exists so a
 * variant can be tried without editing src/; whatever wins gets written into
 * src/sketch.ts before it is believed.
 *
 * Everything it writes goes in one stamped directory: the raw scene, the SVG,
 * a PNG if `rsvg-convert` is on the machine, and a `README.md` with the
 * numbers. The PNG is the point — the measures below can tell you a picture is
 * broken and they cannot tell you it is any good.
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { isMain } from "../../src/is-main.js";
import { parseJsonFrom } from "../../src/parse-json.js";
import type { SketchRun } from "../../src/sketch.js";
import { readSketch, scoreSketch, type Sketch } from "../../src/sketch-scene.js";
import type { Block } from "../../src/types.js";
import { sketchSvg } from "./svg.js";

/* **`src/sketch.js`, `src/env.js` and the ledger are imported inside the paid
   branch, never at the top of this file.** Re-rendering a scene that is already
   on disk spends nothing, and it should not need the machinery that spends: the
   stage reaches `src/cli-ledger.ts`, which reaches the store, and a peer
   half-way through an edit in `src/store/` took the free path down with it while
   nothing about a free path had changed. A dynamic import is the seam, and it
   is the same reasoning vite.config.ts gives for not importing `src/routes.js`
   at its top level. */

const run = promisify(execFile);

/** Articles with a tree and enough shape to be worth drawing. */
const DEFAULT_DIRS = [
  "data/noema-mythology-of-conscious-ai",
  "data/constitution",
  "data/scaling-hypothesis",
];

interface Options {
  dirs: string[];
  outDir: string;
  systemFile: string | null;
  /** Re-render an existing sketch.json and spend nothing. */
  renderOnly: string | null;
}

function parseArgs(argv: string[]): Options {
  const dirs: string[] = [];
  let outDir = "";
  let systemFile: string | null = null;
  let renderOnly: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--out") outDir = argv[++i] ?? "";
    else if (a === "--system") systemFile = argv[++i] ?? null;
    else if (a === "--render") renderOnly = argv[++i] ?? null;
    else if (a === "--dir") dirs.push(argv[++i] ?? "");
    else if (!a.startsWith("--")) dirs.push(a);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return {
    dirs: dirs.length > 0 ? dirs : DEFAULT_DIRS,
    outDir: outDir || path.join("evals", "results", `sketch-${stamp}`),
    systemFile,
    renderOnly,
  };
}

/**
 * SVG → PNG, when the machine can.
 *
 * Best-effort and **loud when it fails**, because the whole reason this harness
 * exists is to produce something that can be looked at: a run that quietly wrote
 * no PNG looks exactly like a run whose pictures were fine.
 */
async function rasterise(svgFile: string, pngFile: string): Promise<string | null> {
  try {
    await run("rsvg-convert", ["-w", "1100", "-o", pngFile, svgFile]);
    return pngFile;
  } catch (err) {
    return `could not rasterise (${(err as Error).message.split("\n")[0]}) — the .svg is still there`;
  }
}

async function blockOrderFor(dir: string): Promise<string[]> {
  const { blocks } = parseJsonFrom<{ blocks: Block[] }>(
    await readFile(path.join(dir, "blocks.json"), "utf-8"),
    "blocks.json",
  );
  return blocks.map((b) => b.id);
}

/** One row of the README, and the thing a prompt change is judged on. */
function row(slug: string, r: SketchRun): string {
  const s = r.score;
  return [
    `| ${slug}`,
    `${s.nodes}`,
    `${s.linked}`,
    `${s.scenes}`,
    s.flow === null ? "n/a" : s.flow.toFixed(2),
    `${(s.reach * 100).toFixed(0)}%`,
    `${(s.overlap * 100).toFixed(1)}%`,
    `${s.overflowing}`,
    `${s.faults}`,
    `${(r.elapsedMs / 1000).toFixed(0)}s |`,
  ].join(" | ");
}

async function renderOne(sketch: Sketch, outDir: string, name: string): Promise<string> {
  const svgFile = path.join(outDir, `${name}.svg`);
  await writeFile(svgFile, sketchSvg(sketch), "utf-8");
  const png = await rasterise(svgFile, path.join(outDir, `${name}.png`));
  return png ?? svgFile;
}

/**
 * Re-render a scene already on disk. Spends nothing, and takes the same route
 * through `readSketch` and `scoreSketch` a paid run does — a renderer that only
 * worked on fresh model output is one nobody can re-check a finding with.
 */
async function renderOnly(file: string, outDir: string, dir: string | null): Promise<void> {
  const raw = parseJsonFrom<unknown>(await readFile(file, "utf-8"), file);
  /* The scene names blocks; the article that has them is found from the scene's
     own `slug`, or from `--dir` when that is wrong or missing. It can be wrong:
     see the note in src/sketch.ts about `data/constitution`'s tree calling
     itself "blocks". */
  const slug = dir ?? (raw as { slug?: string }).slug ?? path.basename(path.dirname(file));
  const blockOrder = await blockOrderFor(slug.includes("/") ? slug : path.join("data", slug));
  const { sketch, report } = readSketch(raw, { blockOrder });
  const score = scoreSketch(sketch, report, { blockOrder });
  const where = await renderOne(sketch, outDir, path.basename(slug));
  console.log(`${sketch.title} — ${sketch.caption}`);
  console.log(
    `  flow ${score.flow?.toFixed(2) ?? "n/a"}, ${score.nodes} nodes, ` +
      `widest unreached run ${(score.reach * 100).toFixed(0)}%, ${score.faults} faults`,
  );
  console.log(`  ${where}`);
}

async function draw(opts: Options): Promise<void> {
  const { generateSketch, summarise } = await import("../../src/sketch.js");
  /* Inside the paid branch with the rest of them, for the reason at the top of
     this file: the free `--render` path must not drag in anything a peer's
     half-finished edit under `src/store/` can break. */
  const { readArticleFromDir } = await import("../../src/article-input.js");
  const { loadEnvLocal } = await import("../../src/env.js");
  loadEnvLocal();

  const systemOverride = opts.systemFile
    ? await readFile(opts.systemFile, "utf-8")
    : undefined;

  const rows: string[] = [];
  const notes: string[] = [];

  for (const dir of opts.dirs) {
    const slug = path.basename(dir);
    process.stdout.write(`${slug}: drawing…`);
    const r = await generateSketch({
      article: await readArticleFromDir(dir),
      ...(systemOverride ? { systemOverride } : {}),
      onProgress: (d) => process.stdout.write(`\r${slug}: ${d}          `),
    });
    /* The harness writes the scene, because `generateSketch` writes nothing —
       see its note on being the first converted step. */
    await writeFile(path.join(opts.outDir, `${slug}.json`), JSON.stringify(r.sketch, null, 2), "utf-8");
    /* The raw answer beside the cleaned scene. `--render` reads the cleaned
       one and can therefore never reproduce a fault; this is the file that
       can, and it is also the only record of what the prompt actually got
       back. */
    await writeFile(path.join(opts.outDir, `${slug}.raw.json`), r.raw, "utf-8");
    const where = await renderOne(r.sketch, opts.outDir, slug);
    console.log(`\r${slug}: ${r.sketch.title} — ${r.sketch.caption}`);
    for (const line of summarise(r)) console.log(`   ${line}`);
    console.log(`   ${where}`);
    rows.push(row(slug, r));
    notes.push(
      `### ${slug}\n\n**${r.sketch.title}** — ${r.sketch.caption}\n\n` +
        (r.report.faults.length === 0
          ? "No faults.\n"
          : `Faults:\n${r.report.faults.map((f) => `- \`${f.where}\`: ${f.what}`).join("\n")}\n`),
    );
  }

  await writeReadme(opts, rows, notes);
}

async function writeReadme(opts: Options, rows: string[], notes: string[]): Promise<void> {
  const { PROMPT_VERSION } = await import("../../src/sketch.js");
  const readme = [
    `# Sketch run — ${new Date().toISOString()}`,
    "",
    `Prompt version \`${PROMPT_VERSION}\`. Each article has three files here:`,
    "`<slug>.raw.json` (what the model sent, before any checking),",
    "`<slug>.json` (the scene after `readSketch`) and `<slug>.png`.",
    "",
    opts.systemFile ? `Prompt variant: \`${opts.systemFile}\`` : "Prompt: the shipping `SYSTEM` in `src/sketch.ts`.",
    "",
    "`flow` is Kendall's tau between a node's height on the canvas and where its",
    "block sits in the article: 1 means the picture runs strictly top-to-bottom",
    "with the piece, 0 means the two are unrelated. It is the one measure that",
    "can catch a beautiful picture that a reader cannot keep their place in.",
    "",
    "`widest gap` is the longest stretch of the article that no node points",
    "into, as a fraction of the whole — how much of the piece the picture has",
    "nothing to say about.",
    "",
    "**None of these numbers say the picture is good.** They say it is not",
    "broken. Look at the PNGs.",
    "",
    "| article | nodes | linked | scenes | flow | widest gap | overlap | overflow | faults | time |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    ...notes,
  ].join("\n");
  await writeFile(path.join(opts.outDir, "README.md"), readme, "utf-8");
  console.log(`\nWrote ${path.join(opts.outDir, "README.md")}`);
}

if (isMain(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  await mkdir(opts.outDir, { recursive: true });
  if (opts.renderOnly) {
    await renderOnly(opts.renderOnly, opts.outDir, opts.dirs.length > 0 && process.argv.includes("--dir") ? (opts.dirs[0] as string) : null);
  } else {
    /* A ledger, because this spends money through the ordinary stage path and
       `npm run cost` should see it — src/cli-ledger.ts. */
    const { withLedger } = await import("../../src/cli-ledger.js");
    await withLedger("eval", () => draw(opts));
  }
}
