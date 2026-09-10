/**
 * The day budget every paid attention call goes through — tools/overseer/model-budget.ts.
 *
 * Plan 260910f, D4 and D5, after GPT Sol's F1 on the plan: the per-pass
 * ceiling had a CLI bypass and a crash gap, and a per-day ceiling did not
 * exist. What these tests hold is the plan's one sentence about it — *none may
 * exceed or reset*: two processes cannot both spend the last call, a crash
 * between reserve and settle leaves the worst case spent, a deleted or torn
 * ledger refuses rather than starting the day again, and a clock that went
 * backwards refuses rather than trusting itself.
 *
 * Nothing here makes a network call. The transport is a fake handed to
 * `budgetedClassifier`; the real one (`classifyTail`) is reached only through
 * `paidClassifier`, and the last test says so structurally.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { NO_SPEND, type ClassifierSpend } from "../tools/overseer/attention-classify.js";
import {
  COOLDOWN_CAP_MS,
  COOLDOWN_FIRST_MS,
  DAY_CEILING,
  MODEL_BUDGET_FILE,
  MODEL_BUDGET_INIT_FILE,
  MODEL_BUDGET_LOCK_FILE,
  WORST_CASE_CALL_TOKENS,
  WORST_CASE_CALL_USD,
  budgetedClassifier,
  describeBudget,
  modelBudget,
  type ReserveResult,
} from "../tools/overseer/model-budget.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-model-budget-"));
  roots.push(root);
  return root;
}

const DAY = "2026-09-10";
const T0 = "2026-09-10T12:00:00.000Z";
const NEXT_MIDNIGHT = "2026-09-11T00:00:00.000Z";

function budgetAt(root: string, iso: string, extra: { lockWaitMs?: number; whileHolding?: () => void } = {}) {
  return modelBudget({ root, now: () => new Date(iso), ...extra });
}

/** What the gateway said about one ordinary priced call. */
const SPEND: ClassifierSpend = { calls: 1, promptTokens: 1200, completionTokens: 40, costUsd: 0.0004, unpricedCalls: 0 };

function ledger(day: string, spent: Record<string, number> = {}, over: Record<string, unknown> = {}): unknown {
  return {
    schema: 1,
    day,
    spent: { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0, unpricedCalls: 0, ...spent },
    reservations: [],
    cooldown: null,
    closed: null,
    ...over,
  };
}

/** A root that has been counting — the state every refusal-instead-of-reset test needs. */
function initialisedWith(root: string, value: unknown): void {
  writeFileSync(join(root, MODEL_BUDGET_FILE), `${JSON.stringify(value)}\n`);
  writeFileSync(join(root, MODEL_BUDGET_INIT_FILE), "counting since the test began\n");
}

function onDisk(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, MODEL_BUDGET_FILE), "utf8")) as Record<string, unknown>;
}

function refusal(result: ReserveResult): { kind: string; stopped?: { kind: string; why: string; until: string } } {
  if (result.ok) throw new Error("expected a refusal, got a reservation");
  return result.refusal;
}

