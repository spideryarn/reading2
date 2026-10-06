import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const judgment = (pair: number) => ({ pair, a: "A", giveaway: "neither", invent: "neither" });

// Exercise the actual JSON boundary and scoring CLI, without model or database IO.
function score(judgments: unknown, duplicateRun = false) {
  const dir = mkdtempSync(path.join(tmpdir(), "skim-cue-pairs-test-"));
  dirs.push(dir);
  const out = path.join(dir, "score");
  const args: string[] = [];
  for (const name of ["a1", "a2", "b", "c"]) {
    const old = name.startsWith("a");
    const file = path.join(dir, `${name}.json`);
    const run = {
      slug: "article", arm: old ? "old" : "new", run: 1,
      version: old ? "skim/9" : "skim/10", context: name === "c",
      offered: 2, costNanos: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: null, dropped: {},
      stops: [1, 2].map((n) => ({
        quoteId: `quote-${n}`, depth: 1, again: [], quoteFull: "This approach works.",
        paragraph: "This approach works.", before: null, cue: "Look for the approach.", section: "Test",
      })),
    };
    writeFileSync(file, JSON.stringify({ results: duplicateRun && name === "a1" ? [run, run] : [run] }));
    args.push(`--${name}=${file}`);
  }
  writeFileSync(`${out}-judgment-s1.json`, JSON.stringify({ judgments }));
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/eval/skim-cue-pairs.ts", ...args, `--out=${out}`], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, NODE_ENV: "test" },
  });
  return { ...result, out };
}

describe("skim cue judging input", () => {
  it("scores a complete set even when the judgments arrive out of order", () => {
    const result = score([judgment(2), judgment(1)]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(`${result.out}-key-s1.json`, "utf8")).key).toHaveLength(2);
  });

  it("refuses repeated runs of an article instead of silently pairing only the first", () => {
    const result = score([judgment(1), judgment(2)], true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/A1:.*multiple runs for article/);
  });

  it.each([
    ["missing pair", [judgment(1)], /missing judgment for pair 2/],
    ["duplicate replacing a missing pair", [judgment(1), judgment(1)], /duplicate judgment for pair 1/],
    ["extra duplicate", [judgment(1), judgment(2), judgment(2)], /duplicate judgment for pair 2/],
    ["unknown pair", [judgment(1), judgment(3)], /no key for pair 3/],
    ["invalid preparation choice", [{ ...judgment(1), a: "both" }, judgment(2)], /pair 1: invalid a/],
    ["invalid giveaway choice", [{ ...judgment(1), giveaway: "none" }, judgment(2)], /pair 1: invalid giveaway/],
    ["missing invention choice", [{ pair: 1, a: "A", giveaway: "neither" }, judgment(2)], /pair 1: invalid invent/],
  ])("refuses %s before printing a score", (_name, judgments, error) => {
    const result = score(judgments);
    expect(result.status, result.stdout).not.toBe(0);
    expect(result.stderr).toMatch(error);
    expect(result.stdout).not.toContain("[all,");
  });
});
