/**
 * **Which model should write a *Dig deeper* answer?** — the CLI for plan
 * 261001s (docs/plans/261001s-dig-deeper-answer-model-eval.md).
 *
 * ```
 * npm run eval:dig-deeper                                  # preflight: free, the full bill
 * npm run eval:dig-deeper -- capture --spend               # freeze the search step, all six
 * npm run eval:dig-deeper -- answers --spend               # every (example, arm, run)
 * npm run eval:dig-deeper -- judge --spend                 # every (example, run, judge, batch)
 * npm run eval:dig-deeper -- diagnose --spend              # length failures again at 8,000
 * npm run eval:dig-deeper -- finalists --spend --arms a,b  # production-shaped, plus Opus
 * npm run eval:dig-deeper -- probe --spend --arms a,b      # can it force its own search?
 * npm run eval:dig-deeper -- report                        # free; report.md in the run dir
 * ```
 *
 * **`--spend` is the only way to spend.** Without it every paid subcommand
 * says what it would do and stops. `--cap <dollars>` (default 35) bounds the
 * run's whole budget file, shared by every invocation on that `--run`.
 *
 * Selection flags, for answers, judge and preflight: `--run <name>` (default
 * `main`), `--captures <run>` (whose captures to answer from; default the same
 * run), `--examples a,b`, `--arms a,b`, `--runs N` (3 answer draws),
 * `--judge-runs N` (2 of those draws), `--judges a,b`,
 * `--no-rejudge`. The manifest is written by the first paid command on a run
 * and every later one must ask for the same selection.
 *
 * Everything raw — captures, answers, judgements, the budget — is under the
 * gitignored `output/dig-deeper-runs/<run>/` (Sol F9). Long runs belong in
 * tmux: `npx tsx scripts/tmux-job.ts --name dig-eval npm run eval:dig-deeper -- …`.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../../src/env.js";
import { isMain } from "../../src/is-main.js";
import type { Block, Meta } from "../../src/types.js";
import { type AnswerCell, answerCell, answerKey, cellRequests, probeForcedSearch, type CellInputs, totalReportedWebSearches } from "./answer.js";
import { ANCHOR_ARM, ARMS, armById, JUDGES, judgeById, lastPartText, modelMatches } from "./arms.js";
import { type Budget, BudgetHalted, BudgetRefused, type Ledger, openBudget, paidStep, recordUsd } from "./budget.js";
import { articleSha, type Capture, captureExample, sha256, type SharedCall } from "./capture.js";
import { EXAMPLES, type Example, exampleById } from "./examples.js";
import { type BatchAnswer, type JudgeCell, judgeBatch, judgeKey, judgeRequest, judgementIsComplete } from "./judge.js";
import {
  type AnswerSlot,
  completeness,
  currentCell,
  expectedSlots,
  type JudgeSlot,
  judgeSlots,
  type Manifest,
  readCell,
  readManifest,
  runDir,
  type Selection,
  sourceHash,
  writeCell,
  writeManifest,
} from "./manifest.js";
import { estimateBill, orderForCache, renderBill } from "./preflight.js";
import { type ProbeResult, probeResultFor, renderReport } from "./report.js";

const SEED = "261001s";
const ANSWER_SOURCE = () =>
  sourceHash([
    "arms.ts",
    "accept.ts",
    "answer.ts",
    "../../src/explain.ts",
    "../../src/term-lookup.ts",
    "../../src/citation-investigate.ts",
    "../../src/investigate-quote-guard.ts",
  ]);
const JUDGE_SOURCE = () => sourceHash(["judge.ts"]);

/* ------------------------------------------------------------- the flags -- */

export interface Flags {
  cmd: string;
  spend: boolean;
  run: string;
  captures: string;
  cap: number;
  sel: Selection;
  finalists: string[];
  ceiling: number;
  recapture: boolean;
}