describe("reserve and settle — the worst case is on disk before the request", () => {
  it("grants the first call of a fresh root, and starts counting", () => {
    // Before initialisation, absent means fresh: there is nothing to have lost.
    const root = tempRoot();
    const result = budgetAt(root, T0).reserve();
    expect(result.ok).toBe(true);
    expect(existsSync(join(root, MODEL_BUDGET_INIT_FILE))).toBe(true);
    const written = onDisk(root);
    expect(written["day"]).toBe(DAY);
    expect(written["reservations"]).toHaveLength(1);
  });

  it("counts an unsettled reservation at the worst case", () => {
    const root = tempRoot();
    budgetAt(root, T0).reserve();
    const reading = budgetAt(root, T0).read();
    expect(reading.inFlight).toBe(1);
    expect(reading.committed.calls).toBe(1);
    expect(reading.committed.costUsd).toBeCloseTo(WORST_CASE_CALL_USD, 9);
    expect(reading.committed.promptTokens + reading.committed.completionTokens).toBe(WORST_CASE_CALL_TOKENS);
  });

  it("replaces the reservation with the gateway's own numbers when it settles", () => {
    const root = tempRoot();
    const budget = budgetAt(root, T0);
    const result = budget.reserve();
    if (!result.ok) throw new Error("expected a reservation");
    expect(budget.settle(result.reservation, SPEND, true)).toBe(true);
    const written = onDisk(root);
    expect(written["reservations"]).toEqual([]);
    expect(written["spent"]).toEqual({ calls: 1, promptTokens: 1200, completionTokens: 40, costUsd: 0.0004, unpricedCalls: 0 });
  });

  it("settles an unpriced call at the worst-case cost, and counts it as unpriced", () => {
    // `callCost` refused to price it. Settling it at zero would be the flattering
    // reading of *we could not tell*, and a ceiling that flatters is not one.
    const root = tempRoot();
    const budget = budgetAt(root, T0);
    const result = budget.reserve();
    if (!result.ok) throw new Error("expected a reservation");
    budget.settle(result.reservation, { ...SPEND, costUsd: null, unpricedCalls: 1 }, true);
    const spent = onDisk(root)["spent"] as Record<string, number>;
    expect(spent["costUsd"]).toBeCloseTo(WORST_CASE_CALL_USD, 9);
    expect(spent["unpricedCalls"]).toBe(1);
  });

  it("leaves the worst case spent for good when the process dies between reserve and settle", () => {
    // The crash gap in Sol's F1: a call made and never recorded could be made
    // again. The reservation is the record, so dropping the handle — which is
    // all a crash is, from the ledger's side — leaves it counted.
    const root = tempRoot();
    initialisedWith(root, ledger(DAY, { calls: DAY_CEILING.calls - 1 }));
    expect(budgetAt(root, T0).reserve().ok).toBe(true);
    // …the process dies here. A new one opens the same directory:
    const after = budgetAt(root, "2026-09-10T12:05:00.000Z");
    expect(refusal(after.reserve())).toMatchObject({ kind: "stopped", stopped: { kind: "exhausted" } });
    const reading = after.read();
    expect(reading.committed.calls).toBe(DAY_CEILING.calls);
    expect(reading.inFlight).toBe(1);
  });
});

describe("the ceilings — refused at the worst case of ONE more call", () => {
  it.each([
    ["calls", { calls: DAY_CEILING.calls }, { calls: DAY_CEILING.calls - 1 }],
    ["tokens", { promptTokens: DAY_CEILING.tokens - WORST_CASE_CALL_TOKENS + 1 }, { promptTokens: DAY_CEILING.tokens - WORST_CASE_CALL_TOKENS }],
    ["cost", { costUsd: DAY_CEILING.costUsd - WORST_CASE_CALL_USD + 0.000001 }, { costUsd: DAY_CEILING.costUsd - WORST_CASE_CALL_USD }],
  ])("refuses the call that could cross the %s ceiling, and grants the one that could not", (_name, over, under) => {
    const refusedRoot = tempRoot();
    initialisedWith(refusedRoot, ledger(DAY, over));
    const refused = refusal(budgetAt(refusedRoot, T0).reserve());
    expect(refused).toMatchObject({ kind: "stopped", stopped: { kind: "exhausted", until: NEXT_MIDNIGHT } });

    const grantedRoot = tempRoot();
    initialisedWith(grantedRoot, ledger(DAY, under));
    expect(budgetAt(grantedRoot, T0).reserve().ok).toBe(true);
  });
});

