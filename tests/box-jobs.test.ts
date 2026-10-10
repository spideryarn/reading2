/**
 * The box's scheduled jobs that talk to the Overseer: box-health, the daily
 * worktree sweep, and the notifier they share. Plan
 * docs/plans/261010d-standing-jobs-survive-a-reboot.md.
 *
 * No network, no systemd, no tmux: `fetch` is a script, the health report and
 * the unit states are fixtures, and the state file is a temporary directory.
 * The route itself, with the real receipt journal, is driven by
 * tests/fleet-request-replay.test.ts § speaker box.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  BOX_MESSAGE_MAX,
  mintRequestId,
  oneLine,
  prepareEnvelope,
  readBoxAnswer,
  tellOverseerFromBox,
  type FetchLike,
} from "../scripts/box-notify.js";
import {
  alarmOf,
  decide,
  EMPTY_STATE,
  HOLD_RUNS,
  parseIsFailed,
  REMIND_MS,
  runOnce,
  settle,
  statePath,
  type BoxHealthState,
  type ReadyPending,
  type UnitsReading,
} from "../scripts/box-health.js";
import { deliverSweepPending, NAMED_MAX, queueSweepMessage, sweepMessage, unowned, unownedToSay, withoutUndelivered } from "../scripts/worktree-sweep-daily.js";
import type { SweepOutcome } from "../scripts/worktree-sweep.js";
import { parseRequestId } from "../tools/fleet/receipt-journal.js";
import { parseMessageBody, parseMessageSpeaker } from "../tools/fleet/routes-steer.js";
import type { HealthReport } from "../tools/fleet/health.js";

const NOW_ISO = "2026-10-10T02:00:00.000Z";
const NOW = Date.parse(NOW_ISO);

const overseer = {
  id: "$2514",
  name: "Overseer",
  paneId: "%2517",
  panePid: 4039570,
  claudeSessionId: "5b0c7e21-3a4d-4f6e-9c8b-2d1e0f9a7b64",
  status: { kind: "working" },
  role: { kind: "overseer" },
};
const SNAPSHOT = { schema: 1, error: null, collectedAt: NOW_ISO, servedAt: NOW_ISO, rows: [overseer] };

type Answer = "throw" | { status: number; body: unknown };

/** A fetch that serves the snapshot for GET /api/state and the scripted answers, in order, for each POST. */
function scriptedFetch(posts: Answer[], state: Answer = { status: 200, body: SNAPSHOT }): { fetch: FetchLike; posted: string[] } {
  const posted: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    const answer = url.endsWith("/api/state") ? state : posts.shift();
    if (init?.method === "POST") posted.push(init.body ?? "");
    if (answer === undefined) throw new Error("the script ran out of answers");
    if (answer === "throw") throw new Error("socket hang up");
    return { status: answer.status, text: async () => JSON.stringify(answer.body) };
  };
  return { fetch, posted };
}

const SENT = { status: 200, body: { ok: true, op: "message", verified: {}, sent: [["send-keys", "-t", "%2517", "-l", "--", "x"]] } };
const replay = (state: string, pending = false) => ({ status: 200, body: { ok: true, op: "receipt", replay: true, receipt: { state, pending } } });

/* ------------------------------------------------------------------ */
/* box-notify                                                          */
/* ------------------------------------------------------------------ */

