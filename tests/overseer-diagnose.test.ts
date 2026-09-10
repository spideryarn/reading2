/**
 * `overseer diagnose` — one page that says which revision each service is
 * running, which checkpoint schema, how old each clock is, and whether the
 * daemon holds the job list this checkout builds. docs/plans/260910f Stage 2.
 *
 * **The store under test is written by the real daemon** (`runOverseer` over a
 * scripted source, the pattern `overseer-daemon.test.ts` uses), because a
 * hand-built checkpoint agrees with a hand-written reader by construction. The
 * controls are the ones a careless page would get wrong: a stopped daemon read
 * as healthy, an unreadable checkpoint read as absent, a torn log read as
 * whole, a dirty start read as "same", and an unstamped start read as anything
 * but "not stamped". Every root is a temp directory; `~/.overseer` is never read.
 */
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import { runOverseer } from "../tools/overseer/daemon.js";
import {
  diagnose,
  diagnoseLines,
  readDiagnoseInput,
  type DiagnoseDeps,
  type DiagnoseInput,
  type GitReads,
  type RevisionRelation,
} from "../tools/overseer/diagnose.js";
import { NOTES_FILE } from "../tools/overseer/notes.js";
import { CHECKPOINT_FILE, EVENTS_FILE, readCheckpoint } from "../tools/overseer/store.js";
import type { SourceMessage } from "../tools/overseer/source.js";
import type { JsonValue } from "../tools/overseer/observation.js";
import type { StartRevision } from "../tools/fleet/wire.js";
import { parseArgv, runParsed } from "../scripts/overseer.js";
import { rawFixture } from "./overseer-fixtures.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-diagnose-test-"));
  roots.push(root);
  return root;
}

/* ── Copied from overseer-daemon.test.ts :51–121, trimmed: a scripted source and a hand-moved clock. ── */

function fakeClock(startIso: string): { now: () => Date; advance(ms: number): void; ms(): number } {
  let ms = Date.parse(startIso);
  return { now: () => new Date(ms), advance: (by) => (ms += by), ms: () => ms };
}

function payload(json: JsonValue, via: "sse" | "poll" = "sse"): SourceMessage {
  return { kind: "payload", via, atMs: 0, json };
}

const START_SHA = "5d0c1e9a7b3f24681357924680ace13579bdf024";
const HEAD_SHA = "a1f0e2d3c4b5a6978877665544332211ffeeddcc";
const BOOT = "0b6f2c1e-4a8d-4f3b-9e27-6d5c3a1b0f9e";
const OTHER_BOOT = "7e3a9d52-1c64-48b0-a2f7-93e5d8c61b04";

const CLEAN_START: StartRevision = { kind: "known", sha: START_SHA, dirty: false, readAt: "2026-09-08T02:48:39.000Z" };

/** The real daemon over two real captures, stopped when the script runs out. */
async function daemonStore(revision: StartRevision = CLEAN_START): Promise<{ root: string; clock: ReturnType<typeof fakeClock> }> {
  const root = tempRoot();
  const clock = fakeClock("2026-09-08T02:48:40.000Z");
  const outcome = await runOverseer({
    root,
    baseUrl: "http://127.0.0.1:0",
    signal: new AbortController().signal,
    now: clock.now,
    tickMs: 5,
    log: () => undefined,
    revision,
    bootId: () => BOOT,
    source: async function* () {
      yield payload(rawFixture("session-new-before"));
      yield payload(rawFixture("session-new-after"));
    },
  });
  expect(outcome.kind).toBe("stopped");
  return { root, clock };
}

/** git as a table: HEAD is one sha, and each start sha relates to it one way. */
function fakeGit(head: string | { why: string }, relations: Record<string, RevisionRelation> = {}): GitReads {
  return {
    head: () => (typeof head === "string" ? { kind: "known", sha: head } : { kind: "unknown", why: head.why }),
    relate: (start, headSha) => (start === headSha ? { kind: "same" } : (relations[start] ?? { kind: "unknown", why: `no relation scripted for ${start}` })),
  };
}

