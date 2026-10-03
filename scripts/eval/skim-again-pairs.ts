/**
 * **The tables and the blind read for plan 261003l § Stage 2**: `skim/9` lets
 * a stop be walked in more than one pass (`again`). How much does it carry,
 * did anything else move, and does More read as one connected walk?
 *
 *     npx tsx scripts/eval/skim-again-pairs.ts <results.json>
 *
 * Reads a results file from scripts/eval/skim-coverage-eval.ts (OLD =
 * `skim/8`, NEW = `skim/9`, two runs each). **No model call, nothing read from
 * or written to the database.** Prints the tables as Markdown and writes,
 * beside the results file and with nothing in a pairs file that names an arm:
 *
 * - `…-again-stats.md` — the tables printed here;
 * - `…-again-blind-pairs.md` / `…-again-blind-key.json` — OLD run *n* against
 *   NEW run *n*, for each article and each run;
 * - `…-again-control-pairs.md` / `…-again-control-key.json` — OLD run 1
 *   against OLD run 2, the noise control, in the same format;
 * - `…-again-carried.md` — every carried stop of the NEW routes, in the pass
 *   it is carried into, for the unblinded "bridge, repeat or superseded" read.
 *
 * A candidate is shown as **its own Gist walk, then its own More walk**, each
 * stop with its cue, quote and whole paragraph (Sol F2 on plan 261003l): the
 * two arms are different routes, so each More is judged against the Gist its
 * reader actually walked. More is drawn as the client draws it — the stops
 * with `depth === 2` plus those whose `again` includes 2, in route order. An
 * OLD route has no `again`, so its More is its depth-2 stops. Nothing in the
 * pairs file marks a stop as carried.
 *
 * Sides are assigned per pair by `blindCoin` (evals/plain-words/run.ts), the
 * key is written before any judging, and the balance is printed: a judge with
 * a side preference looks like a prompt effect if one arm sits on one side.
 * `--seed=` and `--control-seed=` change the coin when a key comes out lopsided.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { blindCoin } from "../../evals/plain-words/run.js";

type Depth = 1 | 2 | 3;
interface Stop {
  depth: Depth;
  again: Depth[];
  quoteFull: string;
  paragraph: string;
  cue: string | null;
  section: string;
  ideasIn: string[];
}
interface Row {
  depth: Depth;
  stops: number;
  ideasIn: number;
  ideasInOrBeside: number;
  ideasTotal: number;
  sectionsWithStop: number;
  contentSections: number;
}
interface Run {
  slug: string;
  arm: "old" | "new";
  run: number;
  version: string;
  offered: number;
  rows: Row[];
  costNanos: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  model: string | null;
  dropped: Record<string, number>;
  walks: { depth: Depth; length: number; own: number; carried: number }[];
  stops: Stop[];
}

const file = process.argv[2];
if (!file) throw new Error("usage: skim-again-pairs.ts <results.json>");
const seedArg = process.argv.find((a) => a.startsWith("--seed="));
const SEED = seedArg ? Number(seedArg.slice("--seed=".length)) : 261003;
/* The control's own seed. 261004 and 261005 each put OLD run 1 on side B in 5
   of 6 pairs, seen before any judging; 261006 is the first that came out 3
   and 3. Neighbouring seeds of this LCG give similar first draws, so check
   the printed balance rather than trusting a new seed. */
const controlSeedArg = process.argv.find((a) => a.startsWith("--control-seed="));
const CONTROL_SEED = controlSeedArg ? Number(controlSeedArg.slice("--control-seed=".length)) : 261006;
const data = JSON.parse(readFileSync(file, "utf8")) as {
  results: Run[];
  failures?: { slug: string; arm: string; run: number; message: string }[];
};
/* `--old-from=<results.json>`: take the OLD runs from another results file,
   for a NEW arm that was run on its own (`--new-only`) after the wording
   changed. The OLD routes, and so the control pairs, are then the same ones. */
const oldFromArg = process.argv.find((a) => a.startsWith("--old-from="));
const results: Run[] = oldFromArg
  ? [
      ...(JSON.parse(readFileSync(oldFromArg.slice("--old-from=".length), "utf8")) as { results: Run[] }).results.filter(
        (r) => r.arm === "old",
      ),
      ...data.results.filter((r) => r.arm === "new"),
    ]
  : data.results;
