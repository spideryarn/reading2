/**
 * **Is the arc sentence short and plain enough for Marginalia's head?**
 *
 * Greg, 2026-10-01 (spya-g4yrew), on the rail at the top of the column: *"the
 * language is too complex. Can you make it shorter and simpler."* The words in
 * question are the arc's (src/arc.ts); production's median was 29–34 words a
 * sentence at every prompt version, and the head shows three lines, about
 * 15–20 words. docs/plans/261002g-marginalia-head-in-plain-words-and-every-note-says-where-it-came-from.md § 2.
 *
 * ```
 * npx tsx evals/arc-length/run.ts list                       # free: local articles with a tree
 * npx tsx evals/arc-length/run.ts generate --arm before <slug>…   # paid: one capable call per slug
 * npx tsx evals/arc-length/run.ts report                     # free: every arm, side by side
 * ```
 *
 * Production's generator, called the way the plain-words eval calls it
 * (`generateArc`, standard power, the reader's `loadArticle`), and the prompt
 * is whatever src/arc.ts holds when the arm runs — `PROMPT_VERSION` and a hash
 * of the file are recorded with each arm, so an arm cannot be mislabelled. Run
 * `before` twice (`before`, `before-2`) for the control: the spread between two
 * runs of one prompt is what a difference between prompts has to beat.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../../src/env.js";

const OUT = path.join(import.meta.dirname, "..", "results", "arc-length");
const ARC_SRC = path.join(import.meta.dirname, "..", "..", "src", "arc.ts");

type ArmResult = {
  arm: string;
  promptVersion: string;
  arcSha: string;
  at: string;
  articles: { slug: string; sentences: string[] }[];
  /** Articles the generator refused (e.g. a sentence count that does not match the parts). */
  failed?: { slug: string; error: string }[];
};

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

async function asOwner<T>(fn: () => Promise<T>): Promise<T> {
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  return runAsOwner(environmentOwnerId(), fn);
}

async function list(): Promise<void> {
  const { listArticles } = (await import("../../src/store/index.js")) as unknown as {
    listArticles?: () => Promise<{ slug: string }[]>;
  };
  if (!listArticles) throw new Error("no listArticles in the store; pass slugs by hand");
  const rows = await asOwner(() => listArticles());
  for (const r of rows) console.log(r.slug);
}

async function generate(arm: string, slugs: string[]): Promise<void> {
  if (slugs.length === 0) throw new Error("name at least one slug");
  const { generateArc, PROMPT_VERSION } = await import("../../src/arc.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const result: ArmResult = {
    arm,
    promptVersion: PROMPT_VERSION,
    arcSha: createHash("sha256").update(fs.readFileSync(ARC_SRC)).digest("hex").slice(0, 12),
    at: new Date().toISOString(),
    articles: [],
  };
  await asOwner(async () => {
    for (const slug of slugs) {
      const found = await loadArticle(slug);
      const article = { slug, blocks: found.blocks, tree: found.tree, meta: found.meta };
      try {
        const run = await generateArc({ power: "standard", article });
        result.articles.push({ slug, sentences: run.arc.entries.map((e) => e.text) });
        console.log(`${slug}: ${run.arc.entries.length} sentences`);
      } catch (err) {
        /* A refusal is a result, not a crash: a prompt that makes the model
           split a sentence in two fails the step in production too. */
        (result.failed ??= []).push({ slug, error: (err as Error).message });
        console.log(`${slug}: FAILED ${(err as Error).message}`);
      }
    }
  });
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${arm}.json`);
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`wrote ${file}`);
}

/**
 * **Lines in the head, estimated**: a greedy word wrap at the head's text width
 * in the AI face (13px IBM Plex Mono, 0.6em ≈ 7.8px a character). The column is
 * 200–288px (layout.ts `MARG_MIN`/`MARG_IDEAL`) less 20px left and 8px right
 * padding (marginalia.css § the head): about 22 and 33 characters a line. The
 * head clamped the arc at three lines when this was written, four since (a
 * sentence over the clamp is cut).
 */
const CHARS_AT = { narrow: Math.floor(172 / 7.8), wide: Math.floor(260 / 7.8) } as const;
function linesAt(sentence: string, perLine: number): number {
  let lines = 1;
  let used = 0;
  for (const w of sentence.split(/\s+/).filter(Boolean)) {
    const need = used === 0 ? w.length : used + 1 + w.length;
    if (need <= perLine) used = need;
    else {
      lines += Math.max(1, Math.ceil(w.length / perLine));
      used = w.length % perLine || perLine;
    }
  }
  return lines;
}

function stats(ns: number[]) {
  const s = [...ns].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
  return { n: s.length, median: at(0.5), p90: at(0.9), max: s.at(-1) ?? 0, over20: s.filter((x) => x > 20).length };
}

function report(): void {
  const arms = fs
    .readdirSync(OUT)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8")) as ArmResult);
  for (const a of arms) {
    const all = a.articles.flatMap((x) => x.sentences);
    const st = stats(all.map(words));
    const whole = (perLine: number, lines: number) => all.filter((s) => linesAt(s, perLine) <= lines).length;
    console.log(
      `${a.arm.padEnd(10)} ${a.promptVersion} ${a.arcSha}  refused ${a.failed?.length ?? 0}/${a.articles.length + (a.failed?.length ?? 0)}  sentences ${st.n}  words median ${st.median} p90 ${st.p90} max ${st.max}  over 20: ${st.over20}  ` +
        `whole in 4 lines: ${whole(CHARS_AT.wide, 4)}/${st.n} at 288px, ${whole(CHARS_AT.narrow, 4)}/${st.n} at 200px (in 3: ${whole(CHARS_AT.wide, 3)}, ${whole(CHARS_AT.narrow, 3)})`,
    );
  }
  const slugs = [...new Set(arms.flatMap((a) => a.articles.map((x) => x.slug)))];
  for (const slug of slugs) {
    console.log(`\n== ${slug}`);
    for (const a of arms) {
      const art = a.articles.find((x) => x.slug === slug);
      if (!art) continue;
      console.log(`  [${a.arm}]`);
      for (const s of art.sentences) console.log(`    (${words(s)}) ${s}`);
    }
  }
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "list") await list();
else if (cmd === "generate") {
  const i = rest.indexOf("--arm");
  if (i < 0 || !rest[i + 1]) throw new Error("--arm <name> is required");
  const arm = rest[i + 1]!;
  loadEnvLocal();
  const { withLedger } = await import("../../src/cli-ledger.js");
  /* The ledger is open around the paid command only: an eval's spend is refused without one (src/ai-spend.ts § UnrecordedSpendRefused). */
  await withLedger("eval", () =>
    generate(
      arm,
      rest.filter((_, j) => j !== i && j !== i + 1),
    ),
  );
} else if (cmd === "report") report();
else console.log("usage: list | generate --arm <name> <slug>… | report");
process.exit(0);
