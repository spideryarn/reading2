/**
 * The recovery journal through the real parser, gate, differ and store, driven
 * by a scripted source —
 * docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md
 * § Stage 1. The harness is tests/overseer-daemon-ordering.test.ts's shape;
 * neither that file nor tests/overseer-daemon.test.ts is edited.
 *
 * THE PAYLOADS ARE REAL CAPTURES, EDITED AND SAYING SO. A reboot is
 * `session-new-before` wearing a producer stamp from a new dashboard run, with
 * `rows: []` and `tmuxServerPid: null` — exactly what the first collection
 * after a reboot looks like before tmux is back. The run ids, boot ids and the
 * second tmux generation are minted for this file.
 */
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { main as recoveryCli } from "../scripts/overseer-recovery.js";
import type { OverseerEvent } from "../tools/overseer/diff.js";
import { BASELINE_FILE, runOverseer, type DaemonOptions } from "../tools/overseer/daemon.js";
import type { JsonValue } from "../tools/overseer/observation.js";
import { drainRecoveryInbox, RECOVERY_INBOX_DIR } from "../tools/overseer/recovery-inbox.js";
import type { RecoveryView } from "../tools/overseer/recovery-view.js";
import type { RecoveryCandidateEvent, RecoveryDispositionEvent, RecoveryRecord } from "../tools/overseer/recovery.js";
import type { ReportDrainOutcome } from "../tools/overseer/reports.js";
import type { SourceMessage } from "../tools/overseer/source.js";
import { CHECKPOINT_FILE, EVENTS_FILE, openStore, readCheckpoint, type RegisterEntry } from "../tools/overseer/store.js";
import { editableFixture, rowsOf, type FixtureName } from "./overseer-fixtures.js";

const RECOVERY_FILE = "recovery.json";

/** Dashboard runs, minted for this file. */
const RUN_A = "3a9c1e7b";
const RUN_B = "e4d2b6f0";
const RUN_C = "5c7a9e1d";

/** Host boot ids, minted for this file. */
const BOOT_ONE = "ri-daemon-boot-one";
const BOOT_TWO = "ri-daemon-boot-two";

/** The captures' tmux generation, and a second one minted for this file. */
const G1 = 132280;
const G2 = 140777;

const BEFORE_AT = "2026-09-08T02:47:22.686Z";
const LATER = "2026-09-08T02:52:00.000Z";
const LATER_STILL = "2026-09-08T02:55:00.000Z";
const LATEST = "2026-09-08T02:58:00.000Z";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-recovery-daemon-test-"));
  roots.push(root);
  return root;
}

