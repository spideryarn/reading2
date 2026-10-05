/**
 * The dry run: every arm on every document against the fake model, then the
 * same arms with failures injected, then the judge's spoiled-tree check with a
 * fake judge that can see the faults and one that cannot. Free.
 * Plan 261005j § Stage 2.
 *
 *   npx tsx evals/long-structure/dry.ts
 *
 * It proves the plumbing, not the prompts: the fake answers at fixed strides.
 * Each line of the last table is an expectation that was checked; the script
 * exits 1 if any did not hold. Results go under
 * evals/results/long-structure-2026-10-05/dry/ and are overwritten each time.
 */
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../../src/env.js";
import { type Arm, ARMS } from "./arms.js";
import { DEFAULT_DOCS } from "./corpus.js";
import { type FakeJudge, type Injection, installFakeModel } from "./fake-model.js";
import { failuresOf, ledgerOf, type Options, readCells, reasksOf, report, RESULTS, runCells, runJudging, runSpoiled } from "./run.js";
import { MODELS } from "../dig-deeper/arms.js";

const DRY = path.join(RESULTS, "dry");
/** A made-up window, large enough for every document but the joined one. */
const FAKE_CONTEXT_TOKENS = 1_000_000;

loadEnvLocal();
rmSync(DRY, { recursive: true, force: true });

const lines: string[] = [];
let wrong = 0;
const expect = (what: string, ok: boolean, got: unknown): void => {
  if (!ok) wrong += 1;
  lines.push(`${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : `  (got ${JSON.stringify(got)})`}`);
};

const options = (name: string, over: Partial<Options>): Options => ({
  dir: path.join(DRY, name),
  docs: DEFAULT_DOCS,
  arms: [...ARMS],
  runs: 1,
  capUsd: 1000,
  fake: true,
  contextTokens: FAKE_CONTEXT_TOKENS,
  judges: ["opus", "sol"],
  say: (text) => console.log(`  ${text}`),
  ...over,
});

/* ---- 1. clean: every arm, every document ---- */
console.log("clean run, every arm on every document:");
{
  const fake = installFakeModel();
  const o = options("clean", {});
  const first = await runCells(o);
  const cells = readCells(o.dir);
  expect("clean: a cell was written for every document and arm", cells.length === DEFAULT_DOCS.length * ARMS.length, cells.length);
  const bad = cells.filter((c) => !["ok", "not-run", "does-not-fit", "input-does-not-fit"].includes(c.result.status));
  expect("clean: no cell failed", bad.length === 0, bad.map((c) => `${c.cell}:${c.result.failure}`));
  expect("clean: every finished tree passes checkTree", cells.every((c) => c.result.status !== "ok" || c.score?.checkTreeProblems === 0), null);
  expect("clean: every finished tree has a gist on every internal node", cells.every((c) => c.result.status !== "ok" || c.score?.internalWithoutGist === 0), null);
  const past = cells.filter((c) => c.arm === "one" && c.result.status === "does-not-fit").map((c) => c.doc.name);
  expect("clean: `one` does not fit exactly the documents past the line", JSON.stringify(past.sort()) === JSON.stringify(["book", "book-headingless", "moby+g1228"]), past);
  expect("clean: A ran on exactly those", cells.filter((c) => c.arm === "A" && c.result.status === "ok").length === past.length, null);
  const headingless = cells.find((c) => c.doc.name === "book-headingless" && c.score);
  expect("clean: seams on headings is n/a for the headingless book", headingless?.score?.seamsOnHeadings === "n/a" && headingless.score.headingsStartingANode === "n/a", headingless?.score?.seamsOnHeadings);
  const c = cells.find((x) => x.arm === "C" && x.doc.name === "paper")!;
  expect("clean: C records top < titles < tree", c.result.topMs! < c.result.titlesMs! && c.result.titlesMs! <= c.result.treeMs!, [c.result.topMs, c.result.titlesMs, c.result.treeMs]);
  expect("clean: a part of 12 blocks or fewer got no second call", (c.result.detail.partsWithNoSecondCall as number) >= 1, c.result.detail);
  const before = Object.values(fake.stats.requests).reduce((a, b) => a + b, 0);
  const second = await runCells(o);
  const after = Object.values(fake.stats.requests).reduce((a, b) => a + b, 0);
  expect("resume: a second run buys nothing", second.ran === 0 && second.skipped === first.ran && after === before, [second, after - before]);
  const ledger = ledgerOf(o);
  const fromCells = cells.reduce((a, x) => a + x.result.calls.reduce((b, y) => b + y.usd, 0), 0);
  expect("ledger: its total is the sum of the cells' calls", Math.abs(ledger.total() - fromCells) < 1e-9, [ledger.total(), fromCells]);
  expect("ledger: one line per request the fake saw", ledger.lines === before, [ledger.lines, before]);
  fake.restore();
}

