/**
 * **The screens and the blind pairs for plan 261009j**: `skim/11` makes a
 * cue optional. Is a reader better placed by the new cue — or by its absence —
 * than by the old one, beyond the old prompt's own run-to-run noise? Do the
 * cues it keeps echo the quote less, without giving more away or saying more
 * that the records do not support? And when it leaves one out, was one needed?
 *
 *     npx tsx scripts/eval/skim-cue-optional-pairs.ts --a1=<results.json> \
 *       --a2=<results.json> --b1=<results.json> --b2=<results.json> \
 *       [--file=<slug>=<inputs.json> …] --out=evals/results/<stem>
 *
 * Reads results files from scripts/eval/skim-coverage-eval.ts. **No model
 * call, nothing read from or written to the database.** The arms:
 *
 * - **A1, A2** — `skim/10`, two `--old-only` runs: the control;
 * - **B1, B2** — `skim/11`, two `--new-only` runs, so B has a spread of its
 *   own (GPT Sol's plan review, F3).
 *
 * `--file=` names the inputs of an article read from production
 * (scripts/eval/skim-inputs-from-production.ts), for its Ideas' statements;
 * a local article's are in the results file's `snapshot`.
 *
 * It writes, beside `--out`:
 *
 * - `…-screens.md` — per arm and article: stops, cues kept, cues left out,
 *   cue lengths and cost; the stops that are not in every arm (the pairs
 *   cannot judge those, so they are listed to read by hand — Sol F2); then
 *   every cue B1 and B2 kept, beside A1's;
 * - `…-pairs-s1.md` … `-s3.md` and `…-key-s1.json` … — s1 is A1 v A2 (the
 *   control), s2 A1 v B1, s3 A2 v B2. **One population for all three**: the
 *   quotes that are a stop in all four arms (Sol F2). Sides by `blindCoin`;
 *   each side is the arm's cue or "(no question)". A quote with no cue on
 *   either side is not a pair, and is counted apart. The judge sees what the
 *   model saw (the section, the quote, the key ideas it carries) apart from
 *   the article's paragraphs, so "licensed by the records" and "true of the
 *   article" are two questions (Sol F4).
 *
 * Run it again once `…-judgment-sN-<judge>.json` files exist and it joins
 * each to its key and prints, per comparison and judge: who was preferred,
 * overall, per article and by kind of pair; a two-sided sign test over the
 * untied pairs; and per arm the echo, giveaway, unlicensed and untrue counts
 * per cue judged, and how many of its empty sides were judged to need a
 * question (Sol F1).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { blindCoin } from "../../evals/plain-words/run.js";

interface Stop {
  quoteId: string;
  quoteFull: string;
  paragraph: string;
  before: string | null;
  cue: string | null;
  section: string;
  ideasIn?: string[];
}
interface Run {
  slug: string;
  arm: "old" | "new";
  version: string;
  costNanos: number;
  dropped: Record<string, number>;
  stops: Stop[];
}
type ArmName = "A1" | "A2" | "B1" | "B2";
const ARM_NAMES: readonly ArmName[] = ["A1", "A2", "B1", "B2"];

const args = process.argv.slice(2);
const arg = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const need = (name: string): string => {
  const v = arg(name);
  if (!v) throw new Error(`--${name}=<file> is required`);
  return v;
};
const base = need("out");

interface Snapshot {
  [slug: string]: { ideas?: unknown };
}
const snapshots: Snapshot = {};
function load(name: ArmName, file: string): Run[] {
  const data = JSON.parse(readFileSync(file, "utf8")) as { results: Run[]; failures?: unknown[]; snapshot?: Snapshot };
  const arm = name.startsWith("B") ? "new" : "old";
  const want = name.startsWith("B") ? "skim/11" : "skim/10";
  const runs = data.results.filter((r) => r.arm === arm);
  if (runs.length === 0) throw new Error(`${name}: ${file} has no ${arm} arm`);
  const seen = new Set<string>();
  for (const r of runs) {
    if (seen.has(r.slug)) throw new Error(`${name}: ${file} has two runs of ${r.slug}`);
    seen.add(r.slug);
    if (r.version !== want) throw new Error(`${name}: ${r.slug} is ${r.version}, not ${want}`);
  }
  if ((data.failures ?? []).length > 0) throw new Error(`${name}: ${file} records failed runs`);
  Object.assign(snapshots, data.snapshot ?? {});
  return runs;
}
const files = ARM_NAMES.map((n) => need(n.toLowerCase()));
if (new Set(files).size !== files.length) throw new Error("each arm must be its own run, so its own file");
const ARMS = Object.fromEntries(ARM_NAMES.map((n, i) => [n, load(n, files[i]!)])) as Record<ArmName, Run[]>;
const slugs = ARMS.A1.map((r) => r.slug);
for (const name of ARM_NAMES) {
  if (ARMS[name].map((r) => r.slug).sort().join(",") !== [...slugs].sort().join(",")) {
    throw new Error(`${name} covers different articles from A1`);
  }
}
const runOf = (arm: ArmName, slug: string): Run => ARMS[arm].find((r) => r.slug === slug)!;

/* ------------------------------------------------------------- the ideas -- */