const base = file.replace(/\.json$/, "");
const slugs = [...new Set(results.map((r) => r.slug))];
const find = (slug: string, arm: Run["arm"], run: number): Run | null =>
  results.find((x) => x.slug === slug && x.arm === arm && x.run === run) ?? null;
const PASS = { 1: "Gist", 2: "More", 3: "Most" } as const;

/** Pass `d` as the reader walks it: its own stops plus those carried into it, in route order. */
const walk = (r: Run, d: Depth): Stop[] => r.stops.filter((s) => s.depth === d || s.again.includes(d));
const pct = (n: number, of: number): string => (of === 0 ? "–" : `${Math.round((100 * n) / of)}%`);

/* ----------------------------------------------------------------- tables -- */

const out: string[] = [];
out.push(`# skim/8 vs skim/9: what the results file says`, "", `From \`${file}\`.`, "");

out.push("## 1. How much the NEW routes carry", "");
out.push("Walk length = own stops + carried stops. Share = carried / walk length.", "");
out.push("| Article | offered | run | More: walk · carried · share | Most: walk · carried · share | carried Gist→More | Gist→Most | More→Most | badAgain | overCarried |");
out.push("|---|---|---|---|---|---|---|---|---|---|");
for (const slug of slugs) {
  for (const run of [1, 2]) {
    const r = find(slug, "new", run);
    if (!r) {
      out.push(`| ${slug} | | ${run} | FAILED | | | | | |`);
      continue;
    }
    const w = (d: Depth) => r.walks.find((x) => x.depth === d)!;
    const cell = (d: Depth) => `${w(d).length} · ${w(d).carried} · ${pct(w(d).carried, w(d).length)}`;
    const n = (from: Depth, to: Depth) => r.stops.filter((s) => s.depth === from && s.again.includes(to)).length;
    out.push(
      `| ${slug} | ${r.offered} | ${run} | ${cell(2)} | ${cell(3)} | ${n(1, 2)} of ${r.stops.filter((s) => s.depth === 1).length} | ${n(1, 3)} | ${n(2, 3)} of ${r.stops.filter((s) => s.depth === 2).length} | ${r.dropped.badAgain ?? 0} | ${r.dropped.overCarried ?? 0} |`,
    );
  }
}
out.push("");

out.push("## 2. Did anything else move?", "");
out.push("First-placed pass sizes (stops with depth 1 / 2 / 3), which is what the caps and targets count.", "");
out.push("| Article | OLD 1 | OLD 2 | NEW 1 | NEW 2 |", "|---|---|---|---|---|");
const each = (slug: string, f: (r: Run) => string): string =>
  (["old", "new"] as const)
    .flatMap((arm) => [1, 2].map((run) => find(slug, arm, run)))
    .map((r) => (r ? f(r) : "FAILED"))
    .join(" | ");
for (const slug of slugs) {
  out.push(`| ${slug} | ${each(slug, (r) => ([1, 2, 3] as const).map((d) => r.stops.filter((s) => s.depth === d).length).join(" / "))} |`);
}
out.push("", "Ideas with a stop on one of their own paragraphs (\"in\"), cumulative at Gist / More / Most, of the article's Ideas.", "");
out.push("| Article (Ideas) | OLD 1 | OLD 2 | NEW 1 | NEW 2 |", "|---|---|---|---|---|");
for (const slug of slugs) {
  const total = results.find((r) => r.slug === slug)?.rows[0]?.ideasTotal ?? 0;
  out.push(`| ${slug} (${total}) | ${each(slug, (r) => r.rows.map((w) => w.ideasIn).join(" / "))} |`);
}
out.push("", "Ideas \"in or beside\", the same way.", "");
out.push("| Article | OLD 1 | OLD 2 | NEW 1 | NEW 2 |", "|---|---|---|---|---|");
for (const slug of slugs) out.push(`| ${slug} | ${each(slug, (r) => r.rows.map((w) => w.ideasInOrBeside).join(" / "))} |`);
out.push("", "Content sections with a stop, cumulative at Gist / More / Most.", "");
out.push("| Article (sections) | OLD 1 | OLD 2 | NEW 1 | NEW 2 |", "|---|---|---|---|---|");
for (const slug of slugs) {
  const total = results.find((r) => r.slug === slug)?.rows[0]?.contentSections ?? 0;
  out.push(`| ${slug} (${total}) | ${each(slug, (r) => r.rows.map((w) => w.sectionsWithStop).join(" / "))} |`);
}

