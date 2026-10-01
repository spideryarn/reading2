/**
 * **The report, with the aggregations declared before the run** — plan
 * 261001s § Judging (Declared before the run), § Noise, § Cost and latency.
 *
 * Pure: it reads cells and captures and returns numbers and markdown. Nothing
 * in it quotes an answer, a passage or an excerpt — the report is what may be
 * promoted into git; the cells are not (Sol F9).
 *
 * - **Primary quality** — an arm's mean of (its overall − the anchor's overall
 *   in the same batch), over every example, run and judge.
 * - **Acceptable** — delivered, accuracy ≥ 4 and sourcing ≥ 4 from at least
 *   two of three judges (two thirds, rounded up, of however many judged), and
 *   no error with an evidence pointer reported by two or more judges (the same
 *   block id or source number). A refused press is not acceptable.
 * - **The frontier** — arms no other beats on both acceptable rate and repeat
 *   press cost, and the same on primary quality; `opus-b` excluded.
 * - **Repeat press** — a cell whose cache read covers ≥ 90% of its prefix; a
 *   later run that read less is a cache miss and is not averaged in.
 * - **First press** — run 1 where it was cold (read < 10% of the prefix),
 *   measured; else reconstructed as its cost + prefix × (write − read price).
 */
import { ANCHOR_ARM, type Arm, armFamily, armById, familyOf, judgeById, priceOf, readPrice, writePrice } from "./arms.js";
import type { AnswerCell, CallObs } from "./answer.js";
import type { Capture } from "./capture.js";
import { exampleById } from "./examples.js";
import type { JudgeCell } from "./judge.js";
import { pointerOf } from "./judge.js";
import { type Manifest, seeded } from "./manifest.js";

/* ------------------------------------------------------------- numbers -- */

export const mean = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const median = (xs: readonly number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};
export const sd = (xs: readonly number[]): number | null => {
  const m = mean(xs);
  if (m === null || xs.length < 2) return null;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

/** A 90% interval for the mean, bootstrapped over examples (the six examples are the sample, not the calls). */
export function bootstrapByExample(byExample: ReadonlyMap<string, readonly number[]>, seed = "bootstrap", draws = 2000): [number, number] | null {
  const groups = [...byExample.values()].filter((g) => g.length > 0);
  if (groups.length < 2) return null;
  const rand = seeded(seed);
  const means: number[] = [];
  for (let d = 0; d < draws; d++) {
    const pool: number[] = [];
    for (let i = 0; i < groups.length; i++) pool.push(...(groups[Math.floor(rand() * groups.length)] as number[]));
    means.push(mean(pool) as number);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(draws * 0.05)] as number, means[Math.floor(draws * 0.95)] as number];
}

/* ------------------------------------------------------------- cost -- */

/** The cached prefix a call sent, in tokens: its input × the share of characters that sit before the breakpoint. */
export const prefixTokensOf = (c: CallObs, share: number): number => Math.round((c.inputTokens ?? 0) * share);

export type CacheState = "cold" | "warm" | "partial" | "unknown";

export function cacheStateOf(c: CallObs, share: number): CacheState {
  const prefix = prefixTokensOf(c, share);
  if (!prefix || c.cacheReadTokens === null) return "unknown";
  const read = c.cacheReadTokens / prefix;
  return read >= 0.9 ? "warm" : read < 0.1 ? "cold" : "partial";
}

export const cellUsd = (cell: AnswerCell): number | null => {
  if (cell.calls.some((c) => c.usd === null)) return null;
  return cell.calls.reduce((n, c) => n + (c.usd ?? 0), 0);
};

/** A warm call's cost as if it had written its prefix instead of reading it. */
export function reconstructCold(c: CallObs, share: number): number | null {
  if (c.usd === null) return null;
  const p = priceOf(c.requested);
  const read = Math.min(c.cacheReadTokens ?? 0, prefixTokensOf(c, share));
  return c.usd + (read * (writePrice(p) - readPrice(p))) / 1e6;
}

/* ------------------------------------------------------------- inputs -- */

export interface ReportInputs {
  manifest: Manifest;
  answers: Map<string, AnswerCell>;
  judgements: Map<string, JudgeCell>;
  captures: Map<string, Capture>;
  /** Slots whose cells are missing or stale, from `completeness`. */
  missing: string[];
  probe?: ProbeResult[];
}

export interface ProbeResult {
  arm: string;
  model: string;
  ok: boolean;
  searches: number | null;
  status: string;
  usd: number | null;
}

