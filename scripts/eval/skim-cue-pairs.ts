/**
 * **The screens, the route comparison and the blind pairs for plan 261006e
 * § Stage 2**: `skim/10` asks a cue to set the scene its quote assumes. Is a
 * reader better prepared, is the finding still kept back, is the scene true,
 * and did the route itself stay where it was?
 *
 *     npx tsx scripts/eval/skim-cue-pairs.ts --a1=<results.json> --a2=<results.json> \
 *       --b=<results.json> --c=<results.json> --out=evals/results/<stem>
 *
 * Reads results files from scripts/eval/skim-coverage-eval.ts. **No model
 * call, nothing read from or written to the database.** The four arms:
 *
 * - **A1, A2** — the OLD arm (`skim/9`) of two runs: the control pair;
 * - **B** — the NEW arm without the passage around each quote;
 * - **C** — the NEW arm with it (`--context`).
 *
 * `--a1` and `--b` are usually one file. An arm's file is refused if it is not
 * the arm it is named as (C must say `context: true`, B must not).
 *
 * It writes, beside `--out`:
 *
 * - `…-screens.md` — per arm: cue lengths, how many are over 140 and over 200,
 *   null cues (`badCue`), the share starting "Look for", the share that ask a
 *   question; then how far each pair of arms' routes differ, per article, so a
 *   difference between A and B can be read against A1 and A2's own (Sol F7);
 * - `…-dangling.json` — the quotes whose own words lean on something they do
 *   not say (`DANGLING`, below), **decided by rule from the quote alone**, so
 *   it cannot depend on any arm's cue or on the judging;
 * - `…-pairs-s1.md` … `-s4.md` and `…-key-s1.json` … — the same quote's cue
 *   under two arms, sides by `blindCoin`. s1 is A1 v A2 (the control), s2 is
 *   A1 v B, s3 is A2 v C, s4 is B v C; nothing in a pairs file says so.
 *
 * A pair is a quote that is a stop with a cue in both arms. The judge is shown
 * the quote, its paragraph and the paragraph before it, and the two cues.
 *
 * Run again once `…-judgment-sN.json` exists (`{ judgments: [{ pair, a,
 * giveaway, invent }] }`) and it joins each to its key and prints who was
 * picked, over all pairs and over the dangling ones.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { blindCoin } from "../../evals/plain-words/run.js";

type Depth = 1 | 2 | 3;
interface Stop {
  quoteId: string;
  depth: Depth;
  again: Depth[];
  quoteFull: string;
  paragraph: string;
  before: string | null;
  cue: string | null;
  section: string;
}
interface Run {
  slug: string;
  arm: "old" | "new";
  run: number;
  version: string;
  context: boolean;
  offered: number;
  costNanos: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  dropped: Record<string, number>;
  stops: Stop[];
}
type ArmName = "A1" | "A2" | "B" | "C";

const arg = (name: string): string | undefined => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found?.slice(name.length + 3);
};
const need = (name: string): string => {
  const v = arg(name);
  if (!v) throw new Error(`--${name}=<file> is required`);
  return v;
};
const base = need("out");

function load(name: ArmName, file: string): Run[] {
  const data = JSON.parse(readFileSync(file, "utf8")) as { context?: boolean; results: Run[]; failures?: unknown[] };
  const arm = name === "A1" || name === "A2" ? "old" : "new";
  const runs = data.results.filter((r) => r.arm === arm);
  if (runs.length === 0) throw new Error(`${name}: ${file} has no ${arm} arm`);
  for (const r of runs) {
    if (name === "C" && !r.context) throw new Error(`C: ${file} was not run with --context`);
    if (name === "B" && r.context) throw new Error(`B: ${file} was run with --context`);
    if (arm === "old" && r.version !== "skim/9") throw new Error(`${name}: ${r.slug} is ${r.version}, not skim/9`);
    if (arm === "new" && r.version !== "skim/10") throw new Error(`${name}: ${r.slug} is ${r.version}, not skim/10`);
  }
  if ((data.failures ?? []).length > 0) console.warn(`${name}: ${file} records ${data.failures!.length} failed runs`);
  return runs;
}
const ARMS: Record<ArmName, Run[]> = {
  A1: load("A1", need("a1")),
  A2: load("A2", need("a2")),
  B: load("B", need("b")),
  C: load("C", need("c")),
};
if (arg("a1") === arg("a2")) throw new Error("A1 and A2 must be two runs, so two files");
const NAMES = ["A1", "A2", "B", "C"] as const;
const slugs = [...new Set(ARMS.A1.map((r) => r.slug))];
const runOf = (arm: ArmName, slug: string): Run | null => ARMS[arm].find((r) => r.slug === slug) ?? null;

/* -------------------------------------------------------------- dangling -- */

