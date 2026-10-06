/**
 * **Round three of the Skim cue measurement: a middle wording, judged on
 * hand-marked dangling quotes** (investigation 261006b § Round three).
 *
 *     npx tsx scripts/eval/skim-cue-round3.ts --a1=<results.json> --a2=<results.json> \
 *       --c=<results.json> --out=evals/results/<stem> [--ordinary=50]
 *
 * Reads results files from scripts/eval/skim-coverage-eval.ts. **No model
 * call, nothing read from or written to the database.** The arms:
 *
 * - **A1, A2**: the OLD arm, `skim/10` as shipped, run twice: the control pair;
 * - **C**: the NEW arm, the candidate `skim/11`.
 *
 * It is run three times, and each time does as much as the files beside
 * `--out` allow:
 *
 * 1. **The marking sheets**, `…-marking-input-N.md`: every quote that is a
 *    stop with a cue in all three arms, with its paragraph and the one before,
 *    and **no cue from any arm**. Two readers mark each quote `strict` (it
 *    cannot be understood without a referent it does not supply),
 *    `borderline` or `not`, into `…-marking-m1.json` and `…-marking-m2.json`
 *    (`{ marks: [{ key, mark }] }`).
 * 2. **The blind pairs**, once both markings exist. **Dangling** = `strict` by
 *    at least one reader (the header first said both; that gave 24, the brief
 *    asked for about 40, and no reader marked `not` what the other marked
 *    `strict`; changed before any pair existed, and the 24 are scored as
 *    their own line). **Ordinary** = `not` by both; `--ordinary` of them are
 *    sampled by a hash of the seed and the quote's key. s1 is A1 v A2 (the
 *    control), s2 is A1 v C, s3 is A2 v C: the candidate meets two judges.
 *    Sides by `blindCoin`; the judge's page is the one rounds one and two used.
 * 3. **The score**, once `…-judgment-sN.json` exists, and the verdict.
 *
 * ## The rule, written before any pair was judged
 *
 * Greg, 2026-10-06: ship only if clearly better on the dangling quotes AND no
 * worse on giveaways and misstatements overall. As numbers:
 *
 * - **Clearly better on dangling**: in s2 AND in s3, a two-sided sign test on
 *   the pairs that are not ties gives p < 0.05 for C, and the control s1 does
 *   not reach that for either run.
 * - **No worse on giveaways, and on misstatements**: in s2 AND in s3, over all
 *   judged pairs and again over the ordinary ones alone, C's flags are at most
 *   the old arm's plus the larger of 2 and the control's own gap (|A1 − A2| in
 *   s1 on the same subset).
 *
 * Anything else keeps `skim/10`.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { blindCoin } from "../../evals/plain-words/run.js";

interface Stop {
  quoteId: string;
  quoteFull: string;
  paragraph: string;
  before: string | null;
  cue: string | null;
  section: string;
}
interface Run {
  slug: string;
  arm: "old" | "new";
  version: string;
  costNanos: number;
  inputTokens: number;
  outputTokens: number;
  stops: Stop[];
}
type ArmName = "A1" | "A2" | "C";
type Mark = "strict" | "borderline" | "not";

const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const need = (name: string): string => {
  const v = arg(name);
  if (!v) throw new Error(`--${name}=<file> is required`);
  return v;
};
const base = need("out");
const ORDINARY = Number(arg("ordinary") ?? 50);
const SEED = Number(arg("seed") ?? 26100630);
const SHEET = 130;

function load(name: ArmName, file: string): Map<string, Run> {
  const data = JSON.parse(readFileSync(file, "utf8")) as { results: Run[]; failures?: unknown[] };
  const [arm, version] = name === "C" ? (["new", "skim/11"] as const) : (["old", "skim/10"] as const);
  const runs = data.results.filter((r) => r.arm === arm);
  if (runs.length === 0) throw new Error(`${name}: ${file} has no ${arm} arm`);
  const bySlug = new Map<string, Run>();
  for (const r of runs) {
    if (bySlug.has(r.slug)) throw new Error(`${name}: ${file} has two runs for ${r.slug}`);
    if (r.version !== version) throw new Error(`${name}: ${r.slug} is ${r.version}, not ${version}`);
    bySlug.set(r.slug, r);
  }
  if ((data.failures ?? []).length > 0) console.warn(`${name}: ${file} records ${data.failures!.length} failed runs`);
  return bySlug;
}
if (need("a1") === need("a2")) throw new Error("A1 and A2 must be two runs, so two files");
const ARMS: Record<ArmName, Map<string, Run>> = { A1: load("A1", need("a1")), A2: load("A2", need("a2")), C: load("C", need("c")) };
const slugs = [...ARMS.A1.keys()].filter((s) => ARMS.A2.has(s) && ARMS.C.has(s));
const missing = [...new Set([...ARMS.A1.keys(), ...ARMS.A2.keys(), ...ARMS.C.keys()])].filter((s) => !slugs.includes(s));
if (missing.length > 0) console.warn(`not in all three arms, left out: ${missing.join(", ")}`);

/* ----------------------------------------------------------------- quotes -- */

