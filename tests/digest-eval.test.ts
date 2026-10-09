import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { openBudget, BudgetHalted, BudgetRefused } from "../evals/dig-deeper/budget.js";
import { drain, withReservation } from "../evals/digest/budget.js";
import { assertJudgedInputsMatch, assertResumeIdentity } from "../evals/digest/resume.js";

afterEach(() => vi.useRealTimers());

it("refuses to relabel scored packets or replace their answers", () => {
  const key = { V: "A-opus", W: "B-sonnet" };
  expect(() => assertJudgedInputsMatch("article", key, key, "old answer", "old answer")).not.toThrow();
  expect(() => assertJudgedInputsMatch("article", key, { V: "B-sonnet", W: "A-opus" }, "old answer", "old answer")).toThrow("judging inputs changed");
  expect(() => assertJudgedInputsMatch("article", key, key, "old answer", "new answer")).toThrow("judging inputs changed");
});

it("rejects changed judging questions before opening any database", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "digest-questions-"));
  try {
    fs.writeFileSync(path.join(dir, "preflight-run.json"), JSON.stringify({ questionsHash: "different" }));
    const r = spawnSync(process.execPath, ["--import", "tsx", "evals/digest/lineups.ts", "--results", dir], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("questions differ from this run");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("waits for dispatched calls before propagating a worker failure", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  let settled = false;
  const result = drain([Promise.reject(new Error("halt")), pending]);
  const verdict = expect(result).rejects.toThrow("halt").then(() => { settled = true; });
  await Promise.resolve();
  expect(settled).toBe(false);
  finish();
  await verdict;
});

it("refuses to reuse an output when the article, digest, question, model or effort changed", () => {
  const request = { model: "sonnet", article: "hash-a", digest: "hash-d", question: "old" };
  const stored = { request, effortSent: null, effortRan: "high" };
  expect(() => assertResumeIdentity("cell", stored, request, { sent: null, ran: "high" })).not.toThrow();
  for (const field of Object.keys(request)) {
    expect(() => assertResumeIdentity("cell", stored, { ...request, [field]: "changed" }, { sent: null, ran: "high" })).toThrow("fresh --out");
  }
  expect(() => assertResumeIdentity("cell", stored, request, { sent: "medium", ran: "medium" })).toThrow("fresh --out");
});

it("refuses an abandoned reservation instead of waiting forever", async () => {
  vi.useFakeTimers();
  const budget = openBudget(null, 1);
  budget.reserve("dead-process", "old call", 0.9);
  const call = vi.fn(async () => "unused");
  const result = withReservation(budget, { id: "new", label: "new", boundUsd: 0.2 }, {}, call);
  const verdict = expect(result).rejects.toBeInstanceOf(BudgetRefused);
  await vi.advanceTimersByTimeAsync(2100);
  await verdict;
  expect(call).not.toHaveBeenCalled();
});

it("waits for a live reservation to settle, then admits the next call", async () => {
  vi.useFakeTimers();
  const budget = openBudget(null, 1);
  let finish!: () => void;
  const first = withReservation(budget, { id: "first", label: "first", boundUsd: 0.9 }, {},
    () => new Promise<void>((resolve) => { finish = resolve; }));
  const call = vi.fn(async () => "second");
  const second = withReservation(budget, { id: "second", label: "second", boundUsd: 0.2 }, {}, call);
  expect(call).not.toHaveBeenCalled();
  finish();
  await first;
  await vi.advanceTimersByTimeAsync(2100);
  expect((await second).result).toBe("second");
  expect(call).toHaveBeenCalledTimes(1);
});

it("propagates a halted budget before waiting for room", async () => {
  vi.useFakeTimers();
  const budget = openBudget(null, 1);
  budget.reserve("bad-cost", "old call", 0.9);
  expect(() => budget.settle("bad-cost", null)).toThrow(BudgetHalted);
  const call = vi.fn(async () => "unused");
  const result = withReservation(budget, { id: "new", label: "new", boundUsd: 0.2 }, {}, call);
  const verdict = expect(result).rejects.toBeInstanceOf(BudgetHalted);
  await vi.advanceTimersByTimeAsync(2100);
  await verdict;
  expect(call).not.toHaveBeenCalled();
});

it("rejects incomplete judging rather than reporting a plausible average", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "digest-judging-"));
  try {
    fs.writeFileSync(path.join(dir, "key.json"), JSON.stringify({ article: { ideas: { V: "A-opus" } } }));
    fs.writeFileSync(path.join(dir, "opus-article.json"), "{}");
    const r = spawnSync(process.execPath, ["--import", "tsx", "evals/digest/tally.ts", "--dir", dir], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("Both judges pooled");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it.each(["missing-judge", "missing-score", "invalid-score", "wrong-slug", "duplicate-arm"])(
  "rejects %s in a complete saved judging set",
  (fault) => {
    const source = path.resolve("evals/results/digest-2026-10-09/judging");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "digest-judging-"));
    try {
      for (const file of fs.readdirSync(source).filter((f) => f === "key.json" || /^(opus|sol)-.*\.json$/.test(f))) {
        fs.copyFileSync(path.join(source, file), path.join(dir, file));
      }
      const file = "sol-scaling-hypothesis.json";
      const j = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      if (fault === "missing-judge") fs.rmSync(path.join(dir, file));
      else if (fault === "duplicate-arm") {
        const k = JSON.parse(fs.readFileSync(path.join(dir, "key.json"), "utf8"));
        k["scaling-hypothesis"].ideas.V = k["scaling-hypothesis"].ideas.W;
        fs.writeFileSync(path.join(dir, "key.json"), JSON.stringify(k));
      } else {
        if (fault === "missing-score") delete j.lineups.ideas.scores.V;
        if (fault === "invalid-score") j.lineups.ideas.scores.V.overall = "9";
        if (fault === "wrong-slug") j.slug = "another-article";
        fs.writeFileSync(path.join(dir, file), JSON.stringify(j));
      }
      const r = spawnSync(process.execPath, ["--import", "tsx", "evals/digest/tally.ts", "--dir", dir], { encoding: "utf8" });
      expect(r.status).toBe(1);
      expect(r.stdout).not.toContain("Both judges pooled");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

it("reports a partial run without a database and refuses to extrapolate its break-even", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "digest-report-"));
  const slug = "scaling-hypothesis";
  try {
    fs.mkdirSync(path.join(dir, slug, "chat-q1"), { recursive: true });
    fs.copyFileSync(
      path.resolve(`evals/results/digest-2026-10-09/${slug}/chat-q1/A-opus.json`),
      path.join(dir, slug, "chat-q1", "A-opus.json"),
    );
    const r = spawnSync(process.execPath, ["--import", "tsx", "evals/digest/run.ts", "--report", "--out", dir], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const report = fs.readFileSync(path.join(dir, "costs.md"), "utf8");
    expect(report).toContain("unavailable (incomplete matrix)");
    const source = JSON.parse(fs.readFileSync(path.join(dir, slug, "chat-q1", "A-opus.json"), "utf8"));
    expect(report).toContain(`Average task: Opus $${source.usd.toFixed(4)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("binds failure exclusions to this draw's output, rather than reusing them on a rerun", () => {
  const source = path.resolve("evals/results/digest-2026-10-09");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "digest-exclusions-"));
  const dir = path.join(root, "judging");
  fs.mkdirSync(dir);
  try {
    for (const file of fs.readdirSync(path.join(source, "judging")).filter((f) => f.endsWith(".json"))) {
      fs.copyFileSync(path.join(source, "judging", file), path.join(dir, file));
    }
    const { cells } = JSON.parse(fs.readFileSync(path.join(dir, "exclusions.json"), "utf8"));
    for (const c of cells) {
      const to = path.join(root, c.slug, c.task);
      fs.mkdirSync(to, { recursive: true });
      fs.copyFileSync(path.join(source, c.slug, c.task, `${c.arm}.json`), path.join(to, `${c.arm}.json`));
    }
    const run = () => spawnSync(process.execPath, ["--import", "tsx", "evals/digest/tally.ts", "--dir", dir], { encoding: "utf8" });
    expect(run().status).toBe(0);
    const c = cells[0];
    const file = path.join(root, c.slug, c.task, `${c.arm}.json`);
    fs.writeFileSync(file, JSON.stringify({ raw: "A newly generated answer" }));
    const changed = run();
    expect(changed.status).toBe(1);
    expect(changed.stderr).toContain("exclusion is for a different output");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