function fakeClock(startIso: string): { now: () => Date } {
  const ms = Date.parse(startIso);
  return { now: () => new Date(ms) };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function nextTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function payload(json: JsonValue, via: "sse" | "poll" = "sse"): SourceMessage {
  return { kind: "payload", via, atMs: 0, json };
}

function stamped(
  name: FixtureName,
  stamp: { instance: string; publication: number; inventory: number | null },
  changes: Record<string, JsonValue> = {},
): JsonValue {
  return { ...editableFixture(name), ...changes, producer: stamp } as unknown as JsonValue;
}

/** The first collection after a reboot: a new dashboard run, no tmux server yet, no sessions. */
function rebootedEmpty(instance: string, inventory: number, collectedAt: string): JsonValue {
  return stamped("session-new-before", { instance, publication: inventory, inventory }, { rows: [], tmuxServerPid: null, collectedAt });
}

/** The evidence pass's world: an empty projects directory, a fixed host, and a stat that sees only `dirs`. */
function evidenceWorld(dirs: readonly string[] = []): NonNullable<DaemonOptions["recovery"]> {
  return {
    projectsDir: tempRoot(),
    hostname: () => "ri-daemon-host",
    stat: async (path: string) => {
      if (dirs.includes(path)) return { isDirectory: () => true, isFile: () => false, mtimeMs: Date.parse("2026-09-08T02:00:00.000Z") };
      const error = new Error(`ENOENT: no such file or directory, stat '${path}'`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    },
  };
}

async function run(
  root: string,
  script: () => AsyncGenerator<SourceMessage>,
  options: { bootId?: () => string | null; recovery?: DaemonOptions["recovery"] } = {},
): Promise<OverseerEvent[]> {
  const clock = fakeClock("2026-09-08T02:48:40.000Z");
  const outcome = await runOverseer({
    root,
    baseUrl: "http://127.0.0.1:0",
    signal: new AbortController().signal,
    now: clock.now,
    tickMs: 5,
    log: () => {},
    source: () => script(),
    bootId: options.bootId ?? (() => BOOT_ONE),
    recovery: options.recovery ?? evidenceWorld(),
  });
  expect(outcome.kind).toBe("stopped");
  return eventsIn(root);
}

function eventsIn(root: string): OverseerEvent[] {
  const path = join(root, EVENTS_FILE);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as OverseerEvent);
}

function candidates(events: readonly OverseerEvent[]): RecoveryCandidateEvent[] {
  return events.flatMap((e) => (e.kind === "recovery-candidate" ? [e] : []));
}

function register(root: string): readonly RegisterEntry[] {
  const read = readCheckpoint(root);
  if (read.kind !== "checkpoint") throw new Error("expected a checkpoint");
  return read.checkpoint.register;
}

/** The index as the store holds it after the daemon has gone: opened, read, closed. */
function index(root: string): RecoveryRecord[] {
  const opened = openStore({ root });
  if (!opened.ok) throw new Error(`the store would not open: ${JSON.stringify(opened.refusal)}`);
  try {
    return [...opened.store.recovery.records.values()];
  } finally {
    opened.store.close();
  }
}

/** Every candidate is immediately followed by the gone it explains: same key, same instant. */
function expectPaired(events: readonly OverseerEvent[]): void {
  events.forEach((event, i) => {
    if (event.kind !== "recovery-candidate") return;
    const next = events[i + 1];
    expect(next?.kind).toBe("tmux-session-gone");
    if (next?.kind !== "tmux-session-gone") return;
    expect(next.key).toBe(event.entry.key);
    expect(next.at).toBe(event.at);
  });
}

/** `session-new-before` with a verified run and a long title on its first row. */
function beforeWithAVerifiedRun(stamp: { instance: string; publication: number; inventory: number | null }): JsonValue {
  const fixture = editableFixture("session-new-before");
  const rows = rowsOf(fixture);
  const first = rows[0];
  if (first === undefined) throw new Error("the capture has rows");
  first["title"] = "a".repeat(300);
  first["execution"] = {
    kind: "verified",
    token: { boot: "ri-exec-boot", pid: 4242, startTicks: 99 },
    harness: "claude-code",
    conversation: { kind: "verified", id: first["claudeSessionId"] as string },
  };
  return { ...fixture, rows, producer: stamp } as unknown as JsonValue;
}

describe("a reboot", () => {
  test("the first accepted empty post-reboot snapshot: every session gets a candidate before its gone, and the index keeps them", async () => {
    const root = tempRoot();
    await run(root, async function* () {
      yield payload(beforeWithAVerifiedRun({ instance: RUN_A, publication: 1, inventory: 1 }));
    });
    const entriesBefore = register(root);
    expect(entriesBefore).toHaveLength(6);

    // The box reboots: a new daemon, a new dashboard run, no tmux server yet.
    const events = await run(root, async function* () {
      yield payload(rebootedEmpty(RUN_B, 1, LATER));
    });
    const tail = events.slice(6);
    expect(tail.map((e) => e.kind)).toEqual(Array.from({ length: 6 }, () => ["recovery-candidate", "tmux-session-gone"]).flat());
    expectPaired(events);
    // ONE APPEND: every line of it shares the collection's arrival instant.
    expect(new Set(tail.map((e) => e.at)).size).toBe(1);
    expect(register(root)).toEqual([]);

    const records = index(root);
    expect(records).toHaveLength(6);
    for (const entry of entriesBefore) {
      const record = records.find((r) => r.key === entry.key);
      if (record === undefined || record.oversize) throw new Error(`no full record for ${entry.name}`);
      expect(record.entry).toEqual(entry);
      expect(record.resolution).toEqual({ disposition: "unresolved" });
      expect(record.disappearance).toMatchObject({
        goneWhy: "absent-from-snapshot",
        observation: `run ${RUN_B} collection 1`,
        generation: "unverifiable",
        bootChanged: false,
        producerRun: "changed",
        watched: true,
      });
    }
    const verified = candidates(events).find((c) => c.lastSeen?.harness === "claude-code");
    expect(verified?.lastSeen?.executionToken).toBe("ri-exec-boot:4242:99");
    expect(verified?.lastSeen?.title).toHaveLength(200);
    expect(verified?.lastSeen?.collectedAt).toBe(BEFORE_AT);
    expect(verified?.lastSeen?.conversation?.kind).toBe("verified");
  });

  test("a generation change with sessions back: a candidate for every old row and none for the new", async () => {
    const root = tempRoot();
    const events = await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }));
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 2, inventory: 2 }, { tmuxServerPid: G2, collectedAt: LATER }));
    });
    const found = candidates(events);
    expect(found).toHaveLength(6);
    expectPaired(events);
    for (const c of found) {
      expect(c.entry.tmuxServerPid).toBe(G1);
      expect(c.disappearance.generation).toBe("changed");
      expect(c.disappearance.goneWhy).toBe("tmux-server-changed");
    }
    expect(register(root).every((entry) => entry.tmuxServerPid === G2)).toBe(true);
  });

  test("a reboot that reuses the tmux pid: the boot id changed, so every old entry gets a candidate and its gone", async () => {
    const root = tempRoot();
    await run(
      root,
      async function* () {
        yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }));
      },
      { bootId: () => BOOT_ONE },
    );
    // Same pid, same handles, same rows — only the boot id says it is a different world.
    const events = await run(
      root,
      async function* () {
        yield payload(stamped("session-new-before", { instance: RUN_B, publication: 1, inventory: 1 }, { collectedAt: LATER }));
      },
      { bootId: () => BOOT_TWO },
    );
    const tail = events.slice(6);
    expect(tail.map((e) => e.kind)).toEqual([
      ...Array.from({ length: 6 }, () => ["recovery-candidate", "tmux-session-gone"]).flat(),
      ...Array(6).fill("session-seen"),
    ]);
    expectPaired(events);
    for (const c of candidates(events)) {
      expect(c.disappearance).toMatchObject({ bootChanged: true, generation: "changed", goneWhy: "tmux-server-changed", hostBootId: BOOT_TWO });
    }
    expect(register(root)).toHaveLength(6);
  });

  test("a boot change closes the old world even when the new populated generation is unreadable", async () => {
    const root = tempRoot();
    await run(
      root,
      async function* () {
        yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }));
      },
      { bootId: () => BOOT_ONE },
    );

    // The rows cannot become a differ baseline without a tmux generation, but
    // the kernel boot id independently proves that every stored entry belongs
    // to an old world and must be journalled now.
    const held = await run(
      root,
      async function* () {
        yield payload(
          stamped("session-new-before", { instance: RUN_B, publication: 1, inventory: 1 }, { tmuxServerPid: null, collectedAt: LATER }),
        );
      },
      { bootId: () => BOOT_TWO },
    );
    expect(candidates(held)).toHaveLength(6);
    expect(index(root)).toHaveLength(6);

    // No stale old-world baseline may survive the close-out. Once the producer
    // can name the generation, its rows start the new world without another
    // recovery candidate, even though tmux reused the old pid and handles.
    const recovered = await run(
      root,
      async function* () {
        yield payload(stamped("session-new-before", { instance: RUN_B, publication: 2, inventory: 2 }, { collectedAt: LATER_STILL }));
      },
      { bootId: () => BOOT_TWO },
    );
    expect(candidates(recovered)).toHaveLength(6);
    expect(register(root)).toHaveLength(6);
  });

  test("an unreadable boot id concludes nothing: the pid rule applies as today", async () => {
    const root = tempRoot();
    await run(
      root,
      async function* () {
        yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }));
      },
      { bootId: () => BOOT_ONE },
    );
    const events = await run(
      root,
      async function* () {
        yield payload(stamped("session-new-before", { instance: RUN_B, publication: 1, inventory: 1 }, { collectedAt: LATER }));
      },
      { bootId: () => null },
    );
    expect(events).toHaveLength(6);
    // And the boot id it did know is still the one it knows.
    const later = await run(
      root,
      async function* () {
        yield payload(stamped("session-new-before", { instance: RUN_B, publication: 2, inventory: 2 }, { collectedAt: LATER_STILL }));
      },
      { bootId: () => BOOT_TWO },
    );
    expect(candidates(later)).toHaveLength(6);
  });
});

describe("closes that are not interruptions, and the one the daemon did not watch", () => {
  test("an ordinary close — same generation, same run, watched — gets no candidate", async () => {
    const root = tempRoot();
    const events = await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }));
      yield payload(stamped("session-new-after", { instance: RUN_A, publication: 2, inventory: 2 }));
    });
    expect(events.filter((e) => e.kind === "tmux-session-gone")).toHaveLength(1);
    expect(candidates(events)).toEqual([]);
  });

  test("goneWhileAway: the daemon had no baseline, so the candidate is unwatched", async () => {
    const root = tempRoot();
    await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }));
    });
    rmSync(join(root, BASELINE_FILE));
    const events = await run(root, async function* () {
      yield payload(stamped("session-new-after", { instance: RUN_A, publication: 2, inventory: 2 }));
    });
    const found = candidates(events);
    expect(found).toHaveLength(1);
    expectPaired(events);
    expect(found[0]?.disappearance.watched).toBe(false);
    expect(found[0]?.lastSeen).toBeNull();
    expect(found[0]?.entry.tmuxId).toBe("$1992");
  });
});

/** Copy a store directory, so a test can put the disk back the way it was at a crash. */
function snapshotDir(root: string): string {
  const copy = tempRoot();
  cpSync(root, copy, { recursive: true });
  return copy;
}

function restoreFiles(from: string, to: string, files: readonly string[]): void {
  for (const file of files) cpSync(join(from, file), join(to, file));
}