describe("box-notify", () => {
  it("makes one line the route will take: no control characters, capped", () => {
    expect(oneLine("a\nb\tc\u007fd")).toBe("a b c d");
    const long = oneLine("x".repeat(BOX_MESSAGE_MAX * 2));
    expect(long).toHaveLength(BOX_MESSAGE_MAX);
    expect(long.endsWith("…")).toBe(true);
  });

  it("mints a request id the receipt journal parses, carrying its mint time", () => {
    expect(parseRequestId(mintRequestId(NOW), NOW)).toEqual({ ok: true, mintedAt: NOW });
  });

  it("addresses the Overseer's row as speaker box, which the message route accepts", async () => {
    const { fetch } = scriptedFetch([]);
    const prepared = await prepareEnvelope("disk\nfull", { fetch, now: () => NOW });
    if (prepared.kind !== "ready") throw new Error(prepared.why);
    expect(prepared.to).toBe("Overseer");
    expect(prepared.envelope).toMatchObject({ speaker: "box", text: "disk full", sessionId: "$2514", paneId: "%2517" });
    expect(parseMessageBody(prepared.envelope)).toMatchObject({ ok: true, value: { speaker: "box", text: "disk full" } });
  });

  it("names every allowed message speaker in an invalid-speaker refusal", () => {
    expect(parseMessageSpeaker("timer")).toMatchObject({
      ok: false,
      why: expect.stringContaining("'box'"),
    });
  });

  it("is not-sent, never uncertain, when the dashboard cannot be read or nobody holds the claim", async () => {
    expect((await prepareEnvelope("x", { fetch: scriptedFetch([], "throw").fetch })).kind).toBe("not-sent");
    const noClaim = { ...SNAPSHOT, rows: [{ ...overseer, role: { kind: "none" } }] };
    expect((await prepareEnvelope("x", { fetch: scriptedFetch([], { status: 200, body: noClaim }).fetch })).kind).toBe("not-sent");
  });

  it("reads each answer the route can give", () => {
    const read = (a: { status: number; body: unknown }) => readBoxAnswer(a.status, JSON.stringify(a.body), "Overseer").kind;
    expect(read(SENT)).toBe("sent");
    expect(read(replay("keys-submitted"))).toBe("sent");
    expect(read(replay("completed"))).toBe("sent");
    expect(read(replay("not-sent"))).toBe("not-sent");
    expect(read(replay("attempted", true))).toBe("uncertain");
    expect(read(replay("outcome-unknown"))).toBe("uncertain");
    expect(read({ status: 409, body: { ok: false, code: "request-id-expired", why: "too old" } })).toBe("abandoned");
    expect(read({ status: 409, body: { ok: false, code: "request-id-conflict", why: "different body" } })).toBe("abandoned");
    expect(read({ status: 409, body: { ok: false, code: "input-not-empty", why: "typing", delivery: "none" } })).toBe("not-sent");
    expect(read({ status: 429, body: { ok: false, code: "rate-limited", why: "slow down", delivery: "none" } })).toBe("not-sent");
    expect(read({ status: 429, body: { ok: false, code: "rate-limited", why: "old server" } })).toBe("uncertain");
    expect(read({ status: 500, body: { ok: false, code: "transport", why: "partway", delivery: "partial" } })).toBe("uncertain");
    expect(readBoxAnswer(502, "<html>bad gateway</html>", "Overseer").kind).toBe("uncertain");
  });

  it("retries an uncertain post with the SAME envelope, byte for byte", async () => {
    const { fetch, posted } = scriptedFetch(["throw", replay("keys-submitted")]);
    const outcome = await tellOverseerFromBox("swap critical", { fetch, now: () => NOW, gapMs: 0 });
    expect(outcome).toEqual({ kind: "sent", to: "Overseer" });
    expect(posted).toHaveLength(2);
    expect(posted[1]).toBe(posted[0]);
  });

  it("stops at the first answer that is not uncertain", async () => {
    const { fetch, posted } = scriptedFetch([{ status: 409, body: { ok: false, code: "busy", why: "dialog open", delivery: "none" } }]);
    expect((await tellOverseerFromBox("x", { fetch, gapMs: 0 })).kind).toBe("not-sent");
    expect(posted).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* box-health                                                          */
/* ------------------------------------------------------------------ */

type Report = Pick<HealthReport, "verdict" | "disk" | "homeDisk">;

function report(over: { level?: HealthReport["verdict"]["level"]; root?: number; home?: number; reasons?: string[] } = {}): Report {
  const disk = (usePercent: number) => ({ kind: "value" as const, totalKiB: 100, usedKiB: usePercent, availableKiB: 100 - usePercent, usePercent });
  return {
    verdict: { level: over.level ?? "ok", reasons: over.reasons ?? ["load, memory and swap all look fine"] },
    disk: disk(over.root ?? 66),
    homeDisk: disk(over.home ?? 53),
  };
}
const NO_FAILED: UnitsReading = { kind: "read", failed: [] };

describe("box-health: what counts as an alarm", () => {
  it("is silent on strained, which the box spends most of its time in", () => {
    expect(alarmOf(report({ level: "strained", reasons: ["actively swapping"] }), NO_FAILED).keys).toEqual([]);
  });

  it("alarms on critical and unknown verdicts", () => {
    expect(alarmOf(report({ level: "critical" }), NO_FAILED).keys).toEqual(["critical"]);
    expect(alarmOf(report({ level: "unknown" }), NO_FAILED).keys).toEqual(["unknown"]);
  });

  it("alarms on either disk at the policy's strained cutoff, whatever the overall verdict", () => {
    expect(alarmOf(report({ level: "strained", root: 90 }), NO_FAILED).keys).toEqual(["disk:/"]);
    expect(alarmOf(report({ home: 89 }), NO_FAILED).keys).toEqual([]);
    expect(alarmOf(report({ home: 92 }), NO_FAILED).keys).toEqual(["disk:/home"]);
  });

  it("alarms on a failed box unit, and on not being able to tell", () => {
    const a = alarmOf(report(), { kind: "read", failed: ["dashboard-refresh.service"] });
    expect(a.keys).toEqual(["failed:dashboard-refresh.service"]);
    expect(a.reasons.join(" ")).toContain("journalctl -u dashboard-refresh.service");
    expect(alarmOf(report(), { kind: "cannot-tell", why: "no systemctl" }).keys).toEqual(["units:cannot-tell"]);
  });

  it("reads systemctl is-failed by position, and a short answer as cannot-tell", () => {
    expect(parseIsFailed("active\nfailed\ninactive\n", ["a", "b", "c"])).toEqual({ kind: "read", failed: ["b"] });
    expect(parseIsFailed("active\n", ["a", "b"]).kind).toBe("cannot-tell");
    expect(parseIsFailed("active\nunknown\n", ["a", "b"]).kind).toBe("cannot-tell");
  });
});

describe("box-health: when to say it", () => {
  const said = (keys: BoxHealthState["said"]["keys"], at = NOW_ISO) => ({ said: { keys, at }, shrinkRuns: 0 });
  const alarm = (...keys: BoxHealthState["said"]["keys"]) => ({ keys, reasons: ["r"] });

  it("says nothing when nothing alarms and nothing was said", () => {
    expect(decide(alarm(), "ok", EMPTY_STATE, NOW).decision.kind).toBe("silent");
  });

  it("says a new alarm at once, and says it again only after a day", () => {
    expect(decide(alarm("critical"), "critical", EMPTY_STATE, NOW).decision.kind).toBe("alarm");
    expect(decide(alarm("critical"), "critical", said(["critical"]), NOW + REMIND_MS - 1).decision.kind).toBe("silent");
    expect(decide(alarm("critical"), "critical", said(["critical"]), NOW + REMIND_MS).decision.kind).toBe("reminder");
  });

  it("says a key it has not said yet at once, even inside a running alarm", () => {
    expect(decide(alarm("critical", "disk:/home"), "critical", said(["critical"]), NOW).decision.kind).toBe("alarm");
  });

  it(`says all clear only after ${HOLD_RUNS} clear runs in a row, so a flapping reading is one message`, () => {
    let state = said(["critical"]);
    for (let i = 1; i < HOLD_RUNS; i++) {
      const r = decide(alarm(), "strained", state, NOW);
      expect(r.decision.kind).toBe("silent");
      state = { ...state, shrinkRuns: r.shrinkRuns };
    }
    // A relapse resets the count without a message.
    const relapse = decide(alarm("critical"), "critical", state, NOW);
    expect(relapse).toEqual({ decision: { kind: "silent" }, shrinkRuns: 0 });
    state = { ...state, shrinkRuns: HOLD_RUNS - 1 };
    expect(decide(alarm(), "ok", state, NOW).decision.kind).toBe("clear");
  });

  it("settles a post: sent and abandoned count as said, not-sent keeps the intent, uncertain keeps the envelope", () => {
    const pending: ReadyPending = { phase: "ready", text: "alarm", envelope: {} as ReadyPending["envelope"], to: "Overseer", says: { keys: ["critical"], at: NOW_ISO } };
    const s: BoxHealthState = { ...EMPTY_STATE, pending };
    expect(settle(s, pending, { kind: "sent", to: "Overseer" })).toMatchObject({ said: pending.says, pending: null });
    expect(settle(s, pending, { kind: "abandoned", why: "" })).toMatchObject({ said: pending.says, pending: null });
    expect(settle(s, pending, { kind: "not-sent", why: "" })).toMatchObject({ said: EMPTY_STATE.said, pending: { phase: "waiting", text: "alarm" } });
    expect(settle(s, pending, { kind: "uncertain", why: "" }).pending).toBe(pending);
  });
});

describe("box-health: a run, end to end", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop() ?? "", { recursive: true, force: true });
  });
  function deps(r: Report, fetch: FetchLike, lines: string[]) {
    const dir = mkdtempSync(path.join(tmpdir(), "box-health-"));
    dirs.push(dir);
    return { collect: () => r, units: () => NO_FAILED, file: path.join(dir, "state.json"), now: () => NOW, notify: { fetch }, notifyEnabled: true, log: (l: string) => lines.push(l) };
  }

  it("is silent and exits 0 on a healthy box with nothing said", async () => {
    const { fetch, posted } = scriptedFetch([]);
    const lines: string[] = [];
    expect(await runOnce(deps(report({ level: "strained" }), fetch, lines))).toBe(0);
    expect(posted).toEqual([]);
    expect(lines).toHaveLength(1);
  });

  it("says an alarm once, then nothing on the next run while it holds", async () => {
    const { fetch, posted } = scriptedFetch([SENT]);
    const d = deps(report({ level: "critical", reasons: ["swap is 99% full"] }), fetch, []);
    expect(await runOnce(d)).toBe(1);
    expect(posted).toHaveLength(1);
    expect(JSON.parse(posted[0] ?? "{}")).toMatchObject({ speaker: "box" });
    expect(JSON.parse(readFileSync(d.file, "utf8"))).toMatchObject({ said: { keys: ["critical"] }, pending: null });
    expect(await runOnce(d)).toBe(1);
    expect(posted).toHaveLength(1);
  });

  it("keeps an uncertain message and resends the SAME envelope next run, deciding nothing new meanwhile", async () => {
    const { fetch, posted } = scriptedFetch(["throw", replay("keys-submitted")]);
    const d = deps(report({ level: "critical" }), fetch, []);
    expect(await runOnce(d)).toBe(1);
    expect(JSON.parse(readFileSync(d.file, "utf8")).pending).not.toBeNull();
    expect(await runOnce(d)).toBe(1);
    expect(posted).toHaveLength(2);
    expect(posted[1]).toBe(posted[0]);
    expect(JSON.parse(readFileSync(d.file, "utf8"))).toMatchObject({ said: { keys: ["critical"] }, pending: null });
  });

  it("writes the envelope down BEFORE posting it", async () => {
    let seenOnDisk: unknown;
    const lines: string[] = [];
    const holder: { file: string } = { file: "" };
    const fetch: FetchLike = async (url) => {
      if (url.endsWith("/api/state")) return { status: 200, text: async () => JSON.stringify(SNAPSHOT) };
      seenOnDisk = JSON.parse(readFileSync(holder.file, "utf8")).pending?.envelope?.requestId;
      return { status: 200, text: async () => JSON.stringify(SENT.body) };
    };
    const d = deps(report({ level: "unknown" }), fetch, lines);
    holder.file = d.file;
    await runOnce(d);
    expect(typeof seenOnDisk).toBe("string");
  });

  it("does not post when the pending intent cannot be written", async () => {
    const { fetch, posted } = scriptedFetch([SENT]);
    const d = deps(report({ level: "critical" }), fetch, []);
    const blocker = path.join(path.dirname(d.file), "not-a-directory");
    writeFileSync(blocker, "x");
    d.file = path.join(blocker, "state.json");
    expect(await runOnce(d)).toBe(1);
    expect(posted).toEqual([]);
  });

  it("fails closed on corrupt state instead of risking a duplicate", async () => {
    const { fetch, posted } = scriptedFetch([SENT]);
    const d = deps(report({ level: "critical" }), fetch, []);
    writeFileSync(d.file, "not json\n");
    expect(await runOnce(d)).toBe(1);
    expect(posted).toEqual([]);
  });

  it("keeps a transient alarm while the dashboard is down and delivers it after health clears", async () => {
    let stateReads = 0;
    const posted: string[] = [];
    const fetch: FetchLike = async (url, init) => {
      if (url.endsWith("/api/state")) {
        stateReads++;
        if (stateReads === 1) throw new Error("dashboard down");
        return { status: 200, text: async () => JSON.stringify(SNAPSHOT) };
      }
      posted.push(init?.body ?? "");
      return { status: 200, text: async () => JSON.stringify(SENT.body) };
    };
    const d = deps(report({ level: "critical" }), fetch, []);
    expect(await runOnce(d)).toBe(1);
    expect(JSON.parse(readFileSync(d.file, "utf8"))).toMatchObject({ pending: { phase: "waiting" } });
    d.collect = () => report();
    expect(await runOnce(d)).toBe(0);
    expect(posted).toHaveLength(1);
    expect(JSON.parse(posted[0] ?? "{}").text).toContain("box health ALARM");
  });

  it("an undelivered all-clear is retried on the very next run", async () => {
    const { fetch, posted } = scriptedFetch([{ status: 409, body: { ok: false, code: "busy", why: "dialog", delivery: "none" } }, SENT]);
    const d = deps(report(), fetch, []);
    const { writeState } = await import("../scripts/box-health.js");
    writeState(d.file, { said: { keys: ["critical"], at: NOW_ISO }, shrinkRuns: HOLD_RUNS - 1, pending: null });
    expect(await runOnce(d)).toBe(1);
    expect(await runOnce(d)).toBe(0);
    expect(posted).toHaveLength(2);
    expect(JSON.parse(readFileSync(d.file, "utf8"))).toMatchObject({ said: { keys: [] } });
  });
});