/**
 * **A quote "dangles" when its own words lean on something they do not say.**
 * Three rules, over the quote's text and nothing else:
 *
 * 1. it opens on a pronoun or a demonstrative (It, They, This, These, Those,
 *    Such, Its, Their, Both, Neither, He, She);
 * 2. it says "the latter", "the former", "the above" or "aforementioned";
 * 3. it has "this", "these", "those" or "such" before a noun — except where
 *    the noun is the piece itself ("this paper", "this study", …) and except
 *    "such as".
 *
 * Fixed before any pair was judged. It is deliberately a rule and not a
 * reading: over-wide (some "this effect" is explained in the same quote) but
 * blind to every arm.
 */
const SELF = "paper|study|work|article|essay|section|chapter|review|book|report|talk|lecture|thesis|survey|year|time|day|way|is|was|has|can|will|would|may|means|and|or|in|to|of";
const DANGLING: { name: string; re: RegExp }[] = [
  { name: "opens on a pronoun", re: /^["'“‘(\s]*(it|they|this|these|those|such|its|their|both|neither|he|she)\b/i },
  { name: "the latter / the former", re: /\b(the (latter|former|above)|aforementioned)\b/i },
  { name: "this/these/such + noun", re: new RegExp(`\\b(this|these|those|such)\\s+(?!(?:${SELF}|as)\\b)[a-z-]+`, "i") },
];
const danglingOf = (quote: string): string[] => DANGLING.filter((d) => d.re.test(quote)).map((d) => d.name);

const quoteText = new Map<string, string>();
for (const name of NAMES) for (const r of ARMS[name]) for (const s of r.stops) quoteText.set(`${r.slug}/${s.quoteId}`, s.quoteFull);
const dangling = new Map<string, string[]>();
for (const [key, text] of quoteText) {
  const why = danglingOf(text);
  if (why.length > 0) dangling.set(key, why);
}
writeFileSync(
  `${base}-dangling.json`,
  JSON.stringify({ rules: DANGLING.map((d) => ({ name: d.name, re: d.re.source })), quotes: quoteText.size, dangling: [...dangling].map(([key, why]) => ({ key, why, quote: quoteText.get(key) })) }, null, 2),
);

/* ---------------------------------------------------------------- screens -- */

const out: string[] = [`# skim/9 vs skim/10: screens and routes`, ""];
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.floor(s.length / 2)]!;
};
const pct = (n: number, of: number): string => (of === 0 ? "–" : `${Math.round((100 * n) / of)}%`);

out.push("## Cues, per arm", "");
/**
 * A cue that leans on something the reader met elsewhere: "the measure just
 * described", "the earlier drop", "is now tested". **Written after reading
 * the B and C cues**, where the pattern showed, so it is a count of what was
 * seen and not a pre-set test; it misses any wording not listed.
 */
