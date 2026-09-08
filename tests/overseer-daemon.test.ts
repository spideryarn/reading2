/**
 * The daemon: a source, a clock, and a store — and the three different ways it
 * can stop knowing what the fleet is doing.
 *
 * **The watchdog tests are the important ones, and they are about NOT firing.**
 * A staleness alarm that goes off on a healthy fleet is worse than no alarm at
 * all: Greg learns to ignore it, and a quiet page over a dead box then looks
 * exactly like a quiet page over a working one. That is GPT Astra's A17 —
 * the dashboard's own client calls its data stale at 30s while collection waits
 * 60s after a ~12s run, so healthy operation spends most of its time alarming.
 * The numbers below are measured (docs/plans/260908b-overseer-store-and-clock.md
 * § S4): the interval is 65.0s, and ONE INTERVAL IN SIX WAS 130s — a collection
 * simply missed, with no error and no gap in the data. So a missed collection
 * is ordinary, and any threshold under about 150s fires on a healthy fleet.
 *
 * The source is scripted rather than real here; `tests/overseer-source.test.ts`
 * is where sockets are tested. Every store root is a temp directory: the real
 * `~/.overseer` is never touched.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { OverseerEvent } from "../tools/overseer/diff.js";
import {
  CADENCE_CEILING_MS,
  STALE_FLOOR_MS,
  STALE_MULTIPLE,
  collectorVerdict,
  freshness,
  runOverseer,
  staleAfterMs,
} from "../tools/overseer/daemon.js";
import { NOTES_FILE, openConditions, readNotes, type DaemonNote } from "../tools/overseer/notes.js";
import { parseAttempt, parseObservation, type JsonValue } from "../tools/overseer/observation.js";
import { EVENTS_FILE, readCheckpoint } from "../tools/overseer/store.js";
import type { SourceMessage } from "../tools/overseer/source.js";
import { editableFixture, rawFixture, rowsOf, type FixtureName } from "./overseer-fixtures.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-daemon-test-"));
  roots.push(root);
  return root;
}

/** A clock the test moves by hand, shared by the store, the daemon and the notes. */
function fakeClock(startIso: string): { now: () => Date; advance(ms: number): void; ms(): number } {
  let ms = Date.parse(startIso);
  return { now: () => new Date(ms), advance: (by) => (ms += by), ms: () => ms };
}

function payload(json: JsonValue, via: "sse" | "poll" = "sse"): SourceMessage {
  return { kind: "payload", via, atMs: 0, json };
}

/**
 * Run one daemon over a scripted source and stop when the script runs out.
 *
 * The source ending is what stops it, so a test never has to guess how long to
 * wait: every message has been folded, appended and checkpointed by the time
 * this resolves.
 */
async function run(
  root: string,
  script: () => AsyncGenerator<SourceMessage>,
  options: { clock?: ReturnType<typeof fakeClock>; tickMs?: number } = {},
): Promise<{ notes: DaemonNote[]; events: OverseerEvent[] }> {
  const controller = new AbortController();
  // A CLOCK, ALWAYS, and by default one standing a few seconds after the
  // fixtures were captured. The watchdog compares the producer's `collectedAt`
  // against the daemon's own clock, so running these captures under real time
  // would have every one of them four hours stale and every test full of
  // freshness alarms — which is the right behaviour and the wrong test.
  const clock = options.clock ?? fakeClock("2026-09-08T02:48:40.000Z");
  const outcome = await runOverseer({
    root,
    baseUrl: "http://127.0.0.1:0",
    signal: controller.signal,
    now: clock.now,
    tickMs: options.tickMs ?? 5,
    log: () => undefined,
    source: () => script(),
  });
  expect(outcome.kind).toBe("stopped");
  return { notes: readNotes(root).notes, events: eventsIn(root) };
}

function eventsIn(root: string): OverseerEvent[] {
  const path = join(root, EVENTS_FILE);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as OverseerEvent);
}

function fixture(name: FixtureName): JsonValue {
  return rawFixture(name);
}