function inputFor(root: string, nowMs: number, overrides: DiagnoseDeps = {}): DiagnoseInput {
  const read = readDiagnoseInput(root, {
    now: () => new Date(nowMs),
    alive: () => true,
    hostBootId: () => BOOT,
    git: fakeGit(START_SHA),
    builtListRevision: () => "list-built-here",
    ...overrides,
  });
  if (!read.ok) throw new Error(read.why);
  return read.input;
}

function rewriteLines(path: string, change: (record: Record<string, unknown>) => Record<string, unknown> | null): void {
  const lines = readFileSync(path, "utf8").split("\n").filter((line) => line !== "");
  const kept = lines.map((line) => change(JSON.parse(line) as Record<string, unknown>)).filter((r) => r !== null);
  writeFileSync(path, kept.map((r) => `${JSON.stringify(r)}\n`).join(""));
}

function text(input: DiagnoseInput): string {
  return diagnoseLines(diagnose(input)).join("\n");
}

describe("a store the real daemon wrote", () => {
  test("names the running instance, schema 2, both clocks, and the start revision's verdict", async () => {
    const { root, clock } = await daemonStore();
    const read = readCheckpoint(root);
    if (read.kind !== "checkpoint") throw new Error("the daemon wrote no checkpoint");
    const checkpoint = read.checkpoint;

    const report = diagnose(inputFor(root, clock.ms() + 5_000));
    expect(report.daemon.instanceId).toBe(checkpoint.heartbeat.instanceId);
    expect(report.daemon.start).toMatchObject({ kind: "stamped", revision: CLEAN_START });
    expect(report.daemon.verdict).toEqual({ kind: "compared", sha: START_SHA, dirty: false, relation: { kind: "same" } });
    expect(report.checkpoint).toMatchObject({ kind: "checkpoint", schema: 2, writtenAt: checkpoint.writtenAt, lastGoodSnapshotAt: "2026-09-08T02:48:38.418Z" });
    expect(report.boot).toEqual({ kind: "same", bootId: BOOT });

    const page = diagnoseLines(report).join("\n");
    expect(page).toContain(checkpoint.heartbeat.instanceId);
    expect(page).toContain("same as this checkout's HEAD");
    expect(page).toContain("schema 2");
    expect(page).toContain("last good snapshot 2026-09-08T02:48:38.418Z");
    // The job-list block is `overseer status`'s own, and says what this checkout builds.
    expect(page).toContain("this checkout builds list list-built-here");
  });

  test("a start that HEAD has moved past is N commits behind, not same", async () => {
    const { root, clock } = await daemonStore();
    const page = text(inputFor(root, clock.ms(), { git: fakeGit(HEAD_SHA, { [START_SHA]: { kind: "behind", commits: 3 } }) }));
    expect(page).toContain("3 commits behind HEAD");
    expect(page).not.toContain("same as");
  });

  test("a start that is not in HEAD's history says so", async () => {
    const { root, clock } = await daemonStore();
    const page = text(inputFor(root, clock.ms(), { git: fakeGit(HEAD_SHA, { [START_SHA]: { kind: "not-ancestor" } }) }));
    expect(page).toContain("not an ancestor of HEAD");
  });

  test("a DIRTY start never renders as same, even when its sha is HEAD", async () => {
    const { root, clock } = await daemonStore({ ...CLEAN_START, dirty: true });
    const report = diagnose(inputFor(root, clock.ms()));
    const revisionLine = diagnoseLines(report).find((line) => line.startsWith("revision")) ?? "";
    expect(revisionLine).toContain("dirty at start — the sha does not name the running code");
    expect(revisionLine).not.toMatch(/same/i);
  });

  test("an unknown start revision is unknown, with the reason", async () => {
    const { root, clock } = await daemonStore({ kind: "unknown", why: "git rev-parse HEAD exited 128", readAt: "2026-09-08T02:48:39.000Z" });
    const page = text(inputFor(root, clock.ms()));
    expect(page).toContain("unknown: git rev-parse HEAD exited 128");
    expect(page).not.toContain("same as");
  });

  test("a HEAD this checkout cannot read never lets a clean stamp read as same", async () => {
    const { root, clock } = await daemonStore();
    const page = text(inputFor(root, clock.ms(), { git: fakeGit({ why: "git is not installed" }) }));
    expect(page).toContain("git is not installed");
    expect(page).not.toContain("same as");
  });

  test("a start note written before stamps existed reads as NOT STAMPED", async () => {
    const { root, clock } = await daemonStore();
    rewriteLines(join(root, NOTES_FILE), (note) => {
      if (note["kind"] !== "daemon-started") return note;
      const { revision: _dropped, ...rest } = note;
      return rest;
    });
    const report = diagnose(inputFor(root, clock.ms()));
    expect(report.daemon.verdict.kind).toBe("not-stamped");
    expect(diagnoseLines(report).join("\n")).toContain("not stamped (started before revision stamps existed)");
  });

  test("a start note from ANOTHER instance does not stand in for the running one's", async () => {
    const { root, clock } = await daemonStore();
    rewriteLines(join(root, NOTES_FILE), (note) => (note["kind"] === "daemon-started" ? { ...note, instanceId: "some-earlier-instance" } : note));
    const page = text(inputFor(root, clock.ms()));
    expect(page).toContain("no start note for the running instance");
    expect(page).not.toContain("same as");
  });
});

