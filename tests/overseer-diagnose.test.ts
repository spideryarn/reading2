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
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";

import { runOverseer } from "../tools/overseer/daemon.js";
import {
  checkoutJobList,
  diagnose,
  diagnoseLines,
  readDiagnoseInput,
  verdictText,
  type DiagnoseDeps,
  type DiagnoseInput,
  type GitReads,
  type RevisionRelation,
  type RevisionVerdict,
} from "../tools/overseer/diagnose.js";
import { NOTES_FILE } from "../tools/overseer/notes.js";
import { ARMING_FILE } from "../tools/overseer/arming.js";
import { CLI_STATE_FILE } from "../tools/overseer/cli-state.js";
import { DECISIONS_FILE, DECISIONS_INIT_FILE } from "../tools/overseer/decisions.js";
import { INBOX_DIR } from "../tools/overseer/reports.js";
import { listRevision, schedulePreviewLines } from "../tools/overseer/schedule-preview.js";
import { SCHEDULE_PREVIEW_FILE } from "../tools/fleet/schedule-parse.js";
import { CHECKPOINT_FILE, EVENTS_FILE, readCheckpoint } from "../tools/overseer/store.js";
import type { PidReader } from "../tools/overseer/status-cli.js";
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

/** daemonStore's daemon started at 02:48:40 on the fake clock; its own process a second before that. */
const THIS_DAEMON: PidReader = () => ({ kind: "started", atMs: Date.parse("2026-09-08T02:48:39.000Z") });
const GONE: PidReader = () => ({ kind: "gone" });

function inputFor(root: string, nowMs: number, overrides: DiagnoseDeps = {}): DiagnoseInput {
  const read = readDiagnoseInput(root, {
    now: () => new Date(nowMs),
    identify: THIS_DAEMON,
    hostBootId: () => BOOT,
    git: fakeGit(START_SHA),
    builtList: () => ({ kind: "built", listRevision: "list-built-here" }),
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
    expect(page).toContain("recorded start HEAD 5d0c1e9a matches this checkout's HEAD");
    expect(page).toContain("schema 2");
    expect(page).toContain("last good snapshot 2026-09-08T02:48:38.418Z");
    // The job-list block is `overseer status`'s own, and says what this checkout builds.
    expect(page).toContain("this checkout builds list list-built-here");
  });

  test("a start that HEAD has moved past is N commits behind, not same", async () => {
    const { root, clock } = await daemonStore();
    const page = text(inputFor(root, clock.ms(), { git: fakeGit(HEAD_SHA, { [START_SHA]: { kind: "behind", commits: 3 } }) }));
    expect(page).toContain("recorded start HEAD 5d0c1e9a is 3 commits behind this checkout's HEAD");
    expect(page).not.toContain("matches this checkout");
  });

  test("a start that is not in HEAD's history says so", async () => {
    const { root, clock } = await daemonStore();
    const page = text(inputFor(root, clock.ms(), { git: fakeGit(HEAD_SHA, { [START_SHA]: { kind: "not-ancestor" } }) }));
    expect(page).toContain("recorded start HEAD 5d0c1e9a is not an ancestor of this checkout's HEAD");
  });

  test("a DIRTY start is an unknown code revision, even when its sha is HEAD", async () => {
    const { root, clock } = await daemonStore({ ...CLEAN_START, dirty: true });
    const report = diagnose(inputFor(root, clock.ms()));
    const revisionLine = diagnoseLines(report).find((line) => line.startsWith("revision")) ?? "";
    expect(revisionLine).toContain("code revision unknown — base HEAD 5d0c1e9a, checkout dirty at start");
    expect(revisionLine).not.toMatch(/same|matches/i);
  });

  test("an unknown start revision is unknown, with the reason", async () => {
    const { root, clock } = await daemonStore({ kind: "unknown", why: "git rev-parse HEAD exited 128", readAt: "2026-09-08T02:48:39.000Z" });
    const page = text(inputFor(root, clock.ms()));
    expect(page).toContain("unknown: git rev-parse HEAD exited 128");
    expect(page).not.toContain("matches this checkout");
  });

  test("a HEAD this checkout cannot read never lets a clean stamp read as matching", async () => {
    const { root, clock } = await daemonStore();
    const page = text(inputFor(root, clock.ms(), { git: fakeGit({ why: "git is not installed" }) }));
    expect(page).toContain("git is not installed");
    expect(page).not.toContain("matches this checkout");
  });

  test("no verdict claims what the running code IS: a stamp is a checkout observation (Sol F1)", async () => {
    const relations: RevisionRelation[] = [{ kind: "same" }, { kind: "behind", commits: 1 }, { kind: "not-ancestor" }, { kind: "unknown", why: "no such commit" }];
    const verdicts: RevisionVerdict[] = [
      ...relations.flatMap((relation) => [false, true].map((dirty): RevisionVerdict => ({ kind: "compared", sha: START_SHA, dirty, relation }))),
      { kind: "not-stamped", why: "started before revision stamps existed" },
      { kind: "unknown", why: "git rev-parse HEAD exited 128" },
    ];
    for (const verdict of verdicts) expect(verdictText(verdict)).not.toMatch(/same as|running code/i);
    // And the page's own gloss under the revision lines says the same.
    const { root, clock } = await daemonStore({ ...CLEAN_START, dirty: true });
    const page = text(inputFor(root, clock.ms()));
    expect(page).not.toMatch(/same as|running code/i);
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
    expect(page).not.toContain("matches this checkout");
  });
});