/** A real capture with one field replaced — through the real parser, never hand-built. */
function fixtureWith(name: FixtureName, changes: Record<string, JsonValue>): JsonValue {
  return { ...editableFixture(name), ...changes } as unknown as JsonValue;
}

describe("the staleness threshold is the measured number, not a guessed one", () => {
  test("a missed collection is ordinary and must not raise an alarm", () => {
    // Measured 2026-09-08, six consecutive collections: the interval is 65.0s
    // and one of the six was 130s. Both of these are a HEALTHY fleet.
    for (const ageMs of [65_000, 130_000, 149_000]) {
      expect(freshness({ lastGoodAtMs: 0, startedAtMs: 0, nowMs: ageMs, refreshMs: 60_000 }).fresh).toBe(true);
    }
  });

  test("a fast cadence cannot shrink the deadline below a missed collection", () => {
    // THIS IS WHAT THE FLOOR IS FOR, and the 60s case does not test it: at the
    // advertised cadence the multiple gives exactly five minutes on its own. A
    // dashboard configured to collect every ten seconds would otherwise buy a
    // fifty-second deadline — and 130s between collections is MEASURED healthy
    // behaviour, so that alarm would be wrong most of the time it fired.
    expect(staleAfterMs(10_000)).toBe(STALE_FLOOR_MS);
    expect(freshness({ lastGoodAtMs: 0, startedAtMs: 0, nowMs: 149_000, refreshMs: 10_000 }).fresh).toBe(true);
    expect(freshness({ lastGoodAtMs: 0, startedAtMs: 0, nowMs: STALE_FLOOR_MS - 1_000, refreshMs: 10_000 }).fresh).toBe(true);
    const stale = freshness({ lastGoodAtMs: 0, startedAtMs: 0, nowMs: STALE_FLOOR_MS + 1_000, refreshMs: 10_000 });
    expect(stale.fresh).toBe(false);
    if (stale.fresh) throw new Error("expected staleness");
    expect(stale.why).toContain("301");
  });

  test("a slower dashboard moves the deadline with it, by the multiple", () => {
    // The threshold is a multiple of the producer's OWN cadence, so a dashboard
    // configured to collect every two minutes is not permanently alarming.
    expect(staleAfterMs(120_000)).toBe(STALE_MULTIPLE * 120_000);
    expect(freshness({ lastGoodAtMs: 0, startedAtMs: 0, nowMs: 400_000, refreshMs: 120_000 }).fresh).toBe(true);
    expect(freshness({ lastGoodAtMs: 0, startedAtMs: 0, nowMs: 601_000, refreshMs: 120_000 }).fresh).toBe(false);
  });

  test("an absurd cadence cannot switch the watchdog off", () => {
    // `refreshMs` is validated positive by the parser and nothing more, so a
    // producer advertising an hour would otherwise buy a five-hour deadline —
    // a watchdog that never fires, which is the same picture as one that has
    // nothing to report.
    // ABSOLUTE NUMBERS, NOT THE CONSTANTS THEMSELVES. `staleAfterMs(hour) ===
    // STALE_MULTIPLE * CADENCE_CEILING_MS` is true whatever the ceiling is set
    // to, so raising the ceiling to an hour left it green — the survivor found
    // by mutation while writing this, and the same shape as the 10s-tolerance
    // constant that survived in an earlier stage.
    expect(staleAfterMs(3_600_000)).toBeLessThanOrEqual(3_000_000);
    expect(staleAfterMs(3_600_000)).toBe(STALE_MULTIPLE * CADENCE_CEILING_MS);
    expect(freshness({ lastGoodAtMs: 0, startedAtMs: 0, nowMs: 3_000_001, refreshMs: 3_600_000 }).fresh).toBe(false);
  });

  test("before the first collection the deadline runs from the daemon's own start", () => {
    // Otherwise a daemon pointed at a dashboard that never answers is fresh for
    // ever, which is the exact failure it exists to report.
    const verdict = freshness({ lastGoodAtMs: null, startedAtMs: 0, nowMs: 400_000, refreshMs: 60_000 });
    expect(verdict.fresh).toBe(false);
    if (verdict.fresh) throw new Error("expected staleness");
    expect(verdict.why).toContain("has never");
  });
});

