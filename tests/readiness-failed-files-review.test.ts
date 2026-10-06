import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { makeFailedTestFilesCapture, parseFailedTestFiles } from "../tools/fleet/readiness-parse";

const heading = "⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯\n\n";
const divider = "⎯⎯⎯⎯⎯⎯⎯[1/1]⎯\n";
const footer = " Test Files  1 failed (1)\n      Tests  1 failed (1)\n";
const named = { files: ["tests/real.test.ts"], total: 1 };
const summary = `${heading} FAIL  |unit| tests/real.test.ts > x\nError: broken\n${divider}`;

describe("failed file review regressions", () => {
  it("does not turn a one-project path with a space into a different file", () => {
    expect(parseFailedTestFiles(`${heading} FAIL  tests/my file.test.ts > x\n${divider}${footer}`)).toBeNull();
  });

  it("does not treat a space-containing project name as part of the path", () => {
    expect(parseFailedTestFiles(`${heading} FAIL  |two words| tests/real.test.ts > x\n${divider}${footer}`)).toBeNull();
  });

  it("ignores a FAIL line quoted in a real Vitest error message", () => {
    // Captured by running one failing test that throws an Error quoting child output.
    const text = readFileSync(new URL("./fixtures/readiness/tmux-jobs/vitest-error-quotes-fail-line.log", import.meta.url), "utf8");
    expect(text).toContain("Error: Child test run failed; output follows:");
    expect(text).toContain(" FAIL  unit  tests/not-actually-failed.test.ts");
    expect(parseFailedTestFiles(`${text}${footer}`)).toBeNull();
  });

  it("does not claim an exact total for a partial summary", () => {
    expect(parseFailedTestFiles(summary)).toBeNull();
    expect(parseFailedTestFiles(`${summary}${footer.replace("1 failed (1)", "2 failed (2)")}`)).toBeNull();
  });

  it("does not accept a FAIL-looking line after the completed summary", () => {
    expect(parseFailedTestFiles(`${summary}${footer} FAIL  |unit| tests/later.test.ts > advisory\n`)).toEqual(named);
  });

  it("does not let a complete quoted summary hide the real summary on the same pipe", () => {
    const quoted = summary.replace("tests/real.test.ts", "tests/quoted.test.ts") + footer;
    expect(parseFailedTestFiles(quoted + summary + footer)).toBeNull();
  });

  it("counts one path under two projects once while reconciling two failed file tasks", () => {
    const text = `${heading.replace("Tests 1", "Tests 2")} FAIL  |unit| tests/real.test.ts > x\nError: x\n${divider} FAIL  |other| tests/real.test.ts > x\nError: x\n${divider}`;
    expect(parseFailedTestFiles(`${text}${footer.replaceAll("1 failed (1)", "2 failed (2)")}`)).toEqual(named);
  });

  it("finalizes a last footer line without a newline on a pipe", () => {
    const capture = makeFailedTestFilesCapture();
    capture.stream().push(summary + footer.trimEnd());
    expect(capture.result()).toEqual(named);
  });

  it("keeps an exact total only when all streams have finished their last FAIL line", () => {
    const capture = makeFailedTestFilesCapture();
    const stderr = capture.stream();
    const stdout = capture.stream();
    stderr.push(summary);
    stdout.push(footer);
    stderr.push(" FAIL  |unit| tests/unknown");
    expect(capture.result()).toBeNull();
  });

  it("survives a 14 MB log, a 1 MB diagnostic line, binary bytes, CRLF and split escapes", () => {
    const capture = makeFailedTestFilesCapture();
    const stderr = capture.stream();
    const stdout = capture.stream();
    for (let i = 0; i < 140; i++) stderr.push("noise\0".repeat(17000) + "\n");
    const coloured = `${heading}\u001b[41m FAIL \u001b[49m |unit| tests/real.test.ts > ${"x".repeat(1024 * 1024)}\nError: broken\n${divider}`.replaceAll("\n", "\r\n");
    for (let at = 0; at < coloured.length; at += 7) {
      stderr.push(coloured.slice(at, at + 7));
      stdout.push("unrelated\0\r\n");
    }
    stdout.push(footer);
    expect(capture.result()).toEqual(named);
  });

  it("returns unknown for unicode or binary paths instead of a partial exact list", () => {
    for (const path of ["tests/naïve.test.ts", "tests/bad\0.test.ts"]) {
      expect(parseFailedTestFiles(`${heading} FAIL  |unit| ${path} > x\nError: x\n${divider}${footer}`)).toBeNull();
    }
  });
});
