/**
 * **The cold-start harness refuses rather than reporting a number it did not
 * measure** — scripts/bench-cold-start.ts.
 *
 * A benchmark that measures module-import cost has one failure mode that looks
 * exactly like success: **a module can only be imported once per process**, so a
 * second reading in the same process is a few microseconds and reads as "we made
 * it fast". That is docs/reusable/silent-success.md in its purest form — the
 * natural check (the number came back, it is small) shares the bug's assumption.
 *
 * So the harness spawns one child per measurement, and the guards below are what
 * stop it quietly reporting nothing:
 *
 * - a child that failed, or died on a signal, is not a zero — it is an error;
 * - a child whose stdout carries no reading is not a zero either;
 * - a reading under `MIN_PLAUSIBLE_MS` is the second-import lie, and throws;
 * - and `assertFreshProcesses` checks the *observable outcome* of the fresh-child
 *   discipline — distinct pids, none of them the parent's — rather than
 *   restating the intent that each measurement was spawned.
 *
 * Every test here was watched go red against a harness with the corresponding
 * guard removed, and the failure message checked to name the right thing.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  MIN_BUNDLE_BYTES,
  MIN_PLAUSIBLE_MS,
  assertBundleReady,
  assertFreshProcesses,
  readingFrom,
} from "../scripts/bench-cold-start.js";

/** A child that did what it was asked, so the good path has something to be. */
function ok(ms: number, pid = 4242, rssBytes = 90_000_000) {
  return {
    status: 0,
    signal: null,
    stdout: `some noise on stdout\n__BENCH__${JSON.stringify({ ms, pid, rssBytes })}\n`,
    stderr: "",
  };
}

describe("readingFrom", () => {
  it("reads a child that reported properly", () => {
    const reading = readingFrom("jsdom", ok(875.4));
    expect(reading.ms).toBeCloseTo(875.4);
    expect(reading.pid).toBe(4242);
    expect(reading.rssBytes).toBe(90_000_000);
  });

  it("refuses a child that exited non-zero, and says what it said", () => {
    expect(() =>
      readingFrom("jsdom", {
        status: 1,
        signal: null,
        stdout: "",
        stderr: "Cannot find package 'jsdom'",
      }),
    ).toThrow(/jsdom[\s\S]*Cannot find package/);
  });

  it("refuses a child killed by a signal", () => {
    expect(() =>
      readingFrom("jsdom", { status: null, signal: "SIGKILL", stdout: "", stderr: "" }),
    ).toThrow(/SIGKILL/);
  });

  it("refuses a child that printed no reading at all", () => {
    expect(() =>
      readingFrom("jsdom", { status: 0, signal: null, stdout: "all done!\n", stderr: "" }),
    ).toThrow(/no reading/i);
  });

  it("refuses a reading whose line will not parse", () => {
    expect(() =>
      readingFrom("jsdom", { status: 0, signal: null, stdout: "__BENCH__{oops\n", stderr: "" }),
    ).toThrow(/parse/i);
  });

  /**
   * **The one that matters.** Zero is what a second import in a reused process
   * reports, and it is also what a broken timer reports. Neither is a
   * measurement, so neither may become a row in the table.
   */
  it("refuses a zero, which is what a reused process would report", () => {
    expect(() => readingFrom("jsdom", ok(0))).toThrow(/implausibly (small|fast)|0/i);
  });

  it("refuses anything under the floor", () => {
    expect(() => readingFrom("stripe", ok(MIN_PLAUSIBLE_MS / 2))).toThrow(/stripe/);
  });

  it("refuses a reading that is not a number", () => {
    expect(() => readingFrom("jsdom", ok(Number.NaN))).toThrow();
    expect(() =>
      readingFrom("jsdom", {
        status: 0,
        signal: null,
        stdout: `__BENCH__${JSON.stringify({ ms: "875", pid: 1, rssBytes: 1 })}`,
        stderr: "",
      }),
    ).toThrow();
  });
});

describe("assertFreshProcesses", () => {
  const reading = (pid: number) => ({ specifier: `s${pid}`, ms: 100, pid, rssBytes: 1 });

  it("accepts one child per measurement", () => {
    expect(() => assertFreshProcesses([reading(11), reading(12), reading(13)])).not.toThrow();
  });

  it("refuses when two measurements came from one process", () => {
    expect(() => assertFreshProcesses([reading(11), reading(12), reading(11)])).toThrow(
      /same process|reused|11/,
    );
  });

  it("refuses a reading taken in the harness's own process", () => {
    expect(() => assertFreshProcesses([reading(process.pid)])).toThrow(/own process|parent/i);
  });

  it("refuses an empty run, which measures nothing", () => {
    expect(() => assertFreshProcesses([])).toThrow(/nothing/i);
  });
});

describe("assertBundleReady", () => {
  const roots: string[] = [];
  function root(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "bench-cold-start-"));
    roots.push(dir);
    mkdirSync(path.join(dir, "api-dist"));
    mkdirSync(path.join(dir, "src"));
    return dir;
  }
  afterAll(() => {
    for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  });

  function writeBundle(dir: string, bytes: number, seconds: number): void {
    const file = path.join(dir, "api-dist", "vercel.js");
    writeFileSync(file, "x".repeat(bytes));
    utimesSync(file, seconds, seconds);
  }
  function writeSource(dir: string, seconds: number): void {
    const file = path.join(dir, "src", "routes.ts");
    writeFileSync(file, "export const x = 1;\n");
    utimesSync(file, seconds, seconds);
  }

  it("names the build command when there is no bundle", () => {
    expect(() => assertBundleReady(root())).toThrow(/build:api/);
  });

  it("refuses a bundle too small to be the real one", () => {
    const dir = root();
    writeBundle(dir, 10, 2_000);
    writeSource(dir, 1_000);
    expect(() => assertBundleReady(dir)).toThrow(/build:api/);
  });

  it("refuses a bundle older than the source it was built from, and names the file", () => {
    const dir = root();
    writeBundle(dir, MIN_BUNDLE_BYTES + 1, 1_000);
    writeSource(dir, 2_000);
    expect(() => assertBundleReady(dir)).toThrow(/stale[\s\S]*routes\.ts/);
  });

  it("accepts a bundle newer than every source file", () => {
    const dir = root();
    writeSource(dir, 1_000);
    writeBundle(dir, MIN_BUNDLE_BYTES + 1, 2_000);
    const ready = assertBundleReady(dir);
    expect(ready.bytes).toBe(MIN_BUNDLE_BYTES + 1);
    expect(ready.path).toBe(path.join(dir, "api-dist", "vercel.js"));
  });
});