describe("the day — UTC, never reset, never trusted backwards", () => {
  it("starts a fresh day at UTC midnight", () => {
    const root = tempRoot();
    initialisedWith(root, ledger("2026-09-09", { calls: DAY_CEILING.calls }));
    expect(budgetAt(root, "2026-09-10T00:00:01.000Z").reserve().ok).toBe(true);
    expect(onDisk(root)["day"]).toBe(DAY);
  });

  it("settles a reservation into ITS OWN day when another process has already rolled the ledger over", () => {
    const root = tempRoot();
    const late = budgetAt(root, "2026-09-09T23:59:59.000Z");
    const yesterday = late.reserve();
    if (!yesterday.ok) throw new Error("expected a reservation");
    // Someone reserves just after midnight: the ledger is now the new day's.
    expect(budgetAt(root, "2026-09-10T00:00:01.000Z").reserve().ok).toBe(true);
    // The call that began yesterday comes back and settles — into yesterday,
    // which is gone. Nothing of it lands on today.
    late.settle(yesterday.reservation, SPEND, true);
    const written = onDisk(root);
    expect(written["day"]).toBe(DAY);
    expect((written["spent"] as Record<string, number>)["calls"]).toBe(0);
    expect(written["reservations"]).toHaveLength(1);
  });

  it("settles into its own day when nobody has rolled the ledger over, and the next reservation starts the new day", () => {
    // One instance whose clock crosses midnight: only the instance that minted a
    // reservation may settle it (F11), so the crossing is the clock's, not a
    // second budget's.
    const root = tempRoot();
    let clock = "2026-09-09T23:59:00.000Z";
    const budget = modelBudget({ root, now: () => new Date(clock) });
    const reserved = budget.reserve();
    if (!reserved.ok) throw new Error("expected a reservation");
    clock = "2026-09-10T00:01:00.000Z";
    expect(budget.settle(reserved.reservation, SPEND, true)).toBe(true);
    expect(onDisk(root)).toMatchObject({ day: "2026-09-09", spent: { calls: 1 }, reservations: [] });
    expect(budgetAt(root, "2026-09-10T00:02:00.000Z").reserve().ok).toBe(true);
    expect(onDisk(root)).toMatchObject({ day: DAY, spent: { calls: 0 } });
  });

  it("refuses a ledger dated after today, because the clock went backwards", () => {
    const root = tempRoot();
    initialisedWith(root, ledger("2026-09-11"));
    const before = readFileSync(join(root, MODEL_BUDGET_FILE), "utf8");
    const refused = refusal(budgetAt(root, T0).reserve());
    expect(refused).toMatchObject({ kind: "stopped", stopped: { kind: "exhausted", until: "2026-09-12T00:00:00.000Z" } });
    expect(refused.stopped?.why).toContain("clock");
    // Not "corrected": the file is left exactly as it was.
    expect(readFileSync(join(root, MODEL_BUDGET_FILE), "utf8")).toBe(before);
  });

  it.each([
    ["deleted", (root: string) => rmSync(join(root, MODEL_BUDGET_FILE))],
    ["torn", (root: string) => writeFileSync(join(root, MODEL_BUDGET_FILE), '{"schema":1,"day":"2026-09-10","spent":{"calls":3')],
    ["the wrong shape", (root: string) => writeFileSync(join(root, MODEL_BUDGET_FILE), JSON.stringify({ schema: 1, day: DAY }))],
  ])("refuses for the rest of the UTC day when an initialised ledger is %s, rather than re-granting it", (_name, damage) => {
    const root = tempRoot();
    const first = budgetAt(root, T0);
    const reserved = first.reserve();
    if (!reserved.ok) throw new Error("expected a reservation");
    first.settle(reserved.reservation, SPEND, true);
    damage(root);

    const refused = refusal(budgetAt(root, "2026-09-10T13:00:00.000Z").reserve());
    expect(refused).toMatchObject({ kind: "stopped", stopped: { kind: "exhausted", until: NEXT_MIDNIGHT } });
    // It wrote a closed ledger saying why, so the refusal survives the next
    // read rather than being re-decided from a fresh empty file.
    expect(onDisk(root)).toMatchObject({ day: DAY, closed: { why: expect.any(String) } });
    expect(budgetAt(root, "2026-09-10T20:00:00.000Z").reserve().ok).toBe(false);
    // The next UTC day is a new day.
    expect(budgetAt(root, "2026-09-11T00:00:01.000Z").reserve().ok).toBe(true);
  });
});