describe("the collector, which is a third thing from the source and the payload", () => {
  // Measured 2026-09-08: `/api/state` served a `collectedAt` ~30 minutes stale
  // with `error: null`. The cause was `collect()`'s child taking SIGTERM in
  // uninterruptible IO on a swapping box, so `execFile` waited for a process
  // that was never coming back, the chained refresh loop never reached its next
  // iteration, and nothing threw. THE THING THAT WOULD HAVE REPORTED THE
  // FAILURE WAS THE THING THAT HAD STOPPED. `attemptedAt` — set BEFORE each
  // attempt — is what tells that apart from a source that is failing loudly.
  test("an attempt that never advances is a stopped collector, not a stale payload", () => {
    const verdict = collectorVerdict({ lastAttemptAtMs: 0, lastPayloadAtMs: 400_000, nowMs: 400_000, refreshMs: 60_000 });
    expect(verdict.kind).toBe("stopped");
    if (verdict.kind !== "stopped") throw new Error("expected a stopped collector");
    expect(verdict.why).toContain("has not started a collection");
  });

  test("an attempt inside the deadline is a collector that is still trying", () => {
    // The source failing LOUDLY looks like this: it keeps attempting, and
    // `error` says how. That is a different condition and a different action.
    expect(collectorVerdict({ lastAttemptAtMs: 340_000, lastPayloadAtMs: 400_000, nowMs: 400_000, refreshMs: 60_000 }).kind).toBe("collecting");
  });

  test("a producer that does not report attempts is never called wedged", () => {
    // `attemptedAt` is a new field on an unchanged schema, so an older server
    // simply does not send it. Reading its absence as "never attempted" would
    // make every old dashboard look permanently stopped — the alarm that is
    // always wrong, which is the failure this whole watchdog is designed around.
    const verdict = collectorVerdict({ lastAttemptAtMs: null, lastPayloadAtMs: 400_000, nowMs: 400_000, refreshMs: 60_000 });
    expect(verdict.kind).toBe("cannot-tell");
  });

  test("nothing arriving at all is the transport's business, not the collector's", () => {
    // If we are not hearing from the dashboard, we cannot say anything about
    // its collector — and `sse-stream`, `poll` and `freshness` already say what
    // is wrong. A fourth alarm here would be three names for one outage.
    const verdict = collectorVerdict({ lastAttemptAtMs: 0, lastPayloadAtMs: 0, nowMs: 900_000, refreshMs: 60_000 });
    expect(verdict.kind).toBe("cannot-tell");
    if (verdict.kind !== "cannot-tell") throw new Error("expected no opinion");
    expect(verdict.why).toContain("nothing has arrived");
  });

  /**
   * The reading itself belongs to `parseAttempt` and is pinned in
   * tests/overseer-observation.test.ts — three arms, malformed values, and the
   * old server that omits the field. What is this daemon's own is WHICH
   * payloads it takes the reading from, which is all of them.
   */
  test("a payload that does not even PARSE still moves the attempt clock", () => {
    // The pair that separates a failing source from a stopped one is only
    // visible on payloads the gate threw away: a collector that keeps starting
    // collections while this version refuses their contents is failing, not
    // stopped, and calling it stopped is an alarm about a fault it does not
    // have. There is no parsed snapshot on that path, so the daemon reads the
    // raw JSON with the same function `parseObservation` uses.
    const refused = fixtureWith("session-new-before", {
      // Finite, and impossible: a fractional generation fails the whole parse.
      tmuxServerPid: 132280.5,
      attemptedAt: "2026-09-08T02:47:20.000Z",
    });
    expect(parseObservation(refused).ok).toBe(false);
    expect(parseAttempt(refused)).toEqual({
      reported: true,
      attempted: true,
      at: "2026-09-08T02:47:20.000Z",
      atMs: 1_788_835_640_000,
    });
  });

  test("end to end: a source whose payloads are all refused is not called a stopped collector", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T02:47:25.000Z");
    const { notes } = await run(
      root,
      async function* () {
        yield payload(fixtureWith("session-new-before", { attemptedAt: new Date(clock.ms() - 5_000).toISOString() }));
        // Six minutes on, and the dashboard is collecting perfectly well — it
        // is this version of the Overseer that cannot read what it sends. No
        // sleep before the second yield, so the watchdog does not get a tick
        // in the gap: the question is what it makes of the payload, not of the
        // pause before it.
        clock.advance(6 * 60_000);
        yield payload(
          fixtureWith("session-new-before", { tmuxServerPid: 132280.5, attemptedAt: new Date(clock.ms() - 5_000).toISOString() }),
        );
        await new Promise((r) => setTimeout(r, 40));
      },
      { clock },
    );
    const of = (condition: string) => notes.filter((n) => "condition" in n && n.condition === condition).map((n) => n.kind);
    // The refusal really happened — without this the silence below would also
    // be what a test that never exercised the reject path looks like.
    expect(of("snapshots")).toContain("condition-degraded");
    expect(of("collector")).toEqual([]);
  });

  test("end to end: a frozen collector degrades, and its next attempt restores", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T02:47:25.000Z");
    const frozen = "2026-09-08T02:47:20.000Z";
    const { notes } = await run(
      root,
      async function* () {
        yield payload(fixtureWith("session-new-before", { attemptedAt: frozen }));
        // Six minutes of the dashboard cheerfully serving its cached body. The
        // stream is fine, the payload parses, `error` is null, and the collector
        // has not tried since.
        clock.advance(6 * 60_000);
        await new Promise((r) => setTimeout(r, 40));
        yield payload(fixtureWith("session-new-before", { attemptedAt: frozen }));
        await new Promise((r) => setTimeout(r, 20));
        yield payload(
          fixtureWith("session-new-after", {
            collectedAt: new Date(clock.ms() - 3_000).toISOString(),
            attemptedAt: new Date(clock.ms() - 9_000).toISOString(),
          }),
        );
      },
      { clock },
    );
    const collector = notes.filter((n) => "condition" in n && n.condition === "collector");
    expect(collector.map((n) => n.kind)).toEqual(["condition-degraded", "condition-restored"]);
  });
});