describe("crashes", () => {
  test("before the candidate append: nothing of the batch is on disk, the restart re-diffs, and there is exactly one candidate per session", async () => {
    const root = tempRoot();
    await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }));
    });
    const atCrash = snapshotDir(root);
    // The run that died: it got as far as this batch and no further. Its
    // effects are then taken off the disk, which is the crash.
    await run(root, async function* () {
      yield payload(rebootedEmpty(RUN_B, 1, LATER));
    });
    rmSync(root, { recursive: true, force: true });
    cpSync(atCrash, root, { recursive: true });

    const events = await run(root, async function* () {
      yield payload(rebootedEmpty(RUN_B, 1, LATER));
    });
    expect(candidates(events)).toHaveLength(6);
    expect(index(root)).toHaveLength(6);
  });

  test("after the append and before the baseline: the re-derived gones bring no second candidate", async () => {
    const root = tempRoot();
    await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }));
    });
    const atCrash = snapshotDir(root);
    await run(root, async function* () {
      yield payload(rebootedEmpty(RUN_B, 1, LATER));
    });
    // The log keeps the batch; the baseline, the checkpoint and the index are
    // the ones from before it.
    restoreFiles(atCrash, root, [BASELINE_FILE, CHECKPOINT_FILE, RECOVERY_FILE]);

    const events = await run(root, async function* () {
      yield payload(rebootedEmpty(RUN_B, 1, LATER));
    });
    expect(candidates(events)).toHaveLength(6);
    expect(index(root)).toHaveLength(6);
  });

  test("between candidate and removal: a whole candidate line, a torn gone, re-derived from a later collection — one record", async () => {
    const root = tempRoot();
    await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }));
    });
    const atCrash = snapshotDir(root);
    const bytesBefore = statSync(join(root, EVENTS_FILE)).size;
    await run(root, async function* () {
      yield payload(rebootedEmpty(RUN_B, 1, LATER));
    });
    const full = readFileSync(join(root, EVENTS_FILE));
    const batch = full.subarray(bytesBefore).toString("utf8").split("\n");
    const [candidateLine, goneLine] = batch;
    if (candidateLine === undefined || goneLine === undefined) throw new Error("expected the batch");
    const tornEra = JSON.parse(candidateLine) as RecoveryCandidateEvent;
    expect(tornEra.kind).toBe("recovery-candidate");
    writeFileSync(
      join(root, EVENTS_FILE),
      Buffer.concat([full.subarray(0, bytesBefore), Buffer.from(`${candidateLine}\n${goneLine.slice(0, Math.floor(goneLine.length / 2))}`)]),
    );
    restoreFiles(atCrash, root, [BASELINE_FILE, CHECKPOINT_FILE, RECOVERY_FILE]);

    const events = await run(root, async function* () {
      yield payload(rebootedEmpty(RUN_B, 2, LATER_STILL));
    });
    // Seven candidate lines in the log — the torn era's and six re-derived —
    // and one record per session.
    expect(candidates(events)).toHaveLength(7);
    const records = index(root);
    expect(records).toHaveLength(6);
    const first = records.find((r) => r.key === tornEra.entry.key);
    expect(first?.id).toBe(tornEra.id);
  });

  test("before the recovery checkpoint: recovery.json is behind current.json, and the index matches a fold from byte 0", async () => {
    const root = tempRoot();
    await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }));
    });
    const atCrash = snapshotDir(root);
    await run(root, async function* () {
      yield payload(rebootedEmpty(RUN_B, 1, LATER));
    });
    restoreFiles(atCrash, root, [RECOVERY_FILE]);
    const fromTail = index(root);

    const fromZero = tempRoot();
    cpSync(join(root, EVENTS_FILE), join(fromZero, EVENTS_FILE));
    const derived = index(fromZero);

    expect(fromTail).toHaveLength(6);
    expect(fromTail).toEqual(derived);
  });
});

describe("distinct disappearances of one run (Sol's F3)", () => {
  test("a dismissed candidate; the identical row comes back; a later collection removes it again — a new, unresolved id", async () => {
    const root = tempRoot();
    await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }));
      yield payload(rebootedEmpty(RUN_B, 1, LATER));
    });
    const first = index(root);
    expect(first).toHaveLength(6);
    const dismissed = first[0];
    if (dismissed === undefined) throw new Error("expected a record");

    const opened = openStore({ root });
    if (!opened.ok) throw new Error("expected the store to open");
    opened.store.append([
      {
        kind: "recovery-disposition",
        at: "2026-09-08T02:53:00.000Z",
        id: dismissed.id,
        disposition: "dismissed",
        evidence: { requestId: "req-ri-daemon-1", why: "looked at it by hand" },
      },
    ]);
    opened.store.checkpoint({ lastGoodSnapshotAt: LATER, tick: false });
    opened.store.close();

    await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_B, publication: 2, inventory: 2 }, { collectedAt: LATER_STILL }));
      yield payload(rebootedEmpty(RUN_B, 3, LATEST));
    });
    const records = index(root);
    const forKey = records.filter((r) => r.key === dismissed.key);
    expect(forKey).toHaveLength(2);
    expect(forKey.find((r) => r.id === dismissed.id)?.resolution.disposition).toBe("dismissed");
    const again = forKey.find((r) => r.id !== dismissed.id);
    expect(again?.resolution).toEqual({ disposition: "unresolved" });
  });
});

describe("the index survives the fleet being empty", () => {
  test("a later run with the fleet back does not disturb what the index holds", async () => {
    const root = tempRoot();
    await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }));
      yield payload(rebootedEmpty(RUN_B, 1, LATER));
      yield payload(stamped("session-new-before", { instance: RUN_C, publication: 1, inventory: 1 }, { collectedAt: LATER_STILL }));
    });
    expect(index(root)).toHaveLength(6);
    expect(register(root)).toHaveLength(6);
  });
});

// ═══ Stage 2: the view, the dispositions and the inbox ═══════════════════════

const PRIMARY = "/home/greg/code/spideryarn2";
const SHELL_DIR = "/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store";

/** The view the daemon last wrote into recovery.json. */
function viewIn(root: string): RecoveryView {
  const parsed = JSON.parse(readFileSync(join(root, RECOVERY_FILE), "utf8")) as { view?: RecoveryView | null };
  if (parsed.view === undefined || parsed.view === null) throw new Error("recovery.json carries no view");
  return parsed.view;
}

function dispositions(events: readonly OverseerEvent[]): RecoveryDispositionEvent[] {
  return events.flatMap((e) => (e.kind === "recovery-disposition" ? [e] : []));
}

/** `session-new-before` whose first row holds a verified run of its own claim under `token`. */
function verifiedFirstRow(
  stamp: { instance: string; publication: number; inventory: number | null },
  token: { boot: string; pid: number; startTicks: number },
  changes: Record<string, JsonValue> = {},
): JsonValue {
  const fixture = editableFixture("session-new-before");
  const rows = rowsOf(fixture);
  const first = rows[0];
  if (first === undefined) throw new Error("the capture has rows");
  first["execution"] = {
    kind: "verified",
    token,
    harness: "claude-code",
    conversation: { kind: "verified", id: first["claudeSessionId"] as string },
  };
  return { ...fixture, rows, producer: stamp, ...changes } as unknown as JsonValue;
}

/** `session-new-before` with its second row's Claude exited. */
function withAnExitedClaude(stamp: { instance: string; publication: number; inventory: number | null }): JsonValue {
  const fixture = editableFixture("session-new-before");
  const rows = rowsOf(fixture);
  const second = rows[1];
  if (second === undefined) throw new Error("the capture has rows");
  second["status"] = { kind: "no-claude" };
  return { ...fixture, rows, producer: stamp } as unknown as JsonValue;
}

/** The first collection after a reboot with tmux already back: a readable new generation, and no sessions. */
function rebootedEmptyG2(instance: string, inventory: number, collectedAt: string): JsonValue {
  return stamped("session-new-before", { instance, publication: inventory, inventory }, { rows: [], tmuxServerPid: G2, collectedAt });
}

const TOKEN_ONE = { boot: "ri-daemon-exec-boot", pid: 6100, startTicks: 31 };
const TOKEN_TWO = { boot: "ri-daemon-exec-boot", pid: 6200, startTicks: 47 };

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * `run` without its parse of the log: for a store with a planted line nothing
 * can parse, which `eventsIn` would throw on.
 */