describe("the cooldown — the gateway's own 402 or 429 (D5)", () => {
  it("refuses for fifteen minutes after a strike, doubling per consecutive strike to a two-hour cap", () => {
    const root = tempRoot();
    let now = Date.parse(T0);
    const at = () => budgetAt(root, new Date(now).toISOString());
    const expected = [COOLDOWN_FIRST_MS, 2 * COOLDOWN_FIRST_MS, 4 * COOLDOWN_FIRST_MS, COOLDOWN_CAP_MS, COOLDOWN_CAP_MS];
    for (const ms of expected) {
      at().strike("the gateway returned 429");
      const refused = refusal(at().reserve());
      expect(refused).toMatchObject({ kind: "stopped", stopped: { kind: "cooling-down" } });
      expect(Date.parse(refused.stopped?.until ?? "")).toBe(now + ms);
      expect(refused.stopped?.why).toContain("429");
      now += ms;
    }
    // Past the last one, a call is allowed again.
    expect(at().reserve().ok).toBe(true);
  });

  it("clears the strikes on a call that came back judged, so the next strike starts at fifteen minutes", () => {
    const root = tempRoot();
    budgetAt(root, T0).strike("429");
    budgetAt(root, "2026-09-10T12:15:00.000Z").strike("429");
    const later = budgetAt(root, "2026-09-10T13:00:00.000Z");
    const reserved = later.reserve();
    if (!reserved.ok) throw new Error("expected a reservation");
    later.settle(reserved.reservation, SPEND, true);
    later.strike("429 again");
    const refused = refusal(later.reserve());
    expect(Date.parse(refused.stopped?.until ?? "")).toBe(Date.parse("2026-09-10T13:00:00.000Z") + COOLDOWN_FIRST_MS);
  });

  it("strikes when the transport comes back 429, and the NEXT call is not made", async () => {
    const root = tempRoot();
    let made = 0;
    const classify = budgetedClassifier(budgetAt(root, T0), async () => {
      made += 1;
      return { verdict: { kind: "quota-refused", status: 429, why: "the gateway returned 429: slow down" }, spend: { ...NO_SPEND, calls: 1 } };
    });
    await classify("first tail");
    const second = await classify("second tail");
    expect(made).toBe(1);
    expect(second).toMatchObject({ notCalled: { kind: "stopped", stopped: { kind: "cooling-down" } } });
  });
});

describe("two callers, one ledger — only one gets the last call", () => {
  it("two budgets on one directory (a daemon and a hand run) cannot both take the last call", () => {
    // The race is forced rather than hoped for: the second caller arrives while
    // the first holds the budget lock, between reading the ledger and writing
    // it. Without the lock both would read "one call left" and both would win.
    const root = tempRoot();
    initialisedWith(root, ledger(DAY, { calls: DAY_CEILING.calls - 1 }));
    let second: ReserveResult | null = null;
    const daemon = budgetAt(root, T0, {
      whileHolding: () => {
        second = budgetAt(root, T0, { lockWaitMs: 0 }).reserve();
      },
    });
    const first = daemon.reserve();
    expect(first.ok).toBe(true);
    expect(second).not.toBeNull();
    expect((second as ReserveResult | null)?.ok).toBe(false);
    // …and once the lock is free, the loser is refused on the ceiling, not granted.
    expect(refusal(budgetAt(root, T0).reserve())).toMatchObject({ kind: "stopped", stopped: { kind: "exhausted" } });
    expect(onDisk(root)["reservations"]).toHaveLength(1);
  });

  it("two calls in flight in one process cannot both take the last call", async () => {
    // The reservation, not the settle, is what the second caller sees — which is
    // the whole reason it is persisted BEFORE the request rather than recorded
    // after the response.
    const root = tempRoot();
    initialisedWith(root, ledger(DAY, { calls: DAY_CEILING.calls - 1 }));
    let made = 0;
    const classify = budgetedClassifier(budgetAt(root, T0), async () => {
      made += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { verdict: { kind: "no-question", why: "a status report" }, spend: SPEND };
    });
    const outcomes = await Promise.all([classify("a"), classify("b")]);
    expect(made).toBe(1);
    expect(outcomes.filter((o) => "notCalled" in o)).toHaveLength(1);
  });

  it("a second budget cannot settle — and so free — a reservation the first one holds (F11)", () => {
    // Settling replaces the worst case with the real figure, so settling
    // somebody else's reservation frees its headroom while their call is still
    // in flight and may still spend it. A takes the last worst-case slot; B
    // must be able neither to release it nor to take it again.
    const root = tempRoot();
    initialisedWith(root, ledger(DAY, { costUsd: DAY_CEILING.costUsd - WORST_CASE_CALL_USD }));
    const a = budgetAt(root, T0);
    const b = budgetAt(root, T0);
    const held = a.reserve();
    if (!held.ok) throw new Error("expected a reservation");
    const zero: ClassifierSpend = { ...NO_SPEND, calls: 1 };
    expect(b.settle(held.reservation, zero, false)).toBe(false);
    // The handle's public shape is two strings; a copy of them is no key either.
    expect(b.settle({ id: held.reservation.id, day: held.reservation.day }, zero, false)).toBe(false);
    expect(onDisk(root)["reservations"]).toHaveLength(1);
    expect(refusal(b.reserve())).toMatchObject({ kind: "stopped", stopped: { kind: "exhausted" } });
    // The owner still settles it, once.
    expect(a.settle(held.reservation, SPEND, true)).toBe(true);
    expect(a.settle(held.reservation, SPEND, true)).toBe(false);
  });

  it("does not wedge on a lock left by a process that has died", () => {
    const root = tempRoot();
    const dead = spawnSync(process.execPath, ["-e", ""]).pid;
    writeFileSync(
      join(root, MODEL_BUDGET_LOCK_FILE),
      `${JSON.stringify({ pid: dead, instanceId: randomUUID(), hostname: "gone", startedAt: T0 })}\n`,
    );
    expect(budgetAt(root, T0).reserve().ok).toBe(true);
  });

  it("refuses, rather than waits for ever, while a LIVE holder has the lock", () => {
    const root = tempRoot();
    writeFileSync(
      join(root, MODEL_BUDGET_LOCK_FILE),
      `${JSON.stringify({ pid: process.pid, instanceId: randomUUID(), hostname: "here", startedAt: T0 })}\n`,
    );
    expect(refusal(budgetAt(root, T0, { lockWaitMs: 0 }).reserve())).toMatchObject({ kind: "unavailable" });
  });
});