describe("what the daemon writes down", () => {
  test("two collections become events, a register and a checkpoint", async () => {
    const root = tempRoot();
    const { events, notes } = await run(root, async function* () {
      yield payload(fixture("session-new-before"));
      yield payload(fixture("session-new-after"));
    });

    expect(notes[0]?.kind).toBe("daemon-started");
    // The first snapshot is every session at once; the second is the pair the
    // real capture holds — one session gone, one arrived.
    expect(events.filter((e) => e.kind === "session-seen").length).toBe(7);
    expect(events.filter((e) => e.kind === "tmux-session-gone").length).toBe(1);

    const read = readCheckpoint(root);
    expect(read.kind).toBe("checkpoint");
    if (read.kind !== "checkpoint") throw new Error("expected a checkpoint");
    expect(read.checkpoint.register.length).toBe(6);
    expect(read.checkpoint.lastGoodSnapshotAt).toBe("2026-09-08T02:48:38.418Z");
    expect(read.checkpoint.heartbeat.ticks).toBeGreaterThan(0);
    expect(read.checkpoint.cursor.events).toBe(events.length);
  });

  test("a repeated collection is a no-op, not an event and not an alarm", async () => {
    const root = tempRoot();
    const { events, notes } = await run(
      root,
      async function* () {
        yield payload(fixture("duplicate-first"));
        // The same collection again: what a reconnect and a poll both give.
        yield payload(fixture("duplicate-second"), "poll");
        yield payload(fixture("duplicate-second"));
      },
      { clock: fakeClock("2026-09-08T02:41:10.000Z") },
    );
    const seen = events.filter((e) => e.kind === "session-seen").length;
    expect(events.length).toBe(seen);
    expect(notes.filter((n) => n.kind === "condition-degraded")).toEqual([]);
  });
});