/** Each article's key ideas by label (I1, I2, …), as the prompt gave them. */
const ideasOf = new Map<string, Map<string, string>>();
for (const slug of slugs) {
  const fromFile = args.find((a) => a.startsWith(`--file=${slug}=`))?.slice(`--file=${slug}=`.length);
  let list: { label?: string; name: string; statement: string }[] = [];
  if (fromFile) {
    const inputs = JSON.parse(readFileSync(fromFile, "utf8")) as { ideas: { ideas: { name: string; statement: string }[] } };
    list = inputs.ideas.ideas.map((idea, i) => ({ label: `I${i + 1}`, ...idea }));
  } else if (Array.isArray(snapshots[slug]?.ideas)) {
    list = snapshots[slug]!.ideas as typeof list;
  } else {
    throw new Error(`${slug}: no Ideas in the snapshot; pass --file=${slug}=<inputs.json>`);
  }
  ideasOf.set(slug, new Map(list.map((idea, i) => [idea.label ?? `I${i + 1}`, `${idea.name}: ${idea.statement}`])));
}

/* --------------------------------------------------------------- screens -- */

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const screens: string[] = ["# Skim cue screens (plan 261009j)", ""];
screens.push("| Arm | article | stops | cues | left out (`noCue`) | bad (`badCue`) | median length | cost |");
screens.push("|---|---|---|---|---|---|---|---|");
for (const name of ARM_NAMES) {
  let stops = 0, cues = 0, none = 0, bad = 0, cost = 0;
  const lengths: number[] = [];
  for (const slug of slugs) {
    const r = runOf(name, slug);
    const kept = r.stops.filter((s) => s.cue !== null);
    const noCue = r.dropped.noCue ?? 0;
    stops += r.stops.length;
    cues += kept.length;
    none += noCue;
    bad += r.dropped.badCue ?? 0;
    cost += r.costNanos;
    lengths.push(...kept.map((s) => s.cue!.length));
    screens.push(
      `| ${name} | ${slug} | ${r.stops.length} | ${kept.length} | ${noCue} | ${r.dropped.badCue ?? 0} | ${median(kept.map((s) => s.cue!.length))} | $${(r.costNanos / 1e9).toFixed(4)} |`,
    );
  }
  screens.push(`| **${name}** | **all** | **${stops}** | **${cues}** | **${none}** | **${bad}** | **${median(lengths)}** | **$${(cost / 1e9).toFixed(4)}** |`);
}

/** The quotes that are a stop in every arm: the one population judged. */
const common = new Map<string, Set<string>>();
screens.push("", "## Stops not in every arm (not judged; read by hand)", "");
for (const slug of slugs) {
  const sets = ARM_NAMES.map((n) => new Set(runOf(n, slug).stops.map((s) => s.quoteId)));
  const all = [...sets[0]!].filter((q) => sets.every((s) => s.has(q)));
  common.set(slug, new Set(all));
  for (const n of ARM_NAMES) {
    for (const s of runOf(n, slug).stops) {
      if (common.get(slug)!.has(s.quoteId)) continue;
      screens.push(`- ${slug} · only some arms, here **${n}**: ${s.quoteFull.slice(0, 160)}… — cue: ${s.cue ?? "(none)"}`);
    }
  }
}
screens.push("", "## Every stop, B1 and B2 beside A1", "");
for (const slug of slugs) {
  screens.push(`### ${slug}`, "");
  const a1 = new Map(runOf("A1", slug).stops.map((s) => [s.quoteId, s]));
  const b2 = new Map(runOf("B2", slug).stops.map((s) => [s.quoteId, s]));
  for (const s of runOf("B1", slug).stops) {
    screens.push(`- **Quote**: ${s.quoteFull.slice(0, 300)}${s.quoteFull.length > 300 ? "…" : ""}`);
    screens.push(`  - B1: ${s.cue ?? "(no question)"}`);
    const other = b2.get(s.quoteId);
    screens.push(`  - B2: ${other ? (other.cue ?? "(no question)") : "(not a stop in B2)"}`);
    const old = a1.get(s.quoteId);
    screens.push(`  - A1: ${old ? (old.cue ?? "(no question)") : "(not a stop in A1)"}`);
  }
  screens.push("");
}
writeFileSync(`${base}-screens.md`, screens.join("\n"));
console.log(`wrote ${base}-screens.md`);

/* ----------------------------------------------------------------- pairs -- */

