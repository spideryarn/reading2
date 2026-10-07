/**
 * **Probe for the proposed Simple fidelity guard** —
 * docs/plans/261001h-plain-words-summaries-keep-the-piece-s-contrasting-terms.md
 * § Measuring the guard. A measurement, not the build: nothing in `src/`
 * imports this, and nothing here is wired into the app.
 *
 *   npx tsx scripts/probes/261001h-fidelity-guard-probe.ts corpus          # free
 *   npx tsx scripts/probes/261001h-fidelity-guard-probe.ts check <luna|sonnet> [--arms a,b] [--budget 0.8]
 *   npx tsx scripts/probes/261001h-fidelity-guard-probe.ts score           # free
 *
 * **corpus** reads every saved, successful Simple run under
 * `evals/results/simple/` — the PID paper (the challenge set) and the Olah and
 * Gwern controls — resolves each paragraph's cited ids against the article in
 * the local database, and writes `data/probes/261001h-fidelity-guard-corpus.json`
 * (gitignored, because it holds article text). It prints every PID sentence
 * about feedback, loops or recurrence with its paragraph key, which is what the
 * hand labels in `docs/plans/261001h-fidelity-guard-labels.json` were written
 * from.
 *
 * **check** sends the checker the guard proposes — one call per level of one
 * run, each paragraph paired with the text of its own cited blocks, one verdict
 * per paragraph back — with a run's levels in parallel, as a press would.
 *
 * - `luna`: the quick tier, through `link-summary`'s chat route and its
 *   `effort: "low"` — the request a Luna build would send.
 * - `sonnet`: the capable tier through `streamMessage("simple", …)`, the
 *   Messages wire and adaptive thinking a Sonnet build would use, at
 *   `effort: "low"` (a verdict, not a piece of writing).
 *
 * Both borrow an existing job's route so the probe adds nothing to `src/`. The
 * spend collector writes each call to the ledger (`ai_calls`, `eval` scope,
 * the environment owner; an eval's spend is refused without one), and the cost
 * printed is read from the collector's own records. One JSONL line per level to
 * `docs/plans/261001h-fidelity-guard-<model>.jsonl`. A level already in that
 * file is never called again, whatever its outcome, so an unreadable answer
 * stays recorded as one. It stops before the next run once `--budget` dollars
 * are spent in this invocation.
 *
 * **score** joins the verdicts to the labels and prints, per model: recall per
 * fault kind on the PID challenge set (and among faults whose cited passages
 * hold the contradicting finding, `spya-sd9fzd`); alarms on unlabelled
 * paragraphs split by their hand adjudication (real / borderline / false /
 * not yet read); unreadable answers as an availability figure; the shipped
 * configuration's operational rates; cost; and per-press latency. A press
 * means three checked levels for cost and latency: some older saved runs hold
 * only one or two levels, so treating every saved run as a press understates
 * both figures.
 */
import fs from "node:fs";
import path from "node:path";
import { openRouterJson } from "../../src/ai-call.js";
import { collectSpend, totalSpend } from "../../src/ai-spend.js";
import { loadEnvLocal } from "../../src/env.js";
import { streamMessage } from "../../src/messages-stream.js";
import { modelFor } from "../../src/models.js";

const REPO = path.join(import.meta.dirname, "..", "..");
const RESULTS = path.join(REPO, "evals", "results", "simple");
const PLANS = path.join(REPO, "docs", "plans");
/* Holds article text, so it stays out of git (data/ is ignored); `corpus` rebuilds it. */
const CORPUS = path.join(REPO, "data", "probes", "261001h-fidelity-guard-corpus.json");
const LABELS = path.join(PLANS, "261001h-fidelity-guard-labels.json");
const PID = "entropy-24-00930-spya-pywwkq";
const SLUGS = [PID, "olah-a4-spya-ujr7p0", "scaling-hypothesis"];
/** The passage that states the finding the known faults turn round. */
const FINDING = "spya-sd9fzd";
/**
 * The shipped configuration: the unchanged `simple/2` prompt, no profile,
 * `high` effort — the 261001h plan's `pidpre` arm and its controls. Every
 * other arm is an older prompt revision or an unshipped experiment.
 */
const SHIPPED = /^high-none-pidpre\d+$/;
const LEVELS = ["brief", "paragraphs", "fuller"] as const;
type Level = (typeof LEVELS)[number];
const ARM_ORDER = new Intl.Collator("en", { numeric: true }).compare;