describe("the three ways of not knowing do not collapse into one silence", () => {
  test("a dropped stream is recorded, and its return is too", async () => {
    const root = tempRoot();
    const { notes } = await run(root, async function* () {
      yield { kind: "stream-opened", atMs: 0, why: "subscribed" };
      yield payload(fixture("session-new-before"));
      yield { kind: "stream-closed", atMs: 0, why: "the dashboard ended the stream" };
      yield payload(fixture("session-new-after"), "poll");
      yield { kind: "stream-opened", atMs: 0, why: "subscribed" };
    });
    const conditions = notes.filter((n) => n.kind === "condition-degraded" || n.kind === "condition-restored");
    expect(conditions.map((n) => `${n.kind}:${"condition" in n ? n.condition : ""}`)).toEqual([
      "condition-degraded:sse-stream",
      "condition-restored:sse-stream",
    ]);
    // AND THE POLL KEPT THE HISTORY GOING. A degradation of the transport is
    // not a gap in what was learned, and the two must not be confused.
    expect(eventsIn(root).some((e) => e.kind === "session-seen")).toBe(true);
  });

  test("a failing poll while the stream is down is its own condition", async () => {
    const root = tempRoot();
    const { notes } = await run(root, async function* () {
      yield { kind: "stream-closed", atMs: 0, why: "could not connect: ECONNREFUSED" };
      yield { kind: "poll-failed", atMs: 0, why: "could not connect: ECONNREFUSED" };
      yield { kind: "poll-failed", atMs: 0, why: "could not connect: ECONNREFUSED" };
      yield payload(fixture("session-new-before"), "poll");
    });
    const degraded = notes.filter((n) => n.kind === "condition-degraded");
    // TWO CAUSES, TWO NOTES, and one note each however many times they repeat.
    expect(degraded.map((n) => ("condition" in n ? n.condition : ""))).toEqual(["sse-stream", "poll"]);
    expect(notes.filter((n) => n.kind === "condition-restored").map((n) => ("condition" in n ? n.condition : ""))).toEqual(["poll"]);
    // The stream never came back, so its condition is still open at the end.
    expect(openConditions(notes).map((c) => c.condition)).toEqual(["sse-stream"]);
  });

  test("a payload the gate refuses degrades the snapshots condition and clears when one is accepted", async () => {
    const root = tempRoot();
    const { notes, events } = await run(root, async function* () {
      // The dashboard's own collection failed. It broadcasts anyway, carrying
      // the previous collection's rows and clock.
      yield payload(fixtureWith("session-new-before", { error: "tmux list-panes timed out" }));
      yield payload(fixture("session-new-before"));
    });
    const conditions = notes.filter((n) => n.kind === "condition-degraded" || n.kind === "condition-restored");
    expect(conditions.map((n) => ("condition" in n ? `${n.kind}:${n.condition}` : ""))).toEqual([
      "condition-degraded:snapshots",
      "condition-restored:snapshots",
    ]);
    // AND NOTHING WAS DIFFED FROM THE REFUSED ONE.
    expect(events.length).toBe(6);
    expect(events.every((e) => e.kind === "session-seen")).toBe(true);
  });

  test("a snapshot with no readable generation holds the baseline, and says so", async () => {
    const root = tempRoot();
    const { notes, events } = await run(root, async function* () {
      yield payload(fixture("session-new-before"));
      // Sessions, and no tmux generation: its handles cannot be told apart from
      // the ones already recorded, so `diff()` refuses to compare. A collection
      // of its own, because two payloads sharing one `collectedAt` and
      // disagreeing about the generation is a different fault entirely (S2-05),
      // and the gate rejects that pair before the differ ever sees it.
      yield payload(fixtureWith("session-new-after", { tmuxServerPid: null, collectedAt: "2026-09-08T02:48:00.000Z" }));
      yield payload(fixture("session-new-after"));
    });
    const conditions = notes.filter((n) => n.kind === "condition-degraded" || n.kind === "condition-restored");
    expect(conditions.map((n) => ("condition" in n ? `${n.kind}:${n.condition}` : ""))).toEqual([
      "condition-degraded:baseline",
      "condition-restored:baseline",
    ]);
    // THE BASELINE DID NOT MOVE while it was held: the new session is found
    // when a readable generation arrives, not lost because the held snapshot
    // was quietly taken as the new baseline.
    expect(events.filter((e) => e.kind === "session-seen").length).toBe(7);
    expect(events.filter((e) => e.kind === "tmux-session-gone").length).toBe(1);
  });

  test("a held snapshot still moves the clock, so an older payload after it is refused", async () => {
    const root = tempRoot();
    const { notes, events } = await run(root, async function* () {
      yield payload(fixture("session-new-before"));
      // Admissible, and unplaceable. The BASELINE must not move; the ACCEPTED
      // mark must, because this is still the newest collection we have seen.
      yield payload(fixtureWith("session-new-after", { tmuxServerPid: null, collectedAt: "2026-09-08T02:48:00.000Z" }));
      // Older than the held one and newer than the baseline. If the two marks
      // were one, this would sail through and be diffed — a stale body served
      // after a fresher one, recorded as if it were what happened next.
      yield payload(fixtureWith("session-new-after", { collectedAt: "2026-09-08T02:47:50.000Z" }));
    });
    const refusal = notes.find((n) => n.kind === "condition-degraded" && n.condition === "snapshots");
    expect(refusal).toBeDefined();
    if (refusal?.kind !== "condition-degraded") throw new Error("expected a refusal");
    expect(refusal.why).toContain("went backwards");
    expect(events.length).toBe(6);
  });

  test("the watchdog fires when payloads keep arriving and none is a new collection", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T03:00:00.000Z");
    const { notes } = await run(
      root,
      async function* () {
        yield payload(fixture("session-new-before"));
        // The transport is perfectly healthy — the same cached snapshot keeps
        // arriving — and the collector behind it has wedged. Nothing but the
        // watchdog can see this: every transport measure says all is well.
        clock.advance(6 * 60_000);
        await new Promise((r) => setTimeout(r, 40));
        yield payload(fixture("session-new-before"));
        await new Promise((r) => setTimeout(r, 20));
        // The collector comes back, and this collection really is current.
        yield payload(fixtureWith("session-new-after", { collectedAt: new Date(clock.ms() - 4_000).toISOString() }));
      },
      { clock },
    );
    const conditions = notes.filter((n) => n.kind === "condition-degraded" || n.kind === "condition-restored");
    expect(conditions.map((n) => ("condition" in n ? `${n.kind}:${n.condition}` : ""))).toEqual([
      "condition-degraded:freshness",
      "condition-restored:freshness",
    ]);
  });
});