/* ---- 2. injected failures ---- */
interface Scenario {
  name: string;
  doc: string;
  arm: Arm;
  injections: Injection[];
  status: string;
  failures: Record<string, number>;
  reasks: number;
  /** A fragment the cell's failure must contain. */
  failure?: string;
}

const scenarios: Scenario[] = [
  { name: "C, a part-sections answer that is not JSON once", doc: "paper", arm: "C", injections: [{ kind: "sections", nth: 0, fault: "garbage", times: 1 }], status: "ok", failures: { parse: 1 }, reasks: 1 },
  { name: "C, a part-sections answer with starts it was not given, once", doc: "paper", arm: "C", injections: [{ kind: "sections", nth: 1, fault: "bad-starts", times: 1 }], status: "ok", failures: { tiling: 1 }, reasks: 1 },
  { name: "C, a gists answer that fails twice", doc: "paper", arm: "C", injections: [{ kind: "gists", nth: 1, fault: "garbage", times: 2 }], status: "failed", failures: { parse: 2 }, reasks: 1, failure: "round3:" },
  { name: "B, a refused part call", doc: "paper", arm: "B", injections: [{ kind: "expand", nth: 2, fault: "refuse", times: 1 }], status: "failed", failures: { refused: 1 }, reasks: 0, failure: "refused" },
  { name: "B, a truncated part call", doc: "paper", arm: "B", injections: [{ kind: "expand", nth: 1, fault: "truncate", times: 1 }], status: "failed", failures: { truncated: 1 }, reasks: 0, failure: "truncated" },
  { name: "B, the top call's connection drops once", doc: "paper", arm: "B", injections: [{ kind: "top", nth: 0, fault: "transport", times: 1 }], status: "ok", failures: {}, reasks: 0 },
  { name: "B, the top call's connection drops three times", doc: "paper", arm: "B", injections: [{ kind: "top", nth: 0, fault: "transport", times: 3 }], status: "failed", failures: { transport: 1 }, reasks: 0, failure: "top:transport" },
  { name: "one, an answer that fails twice", doc: "paper", arm: "one", injections: [{ kind: "whole", nth: 0, fault: "garbage", times: 2 }], status: "failed", failures: { parse: 2 }, reasks: 1, failure: "parse" },
  { name: "A, a slice answer that is not JSON once", doc: "book", arm: "A", injections: [{ kind: "slice", nth: 1, fault: "garbage", times: 1 }], status: "ok", failures: { "answer-did-not-pass": 1 }, reasks: 1 },
  { name: "A, a refused slice", doc: "book", arm: "A", injections: [{ kind: "slice", nth: 0, fault: "refuse", times: 1 }], status: "failed", failures: { "slices:slice-failed": 1 }, reasks: 0, failure: "slices:slice-failed" },
];

console.log("injected failures:");
for (const [i, s] of scenarios.entries()) {
  const fake = installFakeModel({ injections: s.injections });
  const o = options(`injected-${i + 1}`, { docs: [s.doc], arms: [s.arm] });
  await runCells(o);
  const cell = readCells(o.dir)[0]!;
  const got = { status: cell.result.status, failures: failuresOf(cell.result), reasks: reasksOf(cell.result), failure: cell.result.failure ?? null, injected: fake.stats.injected.length };
  const wantInjected = s.injections.reduce((a, x) => a + x.times, 0);
  const ok =
    got.status === s.status &&
    JSON.stringify(Object.entries(got.failures).sort()) === JSON.stringify(Object.entries(s.failures).sort()) &&
    got.reasks === s.reasks &&
    (s.failure === undefined || (got.failure ?? "").includes(s.failure)) &&
    got.injected === wantInjected;
  expect(`injected: ${s.name} -> ${s.status}, failed calls ${JSON.stringify(s.failures)}, re-asks ${s.reasks}`, ok, got);
  if (s.name.includes("drops once")) {
    const top = cell.result.calls.find((c) => c.purpose === "top")!;
    expect("injected: the dropped connection shows as 2 network attempts on one call, and 2 ledger lines", top.networkAttempts === 2 && ledgerOf(o).lines === cell.result.calls.length + 1, [top.networkAttempts, ledgerOf(o).lines, cell.result.calls.length]);
  }
  fake.restore();
}

