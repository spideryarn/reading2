/**
 * **The figure stops a `skim/14` route chose, laid out to be read** — plan
 * 261017d § Measuring it, from results files written by
 * scripts/eval/skim-coverage-eval.ts.
 *
 *     npx tsx scripts/eval/skim-figure-stops.ts <results.json> [more.json …]
 *
 * Per run of the NEW arm: how many figures were offered and chosen, the
 * passes walked with them (`walkedWithFigures`) and every figure drop. Per
 * figure stop: its pass, name, section and cue, and **whether it sits beside a
 * quote of its own top-level section or one whose paragraph names it** — the
 * placement criterion, checked mechanically; whether the figure earns its
 * place and whether the cue keeps the rules is read by a person. Then the
 * totals the plan's criteria ask for.
 *
 * Reads files only; writes nothing and calls no model.
 */
import { readFileSync } from "node:fs";

interface Neighbour {
  key: string;
  section: string;
  quote: string | null;
}
interface FigureStop {
  blockId: string;
  name: string;
  caption: string | null;
  depth: number;
  cue: string | null;
  section: string;
  namedIn: string[];
  prev: Neighbour | null;
  next: Neighbour | null;
}
interface Run {
  slug: string;
  arm: "old" | "new";
  run: number;
  version: string;
  dropped: Record<string, number | undefined>;
  figuresOffered?: unknown[];
  figureStops?: FigureStop[];
  walkedWithFigures?: [number, number, number];
  walks: { depth: number; length: number }[];
}

const files = process.argv.slice(2);
if (files.length === 0) throw new Error("usage: skim-figure-stops.ts <results.json> [more.json …]");
const runs: Run[] = files.flatMap((f) => (JSON.parse(readFileSync(f, "utf8")) as { results: Run[] }).results);

const DROPS = ["unknownFigure", "duplicateFigure", "figureAnchorGone", "figureNoPass", "overFigureCap", "figureShrink", "noFigureCue", "badFigureCue"];
let stops = 0;
let placed = 0;
let routesWithFigures = 0;
let routesOffered = 0;
let shrinkRuns = 0;
const PASS = ["", "Gist", "More", "Most"];
for (const r of runs.filter((x) => x.arm === "new").sort((a, b) => a.slug.localeCompare(b.slug) || a.run - b.run)) {
  const offered = r.figuresOffered?.length ?? 0;
  const chosen = r.figureStops ?? [];
  const drops = DROPS.filter((k) => (r.dropped[k] ?? 0) > 0).map((k) => `${k} ${r.dropped[k]}`);
  const quoteWalk = r.walks.map((w) => w.length).join("/");
  console.log(
    `\n${r.slug} #${r.run}: ${chosen.length} of ${offered} figures; walked ${quoteWalk} → ${r.walkedWithFigures?.join("/") ?? "?"} with figures${drops.length ? `; ${drops.join(", ")}` : ""}`,
  );
  if (offered > 0) routesOffered++;
  if (chosen.length > 0) routesWithFigures++;
  if ((r.dropped.figureShrink ?? 0) > 0) shrinkRuns++;
  for (const f of chosen) {
    stops++;
    const beside = [f.prev, f.next].filter((n): n is Neighbour => n !== null && n.quote !== null);
    const ok = beside.some((n) => n.section === f.section || f.namedIn.includes(n.key));
    if (ok) placed++;
    console.log(`  [${PASS[f.depth]}] ${f.name} · ${f.section} · ${ok ? "placed" : "NOT beside its section or a naming quote"}`);
    console.log(`     caption: ${(f.caption ?? "(none)").slice(0, 160)}`);
    console.log(`     cue:     ${f.cue ?? "(none)"}`);
    for (const [side, n] of [["before", f.prev], ["after", f.next]] as const) {
      if (n) console.log(`     ${side}:  ${n.section}${f.namedIn.includes(n.key) ? " (names it)" : ""} — ${(n.quote ?? "(a figure)").slice(0, 120)}`);
    }
  }
}
console.log(
  `\n${stops} figure stops; ${placed} beside a quote of their section or one naming them; ` +
    `${routesWithFigures} of ${routesOffered} routes offered figures chose some; figureShrink on ${shrinkRuns} runs.`,
);