describe("a restart does not re-announce the fleet", () => {
  test("the second run resumes, and the sessions it already knew about produce no new events", async () => {
    const root = tempRoot();
    await run(root, async function* () {
      yield payload(fixture("session-new-before"));
    });
    const afterFirst = eventsIn(root).length;
    expect(afterFirst).toBe(6);

    // kill -9 leaves no `daemon-stopped` note and no clean close; the second
    // run reads the checkpoint and the stored baseline.
    const second = await run(root, async function* () {
      yield payload(fixture("session-new-after"));
    });
    const startedAgain = second.notes.filter((n) => n.kind === "daemon-started").at(-1);
    if (startedAgain?.kind !== "daemon-started") throw new Error("expected a start note");
    expect(startedAgain.opening).toContain("Resumed");
    expect(startedAgain.baseline).toContain("restored");

    // ONE session left and ONE arrived, so TWO new events — not six more
    // `session-seen` for sessions the register already held.
    expect(second.events.length).toBe(afterFirst + 2);
    expect(second.events.map((e) => e.kind).slice(-2)).toEqual(["tmux-session-gone", "session-seen"]);
  });

  test("a stored baseline that cannot be placed in a world is not one, and the register still comes right", async () => {
    const root = tempRoot();
    await run(root, async function* () {
      yield payload(fixture("session-new-before"));
    });
    // The awkward corner: history, a register, and a stored collection that
    // `diff()` would refuse — sessions listed with no readable tmux generation.
    // Nothing is closed out on the strength of a snapshot we cannot place; the
    // daemon waits for one it can, and reconciles against that.
    writeFileSync(
      join(root, "last-snapshot.json"),
      JSON.stringify({ schema: 1, payload: fixtureWith("session-new-before", { tmuxServerPid: null }) }),
    );
    const second = await run(root, async function* () {
      yield payload(fixture("session-new-after"));
    });
    const startedAgain = second.notes.filter((n) => n.kind === "daemon-started").at(-1);
    if (startedAgain?.kind !== "daemon-started") throw new Error("expected a start note");
    expect(startedAgain.baseline).toContain("cannot be a baseline");
    const read = readCheckpoint(root);
    if (read.kind !== "checkpoint") throw new Error("expected a checkpoint");
    expect(read.checkpoint.register.length).toBe(6);
    expect(read.checkpoint.register.map((entry) => entry.tmuxId)).not.toContain("$1992");
  });

  test("a cold store ignores a stored baseline, because the register it would rely on is empty", async () => {
    const root = tempRoot();
    await run(root, async function* () {
      yield payload(fixture("session-new-before"));
    });
    // The other half of the disposability rule: the log and the checkpoint are
    // gone and the baseline file survives. The store starts COLD with an empty
    // register — and a baseline without its register is the mirror of the bug
    // above: `diff()` would emit only the DELTAS, so the register would hold
    // whichever two sessions happened to change and no others, for ever.
    rmSync(join(root, EVENTS_FILE));
    rmSync(join(root, "current.json"));
    const second = await run(root, async function* () {
      yield payload(fixture("session-new-after"));
    });
    const startedAgain = second.notes.filter((n) => n.kind === "daemon-started").at(-1);
    if (startedAgain?.kind !== "daemon-started") throw new Error("expected a start note");
    expect(startedAgain.opening).toContain("COLD");
    expect(startedAgain.baseline).toContain("not used");
    expect(second.events.filter((e) => e.kind === "session-seen").length).toBe(6);
    const read = readCheckpoint(root);
    if (read.kind !== "checkpoint") throw new Error("expected a checkpoint");
    expect(read.checkpoint.register.length).toBe(6);
  });

  test("a lost baseline file starts the fold again rather than refusing to run", async () => {
    const root = tempRoot();
    await run(root, async function* () {
      yield payload(fixture("session-new-before"));
    });
    // The store is disposable, and that has to include half of it: an OOM kill
    // between the two writes, or somebody deleting a file.
    rmSync(join(root, "last-snapshot.json"));
    const second = await run(root, async function* () {
      yield payload(fixture("session-new-after"));
    });
    const startedAgain = second.notes.filter((n) => n.kind === "daemon-started").at(-1);
    if (startedAgain?.kind !== "daemon-started") throw new Error("expected a start note");
    expect(startedAgain.baseline).toContain("none");
    // Six more `session-seen`, so the log is noisier — that is the cost.
    expect(second.events.filter((e) => e.kind === "session-seen").length).toBe(12);
    // AND THE REGISTER IS STILL RIGHT, which is the part that is not allowed to
    // be a cost. `diff(null, next)` closes nothing out, so `$1992` — which left
    // between the two captures — would otherwise sit in the register FOR EVER:
    // absent from every future baseline, so absent from every future
    // comparison, and indistinguishable from a live session.
    const gone = second.events.filter((e) => e.kind === "tmux-session-gone");
    expect(gone.map((e) => (e.kind === "tmux-session-gone" ? e.name : ""))).toHaveLength(1);
    const read = readCheckpoint(root);
    if (read.kind !== "checkpoint") throw new Error("expected a checkpoint");
    expect(read.checkpoint.register.length).toBe(6);
    expect(read.checkpoint.register.map((entry) => entry.tmuxId)).not.toContain("$1992");
  });
});