describe("the controls: what a careless page would get wrong", () => {
  test("a daemon that stopped on purpose reads as stopped, with the checkpoint's age", async () => {
    const { root, clock } = await daemonStore();
    const report = diagnose(inputFor(root, clock.ms() + 3 * 3_600_000, { identify: GONE }));
    expect(report.daemon.standing.state).toBe("stopped");
    expect(report.daemon.standing.detail).toContain("3h old");
  });

  test("a daemon whose pid is gone without a stopping note reads as KILLED, with the age", async () => {
    const { root, clock } = await daemonStore();
    rewriteLines(join(root, NOTES_FILE), (note) => (note["kind"] === "daemon-stopped" ? null : note));
    const report = diagnose(inputFor(root, clock.ms() + 3 * 3_600_000, { identify: GONE }));
    expect(report.daemon.standing.state).toBe("killed");
    expect(report.daemon.standing.detail).toContain("3h old");
    expect(diagnoseLines(report).join("\n")).toContain("KILLED");
  });

  test("A checkpointed and was killed; B started and stopped before its first checkpoint (Sol F3)", async () => {
    const { root, clock } = await daemonStore();
    const read = readCheckpoint(root);
    if (read.kind !== "checkpoint") throw new Error("the daemon wrote no checkpoint");
    const a = read.checkpoint.heartbeat.instanceId;
    // A was killed: no stopping note. Then B came and went cleanly, never checkpointing.
    rewriteLines(join(root, NOTES_FILE), (note) => (note["kind"] === "daemon-stopped" ? null : note));
    const later = (ms: number): string => new Date(clock.ms() + ms).toISOString();
    const bStart = { kind: "daemon-started", at: later(60_000), instanceId: "instance-b", pid: 2 ** 30, source: "http://127.0.0.1:0", opening: "Resumed", baseline: "restored", revision: CLEAN_START };
    const bStop = { kind: "daemon-stopped", at: later(61_000), instanceId: "instance-b", why: "SIGTERM" };
    appendFileSync(join(root, NOTES_FILE), `${JSON.stringify(bStart)}\n${JSON.stringify(bStop)}\n`);

    const report = diagnose(inputFor(root, clock.ms() + 3 * 3_600_000, { identify: GONE }));
    const detail = report.daemon.standing.detail;
    expect(detail).not.toMatch(/stopped on purpose at [^;]*; the last checkpoint/);
    expect(detail).toContain(`instance instance-b started at ${bStart.at}`);
    expect(detail).toContain("without writing a checkpoint");
    expect(detail).toContain(`the checkpoint on disk is instance ${a}'s`);
    expect(detail).toContain(`${a} wrote no stopping note`);
    // The page names B on a line of its own, with B's own start HEAD, rather than
    // letting A's instance and revision stand for "the daemon".
    const page = diagnoseLines(report).join("\n");
    expect(page).toContain(`newest start: instance-b at ${bStart.at}, which wrote no checkpoint; recorded start HEAD 5d0c1e9a matches`);
    expect(page).toMatch(new RegExp(`instance\\s+${a}.*the checkpoint's instance`));
  });

  test("a checkpoint of a schema this build does not read is CANNOT TELL, never absent", async () => {
    const { root, clock } = await daemonStore();
    const path = join(root, CHECKPOINT_FILE);
    const json = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    writeFileSync(path, `${JSON.stringify({ ...json, schema: 99 })}\n`);

    const report = diagnose(inputFor(root, clock.ms()));
    expect(report.daemon.standing.state).toBe("cannot-tell");
    expect(report.checkpoint.kind).toBe("unusable");
    const row = report.files.find((f) => f.name === CHECKPOINT_FILE);
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
    const events = report.files.find((f) => f.name === EVENTS_FILE);
    expect(events?.kind === "probed" ? events.probe : events).toMatchObject({ state: "present", tornTail: true });
    const row = diagnoseLines(report).find((line) => line.includes(EVENTS_FILE)) ?? "";
    expect(row).toContain("TORN");
  });

  test("a boot mismatch says only that recovery.json has not recorded this boot — nothing about whether the daemon ran (Sol F44)", async () => {
    const { root, clock } = await daemonStore();
    const report = diagnose(inputFor(root, clock.ms(), { hostBootId: () => OTHER_BOOT }));
    expect(report.boot).toEqual({ kind: "different", recorded: BOOT, host: OTHER_BOOT });
    const page = diagnoseLines(report).join("\n");
    expect(page).toContain(
      `recovery.json records boot ${BOOT}, the host is on ${OTHER_BOOT}: recovery.json has not yet recorded the current boot (it updates only after an accepted collection)`,
    );
    expect(page).not.toMatch(/has not run since|rebooted/);
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
    expect(report.files.every((f) => (f.kind === "probed" ? f.probe.state : f.stat.state) === "absent")).toBe(true);
    const page = diagnoseLines(report).join("\n");
    expect(page).toContain("NO PREVIEW");
    expect(page).not.toContain("matches this checkout");
  });
});