async function runRaw(
  root: string,
  script: () => AsyncGenerator<SourceMessage>,
  options: { log?: (line: string) => void; now?: () => Date; recovery?: DaemonOptions["recovery"] } = {},
): Promise<void> {
  const outcome = await runOverseer({
    root,
    baseUrl: "http://127.0.0.1:0",
    signal: new AbortController().signal,
    now: options.now ?? fakeClock("2026-09-08T02:48:40.000Z").now,
    tickMs: 5,
    log: options.log ?? (() => {}),
    source: () => script(),
    bootId: () => BOOT_ONE,
    recovery: options.recovery ?? evidenceWorld(),
  });
  expect(outcome.kind).toBe("stopped");
}

/** Every line of the log that parses, skipping a planted unparseable one. */
function parseableEvents(root: string): OverseerEvent[] {
  return readFileSync(join(root, EVENTS_FILE), "utf8")
    .split("\n")
    .flatMap((line) => {
      try {
        return line === "" ? [] : [JSON.parse(line) as OverseerEvent];
      } catch {
        return [];
      }
    });
}

/** A complete line nothing can parse: the recovery-tail replay refuses its whole range, so the index is `not-run`. */
function plantUnparseableLine(root: string): void {
  appendFileSync(join(root, EVENTS_FILE), "{not an event}\n");
}

function replayKindOf(root: string): string {
  const opened = openStore({ root });
  if (!opened.ok) throw new Error("the store did not open");
  try {
    return opened.store.recovery.replay.kind;
  } finally {
    opened.store.close();
  }
}

describe("the view after a reboot", () => {
  test("an empty rebooted fleet with a readable new generation: every candidate interrupted, or ended-before-reboot where its Claude had exited", async () => {
    const root = tempRoot();
    await run(root, async function* () {
      yield payload(withAnExitedClaude({ instance: RUN_A, publication: 1, inventory: 1 }));
    });
    await run(
      root,
      async function* () {
        yield payload(rebootedEmptyG2(RUN_B, 1, LATER));
      },
      { recovery: evidenceWorld([PRIMARY, SHELL_DIR]) },
    );
    const view = viewIn(root);
    expect(view.inventory.kind).toBe("trusted");
    expect(view.page).toHaveLength(6);
    const kinds = view.page.map((item) => [item.name, item.classification?.kind]);
    expect(kinds.filter(([, kind]) => kind === "ended-before-reboot").map(([name]) => name)).toEqual(["arch-a10-style-ownership"]);
    expect(kinds.filter(([, kind]) => kind === "interrupted")).toHaveLength(5);
    const shell = view.page.find((item) => item.name === "autoperm-fulltest2-0346-4123599");
    expect(shell?.evidence).toMatchObject({ kind: "checked", resume: { kind: "manual", host: "ri-daemon-host", dir: SHELL_DIR } });
  });

  test("a missing directory: dir missing, and the record stays interrupted and unresolved", async () => {
    const root = tempRoot();
    await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }));
    });
    await run(
      root,
      async function* () {
        yield payload(rebootedEmptyG2(RUN_B, 1, LATER));
      },
      { recovery: evidenceWorld([PRIMARY]) },
    );
    const shell = viewIn(root).page.find((item) => item.name === "autoperm-fulltest2-0346-4123599");
    expect(shell?.classification?.kind).toBe("interrupted");
    expect(shell?.resolution).toEqual({ disposition: "unresolved" });
    expect(shell?.evidence).toMatchObject({ kind: "checked", dir: { kind: "missing", path: SHELL_DIR } });
    expect(index(root).every((r) => r.resolution.disposition === "unresolved")).toBe(true);
  });

  test("present-but-unmatched: the same sessions back without a verified matching conversation", async () => {
    const root = tempRoot();
    await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }));
    });
    await run(root, async function* () {
      yield payload(rebootedEmptyG2(RUN_B, 1, LATER));
      yield payload(stamped("session-new-before", { instance: RUN_B, publication: 2, inventory: 2 }, { tmuxServerPid: G2, collectedAt: LATER_STILL }));
    });
    const view = viewIn(root);
    expect(view.page.map((item) => item.classification?.kind)).toEqual(Array(6).fill("present-but-unmatched"));
  });
});

describe("the inventory-trust rule: a refused, failed or held collection after the reboot makes every record unknown", () => {
  async function rebootThen(messages: readonly SourceMessage[]): Promise<RecoveryView> {
    const root = tempRoot();
    await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }));
    });
    await run(root, async function* () {
      // A trusted inventory whose rows would classify every record — and then one that cannot be trusted.
      yield payload(stamped("session-new-before", { instance: RUN_B, publication: 1, inventory: 1 }, { rows: [], tmuxServerPid: G2, collectedAt: LATER }));
      yield payload(stamped("session-new-before", { instance: RUN_B, publication: 2, inventory: 2 }, { tmuxServerPid: G2, collectedAt: LATER_STILL }));
      for (const message of messages) yield message;
    });
    return viewIn(root);
  }

  test("a refused payload", async () => {
    const view = await rebootThen([
      payload(stamped("session-new-before", { instance: RUN_B, publication: 3, inventory: 3 }, { tmuxServerPid: G2, collectedAt: LATEST, error: "tmux list-sessions failed" })),
    ]);
    expect(view.inventory.kind).toBe("untrusted");
    expect(view.page.map((item) => item.classification?.kind)).toEqual(Array(6).fill("unknown"));
  });

  test("a failed collection", async () => {
    const view = await rebootThen([{ kind: "poll-failed", atMs: 0, why: "connect ECONNREFUSED 127.0.0.1:8787" }]);
    expect(view.page.map((item) => item.classification?.kind)).toEqual(Array(6).fill("unknown"));
  });

  test("a held collection", async () => {
    const view = await rebootThen([
      payload(stamped("session-new-before", { instance: RUN_B, publication: 3, inventory: 3 }, { tmuxServerPid: null, collectedAt: LATEST })),
    ]);
    expect(view.page.map((item) => item.classification?.kind)).toEqual(Array(6).fill("unknown"));
  });

  test("a daemon that has accepted nothing in its own life", async () => {
    const root = tempRoot();
    await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }));
      yield payload(rebootedEmptyG2(RUN_B, 1, LATER));
    });
    await run(root, async function* () {});
    const view = viewIn(root);
    expect(view.inventory.kind).toBe("untrusted");
    expect(view.page.map((item) => item.classification?.kind)).toEqual(Array(6).fill("unknown"));
  });

  test("a failed collection cannot be overwritten by an older trusted view pass that finishes afterwards", async () => {
    const root = tempRoot();
    const before = editableFixture("session-new-before");
    const [first] = rowsOf(before);
    if (first === undefined) throw new Error("the fixture has a row");
    await run(root, async function* () {
      yield payload(
        stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }, { rows: [first] }),
      );
      yield payload(rebootedEmptyG2(RUN_B, 1, LATER));
    });
    expect(index(root)).toHaveLength(1);

    const startupStat = deferred();
    const trustedStat = deferred();
    const releaseTrusted = deferred();
    const finalStat = deferred();
    const releaseFinal = deferred();
    let statCalls = 0;
    const observed: { whileFinalPassBlocked: RecoveryView | null } = { whileFinalPassBlocked: null };
    const projectsDir = tempRoot();
    const source = async function* (): AsyncGenerator<SourceMessage> {
      await startupStat.promise;
      // Let the startup pass publish its deliberately untrusted view before
      // the accepted collection asks for the next one.
      await nextTurn();
      await nextTurn();
      yield payload(rebootedEmptyG2(RUN_B, 2, LATER_STILL));
      await trustedStat.promise;
      yield { kind: "poll-failed", atMs: 0, why: "collector failed while evidence was being checked" };
      releaseTrusted.resolve();
      await finalStat.promise;
      // The final, untrusted pass is blocked. Whatever is on disk now is what
      // the completed older pass tried to publish after trust was withdrawn.
      observed.whileFinalPassBlocked = viewIn(root);
      releaseFinal.resolve();
    };
    const outcome = await runOverseer({
      root,
      baseUrl: "http://127.0.0.1:0",
      signal: new AbortController().signal,
      now: fakeClock("2026-09-08T02:48:40.000Z").now,
      tickMs: 60_000,
      log: () => {},
      source: () => source(),
      bootId: () => BOOT_ONE,
      recovery: {
        projectsDir,
        hostname: () => "ri-daemon-host",
        stat: async () => {
          statCalls += 1;
          if (statCalls === 2) startupStat.resolve();
          if (statCalls === 3) {
            trustedStat.resolve();
            await releaseTrusted.promise;
          }
          if (statCalls === 5) {
            finalStat.resolve();
            await releaseFinal.promise;
          }
          const error = new Error("ENOENT") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        },
      },
    });
    expect(outcome.kind).toBe("stopped");
    expect(observed.whileFinalPassBlocked?.inventory.kind).toBe("untrusted");
    expect(observed.whileFinalPassBlocked?.page[0]?.classification?.kind).toBe("unknown");
  });

  test("a slow view pass across two trusted accepts still publishes: only withdrawing trust invalidates it (O5)", async () => {
    const root = tempRoot();
    const [first] = rowsOf(editableFixture("session-new-before"));
    if (first === undefined) throw new Error("the fixture has a row");
    await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }, { rows: [first] }));
      yield payload(rebootedEmptyG2(RUN_B, 1, LATER));
    });
    expect(index(root)).toHaveLength(1);

    // Two stats per pass for this one record: the startup pass is 1–2, the
    // pass the first accept starts is 3–4, and the pass after it begins at 5.
    const startupStat = deferred();
    const passStarted = deferred();
    const releasePass = deferred();
    const nextPass = deferred();
    const releaseNext = deferred();
    let statCalls = 0;
    const observed: { whileNextPassBlocked: RecoveryView | null } = { whileNextPassBlocked: null };
    const source = async function* (): AsyncGenerator<SourceMessage> {
      await startupStat.promise;
      await nextTurn();
      await nextTurn();
      yield payload(rebootedEmptyG2(RUN_B, 2, LATER_STILL));
      await passStarted.promise;
      // A second trusted accept while that pass is still checking evidence.
      yield payload(rebootedEmptyG2(RUN_B, 3, LATEST));
      releasePass.resolve();
      await nextPass.promise;
      // The next pass is blocked, so what is on disk now is what the slow pass
      // did: published, or thrown away as obsolete.
      observed.whileNextPassBlocked = viewIn(root);
      releaseNext.resolve();
    };
    const outcome = await runOverseer({
      root,
      baseUrl: "http://127.0.0.1:0",
      signal: new AbortController().signal,
      now: fakeClock("2026-09-08T02:48:40.000Z").now,
      tickMs: 60_000,
      log: () => {},
      source: () => source(),
      bootId: () => BOOT_ONE,
      recovery: {
        projectsDir: tempRoot(),
        hostname: () => "ri-daemon-host",
        stat: async () => {
          statCalls += 1;
          if (statCalls === 2) startupStat.resolve();
          if (statCalls === 3) {
            passStarted.resolve();
            await releasePass.promise;
          }
          if (statCalls === 5) {
            nextPass.resolve();
            await releaseNext.promise;
          }
          const error = new Error("ENOENT") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        },
      },
    });
    expect(outcome.kind).toBe("stopped");
    expect(observed.whileNextPassBlocked?.inventory).toMatchObject({ kind: "trusted", collectedAt: LATER_STILL });
  });
});