/* ------------------------------------------------------------------ */
/* the daily worktree sweep                                            */
/* ------------------------------------------------------------------ */

describe("worktree-sweep-daily", () => {
  const removed = (name: string): SweepOutcome => ({ kind: "removed", name, steps: ["removed"] });
  const look = (name: string): SweepOutcome => ({ kind: "needs-a-look", name, reasons: ["3 uncommitted or untracked files"] });
  const owned = (name: string): SweepOutcome => ({
    kind: "in-use",
    name,
    reasons: ["its Claude session is still running — x, pid 1 (claude)", "a process is running inside it — pid 1 (claude)"],
  });
  const leftover = (name: string): SweepOutcome => ({ kind: "in-use", name, reasons: ["a process is running inside it — pid 9 (vite)"] });

  it("calls an in-use tree unowned only when no live Claude session holds it", () => {
    expect(unowned(owned("a"))).toBe(false);
    expect(unowned(leftover("b"))).toBe(true);
    expect(unowned(look("c"))).toBe(false);
  });

  it("says an unowned in-use tree once, on the second sweep in a row that finds it", () => {
    const day1 = unownedToSay([leftover("dev-server")], { seen: [], said: [] });
    expect(day1.say).toEqual([]);
    const day2 = unownedToSay([leftover("dev-server")], day1.next);
    expect(day2.say.map((o) => o.name)).toEqual(["dev-server"]);
    const day3 = unownedToSay([leftover("dev-server")], day2.next);
    expect(day3.say).toEqual([]);
    // Gone, then back: a new episode, said again on its own second day.
    const gone = unownedToSay([], day3.next);
    expect(gone.next).toEqual({ seen: [], said: [] });
  });

  it("does not consume the once-only state when notification is disabled", () => {
    const say = [leftover("dev-server")];
    expect(withoutUndelivered({ seen: ["dev-server"], said: ["dev-server", "already-said"] }, say)).toEqual({
      seen: ["dev-server"],
      said: ["already-said"],
    });
  });

  it("says nothing when every tree was removed or is held by a live session", () => {
    expect(sweepMessage([removed("a"), owned("b")], [])).toBeNull();
  });

  it("names what needs judging, how many were removed, and the next step", () => {
    const text = sweepMessage([removed("a"), look("b")], [leftover("c")]) ?? "";
    expect(text).toContain("removed 1");
    expect(text).toContain("b (needs-a-look: 3 uncommitted or untracked files)");
    expect(text).toContain("c (in-use: a process is running inside it");
    expect(text).toContain("worktree:check");
    expect(text).not.toMatch(/[\n\r]/);
  });

  it(`names at most ${NAMED_MAX} trees and counts the rest`, () => {
    const many = Array.from({ length: NAMED_MAX + 3 }, (_, i) => look(`t${i}`));
    expect(sweepMessage(many, [])).toContain(", and 3 more");
  });

  it("persists the sweep's exact envelope and reuses it after an uncertain post", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sweep-delivery-"));
    try {
      const file = path.join(dir, "state.json");
      const { fetch, posted } = scriptedFetch(["throw", replay("keys-submitted")]);
      const first = await queueSweepMessage(file, { seen: [], said: [] }, "needs judging", { seen: ["a"], said: ["a"] }, { fetch, now: () => NOW, tries: 1, gapMs: 0 }, () => {});
      expect(first.outcome.kind).toBe("uncertain");
      const onDisk = JSON.parse(readFileSync(file, "utf8"));
      expect(onDisk.pending.phase).toBe("ready");
      const second = await deliverSweepPending(file, onDisk, { fetch, tries: 1, gapMs: 0 }, () => {});
      expect(second.outcome.kind).toBe("sent");
      expect(posted).toHaveLength(2);
      expect(posted[1]).toBe(posted[0]);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ seen: ["a"], said: ["a"], pending: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not post a sweep message when its pending intent cannot be written", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sweep-delivery-"));
    try {
      const blocker = path.join(dir, "not-a-directory");
      writeFileSync(blocker, "x");
      const { fetch, posted } = scriptedFetch([SENT]);
      await expect(queueSweepMessage(path.join(blocker, "state.json"), { seen: [], said: [] }, "x", { seen: [], said: [] }, { fetch }, () => {})).rejects.toThrow();
      expect(posted).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ */
/* dashboard refresh shell wrapper                                    */
/* ------------------------------------------------------------------ */

describe("dashboard-refresh", () => {
  const roots: string[] = [];
  afterEach(() => {
    while (roots.length > 0) rmSync(roots.pop() ?? "", { recursive: true, force: true });
  });

  function executable(file: string, body: string): void {
    writeFileSync(file, `#!/bin/bash\n${body}\n`);
    chmodSync(file, 0o755);
  }

  function runRefresh(gitBody: string, arrange?: (home: string, bin: string) => void) {
    const root = mkdtempSync(path.join(tmpdir(), "dashboard-refresh-"));
    roots.push(root);
    const home = path.join(root, "home");
    const repo = path.join(home, "code", "spideryarn2");
    const bin = path.join(root, "bin");
    mkdirSync(path.join(repo, "node_modules", ".bin"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    executable(path.join(bin, "git"), gitBody);
    const marker = path.join(root, "restart-ran");
    executable(path.join(repo, "node_modules", ".bin", "tsx"), 'printf ran > "$MARKER"');
    arrange?.(home, bin);
    const result = spawnSync("/bin/bash", [path.join(process.cwd(), "scripts", "overseer-tools", "dashboard-refresh.sh")], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, HOME: home, PATH: `${bin}:/usr/bin:/bin`, MARKER: marker },
    });
    return { ...result, marker };
  }

  it("fails instead of restarting when rev-list cannot compare the fetched ref", () => {
    const ran = runRefresh(`
case "$1" in
  rev-parse) exit 1 ;;
  fetch) exit 0 ;;
  rev-list) exit 7 ;;
esac
exit 0`);
    expect(ran.status).toBe(1);
    expect(ran.stdout).toContain("could not compare HEAD with origin/dev");
    expect(() => readFileSync(ran.marker)).toThrow();
  });

  it("distinguishes a git diff error from changed inputs", () => {
    const ran = runRefresh(`
case "$1" in
  rev-parse) if [ "$2" = "-q" ]; then exit 1; fi; echo head-new; exit 0 ;;
  fetch) exit 0 ;;
  rev-list) echo 0; exit 0 ;;
  cat-file) exit 0 ;;
  diff) exit 128 ;;
esac
exit 0`, (home) => {
      mkdirSync(path.join(home, ".overseer"), { recursive: true });
      writeFileSync(path.join(home, ".overseer", "dashboard-refresh-last-sha"), "head-old\n");
    });
    expect(ran.status).toBe(1);
    expect(ran.stdout).toContain("could not compare build inputs");
    expect(() => readFileSync(ran.marker)).toThrow();
  });

  it("fails closed when the last-served state cannot be read", () => {
    const ran = runRefresh(`
case "$1" in
  rev-parse) if [ "$2" = "-q" ]; then exit 1; fi; echo head-new; exit 0 ;;
  fetch) exit 0 ;;
  rev-list) echo 0; exit 0 ;;
esac
exit 0`, (home) => {
      mkdirSync(path.join(home, ".overseer", "dashboard-refresh-last-sha"), { recursive: true });
    });
    expect(ran.status).toBe(1);
    expect(ran.stdout).toContain("could not read last-served state");
    expect(() => readFileSync(ran.marker)).toThrow();
  });

  it("fails after a successful restart when its served-commit state cannot be saved", () => {
    const ran = runRefresh(`
case "$1" in
  rev-parse) if [ "$2" = "-q" ]; then exit 1; fi; echo head-new; exit 0 ;;
  fetch) exit 0 ;;
  rev-list) echo 0; exit 0 ;;
  diff) exit 0 ;;
esac
exit 0`, (_home, bin) => {
      executable(path.join(bin, "mv"), "exit 1");
    });
    expect(readFileSync(ran.marker, "utf8")).toBe("ran");
    expect(ran.status).toBe(1);
    expect(ran.stdout).toContain("served-commit state could not be saved");
  });
});

describe("box-health: where its state lives", () => {
  it("is systemd's StateDirectory on the root disk, so a full /home cannot silence the /home alarm", () => {
    // /home filled to 100% on 2026-10-05. A state file under ~/.overseer could
    // not then be written, and box-health posts nothing it cannot first record.
    expect(statePath({ STATE_DIRECTORY: "/var/lib/box-health" })).toBe("/var/lib/box-health/box-health.json");
    expect(statePath({ STATE_DIRECTORY: "/var/lib/box-health", BOX_HEALTH_STATE: "/x.json" })).toBe("/x.json");
  });

  it("the unit asks systemd for that directory", () => {
    const unit = readFileSync(path.join(__dirname, "..", "infra/hetzner/systemd/box-health.service"), "utf8");
    expect(unit).toMatch(/^StateDirectory=box-health$/m);
  });
});
