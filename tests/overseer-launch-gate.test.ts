/**
 * The one launch gate both Overseer launchers ask — gradual recovery and the
 * scheduler — before they start a Claude session.
 *
 * The order of the rules is the point: positive evidence (a usage limit in
 * force, a usage limit approaching, a critical box) holds whatever the caller
 * says about unknowns; `strained` is clear with a note; and only what is truly
 * unknown is left to `onUnknown`. Each test below pins one of those.
 */
import { describe, expect, test } from "vitest";

import type { RateLimitHit, ScanCoverage, StoredUsage, UsageLevel, UsageReport } from "../tools/fleet/wire.js";
import { launchGate } from "../tools/overseer/launch-gate.js";

const NOW = Date.parse("2026-09-10T12:00:00.000Z");
const MINUTE = 60_000;
const STALE_AFTER = 15 * MINUTE;

function coverage(): ScanCoverage {
  return {
    transcriptsFound: 4,
    transcriptsSelected: 4,
    transcriptsOpened: 4,
    transcriptsUnreadable: 0,
    unreadableWhy: [],
    linesScanned: 900,
    candidateLines: 0,
    linesParsed: 0,
    malformedCandidates: 0,
    quotaLimitsWithoutErrorSignal: 0,
    truncatedByLimit: false,
    sinceMs: null,
    tookMs: 50,
  };
}

function hit(resetsAtMs: number): RateLimitHit {
  return {
    id: `launch-gate-hit-${resetsAtMs}`,
    window: "five_hour",
    resetsAtMs,
    hitAtMs: NOW - 10 * MINUTE,
    hitAt: new Date(NOW - 10 * MINUTE).toISOString(),
    status: "rejected",
    claudeSessionId: null,
    transcriptPath: "/tmp/launch-gate-fixture.jsonl",
    message: "You've hit your session limit",
  };
}

function report(level: UsageLevel, over: Partial<UsageReport> = {}, activeLimit: RateLimitHit | null = null): UsageReport {
  return {
    account: { kind: "unknown", why: "not read in this fixture" },
    cache: { kind: "unknown", why: "no cache reading in this fixture" },
    rateLimits: activeLimit === null ? { kind: "none", coverage: coverage() } : { kind: "hits", hits: [activeLimit], coverage: coverage() },
    verdict: { level, reasons: [`fixture says ${level}`], activeLimit },
    collectedAt: new Date(NOW - MINUTE).toISOString(),
    tookMs: 50,
    ...over,
  };
}

function usage(r: UsageReport): StoredUsage {
  return { kind: "report", report: r };
}

function health(level: string): unknown {
  return { verdict: { level, reasons: [`fixture says ${level}`] }, collectedAt: new Date(NOW).toISOString(), tookMs: 5 };
}

const OK_USAGE = usage(report("ok"));
const OK_HEALTH = health("ok");

type Input = Parameters<typeof launchGate>[0];
function gate(over: Partial<Input>) {
  return launchGate({
    usage: OK_USAGE,
    health: OK_HEALTH,
    nowMs: NOW,
    onUnknown: "hold",
    usageStaleAfterMs: STALE_AFTER,
    ...over,
  });
}

function expectHeld(r: ReturnType<typeof launchGate>): Extract<ReturnType<typeof launchGate>, { kind: "held" }> {
  expect(r.kind).toBe("held");
  if (r.kind !== "held") throw new Error("unreachable");
  return r;
}

function expectClear(r: ReturnType<typeof launchGate>): Extract<ReturnType<typeof launchGate>, { kind: "clear" }> {
  expect(r.kind).toBe("clear");
  if (r.kind !== "clear") throw new Error("unreachable");
  return r;
}

describe("everything known and fine", () => {
  test("ok usage and ok health is clear with no notes, under either onUnknown", () => {
    for (const onUnknown of ["hold", "clear"] as const) {
      expect(gate({ onUnknown })).toEqual({ kind: "clear", notes: [] });
    }
  });
});