describe("refusing to be the second daemon", () => {
  test("a running daemon's lock stops a second one, and the second says who has it", async () => {
    const root = tempRoot();
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));

    const first = runOverseer({
      root,
      baseUrl: "http://127.0.0.1:0",
      signal: new AbortController().signal,
      tickMs: 5,
      log: () => undefined,
      source: () =>
        (async function* () {
          yield payload(fixture("session-new-before"));
          await held;
        })(),
    });

    // Give the first one time to take the lock and write its start note.
    await new Promise((r) => setTimeout(r, 60));
    const second = await runOverseer({
      root,
      baseUrl: "http://127.0.0.1:0",
      signal: new AbortController().signal,
      tickMs: 5,
      log: () => undefined,
      source: () => (async function* () { yield payload(fixture("session-new-after")); })(),
    });
    expect(second.kind).toBe("refused");
    if (second.kind !== "refused") throw new Error("expected a refusal");
    expect(second.refusal.reason).toBe("already-running");

    release();
    expect((await first).kind).toBe("stopped");
    // AND THE REFUSED ONE WROTE NOTHING. A second daemon that logged its own
    // start into the same file would be the first line of a history nobody
    // could trust.
    const notes = readNotes(root).notes;
    expect(notes.filter((n) => n.kind === "daemon-started").length).toBe(1);
  });
});

