/**
 * **Skim routes measured as the reader walks them** — the tables for plan
 * 261011r § Stage 2, from one or more results files written by
 * scripts/eval/skim-coverage-eval.ts.
 *
 *     npx tsx scripts/eval/skim-walked-metrics.ts <results.json> [more.json …]
 *
 * That script's `rows` are cumulative (depth ≤ d), the walk from before plan
 * 260929e; GPT Sol's plan review (F4) found them misleading for More and
 * Most. Here a pass is the stops whose `depth` is d plus those whose `again`
 * names d — `passRoute`'s rule, which skim-coverage-eval.ts already checks
 * its `walks` against — and every number is over that walk:
 *
 * - walked sizes, and whether they grow strictly (`w₁ < w₂ < w₃`);
 * - Ideas "in" each walked pass (a stop on one of the Idea's blocks);
 * - each walked stop's quote length in words (`wordCount`, the count the
 *   prompt states), its median and mean, and how many are over
 *   `LONG_STOP_WORDS`;
 * - what the repair did (`growCarried`, `shrinkCarried`, `shrinkMoved`) and
 *   what it cost the intros (`movedIntro`, `badIntro`).
 *
 * Reads files only; writes nothing and calls no model.
 */
import { readFileSync } from "node:fs";
import { LONG_STOP_WORDS, wordCount } from "../../src/skim.js";
import type { SkimDepth } from "../../src/types.js";

interface Stop {
  depth: SkimDepth;
  again: SkimDepth[];
  quoteFull: string;
  ideasIn: string[];
}
interface Run {
  slug: string;
  arm: "old" | "new";
  run: number;
  version: string;
  offered: number;
  stops: Stop[];
  dropped: Record<string, number | undefined>;
  intros?: (string | null)[] | null;
}
interface File {
  results: Run[];
  failures: { slug: string; arm: string; run: number; message: string }[];
}

const files = process.argv.slice(2);
if (files.length === 0) throw new Error("usage: skim-walked-metrics.ts <results.json> [more.json …]");
const runs: (Run & { file: string })[] = [];
for (const file of files) {
  const read = JSON.parse(readFileSync(file, "utf8")) as File;
  for (const r of read.results) runs.push({ ...r, file });
  for (const f of read.failures) console.log(`FAILED ${f.slug} ${f.arm}#${f.run} (${file}): ${f.message}`);
}

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

function walk(stops: readonly Stop[], d: SkimDepth): Stop[] {
  const offered = new Set(stops.map((s) => s.depth));
  return stops.filter((s) => s.depth === d || (offered.has(d) && s.again.includes(d)));
}

/** One row per run. */
const rows = runs.map((r) => {
  const passes = ([1, 2, 3] as const).map((d) => walk(r.stops, d));
  const sizes = passes.map((p) => p.length);
  const ideas = passes.map((p) => new Set(p.flatMap((s) => s.ideasIn)).size);
  const words = passes.map((p) => p.map((s) => wordCount(s.quoteFull)));
  const grows = sizes[0]! < sizes[1]! && sizes[1]! < sizes[2]!;
  return { r, sizes, ideas, words, grows };
});

const arms = [...new Set(runs.map((r) => `${r.arm} ${r.version}`))];
const slugs = [...new Set(runs.map((r) => r.slug))];

console.log("\n## Walked sizes (Gist/More/Most), per run\n");
console.log(`| article (offered) | ${arms.join(" | ")} |`);
console.log(`|---|${arms.map(() => "---").join("|")}|`);
for (const slug of slugs) {
  const offered = runs.find((r) => r.slug === slug)?.offered ?? 0;
  const cells = arms.map((arm) =>
    rows
      .filter((x) => x.r.slug === slug && `${x.r.arm} ${x.r.version}` === arm)
      .map((x) => (x.grows ? x.sizes.join("/") : `**${x.sizes.join("/")}**`))
      .join(" · "),
  );
  console.log(`| ${slug} (${offered}) | ${cells.join(" | ")} |`);
}
console.log("\nBold: does not grow strictly.");

console.log("\n## Per arm, summed over articles, per run index\n");
for (const arm of arms) {
  const mine = rows.filter((x) => `${x.r.arm} ${x.r.version}` === arm);
  const byRun = [...new Set(mine.map((x) => `${x.r.file}#${x.r.run}`))];
  for (const key of byRun) {
    const set = mine.filter((x) => `${x.r.file}#${x.r.run}` === key);
    const gistWords = set.flatMap((x) => x.words[0]!);
    const moreWords = set.flatMap((x) => x.words[1]!);
    const sum = (k: "growCarried" | "shrinkCarried" | "shrinkMoved" | "movedIntro" | "badIntro") =>
      set.reduce((n, x) => n + (x.r.dropped[k] ?? 0), 0);
    console.log(
      `${arm} ${key.split("/").at(-1)}: not growing ${set.filter((x) => !x.grows).length}/${set.length}; ` +
        `Ideas in Gist ${set.reduce((n, x) => n + x.ideas[0]!, 0)}, More ${set.reduce((n, x) => n + x.ideas[1]!, 0)}, ` +
        `Most ${set.reduce((n, x) => n + x.ideas[2]!, 0)}; ` +
        `Gist words median ${median(gistWords)} mean ${mean(gistWords).toFixed(1)} over-${LONG_STOP_WORDS} ${gistWords.filter((w) => w > LONG_STOP_WORDS).length}/${gistWords.length}; ` +
        `More words median ${median(moreWords)} mean ${mean(moreWords).toFixed(1)} over-${LONG_STOP_WORDS} ${moreWords.filter((w) => w > LONG_STOP_WORDS).length}/${moreWords.length}; ` +
        `growCarried ${sum("growCarried")} shrinkCarried ${sum("shrinkCarried")} shrinkMoved ${sum("shrinkMoved")} ` +
        `(runs with a move: ${set.filter((x) => (x.r.dropped.shrinkMoved ?? 0) > 0).length}); movedIntro ${sum("movedIntro")} badIntro ${sum("badIntro")}`,
    );
  }
}

console.log("\n## Intros\n");
for (const x of rows) {
  if (!x.r.intros) continue;
  console.log(`- ${x.r.slug} ${x.r.arm}#${x.r.run} (${x.sizes.join("/")}):`);
  x.r.intros.forEach((intro, i) => console.log(`  - ${["Gist", "More", "Most"][i]}: ${intro ?? "(none)"}`));
}
