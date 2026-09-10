/**
 * The daemon ordering payloads by which dashboard run composed them and which
 * collection their rows came from, rather than by `collectedAt` alone —
 * docs/plans/260910d-source-ordering-distinguish-a-new-observation-from-a-new-timestamp.md
 * § Stage 2.
 *
 * Everything here goes through the real parser, gate, differ and store, driven
 * by a scripted source, exactly as tests/overseer-daemon.test.ts does. That
 * suite is not edited: this stage's cases live here so the two can be read
 * apart.
 *
 * THE STAMPS ARE CONSTRUCTED, and say so. The captured fixtures predate the
 * producer stamp, so every stamped payload is a real capture with a `producer`
 * key added and, where the case needs it, one clock or row list edited. The
 * run ids are 8-hex tokens minted for this file.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { FleetSnapshot } from "../tools/fleet/collect.js";
import { statePayload, type PayloadDeps } from "../tools/fleet/state.js";
import type { ProducerStamp } from "../tools/fleet/wire.js";
import type { OverseerEvent } from "../tools/overseer/diff.js";
import { runOverseer } from "../tools/overseer/daemon.js";
import { readNotes, type DaemonNote } from "../tools/overseer/notes.js";
import { parseObservation, type JsonValue } from "../tools/overseer/observation.js";
import type { SourceMessage } from "../tools/overseer/source.js";
import { EVENTS_FILE, readCheckpoint } from "../tools/overseer/store.js";
import { editableFixture, type FixtureName } from "./overseer-fixtures.js";

/** Dashboard runs, minted for this file. */
const RUN_A = "0dd5e7a1";
const RUN_B = "b2c4d6e8";
const RUN_C = "7f3e9a05";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-ordering-test-"));
  roots.push(root);
  return root;
}

function fakeClock(startIso: string): { now: () => Date; advance(ms: number): void; ms(): number } {
  let ms = Date.parse(startIso);
  return { now: () => new Date(ms), advance: (by) => (ms += by), ms: () => ms };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function payload(json: JsonValue, via: "sse" | "poll" = "sse"): SourceMessage {
  return { kind: "payload", via, atMs: 0, json };
}

/** A real capture with fields replaced, through the real parser downstream — never a hand-built snapshot. */
function fixtureWith(name: FixtureName, changes: Record<string, JsonValue>): JsonValue {
  return { ...editableFixture(name), ...changes } as unknown as JsonValue;
}

/** A real capture wearing a producer stamp, plus any other edits the case needs. */
function stamped(
  name: FixtureName,
  stamp: { instance: string; publication: number; inventory: number | null },
  changes: Record<string, JsonValue> = {},
): JsonValue {
  return fixtureWith(name, { ...changes, producer: stamp });
}

/** A just-restarted dashboard answering a poll before its first collection: `fleetState`'s placeholder, stamped. */
function neverCollected(instance: string): JsonValue {
  return fixtureWith("session-new-before", {
    rows: [],
    collectedAt: null,
    tookMs: 0,
    producer: { instance, publication: 0, inventory: null },
  });
}

async function run(
  root: string,
  script: () => AsyncGenerator<SourceMessage>,
  options: { clock?: ReturnType<typeof fakeClock> } = {},
): Promise<{ notes: DaemonNote[]; events: OverseerEvent[]; lines: string[] }> {
  const clock = options.clock ?? fakeClock("2026-09-08T02:48:40.000Z");
  const lines: string[] = [];
  const outcome = await runOverseer({
    root,
    baseUrl: "http://127.0.0.1:0",
    signal: new AbortController().signal,
    now: clock.now,
    tickMs: 5,
    log: (line) => lines.push(line),
    source: () => script(),
  });
  expect(outcome.kind).toBe("stopped");
  return { notes: notesIn(root), events: eventsIn(root), lines };
}

function notesIn(root: string): DaemonNote[] {
  const read = readNotes(root);
  if (read.kind === "unreadable") throw new Error(read.cause);
  return read.notes;
}

function eventsIn(root: string): OverseerEvent[] {
  const path = join(root, EVENTS_FILE);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as OverseerEvent);
}

/** The edges one condition went through, in order. */
function edges(notes: readonly DaemonNote[], condition: string): string[] {
  return notes
    .filter((n) => (n.kind === "condition-degraded" || n.kind === "condition-restored") && n.condition === condition)
    .map((n) => n.kind);
}