/* Which quotes sit at which first depth: how many of the offered quotes two routes place at the same depth. */
const placed = (r: Run): Map<string, Depth> => new Map(r.stops.map((s) => [s.quoteFull, s.depth]));
const agree = (a: Run | null, b: Run | null): string => {
  if (!a || !b) return "–";
  const pa = placed(a);
  const pb = placed(b);
  const keys = new Set([...pa.keys(), ...pb.keys()]);
  let same = 0;
  for (const k of keys) if (pa.get(k) === pb.get(k)) same++;
  return `${same}/${keys.size}`;
};
out.push("", "Quotes two routes place at the same first depth (of the quotes either route uses).", "");
out.push("| Article | OLD 1 v OLD 2 (control) | NEW 1 v NEW 2 | OLD 1 v NEW 1 | OLD 2 v NEW 2 | OLD 1 v NEW 2 | OLD 2 v NEW 1 |", "|---|---|---|---|---|---|---|");
for (const slug of slugs) {
  const o1 = find(slug, "old", 1), o2 = find(slug, "old", 2), n1 = find(slug, "new", 1), n2 = find(slug, "new", 2);
  out.push(`| ${slug} | ${agree(o1, o2)} | ${agree(n1, n2)} | ${agree(o1, n1)} | ${agree(o2, n2)} | ${agree(o1, n2)} | ${agree(o2, n1)} |`);
}

/* Order. Is the route the Gist stops and then the rest, and does a carried
   stop sit at the head of the deeper walk or among that pass's own stops? */
out.push("", "## 3. Order: Gist first, and where a carried stop sits", "");
out.push(
  "`Gist first` = every depth-1 stop is listed before any deeper stop in the route. `recap at the head` = in the More walk, every carried stop comes before every stop of More's own. `beside its own` = carried stops in the More walk with one of More's own stops directly before or after.",
  "",
);
out.push("| Article | arm#run | Gist first | carried into More | recap at the head | beside its own |", "|---|---|---|---|---|---|");
const orderTally = new Map<string, { runs: number; gistFirst: number; carrying: number; recap: number }>();
for (const slug of slugs) {
  for (const arm of ["old", "new"] as const) {
    for (const run of [1, 2]) {
      const r = find(slug, arm, run);
      if (!r) continue;
      const lastGist = r.stops.map((s) => s.depth).lastIndexOf(1);
      const firstDeeper = r.stops.findIndex((s) => s.depth !== 1);
      const gistFirst = firstDeeper === -1 || lastGist < firstDeeper;
      const more = walk(r, 2);
      const isCarried = more.map((s) => s.depth !== 2);
      const n = isCarried.filter(Boolean).length;
      const recap = n > 0 && isCarried.lastIndexOf(true) < isCarried.indexOf(false);
      const beside = isCarried.filter((c, i) => c && (isCarried[i - 1] === false || isCarried[i + 1] === false)).length;
      const t = orderTally.get(arm) ?? { runs: 0, gistFirst: 0, carrying: 0, recap: 0 };
      t.runs++;
      if (gistFirst) t.gistFirst++;
      if (n > 0) t.carrying++;
      if (recap) t.recap++;
      orderTally.set(arm, t);
      out.push(
        `| ${slug} | ${arm}#${run} | ${gistFirst ? "yes" : "no"} | ${n} | ${n === 0 ? "–" : recap ? "yes" : "no"} | ${n === 0 ? "–" : `${beside} of ${n}`} |`,
      );
    }
  }
}
for (const [arm, t] of orderTally) {
  out.push("", `${arm}: Gist first in ${t.gistFirst} of ${t.runs} routes; recap at the head in ${t.recap} of the ${t.carrying} runs that carry into More.`);
}

