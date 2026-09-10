/**
 * `accountQuotaGate`: one account's own usage reading, judged for a launch.
 *
 * The live endpoint sends Claude's two stable windows, `five_hour` and
 * `seven_day`, and alongside them rotating codename windows that routinely
 * arrive at 0% with no reset time — which dev's `windowCard` turns into an
 * `unknown` card. A rule that treated every unknown card as unknown evidence
 * would hold every real resume for ever (recovery holds on unknown). So the two
 * named windows are REQUIRED and judged strictly, while a codename window is
 * judged only when it carries a number: a number is positive evidence whatever
 * the window is called, and an unnumbered codename window is ignored with a note.
 */
import { describe, expect, test } from "vitest";

import { accountQuotaGate } from "../tools/overseer/launch-gate.js";

const NOW = Date.parse("2026-09-10T12:00:00.000Z");
const MINUTE = 60_000;
const STALE_AFTER = 15 * MINUTE;
const LATER = "2026-09-10T14:30:00.391562+00:00"; // the live endpoint's spelling

type Card =
  | { kind: "value"; window: string; utilizationPercent: number; resetsAt: string }
  | { kind: "expired"; window: string; resetsAt: string; why: string }
  | { kind: "unknown"; window: string; why: string };

function value(window: string, utilizationPercent: number, resetsAt = LATER): Card {
  return { kind: "value", window, utilizationPercent, resetsAt };
}

function section(windows: Card[]) {
  return {
    name: "quota-gate-acct",
    role: "pool",
    origin: "registered",
    displayEmail: null,
    takenAt: new Date(NOW - MINUTE).toISOString(),
    family: "claude",
    providerAccountId: "quota-gate-provider",
    reading: { kind: "windows", windows },
  } as never;
}

const codenameUnknown: Card = { kind: "unknown", window: "codename_x", why: "no reset time" };

describe("accountQuotaGate: the two named windows, and the codename windows beside them", () => {
  test("both named windows under 80% with an unnumbered codename window beside them is clear, with a note", () => {
    const gate = accountQuotaGate(section([value("five_hour", 20), value("seven_day", 40), codenameUnknown]), NOW, "hold", STALE_AFTER);
    expect(gate.kind).toBe("clear");
    if (gate.kind === "clear") expect(gate.notes.join(" ")).toMatch(/codename_x/);
  });

  test("an expired codename window is ignored too", () => {
    const expired: Card = { kind: "expired", window: "codename_y", resetsAt: "2026-09-10T11:00:00.000Z", why: "reset" };
    expect(accountQuotaGate(section([value("five_hour", 20), value("seven_day", 40), expired]), NOW, "hold", STALE_AFTER).kind).toBe("clear");
  });

  test("a codename window WITH a number at 80% or more still holds: a number is evidence whatever it is called", () => {
    const gate = accountQuotaGate(section([value("five_hour", 20), value("seven_day", 40), value("codename_z", 85)]), NOW, "clear", STALE_AFTER);
    expect(gate.kind).toBe("held");
  });

  test("a missing five_hour window is unknown, and holds under onUnknown hold", () => {
    const gate = accountQuotaGate(section([value("seven_day", 40)]), NOW, "hold", STALE_AFTER);
    expect(gate.kind).toBe("held");
    if (gate.kind === "held") expect(gate.why).toMatch(/five_hour|five-hour|5-hour/);
  });

  test("an unknown seven_day window is unknown, and holds under onUnknown hold", () => {
    const gate = accountQuotaGate(section([value("five_hour", 20), { kind: "unknown", window: "seven_day", why: "no reset time" }]), NOW, "hold", STALE_AFTER);
    expect(gate.kind).toBe("held");
  });

  test("an expired seven_day window is unknown", () => {
    const expired: Card = { kind: "expired", window: "seven_day", resetsAt: "2026-09-10T11:00:00.000Z", why: "reset" };
    expect(accountQuotaGate(section([value("five_hour", 20), expired]), NOW, "hold", STALE_AFTER).kind).toBe("held");
    expect(accountQuotaGate(section([value("five_hour", 20), expired]), NOW, "clear", STALE_AFTER).kind).toBe("clear");
  });

  test("five_hour at 100% with a future reset holds until that reset, even under onUnknown clear", () => {
    const gate = accountQuotaGate(section([value("five_hour", 100), value("seven_day", 40), codenameUnknown]), NOW, "clear", STALE_AFTER);
    expect(gate).toEqual({ kind: "held", why: expect.any(String), until: "2026-09-10T14:30:00.391Z" });
  });
});
