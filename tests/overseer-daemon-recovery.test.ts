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
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { OverseerEvent } from "../tools/overseer/diff.js";
import { BASELINE_FILE, runOverseer } from "../tools/overseer/daemon.js";
import type { JsonValue } from "../tools/overseer/observation.js";
import type { RecoveryCandidateEvent, RecoveryRecord } from "../tools/overseer/recovery.js";
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

async function run(
  root: string,
  script: () => AsyncGenerator<SourceMessage>,
  options: { bootId?: () => string | null } = {},
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