describe("the controls: what a careless page would get wrong", () => {
  test("a daemon that stopped on purpose reads as stopped, with the checkpoint's age", async () => {
    const { root, clock } = await daemonStore();
    const report = diagnose(inputFor(root, clock.ms() + 3 * 3_600_000, { alive: () => false }));
    expect(report.daemon.standing.state).toBe("stopped");
    expect(report.daemon.standing.detail).toContain("3h old");
  });

  test("a daemon whose pid is gone without a stopping note reads as KILLED, with the age", async () => {
    const { root, clock } = await daemonStore();
    rewriteLines(join(root, NOTES_FILE), (note) => (note["kind"] === "daemon-stopped" ? null : note));
    const report = diagnose(inputFor(root, clock.ms() + 3 * 3_600_000, { alive: () => false }));
    expect(report.daemon.standing.state).toBe("killed");
    expect(report.daemon.standing.detail).toContain("3h old");
    expect(diagnoseLines(report).join("\n")).toContain("KILLED");
  });

  test("a checkpoint of a schema this build does not read is CANNOT TELL, never absent", async () => {
    const { root, clock } = await daemonStore();
    const path = join(root, CHECKPOINT_FILE);
    const json = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    writeFileSync(path, `${JSON.stringify({ ...json, schema: 99 })}\n`);

    const report = diagnose(inputFor(root, clock.ms()));
    expect(report.daemon.standing.state).toBe("cannot-tell");
    expect(report.checkpoint.kind).toBe("unusable");
    const row = report.files.find((f) => f.probe.name === CHECKPOINT_FILE);
    expect(row).toMatchObject({ probe: { state: "present", schema: 99 }, match: "mismatch" });

    const page = diagnoseLines(report).join("\n");
    expect(page).toContain("CANNOT TELL");
    expect(page).toContain("declares schema 99");
    expect(page).not.toMatch(/checkpoint\s+absent/);
  });

  test("a torn events.jsonl tail is flagged on its row", async () => {
    const { root, clock } = await daemonStore();
    appendFileSync(join(root, EVENTS_FILE), '{"kind":"session-seen","at":"2026-09-08T02:4');
    const report = diagnose(inputFor(root, clock.ms()));
    expect(report.files.find((f) => f.probe.name === EVENTS_FILE)?.probe).toMatchObject({ state: "present", tornTail: true });
    const row = diagnoseLines(report).find((line) => line.includes(EVENTS_FILE)) ?? "";
    expect(row).toContain("TORN");
  });

  test("a host that has rebooted since the daemon last recorded its boot says so", async () => {
    const { root, clock } = await daemonStore();
    const report = diagnose(inputFor(root, clock.ms(), { hostBootId: () => OTHER_BOOT }));
    expect(report.boot).toEqual({ kind: "different", recorded: BOOT, host: OTHER_BOOT });
    expect(diagnoseLines(report).join("\n")).toContain("the daemon has not run since the reboot");
  });

  test("a host boot id that cannot be read is unknown, not same", async () => {
    const { root, clock } = await daemonStore();
    const report = diagnose(inputFor(root, clock.ms(), { hostBootId: () => null }));
    expect(report.boot.kind).toBe("unknown");
  });

  test("an empty store renders every section rather than throwing, and says what is absent", () => {
    const root = tempRoot();
    const report = diagnose(inputFor(root, Date.parse("2026-09-10T12:00:00.000Z")));
    expect(report.daemon.standing.state).toBe("never-run");
    expect(report.checkpoint.kind).toBe("absent");
    expect(report.boot.kind).toBe("unknown");
    expect(report.files.every((f) => f.probe.state === "absent")).toBe(true);
    const page = diagnoseLines(report).join("\n");
    expect(page).toContain("NO PREVIEW");
    expect(page).not.toContain("same as");
  });
});