/* ---- 3. the cap ---- */
console.log("the cap:");
{
  const fake = installFakeModel();
  const o = options("capped", { docs: ["paper"], arms: ["B"], capUsd: 0.3 });
  const out = await runCells(o);
  expect("cap: a run that would pass its cap stops and writes no cell", out.capped && !existsSync(path.join(o.dir, "cells", "paper.B.run1.json")), out);
  expect("cap: the ledger stayed under it", ledgerOf(o).total() <= 0.3, ledgerOf(o).total());
  const raised = await runCells({ ...o, capUsd: 1000 });
  expect("cap: raised, the same run finishes the cell", !raised.capped && raised.ran === 1, raised);
  fake.restore();
}

/* ---- 4. the judge ---- */
console.log("the judge:");
{
  /* A fake judge that reads the materials: fewer parts is the welded tree, a
     gist that names a different chapter than its title is from elsewhere, and
     "(no gist)" on the passages is the stripped tree. */
  const seeing = (prompt: string): unknown => {
    const side = (label: "X" | "Y"): { parts: number; mismatched: number; missing: number } => {
      const top = prompt.slice(prompt.indexOf(`## Tree ${label}:`), label === "X" ? prompt.indexOf("## Tree Y:") : prompt.indexOf("# (c)"));
      const parts = Number(/## Tree [XY]: (\d+) parts/.exec(top)?.[1] ?? 0);
      const mismatched = [...top.matchAll(/\*\*Fake chapter (\d+)\*\*\n\s+gist: Fake chapter (\d+) /g)].filter((m) => m[1] !== m[2]).length;
      const missing = [...prompt.matchAll(new RegExp(`Tree ${label} puts it in: .*\\n  that section's gist: \\(no gist\\)`, "g"))].length;
      return { parts, mismatched, missing };
    };
    const [x, y] = [side("X"), side("Y")];
    const pick = (a: number, b: number): "X" | "Y" | "same" => (a === b ? "same" : a < b ? "X" : "Y");
    const top = pick(-x.parts, -y.parts);
    const gists = pick(x.mismatched + x.missing, y.mismatched + y.missing);
    const passages = (prompt.match(/^## Passage \d+/gm) ?? []).length;
    return {
      top_level: { better: top, why: "fake" },
      gists: { better: gists, why: "fake", per_passage: Array.from({ length: passages }, () => gists) },
      welded_parts: [],
      invented_claims: [],
      overall: { better: top !== "same" ? top : gists, why: "fake" },
    };
  };
  /* Opus sees; Sol always says X, whatever it is shown. */
  const judge: FakeJudge = (model, prompt) => {
    if (model === MODELS.opus) return seeing(prompt);
    const passages = (prompt.match(/^## Passage \d+/gm) ?? []).length;
    return { top_level: { better: "X", why: "" }, gists: { better: "X", why: "", per_passage: Array.from({ length: passages }, () => "X") }, welded_parts: [], invented_claims: [], overall: { better: "X", why: "" } };
  };
  const fake = installFakeModel({ judge });
  const o = options("clean", { docs: ["paper"], arms: ["one", "B", "C"] });
  const checks = await runSpoiled(o, "paper", "one");
  const seeingJudge = checks.find((c) => c.judge === "opus")!;
  const blindJudge = checks.find((c) => c.judge === "sol")!;
  expect("judge: one that can see the three faults passes the spoiled-tree check", seeingJudge.usable, seeingJudge.rows);
  expect("judge: one that always says X fails it, and is reported not usable", !blindJudge.usable, blindJudge.rows);
  expect("judge: the good tree sat in both seats", new Set(seeingJudge.rows.map((r) => r.goodWas)).size === 2, seeingJudge.rows.map((r) => r.goodWas));
  const usable = checks.filter((c) => c.usable).map((c) => c.judge);
  const judging = await runJudging(o, usable);
  expect("judge: B and C against today's output, and C against B, by the usable judge only", judging.judged === 3, judging);
  const again = await runJudging(o, usable);
  expect("judge: a second pass buys nothing", again.judged === 0, again);
  fake.restore();
  report({ dir: o.dir, say: (text) => console.log(`  ${text}`), capUsd: 1000, fake: true });
}

console.log("\nwhat was checked:");
for (const l of lines) console.log(l);
console.log(wrong === 0 ? "\nall held" : `\n${wrong} did not hold`);
process.exit(wrong === 0 ? 0 : 1);