export interface ArmRow {
  arm: string;
  presses: number;
  delivered: number;
  acceptable: number;
  primary: number | null;
  primaryCi: [number, number] | null;
  outsideFamily: number | null;
  criteria: { accuracy: number | null; sourcing: number | null; depth: number | null; plain_words: number | null; overall: number | null };
  pointedErrors: number | null;
  unpointedErrors: number | null;
  words: number | null;
  firstUsd: number | null;
  repeatUsd: number | null;
  repeatSamples: number;
  cacheMisses: number;
  sharedUsd: number | null;
  ttftMs: number | null;
  totalMs: number | null;
  waitLookupMs: number | null;
  waitAssessedMs: number | null;
  cacheReadShare: number | null;
  truncations: number;
  failures: string[];
  replaceRate: number | null;
  checkUsd: number | null;
  runSpread: number | null;
  acceptableByExample: Map<string, number>;
}

type Judged = { example: string; run: number; judge: string; pass: string; batch: number; s: NonNullable<JudgeCell["scores"]>[string]; anchor: number | null };

function judgedFor(inp: ReportInputs, arm: string, pass = "main"): Judged[] {
  const out: Judged[] = [];
  for (const cell of inp.judgements.values()) {
    if (cell.pass !== pass || !cell.scores) continue;
    const s = cell.scores[arm];
    if (!s) continue;
    const anchor = cell.scores[ANCHOR_ARM]?.overall ?? null;
    out.push({ example: cell.example, run: cell.run, judge: cell.judge, pass: cell.pass, batch: cell.batch, s, anchor });
  }
  /* The anchor is in every batch; one judgement per (example, run, judge) counts. */
  if (arm === ANCHOR_ARM) {
    const seen = new Set<string>();
    return out.filter((j) => {
      const k = `${j.example}|${j.run}|${j.judge}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  return out;
}

/** Acceptable, per (example, run), for one arm. */
export function acceptability(
  judged: readonly Judged[],
  delivered: boolean,
  judges: number,
): boolean {
  if (!delivered || judged.length === 0) return false;
  const need = Math.ceil((2 * judges) / 3);
  const good = judged.filter((j) => j.s.accuracy >= 4 && j.s.sourcing >= 4).length;
  if (good < need) return false;
  const counts = new Map<string, Set<string>>();
  for (const j of judged) {
    for (const e of j.s.errors) {
      const p = pointerOf(e.evidence);
      if (!p.ref) continue;
      const set = counts.get(p.ref) ?? new Set<string>();
      set.add(j.judge);
      counts.set(p.ref, set);
    }
  }
  const errThreshold = Math.min(2, judges);
  return ![...counts.values()].some((s) => s.size >= errThreshold);
}

export function armRow(inp: ReportInputs, armId: string): ArmRow {
  const sel = inp.manifest.selection;
  const arm: Arm = armById(armId);
  const cells = inp.manifest.answers
    .filter((s) => s.arm === armId)
    .map((s) => inp.answers.get(s.slot))
    .filter((c): c is AnswerCell => c !== undefined);
  const judged = judgedFor(inp, armId);
  const diffs = judged.filter((j) => j.anchor !== null).map((j) => j.s.overall - (j.anchor as number));
  const byExample = new Map<string, number[]>();
  for (const j of judged) {
    if (j.anchor === null) continue;
    const g = byExample.get(j.example) ?? [];
    g.push(j.s.overall - j.anchor);
    byExample.set(j.example, g);
  }
  const fam = armFamily(arm);
  const outside = judged.filter((j) => j.anchor !== null && familyOf(judgeById(j.judge).model) !== fam);

  let acceptable = 0;
  const acceptableByExample = new Map<string, number>();
  for (const c of cells) {
    const ok = acceptability(
      judged.filter((j) => j.example === c.example && j.run === c.run),
      c.delivery.delivered,
      sel.judges.length,
    );
    if (ok) acceptable++;
    acceptableByExample.set(c.example, (acceptableByExample.get(c.example) ?? 0) + (ok ? 1 : 0) / sel.runs);
  }

  /* Cost. */
  const repeat: number[] = [];
  let misses = 0;
  const first: number[] = [];
  for (const c of cells) {
    const usd = cellUsd(c);
    const states = c.calls.map((k) => cacheStateOf(k, c.prefixShare));
    if (c.run > 1) {
      if (states.length > 0 && states.every((s) => s === "warm") && usd !== null) repeat.push(usd);
      else misses++;
    } else if (usd !== null) {
      if (states.every((s) => s === "cold" || s === "unknown")) first.push(usd);
      else {
        const rebuilt = c.calls.map((k) => (cacheStateOf(k, c.prefixShare) === "cold" ? k.usd : reconstructCold(k, c.prefixShare)));
        if (rebuilt.every((x) => x !== null)) first.push(rebuilt.reduce((a, b) => (a as number) + (b as number), 0) as number);
      }
    }
  }
  const examples = [...new Set(cells.map((c) => c.example))];
  const sharedUsd = mean(
    examples.flatMap((e) => {
      const cap = inp.captures.get(e);
      if (!cap || cap.shared.some((s) => s.usd === null)) return [];
      return [cap.shared.reduce((n, s) => n + (s.usd ?? 0), 0)];
    }),
  );

  /* Latency. */
  const waitLookup: number[] = [];
  const waitAssessed: number[] = [];
  for (const c of cells) {
    if (c.firstWordMs === null || !c.delivery.delivered) continue;
    const t = inp.captures.get(c.example)?.timings;
    if (!t) continue;
    const paper = (t.paperMs ?? 0) + (t.passagesMs ?? 0);
    waitLookup.push(t.searchMs + (t.lookupMs ?? 0) + paper + c.firstWordMs);
    waitAssessed.push(t.searchMs + paper + c.firstWordMs);
  }
  const answerCalls = cells.map((c) => c.calls[c.calls.length - 1]).filter((c): c is CallObs => c !== undefined);
  const runMeans = Array.from({ length: sel.runs }, (_, i) => mean(judged.filter((j) => j.run === i + 1 && j.anchor !== null).map((j) => j.s.overall - (j.anchor as number)))).filter(
    (x): x is number => x !== null,
  );
  const checks = cells.filter((c) => c.check !== null);
  const crit = (k: "accuracy" | "sourcing" | "depth" | "plain_words" | "overall") => mean(judged.map((j) => j.s[k]));
  return {
    arm: armId,
    presses: sel.examples.length * sel.runs,
    delivered: cells.filter((c) => c.delivery.delivered).length,
    acceptable,
    primary: armId === ANCHOR_ARM ? 0 : mean(diffs),
    primaryCi: armId === ANCHOR_ARM ? null : bootstrapByExample(byExample, `ci|${armId}`),
    outsideFamily: armId === ANCHOR_ARM ? null : mean(outside.map((j) => j.s.overall - (j.anchor as number))),
    criteria: { accuracy: crit("accuracy"), sourcing: crit("sourcing"), depth: crit("depth"), plain_words: crit("plain_words"), overall: crit("overall") },
    pointedErrors: mean(judged.map((j) => j.s.errors.filter((e) => pointerOf(e.evidence).kind !== "none").length)),
    unpointedErrors: mean(judged.map((j) => j.s.errors.filter((e) => pointerOf(e.evidence).kind === "none").length)),
    words: mean(cells.filter((c) => c.delivery.delivered).map((c) => c.words)),
    firstUsd: mean(first),
    repeatUsd: mean(repeat),
    repeatSamples: repeat.length,
    cacheMisses: misses,
    sharedUsd,
    ttftMs: median(answerCalls.map((c) => c.ttftMs).filter((x): x is number => x !== null)),
    totalMs: median(answerCalls.map((c) => c.totalMs)),
    waitLookupMs: median(waitLookup),
    waitAssessedMs: median(waitAssessed),
    cacheReadShare: mean(answerCalls.filter((c) => c.inputTokens).map((c) => (c.cacheReadTokens ?? 0) / (c.inputTokens as number))),
    truncations: cells.filter((c) => c.calls.some((k) => k.ending === "truncated")).length,
    failures: cells.filter((c) => !c.delivery.delivered).map((c) => `${c.example} r${c.run}: ${c.delivery.delivered ? "" : c.delivery.why}`),
    replaceRate: checks.length ? checks.filter((c) => c.check?.verdict === "replace").length / checks.length : null,
    checkUsd: checks.length ? mean(checks.map((c) => c.calls[1]?.usd).filter((x): x is number => typeof x === "number")) : null,
    runSpread: sd(runMeans),
    acceptableByExample,
  };
}

/* ---------------------------------------------------------- the frontier -- */

export interface Point {
  arm: string;
  quality: number;
  cost: number;
}

/** Arms no other arm beats on both: at least as good and at least as cheap, and strictly better on one. */
export function frontier(points: readonly Point[]): string[] {
  return points
    .filter(
      (p) =>
        !points.some(
          (q) => q.arm !== p.arm && q.quality >= p.quality && q.cost <= p.cost && (q.quality > p.quality || q.cost < p.cost),
        ),
    )
    .map((p) => p.arm);
}

/* --------------------------------------------------------------- noise -- */

/** Judge stability: the same answers re-judged with a fresh shuffle. */
export function judgeStability(inp: ReportInputs): { pairs: number; meanAbs: number | null; within1: number | null } {
  const main = new Map<string, number>();
  const again = new Map<string, number>();
  for (const cell of inp.judgements.values()) {
    if (!cell.scores || cell.run !== 1) continue;
    for (const [arm, s] of Object.entries(cell.scores)) {
      const k = `${cell.example}|${cell.judge}|${arm}`;
      if (cell.pass === "main" && !main.has(k)) main.set(k, s.overall);
      if (cell.pass === "rejudge" && !again.has(k)) again.set(k, s.overall);
    }
  }
  const d = [...again.entries()].flatMap(([k, v]) => (main.has(k) ? [Math.abs(v - (main.get(k) as number))] : []));
  return { pairs: d.length, meanAbs: mean(d), within1: d.length ? d.filter((x) => x <= 1).length / d.length : null };
}

/** Mean overall, and mean overall minus the anchor, by position in the batch. */
export function positionBias(inp: ReportInputs): { position: number; n: number; overall: number | null }[] {
  const by = new Map<number, number[]>();
  for (const cell of inp.judgements.values()) {
    if (cell.pass !== "main" || !cell.scores) continue;
    for (const s of Object.values(cell.scores)) {
      const g = by.get(s.position) ?? [];
      g.push(s.overall);
      by.set(s.position, g);
    }
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([position, xs]) => ({ position, n: xs.length, overall: mean(xs) }));
}

/* ------------------------------------------------------------ markdown -- */

const $ = (x: number | null, d = 3) => (x === null ? "–" : `$${x.toFixed(d)}`);
const n2 = (x: number | null, d = 2) => (x === null ? "–" : x.toFixed(d));
const s1 = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(1)}s`);
const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);

export function renderReport(inp: ReportInputs): { markdown: string; rows: ArmRow[]; complete: boolean } {
  const m = inp.manifest;
  const rows = m.selection.arms.map((a) => armRow(inp, a));
  const complete = inp.missing.length === 0;
  const lines: string[] = [];
  lines.push(`# Dig deeper answer models — run \`${m.run}\``, "");
  lines.push(
    complete
      ? `**Complete**: every expected cell is present and current (${m.answers.length} answers, ${m.judgements.length} judgements).`
      : `**PARTIAL — not a result.** ${inp.missing.length} expected cell(s) missing or stale: ${inp.missing.slice(0, 20).join(", ")}${inp.missing.length > 20 ? ", …" : ""}`,
    "",
    `Selection: examples ${m.selection.examples.join(", ")}; arms ${m.selection.arms.join(", ")}; ${m.selection.runs} run(s); judges ${m.selection.judges.join(", ")}; re-judge ${m.selection.rejudge ? "on" : "off"}. Commit at manifest: \`${m.commit.slice(0, 12)}\`.`,
    "",
    "Costs are **OpenRouter credits**, from each call's own reported `usage.cost`; cash is about 5.5% more when credits are bought (src/cost-report.ts).",
    "",
  );
  const byok = [...new Set([...inp.answers.values()].flatMap((c) => c.calls.filter((k) => k.isByok === true).map((k) => k.requested)))];
  if (byok.length > 0) {
    lines.push(
      `**BYOK**: calls to ${byok.join(", ")} were served on our own provider key, so their \`usage.cost\` is a legitimate $0 of credits; they are priced here at the upstream figure plus any fee (\`totalSpend\`'s rule, src/ai-spend.ts), which is billed to that key rather than to credits.`,
      "",
    );
  }

  lines.push("## Per arm", "");
  lines.push(
    "| arm | delivered | acceptable | primary (vs opus) | 90% CI | outside-family | acc | src | depth | plain | overall | errors (pointed / not) | words | first press | repeat press (n, misses) | shared | ttft | total | wait: lookup / assessed | cache read | truncated |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const r of rows) {
    lines.push(
      `| ${r.arm} | ${r.delivered}/${r.presses} | ${r.acceptable}/${r.presses} | ${n2(r.primary)} | ${r.primaryCi ? `${n2(r.primaryCi[0])} – ${n2(r.primaryCi[1])}` : "–"} | ${n2(r.outsideFamily)} | ${n2(r.criteria.accuracy, 1)} | ${n2(r.criteria.sourcing, 1)} | ${n2(r.criteria.depth, 1)} | ${n2(r.criteria.plain_words, 1)} | ${n2(r.criteria.overall, 1)} | ${n2(r.pointedErrors, 1)} / ${n2(r.unpointedErrors, 1)} | ${n2(r.words, 0)} | ${$(r.firstUsd)} | ${$(r.repeatUsd)} (${r.repeatSamples}, ${r.cacheMisses}) | ${$(r.sharedUsd)} | ${s1(r.ttftMs)} | ${s1(r.totalMs)} | ${s1(r.waitLookupMs)} / ${s1(r.waitAssessedMs)} | ${pct(r.cacheReadShare)} | ${r.truncations} |`,
    );
  }
  lines.push("");
  const check = rows.find((r) => r.replaceRate !== null);
  if (check) lines.push(`**The Opus check** (\`${check.arm}\`): replaced the draft in ${pct(check.replaceRate)} of presses; the check call alone cost ${$(check.checkUsd)} a press on average.`, "");

  /* Noise. */
  lines.push("## Noise", "");
  const ob = rows.find((r) => r.arm === "opus-b");
  if (ob) lines.push(`- **Incumbent generation spread** (opus-b against opus, judged blind side by side): ${n2(ob.primary)} (90% CI ${ob.primaryCi ? `${n2(ob.primaryCi[0])} – ${n2(ob.primaryCi[1])}` : "–"}). This is the spread of one model drawn twice, not a universal floor.`);
  lines.push(`- **Run-to-run spread** (SD across runs of each arm's mean difference from opus): ${rows.filter((r) => r.arm !== ANCHOR_ARM).map((r) => `${r.arm} ${n2(r.runSpread)}`).join(", ")}.`);
  const st = judgeStability(inp);
  lines.push(`- **Judge stability** (run 1 re-judged with a fresh shuffle): ${st.pairs} pairs, mean |Δ overall| ${n2(st.meanAbs)}, within one point ${pct(st.within1)}.`);
  lines.push(`- **Position** (mean overall by position in the batch): ${positionBias(inp).map((p) => `${p.position + 1}: ${n2(p.overall)} (n ${p.n})`).join("; ")}.`);
  const disagree = rows.filter((r) => r.primary !== null && r.outsideFamily !== null && (Math.sign(r.primary) !== Math.sign(r.outsideFamily) || Math.abs(r.primary - r.outsideFamily) > 1));
  lines.push(`- **Outside-family sensitivity**: ${disagree.length ? `disagrees with the all-judge mean for ${disagree.map((r) => r.arm).join(", ")}` : "agrees with the all-judge mean for every arm"}.`, "");

  /* Frontier. */
  lines.push("## The frontier", "");
  const eligible = rows.filter((r) => armById(r.arm).frontier && r.repeatUsd !== null);
  const total = (r: ArmRow) => (r.repeatUsd ?? 0) + (r.sharedUsd ?? 0);
  const fa = frontier(eligible.map((r) => ({ arm: r.arm, quality: r.acceptable / r.presses, cost: total(r) })));
  const fq = frontier(eligible.filter((r) => r.primary !== null).map((r) => ({ arm: r.arm, quality: r.primary as number, cost: total(r) })));
  lines.push(`- On acceptable rate against repeat-press cost: **${fa.join(", ") || "–"}**.`);
  lines.push(`- On primary quality against repeat-press cost: **${fq.join(", ") || "–"}**.`);
  const skipped = rows.filter((r) => armById(r.arm).frontier && r.repeatUsd === null).map((r) => r.arm);
  if (skipped.length) lines.push(`- Left out for want of a measured repeat press: ${skipped.join(", ")}.`);
  lines.push("");

  lines.push("## Three readings, for Greg to choose between", "");
  const price = (r: ArmRow) => `${$(total(r))} a press, ${$(total(r) * 100, 2)} a hundred (repeat press with the shared search step)`;
  const best = [...eligible].filter((r) => r.primary !== null).sort((a, b) => (b.primary as number) - (a.primary as number))[0];
  if (best) lines.push(`1. **Best quality**: ${best.arm} — primary ${n2(best.primary)}; ${price(best)}.`);
  const spread = ob?.primary !== null && ob?.primary !== undefined ? Math.abs(ob.primary) : null;
  const within = spread === null ? [] : eligible.filter((r) => r.primary !== null && (r.primary as number) >= -spread).sort((a, b) => total(a) - total(b));
  lines.push(
    `2. **Cheapest within the incumbent spread of Opus** (primary ≥ −${n2(spread)}): ${within[0] ? `${within[0].arm}; ${price(within[0])}` : "– (needs opus-b and a repeat price)"}.`,
  );
  const everywhere = eligible.filter((r) => m.selection.examples.every((e) => (r.acceptableByExample.get(e) ?? 0) >= 2 / 3 - 1e-9)).sort((a, b) => total(a) - total(b));
  lines.push(`3. **Cheapest acceptable on every example** (acceptable in at least two thirds of its runs on each): ${everywhere[0] ? `${everywhere[0].arm}; ${price(everywhere[0])}` : "– none"}.`, "");

  /* Finalists. */
  if (m.finalists) {
    lines.push("## The production-shaped finalist run", "");
    const fin = m.finalists;
    const diffs = new Map<string, number[]>();
    for (const s of fin.judgements) {
      const cell = inp.judgements.get(s.slot);
      if (!cell?.scores) continue;
      const anchor = cell.scores[ANCHOR_ARM]?.overall;
      if (anchor === undefined) continue;
      for (const [arm, sc] of Object.entries(cell.scores)) {
        if (arm === ANCHOR_ARM) continue;
        const g = diffs.get(arm) ?? [];
        g.push(sc.overall - anchor);
        diffs.set(arm, g);
      }
    }
    const delivered = (arm: string) => fin.answers.filter((s) => s.arm === arm && inp.answers.get(s.slot)?.delivery.delivered).length;
    for (const arm of fin.arms) {
      const iso = rows.find((r) => r.arm === arm);
      lines.push(`- ${arm}: delivered ${delivered(arm)}/${fin.answers.filter((s) => s.arm === arm).length}; vs opus with the tool on ${n2(mean(diffs.get(arm) ?? []))} (isolated: ${n2(iso?.primary ?? null)}).`);
    }
    /* Opus is the zero both sides are measured from, so it is in both orders; an arm with no isolated score cannot be compared. */
    const isoOf = (a: string) => (a === ANCHOR_ARM ? 0 : (rows.find((r) => r.arm === a)?.primary ?? null));
    const finOf = (a: string) => (a === ANCHOR_ARM ? 0 : mean(diffs.get(a) ?? []));
    const comparable = fin.arms.filter((a) => isoOf(a) !== null && finOf(a) !== null);
    const isoOrder = [...comparable].sort((a, b) => (isoOf(b) as number) - (isoOf(a) as number));
    const finOrder = [...comparable].sort((a, b) => (finOf(b) as number) - (finOf(a) as number));
    const left = fin.arms.filter((a) => !comparable.includes(a));
    lines.push(
      comparable.length < 2
        ? "- The order cannot be compared: fewer than two finalists have both an isolated and a production-shaped score."
        : `- The isolated order **${isoOrder.join(" > ") === finOrder.join(" > ") ? "held" : "did not hold"}** (isolated ${isoOrder.join(" > ")}; production-shaped ${finOrder.join(" > ")})${left.length ? `; not comparable: ${left.join(", ")}` : ""}.`,
      "",
    );
  }

  if (inp.probe?.length) {
    lines.push("## Forced-search probe (compatibility only, not search quality)", "");
    for (const p of inp.probe) lines.push(`- ${p.arm} (${p.model}): ${p.ok ? `ran ${p.searches} search(es)` : `no: ${p.status}`}; ${$(p.usd, 4)}.`);
    lines.push("");
  }

  lines.push("## Presses that were not delivered", "");
  const failed = rows.flatMap((r) => r.failures.map((f) => `- ${r.arm}, ${f}`));
  lines.push(...(failed.length ? failed : ["- none"]), "");

  lines.push("## The examples", "");
  for (const id of m.selection.examples) {
    const ex = exampleById(id);
    const cap = inp.captures.get(id);
    lines.push(
      `- **${id}** (${ex.entry}; ${ex.article}) — ${ex.hard}. Capture ${cap ? `${cap.findings.sources.length} sources, ${cap.findings.library.length} library passages${cap.citation ? `, lookup ${cap.citation.lookupOutcome ?? "skipped"}, paper ${cap.citation.paperState}` : ""}; article sha ${cap.articleSha256.slice(0, 12)}` : "missing"}.`,
    );
  }
  lines.push("");
  return { markdown: `${lines.join("\n")}\n`, rows, complete };
}
