/**
 * The fleet client's build stamp: what `vite.fleet.config.ts` writes beside
 * the bundle, and what the server reads back (docs/plans/260910f D3).
 *
 * The reader is the half that matters. A dashboard that cannot find or parse
 * the stamp must say "unknown", and say which of four reasons it was — never
 * fall back to a default that would later read as "same as the server".
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { BUILD_STAMP_FILE, buildStamp, readBuildStamp } from "../tools/fleet/build-stamp.js";
import type { BuildStamp } from "../tools/fleet/wire.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function distDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fleet-build-stamp-test-"));
  dirs.push(dir);
  return dir;
}

const SHA = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c";
const AT = new Date("2026-09-10T12:00:00.000Z");

describe("buildStamp", () => {
  test("is the start revision of the checkout, plus when it was built", () => {
    const run = () => ({
      status: 0,
      stdout: `# branch.oid ${SHA}\n# branch.head main\n1 .M N... 100644 100644 100644 ${SHA} ${SHA} x.ts\n`,
      stderr: "",
    });
    expect(buildStamp("/checkout", { run, now: () => AT })).toEqual({
      kind: "known",
      sha: SHA,
      dirty: true,
      readAt: AT.toISOString(),
      builtAt: AT.toISOString(),
    });
  });

  test("an unreadable checkout still builds, stamped unknown", () => {
    const run = () => ({ status: 128, stdout: "", stderr: "fatal: not a git repository" });
    const stamp = buildStamp("/nowhere", { run, now: () => AT });
    expect(stamp.kind).toBe("unknown");
    expect(stamp.builtAt).toBe(AT.toISOString());
  });
});

describe("readBuildStamp", () => {
  test("reads a stamp that was written", () => {
    const dir = distDir();
    const stamp: BuildStamp = { kind: "known", sha: SHA, dirty: false, readAt: AT.toISOString(), builtAt: AT.toISOString() };
    writeFileSync(join(dir, BUILD_STAMP_FILE), JSON.stringify(stamp));
    expect(readBuildStamp(dir)).toEqual({ kind: "stamp", stamp });
  });

  test("reads an unknown-revision stamp as a stamp — the build said it did not know", () => {
    const dir = distDir();
    const stamp: BuildStamp = { kind: "unknown", why: "git failed", readAt: AT.toISOString(), builtAt: AT.toISOString() };
    writeFileSync(join(dir, BUILD_STAMP_FILE), JSON.stringify(stamp));
    expect(readBuildStamp(dir)).toEqual({ kind: "stamp", stamp });
  });

  test("missing, unreadable, not JSON and the wrong shape are four different unknowns", () => {
    const missing = readBuildStamp(distDir());

    const unreadableDir = distDir();
    mkdirSync(join(unreadableDir, BUILD_STAMP_FILE)); // a directory where the file should be
    const unreadable = readBuildStamp(unreadableDir);

    const notJsonDir = distDir();
    writeFileSync(join(notJsonDir, BUILD_STAMP_FILE), '{"kind":"kno');
    const notJson = readBuildStamp(notJsonDir);

    const wrongShapeDir = distDir();
    // A start revision with no `builtAt` is not a build stamp.
    writeFileSync(join(wrongShapeDir, BUILD_STAMP_FILE), JSON.stringify({ kind: "known", sha: SHA, dirty: false, readAt: AT.toISOString() }));
    const wrongShape = readBuildStamp(wrongShapeDir);

    const whys: string[] = [];
    for (const result of [missing, unreadable, notJson, wrongShape]) {
      expect(result.kind).toBe("unknown");
      if (result.kind !== "unknown") throw new Error("expected unknown");
      whys.push(result.why);
    }
    expect(new Set(whys).size).toBe(4);
    expect(whys[0]).toContain("no build stamp");
    expect(whys[1]).toContain("could not be read");
    expect(whys[2]).toContain("not JSON");
    expect(whys[3]).toContain("not a build stamp");
  });

  test("each wrong shape is refused, not defaulted", () => {
    const shapes: unknown[] = [
      null,
      [],
      "a1b2c3",
      { kind: "known", sha: "not-a-sha", dirty: false, readAt: "x", builtAt: "y" },
      { kind: "known", sha: SHA, dirty: "no", readAt: "x", builtAt: "y" },
      { kind: "known", sha: SHA, dirty: false, builtAt: "y" },
      { kind: "unknown", readAt: "x", builtAt: "y" },
      { kind: "maybe", why: "x", readAt: "x", builtAt: "y" },
      { kind: "known", sha: SHA, dirty: false, readAt: "x", builtAt: 7 },
      // Otherwise well-formed, but a timestamp that is not an instant: a clock
      // calculation later would read NaN as a time.
      { kind: "known", sha: SHA, dirty: false, readAt: "not-a-date", builtAt: AT.toISOString() },
      { kind: "known", sha: SHA, dirty: false, readAt: AT.toISOString(), builtAt: "also-not-a-date" },
      { kind: "unknown", why: "git failed", readAt: "not-a-date", builtAt: AT.toISOString() },
      // Parses as a date, but is not the ISO instant the writer produces.
      { kind: "known", sha: SHA, dirty: false, readAt: "2026-09-10", builtAt: AT.toISOString() },
      { kind: "known", sha: SHA, dirty: false, readAt: AT.toISOString(), builtAt: "Thu, 10 Sep 2026 12:00:00 GMT" },
    ];
    for (const shape of shapes) {
      const dir = distDir();
      writeFileSync(join(dir, BUILD_STAMP_FILE), JSON.stringify(shape));
      expect(readBuildStamp(dir).kind, JSON.stringify(shape)).toBe("unknown");
    }
  });
});