const ELSEWHERE = /\b(just (given|described|seen|introduced|shown|mentioned)|earlier (setup|drop|result|finding|section|claim|point)|the earlier|already (introduced|described|seen|shown)|as before|previous(ly)?|is now|are now|so far|the next|above)\b/i;
out.push("| Arm | stops | null cues (`badCue`) | length: median · mean · max | over 140 | over 200 | start \"Look for\" | ask a question | lean on elsewhere | cost | input tokens / call | output / call |");
out.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const name of NAMES) {
  const runs = ARMS[name];
  const stops = runs.flatMap((r) => r.stops);
  const cues = stops.map((s) => s.cue).filter((c): c is string => c !== null);
  const lens = cues.map((c) => c.length);
  const mean = (f: (r: Run) => number) => Math.round(runs.reduce((n, r) => n + f(r), 0) / runs.length);
  out.push(
    `| ${name} (${runs[0]!.version}${runs[0]!.context ? ", passages" : ""}) | ${stops.length} | ${stops.length - cues.length} | ${median(lens)} · ${Math.round(lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length))} · ${Math.max(0, ...lens)} | ${lens.filter((l) => l > 140).length} | ${lens.filter((l) => l > 200).length} | ${pct(cues.filter((c) => /^look for\b/i.test(c)).length, cues.length)} | ${pct(cues.filter((c) => c.includes("?")).length, cues.length)} | ${cues.filter((c) => ELSEWHERE.test(c)).length} | $${(runs.reduce((n, r) => n + r.costNanos, 0) / 1e9).toFixed(4)} | ${mean((r) => r.inputTokens)} | ${mean((r) => r.outputTokens)} |`,
  );
}
out.push("", "A null cue is one the validator refused: empty, or over the arm's cap (140 for `skim/9`, 200 for `skim/10`). So \"over 140\" is 0 by construction for A1 and A2, and their over-long cues show as null cues.", "");

out.push("## Did the route move? (Sol F7)", "");
out.push(
  "For each article and each pair of arms: `stops` = quotes on both routes / quotes on either; `depth` = of the shared quotes, how many sit at the same depth; `again` = how many are carried into the same passes; `order` = of the pairs of shared quotes, how many come in the same order in both routes. **A1 v A2 is the control**: two runs of one prompt.",
  "",
);
const PAIRS: [ArmName, ArmName][] = [["A1", "A2"], ["A1", "B"], ["A2", "B"], ["A1", "C"], ["A2", "C"], ["B", "C"]];
out.push(`| Article | sizes A1 · A2 · B · C (Gist/More/Most) | ${PAIRS.map(([x, y]) => `${x} v ${y}`).join(" | ")} |`);
out.push(`|---|---|${PAIRS.map(() => "---").join("|")}|`);
const totals = new Map<string, { both: number; either: number; depth: number; again: number; ordSame: number; ordAll: number }>();
for (const slug of slugs) {
  const sizes = NAMES.map((n) => {
    const r = runOf(n, slug);
    return r ? ([1, 2, 3] as const).map((d) => r.stops.filter((s) => s.depth === d).length).join("/") : "FAILED";
  }).join(" · ");
  const cells = PAIRS.map(([x, y]) => {
    const a = runOf(x, slug);
    const b = runOf(y, slug);
    if (!a || !b) return "–";
    const pa = new Map(a.stops.map((s, i) => [s.quoteId, { s, i }]));
    const pb = new Map(b.stops.map((s, i) => [s.quoteId, { s, i }]));
    const shared = [...pa.keys()].filter((k) => pb.has(k));
    const either = new Set([...pa.keys(), ...pb.keys()]).size;
    const depth = shared.filter((k) => pa.get(k)!.s.depth === pb.get(k)!.s.depth).length;
    const again = shared.filter((k) => pa.get(k)!.s.again.join() === pb.get(k)!.s.again.join()).length;
    let ordSame = 0;
    let ordAll = 0;
    for (let i = 0; i < shared.length; i++) {
      for (let j = i + 1; j < shared.length; j++) {
        ordAll++;
        const da = pa.get(shared[i]!)!.i - pa.get(shared[j]!)!.i;
        const db = pb.get(shared[i]!)!.i - pb.get(shared[j]!)!.i;
        if (da * db > 0) ordSame++;
      }
    }
    const t = totals.get(`${x} v ${y}`) ?? { both: 0, either: 0, depth: 0, again: 0, ordSame: 0, ordAll: 0 };
    t.both += shared.length;
    t.either += either;
    t.depth += depth;
    t.again += again;
    t.ordSame += ordSame;
    t.ordAll += ordAll;
    totals.set(`${x} v ${y}`, t);
    return `stops ${shared.length}/${either} · depth ${depth}/${shared.length} · again ${again}/${shared.length} · order ${pct(ordSame, ordAll)}`;
  });
  out.push(`| ${slug} | ${sizes} | ${cells.join(" | ")} |`);
}
out.push(
  `| **all** | | ${PAIRS.map(([x, y]) => {
    const t = totals.get(`${x} v ${y}`);
    return t ? `stops ${pct(t.both, t.either)} · depth ${pct(t.depth, t.both)} · again ${pct(t.again, t.both)} · order ${pct(t.ordSame, t.ordAll)}` : "–";
  }).join(" | ")} |`,
);
out.push("", `Dangling quotes by rule: ${dangling.size} of ${quoteText.size} quotes on any route (${DANGLING.map((d) => `${d.name}: ${[...dangling.values()].filter((w) => w.includes(d.name)).length}`).join("; ")}).`, "");
writeFileSync(`${base}-screens.md`, out.join("\n"));
console.log(out.join("\n"));