interface CorpusParagraph {
  /** `<arm>/<level>/<index>` on the PID paper, `<arm>/<slug>/<level>/<index>` on a control — the label key. */
  key: string;
  text: string;
  ids: string[];
}
interface CorpusLevel {
  arm: string;
  slug: string;
  level: Level;
  paragraphs: CorpusParagraph[];
}
interface Corpus {
  /** Slug → block id → text, only the blocks some paragraph cites. */
  blocks: Record<string, Record<string, string>>;
  levels: CorpusLevel[];
  /** Result files present but `ok: false` — the writer's own failures, for availability. */
  failedRuns: string[];
}

/**
 * `true-elsewhere`: the claim is right about the article, but the passages the
 * paragraph cites do not say it (or say only part of it) — a false alarm the
 * evidence packet causes, not the checker's misreading.
 */
type AlarmVerdict = "real" | "borderline" | "true-elsewhere" | "false";

interface Labels {
  faults: Record<string, { kind: "swap" | "gloss" | "direction"; note: string }>;
  /** Paragraphs neither faulty nor clean; left out of every rate. */
  borderline: Record<string, string>;
  /** An alarm on an unlabelled paragraph, read by hand against its passages. */
  alarmsReadByHand: Record<string, { verdict: AlarmVerdict; note: string }>;
}

function keyOf(arm: string, slug: string, level: Level, i: number): string {
  return slug === PID ? `${arm}/${level}/${i}` : `${arm}/${slug}/${level}/${i}`;
}

async function buildCorpus(): Promise<void> {
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const { closeDb } = await import("../../src/db/client.js");
  const levels: CorpusLevel[] = [];
  const failedRuns: string[] = [];
  const cited = new Map<string, Set<string>>(SLUGS.map((s) => [s, new Set()]));
  for (const arm of fs.readdirSync(RESULTS).sort(ARM_ORDER)) {
    for (const slug of SLUGS) {
      const file = path.join(RESULTS, arm, `${slug}.json`);
      if (!fs.existsSync(file)) continue;
      const run = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
      if (run.ok !== true) {
        failedRuns.push(`${arm}/${slug}`);
        continue;
      }
      for (const level of LEVELS) {
        const list = run[level] as { text: string; ids: string[] }[] | undefined;
        if (!list) continue;
        const paragraphs = list.map((p, i) => ({ key: keyOf(arm, slug, level, i), text: p.text, ids: p.ids }));
        for (const p of paragraphs) for (const id of p.ids) cited.get(slug)!.add(id);
        levels.push({ arm, slug, level, paragraphs });
      }
    }
  }
  const blocks: Corpus["blocks"] = {};
  try {
    await runAsOwner(environmentOwnerId(), async () => {
      for (const slug of SLUGS) {
        const article = await loadArticle(slug);
        const byId = new Map(article.blocks.map((b) => [b.id as string, b.text]));
        blocks[slug] = {};
        for (const id of [...cited.get(slug)!].sort()) {
          const text = byId.get(id);
          if (text === undefined) throw new Error(`${slug}: cited id ${id} is not in the article as stored now`);
          blocks[slug][id] = text;
        }
      }
    });
  } finally {
    await closeDb();
  }
  fs.mkdirSync(path.dirname(CORPUS), { recursive: true });
  fs.writeFileSync(CORPUS, `${JSON.stringify({ blocks, levels, failedRuns } satisfies Corpus, null, 1)}\n`);
  for (const slug of SLUGS) {
    const ls = levels.filter((l) => l.slug === slug);
    const runs = new Set(ls.map((l) => l.arm)).size;
    const paras = ls.reduce((n, l) => n + l.paragraphs.length, 0);
    console.log(`${slug}: ${runs} runs, ${ls.length} levels, ${paras} paragraphs, ${Object.keys(blocks[slug] ?? {}).length} cited blocks`);
  }
  console.log(`failed runs skipped: ${failedRuns.join(", ") || "none"} → ${path.relative(REPO, CORPUS)}`);
  for (const l of levels.filter((x) => x.slug === PID))
    for (const p of l.paragraphs)
      for (const s of p.text.split(/(?<=[.!?])\s+/).filter((x) => /feedback|loop|recurren/i.test(x)))
        console.log(`${p.key} [${p.ids.join(",")}] ${s}`);
}

/* ----------------------------------------------------------------- checker -- */