describe("Sol's stage-2 review, F40–F45", () => {
  const NOW10 = Date.parse("2026-09-10T12:00:00.000Z");
  const rowOf = (page: string, name: string): string => page.split("\n").find((line) => line.trimStart().startsWith(`${name} `)) ?? "";

  test("F40: a checkout whose job list cannot be built is never 'the same list', even against a preview of the empty list", async () => {
    const { root, clock } = await daemonStore();
    const own = readCheckpoint(root);
    if (own.kind !== "checkpoint") throw new Error("the daemon wrote no checkpoint");
    // Sol's reproduction: the running daemon's preview holds the EMPTY list, whose hash is what a
    // checkout that could read none of its job files would compute if it hashed anyway.
    const at = new Date(clock.ms()).toISOString();
    const preview = {
      schema: 1,
      writtenAt: at,
      instanceId: own.checkpoint.heartbeat.instanceId,
      list: { kind: "given", listRevision: listRevision([]) },
      capabilities: { session: false, rules: false },
      arming: { kind: "none", why: "not armed" },
      history: { kind: "intact" },
      headline: { kind: "off", why: "not armed", at },
      missedRunPolicy: { kind: "one-run", sentence: "runs once" },
      caveat: "as of writtenAt",
      jobs: [],
    };
    writeFileSync(join(root, SCHEDULE_PREVIEW_FILE), `${JSON.stringify(preview)}\n`);
    // No job list injected: the real builders, over a checkout that holds none of their files.
    const read = readDiagnoseInput(root, { now: () => new Date(clock.ms()), git: fakeGit(START_SHA), hostBootId: () => BOOT, checkout: tempRoot() });
    if (!read.ok) throw new Error(read.why);
    const page = diagnoseLines(diagnose(read.input)).join("\n");
    expect(page).not.toContain("the same list this checkout builds");
    // The daemon's own list is printed, and this checkout is given no revision to hold beside it.
    expect(page).toContain(`the running daemon holds list ${listRevision([])}; this checkout's job list could not be built:`);
    expect(page).not.toContain("this checkout builds list");
    expect(page).toContain("so the two are not compared");
    expect(page).toContain("could not be read");
  });

  test("F40, `status`'s half: the one list builder is unbuildable over an empty checkout, built over this one, and never hashed when unbuildable", () => {
    const unbuilt = checkoutJobList(tempRoot());
    if (unbuilt.kind !== "unbuildable") throw new Error(`an empty checkout built a list: ${JSON.stringify(unbuilt)}`);
    expect(unbuilt.problems.length).toBeGreaterThan(0);
    expect(checkoutJobList(fileURLToPath(new URL("..", import.meta.url)))).toMatchObject({ kind: "built" });
    const lines = schedulePreviewLines({ kind: "absent" }, { built: unbuilt, runningInstanceId: null }, NOW10).join("\n");
    expect(lines).toContain("this checkout's job list could not be built:");
    expect(lines).not.toContain(listRevision([]));
  });

  test("F41: a legacy cli-state.json with no schema is accepted as schema 1; an undeclared decisions line is still a mismatch", () => {
    const root = tempRoot();
    writeFileSync(join(root, CLI_STATE_FILE), `${JSON.stringify({ mine: [], paused: [] })}\n`);
    writeFileSync(join(root, DECISIONS_FILE), `${JSON.stringify({ kind: "decided", at: "2026-09-10T11:00:00.000Z" })}\n`);
    const page = text(inputFor(root, NOW10));
    expect(rowOf(page, CLI_STATE_FILE)).toContain("no schema declared; accepted as legacy schema 1");
    expect(rowOf(page, CLI_STATE_FILE)).not.toContain("MISMATCH");
    expect(rowOf(page, DECISIONS_FILE)).toContain("MISMATCH");
  });

  test("F42: every entry in the store directory gets a row, catalogued or not, file or directory", () => {
    const root = tempRoot();
    writeFileSync(join(root, ARMING_FILE), `${JSON.stringify({ armedAt: "2026-09-10T11:00:00.000Z" })}\n`);
    writeFileSync(join(root, DECISIONS_INIT_FILE), "");
    writeFileSync(join(root, "mystery.bin"), "xyz");
    mkdirSync(join(root, INBOX_DIR));
    mkdirSync(join(root, "stray-dir"));
    const page = text(inputFor(root, NOW10));
    expect(rowOf(page, ARMING_FILE)).toContain("when the scheduler was first armed — listed, never opened");
    expect(rowOf(page, DECISIONS_INIT_FILE)).toContain("0 B");
    expect(rowOf(page, "mystery.bin")).toContain("3 B");
    expect(rowOf(page, "mystery.bin")).toContain("no known schema");
    expect(rowOf(page, INBOX_DIR)).toContain("directory");
    expect(rowOf(page, "stray-dir")).toContain("directory");
    expect(rowOf(page, "stray-dir")).toContain("not in this build's catalogue");
  });

  test("F42: a store directory longer than the listing cap says the listing was cut", () => {
    const root = tempRoot();
    for (let i = 0; i < 205; i += 1) writeFileSync(join(root, `junk-${String(i).padStart(3, "0")}`), "");
    const page = text(inputFor(root, NOW10));
    expect(page).toContain("only the first 200 directory entries were listed");
  });

  test("F43: a checkpoint dated in the future is CANNOT TELL, and no clock on the page says 'ago' of it", async () => {
    const { root, clock } = await daemonStore();
    rewriteLines(join(root, NOTES_FILE), (note) => (note["kind"] === "daemon-stopped" ? null : note));
    const path = join(root, CHECKPOINT_FILE);
    const json = JSON.parse(readFileSync(path, "utf8")) as { writtenAt: string; lastGoodSnapshotAt: string; heartbeat: { lastTickAt: string } };
    const future = "2036-09-08T02:48:40.000Z";
    writeFileSync(path, `${JSON.stringify({ ...json, writtenAt: future, lastGoodSnapshotAt: future, heartbeat: { ...json.heartbeat, lastTickAt: future } })}\n`);
    const report = diagnose(inputFor(root, clock.ms()));
    expect(report.daemon.standing.state).toBe("cannot-tell");
    expect(report.daemon.standing.detail).toContain(future);
    const page = diagnoseLines(report).join("\n");
    expect(page).toContain("in the future by");
    expect(page).not.toMatch(/in the future (ago|old)/);
  });

  test("F45: a live pid whose process is not this daemon is KILLED, not RUNNING", async () => {
    const { root, clock } = await daemonStore();
    rewriteLines(join(root, NOTES_FILE), (note) => (note["kind"] === "daemon-stopped" ? null : note));
    const report = diagnose(
      // The pid's process started 30 s AFTER this daemon did: a fresh checkpoint, a live pid, not this daemon.
      inputFor(root, clock.ms() + 31_000, { identify: () => ({ kind: "started", atMs: clock.ms() + 30_000 }) }),
    );
    expect(report.daemon.standing.state).toBe("killed");
    expect(report.daemon.standing.detail).toContain("is alive but is not this daemon");
  });
});