/* ------------------------------------------------------------ blind pairs -- */

const SETS: { name: string; first: ArmName; second: ArmName; seed: number }[] = [
  { name: "s1", first: "A1", second: "A2", seed: Number(arg("seed1") ?? 26100601) },
  { name: "s2", first: "A1", second: "B", seed: Number(arg("seed2") ?? 26100602) },
  { name: "s3", first: "A2", second: "C", seed: Number(arg("seed3") ?? 26100603) },
  { name: "s4", first: "B", second: "C", seed: Number(arg("seed4") ?? 26100604) },
];
const clipHead = (t: string, max: number): string => (t.length > max ? `${t.slice(0, max)}…` : t);
const clipTail = (t: string, max: number): string => (t.length > max ? `…${t.slice(t.length - max)}` : t);

interface KeyRow {
  pair: number;
  slug: string;
  quoteId: string;
  dangling: boolean;
  A: ArmName;
  B: ArmName;
}

for (const set of SETS) {
  const coin = blindCoin(set.seed);
  const md: string[] = [
    "# Blind pairs: two cues for one quoted line",
    "",
    "A reader is skimming an article they have **not read**, usually a research paper from a field they have not studied. They are shown one stop at a time: a **cue** (one line written by a model) and then a **quote** (a line cut out of the article). The cue is there to get them ready for the quote. It may say what to look for. It must **not** say what the passage found or concluded: the reader is meant to get that from the passage.",
    "",
    "Each pair below is one quote and two candidate cues for it, A and B. You are also shown the quote's own paragraph and the paragraph before it. **The reader does not see those before the cue**; they are there so that you can check a cue against the text.",
    "",
    "For each pair, answer three questions:",
    "",
    "- **(a) better prepared:** which cue better prepares a reader who has not read the article to understand this quote: so that they know what is at stake, what is being compared, and what words like \"this\", \"the latter\" or \"their approach\" in the quote refer to? `A`, `B` or `tie`.",
    "- **(b) gives it away:** does either cue state what the passage found, concluded or chose, so that the reader has the answer before reading? Asking the question, or naming the options, is not giving it away. `A`, `B`, `both` or `neither`.",
    "- **(c) invents or misstates:** does either cue say something about the context that the paragraphs shown do not support, or that gets them wrong? `A`, `B`, `both` or `neither`.",
    "",
    "Judge each pair on its own, only from what is on the page.",
    "",
  ];
  const key: KeyRow[] = [];
  let firstOnA = 0;
  let n = 0;
  let skippedNull = 0;
  for (const slug of slugs) {
    const first = runOf(set.first, slug);
    const second = runOf(set.second, slug);
    if (!first || !second) continue;
    const inSecond = new Map(second.stops.map((s) => [s.quoteId, s]));
    for (const s of first.stops) {
      const other = inSecond.get(s.quoteId);
      if (!other) continue;
      if (s.cue === null || other.cue === null) {
        skippedNull++;
        continue;
      }
      const flip = coin();
      if (!flip) firstOnA++;
      const [a, b] = flip ? [other, s] : [s, other];
      n++;
      key.push({ pair: n, slug, quoteId: s.quoteId, dangling: dangling.has(`${slug}/${s.quoteId}`), A: flip ? set.second : set.first, B: flip ? set.first : set.second });
      md.push(
        `## Pair ${n}`,
        "",
        `**The paragraph before:** ${s.before === null ? "(none: the quote's paragraph opens the article)" : clipTail(s.before, 1500)}`,
        "",
        `**The quote's paragraph** [section: ${s.section}]: ${clipHead(s.paragraph, 3000)}`,
        "",
        `**The quote:** ${s.quoteFull}`,
        "",
        `**Cue A:** ${a.cue}`,
        "",
        `**Cue B:** ${b.cue}`,
        "",
        "---",
        "",
      );
    }
  }
  writeFileSync(`${base}-pairs-${set.name}.md`, md.join("\n"));
  writeFileSync(`${base}-key-${set.name}.json`, JSON.stringify({ set: set.name, first: set.first, second: set.second, seed: set.seed, key }, null, 2));
  console.log(
    `${set.name} (${set.first} v ${set.second}): ${n} pairs, ${key.filter((k) => k.dangling).length} dangling; ${set.first} is on side A in ${firstOnA} and on side B in ${n - firstOnA} (seed ${set.seed}); ${skippedNull} shared quotes skipped for a null cue`,
  );
}