/** Every refusal sentence the `snapshots` condition opened with. */
function refusals(notes: readonly DaemonNote[]): string[] {
  return notes.flatMap((n) => (n.kind === "condition-degraded" && n.condition === "snapshots" ? [n.why] : []));
}

function kinds(events: readonly OverseerEvent[]): string[] {
  return events.map((e) => e.kind);
}

function lastGood(root: string): string | null {
  const read = readCheckpoint(root);
  if (read.kind !== "checkpoint") throw new Error("expected a checkpoint");
  return read.checkpoint.lastGoodSnapshotAt;
}

function registerSize(root: string): number {
  const read = readCheckpoint(root);
  if (read.kind !== "checkpoint") throw new Error("expected a checkpoint");
  return read.checkpoint.register.length;
}

/*
 * The two captures most cases lean on: `session-new-before` (six sessions, at
 * 02:47:22.686Z) and `session-new-after` (one gone, one arrived, at
 * 02:48:38.418Z). Diffing the second against the first is exactly two events,
 * so "8 events" below always means "the first collection, then that diff".
 */
const BEFORE_AT = "2026-09-08T02:47:22.686Z";
const EARLIER_AT = "2026-09-08T02:40:00.000Z";

describe("duplicates: one collection, however it arrives", () => {
  test("the same stamp via stream and poll, with a different servedAt and health, is one set of events and no condition", async () => {
    const root = tempRoot();
    const stamp = { instance: RUN_A, publication: 3, inventory: 2 };
    const { notes, events } = await run(root, async function* () {
      yield payload(stamped("session-new-before", stamp, { servedAt: "2026-09-08T02:47:30.000Z" }), "sse");
      yield payload(
        stamped("session-new-before", stamp, { servedAt: "2026-09-08T02:48:10.000Z", health: { verdict: { level: "calm" } } }),
        "poll",
      );
    });
    expect(kinds(events)).toEqual(Array(6).fill("session-seen"));
    expect(notes.filter((n) => n.kind === "condition-degraded")).toEqual([]);
  });

  test("a later publication of the same collection is still a duplicate", async () => {
    // A failed turn after a success moves `publication` and leaves the rows,
    // the clock and `inventory` alone; with the error gone again the payload
    // is the same collection under a newer publication number.
    const root = tempRoot();
    const { notes, events } = await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 3, inventory: 2 }));
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 5, inventory: 2 }));
    });
    expect(events.length).toBe(6);
    expect(notes.filter((n) => n.kind === "condition-degraded")).toEqual([]);
  });
});

describe("out of order", () => {
  test("collection 3, then 2 — refused as out of order and diffed from nothing — then 4 is diffed against 3", async () => {
    // Red today: collection 2 carries a LATER clock, so the clock rule accepts
    // it and diffs across it.
    const root = tempRoot();
    const { notes, events } = await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 3, inventory: 3 }));
      yield payload(
        stamped("session-new-after", { instance: RUN_A, publication: 2, inventory: 2 }, { collectedAt: "2026-09-08T02:48:00.000Z" }),
      );
      yield payload(stamped("session-new-after", { instance: RUN_A, publication: 4, inventory: 4 }));
    });
    expect(refusals(notes)).toHaveLength(1);
    expect(refusals(notes)[0]).toContain("out of order");
    // Six from the first collection, and the two the real capture holds from
    // 3 → 4. Nothing from collection 2.
    expect(kinds(events)).toEqual([...Array(6).fill("session-seen"), "tmux-session-gone", "session-seen"]);
    expect(lastGood(root)).toBe("2026-09-08T02:48:38.418Z");
  });

  test("a stale ERROR publication after a newer success gets the out-of-order sentence, not 'the last collection failed'", async () => {
    const root = tempRoot();
    const { notes } = await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 4, inventory: 3 }));
      yield payload(
        stamped("session-new-before", { instance: RUN_A, publication: 3, inventory: 2 }, { error: "tmux list-panes timed out" }),
      );
    });
    expect(refusals(notes)).toHaveLength(1);
    expect(refusals(notes)[0]).toContain("out of order");
    expect(refusals(notes)[0]).not.toContain("last collection failed");
  });
});

