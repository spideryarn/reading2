/**
 * **The report, with the aggregations declared before the run** — plan
 * 261001s § Judging (Declared before the run), § Noise, § Cost and latency.
 *
 * Pure: it reads cells and captures and returns numbers and markdown. Nothing
 * in it quotes an answer, a passage or an excerpt — the report is what may be
 * promoted into git; the cells are not (Sol F9).
 *
 * - **Primary quality** — an arm's mean of (its overall − the anchor's overall
 *   in the same batch), over every delivered answer the panel could judge.
 *   Delivery is reported separately and still counts against acceptability.
 * - **Acceptable** — delivered, accuracy ≥ 4 and sourcing ≥ 4 from at least
 *   two of the three judges (a smaller smoke panel cannot certify one), and
 *   no error with an evidence pointer reported by two or more judges (the same
 *   block id, source number, or normalized outside-knowledge fact). A refused
 *   press is not acceptable.
 * - **The frontier** — arms no other beats on both acceptable rate and repeat
 *   press cost, and the same on primary quality; `opus-b` excluded.
 * - **Repeat press** — a cell whose cache read covers ≥ 90% of its prefix; a
 *   later run that read less is a cache miss and is not averaged in. Models
 *   with no cache price advantage are valid full-price repeat observations.
 * - **First press** — run 1 where it was cold (read < 10% of the prefix),
 *   measured; else reconstructed as its cost + prefix × (write − read price).
 */
import { ANCHOR_ARM, type Arm, armFamily, armById, familyOf, priceOf, readPrice, writePrice } from "./arms.js";
import { judgeById } from "./judges.js";
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
  const examples = [...byExample.values()].map(mean).filter((x): x is number => x !== null);
  if (examples.length < 2) return null;
  const rand = seeded(seed);
  const means: number[] = [];
  for (let d = 0; d < draws; d++) {
    const pool: number[] = [];
    for (let i = 0; i < examples.length; i++) pool.push(examples[Math.floor(rand() * examples.length)] as number);
    means.push(mean(pool) as number);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(draws * 0.05)] as number, means[Math.floor(draws * 0.95)] as number];
}

/* ------------------------------------------------------------- cost -- */

/** The cached prefix a call sent, in tokens: its input × the share of characters that sit before the breakpoint. */
export const prefixTokensOf = (c: CallObs, share: number): number => Math.round((c.inputTokens ?? 0) * share);

export type CacheState = "cold" | "warm" | "partial" | "unknown" | "not-applicable";