/* Generic on purpose: it names the class of fault, never this paper or the word
   "feedback". Kept unchanged across the measurement so tuning cannot consume
   the test set (the plan review's point). */
const SYSTEM = `You check a short plain-words summary of an article against the article's own passages.

You get numbered summary paragraphs. Each comes with the passages it cites, quoted exactly from the article. For each paragraph, decide whether anything it says is contradicted by its passages:

- "contradicts": a claim the passages say the opposite of, or a finding pinned to the wrong thing. That includes a direction turned round (a rise called a fall, A causing B called B causing A), and calling something by the name the passages use for a different thing, so that a finding about one is told about the other — even when the everyday meaning of the words would fit.
- "ok": everything it says agrees with its passages, or is simply not covered by them. Simplifying, leaving things out, and everyday wording are fine. Something the passages do not mention is "ok", not "contradicts".

Be strict about contradictions and lenient about everything else. Only the passages count: not what you know about the subject.

Answer with JSON only, no prose around it:
{"verdicts":[{"n":1,"verdict":"ok"|"contradicts","why":"<one short sentence, only for contradicts>"}]}
with one entry per paragraph, in order.`;

function userMessage(level: CorpusLevel, blocks: Record<string, string>): string {
  return level.paragraphs
    .map((p, i) => {
      const passages = p.ids.map((id) => `[${id}] ${blocks[id] ?? ""}`).join("\n\n");
      return `PARAGRAPH ${i + 1}\n${p.text}\n\nITS PASSAGES\n${passages}`;
    })
    .join("\n\n=====\n\n");
}

type ModelKey = "luna" | "sonnet";
const MODEL_KEYS: readonly ModelKey[] = ["luna", "sonnet"];

/** One call; resolves to the answer text, or throws for the call itself failing. */
async function ask(key: ModelKey, user: string): Promise<{ text: string; answeredBy: string | null }> {
  if (key === "luna") {
    const call = await openRouterJson("link-summary", {
      model: modelFor("link-summary", "standard"),
      max_completion_tokens: 4000,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
    } as never);
    const content = (call.json as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message
      ?.content;
    return { text: typeof content === "string" ? content : "", answeredBy: call.answeredBy };
  }
  const call = streamMessage(
    "simple",
    {
      max_tokens: 6000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: [{ type: "text" as const, text: SYSTEM }],
      messages: [{ role: "user", content: user }],
    },
    { power: "standard" },
  );
  const message = await call.finalMessage();
  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return { text, answeredBy: message.model };
}

interface Verdict {
  n: number;
  verdict: "ok" | "contradicts";
  why?: string;
}
interface CheckLine {
  arm: string;
  slug: string;
  level: Level;
  model: ModelKey;
  answeredBy: string | null;
  ms: number;
  costUsd: number;
  unpriced: number;
  /** null when there is no usable answer — a built guard would fail closed on it. */
  verdicts: Verdict[] | null;
  error?: string;
  pressMs: number;
}

function parseVerdicts(content: string, count: number): Verdict[] | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const parsed = JSON.parse(content.slice(start, end + 1)) as { verdicts?: unknown };
    if (!Array.isArray(parsed.verdicts) || parsed.verdicts.length !== count) return null;
    const out: Verdict[] = [];
    for (const [i, v] of parsed.verdicts.entries()) {
      const r = v as Partial<Verdict>;
      if (r.verdict !== "ok" && r.verdict !== "contradicts") return null;
      out.push({ n: i + 1, verdict: r.verdict, ...(r.why ? { why: String(r.why) } : {}) });
    }
    return out;
  } catch {
    return null;
  }
}

async function checkLevel(key: ModelKey, level: CorpusLevel, blocks: Record<string, string>): Promise<Omit<CheckLine, "pressMs">> {
  const started = Date.now();
  let answeredBy: string | null = null;
  let verdicts: Verdict[] | null = null;
  let error: string | undefined;
  /* Imported here, not at the top, so `score` stays offline. */
  const { environmentOwnerId } = await import("../../src/owner.js");
  const { costStore } = await import("../../src/store/ai-calls.js");
  const { report } = await collectSpend(async () => {
    try {
      const answer = await ask(key, userMessage(level, blocks));
      answeredBy = answer.answeredBy;
      verdicts = parseVerdicts(answer.text, level.paragraphs.length);
      if (!verdicts) error = "unreadable answer";
    } catch (err) {
      error = err instanceof Error ? `${err.constructor.name}: ${err.message.slice(0, 120)}` : "error";
    }
  }, {
    attribution: { scopeKind: "eval", ownerId: environmentOwnerId(), articleSlug: level.slug },
    sink: (row) => costStore.record(row),
  });
  const spend = totalSpend(report.calls);
  return {
    arm: level.arm,
    slug: level.slug,
    level: level.level,
    model: key,
    answeredBy,
    ms: Date.now() - started,
    costUsd: spend.nanos / 1e9,
    unpriced: spend.unpriced,
    verdicts,
    ...(error ? { error } : {}),
  };
}