describe("a clock moving backward under a running dashboard", () => {
  test("same run, collection 2 stamped earlier than collection 1: accepted and diffed", async () => {
    // Red today: refused as "went backwards", and the history stalls until
    // the clock passes the old high-water mark.
    const root = tempRoot();
    const { notes, events } = await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }));
      yield payload(stamped("session-new-after", { instance: RUN_A, publication: 2, inventory: 2 }, { collectedAt: EARLIER_AT }));
    });
    expect(refusals(notes)).toEqual([]);
    expect(kinds(events)).toEqual([...Array(6).fill("session-seen"), "tmux-session-gone", "session-seen"]);
    expect(lastGood(root)).toBe(EARLIER_AT);
  });

  test("CONTROL: the same pair without stamps keeps today's refusal", async () => {
    const root = tempRoot();
    const { notes, events } = await run(root, async function* () {
      yield payload(editableFixture("session-new-before") as unknown as JsonValue);
      yield payload(fixtureWith("session-new-after", { collectedAt: EARLIER_AT }));
    });
    expect(refusals(notes)).toHaveLength(1);
    expect(refusals(notes)[0]).toContain("went backwards");
    expect(events.length).toBe(6);
  });
});

describe("one collection wearing a later clock", () => {
  test("the same (run, collection) re-published with a later collectedAt is a contract failure, and lastGoodSnapshotAt does not move", async () => {
    // Red today: accepted as a new collection, so the watchdog believes it
    // measured something it did not.
    const root = tempRoot();
    const { notes, events } = await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }));
      yield payload(
        stamped("session-new-before", { instance: RUN_A, publication: 2, inventory: 1 }, { collectedAt: "2026-09-08T02:48:30.000Z" }),
      );
    });
    expect(refusals(notes)).toHaveLength(1);
    expect(refusals(notes)[0]).toContain("contract failure");
    expect(refusals(notes)[0]).toContain(BEFORE_AT);
    expect(refusals(notes)[0]).toContain("2026-09-08T02:48:30.000Z");
    expect(events.length).toBe(6);
    expect(lastGood(root)).toBe(BEFORE_AT);
  });
});

describe("a dashboard restart", () => {
  test("A at 5; B never collected; B's first collection with an earlier clock; then a late A", async () => {
    // Red today for the clock (B's first collection is refused as going
    // backwards) and for A (its later clock is accepted, and diffed across two
    // runs of the producer).
    const root = tempRoot();
    const { notes, events } = await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 7, inventory: 5 }));
      yield payload(neverCollected(RUN_B), "poll");
      yield payload(stamped("session-new-before", { instance: RUN_B, publication: 1, inventory: 1 }, { collectedAt: EARLIER_AT }));
      yield payload(stamped("session-new-after", { instance: RUN_A, publication: 8, inventory: 6 }));
    });
    const said = refusals(notes);
    // Two refusals would collapse into one `snapshots` edge if nothing was
    // accepted between them; B's collection IS accepted between them, so both
    // edges are written.
    expect(said).toHaveLength(2);
    expect(said[0]).toContain("new dashboard run");
    expect(said[0]).toContain(RUN_B);
    expect(said[1]).toContain(RUN_A);
    expect(said[1]).toContain("replaced");
    // Six from A's collection; ZERO from B's identical rows; nothing from the
    // placeholder or from the late A.
    expect(kinds(events)).toEqual(Array(6).fill("session-seen"));
    expect(lastGood(root)).toBe(EARLIER_AT);
  });
});

describe("empty row lists", () => {
  test("a genuine empty fleet — stamped, collected, rows: [] — closes every session out", async () => {
    const root = tempRoot();
    const { events } = await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }));
      yield payload(
        stamped("session-new-before", { instance: RUN_A, publication: 2, inventory: 2 }, { rows: [], collectedAt: "2026-09-08T02:48:30.000Z" }),
      );
    });
    expect(kinds(events)).toEqual([...Array(6).fill("session-seen"), ...Array(6).fill("tmux-session-gone")]);
    expect(registerSize(root)).toBe(0);
  });

  test("no silent deletion: an inadmissible empty sample — never collected, errored, out of order, retired — closes nothing", async () => {
    const root = tempRoot();
    const later = "2026-09-08T02:50:00.000Z";
    const { events, notes } = await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }));
      // A restart: B's first collection, same rows. A is now retired.
      yield payload(stamped("session-new-before", { instance: RUN_B, publication: 2, inventory: 2 }, { collectedAt: EARLIER_AT }));
      // Never collected (a third run coming up).
      yield payload(neverCollected(RUN_C));
      // With an error.
      yield payload(
        stamped("session-new-before", { instance: RUN_B, publication: 3, inventory: 2 }, { rows: [], error: "tmux server not found", collectedAt: later }),
      );
      // Out of order.
      yield payload(stamped("session-new-before", { instance: RUN_B, publication: 1, inventory: 1 }, { rows: [], collectedAt: later }));
      // From the retired run.
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 9, inventory: 9 }, { rows: [], collectedAt: later }));
    });
    expect(events.filter((e) => e.kind === "tmux-session-gone")).toEqual([]);
    expect(events.length).toBe(6);
    expect(registerSize(root)).toBe(6);
    // All four really were refused — a script that stopped short would also
    // close nothing.
    const snapshotEdges = edges(notes, "snapshots");
    expect(snapshotEdges).toEqual(["condition-degraded"]);
  });
});