export function cacheStateOf(c: CallObs, share: number): CacheState {
  const p = priceOf(c.requested);
  if (readPrice(p) >= writePrice(p)) return "not-applicable";
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
export function reconstructCold(c: CallObs, _share: number): number | null {
  if (c.usd === null) return null;
  const p = priceOf(c.requested);
  /* On a warm request the provider's cache-read count is the measured prefix.
     The character share is only needed to classify the hit; capping a real
     token count by that approximation makes the reconstructed first price too
     small when token density differs across system/article/suffix. */
  const read = c.cacheReadTokens ?? 0;
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

/** A probe answers for one concrete route; an arm renamed onto another model needs a fresh one. */
export function probeResultFor(results: readonly ProbeResult[] | undefined, arm: string, model: string): ProbeResult | null {
  return results?.find((result) => result.arm === arm && result.model === model) ?? null;
}

/** Whether a second Citation press skips *Look it up*. A no-match is retried in production. */
export function citationRepeatSkipsLookup(capture: Capture): boolean {
  const c = capture.citation;
  /* Production skips only a current `assessed` row. `found` is not enough: it
     can carry no-extract/not-identified/unreadable, all of which retry. A
     legacy capture lacks the state, so charge the retry in the safe direction. */
  return c !== undefined && (!c.lookupRan || c.lookupState === "assessed");
}

export interface ArmRow {
  arm: string;
  presses: number;
  judgedPresses: number;
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
  sharedFirstUsd: number | null;
  sharedRepeatUsd: number | null;
  ttftMs: number | null;
  totalMs: number | null;
  waitFirstMs: number | null;
  waitRepeatMs: number | null;
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
  /* The anchor is in every batch. Keep all its ratings for criteria and
     context sensitivity; `acceptability` groups them back to one vote per
     judge, rather than choosing batch zero arbitrarily. */
  return out;
}

/** Acceptable, per (example, run), for one arm. */
export function acceptability(
  judged: readonly Judged[],
  delivered: boolean,
): boolean {
  if (!delivered || judged.length === 0) return false;
  const byJudge = new Map<string, Judged[]>();
  for (const j of judged) byJudge.set(j.judge, [...(byJudge.get(j.judge) ?? []), j]);
  /* The declared rule is two votes from a three-member panel, not unanimity
     from whatever smaller panel happened to be retained. In particular, a
     budget trim must not turn two available votes into a certification. */
  if (byJudge.size < 3) return false;
  const good = [...byJudge.values()].filter(
    (ratings) => (mean(ratings.map((j) => j.s.accuracy)) ?? 0) >= 4 && (mean(ratings.map((j) => j.s.sourcing)) ?? 0) >= 4,
  ).length;
  /* Fixed before the run: two members of the complete three-judge panel. */
  if (good < 2) return false;
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
  return ![...counts.values()].some((s) => s.size >= 2);
}

export function armRow(inp: ReportInputs, armId: string): ArmRow {
  const sel = inp.manifest.selection;
  const judgeRuns = sel.judgeRuns ?? sel.runs;
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
  for (const c of cells.filter((cell) => cell.run <= judgeRuns)) {
    const ok = acceptability(
      judged.filter((j) => j.example === c.example && j.run === c.run),
      c.delivery.delivered,
    );
    if (ok) acceptable++;
    acceptableByExample.set(c.example, (acceptableByExample.get(c.example) ?? 0) + (ok ? 1 : 0) / judgeRuns);
  }

  /* Cost. */
  const repeat: number[] = [];
  let misses = 0;
  const first: number[] = [];
  for (const c of cells) {
    const usd = cellUsd(c);
    const share = (k: CallObs) => k.prefixShare ?? c.prefixShare;
    const states = c.calls.map((k) => cacheStateOf(k, share(k)));
    if (c.run > 1) {
      if (states.length > 0 && states.every((s) => s === "warm" || s === "not-applicable") && usd !== null) repeat.push(usd);
      else misses++;
    } else if (usd !== null) {
      if (states.every((s) => s === "cold" || s === "not-applicable")) first.push(usd);
      else if (states.some((s) => s === "unknown")) {
        /* Unknown is not evidence of a cold press. */
      }
      else {
        const rebuilt = c.calls.map((k) => {
          const state = cacheStateOf(k, share(k));
          return state === "cold" || state === "not-applicable" ? k.usd : reconstructCold(k, share(k));
        });
        if (rebuilt.every((x) => x !== null)) first.push(rebuilt.reduce((a, b) => (a as number) + (b as number), 0) as number);
      }
    }
  }
  const examples = [...new Set(cells.map((c) => c.example))];
  const shared = (repeatPress: boolean) =>
    mean(
      examples.flatMap((e) => {
        const cap = inp.captures.get(e);
        if (!cap || cap.shared.some((s) => s.usd === null)) return [];
        const calls = repeatPress && citationRepeatSkipsLookup(cap) ? cap.shared.filter((s) => s.job !== "citations-find") : cap.shared;
        return [calls.reduce((n, s) => n + (s.usd ?? 0), 0)];
      }),
    );

  /* Latency. */
  const waitFirst: number[] = [];
  const waitRepeat: number[] = [];
  for (const c of cells) {
    if (c.firstWordMs === null || !c.delivery.delivered) continue;
    const t = inp.captures.get(c.example)?.timings;
    if (!t) continue;
    const paper = (t.paperMs ?? 0) + (t.passagesMs ?? 0);
    waitFirst.push(t.searchMs + (t.lookupMs ?? 0) + paper + c.firstWordMs);
    waitRepeat.push(t.searchMs + (citationRepeatSkipsLookup(inp.captures.get(c.example) as Capture) ? 0 : (t.lookupMs ?? 0)) + paper + c.firstWordMs);
  }
  const answerCalls = cells.flatMap((cell) => {
    const call = cell.calls[cell.calls.length - 1];
    return call ? [{ cell, call }] : [];
  });
  const runMeans = Array.from({ length: judgeRuns }, (_, i) => mean(judged.filter((j) => j.run === i + 1 && j.anchor !== null).map((j) => j.s.overall - (j.anchor as number)))).filter(
    (x): x is number => x !== null,
  );
  const checks = cells.filter((c) => c.check !== null);
  const validChecks = checks.filter((c) => c.check?.verdict !== "invalid");
  const deliveredCells = cells.filter((c) => c.delivery.delivered);
  const crit = (k: "accuracy" | "sourcing" | "depth" | "plain_words" | "overall") => mean(judged.map((j) => j.s[k]));
  return {
    arm: armId,
    presses: sel.examples.length * sel.runs,
    judgedPresses: sel.examples.length * judgeRuns,
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
    sharedFirstUsd: shared(false),
    sharedRepeatUsd: shared(true),
    ttftMs: median(deliveredCells.map((c) => c.firstWordMs).filter((x): x is number => x !== null)),
    totalMs: median(deliveredCells.map((c) => c.calls.reduce((n, call) => n + call.totalMs, 0))),
    waitFirstMs: median(waitFirst),
    waitRepeatMs: median(waitRepeat),
    cacheReadShare: mean(
      answerCalls.flatMap(({ cell, call }) => {
        const prefix = prefixTokensOf(call, call.prefixShare ?? cell.prefixShare);
        return prefix > 0 && call.cacheReadTokens !== null ? [Math.min(1, call.cacheReadTokens / prefix)] : [];
      }),
    ),
    truncations: cells.filter((c) => c.calls.some((k) => k.ending === "truncated")).length,
    failures: cells.filter((c) => !c.delivery.delivered).map((c) => `${c.example} r${c.run}: ${c.delivery.delivered ? "" : c.delivery.why}`),
    replaceRate: validChecks.length ? validChecks.filter((c) => c.check?.verdict === "replace").length / validChecks.length : null,
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
  const main = new Map<string, number[]>();
  const again = new Map<string, number[]>();
  for (const cell of inp.judgements.values()) {
    if (!cell.scores || cell.run !== 1) continue;
    for (const [arm, s] of Object.entries(cell.scores)) {
      const k = `${cell.example}|${cell.judge}|${arm}`;
      if (cell.pass === "main") main.set(k, [...(main.get(k) ?? []), s.overall]);
      if (cell.pass === "rejudge") again.set(k, [...(again.get(k) ?? []), s.overall]);
    }
  }
  /* Opus is repeated in every batch. Compare one mean per judge/answer/pass,
     not whichever anchor batch happened to be inserted first. */
  const d = [...again.entries()].flatMap(([k, values]) => {
    const earlier = main.get(k);
    const a = mean(values);
    const b = mean(earlier ?? []);
    return a === null || b === null ? [] : [Math.abs(a - b)];
  });
  return { pairs: d.length, meanAbs: mean(d), within1: d.length ? d.filter((x) => x <= 1).length / d.length : null };
}

/** The repeated anchor's score, and each other answer minus that anchor, by displayed position. */
export function positionBias(inp: ReportInputs): { position: number; anchorN: number; anchorOverall: number | null; relativeN: number; vsAnchor: number | null }[] {
  const by = new Map<number, { anchor: number[]; relative: number[] }>();
  for (const cell of inp.judgements.values()) {
    if (cell.pass !== "main" || !cell.scores) continue;
    const anchor = cell.scores[ANCHOR_ARM]?.overall;
    for (const [arm, s] of Object.entries(cell.scores)) {
      const g = by.get(s.position) ?? { anchor: [], relative: [] };
      if (arm === ANCHOR_ARM) g.anchor.push(s.overall);
      else if (anchor !== undefined) g.relative.push(s.overall - anchor);
      by.set(s.position, g);
    }
  }
  return [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([position, values]) => ({
      position,
      anchorN: values.anchor.length,
      anchorOverall: mean(values.anchor),
      relativeN: values.relative.length,
      vsAnchor: mean(values.relative),
    }));
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
  const expectedAnswers = m.answers.length + (m.finalists?.answers.length ?? 0);
  const expectedJudgements = m.judgements.length + (m.finalists?.judgements.length ?? 0);
  const trimmedJudgements = m.trimmed?.dropped.length ?? 0;
  const lines: string[] = [];
  lines.push(`# Dig deeper answer models — run \`${m.run}\``, "");
  lines.push(
    complete
      ? `**Complete ${trimmedJudgements ? "trimmed " : ""}run**: every retained manifest answer and judgement is present, current and valid${m.finalists ? ", and every required finalist probe is current" : ""} (${expectedAnswers} answers, ${expectedJudgements} judgements${trimmedJudgements ? `; ${trimmedJudgements} planned judgements deliberately omitted` : ""}).`
      : `**PARTIAL — not a result.** ${inp.missing.length} expected cell(s) missing or stale: ${inp.missing.slice(0, 20).join(", ")}${inp.missing.length > 20 ? ", …" : ""}`,
    "",
    `Selection: examples ${m.selection.examples.join(", ")}; arms ${m.selection.arms.join(", ")}; ${m.selection.runs} answer run(s), first ${m.selection.judgeRuns ?? m.selection.runs} judged; judges ${m.selection.judges.join(", ")}; re-judge ${m.selection.rejudge ? "on" : "off"}${trimmedJudgements ? `; declared trim removed ${trimmedJudgements} judge calls` : ""}. Commit at manifest: \`${m.commit.slice(0, 12)}\`.`,
    "",
    "Costs use the ledger's billed-spend rule. Ordinary OpenRouter calls are credits from `usage.cost` (cash is about 5.5% more when buying those credits); BYOK calls use the reported upstream inference cost and are billed on that provider's account instead.",
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
    "| arm | delivered | acceptable (judged) | primary (vs opus) | 90% CI | outside-family | acc | src | depth | plain | overall | errors (pointed / not) | words | first press | repeat press (n, misses) | shared: first / repeat | answer: first word / total | wait: first / repeat | prefix read | truncated |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const r of rows) {
    lines.push(
      `| ${r.arm} | ${r.delivered}/${r.presses} | ${r.acceptable}/${r.judgedPresses} | ${n2(r.primary)} | ${r.primaryCi ? `${n2(r.primaryCi[0])} – ${n2(r.primaryCi[1])}` : "–"} | ${n2(r.outsideFamily)} | ${n2(r.criteria.accuracy, 1)} | ${n2(r.criteria.sourcing, 1)} | ${n2(r.criteria.depth, 1)} | ${n2(r.criteria.plain_words, 1)} | ${n2(r.criteria.overall, 1)} | ${n2(r.pointedErrors, 1)} / ${n2(r.unpointedErrors, 1)} | ${n2(r.words, 0)} | ${$(r.firstUsd)} | ${$(r.repeatUsd)} (${r.repeatSamples}, ${r.cacheMisses}) | ${$(r.sharedFirstUsd)} / ${$(r.sharedRepeatUsd)} | ${s1(r.ttftMs)} / ${s1(r.totalMs)} | ${s1(r.waitFirstMs)} / ${s1(r.waitRepeatMs)} | ${pct(r.cacheReadShare)} | ${r.truncations} |`,
    );
  }
  lines.push(
    "",
    "Primary and criterion means are conditional on delivered answers the panel could score; the delivered column exposes that denominator. Acceptability includes every scheduled judged press, so a refusal or delivery failure counts against it.",
    "Shared first-press cost and time are the frozen capture. Shared repeat is a conservative reconstruction, not a second measurement: it removes *Look it up* only where production would skip an assessed lookup and otherwise holds the captured shared calls fixed.",
    "",
  );
  const judgeRuns = m.selection.judgeRuns ?? m.selection.runs;
  const reducedPanelPresses = m.selection.examples.flatMap((example) =>
    Array.from({ length: judgeRuns }, (_, i) => new Set(m.judgements.filter((s) => s.pass === "main" && s.example === example && s.run === i + 1).map((s) => s.judge)).size),
  ).filter((n) => n < 3).length;
  if (reducedPanelPresses) {
    lines.push(
      `**Reduced panel**: ${reducedPanelPresses} judged press(es) had fewer than three judges. Their scores remain in quality means, but they cannot be certified acceptable under the declared two-of-three rule.`,
      "",
    );
  }
  const check = rows.find((r) => r.replaceRate !== null);
  if (check) lines.push(`**The Opus check** (\`${check.arm}\`): replaced the draft in ${pct(check.replaceRate)} of presses; the check call alone cost ${$(check.checkUsd)} a press on average.`, "");

  /* Noise. */
  lines.push("## Noise", "");
  const ob = rows.find((r) => r.arm === "opus-b");
  if (ob) lines.push(`- **Incumbent generation spread** (opus-b against opus, judged blind side by side): ${n2(ob.primary)} (90% CI ${ob.primaryCi ? `${n2(ob.primaryCi[0])} – ${n2(ob.primaryCi[1])}` : "–"}). This is the spread of one model drawn twice, not a universal floor.`);
  lines.push(`- **Run-to-run spread** (SD across runs of each arm's mean difference from opus): ${rows.filter((r) => r.arm !== ANCHOR_ARM).map((r) => `${r.arm} ${n2(r.runSpread)}`).join(", ")}.`);
  const st = judgeStability(inp);
  lines.push(`- **Judge stability** (retained run-1 re-judgements with a fresh shuffle): ${st.pairs} pairs, mean |Δ overall| ${n2(st.meanAbs)}, within one point ${pct(st.within1)}.`);
  lines.push(`- **Position** (the repeated Opus answer's mean; non-anchor mean vs Opus in the same batch): ${positionBias(inp).map((p) => `${p.position + 1}: Opus ${n2(p.anchorOverall)} (n ${p.anchorN}); ${n2(p.vsAnchor)} vs Opus (n ${p.relativeN})`).join("; ")}.`);
  const disagree = rows.filter((r) => r.primary !== null && r.outsideFamily !== null && (Math.sign(r.primary) !== Math.sign(r.outsideFamily) || Math.abs(r.primary - r.outsideFamily) > 1));
  lines.push(`- **Outside-family sensitivity**: ${disagree.length ? `disagrees with the all-judge mean for ${disagree.map((r) => r.arm).join(", ")}` : "agrees with the all-judge mean for every arm"}.`, "");

  /* Frontier. */
  lines.push("## The frontier", "");
  const eligible = rows.filter((r) => armById(r.arm).frontier && r.repeatUsd !== null && r.sharedRepeatUsd !== null);
  const total = (r: ArmRow) => (r.repeatUsd ?? 0) + (r.sharedRepeatUsd ?? 0);
  const fa = frontier(eligible.map((r) => ({ arm: r.arm, quality: r.acceptable / r.judgedPresses, cost: total(r) })));
  const fq = frontier(eligible.filter((r) => r.primary !== null).map((r) => ({ arm: r.arm, quality: r.primary as number, cost: total(r) })));
  lines.push(`- On acceptable rate against repeat-press cost: **${fa.join(", ") || "–"}**.`);
  lines.push(`- On primary quality against repeat-press cost: **${fq.join(", ") || "–"}**.`);
  const skipped = rows.filter((r) => armById(r.arm).frontier && (r.repeatUsd === null || r.sharedRepeatUsd === null)).map((r) => r.arm);
  if (skipped.length) lines.push(`- Left out for want of a measured repeat press or shared cost: ${skipped.join(", ")}.`);
  lines.push("");

  lines.push("## Three readings, for Greg to choose between", "");
  const price = (r: ArmRow) => `${$(total(r))} a press, ${$(total(r) * 100, 2)} a hundred (repeat press with the shared search step)`;
  const best = [...eligible].filter((r) => r.primary !== null).sort((a, b) => (b.primary as number) - (a.primary as number))[0];
  lines.push(best ? `1. **Best quality**: ${best.arm} — primary ${n2(best.primary)}; ${price(best)}.` : "1. **Best quality**: – (needs a primary score and a measured repeat price).");
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
