/**
 * **The blind read for plan 260929b § Stage 2**: do the stops a deeper pass
 * ADDS bring detail, subtlety or complexity, rather than a second telling of
 * the pass before?
 *
 *     npx tsx scripts/eval/skim-depth-blind.ts <results.json>
 *
 * Reads a results file from scripts/eval/skim-coverage-eval.ts and
 * writes two pairs of files beside it, with nothing in a pairs file that
 * names an arm:
 *
 * - `…-blind-pairs.md` / `…-blind-key.json` — OLD run 1 against NEW run 1;
 * - `…-control-pairs.md` / `…-control-key.json` — OLD run 1 against OLD run 2,
 *   the noise control.
 *
 * For each article and each depth (More = 2, Most = 3) a pair shows the pass
 * before (every stop at depth < d, from THAT side's own route, since each
 * side's reader has read its own earlier pass) and then the stops added at d,
 * each with its cue, its quote and its paragraph. The judge scores every
 * added stop "adds" or "repeats" and then picks a side (Sol F3 on plan
 * 260929b). Sides are shuffled per (article, depth) pair: a Fisher–Yates
 * shuffle, with `crypto.randomInt`, of a list holding as many "first arm on
 * A" as "first arm on B", so the key is balanced by construction (with an odd
 * pair count, one more of one kind). The key is written before any judging,
 * and the script prints the balance so a stuck coin shows.
 */
import { randomInt } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

interface Stop {
  depth: 1 | 2 | 3;
  quoteFull: string;
  paragraph: string;
  cue: string | null;
  section: string;
}
interface Run {
  slug: string;
  arm: "old" | "new";
  run: number;
  stops: Stop[];
}

const file = process.argv[2];
if (!file) throw new Error("usage: skim-depth-blind.ts <results.json>");
const { results } = JSON.parse(readFileSync(file, "utf8")) as { results: Run[] };
const base = file.replace(/\.json$/, "");

const find = (slug: string, arm: Run["arm"], run: number): Run => {
  const r = results.find((x) => x.slug === slug && x.arm === arm && x.run === run);
  if (!r) throw new Error(`no ${arm}#${run} for ${slug}`);
  return r;
};

function side(r: Run, depth: 2 | 3): string {
  const before = r.stops.filter((s) => s.depth < depth);
  const added = r.stops.filter((s) => s.depth === depth);
  const lines = [`**Already read (the pass before, ${before.length} stops):**`, ""];
  for (const s of before) lines.push(`- [${s.section}] ${s.quoteFull}`);
  lines.push("", `**Added at this depth (${added.length} stops):**`, "");
  added.forEach((s, k) => {
    lines.push(`${k + 1}. Cue: ${s.cue ?? "(none)"}`, `   Section: ${s.section}`, `   Quote: ${s.quoteFull}`);
    if (s.paragraph && s.paragraph !== s.quoteFull) lines.push(`   Paragraph: ${s.paragraph}`);
    lines.push("");
  });
  return lines.join("\n");
}

function build(name: string, left: (slug: string) => Run, right: (slug: string) => Run, labels: [string, string]): void {
  const slugs = [...new Set(results.map((r) => r.slug))];
  const key: Record<string, { A: string; B: string }> = {};
  const pairs = slugs.flatMap((slug) => ([2, 3] as const).map((depth) => ({ slug, depth })));
  const flips = pairs.map((_, k) => k % 2 === 1);
  for (let i = flips.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [flips[i], flips[j]] = [flips[j]!, flips[i]!];
  }
  const md: string[] = [
    `# Blind pairs (${name})`,
    "",
    "For each article and depth: given that you have read the pass before, which set of added stops",
    "adds more detail, subtlety or complexity rather than repeating the earlier pass?",
    "",
  ];
  let firstOnA = 0;
  pairs.forEach(({ slug, depth }, k) => {
    const flip = flips[k]!;
    const [a, b] = flip ? [right(slug), left(slug)] : [left(slug), right(slug)];
    key[`${slug} d${depth}`] = flip ? { A: labels[1], B: labels[0] } : { A: labels[0], B: labels[1] };
    if (!flip) firstOnA++;
    md.push(`## ${slug} — depth ${depth} (${depth === 2 ? "More" : "Most"})`, "", "### Side A", "", side(a, depth), "### Side B", "", side(b, depth), "");
  });
  writeFileSync(`${base}-${name}-key.json`, JSON.stringify(key, null, 2));
  writeFileSync(`${base}-${name}-pairs.md`, md.join("\n"));
  console.log(`${name}: ${labels[0]} on side A in ${firstOnA}/${pairs.length} pairs; wrote ${base}-${name}-pairs.md and -key.json`);
}

build("blind", (s) => find(s, "old", 1), (s) => find(s, "new", 1), ["old#1", "new#1"]);
build("control", (s) => find(s, "old", 1), (s) => find(s, "old", 2), ["old#1", "old#2"]);