describe("positive evidence always holds, even when unknowns would be cleared", () => {
  test("usage limited holds until the active limit's reset instant", () => {
    const resets = NOW + 90 * MINUTE;
    const r = expectHeld(gate({ onUnknown: "clear", usage: usage(report("limited", {}, hit(resets))) }));
    expect(r.until).toBe(new Date(resets).toISOString());
    expect(r.why).toMatch(/usage limit/);
  });

  test("usage limited with no active limit holds with until null", () => {
    const r = expectHeld(gate({ onUnknown: "clear", usage: usage(report("limited")) }));
    expect(r.until).toBeNull();
  });

  test("usage approaching holds with until null", () => {
    const r = expectHeld(gate({ onUnknown: "clear", usage: usage(report("approaching")) }));
    expect(r.until).toBeNull();
    expect(r.why).toMatch(/approaching/);
  });

  test("health critical holds", () => {
    const r = expectHeld(gate({ onUnknown: "clear", health: health("critical") }));
    expect(r.until).toBeNull();
    expect(r.why).toMatch(/critical/);
  });

  test("several holds are all named, and until is the latest reset instant", () => {
    const resets = NOW + 3 * 60 * MINUTE;
    const r = expectHeld(gate({ onUnknown: "clear", usage: usage(report("limited", {}, hit(resets))), health: health("critical") }));
    expect(r.why).toMatch(/usage limit/);
    expect(r.why).toMatch(/critical/);
    expect(r.until).toBe(new Date(resets).toISOString());
  });

  test("a positive hold is not overridden by strained health", () => {
    expectHeld(gate({ onUnknown: "clear", usage: usage(report("approaching")), health: health("strained") }));
  });
});

describe("a limit whose reset has already passed is unknown, not positive", () => {
  const past = usage(report("limited", {}, hit(NOW - MINUTE)));

  test("under hold it holds, saying the reset time has passed, with until null", () => {
    const r = expectHeld(gate({ onUnknown: "hold", usage: past }));
    expect(r.why).toMatch(/reset time has passed/);
    expect(r.until).toBeNull();
  });

  test("under clear it clears, with a note", () => {
    const r = expectClear(gate({ onUnknown: "clear", usage: past }));
    expect(r.notes.join(" ")).toMatch(/reset time has passed/);
  });

  test("a reset exactly at now counts as passed", () => {
    expectClear(gate({ onUnknown: "clear", usage: usage(report("limited", {}, hit(NOW))) }));
  });
});

describe("strained health", () => {
  test("is clear, with a note", () => {
    for (const onUnknown of ["hold", "clear"] as const) {
      const r = expectClear(gate({ onUnknown, health: health("strained") }));
      expect(r.notes.join(" ")).toMatch(/strained/);
    }
  });
});

describe("each unknown source goes to onUnknown", () => {
  const unknowns: Array<[string, Partial<Input>, RegExp]> = [
    ["usage null", { usage: null }, /no usage reading/],
    ["usage none arm", { usage: { kind: "none", why: "the usage pass has not run yet", at: new Date(NOW).toISOString() } }, /no usage reading/],
    ["usage verdict unknown", { usage: usage(report("unknown")) }, /usage/],
    ["usage report stale", { usage: usage(report("ok", { collectedAt: new Date(NOW - STALE_AFTER - 1).toISOString() })) }, /old/],
    ["usage collectedAt unparseable", { usage: usage(report("ok", { collectedAt: "yesterday-ish" })) }, /usage/],
    ["usage collectedAt far in the future", { usage: usage(report("ok", { collectedAt: new Date(NOW + 5 * MINUTE + 1).toISOString() })) }, /future/],
    ["health null", { health: null }, /health/],
    ["health a string", { health: "ok" }, /health/],
    ["health without a verdict level", { health: { verdict: {} } }, /health/],
    ["health with an unrecognised level", { health: { verdict: { level: "weird" } } }, /health/],
    ["health level unknown", { health: health("unknown") }, /health/],
  ];

  for (const [name, over, pattern] of unknowns) {
    test(`${name}: held under "hold"`, () => {
      const r = expectHeld(gate({ ...over, onUnknown: "hold" }));
      expect(r.why).toMatch(pattern);
      expect(r.until).toBeNull();
    });

    test(`${name}: clear with a note under "clear"`, () => {
      const r = expectClear(gate({ ...over, onUnknown: "clear" }));
      expect(r.notes.join(" ")).toMatch(pattern);
    });
  }

  test("two unknowns under hold are both named", () => {
    const r = expectHeld(gate({ usage: null, health: null, onUnknown: "hold" }));
    expect(r.why).toMatch(/no usage reading/);
    expect(r.why).toMatch(/health/);
  });
});