describe("an old producer, which is ordered exactly as well as it was yesterday", () => {
  test("unstamped payloads over a long run with a healthy collector raise no ordering, collector or freshness condition, and log the fallback once", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T03:00:00.000Z");
    const { notes, lines } = await run(
      root,
      async function* () {
        for (let i = 0; i < 6; i += 1) {
          yield payload(
            fixtureWith(i % 2 === 0 ? "session-new-before" : "session-new-after", {
              collectedAt: new Date(clock.ms() - 3_000).toISOString(),
              attemptedAt: new Date(clock.ms() - 15_000).toISOString(),
            }),
          );
          await sleep(15);
          clock.advance(65_000);
        }
        // Today's clock ordering still applies: an earlier clock is refused.
        yield payload(fixtureWith("session-new-before", { collectedAt: "2026-09-08T03:00:10.000Z" }));
        await sleep(15);
      },
      { clock },
    );
    expect(edges(notes, "ordering")).toEqual([]);
    expect(edges(notes, "collector")).toEqual([]);
    expect(edges(notes, "freshness")).toEqual([]);
    expect(refusals(notes)).toHaveLength(1);
    expect(refusals(notes)[0]).toContain("went backwards");
    // ONCE PER TRANSITION, NOT PER PAYLOAD: seven unstamped payloads, one line.
    expect(lines.filter((line) => line.includes("no producer stamp"))).toHaveLength(1);
  });

  test("stamped, then unstamped (a rollback), falls back to the clock", async () => {
    const root = tempRoot();
    const { notes, events, lines } = await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }));
      // The rollback's first collection has an earlier clock: refused, as yesterday.
      yield payload(fixtureWith("session-new-after", { collectedAt: EARLIER_AT }));
      // And a later one is accepted and diffed.
      yield payload(editableFixture("session-new-after") as unknown as JsonValue);
    });
    expect(refusals(notes)).toHaveLength(1);
    expect(refusals(notes)[0]).toContain("went backwards");
    expect(kinds(events)).toEqual([...Array(6).fill("session-seen"), "tmux-session-gone", "session-seen"]);
    expect(edges(notes, "ordering")).toEqual([]);
    expect(lines.filter((line) => line.includes("no producer stamp"))).toHaveLength(1);
  });
});