const COMPARISONS: { id: string; x: ArmName; y: ArmName }[] = [
  { id: "s1", x: "A1", y: "A2" },
  { id: "s2", x: "A1", y: "B1" },
  { id: "s3", x: "A2", y: "B2" },
];
interface KeyRow {
  pair: number;
  slug: string;
  quoteId: string;
  /** Which arm is shown as version 1. */
  one: ArmName;
  two: ArmName;
  /** Which arms had a cue: "both" or the one arm that did. */
  kind: "both" | ArmName;
}
const JUDGE_BRIEF = `# Which question helps the reader more?

A reading app walks a reader through an article as a route of short quotes. Before each quote it may
show one short question or instruction, written by AI, for the reader to read the quote with — or
nothing. Its only job is to make the quote **mean more for having read it**: easier to understand,
easier to place in the argument, or easier to see why it matters.

The AI that wrote it saw only **the records**: the quote, its section, and the article's key ideas
that the quote carries. It never saw the surrounding paragraphs. Each pair below shows the records,
then the article's own paragraphs (so you can tell what is true), then two versions of what is shown
before the quote. A version may be "(no question)".

For each pair, decide:

- **better**: which version leaves a reader better placed to understand, situate, or see why the
  quote matters: "1", "2" or "tie". **A question that adds something real beats no question; a
  missing question that was needed loses to one that supplies it.** A question that only turns the
  quote into a question, so that reading it tells the reader nothing the quote would not, is **no
  better than "(no question)"** — and worse if it misleads.
- For each version that has a question (all false for "(no question)"):
  - **echo**: it adds nothing — it only restates the quote as a question or instruction;
  - **give**: it states the quote's finding or conclusion, so the reader is told the answer first;
  - **unlicensed**: it says or assumes something the records do not support, or asks something the
    quote does not answer;
  - **untrue**: it says something the article's paragraphs show to be wrong or misleading.
- For each version that is "(no question)" (false when it has one):
  - **needed**: a question was needed here — the quote does not stand on its own (it leans on "this",
    "the latter", or a term or choice the reader cannot place) and the records hold what would help.

Answer as JSON only, in a file, one entry per pair, with every field present:

\`\`\`
{ "judgments": [ { "pair": 1, "better": "1", "echo1": false, "echo2": false, "give1": false, "give2": false, "unlicensed1": false, "unlicensed2": false, "untrue1": false, "untrue2": false, "needed1": false, "needed2": true } ] }
\`\`\`
`;
const shown = (cue: string | null): string => (cue === null ? "(no question)" : cue);
const flat = (s: string | null): string => (s ?? "(none)").replace(/\n+/g, " ").trim();

for (const c of COMPARISONS) {
  const coin = blindCoin(261009 + Number(c.id.slice(1)));
  const key: KeyRow[] = [];
  const page: string[] = [JUDGE_BRIEF, ""];
  let bothNone = 0;
  for (const slug of slugs) {
    const ys = new Map(runOf(c.y, slug).stops.map((s) => [s.quoteId, s]));
    for (const sx of runOf(c.x, slug).stops) {
      if (!common.get(slug)!.has(sx.quoteId)) continue;
      const sy = ys.get(sx.quoteId)!;
      if (sx.cue === null && sy.cue === null) {
        bothNone++;
        continue;
      }
      const flip = coin();
      const [one, two] = flip ? [c.y, c.x] : [c.x, c.y];
      const [s1, s2] = flip ? [sy, sx] : [sx, sy];
      const pair = key.length + 1;
      key.push({
        pair,
        slug,
        quoteId: sx.quoteId,
        one,
        two,
        kind: sx.cue !== null && sy.cue !== null ? "both" : sx.cue !== null ? c.x : c.y,
      });
      const ideas = (sx.ideasIn ?? []).map((l) => ideasOf.get(slug)!.get(l)).filter(Boolean);
      page.push(
        `## Pair ${pair}`,
        "",
        "**The records**",
        "",
        `- Section: ${sx.section}`,
        `- Key ideas it carries: ${ideas.length ? ideas.join(" · ") : "(none)"}`,
        `- The quote: ${flat(sx.quoteFull)}`,
        "",
        "**The article, around it**",
        "",
        `- The paragraph before: ${flat(sx.before)}`,
        `- The quote's paragraph: ${flat(sx.paragraph)}`,
        "",
        `**Version 1**: ${shown(s1.cue)}`,
        "",
        `**Version 2**: ${shown(s2.cue)}`,
        "",
      );
    }
  }
  const xFirst = key.filter((k) => k.one === c.x).length;
  if (key.length > 0 && Math.abs(xFirst - key.length / 2) > key.length * 0.2) {
    throw new Error(`${c.id}: the coin put ${c.x} first ${xFirst} times in ${key.length}`);
  }
  writeFileSync(`${base}-pairs-${c.id}.md`, page.join("\n"));
  writeFileSync(`${base}-key-${c.id}.json`, JSON.stringify({ comparison: c, bothNone, key }, null, 1));
  console.log(`${c.id} ${c.x} v ${c.y}: ${key.length} pairs (${c.x} shown first ${xFirst}), ${bothNone} with no cue on either side`);
}

