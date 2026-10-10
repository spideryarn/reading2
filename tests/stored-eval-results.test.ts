/**
 * **A saved eval run written under the mode's old id is still read.** Learn's
 * eval scripts wrote `evals/results/remember-*` until 2026-10-06; the saved
 * runs keep those names and the commands that read one back go through
 * `storedResult` (evals/stored-result.ts).
 * docs/plans/261006a-remember-identifiers-become-learn-all-the-way-down.md, PR-7.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { PROMPT_FILES, readArm } from "../evals/plain-words/artefacts.js";
import { formerName, storedResult } from "../evals/stored-result.js";

const RESULTS = path.resolve(import.meta.dirname, "..", "evals", "results");
const dir = mkdtempSync(path.join(tmpdir(), "stored-eval-results-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const touch = (name: string): string => {
  const file = path.join(dir, name);
  writeFileSync(file, "{}");
  return file;
};

describe("formerName", () => {
  it("is the same name with the old stem, for the whole word only", () => {
    expect(formerName("learn-explore.run-1.json")).toBe("remember-explore.run-1.json");
    expect(formerName("learn.json")).toBe("remember.json");
    expect(formerName("learn")).toBe("remember");
    expect(formerName("learning.json")).toBe(null);
    expect(formerName("quiz.json")).toBe(null);
    expect(formerName("re-learn.json")).toBe(null);
    expect(formerName("bibliography.json")).toBe("citations.json");
  });
});

describe("storedResult", () => {
  it("reads a run saved under the old name when the new one is absent", () => {
    const old = touch("remember-explore.old-run.json");
    expect(storedResult(path.join(dir, "learn-explore.old-run.json"))).toBe(old);
  });

  it("reads a Bibliography arm saved under its former Citations name", () => {
    const old = touch("citations.json");
    expect(storedResult(path.join(dir, "bibliography.json"))).toBe(old);
  });

  it("prefers the new name when both exist", () => {
    touch("remember-explore.both.json");
    const now = touch("learn-explore.both.json");
    expect(storedResult(now)).toBe(now);
  });

  it("names today's file when neither exists, so the error says what to look for", () => {
    const wanted = path.join(dir, "learn-explore.never-run.json");
    expect(storedResult(wanted)).toBe(wanted);
  });

  it("leaves a name the rename never touched alone", () => {
    touch("remember-quiz.json");
    const wanted = path.join(dir, "quiz.json");
    expect(storedResult(wanted)).toBe(wanted);
  });

  it("finds the runs that are really in evals/results", () => {
    /* The specimen: a run saved on 2026-10-03, which the judge and the critic
       pairs are asked for as `--runs=261003l-chat-agents-1`. */
    const old = path.join(RESULTS, "remember-explore.261003l-chat-agents-1.json");
    expect(existsSync(old), "the saved run this test reads has gone").toBe(true);
    expect(storedResult(path.join(RESULTS, "learn-explore.261003l-chat-agents-1.json"))).toBe(old);
  });
});

describe("the plain-words arms saved before the rename", () => {
  it("runs the active generator from Bibliography's current source file", () => {
    expect(PROMPT_FILES).toHaveProperty("bibliography", ["bibliography.ts"]);
    expect(PROMPT_FILES).not.toHaveProperty("citations");
  });

  it("reads the Learn generator from the file that calls itself `remember`", () => {
    const old = path.join(RESULTS, "plain-words", "artefacts", "after", "remember.json");
    expect(existsSync(old), "the saved arm this test reads has gone").toBe(true);
    const { files, missing } = readArm("after");
    expect(missing).not.toContain("learn");
    expect(files.get("learn")?.items.length).toBeGreaterThan(0);
  });

  it("reads the Bibliography generator from the file that calls itself `citations`", () => {
    const old = path.join(RESULTS, "plain-words", "artefacts", "after", "citations.json");
    expect(existsSync(old), "the saved arm this test reads has gone").toBe(true);
    const { files, missing } = readArm("after");
    expect(missing).not.toContain("bibliography");
    expect(files.get("bibliography")?.items.length).toBeGreaterThan(0);
  });
});