describe("a recovery replay that could not run, and a daemon on its way out", () => {
  test("an accepted collection derives no disposition from the stale fold while the replay is not-run (O1, F21)", async () => {
    const root = tempRoot();
    await run(root, async function* () {
      yield payload(verifiedFirstRow({ instance: RUN_A, publication: 1, inventory: 1 }, TOKEN_ONE));
      yield payload(rebootedEmpty(RUN_B, 1, LATER));
    });
    const target = index(root).find((r) => r.name === "adversarial-fixtures-four-postmortems");
    if (target === undefined) throw new Error("no record for the verified run");

    // A dismissal the fold never saw — fsynced, then a complete line nothing
    // can parse, so the recovery-tail replay refuses the whole range and the
    // fold still says unresolved.
    const opened = openStore({ root });
    if (!opened.ok) throw new Error("the store did not open");
    opened.store.append([
      {
        kind: "recovery-disposition",
        at: LATER_STILL,
        id: target.id,
        disposition: "dismissed",
        evidence: { requestId: randomUUID(), why: "dismissed before the log went bad" },
      },
    ]);
    opened.store.close();
    plantUnparseableLine(root);
    expect(replayKindOf(root)).toBe("not-run");

    // The same conversation, live under a new token: from the stale fold this
    // looks exactly like a resumption.
    await runRaw(root, async function* () {
      yield payload(verifiedFirstRow({ instance: RUN_B, publication: 2, inventory: 2 }, TOKEN_TWO, { tmuxServerPid: G2, collectedAt: LATEST }));
    });
    const mine = dispositions(parseableEvents(root)).filter((d) => d.id === target.id);
    expect(mine.map((d) => d.disposition)).toEqual(["dismissed"]);
  });

  test("a daemon whose source throws stops and releases its lock, although every tick asks for another view (F23)", async () => {
    const root = tempRoot();
    const [first] = rowsOf(editableFixture("session-new-before"));
    if (first === undefined) throw new Error("the fixture has a row");
    await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }, { rows: [first] }));
      yield payload(rebootedEmptyG2(RUN_B, 1, LATER));
    });
    expect(index(root)).toHaveLength(1);

    // A stat slower than the tick, and a view wanted on every tick: while the
    // exceptional path waits for the view pass, the ticks must not keep
    // starting new ones.
    let slow = true;
    const daemon = runOverseer({
      root,
      baseUrl: "http://127.0.0.1:0",
      signal: new AbortController().signal,
      now: fakeClock("2026-09-08T02:48:40.000Z").now,
      tickMs: 5,
      log: () => {},
      source: () =>
        (async function* (): AsyncGenerator<SourceMessage> {
          await sleep(40);
          yield* []; // A source that sends nothing, and then breaks.
          throw new Error("ri2f the source broke");
        })(),
      bootId: () => BOOT_ONE,
      recovery: {
        projectsDir: tempRoot(),
        hostname: () => "ri-daemon-host",
        viewIntervalMs: 0,
        stat: async () => {
          if (slow) await sleep(20);
          const error = new Error("ENOENT") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        },
      },
    });
    const settled = await Promise.race([
      daemon.then(
        () => "returned",
        (cause: unknown) => `threw: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
      sleep(3000).then(() => "still running after 3 s"),
    ]);
    // Let a daemon stuck in the loop quiesce, so a red run does not leak it.
    slow = false;
    await daemon.catch(() => {});
    expect(settled).toBe("threw: ri2f the source broke");
    expect(existsSync(join(root, "overseer.lock"))).toBe(false);
  });

  // F23's class, for the timer dev brought in after it: every interval the
  // daemon starts must be cleared by `stopTimers`, on both ways out. A timer
  // left running calls the reports drain against a closed store forever.
  const QUIET_REPORTS: ReportDrainOutcome = {
    recorded: 0,
    duplicates: 0,
    refused: 0,
    pending: 0,
    deferred: 0,
    skippedEntries: 0,
    quarantined: 0,
    scanned: 0,
    scanCapped: false,
    replayed: 0,
    debrisRemoved: 0,
    probes: 0,
    bytesRead: 0,
    stoppedBy: null,
    notes: [],
  };

  async function reportDrainsAfterStop(stop: "abort" | "throw"): Promise<{ outcome: string; atStop: number; later: number }> {
    const root = tempRoot();
    const controller = new AbortController();
    let calls = 0;
    const daemon = runOverseer({
      root,
      baseUrl: "http://127.0.0.1:0",
      signal: controller.signal,
      now: fakeClock("2026-09-08T02:48:40.000Z").now,
      tickMs: 20,
      log: () => {},
      source: () =>
        (async function* (): AsyncGenerator<SourceMessage> {
          // Several drain intervals while the daemon runs.
          await sleep(120);
          yield* [];
          if (stop === "throw") throw new Error("ri2f the source broke");
          controller.abort();
        })(),
      bootId: () => BOOT_ONE,
      recovery: evidenceWorld(),
      reports: {
        intervalMs: 10,
        drain: () => {
          calls += 1;
          return QUIET_REPORTS;
        },
      },
    });
    const outcome = await daemon.then(
      (result) => result.kind,
      (cause: unknown) => `threw: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    const atStop = calls;
    // Ten intervals after it returned.
    await sleep(100);
    return { outcome, atStop, later: calls };
  }

  test("the reports timer stops with the daemon: a normal stop by the abort signal (F23's class)", async () => {
    const { outcome, atStop, later } = await reportDrainsAfterStop("abort");
    expect(outcome).toBe("stopped");
    // The drain was wired and running before the stop.
    expect(atStop).toBeGreaterThan(0);
    expect(later).toBe(atStop);
  });

  test("the reports timer stops with the daemon: an exceptional stop by a throwing source (F23's class)", async () => {
    const { outcome, atStop, later } = await reportDrainsAfterStop("throw");
    expect(outcome).toBe("threw: ri2f the source broke");
    expect(atStop).toBeGreaterThan(0);
    expect(later).toBe(atStop);
  });
});

