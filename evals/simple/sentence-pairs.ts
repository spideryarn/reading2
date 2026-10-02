/**
 * **The blind read for plan 261002e** — did answering in sentences, each
 * naming its passage, change the words? Builds a pairs file a fresh judge
 * reads and a key it never sees, plus a link sample a second judge grades.
 * Free: it reads evals/results/simple/ and the local database (for the cited
 * passages), and calls no model.
 *
 *   npx tsx evals/simple/sentence-pairs.ts <outDir> [seed]
 *
 * Pairs, per article and level: before1×after1 and before2×after2 (the
 * effect), and before1×before2 (the control — how much two samples of the old
 * prompt disagree). Sides shuffled with `blindCoin`; the key's balance is
 * printed so a side preference cannot pass for a prompt effect
 * (docs/project/prompting-guide.md § Measuring a prompt change).
 *
 * The link sample: every linked sentence of the `simple` level in the after1
 * arm, beside the one passage it names.
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../../src/env.js";
import { blindCoin } from "../plain-words/run.js";

const RESULTS = path.join(import.meta.dirname, "..", "results", "simple");
const SLUGS = ["entropy-24-00930-spya-pywwkq", "greatwork-spya-yw4d3t", "noema-mythology-of-conscious-ai"];
const LEVELS = [
  ["brief", "brief"],
  ["simple", "paragraphs"],
  ["fuller", "fuller"],
] as const;
const PAIRS = [
  ["sentbefore1", "sentafter1", "effect"],
  ["sentbefore2", "sentafter2", "effect"],
  ["sentbefore1", "sentbefore2", "control"],
] as const;

interface Para {
  text: string;
  ids: string[];
  sentences?: { text: string; id: string | null }[];
}

const outDir = process.argv[2];
if (!outDir) throw new Error("usage: sentence-pairs.ts <outDir>");
fs.mkdirSync(outDir, { recursive: true });

loadEnvLocal();
const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
const { loadArticle } = await import("../../src/store/index.js");
const { closeDb } = await import("../../src/db/client.js");

const blockText = new Map<string, string>();
await runAsOwner(environmentOwnerId(), async () => {
  for (const slug of SLUGS) {
    const article = await loadArticle(slug);
    for (const b of article.blocks) blockText.set(`${slug}:${b.id}`, b.text);
  }
});
await closeDb();

const read = (arm: string, slug: string) =>
  JSON.parse(fs.readFileSync(path.join(RESULTS, `high-none-${arm}`, `${slug}.json`), "utf8")) as Record<
    string,
    unknown
  >;
const passage = (slug: string, id: string) => (blockText.get(`${slug}:${id}`) ?? "(missing)").slice(0, 500);
const withPassages = (slug: string, paras: Para[]) =>
  paras
    .map((p) => `${p.text}\n  Cited passages:\n${p.ids.map((id) => `  - ${passage(slug, id)}`).join("\n")}`)
    .join("\n\n");

const coin = blindCoin(Number(process.argv[3] ?? 261002));
const pairs: string[] = [
  "# Blind pairs",
  "",
  "Each pair is two plain-words summaries of the same article at the same level. Answer per pair:",
  "",
  "- Q1: which would a curious reader from OUTSIDE this field understand more easily, and which reads better as prose? X, Y or SAME.",
  "- Q2: against its cited passages, does either text lose, bend, or blur a claim (a number, the direction of a finding, a hedge), or add something the passages do not say? NONE, X, Y or BOTH, and name it.",
  "",
  "Format: `n: Q1=X|Y|SAME; Q2=NONE|X|Y|BOTH — reason`.",
  "",
];
const key: string[] = [];
let n = 0;
let afterOnX = 0;
let effects = 0;
for (const slug of SLUGS) {
  for (const [level, field] of LEVELS) {
    for (const [a, b, kind] of PAIRS) {
      n += 1;
      const pa = read(a, slug)[field] as Para[];
      const pb = read(b, slug)[field] as Para[];
      const swap = coin();
      const [x, y, xArm, yArm] = swap ? [pb, pa, b, a] : [pa, pb, a, b];
      if (kind === "effect") {
        effects += 1;
        if (xArm.startsWith("sentafter")) afterOnX += 1;
      }
      pairs.push(`## ${n}`, "", "### X", "", withPassages(slug, x), "", "### Y", "", withPassages(slug, y), "");
      key.push(JSON.stringify({ n, slug, level, kind, X: xArm, Y: yArm }));
    }
  }
}
fs.writeFileSync(path.join(outDir, "pairs.md"), pairs.join("\n"));
fs.writeFileSync(path.join(outDir, "key.jsonl"), `${key.join("\n")}\n`);

const links: string[] = [
  "# Sentence links",
  "",
  "Each item is one sentence from a plain-words summary, and the one passage of the article it names as its source.",
  "Grade each: GOOD (the passage says what the sentence says), PARTIAL (the passage is relevant but the sentence's main claim is mostly elsewhere), WRONG (the passage does not support the sentence).",
  "Format: `n: GOOD|PARTIAL|WRONG — reason`.",
  "",
];
let m = 0;
for (const slug of SLUGS) {
  for (const p of read("sentafter1", slug).paragraphs as Para[]) {
    for (const s of p.sentences ?? []) {
      if (s.id === null) continue;
      m += 1;
      links.push(`## ${m}`, "", `Sentence: ${s.text}`, "", `Passage: ${passage(slug, s.id)}`, "");
    }
  }
}
fs.writeFileSync(path.join(outDir, "links.md"), links.join("\n"));
console.log(`${n} pairs (${effects} effect, ${n - effects} control); after-arm on X in ${afterOnX} of ${effects}; ${m} links`);
