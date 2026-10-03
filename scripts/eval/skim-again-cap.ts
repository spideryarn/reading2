/**
 * **What would the carry cap have done to routes planned without it?** Plan
 * 261003l § Stage 2, round three: `validateRoute` rule 8 lets a pass carry at
 * most `maxCarried(own)` earlier stops and keeps the earliest in route order.
 * Is "the earliest keep" a sensible rule, or does it drop the good ones?
 *
 *     npx tsx scripts/eval/skim-again-cap.ts <results.json>
 *
 * Reads a results file from scripts/eval/skim-coverage-eval.ts and, when it
 * is there, the carried-stop classification beside it
 * (`…-again-carried-classes.json`, ids as scripts/eval/skim-again-pairs.ts
 * numbers them). **No model call, no database, nothing written**; the report
 * goes to stdout. The cap is production's own `maxCarried`, applied the way
 * rule 8 applies it: per pass, in route order, an `again` entry past the room
 * is dropped and the stop stays.
 */
import { existsSync, readFileSync } from "node:fs";
import { maxCarried } from "../../src/skim.js";

type Depth = 1 | 2 | 3;
interface Stop { depth: Depth; again: Depth[]; cue: string | null; quoteFull: string }
interface Run { slug: string; arm: string; run: number; stops: Stop[] }

const file = process.argv[2];
if (!file) throw new Error("usage: skim-again-cap.ts <results.json>");
const runs = (JSON.parse(readFileSync(file, "utf8")) as { results: Run[] }).results.filter((r) => r.arm === "new");
const classesPath = file.replace(/\.json$/, "-again-carried-classes.json");
const classes = new Map<string, { class: string; adjacent?: string }>(
  existsSync(classesPath)
    ? (JSON.parse(readFileSync(classesPath, "utf8")) as { classes: { id: string; class: string; adjacent?: string }[] }).classes.map(
        (c) => [c.id, c],
      )
    : [],
);
const PASS = { 1: "Gist", 2: "More", 3: "Most" } as const;
const slugs = [...new Set(runs.map((r) => r.slug))];
const pct = (n: number, of: number) => (of === 0 ? "–" : `${Math.round((100 * n) / of)}%`);

/* The ids scripts/eval/skim-again-pairs.ts gives the carried stops: by article,
   run, pass (More then Most), then the order of the walk. */
let id = 0;
const total = { 2: { walk: 0, before: 0, after: 0 }, 3: { walk: 0, before: 0, after: 0 } };
const tally = new Map<string, { kept: number; dropped: number }>();
const count = (key: string, kept: boolean) => {
  const t = tally.get(key) ?? { kept: 0, dropped: 0 };
  if (kept) t.kept++;
  else t.dropped++;
  tally.set(key, t);
};
console.log("| Article | run | pass | own | cap | carried before | after | share before → after | dropped |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const slug of slugs) {
  for (const run of [1, 2]) {
    const r = runs.find((x) => x.slug === slug && x.run === run);
    if (!r) continue;
    for (const d of [2, 3] as const) {
      const own = r.stops.filter((s) => s.depth === d).length;
      const carried = r.stops.filter((s) => s.again.includes(d));
      if (carried.length === 0) {
        total[d].walk += own;
        continue;
      }
      const cap = maxCarried(own);
      const dropped: string[] = [];
      carried.forEach((s, i) => {
        id++;
        const c = classes.get(`C${id}`);
        const kept = i < cap;
        const label = c ? `${c.class}${c.adjacent ? `, ${c.adjacent === "yes" ? "next to its pair" : "not next to its pair"}` : ""}` : "unclassified";
        count(`${PASS[d]} · ${label}`, kept);
        if (!kept) dropped.push(`C${id} (from ${PASS[s.depth]}; ${label}): ${(s.cue ?? s.quoteFull).slice(0, 70)}`);
      });
      const after = Math.min(cap, carried.length);
      total[d].walk += own;
      total[d].before += carried.length;
      total[d].after += after;
      console.log(
        `| ${slug} | ${run} | ${PASS[d]} | ${own} | ${cap} | ${carried.length} | ${after} | ${pct(carried.length, own + carried.length)} → ${pct(after, own + after)} | ${dropped.join("<br>") || "–"} |`,
      );
    }
  }
}
for (const d of [2, 3] as const) {
  const t = total[d];
  console.log(
    `\n${PASS[d]}, all runs: carried ${t.before} → ${t.after} (${t.before - t.after} dropped); share ${pct(t.before, t.walk + t.before)} → ${pct(t.after, t.walk + t.after)}`,
  );
}
console.log("\n| pass · class | kept | dropped |\n|---|---|---|");
for (const [key, t] of [...tally].sort()) console.log(`| ${key} | ${t.kept} | ${t.dropped} |`);