describe("stopping", () => {
  test("an abort ends the daemon, writes a stopping note and leaves the lock free", async () => {
    const root = tempRoot();
    const controller = new AbortController();
    const outcome = await runOverseer({
      root,
      baseUrl: "http://127.0.0.1:0",
      signal: controller.signal,
      tickMs: 5,
      log: () => undefined,
      source: () =>
        (async function* () {
          yield payload(fixture("session-new-before"));
          controller.abort();
          // A real source checks the signal; this one just stops.
        })(),
    });
    expect(outcome.kind).toBe("stopped");
    const notes = readNotes(root).notes;
    expect(notes.at(-1)?.kind).toBe("daemon-stopped");
    expect(existsSync(join(root, "overseer.lock"))).toBe(false);
    expect(existsSync(join(root, NOTES_FILE))).toBe(true);
  });

  test("a daemon that throws writes down that it threw, and lets go of the lock", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T02:48:40.000Z");
    await expect(
      runOverseer({
        root,
        baseUrl: "http://127.0.0.1:0",
        signal: new AbortController().signal,
        now: clock.now,
        tickMs: 5,
        log: () => undefined,
        source: () =>
          (async function* () {
            yield payload(fixture("session-new-before"));
            throw new Error("the source exploded");
          })(),
      }),
    ).rejects.toThrow("the source exploded");

    // WITHOUT THE CRASH PATH THIS IS INDISTINGUISHABLE FROM A `kill -9`: no
    // stopping note, and a lock file naming a pid that is probably still alive
    // because the process that died was a test worker. The two want different
    // things done about them, so they must not look alike.
    const notes = readNotes(root).notes;
    const last = notes.at(-1);
    if (last?.kind !== "daemon-stopped") throw new Error("expected a stopping note");
    expect(last.why).toContain("the daemon threw");
    expect(last.why).toContain("the source exploded");
    expect(existsSync(join(root, "overseer.lock"))).toBe(false);
    // And the events from before the explosion are still there.
    expect(eventsIn(root).length).toBe(6);
  });
});

describe("the fixtures this file leans on", () => {
  test("the captured pair really is one new session, so the counts above mean what they say", () => {
    const before = rowsOf(editableFixture("session-new-before")).map((row) => row["id"]);
    const after = rowsOf(editableFixture("session-new-after")).map((row) => row["id"]);
    expect(before.length).toBe(6);
    expect(after.length).toBe(6);
    expect(after.filter((id) => !before.includes(id))).toEqual(["$2243"]);
    expect(before.filter((id) => !after.includes(id))).toEqual(["$1992"]);
  });
});