describe("what a person reads", () => {
  it("prints one line: today's calls and money against the ceiling", () => {
    const root = tempRoot();
    const budget = budgetAt(root, T0);
    const reserved = budget.reserve();
    if (!reserved.ok) throw new Error("expected a reservation");
    budget.settle(reserved.reservation, SPEND, true);
    expect(describeBudget(budget.read())).toBe("today: 1 call, $0.0004 of $1.50 ceiling");
  });

  it("says when it is cooling down, and until when", () => {
    const root = tempRoot();
    budgetAt(root, T0).strike("the gateway returned 429");
    expect(describeBudget(budgetAt(root, T0).read())).toContain("cooling down until 2026-09-10T12:15:00.000Z");
  });

  it("says when the day's ceiling is reached", () => {
    const root = tempRoot();
    initialisedWith(root, ledger(DAY, { calls: DAY_CEILING.calls }));
    const line = describeBudget(budgetAt(root, T0).read());
    expect(line).toContain(`today: ${DAY_CEILING.calls} calls`);
    expect(line).toContain("day ceiling reached");
  });
});

describe("the only way to a paid call", () => {
  it("is through this module: no other file under tools/ or scripts/ reaches `classifyTail`", () => {
    // D4: `--no-write` controls attention memory and nothing else, so a hand run
    // spends against the same ceiling as the daemon. That holds only while
    // nothing can reach the transport except through the budget — so it is
    // checked here as a fact about the tree rather than promised in a comment.
    const repo = join(import.meta.dirname, "..");
    const reaching: string[] = [];
    for (const top of ["tools", "scripts"]) {
      for (const entry of readdirSync(join(repo, top), { recursive: true, encoding: "utf8" })) {
        if (entry.includes("node_modules") || entry.includes("dist")) continue;
        if (!/\.tsx?$/.test(entry)) continue;
        const file = join(repo, top, entry);
        if (/\bclassifyTail\b/.test(readFileSync(file, "utf8"))) reaching.push(relative(repo, file));
      }
    }
    expect(reaching.sort()).toEqual(["tools/overseer/attention-classify.ts", "tools/overseer/model-budget.ts"]);
  });
});