interface Unit {
  key: string;
  slug: string;
  stop: Stop;
  cue: Record<ArmName, string>;
}
const units: Unit[] = [];
let unpaired = 0;
for (const slug of slugs) {
  const find = (arm: ArmName, id: string) => ARMS[arm].get(slug)!.stops.find((s) => s.quoteId === id);
  for (const stop of ARMS.A1.get(slug)!.stops) {
    const a2 = find("A2", stop.quoteId);
    const c = find("C", stop.quoteId);
    if (!stop.cue || !a2?.cue || !c?.cue) {
      unpaired++;
      continue;
    }
    units.push({ key: `${slug}/${stop.quoteId}`, slug, stop, cue: { A1: stop.cue, A2: a2.cue, C: c.cue } });
  }
}
console.log(`${units.length} quotes are a stop with a cue in all three arms, over ${slugs.length} articles; ${unpaired} of A1's stops are not`);

const clipHead = (t: string, max: number): string => (t.length > max ? `${t.slice(0, max)}…` : t);
const clipTail = (t: string, max: number): string => (t.length > max ? `…${t.slice(t.length - max)}` : t);
const passage = (s: Stop): string[] => [
  `**The paragraph before:** ${s.before === null ? "(none: the quote's paragraph opens the article)" : clipTail(s.before, 1500)}`,
  "",
  `**The quote's paragraph** [section: ${s.section}]: ${clipHead(s.paragraph, 3000)}`,
  "",
  `**The quote:** ${s.quoteFull}`,
  "",
];

