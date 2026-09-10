/**
 * Gradual recovery's resume pass through the REAL daemon — the real parser,
 * gate, differ, store, recovery fold, view pass and resume pass — driven by a
 * scripted source, with a fake launch port that keeps the launch protocol's
 * rules. Plan docs/plans/260910f-gradual-recovery-resume-selected-interrupted-work-one-at-a-time.md,
 * Stage 1. The harness is tests/overseer-daemon-recovery.test.ts's shape.
 *
 * THE WORLD: `session-new-before`'s first three rows, each given a real temp
 * directory, a verified Claude Code run of its own claimed conversation, and a
 * transcript in a temp projects directory; then a reboot to an empty new tmux
 * generation. Every candidate is `interrupted` with `resume: supported`.
 *
 * EVERY INVOCATION IS COUNTED TWICE: the fake port's counter, and the marker
 * file it appends to (tests/overseer-recovery-resume-fakes.ts).
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { main as recoveryCli } from "../scripts/overseer-recovery.js";
import { slugifyDir } from "../tools/fleet/transcript.js";
import type { RecoveryResumeProjection } from "../tools/fleet/wire.js";
import { runOverseer } from "../tools/overseer/daemon.js";
import type { OverseerEvent } from "../tools/overseer/diff.js";
import type { JsonValue } from "../tools/overseer/observation.js";
import { RECOVERY_RESUME_DIR, writeResumeRequest } from "../tools/overseer/recovery-resume-request.js";
import { RESUME_SPACING_MS, type ResumeAccountPort, type ResumeLaunchPort } from "../tools/overseer/recovery-resume.js";
import type { RecoveryView } from "../tools/overseer/recovery-view.js";
import type { SourceMessage } from "../tools/overseer/source.js";
import { EVENTS_FILE, openStore, readCheckpoint, readRecoveryIndexFile } from "../tools/overseer/store.js";
import { loadRecoveryFile, projectRecovery } from "../tools/fleet/recovery-feed.js";
import { fakeAccounts, fakePort, markerLines, mutableClock, storedUsage, usageSection, type FakeAccounts, type FakePort } from "./overseer-recovery-resume-fakes.js";
import { editableFixture, rowsOf } from "./overseer-fixtures.js";

const RECOVERY_FILE = "recovery.json";

/** Dashboard runs and a tmux generation, minted for this file. */
const RUN_A = "7c41d2e9";
const RUN_B = "b8e05f3a";
const G2 = 151903;
const BOOT = "ri-resume-daemon-boot";
const BEFORE_AT = "2026-09-08T02:47:22.686Z";
const OK_HEALTH = { verdict: { level: "ok" } };

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-recovery-resume-daemon-test-"));
  roots.push(root);
  return root;
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function until(condition: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function payload(json: JsonValue): SourceMessage {
  return { kind: "payload", via: "sse", atMs: 0, json };
}

type World = {
  root: string;
  projects: string;
  names: string[];
  dirs: Map<string, string>;
  conversations: Map<string, string>;
  ids: Map<string, string>;
  clock: ReturnType<typeof mutableClock>;
  port: FakePort;
  accounts: FakeAccounts;
  inventory: number;
  logs: string[];
};

/** A first-three-rows row of the capture, in its world directory, running a verified Claude Code under `token`. */
function rowFor(w: World, name: string, token: { pid: number; startTicks: number }, status?: JsonValue): Record<string, JsonValue> {
  const row = rowsOf(editableFixture("session-new-before")).find((r) => r["name"] === name);
  if (row === undefined) throw new Error(`the capture has no row ${name}`);
  row["meta"] = { version: 1, kind: "claude", repo: "spideryarn/reading2", dir: w.dirs.get(name) as string };
  row["execution"] = {
    kind: "verified",
    token: { boot: "ri-resume-exec-boot", pid: token.pid, startTicks: token.startTicks },
    harness: "claude-code",
    conversation: { kind: "verified", id: row["claudeSessionId"] as string },
  };
  if (status !== undefined) row["status"] = status;
  return row;
}

const BEFORE_TOKEN = (i: number) => ({ pid: 8100 + i, startTicks: 10 + i });
const NEW_TOKEN = (i: number) => ({ pid: 9100 + i, startTicks: 50 + i });

/** A collection after the reboot: the new tmux generation, the next inventory number, and these rows. */
function collection(w: World, rows: JsonValue[] = [], health: JsonValue = OK_HEALTH): JsonValue {
  w.inventory += 1;
  const fixture = editableFixture("session-new-before");
  return {
    ...fixture,
    rows,
    tmuxServerPid: G2,
    collectedAt: new Date(Date.parse(BEFORE_AT) + w.inventory * 60_000).toISOString(),
    health,
    producer: { instance: RUN_B, publication: w.inventory, inventory: w.inventory },
  } as unknown as JsonValue;
}

function transcriptPath(w: World, name: string): string {
  return join(w.projects, slugifyDir(w.dirs.get(name) as string), `${w.conversations.get(name) as string}.jsonl`);
}

async function daemon(
  w: World,
  script: () => AsyncGenerator<SourceMessage>,
  options: { port?: ResumeLaunchPort; accounts?: ResumeAccountPort; beforeRecapture?: () => Promise<void> } = {},
): Promise<void> {
  const outcome = await runOverseer({
    root: w.root,
    baseUrl: "http://127.0.0.1:0",
    signal: new AbortController().signal,
    now: w.clock.now,
    tickMs: 5,
    log: (line) => w.logs.push(line),
    source: () => script(),
    bootId: () => BOOT,
    recovery: { projectsDir: w.projects, hostname: () => "ri-resume-host" },
    recoveryResume: {
      accounts: options.accounts ?? w.accounts,
      // The pinned pool account at 12%, read just now: the gate is clear on quota.
      accountUsage: () => storedUsage([usageSection("ri-pool", 12, w.clock.ms())], w.clock.ms()),
      ...(options.port === undefined ? {} : { port: options.port }),
      ...(options.beforeRecapture === undefined ? {} : { beforeRecapture: options.beforeRecapture }),
    },
  });
  expect(outcome.kind).toBe("stopped");
}

/** The world after a reboot, with the index and the view on disk. `exited` rows had stopped before it. */
async function rebootedWorld(options: { exited?: string } = {}): Promise<World> {
  const clock = mutableClock("2026-09-08T02:48:40.000Z");
  const fixtureRows = rowsOf(editableFixture("session-new-before")).slice(0, 3);
  const w: World = {
    root: tempRoot(),
    projects: tempRoot(),
    names: fixtureRows.map((r) => r["name"] as string),
    dirs: new Map(),
    conversations: new Map(),
    ids: new Map(),
    clock,
    port: fakePort(join(tempRoot(), "invocations.jsonl")),
    accounts: fakeAccounts(),
    inventory: 0,
    logs: [],
  };
  for (const row of fixtureRows) {
    const name = row["name"] as string;
    w.dirs.set(name, tempRoot());
    w.conversations.set(name, row["claudeSessionId"] as string);
    const path = transcriptPath(w, name);
    mkdirSync(join(path, ".."), { recursive: true });
    const conversation = row["claudeSessionId"] as string;
    writeFileSync(
      path,
      `${JSON.stringify({ type: "user", message: { role: "user", content: `the brief for ${name}` }, sessionId: conversation, timestamp: "2026-09-08T01:00:00.000Z" })}\n` +
        `${JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: `${name} got this far` }] }, sessionId: conversation, timestamp: "2026-09-08T02:40:00.000Z" })}\n`,
    );
    const at = new Date(Date.now() - 60 * 60_000);
    utimesSync(path, at, at);
  }
  const before = editableFixture("session-new-before");
  const rows = w.names.map((name, i) => rowFor(w, name, BEFORE_TOKEN(i), name === options.exited ? { kind: "no-claude" } : undefined));
  const beforePayload = { ...before, rows, health: OK_HEALTH, producer: { instance: RUN_A, publication: 1, inventory: 1 } } as unknown as JsonValue;
  await daemon(w, async function* () {
    yield payload(beforePayload);
    yield payload(collection(w));
  });
  const opened = openStore({ root: w.root });
  if (!opened.ok) throw new Error("the store did not open");
  for (const record of opened.store.recovery.records.values()) w.ids.set(record.name, record.id);
  opened.store.close();
  expect(w.ids.size).toBe(3);
  const view = viewOf(w);
  const supported = view.page.filter((item) => item.evidence?.kind === "checked" && item.evidence.resume.kind === "supported");
  expect(supported).toHaveLength(3);
  return w;
}

function recoveryJson(w: World): { view?: RecoveryView | null; resume?: RecoveryResumeProjection } {
  return JSON.parse(readFileSync(join(w.root, RECOVERY_FILE), "utf8")) as { view?: RecoveryView | null; resume?: RecoveryResumeProjection };
}

function viewOf(w: World): RecoveryView {
  const view = recoveryJson(w).view;
  if (view === undefined || view === null) throw new Error("recovery.json carries no view");
  return view;
}

function resumeOf(w: World): RecoveryResumeProjection | undefined {
  return existsSync(join(w.root, RECOVERY_FILE)) ? recoveryJson(w).resume : undefined;
}

function stateOf(w: World, name: string): RecoveryResumeProjection["requests"][number]["state"] | undefined {
  return resumeOf(w)?.requests.find((r) => r.candidateId === w.ids.get(name))?.state;
}

function idOf(w: World, name: string): string {
  const id = w.ids.get(name);
  if (id === undefined) throw new Error(`no candidate for ${name}`);
  return id;
}

/** A tap, with `seen` as the view on disk says it. */
function tap(w: World, name: string, seenChanges: { dir?: string } = {}): string {
  const written = writeResumeRequest(w.root, {
    candidateId: idOf(w, name),
    actor: "dashboard",
    seen: { checkedAt: viewOf(w).checkedAt, conversationId: w.conversations.get(name) as string, dir: seenChanges.dir ?? (w.dirs.get(name) as string) },
    now: w.clock.now(),
  });
  if (written.kind !== "written") throw new Error(written.why);
  w.clock.advance(1000);
  return written.path;
}

function filesIn(w: World, dir: "pending" | "done" | "refused"): string[] {
  const path = join(w.root, RECOVERY_RESUME_DIR, dir);
  return existsSync(path) ? readdirSync(path).filter((name) => !name.startsWith(".")) : [];
}

function refusedWhy(w: World): string[] {
  return filesIn(w, "refused").map((name) => (JSON.parse(readFileSync(join(w.root, RECOVERY_RESUME_DIR, "refused", name), "utf8")) as { why: string }).why);
}

function events(w: World): OverseerEvent[] {
  return readFileSync(join(w.root, EVENTS_FILE), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as OverseerEvent);
}

function resumedIn(w: World, name: string): boolean {
  return events(w).some((e) => e.kind === "recovery-disposition" && e.disposition === "resumed" && e.id === w.ids.get(name));
}

/**
 * THE FLEET'S OWN PARSER, over the file the real writer wrote: the resume
 * section must come back `published`, never `unreadable` — Stage 2's parser is
 * stricter than the wire types (positions from 1, names and previews agreeing
 * with the records beside them, one state per candidate).
 */
async function expectFeedPublishes(w: World): Promise<RecoveryResumeProjection> {
  const feed = projectRecovery(await loadRecoveryFile(w.root), new Date().toISOString());
  expect(feed.kind).toBe("published");
  if (feed.kind !== "published") throw new Error(`the feed is ${feed.kind}`);
  expect(feed.resume).toMatchObject({ kind: "published" });
  if (feed.resume.kind !== "published") throw new Error(`the resume section is ${feed.resume.kind}: ${JSON.stringify(feed.resume)}`);
  return feed.resume.projection;
}

function acceptedAt(w: World): string | null {
  const read = readCheckpoint(w.root);
  return read.kind === "checkpoint" ? read.checkpoint.lastGoodSnapshotAt : null;
}

/** Yield a collection and wait until the daemon has accepted it (its checkpoint says so). */
async function* accept(w: World, rows: JsonValue[] = [], health: JsonValue = OK_HEALTH): AsyncGenerator<SourceMessage> {
  const json = collection(w, rows, health) as Record<string, JsonValue>;
  yield payload(json);
  await until(() => acceptedAt(w) === json["collectedAt"], "the collection to be accepted");
}

describe("duplicates: two taps, and a lost response", () => {
  test("two taps are two nonce files and one invocation, and both land in done/", async () => {
    const w = await rebootedWorld();
    const [a] = w.names as [string];
    tap(w, a);
    tap(w, a);
    expect(filesIn(w, "pending")).toHaveLength(2);
    await daemon(
      w,
      async function* () {
        yield* accept(w);
        await until(() => filesIn(w, "done").length === 2, "both taps in done/");
      },
      { port: w.port },
    );
    expect(w.port.invocations).toBe(1);
    expect(markerLines(w.port.markerPath)).toHaveLength(1);
    expect(filesIn(w, "pending")).toEqual([]);
    await expectFeedPublishes(w);
  });

  test("the launch succeeded and the move to done/ was lost: the restart settles it through inspect, with no second invocation", async () => {
    const w = await rebootedWorld();
    const [a] = w.names as [string];
    tap(w, a);
    await daemon(
      w,
      async function* () {
        yield* accept(w);
        await until(() => filesIn(w, "done").length === 1, "the request in done/");
      },
      { port: w.port },
    );
    expect(markerLines(w.port.markerPath)).toHaveLength(1);
    // THE CRASH: the disk as it was between the launch and the move — the
    // request still pending, no done/ record. The protocol kept its occurrence.
    const [name] = filesIn(w, "done") as [string];
    const donePath = join(w.root, RECOVERY_RESUME_DIR, "done", name);
    const request = (JSON.parse(readFileSync(donePath, "utf8")) as { request: unknown }).request;
    writeFileSync(join(w.root, RECOVERY_RESUME_DIR, "pending", name), `${JSON.stringify(request, null, 2)}\n`);
    unlinkSync(donePath);
    await daemon(
      w,
      async function* () {
        yield* accept(w);
        await until(() => filesIn(w, "done").length === 1 && filesIn(w, "pending").length === 0, "the replayed request settled");
      },
      { port: w.port },
    );
    expect(w.port.invocations).toBe(1);
    expect(w.port.calls).toHaveLength(1);
    expect(markerLines(w.port.markerPath)).toHaveLength(1);
    expect(stateOf(w, a)).toMatchObject({ kind: "launched" });
  });
});

describe("revalidation through the daemon", () => {
  test("already resumed elsewhere: a live row holds the conversation — refused, no invocation", async () => {
    const w = await rebootedWorld();
    const [a] = w.names as [string];
    tap(w, a);
    await daemon(
      w,
      async function* () {
        // The same run, still live: the same token, so nothing derives `resumed`.
        yield* accept(w, [rowFor(w, a, BEFORE_TOKEN(0))]);
        await until(() => filesIn(w, "refused").length === 1, "the refusal");
      },
      { port: w.port },
    );
    expect(refusedWhy(w)[0]).toContain("already resumed elsewhere");
    expect(w.port.invocations).toBe(0);
    expect(markerLines(w.port.markerPath)).toHaveLength(0);
  });

  test("missing transcript after the preview: refused, and a re-tap is allowed", async () => {
    const w = await rebootedWorld();
    const [a] = w.names as [string];
    await daemon(
      w,
      async function* () {
        yield* accept(w);
        await until(() => resumeOf(w)?.previews.some((p) => p.candidateId === idOf(w, a) && p.brief.kind === "quoted") ?? false, "a preview");
      },
      { port: w.port },
    );
    const preview = resumeOf(w)?.previews.find((p) => p.candidateId === idOf(w, a));
    expect(preview?.brief).toEqual({ kind: "quoted", text: `the brief for ${a}`, truncated: false });
    expect(preview?.lastWords).toEqual({ kind: "quoted", text: `${a} got this far`, truncated: false });
    expect(preview?.account).toMatchObject({ kind: "pinned", name: "ri-pool" });
    tap(w, a);
    rmSync(transcriptPath(w, a));
    await daemon(
      w,
      async function* () {
        yield* accept(w);
        await until(() => filesIn(w, "refused").length === 1, "the refusal");
      },
      { port: w.port },
    );
    expect(refusedWhy(w)[0]).toContain("the transcript is gone since the preview");
    expect(markerLines(w.port.markerPath)).toHaveLength(0);
    expect(stateOf(w, a)).toMatchObject({ kind: "refused" });
    await expectFeedPublishes(w);
    // Tapping again is allowed: nothing holds the name.
    expect(() => tap(w, a)).not.toThrow();
  });

  test("changed since you looked: seen.dir differs from the current entry — refused", async () => {
    const w = await rebootedWorld();
    const [a, b] = w.names as [string, string];
    tap(w, a, { dir: w.dirs.get(b) as string });
    await daemon(
      w,
      async function* () {
        yield* accept(w);
        await until(() => filesIn(w, "refused").length === 1, "the refusal");
      },
      { port: w.port },
    );
    expect(refusedWhy(w)[0]).toContain("changed since you looked");
    expect(markerLines(w.port.markerPath)).toHaveLength(0);
  });

  test("unknowns stay put: the CLI refuses an ended-before-reboot or unknown record, and the daemon refuses one requested anyway", async () => {
    const w = await rebootedWorld({ exited: "arch-a10-style-ownership" });
    const ended = "arch-a10-style-ownership";
    const lines: string[] = [];
    expect(await recoveryCli(["resume", idOf(w, ended)], { root: w.root, out: (l) => lines.push(l) })).toBe(2);
    expect(lines.join("\n")).toContain("ended-before-reboot");
    expect(filesIn(w, "pending")).toEqual([]);

    // Requested anyway, straight through the leaf: the daemon refuses it at revalidation.
    tap(w, ended);
    await daemon(
      w,
      async function* () {
        yield* accept(w);
        await until(() => filesIn(w, "refused").length === 1, "the refusal");
      },
      { port: w.port },
    );
    expect(refusedWhy(w)[0]).toContain("ended-before-reboot");
    expect(markerLines(w.port.markerPath)).toHaveLength(0);

    // A daemon that has accepted nothing in its life classifies every record unknown; the CLI refuses those too.
    await daemon(w, async function* () {});
    const unknownLines: string[] = [];
    const [a] = w.names as [string];
    expect(await recoveryCli(["resume", idOf(w, a)], { root: w.root, out: (l) => unknownLines.push(l) })).toBe(2);
    expect(unknownLines.join("\n")).toContain("unknown");
    const opened = openStore({ root: w.root });
    if (!opened.ok) throw new Error("the store did not open");
    expect([...opened.store.recovery.records.values()].every((r) => r.resolution.disposition === "unresolved")).toBe(true);
    opened.store.close();
  });
});

describe("the gates and the unwired capability", () => {
  test("a critical box defers the request: never refused, never launched, and the page says why", async () => {
    const w = await rebootedWorld();
    const [a] = w.names as [string];
    tap(w, a);
    await daemon(
      w,
      async function* () {
        yield* accept(w, [], { verdict: { level: "critical" } });
        await until(() => (stateOf(w, a)?.kind === "pending" && "why" in (stateOf(w, a) ?? {}) && JSON.stringify(stateOf(w, a)).includes("critical")) || false, "the deferral");
      },
      { port: w.port },
    );
    expect(filesIn(w, "pending")).toHaveLength(1);
    expect(filesIn(w, "refused")).toEqual([]);
    expect(markerLines(w.port.markerPath)).toHaveLength(0);
    expect(resumeOf(w)?.gate).toMatchObject({ kind: "held" });
  });

  test("unwired: requests queue, nothing is refused, nothing launches, and `list` says so", async () => {
    const w = await rebootedWorld();
    const [a] = w.names as [string];
    tap(w, a);
    await daemon(w, async function* () {
      yield* accept(w);
      // The previews need this run's view pass, which may finish after the first resume pass.
      await until(
        () => resumeOf(w)?.launcher.kind === "unwired" && stateOf(w, a)?.kind === "pending" && resumeOf(w)?.previews.length === 3,
        "the unwired projection, with its previews",
      );
    });
    expect(filesIn(w, "pending")).toHaveLength(1);
    expect(filesIn(w, "done")).toEqual([]);
    expect(filesIn(w, "refused")).toEqual([]);
    expect(w.port.calls).toHaveLength(0);
    const out: string[] = [];
    expect(await recoveryCli(["list"], { root: w.root, out: (l) => out.push(l) })).toBe(0);
    expect(out.join("\n")).toContain("resume      NOT WIRED");
    expect(out.join("\n")).toContain("    resume     pending #1");
    const projection = await expectFeedPublishes(w);
    expect(projection.launcher.kind).toBe("unwired");
    expect(projection.previews).toHaveLength(3);
  });

  test("a restart with requests pending: they survive, the queue order is kept, and the oldest launches first", async () => {
    const w = await rebootedWorld();
    const [a, b] = w.names as [string, string];
    tap(w, a);
    tap(w, b);
    for (let i = 0; i < 2; i += 1) {
      // A new clock reading per run, so this run's projection is told apart
      // from the last run's: a restarted daemon's first checkpoint writes the
      // file without `resume` until its first pass, by design (derived, never restored).
      w.clock.advance(1000);
      await daemon(w, async function* () {
        yield* accept(w);
        await until(() => resumeOf(w)?.writtenAt === w.clock.now().toISOString() && stateOf(w, b)?.kind === "pending", "this run's projection");
      });
      expect(filesIn(w, "pending")).toHaveLength(2);
      expect(stateOf(w, a)).toMatchObject({ kind: "pending", position: 1 });
      expect(stateOf(w, b)).toMatchObject({ kind: "pending", position: 2 });
    }
    await daemon(
      w,
      async function* () {
        yield* accept(w);
        await until(() => markerLines(w.port.markerPath).length === 1, "the first launch");
      },
      { port: w.port },
    );
    expect(markerLines(w.port.markerPath)[0]?.candidateId).toBe(idOf(w, a));
  });
});

describe("partial success across a list, one at a time", () => {
  test("A launches; B waits for A's verification; B is refused (its directory went); two minutes after A's verification, C launches", async () => {
    const w = await rebootedWorld();
    const [a, b, c] = w.names as [string, string, string];
    tap(w, a);
    tap(w, b);
    tap(w, c);
    await daemon(
      w,
      async function* () {
        yield* accept(w);
        await until(() => markerLines(w.port.markerPath).length === 1, "A's launch");
        expect(markerLines(w.port.markerPath)[0]?.candidateId).toBe(idOf(w, a));
        await until(() => JSON.stringify(stateOf(w, b) ?? {}).includes("to be verified running"), "B waiting for A");

        // A comes up: the protocol sees it running, the inventory sees its
        // conversation live under a new run, and its transcript grows.
        w.port.set(idOf(w, a), { state: "observed-running", reservationHeld: false });
        appendFileSync(
          transcriptPath(w, a),
          `${JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "back" }] }, sessionId: w.conversations.get(a), timestamp: new Date(w.clock.ms() + 1000).toISOString() })}\n`,
        );
        yield* accept(w, [rowFor(w, a, NEW_TOKEN(0))]);
        await until(() => resumedIn(w, a), "A's resumed disposition");
        await until(() => stateOf(w, a)?.kind === "resumed", "A verified");

        // B's directory goes while spacing holds it: deferred, not yet refused.
        rmSync(w.dirs.get(b) as string, { recursive: true, force: true });
        await until(() => JSON.stringify(stateOf(w, b) ?? {}).includes("spacing"), "B spaced");
        expect(filesIn(w, "refused")).toEqual([]);
        expect(markerLines(w.port.markerPath)).toHaveLength(1);

        w.clock.advance(RESUME_SPACING_MS + 1000);
        await until(() => markerLines(w.port.markerPath).length === 2, "C's launch");
      },
      { port: w.port },
    );
    expect(markerLines(w.port.markerPath).map((m) => m.candidateId)).toEqual([idOf(w, a), idOf(w, c)]);
    expect(w.port.invocations).toBe(2);
    expect(refusedWhy(w)).toHaveLength(1);
    expect(refusedWhy(w)[0]).toContain("the directory is missing");
    // Every state this story produced, through the fleet's own parser.
    const projection = await expectFeedPublishes(w);
    expect(projection.requests.find((r) => r.candidateId === idOf(w, a))?.state.kind).toBe("resumed");
    expect(projection.requests.find((r) => r.candidateId === idOf(w, b))?.state.kind).toBe("refused");
    expect(projection.requests.find((r) => r.candidateId === idOf(w, c))?.state.kind).toBe("launched");
  });
});

describe("the synchronous recapture (G5)", () => {
  test("a newer accepted snapshot with a live matching execution, arriving while the pass is in its async phase: zero invocations", async () => {
    const w = await rebootedWorld();
    const [a] = w.names as [string];
    const reached = deferred();
    const release = deferred();
    let paused = false;
    await daemon(
      w,
      async function* () {
        yield* accept(w);
        // The tap comes after a trusted inventory, so the pass that pauses captured one.
        tap(w, a);
        await reached.promise;
        yield* accept(w, [rowFor(w, a, NEW_TOKEN(0))]);
        await until(() => resumedIn(w, a), "the resumed disposition");
        release.resolve();
        await until(() => filesIn(w, "refused").length === 1, "the refusal");
      },
      {
        port: w.port,
        beforeRecapture: async () => {
          if (paused) return;
          paused = true;
          reached.resolve();
          await release.promise;
        },
      },
    );
    expect(paused).toBe(true);
    expect(w.port.invocations).toBe(0);
    expect(markerLines(w.port.markerPath)).toHaveLength(0);
    expect(refusedWhy(w)[0]).toMatch(/already resolved as resumed|already resumed elsewhere/);
  });
});

describe("recovery.json with the resume field (G9)", () => {
  test("it is restored by the store, and a malformed resume never breaks the restore", async () => {
    const w = await rebootedWorld();
    const [a] = w.names as [string];
    tap(w, a);
    await daemon(w, async function* () {
      yield* accept(w);
      await until(() => stateOf(w, a)?.kind === "pending", "the projection");
    });
    const path = join(w.root, RECOVERY_FILE);
    expect(recoveryJson(w).resume?.schema).toBe(1);
    await expectFeedPublishes(w);
    for (const resume of [undefined, { schema: 99, requests: "not a list" }, 42, "garbage", null]) {
      const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      if (resume === undefined) delete raw["resume"];
      else raw["resume"] = resume;
      writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`);
      const opened = openStore({ root: w.root });
      if (!opened.ok) throw new Error("the store did not open");
      expect(opened.store.opening.recovery.kind).toBe("restored");
      expect(opened.store.recovery.records.size).toBe(3);
      opened.store.close();
      const read = readRecoveryIndexFile(w.root);
      expect(read.kind).toBe("file");
      const out: string[] = [];
      expect(await recoveryCli(["list"], { root: w.root, out: (l) => out.push(l) })).toBe(0);
      expect(out.join("\n")).toContain("records     3");
    }
  });
});