describe("the staleness and future-clock boundaries", () => {
  test("a report exactly usageStaleAfterMs old is still fresh", () => {
    const r = gate({ usage: usage(report("ok", { collectedAt: new Date(NOW - STALE_AFTER).toISOString() })) });
    expect(r).toEqual({ kind: "clear", notes: [] });
  });

  test("one millisecond older is stale", () => {
    expectHeld(gate({ usage: usage(report("ok", { collectedAt: new Date(NOW - STALE_AFTER - 1).toISOString() })) }));
  });

  test("a report up to five minutes in the future is tolerated as clock skew", () => {
    const r = gate({ usage: usage(report("ok", { collectedAt: new Date(NOW + 5 * MINUTE).toISOString() })) });
    expect(r).toEqual({ kind: "clear", notes: [] });
  });

  test("a stale limited report is unknown, not a hold with an until", () => {
    const stale = usage(
      report("limited", { collectedAt: new Date(NOW - STALE_AFTER - MINUTE).toISOString() }, hit(NOW + 60 * MINUTE)),
    );
    expectClear(gate({ onUnknown: "clear", usage: stale }));
  });
});

describe("garbage never throws", () => {
  const garbage: unknown[] = [
    undefined,
    null,
    0,
    "report",
    [],
    {},
    { kind: "report" },
    { kind: "report", report: null },
    { kind: "report", report: { verdict: null, collectedAt: new Date(NOW).toISOString() } },
    { kind: "report", report: { verdict: { level: "limited", activeLimit: { resetsAtMs: "soon" } }, collectedAt: new Date(NOW).toISOString() } },
    { kind: "report", report: { verdict: { level: "limited", activeLimit: { resetsAtMs: Number.POSITIVE_INFINITY } }, collectedAt: new Date(NOW).toISOString() } },
    { kind: "martian" },
  ];
  const healths: unknown[] = [undefined, null, 7, "critical", [], { verdict: null }, { verdict: { level: 3 } }, { verdict: "critical" }];

  test("every combination returns a decision", () => {
    for (const u of garbage) {
      for (const h of healths) {
        for (const onUnknown of ["hold", "clear"] as const) {
          const r = launchGate({ usage: u as StoredUsage | null, health: h, nowMs: NOW, onUnknown, usageStaleAfterMs: STALE_AFTER });
          expect(["clear", "held"]).toContain(r.kind);
        }
      }
    }
  });

  test("a malformed usage report is unknown: held under hold", () => {
    expectHeld(gate({ usage: { kind: "report", report: null } as unknown as StoredUsage }));
  });

  test("an unreadable limit instant still holds (limited is positive), with until null", () => {
    const bad = {
      kind: "report",
      report: { ...report("limited"), verdict: { level: "limited", reasons: [], activeLimit: { resetsAtMs: "soon" } } },
    } as unknown as StoredUsage;
    const r = expectHeld(gate({ onUnknown: "clear", usage: bad }));
    expect(r.until).toBeNull();
  });
});
