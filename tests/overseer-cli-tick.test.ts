/**
 * The Overseer's cheap screen, against a fake dashboard and captured usage
 * files only. Nothing in this suite is allowed to discover port 8787, tmux, or
 * Greg's real ~/.claude.json: a green test backed by the live box would change
 * its meaning every time an agent starts or stops.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { parseArgv } from "../scripts/overseer.js";
import type { HealthReport } from "../tools/fleet/health.js";
import { fetchLastLines, messagesUrl, plainTurnText } from "../tools/overseer/cli-messages.js";
import { directUsageLines, healthLines, tickLines } from "../tools/overseer/cli-tick.js";

const NOW = Date.parse("2026-09-08T12:00:00.000Z");
const USAGE_FIXTURES = resolve(import.meta.dirname, "fixtures/overseer-usage");
const fixture = (name: string): string => readFileSync(join(USAGE_FIXTURES, name), "utf8");
const HEALTH_FIXTURE: HealthReport = {
  load: { kind: "value", load1: 8, load5: 6, load15: 4, cores: 16, ratio1: 0.5 },
  memory: { kind: "value", totalBytes: 32 * 1024 ** 3, availableBytes: 12 * 1024 ** 3, availableFraction: 0.375 },
  swap: { kind: "value", totalBytes: 8 * 1024 ** 3, usedBytes: 2 * 1024 ** 3, usedFraction: 0.25, areas: 1 },
  disk: { kind: "value", totalKiB: 100, usedKiB: 40, availableKiB: 60, usePercent: 40 },
  swapActivity: { kind: "skipped" },
  attribution: { kind: "value", groups: [] },
  verdict: { level: "ok", reasons: ["fixture readings are below the warning thresholds"] },
  collectedAt: new Date(NOW).toISOString(),
  tookMs: 4,
};

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function storeWithMine(mine: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-tick-test-"));
  roots.push(root);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "cli-state.json"), `${JSON.stringify({ schema: 1, mine, paused: [] })}\n`);
  return root;
}

type Dashboard = { baseUrl: string; requests: string[]; fetchImpl: typeof fetch };

function fakeDashboard(hasClaim: boolean = true): Dashboard {
  const requests: string[] = [];
  const state = {
    schema: 1,
    collectedAt: new Date(NOW - 1_000).toISOString(),
    error: null,
    rows: [
      { id: "$10", name: "overseer-one", role: { kind: hasClaim ? "overseer" : "none" } },
      { id: "$20", name: "mine-agent", role: { kind: "none" } },
      { id: "$30", name: "untracked-agent", role: { kind: "none" } },
    ],
  };
  const fetchImpl: typeof fetch = async (input) => {
    const absolute = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(absolute);
    const requested = `${url.pathname}${url.search}`;
    requests.push(requested);
    if (requested === "/api/state") return new Response(JSON.stringify(state), { status: 200 });
    if (requested.startsWith("/api/messages?id=%24")) {
      return new Response(JSON.stringify({
        kind: "found",
        path: "/fixture/transcript.jsonl",
        turns: [
          { speaker: "human", at: "2026-09-08T11:55:00.000Z", text: "Please check it." },
          { speaker: "assistant", at: "2026-09-08T11:56:00.000Z", text: "Checked the fixture and the requested stage is ready." },
        ],
        reachedStartOfFile: true,
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ kind: "not-found", reason: "bad-id", why: `unexpected fixture request ${requested}` }), { status: 400 });
  };
  return { baseUrl: "http://fixture.invalid", requests, fetchImpl };
}

describe("last", () => {
  test("percent-encodes tmux's $ exactly at the HTTP boundary", async () => {
    // MUTATION: interpolate the raw id instead of encodeURIComponent(id); the
    // server takes its bad-id arm and this assertion sees no %24 request.
    const dashboard = fakeDashboard();
    expect(messagesUrl(dashboard.baseUrl, "$20")).toBe(`${dashboard.baseUrl}/api/messages?id=%2420`);
    const lines = await fetchLastLines(dashboard.baseUrl, "mine-agent", 2, dashboard.fetchImpl);
    expect(lines.join("\n")).toContain("11:56 assistant  Checked the fixture");
    expect(dashboard.requests).toContain("/api/messages?id=%2420");
    expect(dashboard.requests).not.toContain("/api/messages?id=$20");
  });

  test("prints time and speaker for the requested number of turns", async () => {
    const dashboard = fakeDashboard();
    const one = await fetchLastLines(dashboard.baseUrl, "mine-agent", 1, dashboard.fetchImpl);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatch(/^11:56 assistant {2}/);
  });

  test("keeps another agent's words one short plain-text line", () => {
    const rendered = plainTurnText(`first\n\u001b[31m${"x".repeat(300)}`);
    expect(rendered).not.toContain("\n");
    expect(rendered).not.toContain("\u001b");
    expect(rendered.length).toBe(220);
    expect(rendered.endsWith("…")).toBe(true);
  });
});

describe("the direct usage cache", () => {
  test("an absent cache is unknown and never zero", () => {
    // MUTATION: return a fabricated zero-valued cache from parseUsageCache's
    // absent arm; this must find 0% and lose the required unknown.
    const lines = directUsageLines(JSON.parse(fixture("claude-json-no-cache.json")) as unknown, NOW).join("\n");
    expect(lines).toContain("unknown");
    expect(lines).not.toMatch(/\b0%/);
  });

  test("dates a stale cache on the same line as every surviving number", () => {
    // MUTATION: remove the cache-age phrase from value-window rendering; the
    // seven-day assertion below is the one that must redden.
    const lines = directUsageLines(JSON.parse(fixture("claude-json-stale.json")) as unknown, NOW);
    expect(lines.find((line) => line.includes("seven_day:"))).toMatch(/\d+% used.*cache 48m old/);
    const fiveHour = lines.find((line) => line.includes("five_hour:"));
    expect(fiveHour).toContain("unknown");
    expect(fiveHour).toContain("threshold band unknown");
    expect(fiveHour).not.toContain("70%");
  });

  test("prints all three thresholds and the current band", () => {
    const lines = directUsageLines(JSON.parse(fixture("claude-json-real.json")) as unknown, NOW).join("\n");
    expect(lines).toContain("55 = pause the rest of anything new");
    expect(lines).toContain("70 = pause peers and roadmap work");
    expect(lines).toContain("85 = ease off everything");
    expect(lines).toContain("below 55");
  });
});

describe("tick", () => {
  test("states memory as percent used, never as what remains", () => {
    const screen = healthLines(HEALTH_FIXTURE).join("\n");
    expect(screen).toContain("memory      62.5% used · 20.0 GiB of 32.0 GiB in use");
    expect(screen).not.toContain("available of");
  });

  test("names mine sessions missing from the snapshot and every session it deliberately did not fetch", async () => {
    // MUTATION: replace the missing-mine branch with `continue`; dead-agent's
    // line disappears and this assertion reddens rather than showing a quiet fleet.
    const dashboard = fakeDashboard();
    const root = storeWithMine(["mine-agent", "dead-agent"]);
    const lines = await tickLines({
      root,
      baseUrl: dashboard.baseUrl,
      claudeJson: fixture("claude-json-real.json"),
      nowMs: NOW,
      fetchImpl: dashboard.fetchImpl,
      collectHealth: () => HEALTH_FIXTURE,
    });
    const screen = lines.join("\n");
    expect(screen).toContain("OVERSEER CLAIM: HELD BY overseer-one ($10)");
    expect(screen).toContain("mine-agent ($20)");
    expect(screen).toContain("dead-agent — NOT IN THE FLEET SNAPSHOT");
    // The skipped names are on one collapsed line rather than one line each —
    // thirteen of them pushed the register and the inbox off the screen — but
    // EVERY skipped name is still printed and still counted, which is the whole
    // guarantee. Asserting the names rather than the layout is what lets the
    // line be reshaped without weakening the check.
    expect(screen).toContain("not fetched  2 session(s), not in mine:");
    expect(screen).toContain("overseer-one ($10)");
    expect(screen).toContain("untracked-agent ($30)");
  });

  test("an unreadable mine list does not read as a quiet fleet", async () => {
    // The two ways a name reaches the skipped line are not the same fact: "not
    // in mine" is a choice, and "the list could not be read" means nothing was
    // fetched for ANYBODY. Collapsing them into one sentence would hide a broken
    // tick behind a quiet-looking one.
    //
    // MUTATION: use the same wording for both branches and this goes red.
    const dashboard = fakeDashboard();
    const root = storeWithMine(["mine-agent"]);
    writeFileSync(join(root, "cli-state.json"), "{not json", "utf8");
    const lines = await tickLines({
      root,
      baseUrl: dashboard.baseUrl,
      claudeJson: fixture("claude-json-real.json"),
      nowMs: NOW,
      fetchImpl: dashboard.fetchImpl,
      collectHealth: () => HEALTH_FIXTURE,
    });
    const screen = lines.join("\n");
    expect(screen).toContain("mine         COULD NOT TELL");
    expect(screen).toContain("mine list unreadable, so nothing was fetched for anybody");
    expect(screen).not.toContain("not in mine:");
  });

  test("a failed section stays local and later sections still print", async () => {
    // MUTATION: rethrow the health failure from its section catch; usage and
    // session output below disappear, making both positive controls fail.
    const dashboard = fakeDashboard();
    const root = storeWithMine(["mine-agent"]);
    const lines = await tickLines({
      root,
      baseUrl: dashboard.baseUrl,
      claudeJson: fixture("claude-json-real.json"),
      nowMs: NOW,
      fetchImpl: dashboard.fetchImpl,
      collectHealth: () => {
        throw new Error("fixture health collector broke");
      },
    });
    const screen = lines.join("\n");
    expect(screen).toContain("box health  COULD NOT TELL — fixture health collector broke");
    expect(screen).toContain("five_hour:");
    expect(screen).toContain("mine-agent ($20)");
    expect(screen).toContain("Checked the fixture");
  });

  test("says loudly when nobody holds the Overseer claim", async () => {
    const dashboard = fakeDashboard(false);
    const lines = await tickLines({
      root: storeWithMine([]),
      baseUrl: dashboard.baseUrl,
      claudeJson: fixture("claude-json-real.json"),
      nowMs: NOW,
      fetchImpl: dashboard.fetchImpl,
      collectHealth: () => HEALTH_FIXTURE,
    });
    expect(lines[1]).toBe("== OVERSEER CLAIM: NO ONE HOLDS IT — take the claim before acting");
  });
});

describe("Commander wiring", () => {
  test("parses tick and last, including last's positive whole-turn bound", () => {
    expect(parseArgv(["tick"])).toEqual({ kind: "run", parsed: { command: "tick" } });
    expect(parseArgv(["last", "mine-agent"])).toEqual({
      kind: "run",
      parsed: { command: "last", session: "mine-agent", turns: 1 },
    });
    expect(parseArgv(["last", "mine-agent", "--turns", "3"])).toEqual({
      kind: "run",
      parsed: { command: "last", session: "mine-agent", turns: 3 },
    });
    expect(parseArgv(["last", "mine-agent", "--turns", "0"]).kind).toBe("error");
    expect(parseArgv(["last", "mine-agent", "--turns", "1.5"]).kind).toBe("error");
  });
});