describe("a daemon restart", () => {
  test("a stored stamped baseline makes the first identical payload a duplicate", async () => {
    const root = tempRoot();
    await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 4, inventory: 3 }));
    });
    const second = await run(root, async function* () {
      // Same run and collection under a later publication: a repeat, not a
      // re-announcement and not a contract failure.
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 6, inventory: 3 }), "poll");
    });
    const started = second.notes.filter((n) => n.kind === "daemon-started").at(-1);
    if (started?.kind !== "daemon-started") throw new Error("expected a start note");
    expect(started.baseline).toContain("restored");
    expect(second.events.length).toBe(6);
    expect(edges(second.notes, "snapshots")).toEqual([]);
  });

  test("across a dashboard restart: B's first collection with an earlier clock is accepted with zero events, and a late A is refused", async () => {
    // Sol's finding 4. `retired` starts empty after a daemon restart; what
    // makes that safe is the restored `accepted` carrying run A.
    const root = tempRoot();
    await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 4, inventory: 3 }));
    });
    const second = await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_B, publication: 1, inventory: 1 }, { collectedAt: EARLIER_AT }));
      yield payload(stamped("session-new-after", { instance: RUN_A, publication: 5, inventory: 4 }));
    });
    expect(second.events.length).toBe(6);
    const said = refusals(second.notes);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(RUN_A);
    expect(said[0]).toContain("replaced");
    expect(lastGood(root)).toBe(EARLIER_AT);
  });

  test("the retired set is bounded to the last 16 runs", async () => {
    // Eighteen runs, each replacing the last. After the eighteenth, the
    // seventeen before it have been retired and the oldest has been let go:
    // a late payload from run 2 is still refused, and one from run 1 is not.
    const root = tempRoot();
    const runs = Array.from({ length: 18 }, (_, i) => (0x10000000 + i).toString(16));
    const start = Date.parse("2026-09-08T02:50:00.000Z");
    const at = (i: number): string => new Date(start + i * 60_000).toISOString();
    const { notes, events } = await run(root, async function* () {
      for (const [i, instance] of runs.entries()) {
        yield payload(stamped("session-new-before", { instance, publication: 1, inventory: 1 }, { collectedAt: at(i) }));
      }
      yield payload(stamped("session-new-before", { instance: runs[1] ?? "", publication: 2, inventory: 2 }, { collectedAt: at(20) }));
      yield payload(stamped("session-new-before", { instance: runs[0] ?? "", publication: 2, inventory: 2 }, { collectedAt: at(21) }));
    });
    const said = refusals(notes);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(runs[1]);
    expect(lastGood(root)).toBe(at(21));
    expect(events.length).toBe(6);
  });
});

describe("an unknown schema stays unknown", () => {
  test("a schema-2 payload with a plausible attemptedAt does not restore the collector, touch ordering, retire a run or move accepted", async () => {
    // Red today: `take()` falls back to `parseAttempt(json)` on every parse
    // failure, and `parseAttempt` did not look at `schema`, so a schema-2
    // payload's `attemptedAt` restored `collector`.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T02:47:25.000Z");
    const frozen = "2026-09-08T02:47:20.000Z";
    const { notes, events } = await run(
      root,
      async function* () {
        yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }, { attemptedAt: frozen }));
        clock.advance(6 * 60_000);
        await sleep(40);
        yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }, { attemptedAt: frozen }));
        await sleep(20);
        // The collector is now degraded. A schema-2 payload from a "new run",
        // with a fresh attempt clock and an unreadable stamp.
        yield payload(
          fixtureWith("session-new-after", {
            schema: 2,
            collectedAt: new Date(clock.ms() - 3_000).toISOString(),
            attemptedAt: new Date(clock.ms() - 5_000).toISOString(),
            producer: { instance: "not a run", publication: -1, inventory: 7 },
          }),
        );
        await sleep(40);
        yield payload(
          fixtureWith("session-new-after", {
            schema: 2,
            collectedAt: new Date(clock.ms() - 3_000).toISOString(),
            producer: { instance: RUN_B, publication: 1, inventory: 1 },
          }),
        );
        // A is still the accepted run, and not retired: its next collection,
        // with an earlier clock than the schema-2 payloads, is diffed.
        yield payload(stamped("session-new-after", { instance: RUN_A, publication: 2, inventory: 2 }, { collectedAt: "2026-09-08T02:50:00.000Z" }));
      },
      { clock },
    );
    expect(edges(notes, "collector")).toEqual(["condition-degraded"]);
    expect(edges(notes, "ordering")).toEqual([]);
    expect(kinds(events)).toEqual([...Array(6).fill("session-seen"), "tmux-session-gone", "session-seen"]);
  });
});