out.push("", "## 4. Validity and cost", "");
out.push("| Arm | calls | failures | badAgain | overCarried | other drops (not `collapsed`) | cost | input tokens / call | output tokens / call | thinking tokens / call | model |", "|---|---|---|---|---|---|---|---|---|---|---|");
for (const arm of ["old", "new"] as const) {
  const rs = results.filter((r) => r.arm === arm);
  const mean = (f: (r: Run) => number) => Math.round(rs.reduce((n, r) => n + f(r), 0) / Math.max(1, rs.length));
  const other = rs.reduce(
    (n, r) => n + Object.entries(r.dropped).reduce((m, [k, v]) => (k === "collapsed" || k === "badAgain" || k === "overCarried" ? m : m + v), 0),
    0,
  );
  const thinking = rs.every((r) => r.reasoningTokens === null) ? "not reported" : String(mean((r) => r.reasoningTokens ?? 0));
  out.push(
    `| ${arm} (${rs[0]?.version ?? "?"}) | ${rs.length} | ${(data.failures ?? []).filter((f) => f.arm === arm).length} | ${rs.reduce((n, r) => n + (r.dropped.badAgain ?? 0), 0)} | ${rs.reduce((n, r) => n + (r.dropped.overCarried ?? 0), 0)} | ${other} | $${(rs.reduce((n, r) => n + r.costNanos, 0) / 1e9).toFixed(4)} | ${mean((r) => r.inputTokens)} | ${mean((r) => r.outputTokens)} | ${thinking} | ${[...new Set(rs.map((r) => r.model))].join(", ")} |`,
  );
}
for (const f of data.failures ?? []) out.push("", `FAILED ${f.slug} ${f.arm}#${f.run}: ${f.message}`);
out.push("");
writeFileSync(`${base}-again-stats.md`, out.join("\n"));
console.log(out.join("\n"));

/* ------------------------------------------------------------ blind pairs -- */

function stopLines(s: Stop, n: number): string[] {
  return [
    `${n}. **Cue:** ${s.cue ?? "(none)"}`,
    `   **Quote:** ${s.quoteFull}`,
    `   **Its paragraph** [${s.section}]: ${s.paragraph}`,
    "",
  ];
}

function candidate(r: Run): string {
  const gist = walk(r, 1);
  const more = walk(r, 2);
  const lines = [`**Its Gist walk (${gist.length} stops):**`, ""];
  for (const [i, s] of gist.entries()) lines.push(...stopLines(s, i + 1));
  lines.push(`**Its More walk (${more.length} stops):**`, "");
  for (const [i, s] of more.entries()) lines.push(...stopLines(s, i + 1));
  return lines.join("\n");
}

type Pairing = { slug: string; first: Run; second: Run };

function writePairs(name: string, title: string, pairings: Pairing[], seed: number): void {
  const coin = blindCoin(seed);
  const tag = (r: Run) => `${r.arm}#${r.run}`;
  const md: string[] = [
    `# ${title}`,
    "",
    "A *skim* is a route through an article's own best lines. The reader walks it one stop at a time: at each stop they see a cue (what to look for) and a quoted line, and read the paragraph around it in the article. A route has passes. **Gist** is the first, a handful of stops. **More** is the second, a separate walk the reader takes for more detail.",
    "",
    "Each pair below is one article and two candidate routes, A and B. Each candidate is shown as its own Gist walk and then its own More walk. For each pair, answer two questions:",
    "",
    "- **(a) after Gist:** for a reader who has just walked that candidate's own Gist, which candidate's More reads more as one connected walk (each stop following from the ones around it, no loose ends)? `A`, `B` or `tie`.",
    "- **(b) starting at More:** for a reader who skips Gist and starts at More, which candidate's More gives a more complete, less disjointed picture of the article? `A`, `B` or `tie`.",
    "",
    "Give a one-line reason for each. Judge only what is on the page.",
    "",
  ];
  const key: { pair: number; slug: string; A: string; B: string }[] = [];
  let firstOnA = 0;
  pairings.forEach((p, i) => {
    const flip = coin();
    const [a, b] = flip ? [p.second, p.first] : [p.first, p.second];
    if (!flip) firstOnA++;
    key.push({ pair: i + 1, slug: p.slug, A: tag(a), B: tag(b) });
    md.push(`## Pair ${i + 1}`, "", "### Candidate A", "", candidate(a), "", "### Candidate B", "", candidate(b), "", "---", "");
  });
  writeFileSync(`${base}-${name}-pairs.md`, md.join("\n"));
  writeFileSync(`${base}-${name}-key.json`, JSON.stringify({ seed, key }, null, 2));
  console.log(
    `${name}: ${pairings.length} pairs; the first-named arm is on side A in ${firstOnA} and on side B in ${pairings.length - firstOnA} (seed ${seed})`,
  );
}

const treatment: Pairing[] = [];
const control: Pairing[] = [];
for (const slug of slugs) {
  for (const run of [1, 2]) {
    const o = find(slug, "old", run);
    const n = find(slug, "new", run);
    if (o && n) treatment.push({ slug, first: o, second: n });
  }
  const o1 = find(slug, "old", 1);
  const o2 = find(slug, "old", 2);
  if (o1 && o2) control.push({ slug, first: o1, second: o2 });
}
writePairs("again-blind", "Blind pairs: two candidate skim routes per article", treatment, SEED);
writePairs("again-control", "Blind pairs: two candidate skim routes per article (set 2)", control, CONTROL_SEED);