/* ---------------------------------------------------------------- scoring -- */

type Pick3 = "A" | "B" | "tie";
type Pick4 = "A" | "B" | "both" | "neither";
for (const set of SETS) {
  const path = `${base}-judgment-${set.name}.json`;
  if (!existsSync(path)) continue;
  const { key } = JSON.parse(readFileSync(`${base}-key-${set.name}.json`, "utf8")) as { key: KeyRow[] };
  const { judgments } = JSON.parse(readFileSync(path, "utf8")) as {
    judgments: { pair: number; a: Pick3; giveaway: Pick4; invent: Pick4 }[];
  };
  if (judgments.length !== key.length) console.warn(`${set.name}: ${judgments.length} judgments for ${key.length} pairs`);
  for (const subset of ["all", "dangling", "not dangling"] as const) {
    const rows = judgments.flatMap((j) => {
      const k = key.find((x) => x.pair === j.pair);
      if (!k) throw new Error(`${set.name}: no key for pair ${j.pair}`);
      return subset === "all" || (subset === "dangling") === k.dangling ? [{ j, k }] : [];
    });
    const better = { [set.first]: 0, [set.second]: 0, tie: 0 } as Record<string, number>;
    const give = { [set.first]: 0, [set.second]: 0 } as Record<string, number>;
    const invent = { [set.first]: 0, [set.second]: 0 } as Record<string, number>;
    const side = { A: 0, B: 0, tie: 0 };
    for (const { j, k } of rows) {
      side[j.a]++;
      better[j.a === "tie" ? "tie" : k[j.a]]!++;
      for (const [field, tally] of [["giveaway", give], ["invent", invent]] as const) {
        const v = j[field];
        if (v === "A" || v === "both") tally[k.A]!++;
        if (v === "B" || v === "both") tally[k.B]!++;
      }
    }
    console.log(
      `${set.name} ${set.first} v ${set.second} [${subset}, ${rows.length}]: better ${set.first} ${better[set.first]}, ${set.second} ${better[set.second]}, tie ${better.tie} · gives away ${set.first} ${give[set.first]}, ${set.second} ${give[set.second]} · invents ${set.first} ${invent[set.first]}, ${set.second} ${invent[set.second]}${subset === "all" ? ` · judge picked side A ${side.A}, side B ${side.B}, tie ${side.tie}` : ""}`,
    );
  }
}