describe("the ordering condition", () => {
  const unreadable = (name: FixtureName, changes: Record<string, JsonValue> = {}): JsonValue =>
    fixtureWith(name, { ...changes, producer: { instance: "ZZZZZZZZ", publication: 1, inventory: 1 } });

  test("unreadable degrades it, and an unstamped payload restores it", async () => {
    const root = tempRoot();
    const { notes, lines } = await run(root, async function* () {
      yield payload(unreadable("session-new-before"));
      yield payload(unreadable("session-new-before"));
      yield payload(editableFixture("session-new-after") as unknown as JsonValue);
      yield payload(editableFixture("session-new-after") as unknown as JsonValue);
    });
    expect(edges(notes, "ordering")).toEqual(["condition-degraded", "condition-restored"]);
    const opened = notes.find((n) => n.kind === "condition-degraded" && n.condition === "ordering");
    if (opened?.kind !== "condition-degraded") throw new Error("expected the ordering condition to open");
    expect(opened.why).toContain("ZZZZZZZZ");
    expect(lines.filter((line) => line.includes("no producer stamp"))).toHaveLength(1);
  });

  test("unreadable degrades it, and a readable stamp restores it", async () => {
    const root = tempRoot();
    const { notes } = await run(root, async function* () {
      yield payload(unreadable("session-new-before"));
      yield payload(stamped("session-new-after", { instance: RUN_A, publication: 2, inventory: 2 }));
    });
    expect(edges(notes, "ordering")).toEqual(["condition-degraded", "condition-restored"]);
  });

  test("an unknown-schema payload neither raises it nor restores it", async () => {
    const root = tempRoot();
    const { notes } = await run(root, async function* () {
      // Open, then a schema-2 payload with a readable stamp: still open.
      yield payload(unreadable("session-new-before"));
      yield payload(fixtureWith("session-new-after", { schema: 2, producer: { instance: RUN_A, publication: 1, inventory: 1 } }));
    });
    expect(edges(notes, "ordering")).toEqual(["condition-degraded"]);

    const closed = tempRoot();
    const second = await run(closed, async function* () {
      // Closed, then a schema-2 payload with an unreadable stamp: still closed.
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }));
      yield payload(fixtureWith("session-new-after", { schema: 2, producer: { instance: "ZZZZZZZZ", publication: 1, inventory: 1 } }));
    });
    expect(edges(second.notes, "ordering")).toEqual([]);
  });
});

/**
 * STAGE 1'S SENTINEL, driven from the producer's own composition.
 *
 * When the ledger's stamp and the snapshot disagree, `producerForSnapshot` in
 * tools/fleet/state.ts logs it and publishes `instance: "invalid"` with its
 * inventory nullness normalised. That sentinel exists for this stage to refuse:
 * it fails `INSTANCE_TOKEN`, so it must parse as `unreadable`, order by the
 * clock, and open `ordering`. The payload here comes out of `statePayload`, so
 * a change to the sentinel changes what this test sees — a hand-written
 * `{ instance: "invalid" }` would go on passing.
 */
describe("the producer's disagreement sentinel", () => {
  const snapshot: FleetSnapshot = {
    rows: [],
    tmuxServerPid: 132280,
    collectedAt: EARLIER_AT,
    tookMs: 1200,
  };

  function deps(producer: ProducerStamp): PayloadDeps {
    return {
      snapshot,
      error: null,
      health: null,
      refreshMs: 60_000,
      answeringEnabled: true,
      attemptedAt: "2026-09-08T02:39:58.000Z",
      producer,
      readCheckpoint: () => ({
        attention: { kind: "not-asked" },
        overseer: { kind: "not-asked" },
        usage: { kind: "not-asked" },
        work: { kind: "checkpoint-absent" },
      }),
    };
  }

  /** The real composition with a stamp that says "never collected" beside a snapshot that has. */
  function sentinelPayload(): JsonValue {
    const original = console.error;
    const errors: unknown[][] = [];
    try {
      console.error = (...args: unknown[]) => errors.push(args);
      const body = statePayload(deps({ instance: RUN_A, publication: 1, inventory: null }));
      // The producer really did take its disagreement path.
      expect(errors).toHaveLength(1);
      return JSON.parse(body) as JsonValue;
    } finally {
      console.error = original;
    }
  }

  test("parses as unreadable, and the snapshot itself still parses", () => {
    const parsed = parseObservation(sentinelPayload());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.ordering.kind).toBe("unreadable");
    if (parsed.value.ordering.kind !== "unreadable") return;
    expect(parsed.value.ordering.why).toContain("invalid");
  });

  test("in the daemon it falls back to the clock and opens ordering", async () => {
    // If the stamp were believed, "invalid" would be an unseen run and its
    // payload would be accepted whatever its clock — closing all six sessions
    // out on an empty row list. The clock refuses it instead.
    const root = tempRoot();
    const { notes, events } = await run(root, async function* () {
      yield payload(stamped("session-new-before", { instance: RUN_A, publication: 1, inventory: 1 }));
      yield payload(sentinelPayload());
    });
    expect(edges(notes, "ordering")).toEqual(["condition-degraded"]);
    expect(refusals(notes)).toHaveLength(1);
    expect(refusals(notes)[0]).toContain("went backwards");
    expect(events.filter((e) => e.kind === "tmux-session-gone")).toEqual([]);
    expect(registerSize(root)).toBe(6);
  });
});