describe("already-live", () => {
  test("the same conversation under a different token: resumed is appended once, with both tokens, and a second view appends nothing", async () => {
    const root = tempRoot();
    await run(root, async function* () {
      yield payload(verifiedFirstRow({ instance: RUN_A, publication: 1, inventory: 1 }, TOKEN_ONE));
      yield payload(rebootedEmpty(RUN_B, 1, LATER));
      yield payload(verifiedFirstRow({ instance: RUN_B, publication: 2, inventory: 2 }, TOKEN_TWO, { tmuxServerPid: G2, collectedAt: LATER_STILL }));
    });
    const resumed = dispositions(eventsIn(root));
    expect(resumed).toHaveLength(1);
    expect(resumed[0]).toMatchObject({
      disposition: "resumed",
      evidence: { previousToken: "ri-daemon-exec-boot:6100:31", token: "ri-daemon-exec-boot:6200:47" },
    });
    const record = index(root).find((r) => r.id === resumed[0]?.id);
    expect(record?.resolution.disposition).toBe("resumed");

    await run(root, async function* () {
      yield payload(verifiedFirstRow({ instance: RUN_B, publication: 3, inventory: 3 }, TOKEN_TWO, { tmuxServerPid: G2, collectedAt: LATEST }));
    });
    expect(dispositions(eventsIn(root))).toHaveLength(1);
  });

  test("the same conversation under the same token: already-live, and no disposition", async () => {
    const root = tempRoot();
    await run(root, async function* () {
      yield payload(verifiedFirstRow({ instance: RUN_A, publication: 1, inventory: 1 }, TOKEN_ONE));
      // The same dashboard run loses sight of tmux, then sees the same run again.
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 2, inventory: 2 }, { rows: [], tmuxServerPid: null, collectedAt: LATER }));
      yield payload(verifiedFirstRow({ instance: RUN_A, publication: 3, inventory: 3 }, TOKEN_ONE, { collectedAt: LATER_STILL }));
    });
    expect(dispositions(eventsIn(root))).toEqual([]);
    const first = viewIn(root).page.find((item) => item.name === "adversarial-fixtures-four-postmortems");
    expect(first?.classification).toMatchObject({ kind: "already-live", sameRun: true });
  });
});