describe("the dashboard's revision", () => {
  test("not asked, until there is a diagnostics route to ask", async () => {
    const { root, clock } = await daemonStore();
    expect(text(inputFor(root, clock.ms()))).toContain("dashboard: not asked (no diagnostics route yet)");
  });

  test("unreachable is a line, not a crash", async () => {
    const { root, clock } = await daemonStore();
    const page = text(inputFor(root, clock.ms(), { dashboard: { kind: "unreachable", why: "connect ECONNREFUSED 127.0.0.1:8787" } }));
    expect(page).toContain("dashboard: unreachable: connect ECONNREFUSED 127.0.0.1:8787");
  });

  test("an answer is given the same verdict a daemon's would be", async () => {
    const { root, clock } = await daemonStore();
    const page = text(
      inputFor(root, clock.ms(), {
        git: fakeGit(HEAD_SHA, { [START_SHA]: { kind: "behind", commits: 2 } }),
        dashboard: { kind: "answered", revision: CLEAN_START },
      }),
    );
    expect(page).toMatch(/dashboard: .*2 commits behind HEAD/);
  });
});

describe("the command", () => {
  test("`diagnose` and `diagnose --json` parse", () => {
    expect(parseArgv(["diagnose"])).toEqual({ kind: "run", parsed: { command: "diagnose", json: false } });
    expect(parseArgv(["diagnose", "--json"])).toEqual({ kind: "run", parsed: { command: "diagnose", json: true } });
  });

  test("--json prints the typed report, and exits 0 on a store it could read", async () => {
    const { root } = await daemonStore();
    vi.stubEnv("OVERSEER_STORE_DIR", root);
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => void printed.push(String(line)));
    expect(await runParsed({ command: "diagnose", json: true })).toBe(0);
    const report = JSON.parse(printed.join("\n")) as { root: string; checkpoint: { kind: string; schema?: number } };
    expect(report.root).toBe(root);
    expect(report.checkpoint).toMatchObject({ kind: "checkpoint", schema: 2 });
    vi.unstubAllEnvs();
  });

  test("a store root that cannot be read exits 1", async () => {
    const root = join(tempRoot(), "not-there");
    vi.stubEnv("OVERSEER_STORE_DIR", root);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => void errors.push(String(line)));
    expect(await runParsed({ command: "diagnose", json: false })).toBe(1);
    expect(errors.join("\n")).toContain(root);
    vi.unstubAllEnvs();
  });
});