function outFile(key: ModelKey): string {
  return path.join(PLANS, `261001h-fidelity-guard-${key}.jsonl`);
}

function readLines(key: ModelKey): CheckLine[] {
  const file = outFile(key);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as CheckLine)
    /* Lines written before the controls joined the corpus carry no slug. */
    .map((l) => ({ ...l, slug: l.slug ?? PID, model: key }));
}

const levelId = (l: { arm: string; slug: string; level: Level }) => `${l.arm}/${l.slug}/${l.level}`;

async function check(key: ModelKey, armFilter: string[] | null, budget: number): Promise<void> {
  loadEnvLocal();
  const corpus = JSON.parse(fs.readFileSync(CORPUS, "utf8")) as Corpus;
  /* Whatever its outcome: the first answer is the one a press would have had. */
  const done = new Set(readLines(key).map(levelId));
  const presses = [...new Set(corpus.levels.map((l) => `${l.arm}/${l.slug}`))].filter(
    (p) => !armFilter || armFilter.some((f) => p.startsWith(f)),
  );
  let spent = 0;
  for (const press of presses) {
    if (spent >= budget) {
      console.log(`budget $${budget} reached at $${spent.toFixed(4)}; stopping before ${press}`);
      break;
    }
    const todo = corpus.levels.filter((l) => `${l.arm}/${l.slug}` === press && !done.has(levelId(l)));
    if (todo.length === 0) continue;
    const pressStart = Date.now();
    const lines = await Promise.all(todo.map((l) => checkLevel(key, l, corpus.blocks[l.slug] ?? {})));
    const pressMs = Date.now() - pressStart;
    for (const line of lines) {
      spent += line.costUsd;
      fs.appendFileSync(outFile(key), `${JSON.stringify({ ...line, pressMs })}\n`);
    }
    const flagged = lines.flatMap((l) =>
      (l.verdicts ?? []).filter((v) => v.verdict === "contradicts").map((v) => `${l.level}/${v.n - 1}`),
    );
    const errors = lines.filter((l) => l.error).map((l) => `${l.level}: ${l.error}`);
    console.log(
      `${press}: ${pressMs} ms, $${lines.reduce((n, l) => n + l.costUsd, 0).toFixed(4)}, flagged [${flagged.join(" ")}]` +
        (errors.length ? ` ERRORS ${errors.join("; ")}` : ""),
    );
  }
  console.log(`spent $${spent.toFixed(4)} this invocation`);
  const { closeDb } = await import("../../src/db/client.js");
  await closeDb();
}

/* ------------------------------------------------------------------- score -- */

function pct(a: number, b: number): string {
  return `${a}/${b}${b ? ` (${Math.round((100 * a) / b)}%)` : ""}`;
}