/* ── Sol's F4: the dashboard read has a deadline, a body bound, and a word for every failure ── */

describe("reading the dashboard's diagnostics (F4)", () => {
  /** A minimal answer the fleet's own parser accepts: every field present, every unknown arm stated. */
  const summary = (start: StartRevision = CLEAN_START): Record<string, unknown> => ({
    schema: 1,
    composedAt: "2026-09-10T15:00:00.000Z",
    dashboard: {
      instance: "srv-test",
      start,
      bundleAtStart: { kind: "unknown", why: "fixture" },
      bundleOnDisk: { kind: "unknown", why: "fixture" },
    },
    collector: { attempted: { kind: "never", why: "fixture" }, collected: { kind: "never", why: "fixture" }, lastError: { kind: "none" } },
    health: { kind: "never", why: "fixture" },
    store: { path: { kind: "unknown", why: "fixture" }, files: { kind: "unknown", why: "fixture" } },
    daemon: { kind: "unknown", why: "fixture" },
  });
  const answering = (status: number, body: string): typeof fetch => (async () => new Response(body, { status })) as typeof fetch;
  const read = async (fetchImpl: typeof fetch, extra: { timeoutMs?: number; maxBytes?: number } = {}) => {
    const { readDashboardDiagnostics } = await import("../tools/overseer/diagnose.js");
    return readDashboardDiagnostics("http://dash.test:8787", { fetch: fetchImpl, ...extra });
  };

  test("a good answer is the dashboard's recorded start, asked of /api/diagnostics under a deadline", async () => {
    let asked: { url: string; signal: unknown } | null = null;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      asked = { url: String(input), signal: init?.signal };
      return new Response(JSON.stringify(summary()), { status: 200 });
    }) as typeof fetch;
    expect(await read(fetchImpl)).toEqual({ kind: "answered", revision: CLEAN_START });
    expect(asked).not.toBeNull();
    expect(asked!.url).toBe("http://dash.test:8787/api/diagnostics");
    expect(asked!.signal).toBeInstanceOf(AbortSignal);
  });

  test("a non-2xx, malformed JSON, and a shape the parser refuses are each unusable, with the reason", async () => {
    const failed = await read(answering(503, JSON.stringify({ schema: 1, kind: "error", why: "composing threw" })));
    expect(failed.kind).toBe("unusable");
    if (failed.kind === "unusable") expect(failed.why).toContain("503");
    const garbled = await read(answering(200, "{ nope"));
    expect(garbled.kind).toBe("unusable");
    if (garbled.kind === "unusable") expect(garbled.why).toContain("not JSON");
    const wrong = await read(answering(200, JSON.stringify({ schema: 1, composedAt: "2026-09-10T15:00:00.000Z" })));
    expect(wrong.kind).toBe("unusable");
  });

  test("an answer larger than the bound is unusable, not read whole", async () => {
    const huge = await read(answering(200, "x".repeat(300 * 1024)), { maxBytes: 256 * 1024 });
    expect(huge.kind).toBe("unusable");
    if (huge.kind === "unusable") expect(huge.why).toContain("larger than");
  });

  test("a dashboard that never answers is unusable once the deadline passes", async () => {
    const hanging = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as typeof fetch;
    const started = Date.now();
    const late = await read(hanging, { timeoutMs: 40 });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(late.kind).toBe("unusable");
    if (late.kind === "unusable") expect(late.why).toContain("no answer within");
  });

  test("a refused connection is unreachable, and every reason is bounded in length", async () => {
    const refused = (async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), { code: "ECONNREFUSED" }) });
    }) as typeof fetch;
    const down = await read(refused);
    expect(down.kind).toBe("unreachable");
    if (down.kind === "unreachable") expect(down.why).toContain("ECONNREFUSED");
    const chatty = await read(answering(500, JSON.stringify({ schema: 1, kind: "error", why: "w".repeat(5_000) })));
    expect(chatty.kind).toBe("unusable");
    if (chatty.kind === "unusable") expect(chatty.why.length).toBeLessThanOrEqual(400);
  });

  test("unusable is one line of the page, and the rest of the report still renders", async () => {
    const { root, clock } = await daemonStore();
    const page = text(inputFor(root, clock.ms(), { dashboard: { kind: "unusable", why: "the dashboard answered 503" } }));
    expect(page).toContain("dashboard diagnostics unusable — the dashboard answered 503");
    expect(page).toContain("store files");
    expect(page).toContain("checkpoint");
  });
});

describe("the dashboard's revision", () => {
  test("not asked, when the caller did not ask the dashboard", async () => {
    const { root, clock } = await daemonStore();
    expect(text(inputFor(root, clock.ms()))).toContain("dashboard: not asked (this caller did not ask the dashboard)");
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
    expect(page).toMatch(/dashboard: recorded start HEAD 5d0c1e9a is 2 commits behind this checkout's HEAD/);
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
    // Port 1: refused at once. Never the live dashboard on 8787.
    vi.stubEnv("OVERSEER_FLEET_URL", "http://127.0.0.1:1");
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => void printed.push(String(line)));
    expect(await runParsed({ command: "diagnose", json: true })).toBe(0);
    const report = JSON.parse(printed.join("\n")) as { root: string; checkpoint: { kind: string; schema?: number }; dashboard: { reading: { kind: string } } };
    expect(report.root).toBe(root);
    expect(report.checkpoint).toMatchObject({ kind: "checkpoint", schema: 2 });
    // The command ASKED the dashboard (F4): a refused connection, not "not asked".
    expect(report.dashboard.reading.kind).toBe("unreachable");
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