describe("dismissal through the inbox", () => {
  async function rebootedStore(): Promise<{ root: string; ids: string[] }> {
    const root = tempRoot();
    await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }));
      yield payload(rebootedEmpty(RUN_B, 1, LATER));
    });
    return { root, ids: index(root).map((r) => r.id) };
  }

  function refusals(root: string): { why: string; request: unknown }[] {
    const dir = join(root, RECOVERY_INBOX_DIR, "refused");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .sort()
      .map((file) => JSON.parse(readFileSync(join(dir, file), "utf8")) as { why: string; request: unknown });
  }

  function pending(root: string): string[] {
    return readdirSync(join(root, RECOVERY_INBOX_DIR)).filter((file) => file !== "refused");
  }

  test("a valid request yields one disposition event, carrying its request id and sentence, and the file is gone", async () => {
    const { root, ids } = await rebootedStore();
    const target = ids[0] as string;
    expect(await recoveryCli(["dismiss", target, "--why", "checked the worktree by hand"], { root, out: () => {} })).toBe(0);
    const [file] = pending(root);
    await run(root, async function* () {});
    const found = dispositions(eventsIn(root));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: target, disposition: "dismissed", evidence: { requestId: (file as string).slice(0, 36), why: "checked the worktree by hand" } });
    expect(index(root).find((r) => r.id === target)?.resolution.disposition).toBe("dismissed");
    expect(pending(root)).toEqual([]);
    expect(refusals(root)).toEqual([]);
  });

  test("a request with a malformed audit timestamp is refused rather than normalized into a valid dismissal", async () => {
    const { root, ids } = await rebootedStore();
    await recoveryCli(["dismiss", ids[0] as string, "--why", "bad timestamp fixture"], { root, out: () => {} });
    const [file] = pending(root);
    if (file === undefined) throw new Error("the CLI wrote no request");
    const path = join(root, RECOVERY_INBOX_DIR, file);
    const request = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    request["requestedAt"] = "2026-09-10";
    writeFileSync(path, `${JSON.stringify(request)}\n`);

    await run(root, async function* () {});
    expect(dispositions(eventsIn(root))).toEqual([]);
    expect(refusals(root)[0]?.why).toContain("requestedAt");
  });

  test("a duplicate request, a request for a resolved id and one for an unknown id are each refused with a reason, and none applied", async () => {
    const { root, ids } = await rebootedStore();
    const target = ids[0] as string;
    await recoveryCli(["dismiss", target, "--why", "first"], { root, out: () => {} });
    const [file] = pending(root);
    const text = readFileSync(join(root, RECOVERY_INBOX_DIR, file as string), "utf8");
    await run(root, async function* () {});
    expect(dispositions(eventsIn(root))).toHaveLength(1);

    // The same request again — a replay after a crash between append and delete, or a copy.
    writeFileSync(join(root, RECOVERY_INBOX_DIR, file as string), text);
    await recoveryCli(["dismiss", target, "--why", "second opinion"], { root, out: () => {} });
    await recoveryCli(["dismiss", "rc-ffffffffffffffffffff", "--why", "no such thing"], { root, out: () => {} });
    await run(root, async function* () {});

    expect(dispositions(eventsIn(root))).toHaveLength(1);
    const whys = refusals(root).map((r) => r.why);
    expect(whys).toHaveLength(3);
    expect(whys.some((why) => why.includes("already applied"))).toBe(true);
    expect(whys.some((why) => why.includes("already resolved"))).toBe(true);
    expect(whys.some((why) => why.includes("not in the recovery index"))).toBe(true);
    expect(pending(root)).toEqual([]);
  });

  test("an unread recovery tail leaves a crash-replayed dismissal pending instead of applying it twice", async () => {
    const { root, ids } = await rebootedStore();
    const target = ids[0] as string;
    await recoveryCli(["dismiss", target, "--why", "checked before the crash"], { root, out: () => {} });
    const [file] = pending(root);
    if (file === undefined) throw new Error("the CLI wrote no request");
    const request = JSON.parse(readFileSync(join(root, RECOVERY_INBOX_DIR, file), "utf8")) as { requestId: string; why: string };

    // The daemon fsynced the disposition, then died before recovery.json caught
    // up or the request file was removed. A later bad complete line makes the
    // recovery-tail replay all-or-nothing refusal keep the stale unresolved
    // fold, which must not be treated as authority for a second append.
    const opened = openStore({ root });
    if (!opened.ok) throw new Error("the store did not open");
    opened.store.append([
      {
        kind: "recovery-disposition",
        at: LATEST,
        id: target as RecoveryDispositionEvent["id"],
        disposition: "dismissed",
        evidence: { requestId: request.requestId, why: request.why },
      },
    ]);
    opened.store.close();
    appendFileSync(join(root, EVENTS_FILE), "{not an event}\n");

    const outcome = await runOverseer({
      root,
      baseUrl: "http://127.0.0.1:0",
      signal: new AbortController().signal,
      now: fakeClock("2026-09-08T02:48:40.000Z").now,
      tickMs: 5,
      log: () => {},
      source: () => (async function* () {})(),
      bootId: () => BOOT_ONE,
      recovery: evidenceWorld(),
    });
    expect(outcome.kind).toBe("stopped");
    const validEvents = readFileSync(join(root, EVENTS_FILE), "utf8").split("\n").flatMap((line) => {
      try {
        return line === "" ? [] : [JSON.parse(line) as OverseerEvent];
      } catch {
        return [];
      }
    });
    expect(dispositions(validEvents)).toHaveLength(1);
    expect(pending(root)).toEqual([file]);
  });

  test("the bounded async drain leaves unexamined work pending, and a path swapped to a symlink after claim is never followed", async () => {
    const { root, ids } = await rebootedStore();
    const target = ids[0] as string;
    await recoveryCli(["dismiss", target, "--why", "bounded scan"], { root, out: () => {} });
    const opened = openStore({ root });
    if (!opened.ok) throw new Error("the store did not open");
    const append = (events: OverseerEvent[]): boolean => opened.store.append(events).ok;

    const scanLines: string[] = [];
    const skipped = await drainRecoveryInbox({
      root,
      index: () => opened.store.recovery,
      append,
      now: () => new Date(LATEST),
      log: (line) => scanLines.push(line),
      scanLimit: 0,
    });
    expect(skipped).toEqual({ applied: 0, refused: 0, halted: false });
    expect(pending(root)).toHaveLength(1);
    // O4: a scan that stops at its limit says so, once.
    expect(scanLines.filter((line) => line.includes("scan stopped"))).toHaveLength(1);

    const [file] = pending(root);
    if (file === undefined) throw new Error("the request disappeared");
    const original = join(root, RECOVERY_INBOX_DIR, file);
    const replacement = join(root, "valid-request-target.json");
    writeFileSync(replacement, readFileSync(original));
    const lines: string[] = [];
    const swapped = await drainRecoveryInbox({
      root,
      index: () => opened.store.recovery,
      append,
      now: () => new Date(LATEST),
      log: (line) => lines.push(line),
      afterClaim: (claimed) => {
        unlinkSync(claimed);
        symlinkSync(replacement, claimed);
      },
    });
    expect(swapped.applied).toBe(0);
    expect(dispositions(eventsIn(root))).toEqual([]);
    expect(lines.some((line) => line.includes("could not be read"))).toBe(true);
    // O6: refused with its cause, not left to be logged on every tick. The
    // link is removed; what it pointed at is not touched.
    expect(swapped.refused).toBe(1);
    expect(refusals(root)[0]?.why).toContain("could not be read");
    const processing = join(root, RECOVERY_INBOX_DIR, "processing");
    expect(existsSync(processing) ? readdirSync(processing) : []).toEqual([]);
    expect(existsSync(replacement)).toBe(true);
    const again: string[] = [];
    await drainRecoveryInbox({ root, index: () => opened.store.recovery, append, now: () => new Date(LATEST), log: (line) => again.push(line) });
    expect(again).toEqual([]);
    opened.store.close();
  });

  test("junk cannot starve the inbox: 200 junk entries in processing/ are quarantined, and a later bounded pass reaches the request (F22, O4)", async () => {
    const { root, ids } = await rebootedStore();
    await recoveryCli(["dismiss", ids[0] as string, "--why", "behind the junk"], { root, out: () => {} });
    const processing = join(root, RECOVERY_INBOX_DIR, "processing");
    mkdirSync(processing);
    for (let i = 0; i < 200; i += 1) writeFileSync(join(processing, `junk-${i.toString().padStart(3, "0")}`), "x");
    const opened = openStore({ root });
    if (!opened.ok) throw new Error("the store did not open");
    const lines: string[] = [];
    const results = [];
    for (let pass = 0; pass < 3; pass += 1) {
      results.push(
        await drainRecoveryInbox({
          root,
          index: () => opened.store.recovery,
          append: (events) => opened.store.append(events).ok,
          now: () => new Date(LATEST),
          log: (line) => lines.push(line),
        }),
      );
    }
    opened.store.close();
    expect(results.reduce((sum, r) => sum + r.applied, 0)).toBe(1);
    expect(dispositions(eventsIn(root))).toHaveLength(1);
    expect(readdirSync(join(root, RECOVERY_INBOX_DIR, "junk"))).toHaveLength(200);
    expect(lines.filter((line) => line.includes("scan stopped"))).toHaveLength(1);
  });

  test("a young temp file is left for its writer; a stale one is quarantined like any other junk (F22)", async () => {
    const { root } = await rebootedStore();
    const inbox = join(root, RECOVERY_INBOX_DIR);
    mkdirSync(inbox, { recursive: true });
    const young = join(inbox, `${randomUUID()}.json.tmp-1-young`);
    const stale = join(inbox, `${randomUUID()}.json.tmp-1-stale`);
    writeFileSync(young, "{}");
    writeFileSync(stale, "{}");
    const nowMs = Date.parse(LATEST);
    utimesSync(young, new Date(nowMs - 5_000), new Date(nowMs - 5_000));
    utimesSync(stale, new Date(nowMs - 10 * 60_000), new Date(nowMs - 10 * 60_000));
    const opened = openStore({ root });
    if (!opened.ok) throw new Error("the store did not open");
    await drainRecoveryInbox({
      root,
      index: () => opened.store.recovery,
      append: (events) => opened.store.append(events).ok,
      now: () => new Date(LATEST),
      log: () => {},
    });
    opened.store.close();
    expect(existsSync(young)).toBe(true);
    expect(existsSync(stale)).toBe(false);
    expect(readdirSync(join(inbox, "junk"))).toHaveLength(1);
  });

  // Root opens a mode-000 file regardless, so the failure cannot be injected that way.
  test.skipIf(process.getuid?.() === 0)(
    "a correctly named request that cannot be opened is left where it is, never junked or refused, and applied once it can be read (F22)",
    async () => {
      const { root, ids } = await rebootedStore();
      const target = ids[0] as string;
      await recoveryCli(["dismiss", target, "--why", "unreadable for a moment"], { root, out: () => {} });
      const [file] = pending(root);
      if (file === undefined) throw new Error("the CLI wrote no request");
      const path = join(root, RECOVERY_INBOX_DIR, file);
      const opened = openStore({ root });
      if (!opened.ok) throw new Error("the store did not open");
      const drain = (log: (line: string) => void) =>
        drainRecoveryInbox({
          root,
          index: () => opened.store.recovery,
          append: (events) => opened.store.append(events).ok,
          now: () => new Date(LATEST),
          log,
        });

      // A transient open failure (EACCES here; EMFILE would do the same) on a
      // real, regular request file.
      chmodSync(path, 0o000);
      const lines: string[] = [];
      let first: Awaited<ReturnType<typeof drainRecoveryInbox>>;
      try {
        first = await drain((line) => lines.push(line));
      } finally {
        if (existsSync(path)) chmodSync(path, 0o600);
      }
      expect(first).toEqual({ applied: 0, refused: 0, halted: false });
      expect(existsSync(path)).toBe(true);
      const junk = join(root, RECOVERY_INBOX_DIR, "junk");
      expect(existsSync(junk) ? readdirSync(junk) : []).toEqual([]);
      expect(refusals(root)).toEqual([]);
      expect(lines.filter((line) => line.includes(file.slice(0, 36)))).toHaveLength(1);

      // Readable again: the next pass applies it.
      const second = await drain(() => {});
      opened.store.close();
      expect(second.applied).toBe(1);
      expect(dispositions(eventsIn(root)).map((d) => d.id)).toEqual([target]);
    },
  );

  test.skipIf(process.getuid?.() === 0)(
    "an inbox copy is never renamed over an unreadable crash-left copy of the same request in processing/ (F22)",
    async () => {
      const { root, ids } = await rebootedStore();
      const target = ids[0] as string;
      await recoveryCli(["dismiss", target, "--why", "the inbox copy"], { root, out: () => {} });
      const [file] = pending(root);
      if (file === undefined) throw new Error("the CLI wrote no request");
      const inboxCopy = join(root, RECOVERY_INBOX_DIR, file);
      // The same request id, crash-left in processing/ with its own sentence.
      const processing = join(root, RECOVERY_INBOX_DIR, "processing");
      mkdirSync(processing);
      const claimedCopy = join(processing, file);
      const request = JSON.parse(readFileSync(inboxCopy, "utf8")) as Record<string, unknown>;
      const claimedBytes = `${JSON.stringify({ ...request, why: "the crash-left copy" }, null, 2)}\n`;
      writeFileSync(claimedCopy, claimedBytes);

      const opened = openStore({ root });
      if (!opened.ok) throw new Error("the store did not open");
      const drain = (log: (line: string) => void) =>
        drainRecoveryInbox({
          root,
          index: () => opened.store.recovery,
          append: (events) => opened.store.append(events).ok,
          now: () => new Date(LATEST),
          log,
        });

      chmodSync(claimedCopy, 0o000);
      const lines: string[] = [];
      try {
        await drain((line) => lines.push(line));
      } finally {
        if (existsSync(claimedCopy)) chmodSync(claimedCopy, 0o600);
      }
      expect(existsSync(claimedCopy)).toBe(true);
      expect(readFileSync(claimedCopy, "utf8")).toBe(claimedBytes);
      expect(existsSync(inboxCopy)).toBe(true);
      expect(dispositions(eventsIn(root))).toEqual([]);
      expect(refusals(root)).toEqual([]);
      expect(lines.some((line) => line.includes("already in processing/"))).toBe(true);

      // Readable again: the crash-left copy is applied, and the inbox copy is
      // refused as already applied, with what it said kept in refused/.
      for (let pass = 0; pass < 2; pass += 1) await drain(() => {});
      opened.store.close();
      const found = dispositions(eventsIn(root));
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ id: target, evidence: { why: "the crash-left copy" } });
      expect(existsSync(claimedCopy)).toBe(false);
      expect(existsSync(inboxCopy)).toBe(false);
      const refused = refusals(root);
      expect(refused).toHaveLength(1);
      expect(refused[0]?.why).toContain("already applied");
      expect(refused[0]?.request).toMatchObject({ why: "the inbox copy" });
    },
  );

  test("dismiss says HELD when the recovery index is incomplete, and names why (O2)", async () => {
    const { root, ids } = await rebootedStore();
    plantUnparseableLine(root);
    // One start records the refused replay in recovery.json.
    await runRaw(root, async function* () {});
    const lines: string[] = [];
    expect(await recoveryCli(["dismiss", ids[0] as string, "--why", "held behind a bad line"], { root, out: (line) => lines.push(line) })).toBe(0);
    const held = lines.filter((line) => line.startsWith("HELD: the recovery index is incomplete ("));
    expect(held).toHaveLength(1);
    expect(held[0]).toContain("this request stays pending until a daemon start can read the whole log");
  });

  test("the daemon logs once per start that a pending request is held by an incomplete index (O2)", async () => {
    const { root, ids } = await rebootedStore();
    await recoveryCli(["dismiss", ids[0] as string, "--why", "held at start"], { root, out: () => {} });
    plantUnparseableLine(root);
    const lines: string[] = [];
    // A dozen ticks or so, each of which finds the replay not-run.
    await runRaw(
      root,
      async function* () {
        await sleep(60);
        yield* []; // A source that sends nothing while the ticks run.
      },
      { log: (line) => lines.push(line) },
    );
    // Its own phrase: the start line already says SCHEDULED JOBS ARE HELD.
    const held = lines.filter((line) => line.includes("RECOVERY REQUESTS HELD"));
    expect(held).toHaveLength(1);
    expect(held[0]).toContain("incomplete");
    expect(pending(root)).toHaveLength(1);
    expect(dispositions(parseableEvents(root))).toEqual([]);
  });

  test("a resolved record past retention leaves the view in the same write that drops it from the index (F24)", async () => {
    const { root, ids } = await rebootedStore();
    const target = ids[0] as string;
    await recoveryCli(["dismiss", target, "--why", "resolved long ago"], { root, out: () => {} });
    await run(root, async function* () {});
    expect(index(root).find((r) => r.id === target)?.resolution.disposition).toBe("dismissed");

    // Thirty-one days after the dismissal, a new daemon starts.
    await runRaw(root, async function* () {}, { now: fakeClock("2026-10-09T03:00:00.000Z").now });
    const file = JSON.parse(readFileSync(join(root, RECOVERY_FILE), "utf8")) as { records: { id: string }[]; view: RecoveryView | null };
    const recordIds = file.records.map((r) => r.id);
    expect(recordIds).not.toContain(target);
    expect(file.view).not.toBeNull();
    const pageIds = (file.view?.page ?? []).map((item) => item.id);
    expect(pageIds).not.toContain(target);
    expect(pageIds.filter((id) => !recordIds.includes(id))).toEqual([]);
  });

  test("list survives a malformed view item: it says the evidence is unreadable and lists every record (F25)", async () => {
    const { root, ids } = await rebootedStore();
    const path = join(root, RECOVERY_FILE);
    const file = JSON.parse(readFileSync(path, "utf8")) as { view: { page: { evidence: unknown }[] } };
    const item = file.view.page[0];
    if (item === undefined) throw new Error("the view has no first item");
    item.evidence = { kind: "checked" };
    writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
    const lines: string[] = [];
    expect(await recoveryCli(["list"], { root, out: (line) => lines.push(line) })).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("view evidence unreadable");
    for (const id of ids) expect(text).toContain(id);
  });

  test("list prints every record the index retains", async () => {
    const { root, ids } = await rebootedStore();
    const lines: string[] = [];
    expect(await recoveryCli(["list"], { root, out: (line) => lines.push(line) })).toBe(0);
    const text = lines.join("\n");
    for (const id of ids) expect(text).toContain(id);
  });
});