/* ---------------------------------------------------------------- screens -- */

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
console.log("\n| Arm | cues | length: median · mean · max | over 140 | two sentences | ask a question | cost | input / route | output / route |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const name of ["A1", "A2", "C"] as const) {
  const cues = units.map((u) => u.cue[name]);
  const lens = cues.map((c) => c.length);
  const runs = slugs.map((s) => ARMS[name].get(s)!);
  const mean = (f: (r: Run) => number) => Math.round(runs.reduce((n, r) => n + f(r), 0) / runs.length);
  const two = cues.filter((c) => /[.?!]["'”’]?\s+\S/.test(c)).length;
  console.log(
    `| ${name} | ${cues.length} | ${median(lens)} · ${Math.round(lens.reduce((a, b) => a + b, 0) / lens.length)} · ${Math.max(...lens)} | ${lens.filter((l) => l > 140).length} | ${two} | ${cues.filter((c) => c.includes("?")).length} | $${(runs.reduce((n, r) => n + r.costNanos, 0) / 1e9).toFixed(3)} | ${mean((r) => r.inputTokens)} | ${mean((r) => r.outputTokens)} |`,
  );
}

/* ---------------------------------------------------------------- marking -- */

const sheets = Math.ceil(units.length / SHEET);
for (let n = 0; n < sheets; n++) {
  const md: string[] = [
    "# Which of these quotes lean on something they do not say?",
    "",
    "Each item is one line quoted out of an article, with its own paragraph and the paragraph before it. A reader will be shown **the quote alone**, having read nothing else of the article.",
    "",
    "Mark each quote:",
    "",
    "- `strict`: the quote cannot be understood on its own, because it points at something it does not name: \"the latter\", \"this approach\", \"such a policy\", \"they\", \"these results\", or a short name or label it never explains, and the thing pointed at is only in the paragraphs around it.",
    "- `borderline`: it points outside itself, but a reader can still tell what it is saying (\"these results show X\", where X is clear), or the quote half-supplies the referent.",
    "- `not`: the quote says what it is about. A technical term the reader may not know does not make a quote lean; only a word that points at something unsaid does.",
    "",
    "Judge each on its own, from the quote first and the paragraphs only to check.",
    "",
  ];
  for (const u of units.slice(n * SHEET, (n + 1) * SHEET)) md.push(`## ${u.key}`, "", ...passage(u.stop), "---", "");
  writeFileSync(`${base}-marking-input-${n + 1}.md`, md.join("\n"));
}
console.log(`\n${sheets} marking sheets written (${base}-marking-input-N.md), no cue in any of them`);

const readMarks = (who: string): Map<string, Mark> | null => {
  const path = `${base}-marking-${who}.json`;
  if (!existsSync(path)) return null;
  const { marks } = JSON.parse(readFileSync(path, "utf8")) as { marks: { key: string; mark: Mark }[] };
  const out = new Map<string, Mark>();
  for (const m of marks) {
    if (!["strict", "borderline", "not"].includes(m.mark)) throw new Error(`${who}: ${m.key}: invalid mark ${m.mark}`);
    if (out.has(m.key)) throw new Error(`${who}: ${m.key} marked twice`);
    out.set(m.key, m.mark);
  }
  for (const u of units) if (!out.has(u.key)) throw new Error(`${who}: no mark for ${u.key}`);
  /* A marking may cover more quotes than are paired: the sheets were written against the first draft's run. */
  return out;
};
const m1 = readMarks("m1");
const m2 = readMarks("m2");
if (!m1 || !m2) {
  console.log("waiting for both markings; no pairs written");
  process.exit(0);
}
const both = (mark: Mark): Unit[] => units.filter((u) => m1.get(u.key) === mark && m2.get(u.key) === mark);
const count = (m: Map<string, Mark>, mark: Mark): number => [...m.values()].filter((v) => v === mark).length;
console.log(
  `marking: m1 strict ${count(m1, "strict")}, borderline ${count(m1, "borderline")}, not ${count(m1, "not")}; m2 strict ${count(m2, "strict")}, borderline ${count(m2, "borderline")}, not ${count(m2, "not")}; same mark on ${units.filter((u) => m1.get(u.key) === m2.get(u.key)).length} of ${units.length}`,
);
const dangling = units.filter((u) => m1.get(u.key) === "strict" || m2.get(u.key) === "strict");
const strictByBoth = new Set(both("strict").map((u) => u.key));
const rank = (u: Unit): string => createHash("sha256").update(`${SEED}:${u.key}`).digest("hex");
const ordinary = both("not")
  .sort((x, y) => rank(x).localeCompare(rank(y)))
  .slice(0, ORDINARY);
const kind = new Map<string, "dangling" | "ordinary">([...dangling.map((u) => [u.key, "dangling"] as const), ...ordinary.map((u) => [u.key, "ordinary"] as const)]);
/* Article order, as the earlier rounds had it, so dangling and ordinary pairs are mixed on the page. */
const judged = units.filter((u) => kind.has(u.key));
console.log(`dangling (strict by either reader): ${dangling.length}, of which strict by both ${strictByBoth.size}; ordinary (not by both): ${both("not").length}, of which ${ordinary.length} sampled; ${judged.length} pairs per set`);

/* ------------------------------------------------------------ blind pairs -- */

const SETS: { name: string; first: ArmName; second: ArmName; seed: number }[] = [
  { name: "s1", first: "A1", second: "A2", seed: 26100631 },
  { name: "s2", first: "A1", second: "C", seed: 26100632 },
  { name: "s3", first: "A2", second: "C", seed: 26100633 },
];
interface KeyRow {
  pair: number;
  key: string;
  kind: "dangling" | "ordinary";
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
  judged.forEach((u, i) => {
    const flip = coin();
    if (!flip) firstOnA++;
    const [a, b] = flip ? [set.second, set.first] : [set.first, set.second];
    key.push({ pair: i + 1, key: u.key, kind: kind.get(u.key)!, A: a, B: b });
    md.push(`## Pair ${i + 1}`, "", ...passage(u.stop), `**Cue A:** ${u.cue[a]}`, "", `**Cue B:** ${u.cue[b]}`, "", "---", "");
  });
  writeFileSync(`${base}-pairs-${set.name}.md`, md.join("\n"));
  writeFileSync(`${base}-key-${set.name}.json`, JSON.stringify({ set: set.name, first: set.first, second: set.second, seed: set.seed, key }, null, 2));
  console.log(`${set.name} (${set.first} v ${set.second}): ${key.length} pairs; ${set.first} is on side A in ${firstOnA} and on side B in ${key.length - firstOnA}`);
}

/* ---------------------------------------------------------------- scoring -- */

type Pick3 = "A" | "B" | "tie";
type Pick4 = "A" | "B" | "both" | "neither";
type Subset = "all" | "dangling" | "ordinary";
interface Tally {
  n: number;
  better: Record<string, number>;
  give: Record<string, number>;
  invent: Record<string, number>;
}
/** Two-sided sign test: the chance of a split at least this lopsided from a fair coin. */
function signTest(x: number, y: number): number {
  const n = x + y;
  if (n === 0) return 1;
  const choose = (k: number): number => {
    let c = 1;
    for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
    return c;
  };
  let tail = 0;
  for (let k = Math.max(x, y); k <= n; k++) tail += choose(k);
  return Math.min(1, (2 * tail) / 2 ** n);
}
const ORIGINAL = new Set(["2608-13566v1-spya-yurten", "entropy-24-00930-spya-pywwkq", "arxiv-2010-spya-tkm7nm", "source-spya-furjgs", "cargocult-spya-rz663q"]);
const scored = new Map<string, Record<Subset, Tally>>();
for (const set of SETS) {
  const path = `${base}-judgment-${set.name}.json`;
  if (!existsSync(path)) continue;
  const { key } = JSON.parse(readFileSync(`${base}-key-${set.name}.json`, "utf8")) as { key: KeyRow[] };
  const { judgments } = JSON.parse(readFileSync(path, "utf8")) as { judgments: { pair: number; a: Pick3; giveaway: Pick4; invent: Pick4 }[] };
  if (!Array.isArray(judgments)) throw new Error(`${set.name}: judgments must be an array`);
  const byPair = new Map<number, (typeof judgments)[number]>();
  for (const j of judgments) {
    if (!key.some((k) => k.pair === j.pair)) throw new Error(`${set.name}: no key for pair ${j.pair}`);
    if (byPair.has(j.pair)) throw new Error(`${set.name}: duplicate judgment for pair ${j.pair}`);
    if (!["A", "B", "tie"].includes(j.a)) throw new Error(`${set.name}: pair ${j.pair}: invalid a`);
    for (const f of ["giveaway", "invent"] as const) if (!["A", "B", "both", "neither"].includes(j[f])) throw new Error(`${set.name}: pair ${j.pair}: invalid ${f}`);
    byPair.set(j.pair, j);
  }
  for (const k of key) if (!byPair.has(k.pair)) throw new Error(`${set.name}: missing judgment for pair ${k.pair}`);
  const tally = (rows: KeyRow[]): Tally => {
    const t: Tally = { n: rows.length, better: { [set.first]: 0, [set.second]: 0, tie: 0 }, give: { [set.first]: 0, [set.second]: 0 }, invent: { [set.first]: 0, [set.second]: 0 } };
    for (const k of rows) {
      const j = byPair.get(k.pair)!;
      t.better[j.a === "tie" ? "tie" : k[j.a]]!++;
      for (const [f, into] of [["giveaway", t.give], ["invent", t.invent]] as const) {
        if (j[f] === "A" || j[f] === "both") into[k.A]!++;
        if (j[f] === "B" || j[f] === "both") into[k.B]!++;
      }
    }
    return t;
  };
  const line = (label: string, t: Tally): void =>
    console.log(
      `${set.name} ${set.first} v ${set.second} [${label}, ${t.n}]: better ${set.first} ${t.better[set.first]}, ${set.second} ${t.better[set.second]}, tie ${t.better.tie} (sign test p=${signTest(t.better[set.first]!, t.better[set.second]!).toFixed(3)}) · gives away ${set.first} ${t.give[set.first]}, ${set.second} ${t.give[set.second]} · misstates ${set.first} ${t.invent[set.first]}, ${set.second} ${t.invent[set.second]}`,
    );
  const subsets = { all: tally(key), dangling: tally(key.filter((k) => k.kind === "dangling")), ordinary: tally(key.filter((k) => k.kind === "ordinary")) };
  scored.set(set.name, subsets);
  console.log("");
  for (const s of ["all", "dangling", "ordinary"] as const) line(s, subsets[s]);
  const inOriginal = (k: KeyRow): boolean => ORIGINAL.has(k.key.slice(0, k.key.lastIndexOf("/")));
  line("dangling, strict by both readers", tally(key.filter((k) => strictByBoth.has(k.key))));
  line("dangling, the five articles of rounds one and two", tally(key.filter((k) => k.kind === "dangling" && inOriginal(k))));
  line("dangling, the articles new to this round", tally(key.filter((k) => k.kind === "dangling" && !inOriginal(k))));
  const sideA = [...byPair.values()].filter((j) => j.a === "A").length;
  console.log(`${set.name}: the judge picked side A ${sideA}, side B ${[...byPair.values()].filter((j) => j.a === "B").length}`);
}

/* ---------------------------------------------------------------- verdict -- */

const [s1, s2, s3] = ["s1", "s2", "s3"].map((n) => scored.get(n));
if (s1 && s2 && s3) {
  console.log("\n## The rule");
  const p1 = signTest(s1.dangling.better.A1!, s1.dangling.better.A2!);
  const clear = (t: Tally, old: ArmName): boolean => t.better.C! > t.better[old]! && signTest(t.better[old]!, t.better.C!) < 0.05;
  const better = clear(s2.dangling, "A1") && clear(s3.dangling, "A2") && p1 >= 0.05;
  console.log(`clearly better on dangling: ${better ? "YES" : "NO"} (s2 ${s2.dangling.better.A1} to ${s2.dangling.better.C}, s3 ${s3.dangling.better.A2} to ${s3.dangling.better.C}, control ${s1.dangling.better.A1} to ${s1.dangling.better.A2})`);
  let noWorse = true;
  for (const field of ["give", "invent"] as const) {
    for (const subset of ["all", "ordinary"] as const) {
      const slack = Math.max(2, Math.abs(s1[subset][field].A1! - s1[subset][field].A2!));
      for (const [t, old] of [[s2, "A1"], [s3, "A2"]] as const) {
        const ok = t[subset][field].C! <= t[subset][field][old]! + slack;
        if (!ok) noWorse = false;
        console.log(`${field === "give" ? "giveaways" : "misstatements"}, ${subset}, C v ${old}: C ${t[subset][field].C}, ${old} ${t[subset][field][old]}, allowed gap ${slack}: ${ok ? "ok" : "WORSE"}`);
      }
    }
  }
  console.log(`\nVERDICT: ${better && noWorse ? "the candidate passes the rule" : "the candidate does not pass; skim/10 stays"}`);
}