function score(): void {
  const corpus = JSON.parse(fs.readFileSync(CORPUS, "utf8")) as Corpus;
  const labels = JSON.parse(fs.readFileSync(LABELS, "utf8")) as Labels;
  const paraByKey = new Map(corpus.levels.flatMap((l) => l.paragraphs.map((p) => [p.key, p] as const)));
  const labelledKeys = [
    ...Object.keys(labels.faults),
    ...Object.keys(labels.borderline),
    ...Object.keys(labels.alarmsReadByHand),
  ];
  for (const key of labelledKeys)
    if (!paraByKey.has(key)) throw new Error(`label ${key} names no paragraph in the corpus`);

  const failedPid = corpus.failedRuns.filter((run) => run.endsWith(`/${PID}`)).length;
  console.log(`writer failures excluded before checking: ${corpus.failedRuns.length} (${failedPid} PID, ${corpus.failedRuns.length - failedPid} controls)`);

  for (const key of MODEL_KEYS) {
    const all = readLines(key);
    if (all.length === 0) continue;
    /* First line per level: what a press would have got. */
    const byLevel = new Map<string, CheckLine>();
    for (const l of all) if (!byLevel.has(levelId(l))) byLevel.set(levelId(l), l);
    const levels = corpus.levels.filter((l) => byLevel.has(levelId(l)));
    const unreadable = levels.filter((l) => !byLevel.get(levelId(l))!.verdicts);

    const kinds: Record<string, { n: number; caught: number }> = {};
    const evidenced = { n: 0, caught: 0 };
    const alarms: Record<AlarmVerdict | "unread", string[]> = { real: [], borderline: [], "true-elsewhere": [], false: [], unread: [] };
    const clean = { pid: 0, control: 0 };
    const cleanFlag = { pid: 0, control: 0 };
    /* Output level, readable answers only: does the level have a labelled fault, and was it flagged at all. */
    const outputs: { shipped: boolean; slug: string; level: Level; fault: boolean; flagged: boolean }[] = [];

    for (const level of levels) {
      const line = byLevel.get(levelId(level))!;
      if (!line.verdicts) continue;
      let fault = false;
      let flaggedAny = false;
      let borderlineLevel = false;
      for (const [i, p] of level.paragraphs.entries()) {
        const flagged = line.verdicts[i]?.verdict === "contradicts";
        const label = labels.faults[p.key];
        if (flagged) flaggedAny = true;
        if (label) {
          fault = true;
          kinds[label.kind] ??= { n: 0, caught: 0 };
          kinds[label.kind]!.n += 1;
          if (flagged) kinds[label.kind]!.caught += 1;
          if (p.ids.includes(FINDING)) {
            evidenced.n += 1;
            if (flagged) evidenced.caught += 1;
          }
          continue;
        }
        const read = labels.alarmsReadByHand[p.key];
        /* A paragraph adjudicated borderline is outside every denominator,
           including the output-level operational rates. Keep its alarm in the
           audit count, but do not silently count it as a clean flag. */
        if (labels.borderline[p.key] || read?.verdict === "borderline") {
          borderlineLevel = true;
          if (flagged && read?.verdict === "borderline") alarms.borderline.push(p.key);
          continue;
        }
        const pool = level.slug === PID ? "pid" : "control";
        clean[pool] += 1;
        if (!flagged) continue;
        cleanFlag[pool] += 1;
        alarms[read ? read.verdict : "unread"].push(p.key);
      }
      if (!borderlineLevel) {
        outputs.push({
          shipped: SHIPPED.test(level.arm),
          slug: level.slug,
          level: level.level,
          fault,
          flagged: flaggedAny,
        });
      }
    }

    const cost = all.reduce((n, l) => n + l.costUsd, 0);
    const pressIds = [...new Set(levels.map((l) => `${l.arm}/${l.slug}`))];
    const completePressIds = pressIds.filter(
      (p) => levels.filter((l) => `${l.arm}/${l.slug}` === p).length === LEVELS.length,
    );
    const pressMs = completePressIds
      .map((p) => Math.max(...levels.filter((l) => `${l.arm}/${l.slug}` === p).map((l) => byLevel.get(levelId(l))!.pressMs)))
      .sort((a, b) => a - b);
    const completePressCost = completePressIds.map((p) =>
      levels
        .filter((l) => `${l.arm}/${l.slug}` === p)
        .reduce((n, l) => n + byLevel.get(levelId(l))!.costUsd, 0),
    );
    const shippedPressIds = completePressIds.filter((p) => SHIPPED.test(p.split("/")[0] ?? ""));
    const shippedCost = shippedPressIds.reduce(
      (n, p) =>
        n +
        levels
          .filter((l) => `${l.arm}/${l.slug}` === p)
          .reduce((m, l) => m + byLevel.get(levelId(l))!.costUsd, 0),
      0,
    );
    const callMs = levels.map((l) => byLevel.get(levelId(l))!.ms).sort((a, b) => a - b);
    const q = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] ?? 0;

    console.log(
      `\n== ${key}: ${pressIds.length} saved runs (${completePressIds.length} complete three-level presses), ` +
        `${levels.length} levels, ${all.length} calls`,
    );
    console.log(
      `  unreadable or failed answers: ${pct(unreadable.length, levels.length)}${unreadable.length ? ` — ${unreadable.map(levelId).join(", ")}` : ""}`,
    );
    console.log(`  PID challenge set, paragraph recall:`);
    for (const [k, v] of Object.entries(kinds)) console.log(`    ${k}: ${pct(v.caught, v.n)}`);
    const totN = Object.values(kinds).reduce((n, v) => n + v.n, 0);
    const totC = Object.values(kinds).reduce((n, v) => n + v.caught, 0);
    console.log(`    all: ${pct(totC, totN)}; among those citing ${FINDING}: ${pct(evidenced.caught, evidenced.n)}`);
    console.log(`  alarms on unlabelled paragraphs: PID ${pct(cleanFlag.pid, clean.pid)}, controls ${pct(cleanFlag.control, clean.control)}`);
    console.log(`    hand-read: real ${alarms.real.length}, borderline ${alarms.borderline.length}, true elsewhere in the article but not in its cited passages ${alarms["true-elsewhere"].length}, false ${alarms.false.length}, NOT YET READ ${alarms.unread.length}`);
    for (const group of [
      ["shipped config, PID", (o: (typeof outputs)[number]) => o.shipped && o.slug === PID],
      ["shipped config, controls", (o: (typeof outputs)[number]) => o.shipped && o.slug !== PID],
      ["all, PID", (o: (typeof outputs)[number]) => o.slug === PID],
      ["all, controls", (o: (typeof outputs)[number]) => o.slug !== PID],
    ] as const) {
      const os = outputs.filter(group[1]);
      const faulty = os.filter((o) => o.fault);
      const ok = os.filter((o) => !o.fault);
      console.log(
        `  outputs (${group[0]}): ${os.length}; faulty ${faulty.length}, of which flagged ${faulty.filter((o) => o.flagged).length}; ` +
          `without a labelled fault ${ok.length}, of which flagged ${ok.filter((o) => o.flagged).length}`,
      );
    }
    for (const level of LEVELS) {
      const os = outputs.filter((o) => o.shipped && o.slug === PID && o.level === level);
      const faulty = os.filter((o) => o.fault);
      const ok = os.filter((o) => !o.fault);
      console.log(
        `  shipped PID ${level}: ${os.length}; faulty ${faulty.length}, of which flagged ${faulty.filter((o) => o.flagged).length}; ` +
          `without a labelled fault ${ok.length}, of which flagged ${ok.filter((o) => o.flagged).length}`,
      );
    }
    const meanCompletePressCost = completePressCost.reduce((n, c) => n + c, 0) / Math.max(1, completePressCost.length);
    console.log(
      `  cost: $${cost.toFixed(4)} over ${all.length} calls; $${meanCompletePressCost.toFixed(4)} per complete three-level press; ` +
        `shipped configuration $${(shippedCost / Math.max(1, shippedPressIds.length)).toFixed(4)} per three-level press` +
        (all.some((l) => l.unpriced) ? " (some unpriced)" : ""),
    );
    console.log(`  one call: median ${q(callMs, 0.5)} ms, p90 ${q(callMs, 0.9)} ms`);
    console.log(`  a complete press (three levels in parallel): median ${q(pressMs, 0.5)} ms, p90 ${q(pressMs, 0.9)} ms, max ${pressMs.at(-1)} ms`);
    for (const [verdict, keys] of Object.entries(alarms))
      for (const k of keys) {
        const p = paraByKey.get(k)!;
        const lvl = corpus.levels.find((l) => l.paragraphs.includes(p))!;
        const i = lvl.paragraphs.indexOf(p);
        const why = byLevel.get(levelId(lvl))?.verdicts?.[i]?.why ?? "";
        console.log(`  alarm [${verdict}] ${k}: ${why}`);
      }
    const missed = Object.keys(labels.faults).filter((k) => {
      const p = paraByKey.get(k)!;
      const lvl = corpus.levels.find((l) => l.paragraphs.includes(p))!;
      const line = byLevel.get(levelId(lvl));
      return line?.verdicts && line.verdicts[lvl.paragraphs.indexOf(p)]?.verdict !== "contradicts";
    });
    console.log(`  missed faults: ${missed.join(" ")}`);
  }
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === "corpus") await buildCorpus();
else if (mode === "check") {
  const key = rest[0] as ModelKey;
  if (!MODEL_KEYS.includes(key)) throw new Error("check needs luna or sonnet");
  const armsAt = rest.indexOf("--arms");
  const budgetAt = rest.indexOf("--budget");
  await check(key, armsAt >= 0 ? rest[armsAt + 1]!.split(",") : null, budgetAt >= 0 ? Number(rest[budgetAt + 1]) : 0.8);
} else if (mode === "score") score();
else throw new Error("usage: corpus | check <luna|sonnet> [--arms p,q] [--budget d] | score");