export function parseFlags(argv: readonly string[]): Flags {
  const args = [...argv];
  const cmd = args[0] && !args[0].startsWith("--") ? (args.shift() as string) : "preflight";
  const known = new Set(["--spend", "--run", "--captures", "--cap", "--examples", "--arms", "--runs", "--judge-runs", "--judges", "--no-rejudge", "--finalists", "--ceiling", "--recapture"]);
  const value = (name: string): string | undefined => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const v = args[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${name} needs a value`);
    return v;
  };
  for (const a of args) if (a.startsWith("--") && !known.has(a)) throw new Error(`unknown flag ${a}`);
  const list = (name: string, all: readonly string[]): string[] => {
    const v = value(name);
    if (!v) return [...all];
    const items = v.split(",").map((s) => s.trim()).filter(Boolean);
    for (const i of items) if (!all.includes(i)) throw new Error(`${name}: unknown "${i}" — known: ${all.join(", ")}`);
    return items;
  };
  const run = value("--run") ?? "main";
  runDir(run);
  const arms = list("--arms", ARMS.map((a) => a.id));
  if (!arms.includes(ANCHOR_ARM) && cmd !== "finalists" && cmd !== "probe") throw new Error(`--arms must include the anchor, ${ANCHOR_ARM}`);
  const runs = Number(value("--runs") ?? 3);
  if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer");
  const judgeRuns = Number(value("--judge-runs") ?? 2);
  if (!Number.isInteger(judgeRuns) || judgeRuns < 1 || judgeRuns > runs) {
    throw new Error("--judge-runs must be a positive integer no larger than --runs");
  }
  return {
    cmd,
    spend: args.includes("--spend"),
    run,
    captures: value("--captures") ?? run,
    cap: Number(value("--cap") ?? 35),
    sel: {
      examples: list("--examples", EXAMPLES.map((e) => e.id)),
      arms,
      runs,
      judgeRuns,
      judges: list("--judges", JUDGES.map((j) => j.id)),
      rejudge: !args.includes("--no-rejudge"),
    },
    /* For the preflight's bill only; the real finalists are picked from the judged run. */
    finalists: value("--finalists") ? list("--finalists", ARMS.map((a) => a.id)) : ["sonnet-5.5", "sol"],
    ceiling: Number(value("--ceiling") ?? 8_000),
    recapture: args.includes("--recapture"),
  };
}

/* ------------------------------------------------------------- helpers -- */

function commit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const capturePath = (run: string, example: string) => path.join(runDir(run), "capture", `${example}.json`);

function readCapture(run: string, example: string): { capture: Capture; sha: string } | null {
  const p = capturePath(run, example);
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, "utf8");
  return { capture: JSON.parse(text) as Capture, sha: sha256(text) };
}

/** Run tasks with at most `limit` at once; the first error stops new ones and is rethrown. */
async function pool<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failed: unknown = null;
  const worker = async () => {
    while (failed === null && next < items.length) {
      const item = items[next++] as T;
      try {
        await fn(item);
      } catch (err) {
        failed ??= err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failed !== null) throw failed;
}

interface Store {
  loadArticle(slug: string): Promise<{ meta: Meta; blocks: Block[] }>;
  ledger: Ledger;
  owner: <T>(fn: () => Promise<T>) => Promise<T>;
  close(): Promise<void>;
  captureDeps: Parameters<typeof captureExample>[1];
}

/** The database, the owner and the ledger — imported only when a command needs them. */
async function openStore(): Promise<Store> {
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const store = await import("../../src/store/index.js");
  const { costStore } = await import("../../src/store/ai-calls.js");
  const { closeDb } = await import("../../src/db/client.js");
  const owner = environmentOwnerId();
  return {
    loadArticle: (slug) => store.loadArticle(slug),
    ledger: { attribution: { scopeKind: "eval", ownerId: owner }, sink: (row) => costStore.record(row) },
    owner: (fn) => runAsOwner(owner, fn),
    close: () => closeDb(),
    captureDeps: {
      loadArticle: (slug) => store.loadArticle(slug),
      loadGlossary: (slug) => store.loadGlossary(slug),
      library: (query, limit, opts) => store.librarySearch.searchLibrary(query, limit, opts),
      investigateDeps: store.investigateCitationDeps,
      loadCitations: (slug) => store.loadCitations(slug),
      loadFind: (slug, id) => store.citationFindStore.load(slug, id),
      commit: commit(),
    },
  };
}

/** The article, refused if it has changed since the capture. */
async function articleFor(store: Store, capture: Capture): Promise<{ meta: Meta; blocks: Block[] }> {
  const a = await store.loadArticle(capture.slug);
  if (articleSha(a.meta, a.blocks) !== capture.articleSha256) {
    throw new Error(`${capture.exampleId}: the article changed since it was captured — capture again with --recapture on a fresh run`);
  }
  return a;
}

function requireSpend(f: Flags, what: string): boolean {
  if (f.spend) return true;
  console.log(`${what}\nNothing spent: add --spend to run it (cap $${f.cap.toFixed(2)} on run "${f.run}").`);
  return false;
}

/** The manifest for this selection: written now if there is none, refused if it differs. */
function manifestFor(f: Flags): Manifest {
  const existing = readManifest(f.run);
  const captures: Record<string, string> = {};
  for (const id of f.sel.examples) {
    const c = readCapture(f.captures, id);
    if (!c) throw new Error(`no capture for ${id} in run "${f.captures}" — run capture --spend first`);
    captures[id] = c.sha;
  }
  if (existing) {
    if (JSON.stringify(existing.selection) !== JSON.stringify(f.sel) || existing.captures.from !== f.captures) {
      throw new Error(`run "${f.run}" was planned with a different selection or captures; use another --run`);
    }
    for (const [id, sha] of Object.entries(captures)) {
      if (existing.captures.sha256[id] !== sha) throw new Error(`the capture for ${id} changed since run "${f.run}" was planned; use another --run`);
    }
    return existing;
  }
  const m: Manifest = {
    run: f.run,
    createdAt: new Date().toISOString(),
    commit: commit(),
    selection: f.sel,
    captures: { from: f.captures, sha256: captures },
    ...expectedSlots(f.sel, ANCHOR_ARM, SEED),
  };
  writeManifest(m);
  console.log(`planned run "${f.run}": ${m.answers.length} answer cells, ${m.judgements.length} judging cells`);
  return m;
}

function capturesOf(m: Manifest): Map<string, Capture> {
  const out = new Map<string, Capture>();
  for (const id of m.selection.examples) {
    const c = readCapture(m.captures.from, id);
    if (c) out.set(id, c.capture);
  }
  return out;
}

/* -------------------------------------------------------------- capture -- */

async function capture(f: Flags): Promise<void> {
  const todo = f.sel.examples.filter((id) => f.recapture || !fs.existsSync(capturePath(f.run, id)));
  if (!requireSpend(f, `capture: ${todo.length ? todo.join(", ") : "nothing to do — every example is captured"}`)) return;
  if (todo.length === 0) return;
  const store = await openStore();
  const budget = openBudget(path.join(runDir(f.run), "budget.json"), f.cap);
  try {
    await store.owner(async () => {
      for (const id of todo) {
        const ex = exampleById(id);
        const { result, spent } = await paidStep(
          budget,
          { id: `capture:${id}:${Date.now()}`, label: `capture ${id}`, boundUsd: ex.entry === "citation" ? 1 : 0.1 },
          store.ledger,
          () => captureExample(ex, store.captureDeps),
        );
        const shared: SharedCall[] = spent.calls.map((c) => ({
          job: c.job,
          model: c.model,
          answeredBy: c.answeredBy,
          usd: recordUsd(c),
          inputTokens: c.inputTokens,
          outputTokens: c.outputTokens,
          cacheReadTokens: c.cacheReadTokens,
          ms: c.ms,
        }));
        const cap: Capture = { ...result, shared };
        const p = capturePath(f.run, id);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, `${JSON.stringify(cap, null, 2)}\n`);
        const c = cap.citation;
        console.log(
          `${id}: ${cap.findings.sources.length} sources, ${cap.findings.library.length} library passages` +
            (cap.explain ? `, anchored ${cap.explain.blockId}${cap.explain.chosenBlockId && cap.explain.chosenBlockId !== cap.explain.blockId ? ` (chosen ${cap.explain.chosenBlockId})` : ""}` : "") +
            (c ? `, lookup ${c.lookupOutcome ?? "skipped"}, match ${c.matched ? "yes" : "no"}, paper ${c.paperState}${c.paperPassages !== null ? ` (${c.paperPassages} passages)` : ""}` : "") +
            `, $${spent.usd.toFixed(4)}, search ${(cap.timings.searchMs / 1000).toFixed(1)}s`,
        );
      }
    });
  } finally {
    budget.close();
    await store.close();
  }
}

/* -------------------------------------------------------------- answers -- */

function answerInputs(slot: AnswerSlot, captures: Map<string, Capture>, article: CellInputs["article"], mode: CellInputs["mode"] = "isolated", ceiling = 4_000): CellInputs {
  const capture = captures.get(slot.example);
  if (!capture) throw new Error(`no capture for ${slot.example}`);
  return { capture, arm: armById(slot.arm), ceiling, mode, article };
}

const EMPTY_ARTICLE = { meta: {} as Meta, blocks: [] as Block[] };

/** An answer slot's current key — what `completeness` and the runner both use. */
function answerKeyOf(m: Manifest, slot: AnswerSlot, captures: Map<string, Capture>, mode: CellInputs["mode"], ceiling = 4_000): string | null {
  const sha = m.captures.sha256[slot.example];
  if (!sha || !captures.has(slot.example)) return null;
  return answerKey(answerInputs(slot, captures, EMPTY_ARTICLE, mode, ceiling), sha, ANSWER_SOURCE());
}

async function runAnswerSlots(
  f: Flags,
  m: Manifest,
  slots: readonly AnswerSlot[],
  mode: CellInputs["mode"],
  ceiling: number,
  store: Store,
  budget: Budget,
): Promise<void> {
  const captures = capturesOf(m);
  const exampleOrder = orderForCache(
    m.selection.examples.map(exampleById),
    (e) => JSON.stringify(captures.get(e.id)?.production.request.messages ?? []).length,
  ).map((e) => e.id);
  for (const exampleId of exampleOrder) {
    const mine = slots.filter((s) => s.example === exampleId);
    if (mine.length === 0) continue;
    const capture = captures.get(exampleId);
    if (!capture) throw new Error(`no capture for ${exampleId}`);
    const article = await articleFor(store, capture);
    const one = async (slot: AnswerSlot) => {
      const key = answerKeyOf(m, slot, captures, mode, ceiling);
      if (!key) throw new Error(`${slot.slot}: no key`);
      if (currentCell<AnswerCell>(f.run, slot.slot, key)) return;
      const cell = await answerCell(answerInputs(slot, captures, article, mode, ceiling), { slot: slot.slot, key, commit: m.commit, example: slot.example, run: slot.run }, budget, store.ledger);
      writeCell(f.run, cell);
      const cost = cell.calls.reduce((n, c) => n + (c.usd ?? 0), 0);
      console.log(
        `${slot.slot}: ${cell.delivery.delivered ? "delivered" : `NOT delivered (${cell.delivery.why})`}, ${cell.words} words, $${cost.toFixed(4)}` +
          `${cell.check ? `, check ${cell.check.verdict}` : ""}, cache ${cell.calls.map((c) => `${c.cacheReadTokens ?? "?"}/${c.inputTokens ?? "?"}`).join("+")}`,
      );
    };
    /* Opus run 1 alone first, so opus-b, the check and the other runs read its prefix;
       then each arm's runs in order, arms side by side. */
    const anchorFirst = mine.filter((s) => s.arm === ANCHOR_ARM && s.run === 1);
    await pool(anchorFirst, 1, one);
    const rest = mine.filter((s) => !anchorFirst.includes(s));
    const byArm = new Map<string, AnswerSlot[]>();
    for (const s of rest) byArm.set(s.arm, [...(byArm.get(s.arm) ?? []), s]);
    await pool([...byArm.values()], 4, async (chain) => {
      for (const s of [...chain].sort((a, b) => a.run - b.run)) await one(s);
    });
  }
}

async function answers(f: Flags): Promise<void> {
  if (!requireSpend(f, `answers on run "${f.run}": ${f.sel.examples.length} examples × ${f.sel.arms.length} arms × ${f.sel.runs} runs`)) return;
  const m = manifestFor(f);
  const store = await openStore();
  const budget = openBudget(path.join(runDir(f.run), "budget.json"), f.cap);
  try {
    await store.owner(() => runAnswerSlots(f, m, m.answers, "isolated", 4_000, store, budget));
  } finally {
    budget.close();
    await store.close();
    console.log(`budget: $${budget.state().spentUsd.toFixed(4)} spent on run "${f.run}"`);
  }
}

/** Length failures again at a larger ceiling, on those cells only (plan § Each answer goes through…). */
async function diagnose(f: Flags): Promise<void> {
  const m = readManifest(f.run);
  if (!m) throw new Error(`no run "${f.run}"`);
  const truncated = m.answers.filter((s) => readCell<AnswerCell>(f.run, s.slot)?.calls.some((c) => c.ending === "truncated"));
  const slots = truncated.map((s) => ({ ...s, slot: `diag${f.ceiling}:${s.example}:${s.arm}:${s.run}` }));
  if (!requireSpend(f, `diagnose: ${slots.length} truncated cell(s) again at ${f.ceiling} tokens`)) return;
  const store = await openStore();
  const budget = openBudget(path.join(runDir(f.run), "budget.json"), f.cap);
  try {
    await store.owner(() => runAnswerSlots(f, m, slots, "isolated", f.ceiling, store, budget));
  } finally {
    budget.close();
    await store.close();
  }
}

/* ---------------------------------------------------------------- judge -- */

type JudgePlan =
  | { kind: "judge"; key: string; order: string[]; labels: string[]; answers: BatchAnswer[]; armRequest: ReturnType<typeof cellRequests>[number]["request"]; lastPart: string }
  | { kind: "skip"; key: string; why: string }
  | { kind: "waiting"; why: string };

/** What a judging slot will send, from the answer cells as they are now. */
function judgePlan(run: string, slot: JudgeSlot, captures: Map<string, Capture>, answerSlots: readonly AnswerSlot[]): JudgePlan {
  const capture = captures.get(slot.example);
  if (!capture) return { kind: "waiting", why: "no capture" };
  const cells = new Map<string, AnswerCell>();
  for (const arm of slot.order) {
    const a = answerSlots.find((s) => s.example === slot.example && s.arm === arm && s.run === slot.run);
    const cell = a ? readCell<AnswerCell>(run, a.slot) : null;
    if (!cell) return { kind: "waiting", why: `answer ${arm} r${slot.run} not yet made` };
    cells.set(arm, cell);
  }
  const keep = slot.order.map((arm, i) => ({ arm, label: slot.labels[i] as string, cell: cells.get(arm) as AnswerCell })).filter((x) => x.cell.delivery.delivered);
  const answerKeys = slot.order.map((a) => cells.get(a)?.key);
  if (!keep.some((x) => x.arm === ANCHOR_ARM)) return { kind: "skip", key: JSON.stringify({ skip: "no anchor", answerKeys }), why: "the anchor's answer was not delivered" };
  if (keep.length < 2) return { kind: "skip", key: JSON.stringify({ skip: "alone", answerKeys }), why: "only the anchor was delivered" };
  const mode = slot.pass === "finalists" ? "production" : "isolated";
  const req = cellRequests({ capture, arm: armById(ANCHOR_ARM), ceiling: 4_000, mode, article: EMPTY_ARTICLE })[0]?.request;
  if (!req) return { kind: "waiting", why: "no request" };
  const order = keep.map((x) => x.arm);
  const labels = keep.map((x) => x.label);
  const lastPart = lastPartText(req);
  const answers = order.map((arm, i): BatchAnswer => {
    const cell = cells.get(arm) as AnswerCell;
    if (!cell.delivery.delivered) throw new Error(`${slot.slot}: ${arm} was kept for judging without a delivered answer`);
    return {
      label: labels[i] as string,
      text: cell.delivery.answer,
      ...(slot.pass === "finalists"
        ? {
            searches: totalReportedWebSearches(cell.calls),
            evidence: cell.evidence ?? [],
          }
        : {}),
    };
  });
  const request = judgeRequest({
    model: judgeById(slot.judge).model,
    example: exampleById(slot.example),
    armRequest: req,
    lastPart,
    answers,
  });
  return { kind: "judge", key: judgeKey(request, order, JUDGE_SOURCE()), order, labels, answers, armRequest: req, lastPart };
}

async function runJudgeSlots(f: Flags, m: Manifest, slots: readonly JudgeSlot[], answerSlots: readonly AnswerSlot[], budget: Budget, ledger: Ledger): Promise<void> {
  const captures = capturesOf(m);
  for (const exampleId of orderForCache(
    m.selection.examples.map(exampleById),
    (e) => JSON.stringify(captures.get(e.id)?.production.request.messages ?? []).length,
  ).map((e) => e.id)) {
    const byJudge = new Map<string, JudgeSlot[]>();
    for (const s of slots.filter((x) => x.example === exampleId)) byJudge.set(s.judge, [...(byJudge.get(s.judge) ?? []), s]);
    await pool([...byJudge.values()], 3, async (mine) => {
      const one = async (slot: JudgeSlot) => {
        const plan = judgePlan(f.run, slot, captures, answerSlots);
        if (plan.kind === "waiting") {
          console.log(`${slot.slot}: waiting — ${plan.why}`);
          return;
        }
        const existing = currentCell<JudgeCell>(f.run, slot.slot, plan.key);
        if (existing && judgementIsComplete(existing)) return;
        if (plan.kind === "skip") {
          const skipped: JudgeCell = { slot: slot.slot, key: plan.key, at: new Date().toISOString(), commit: m.commit, example: slot.example, run: slot.run, judge: slot.judge, pass: slot.pass, batch: slot.batch, order: slot.order, labels: slot.labels, requested: judgeById(slot.judge).model, returned: null, generationId: null, usd: 0, inputTokens: null, outputTokens: null, cacheReadTokens: null, ms: 0, scores: null, failure: `skipped: ${plan.why}` };
          writeCell(f.run, skipped);
          console.log(`${slot.slot}: skipped — ${plan.why}`);
          return;
        }
        const cell = await judgeBatch(
          { slot: slot.slot, key: plan.key, commit: m.commit, example: exampleById(slot.example), run: slot.run, judge: judgeById(slot.judge), pass: slot.pass, batch: slot.batch, order: plan.order, labels: plan.labels, answers: plan.answers, armRequest: plan.armRequest, lastPart: plan.lastPart },
          budget,
          ledger,
          modelMatches,
        );
        writeCell(f.run, cell);
        console.log(`${slot.slot}: ${cell.failure ? `FAILED (${cell.failure})` : "scored"} $${(cell.usd ?? 0).toFixed(4)}, cache ${cell.cacheReadTokens ?? "?"}/${cell.inputTokens ?? "?"}`);
      };
      /* The first call per (example, judge) writes the judge's prefix; the rest
         read it. Keep each judge's calls serial: byte-safe reservations for
         nine concurrent 255k-token packets would exhaust the cap before the
         calls started, despite their settled bill fitting. The three judges
         still run beside one another. */
      const [first, ...rest] = mine;
      if (first) await one(first);
      await pool(rest, 1, one);
    });
  }
}

async function judge(f: Flags): Promise<void> {
  if (!requireSpend(f, `judge on run "${f.run}"`)) return;
  const m = manifestFor(f);
  const store = await openStore();
  const budget = openBudget(path.join(runDir(f.run), "budget.json"), f.cap);
  try {
    await store.owner(() => runJudgeSlots(f, m, m.judgements, m.answers, budget, store.ledger));
  } finally {
    budget.close();
    await store.close();
    console.log(`budget: $${budget.state().spentUsd.toFixed(4)} spent on run "${f.run}"`);
  }
}

/* ------------------------------------------------------ finalists, probe -- */

async function finalists(f: Flags): Promise<void> {
  const m = readManifest(f.run);
  if (!m) throw new Error(`no run "${f.run}" — the finalists come from a judged run`);
  const arms = [ANCHOR_ARM, ...f.sel.arms.filter((a) => a !== ANCHOR_ARM)];
  if (arms.length !== 3) throw new Error("finalists takes --arms with the two best non-Opus arms");
  for (const a of arms) if (armById(a).kind !== "single") throw new Error(`${a} is not a single-model arm; the production path has no check step`);
  if (!requireSpend(f, `finalists on run "${f.run}": ${arms.join(", ")}, production-shaped, one run per example`)) return;
  if (m.finalists && JSON.stringify(m.finalists.arms) !== JSON.stringify(arms)) throw new Error(`run "${f.run}" already has finalists ${m.finalists.arms.join(", ")}`);
  if (!m.finalists) {
    m.finalists = {
      arms,
      answers: m.selection.examples.flatMap((example) => arms.map((arm) => ({ slot: `fin:${example}:${arm}:1`, example, arm, run: 1 }))),
      judgements: m.selection.examples.flatMap((example) => m.selection.judges.flatMap((j) => judgeSlots(example, 1, j, "finalists", arms, ANCHOR_ARM, SEED))),
    };
    delete m.completedAt;
    writeManifest(m);
  }
  const store = await openStore();
  const budget = openBudget(path.join(runDir(f.run), "budget.json"), f.cap);
  try {
    await store.owner(async () => {
      const fin = m.finalists as NonNullable<Manifest["finalists"]>;
      await runAnswerSlots(f, m, fin.answers, "production", 4_000, store, budget);
      await runJudgeSlots(f, m, fin.judgements, fin.answers, budget, store.ledger);
    });
  } finally {
    budget.close();
    await store.close();
  }
}

async function probe(f: Flags): Promise<void> {
  const arms = f.sel.arms.filter((a) => armById(a).kind === "single");
  if (!requireSpend(f, `probe: one forced-search call each for ${arms.join(", ")}`)) return;
  const store = await openStore();
  const budget = openBudget(path.join(runDir(f.run), "budget.json"), f.cap);
  const probePath = path.join(runDir(f.run), "probe.json");
  let out: ProbeResult[] = fs.existsSync(probePath) ? (JSON.parse(fs.readFileSync(probePath, "utf8")) as ProbeResult[]) : [];
  const save = () => {
    const tmp = `${probePath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(out, null, 2)}\n`);
    fs.renameSync(tmp, probePath);
  };
  try {
    await store.owner(async () => {
      const ex = exampleById("feynman-millikan");
      const article = await store.loadArticle(ex.slug);
      for (const id of arms) {
        const arm = armById(id);
        if (arm.kind !== "single") continue;
        const existing = probeResultFor(out, id, arm.model);
        if (existing) {
          console.log(`${id}: already probed (${existing.status})`);
          continue;
        }
        const r = await probeForcedSearch(
          arm.model,
          { subject: ex.entry === "comment" ? ex.quote : "", article: { title: article.meta.title, author: article.meta.byline, date: article.meta.publishedAt } },
          budget,
          store.ledger,
          `probe:${id}:${arm.model}`,
        );
        out = [...out.filter((result) => result.arm !== id), { arm: id, model: arm.model, ok: r.ok, searches: r.searches, status: r.status, usd: r.usd }];
        save();
        console.log(`${id}: ${r.ok ? `searched (${r.searches})` : `no — ${r.status}`}`);
      }
    });
  } finally {
    budget.close();
    await store.close();
  }
}

/* --------------------------------------------------------------- report -- */

export function report(f: Flags): void {
  const m = readManifest(f.run);
  if (!m) throw new Error(`no run "${f.run}"`);
  const captures = capturesOf(m);
  const answers = new Map<string, AnswerCell>();
  const judgements = new Map<string, JudgeCell>();
  const allAnswers = [...m.answers, ...(m.finalists?.answers ?? [])];
  for (const s of allAnswers) {
    const c = readCell<AnswerCell>(f.run, s.slot);
    if (c) answers.set(s.slot, c);
  }
  for (const s of [...m.judgements, ...(m.finalists?.judgements ?? [])]) {
    const c = readCell<JudgeCell>(f.run, s.slot);
    if (c) judgements.set(s.slot, c);
  }
  const ansMissing = completeness(f.run, m.answers, (slot) => {
    const s = m.answers.find((x) => x.slot === slot);
    return s ? answerKeyOf(m, s, captures, "isolated") : null;
  });
  const finMissing = m.finalists
    ? completeness(f.run, m.finalists.answers, (slot) => {
        const s = m.finalists?.answers.find((x) => x.slot === slot);
        return s ? answerKeyOf(m, s, captures, "production") : null;
      })
    : { missing: [], stale: [] };
  const judgeAll = [...m.judgements, ...(m.finalists?.judgements ?? [])];
  const jMissing = completeness(f.run, judgeAll, (slot) => {
    const s = judgeAll.find((x) => x.slot === slot);
    if (!s) return null;
    const plan = judgePlan(f.run, s, captures, s.pass === "finalists" ? (m.finalists?.answers ?? []) : m.answers);
    return plan.kind === "waiting" ? null : plan.key;
  });
  const missing = [...ansMissing.missing, ...ansMissing.stale, ...finMissing.missing, ...finMissing.stale, ...jMissing.missing, ...jMissing.stale];
  for (const s of judgeAll) {
    const cell = judgements.get(s.slot);
    if (cell && !judgementIsComplete(cell)) missing.push(`${s.slot} (failed: ${cell.failure ?? "no scores"})`);
  }
  const probePath = path.join(runDir(f.run), "probe.json");
  const probeResults = fs.existsSync(probePath) ? (JSON.parse(fs.readFileSync(probePath, "utf8")) as ProbeResult[]) : undefined;
  for (const arm of m.finalists?.arms.filter((id) => id !== ANCHOR_ARM) ?? []) {
    const configured = armById(arm);
    if (configured.kind !== "single") throw new Error(`${arm}: a production finalist must be a single-model arm`);
    if (!probeResultFor(probeResults, arm, configured.model)) missing.push(`probe:${arm}`);
  }
  const { markdown, complete } = renderReport({ manifest: m, answers, judgements, captures, missing, ...(probeResults ? { probe: probeResults } : {}) });
  const budgetFile = path.join(runDir(f.run), "budget.json");
  const spent = fs.existsSync(budgetFile) ? (JSON.parse(fs.readFileSync(budgetFile, "utf8")) as { spentUsd: number; halted: string | null }) : null;
  const tail = spent ? `\nSpent on this run (budget.json): $${spent.spentUsd.toFixed(4)}${spent.halted ? ` — HALTED: ${spent.halted}` : ""}.\n` : "";
  fs.writeFileSync(path.join(runDir(f.run), "report.md"), markdown + tail);
  if (complete && !m.completedAt) {
    m.completedAt = new Date().toISOString();
    writeManifest(m);
  }
  if (!complete && m.completedAt) {
    delete m.completedAt;
    writeManifest(m);
  }
  console.log(markdown + tail);
  console.log(`written: ${path.relative(process.cwd(), path.join(runDir(f.run), "report.md"))}${complete ? "" : " (PARTIAL)"}`);
}

/* ------------------------------------------------------------ preflight -- */

async function preflight(f: Flags): Promise<void> {
  const captures = new Map<string, Capture>();
  const standIns = new Map<string, Capture>();
  for (const id of f.sel.examples) {
    const c = readCapture(f.captures, id);
    if (c) captures.set(id, c.capture);
  }
  const absent = f.sel.examples.filter((id) => !captures.has(id));
  /* Once captures exist, preflight is a filesystem-only calculation. Open the
     database only to construct stand-ins for examples not captured yet. */
  if (absent.length > 0) {
    const store = await openStore();
    try {
      await store.owner(async () => {
        for (const id of absent) standIns.set(id, await standIn(exampleById(id), store));
      });
    } finally {
      await store.close();
    }
  }
  const bill = estimateBill({
    sel: f.sel,
    examples: EXAMPLES,
    captures,
    standIn: (e) => standIns.get(e.id) as Capture,
    finalists: f.finalists,
    includeCapture: true,
  });
  console.log(
    `preflight (free) for run "${f.run}": ${f.sel.examples.length} examples × ${f.sel.arms.length} arms × ${f.sel.runs} answer runs; ${f.sel.judgeRuns} judged; judges ${f.sel.judges.join(", ")}; re-judge ${f.sel.rejudge ? "on" : "off"}; finalists ${f.finalists.join(", ")} (estimate)`,
  );
  console.log(`captures: ${captures.size} frozen${standIns.size ? `, ${standIns.size} estimated from the article with stand-in findings (${[...standIns.keys()].join(", ")})` : ""}`);
  console.log(renderBill(bill, f.cap));
  const p = path.join(runDir(f.run), "budget.json");
  if (fs.existsSync(p)) console.log(`already spent on run "${f.run}": $${(JSON.parse(fs.readFileSync(p, "utf8")) as { spentUsd: number }).spentUsd.toFixed(4)}`);
}

/** A capture-shaped stand-in for an example not yet captured: the real article, filler findings. Free. */
async function standIn(example: Example, store: Store): Promise<Capture> {
  const { productionExplainRequest } = await import("./capture.js");
  const { investigateRequest } = await import("../../src/citation-investigate.js");
  const { DIG_DEEPER_MODEL } = await import("../../src/dig-deeper.js");
  const article = await store.loadArticle(example.slug);
  const filler = "x".repeat(1_400);
  const findings = {
    sources: Array.from({ length: 5 }, (_, i) => ({ url: `https://example.org/${i}`, title: "a page", excerpt: filler })),
    searches: 1,
    libraryQuery: '"stand in"',
    library: Array.from({ length: 2 }, () => ({ slug: "s", title: "t", blockId: "spya-aaaaaa", text: filler.slice(0, 700) })),
  };
  const first = article.blocks[0]?.id ?? "spya-aaaaaa";
  const request =
    example.entry === "citation"
      ? investigateRequest({
          meta: article.meta,
          blocks: article.blocks,
          context: { title: "a work", authors: null, year: null, reference: null, url: "https://example.org", linkFrom: "search", why: "stand-in", passages: ["x".repeat(1_200)] },
          profile: null,
          matched: null,
          /* The paper's 5,000 words, as a stand-in for its evidence section. */
          paper: null,
          findings: { ...findings, sources: [...findings.sources, { url: "https://example.org/paper", title: "paper", excerpt: "x ".repeat(15_000) }] },
          model: DIG_DEEPER_MODEL,
        })
      : productionExplainRequest(article.meta, article.blocks, first, example.entry === "comment" ? example.quote : example.term, findings);
  return {
    version: 1,
    exampleId: example.id,
    entry: example.entry,
    slug: example.slug,
    capturedAt: "stand-in",
    commit: "stand-in",
    articleSha256: articleSha(article.meta, article.blocks),
    production: { job: example.entry === "citation" ? "citation-investigate" : "dig-deeper", request },
    findings,
    timings: { searchMs: 0, lookupMs: null, paperMs: null, passagesMs: null },
    shared: [],
  };
}

/* ------------------------------------------------------------------ main -- */

export async function main(argv: readonly string[]): Promise<void> {
  const f = parseFlags(argv);
  switch (f.cmd) {
    case "preflight":
      return preflight(f);
    case "capture":
      return capture(f);
    case "answers":
      return answers(f);
    case "judge":
      return judge(f);
    case "diagnose":
      return diagnose(f);
    case "finalists":
      return finalists(f);
    case "probe":
      return probe(f);
    case "report":
      return report(f);
    default:
      throw new Error(`unknown subcommand "${f.cmd}" — preflight, capture, answers, judge, diagnose, finalists, probe, report`);
  }
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    if (err instanceof BudgetRefused || err instanceof BudgetHalted) console.error(`\nSTOPPED by the budget: ${err.message}`);
    else console.error(err);
    process.exit(1);
  });
}