/* ---------------------------------------------------------- carried stops -- */

const carried: string[] = [
  "# The carried stops of the NEW (`skim/9`) routes",
  "",
  "A skim route has three passes, each walked on its own: Gist, More, Most. A stop belongs to one pass, and the route may also **carry** it into a deeper pass, where the reader meets it again among that pass's own stops. Below, for every NEW route and every pass that has a carried stop, the whole walk of that pass is listed in order, and each carried stop is marked `CARRIED` with an id.",
  "",
  "For each carried stop, classify it as one of:",
  "",
  "- **bridge** — a useful bridge or main point: the pass's own stops lean on it, or a reader starting at this pass would miss a main point without it;",
  "- **repeat** — a redundant repeat: the pass reads as well without it;",
  "- **superseded** — the same pass already has finer stops that say the same thing in more detail.",
  "",
  "And say for each whether, in this walk, it is **adjacent** (directly before or after) to a stop it pairs with or that explains it: yes or no.",
  "",
  "One line each: `id: bridge|repeat|superseded; adjacent yes|no — reason`.",
  "",
];
let nCarried = 0;
for (const slug of slugs) {
  for (const run of [1, 2]) {
    const r = find(slug, "new", run);
    if (!r) continue;
    for (const d of [2, 3] as const) {
      const w = walk(r, d);
      if (!w.some((s) => s.depth !== d)) continue;
      carried.push(`## ${slug}, run ${run}, ${PASS[d]} walk (${w.length} stops)`, "");
      w.forEach((s, i) => {
        const isCarried = s.depth !== d;
        if (isCarried) nCarried++;
        const mark = isCarried ? ` **CARRIED from ${PASS[s.depth]} — id C${nCarried}**` : "";
        carried.push(
          `${i + 1}.${mark} [${s.section}]`,
          `   **Cue:** ${s.cue ?? "(none)"}`,
          `   **Quote:** ${s.quoteFull}`,
          ...(isCarried ? [`   **Its paragraph:** ${s.paragraph}`] : []),
          "",
        );
      });
    }
  }
}
writeFileSync(`${base}-again-carried.md`, carried.join("\n"));
console.log(`carried: ${nCarried} carried stops written to ${base}-again-carried.md`);

/* ---------------------------------------------------------------- scoring -- */

/* Once a judge's answers are saved as `…-again-<name>-judgment.json`
   (`{ judgments: [{ pair, a, b }] }`, each "A", "B" or "tie"), a re-run joins
   them to the key and prints who was picked. The pairs and keys it rewrites
   on the way are the same bytes: the coin is seeded. */
for (const name of ["again-blind", "again-control"]) {
  const path = `${base}-${name}-judgment.json`;
  if (!existsSync(path)) continue;
  const { key } = JSON.parse(readFileSync(`${base}-${name}-key.json`, "utf8")) as {
    key: { pair: number; slug: string; A: string; B: string }[];
  };
  const { judgments } = JSON.parse(readFileSync(path, "utf8")) as {
    judgments: { pair: number; a: "A" | "B" | "tie"; b: "A" | "B" | "tie" }[];
  };
  for (const q of ["a", "b"] as const) {
    const tally = new Map<string, number>();
    const sides = { A: 0, B: 0, tie: 0 };
    const each: string[] = [];
    for (const j of judgments) {
      const k = key.find((x) => x.pair === j.pair);
      if (!k) throw new Error(`${name}: no key for pair ${j.pair}`);
      const pick = j[q];
      sides[pick]++;
      const who = pick === "tie" ? "tie" : k[pick];
      /* The treatment set is scored by arm; the control by run, both being OLD. */
      const bucket = name === "again-control" || who === "tie" ? who : who.split("#")[0]!;
      tally.set(bucket, (tally.get(bucket) ?? 0) + 1);
      each.push(`${j.pair} ${k.slug.split("-")[0]}: ${who}`);
    }
    console.log(
      `${name} (${q}): ${[...tally].map(([k, n]) => `${k} ${n}`).join(", ")} · side A ${sides.A}, side B ${sides.B}, tie ${sides.tie} · ${each.join("; ")}`,
    );
  }
}
