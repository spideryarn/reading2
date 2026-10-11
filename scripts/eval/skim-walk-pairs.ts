/**
 * **Blind pairs for plan 261011r § Stage 2**: the Gist walk of one route
 * against another's, and each new route's pass intros against the pass they
 * introduce — from results files written by scripts/eval/skim-coverage-eval.ts.
 *
 *     npx tsx scripts/eval/skim-walk-pairs.ts --old=<results.json> --new=<results.json> --out=<dir>
 *
 * Writes `<dir>/pairs.md` (what the judge reads) and `<dir>/key.json` (which
 * side is which; the judge never sees it). Pairs, per article:
 *
 * - **c** — the old arm's run 1 against its run 2: the control, how much two
 *   samples of one prompt differ;
 * - **t** — the old arm's run *k* against the new arm's run *k*.
 *
 * Each side is the Gist pass as the reader walks it (own stops plus carried,
 * `walk` below — `passRoute`'s rule), every quote whole with its length in
 * words. Sides are decided by `blindCoin`, the tested coin, and the key
 * reports how often the new arm landed on each side, so a judge's side
 * preference cannot pass for a prompt effect (prompting-guide.md § Measuring
 * a prompt change).
 *
 * The intros section lists each new run's intros with the quotes of the pass
 * each one introduces and the article's key Ideas, for a rating rather than a
 * comparison: no arm before `skim/13` has intros.
 *
 * Reads files only; calls no model.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { blindCoin } from "../../evals/plain-words/run.js";
import { wordCount } from "../../src/skim.js";
import type { SkimDepth } from "../../src/types.js";

interface Stop {
  depth: SkimDepth;
  again: SkimDepth[];
  quoteFull: string;
  section: string;
}
interface Run {
  slug: string;
  arm: "old" | "new";
  run: number;
  stops: Stop[];
  intros?: (string | null)[] | null;
}

const arg = (name: string) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!found) throw new Error(`--${name}= is required`);
  return found.slice(name.length + 3);
};
const read = (file: string) => (JSON.parse(readFileSync(file, "utf8")) as { results: Run[] }).results;
const oldRuns = read(arg("old")).filter((r) => r.arm === "old");
const newRuns = read(arg("new")).filter((r) => r.arm === "new");
const out = arg("out");
mkdirSync(out, { recursive: true });

function walk(stops: readonly Stop[], d: SkimDepth): Stop[] {
  const offered = new Set(stops.map((s) => s.depth));
  return stops.filter((s) => s.depth === d || (offered.has(d) && s.again.includes(d)));
}
const side = (r: Run) =>
  walk(r.stops, 1)
    .map((s, i) => `${i + 1}. (${s.section}; ${wordCount(s.quoteFull)} words) "${s.quoteFull}"`)
    .join("\n");

const coin = blindCoin(261011);
const key: { id: string; kind: "c" | "t"; slug: string; A: string; B: string }[] = [];
const md: string[] = [
  "# Skim Gist walks, blind pairs",
  "",
  "Each pair is two Gist walks through the same article: the stops a reader skimming it meets first, in order. Every stop is a quote from the article.",
  "",
];
const slugs = [...new Set(oldRuns.map((r) => r.slug))];
let n = 0;
for (const slug of slugs) {
  const olds = oldRuns.filter((r) => r.slug === slug).sort((a, b) => a.run - b.run);
  const news = newRuns.filter((r) => r.slug === slug).sort((a, b) => a.run - b.run);
  const pairs: { kind: "c" | "t"; x: Run; y: Run }[] = [];
  if (olds[0] && olds[1]) pairs.push({ kind: "c", x: olds[0], y: olds[1] });
  for (const [i, o] of olds.entries()) if (news[i]) pairs.push({ kind: "t", x: o, y: news[i]! });
  for (const p of pairs) {
    const id = `P${++n}`;
    const swap = coin();
    const [a, b] = swap ? [p.y, p.x] : [p.x, p.y];
    key.push({ id, kind: p.kind, slug, A: `${a.arm}#${a.run}`, B: `${b.arm}#${b.run}` });
    md.push(`## ${id} — ${slug}`, "", "### A", "", side(a), "", "### B", "", side(b), "");
  }
}

md.push(
  "# Pass intros, to rate",
  "",
  "Each intro is one or two sentences shown above a pass's stops, meant to map the walk: what it goes through and in what order. Below each is the pass it introduces.",
  "",
);
let m = 0;
for (const r of newRuns) {
  if (!r.intros) continue;
  for (const d of [1, 2, 3] as const) {
    const intro = r.intros[d - 1];
    if (!intro) continue;
    md.push(
      `## I${++m} — ${r.slug}, ${["Gist", "More", "Most"][d - 1]}`,
      "",
      `Intro: "${intro}"`,
      "",
      walk(r.stops, d)
        .map((s, i) => `${i + 1}. (${s.section}) "${s.quoteFull}"`)
        .join("\n"),
      "",
    );
  }
}

const newOnA = key.filter((k) => k.kind === "t" && k.A.startsWith("new")).length;
const tPairs = key.filter((k) => k.kind === "t").length;
writeFileSync(join(out, "pairs.md"), md.join("\n"));
writeFileSync(join(out, "key.json"), JSON.stringify({ newOnA, tPairs, key }, null, 2));
console.log(`${n} pairs (${tPairs} test, ${n - tPairs} control), ${m} intros; new arm on side A in ${newOnA} of ${tPairs}`);