/* --------------------------------------------------------------- scoring -- */

interface Judgment {
  pair: number;
  better: "1" | "2" | "tie";
  [flag: string]: unknown;
}
const FLAGS = ["echo", "give", "unlicensed", "untrue", "needed"] as const;

/** Two-sided exact sign test: P(a split at least this uneven | p = ½). */
function signTest(a: number, b: number): number {
  const n = a + b;
  const k = Math.min(a, b);
  let tail = 0;
  for (let i = 0; i <= k; i++) {
    let c = 1;
    for (let j = 0; j < i; j++) c = (c * (n - j)) / (j + 1);
    tail += c / 2 ** n;
  }
  return Math.min(1, 2 * tail);
}

const dir = dirname(base);
const stem = basename(base);
for (const c of COMPARISONS) {
  const key = (JSON.parse(readFileSync(`${base}-key-${c.id}.json`, "utf8")) as { key: KeyRow[] }).key;
  const judged = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.startsWith(`${stem}-judgment-${c.id}-`) && f.endsWith(".json"))
    : [];
  for (const file of judged) {
    const judge = file.slice(`${stem}-judgment-${c.id}-`.length, -".json".length);
    const js = (JSON.parse(readFileSync(`${dir}/${file}`, "utf8")) as { judgments: Judgment[] }).judgments;
    const byPair = new Map<number, Judgment>();
    for (const j of js) {
      if (byPair.has(j.pair)) throw new Error(`${file}: pair ${j.pair} judged twice`);
      if (!["1", "2", "tie"].includes(j.better)) throw new Error(`${file}: pair ${j.pair} better=${j.better}`);
      for (const f of FLAGS) {
        for (const side of ["1", "2"]) {
          if (typeof j[`${f}${side}`] !== "boolean") throw new Error(`${file}: pair ${j.pair} lacks ${f}${side}`);
        }
      }
      byPair.set(j.pair, j);
    }
    if (byPair.size !== key.length || key.some((k) => !byPair.has(k.pair))) {
      throw new Error(`${file}: ${byPair.size} judgments for ${key.length} pairs`);
    }
    const winner = (k: KeyRow): string => {
      const j = byPair.get(k.pair)!;
      return j.better === "tie" ? "tie" : j.better === "1" ? k.one : k.two;
    };
    const tally = (rows: KeyRow[]): string => {
      const t: Record<string, number> = { [c.x]: 0, [c.y]: 0, tie: 0 };
      for (const k of rows) t[winner(k)]!++;
      return `${c.x} ${t[c.x]} · ${c.y} ${t[c.y]} · tie ${t.tie}`;
    };
    const t: Record<string, number> = { [c.x]: 0, [c.y]: 0, tie: 0 };
    for (const k of key) t[winner(k)]!++;
    console.log(`\n${c.id} ${c.x} v ${c.y}, judge ${judge}: ${key.length} pairs`);
    console.log(`  all:               ${tally(key)}   sign test p = ${signTest(t[c.x]!, t[c.y]!).toFixed(4)}`);
    console.log(`  both have a cue:   ${tally(key.filter((k) => k.kind === "both"))}`);
    console.log(`  only ${c.x} has one:  ${tally(key.filter((k) => k.kind === c.x))}`);
    console.log(`  only ${c.y} has one:  ${tally(key.filter((k) => k.kind === c.y))}`);
    console.log(`  per article:       ${slugs.map((s) => `${s.slice(0, 14)} ${tally(key.filter((k) => k.slug === s)).replace(/ · tie \d+/, "")}`).join(" | ")}`);
    for (const arm of [c.x, c.y]) {
      const counts = Object.fromEntries(FLAGS.map((f) => [f, 0])) as Record<(typeof FLAGS)[number], number>;
      let cues = 0, empties = 0;
      for (const k of key) {
        const j = byPair.get(k.pair)!;
        const side = k.one === arm ? "1" : "2";
        const hasCue = k.kind === "both" || k.kind === arm;
        if (hasCue) cues++;
        else empties++;
        for (const f of FLAGS) if (j[`${f}${side}`] === true) counts[f]++;
      }
      console.log(
        `  ${arm}: ${cues} cues — echo ${counts.echo}, gives it away ${counts.give}, unlicensed ${counts.unlicensed}, untrue ${counts.untrue}; ${empties} left out — needed ${counts.needed}`,
      );
    }
  }
}
