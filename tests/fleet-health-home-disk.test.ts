/**
 * `/home` in the box-health verdict.
 *
 * On the Hetzner box `/home` is a separate 49 GB volume and `/` is 300 GB. The
 * verdict read `df -k /` alone, so on 2026-10-05 `/home` reached 100%, peers'
 * commits failed, the Overseer daemon died of ENOSPC, and Box health said
 * nothing. docs/plans/261006m-box-disk-hygiene-timer-and-a-rebuildable-box.md.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { assembleHealth, computeVerdict, parseHomeDisk, type HealthReads } from "../tools/fleet/health.js";

const FIXTURES = path.resolve(import.meta.dirname, "fixtures/fleet-health");
const fx = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");

const calm = {
  load: { kind: "value", load1: 1, load5: 1, load15: 1, cores: 16, ratio1: 1 / 16 },
  memory: { kind: "value", totalBytes: 100, availableBytes: 60, availableFraction: 0.6 },
  swap: { kind: "none" },
  disk: { kind: "value", totalKiB: 100, usedKiB: 40, availableKiB: 60, usePercent: 40 },
  swapActivity: { kind: "skipped" },
} as const;

describe("parseHomeDisk", () => {
  it("reads the box's separate /home volume", () => {
    expect(parseHomeDisk(fx("df-k-home-real.txt"))).toEqual({
      kind: "value",
      totalKiB: 51290592,
      usedKiB: 25737936,
      availableKiB: 22914832,
      usePercent: 53,
    });
  });

  it("says there is no separate /home when df answers with the root filesystem", () => {
    // A laptop, or a box before the volume is bound. Reporting it as a second
    // disk would count `/` twice and put two reasons where there is one fact.
    expect(parseHomeDisk(fx("df-k-home-same-as-root.txt"))).toEqual({ kind: "none" });
  });

  it("does not read macOS's zero-sized automount as a full disk", () => {
    // `map auto_home 0 0 0 100%`: 100% of nothing. Read as a value this would
    // paint every laptop critical.
    expect(parseHomeDisk(fx("df-k-home-macos-automount.txt"))).toEqual({ kind: "none" });
  });

  it("says unknown, not none, when the line does not parse", () => {
    expect(parseHomeDisk(fx("df-k-malformed.txt")).kind).toBe("unknown");
  });
});

describe("computeVerdict with /home", () => {
  it("is critical, and names /home, when /home is full and / is not", () => {
    const v = computeVerdict({ ...calm, homeDisk: parseHomeDisk(fx("df-k-home-full.txt")) });
    expect(v.level).toBe("critical");
    expect(v.reasons).toContain("/home is 100% full");
    expect(v.reasons.some((r) => r.startsWith("/ is"))).toBe(false);
  });

  it("is strained at the same threshold / uses", () => {
    const v = computeVerdict({
      ...calm,
      homeDisk: { kind: "value", totalKiB: 100, usedKiB: 91, availableKiB: 9, usePercent: 91 },
    });
    expect(v).toEqual({ level: "strained", reasons: ["/home is 91% full"] });
  });

  it("stays ok at 53%, and with no separate /home", () => {
    expect(computeVerdict({ ...calm, homeDisk: parseHomeDisk(fx("df-k-home-real.txt")) }).level).toBe("ok");
    expect(computeVerdict({ ...calm, homeDisk: { kind: "none" } }).level).toBe("ok");
  });

  it("reports a /home it could not measure rather than calling it fine", () => {
    const v = computeVerdict({ ...calm, homeDisk: { kind: "unknown", why: "df failed: boom" } });
    expect(v.reasons).toContain("could not measure /home: df failed: boom");
  });
});

describe("assembleHealth", () => {
  it("carries the /home reading into the report and its verdict", () => {
    const ok = (out: string) => ({ ok: true as const, out });
    const reads: HealthReads = {
      uptime: ok(fx("uptime-real.txt")),
      nproc: ok(fx("nproc-real.txt")),
      free: ok(fx("free-b-real.txt")),
      swapon: ok(fx("swapon-bytes-real.txt")),
      df: ok(fx("df-k-real.txt")),
      dfHome: ok(fx("df-k-home-full.txt")),
      vmstat: { skipped: true },
      ps: ok(fx("ps-rss-args-mixed-real.txt")),
    };
    const report = assembleHealth(reads, 0, 1);
    expect(report.homeDisk).toMatchObject({ kind: "value", usePercent: 100 });
    expect(report.verdict.level).toBe("critical");
    expect(report.verdict.reasons).toContain("/home is 100% full");
  });
});
