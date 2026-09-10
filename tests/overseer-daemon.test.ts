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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  latestAttempt,
  runOverseer,
  staleAfterMs,
  type DaemonOptions,
} from "../tools/overseer/daemon.js";
import { behaviourHash, type Arming, type AuthorisedJob, type JobDefinition } from "../tools/overseer/jobs.js";
import type { ReadDocument } from "../tools/overseer/schedule-plan.js";
import { NOTES_FILE, openConditions, readNotes, type DaemonNote } from "../tools/overseer/notes.js";
import { parseAttempt, parseObservation, type JsonValue, type ObservedAttemptClock } from "../tools/overseer/observation.js";
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
  options: {
    clock?: ReturnType<typeof fakeClock>;
    tickMs?: number;
    jobs?: DaemonOptions["jobs"];
    schedulerDetail?: string;
    /**
     * What this run is expected to END as. Defaults to a clean stop, which is
     * every other test here — one deliberately takes the lock away mid-run, and
     * `lock-lost` is then the CORRECT outcome rather than a failure to assert
     * past.
     */
    outcome?: "stopped" | "lock-lost";
  } = {},
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
    // Absent rather than undefined: `exactOptionalPropertyTypes` tells those
    // apart, and an ABSENT `jobs` is what makes the daemon build no scheduler.
    ...(options.jobs === undefined ? {} : { jobs: options.jobs }),
    ...(options.schedulerDetail === undefined ? {} : { schedulerDetail: options.schedulerDetail }),
  });
  expect(outcome.kind).toBe(options.outcome ?? "stopped");
  return { notes: notesIn(root), events: eventsIn(root) };
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

/**
 * The three readings, by name. Built here rather than parsed because these unit
 * tests are about what `collectorVerdict` does WITH a reading; that the parser
 * produces the right one from a payload is `parseAttempt`'s own test, and the
 * end-to-end tests below go through the real thing.
 */
const attemptedAt = (atMs: number): ObservedAttemptClock => ({
  reported: true,
  attempted: true,
  at: new Date(atMs).toISOString(),
  atMs,
});
const cannotSay = (why: string): ObservedAttemptClock => ({ reported: false, why });
const neverAttempted: ObservedAttemptClock = { reported: true, attempted: false };

describe("the collector, which is a third thing from the source and the payload", () => {
  // Measured 2026-09-08: `/api/state` served a `collectedAt` ~30 minutes stale
  // with `error: null`. The cause was `collect()`'s child taking SIGTERM in
  // uninterruptible IO on a swapping box, so `execFile` waited for a process
  // that was never coming back, the chained refresh loop never reached its next
  // iteration, and nothing threw. THE THING THAT WOULD HAVE REPORTED THE
  // FAILURE WAS THE THING THAT HAD STOPPED. `attemptedAt` — set BEFORE each
  // attempt — is what tells that apart from a source that is failing loudly.
  test("an attempt that never advances is a stopped collector, not a stale payload", () => {
    const verdict = collectorVerdict({ attempt: attemptedAt(0), lastPayloadAtMs: 400_000, nowMs: 400_000, refreshMs: 60_000 });
    expect(verdict.kind).toBe("stopped");
    if (verdict.kind !== "stopped") throw new Error("expected a stopped collector");
    expect(verdict.why).toContain("has not started a collection");
  });

  test("an attempt inside the deadline is a collector that is still trying", () => {
    // The source failing LOUDLY looks like this: it keeps attempting, and
    // `error` says how. That is a different condition and a different action.
    expect(collectorVerdict({ attempt: attemptedAt(340_000), lastPayloadAtMs: 400_000, nowMs: 400_000, refreshMs: 60_000 }).kind).toBe("collecting");
  });

  test("a producer that does not report attempts is never called wedged", () => {
    // `attemptedAt` is a new field on an unchanged schema, so an older server
    // simply does not send it. Reading its absence as "never attempted" would
    // make every old dashboard look permanently stopped — the alarm that is
    // always wrong, which is the failure this whole watchdog is designed around.
    const verdict = collectorVerdict({ attempt: null, lastPayloadAtMs: 400_000, nowMs: 400_000, refreshMs: 60_000 });
    expect(verdict.kind).toBe("cannot-tell");
  });

  test("a producer that STOPS reporting attempts retires the reading it used to give", () => {
    // THE P1. `parseAttempt` says "cannot tell" correctly and the daemon used
    // to keep only the newest POSITIVE timestamp, so the reading it could no
    // longer take was answered with the last one it could — and at 420s that
    // stale answer reads as a stopped collector. A dashboard rolled back to a
    // build without the field is the ordinary way in.
    const blind = collectorVerdict({
      attempt: cannotSay("this payload has rows and a collection time but no attempt clock"),
      lastPayloadAtMs: 420_000,
      nowMs: 420_000,
      refreshMs: 60_000,
    });
    expect(blind.kind).toBe("cannot-tell");
    if (blind.kind !== "cannot-tell") throw new Error("expected no opinion");
    expect(blind.why).toContain("no attempt clock");
    // AND NOT THE MISTAKE IN THE OTHER DIRECTION. `collecting` would be a
    // restoration, which would clear a real collector alarm the moment the
    // producer's clock became unreadable.
    expect(blind.kind).not.toBe("collecting");
  });

  test("a producer that says it has never started one is not a wedged collector either", () => {
    // Both fields absent lands here too, so this is also the dashboard that has
    // only just come up. `freshness` is what reports a dashboard that never
    // gives us a collection; a second alarm here would be two names for it.
    const verdict = collectorVerdict({ attempt: neverAttempted, lastPayloadAtMs: 420_000, nowMs: 420_000, refreshMs: 60_000 });
    expect(verdict.kind).toBe("cannot-tell");
  });

  test("a reading that cannot answer replaces one that could, and never the other way round", () => {
    // The fold that makes the above reachable. THE EXPECTATIONS ARE WRITTEN
    // OUT, not computed from `latestAttempt` itself: an assertion derived from
    // the function under test holds for whatever it returns.
    const good = attemptedAt(100_000);
    const blind = cannotSay("attemptedAt is 17, which is not a timestamp");
    expect(latestAttempt(good, blind)).toEqual(blind);
    expect(latestAttempt(blind, good)).toEqual(good);
    expect(latestAttempt(null, blind)).toEqual(blind);
    // An older POSITIVE reading is the one thing that does not displace a newer
    // one: a reconnect replaying a payload we have already seen is not the
    // collector going backwards in time.
    expect(latestAttempt(good, attemptedAt(90_000))).toEqual(good);
    expect(latestAttempt(good, attemptedAt(110_000))).toEqual(attemptedAt(110_000));
  });

  test("nothing arriving at all is the transport's business, not the collector's", () => {
    // If we are not hearing from the dashboard, we cannot say anything about
    // its collector — and `sse-stream`, `poll` and `freshness` already say what
    // is wrong. A fourth alarm here would be three names for one outage.
    const verdict = collectorVerdict({ attempt: attemptedAt(0), lastPayloadAtMs: 0, nowMs: 900_000, refreshMs: 60_000 });
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

  test("end to end: a producer that STOPS reporting attempts is not called a stopped collector", async () => {
    // THE FINDING. A reading that could not be taken must not be answered with
    // an older reading that could. Roll the dashboard back to a build from
    // before `attemptedAt` existed — the fixtures are exactly that, none of
    // them carries the field — and every later payload says "cannot tell".
    // Holding only the newest POSITIVE timestamp, the daemon went on measuring
    // the age of a reading seven minutes old and called the collector stopped,
    // on a dashboard that is collecting perfectly well and saying so in
    // `collectedAt`.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T02:47:25.000Z");
    const { notes } = await run(
      root,
      async function* () {
        // 10:00 in the review's table: a clock we could read.
        yield payload(fixtureWith("session-new-before", { attemptedAt: new Date(clock.ms() - 5_000).toISOString() }));
        // A tick here, so the collector condition is RESTORED on the strength
        // of that reading. Without it the expectation below would be an empty
        // list, which is also what a test that never reached the case prints.
        await new Promise((r) => setTimeout(r, 40));
        // 10:07: seven minutes on — past the five-minute deadline — and the
        // producer no longer reports the field. No sleep before the yield, so
        // the watchdog is asked about this payload rather than about the pause.
        clock.advance(7 * 60_000);
        yield payload(fixtureWith("session-new-after", { collectedAt: new Date(clock.ms() - 3_000).toISOString() }));
        await new Promise((r) => setTimeout(r, 40));
      },
      { clock },
    );
    // THE SECOND PAYLOAD REALLY WAS ACCEPTED AND REALLY DID SAY "CANNOT TELL".
    // An empty list of collector notes is also what a test that never reached
    // the case prints, and both halves of the case have to be pinned: a
    // checkpoint at the rolled-back producer's own `collectedAt` proves the
    // payload went all the way through the fold, and `parseAttempt` proves the
    // reading it carried could not answer. Neither number is computed from the
    // daemon under test.
    const read = readCheckpoint(root);
    if (read.kind !== "checkpoint") throw new Error("expected a checkpoint");
    expect(read.checkpoint.lastGoodSnapshotAt).toBe(new Date(clock.ms() - 3_000).toISOString());
    expect(parseAttempt(fixture("session-new-after")).reported).toBe(false);

    const of = (condition: string) => notes.filter((n) => "condition" in n && n.condition === condition).map((n) => n.kind);
    // NOT DEGRADED. Seven minutes of "cannot tell" is not seven minutes of a
    // stopped collector, and the ticker asked several times.
    expect(of("collector")).toEqual([]);
    expect(read.checkpoint.heartbeat.ticks).toBeGreaterThan(0);
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
  test("an unreadable note log is a named startup refusal and leaves no store lock", async () => {
    const root = tempRoot();
    const path = join(root, NOTES_FILE);
    mkdirSync(path);

    const outcome = await runOverseer({
      root,
      baseUrl: "http://127.0.0.1:0",
      signal: new AbortController().signal,
      log: () => undefined,
      source: () => (async function* () {})(),
    });

    expect(outcome).toMatchObject({
      kind: "refused",
      refusal: { reason: "unusable-log", path },
    });
    expect(existsSync(join(root, "overseer.lock"))).toBe(false);
  });

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
    const notes = notesIn(root);
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
    const notes = notesIn(root);
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
    const notes = notesIn(root);
    const last = notes.at(-1);
    if (last?.kind !== "daemon-stopped") throw new Error("expected a stopping note");
    expect(last.why).toContain("the daemon threw");
    expect(last.why).toContain("the source exploded");
    expect(existsSync(join(root, "overseer.lock"))).toBe(false);
    // And the events from before the explosion are still there.
    expect(eventsIn(root).length).toBe(6);
  });
});

describe("the scheduler on the daemon's clock", () => {
  /** Real milliseconds, only so the timers under test actually fire. The daemon's own clock is still the fake one. */
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  const JOB: JobDefinition = {
    behaviour: { id: "prod-the-overseer", what: "say hello", documents: [], work: { kind: "session" }, dispatch: { kind: "live" } },
    schedule: { everyMs: 60_000, leaseMs: 120_000, initialDelayMs: 0 },
  };
  /** Pinned to its own fingerprint: this file is about the daemon's timers, and the pin itself is tested in overseer-jobs.test.ts. */
  const AUTHORISED: AuthorisedJob = { definition: JOB, authorisedDocuments: [], authorisedHash: behaviourHash(JOB.behaviour) };

  /**
   * THE ARMING AND THE SPACING GATE, both set so the daemon's TIMERS are what
   * these tests measure.
   *
   * The arming instant is long before any clock in this file and every schedule
   * here carries `initialDelayMs: 0`, so a job with no history is due on the
   * first tick — which is what `due` said unconditionally before the first-run
   * delay arrived (GPT Sol's S8-6). Zero spacing because a live gate would hold
   * the SECOND dispatch in the stuck-lease test below, and that test is about
   * the lease.
   */
  const ARMED: Arming = { kind: "armed", at: "2026-09-08T00:00:00.000Z" };
  const NO_SPACING = 0;
  /** Every session job in this file leans on no document, so a tick that asked for one would be a bug — it says so rather than inventing a digest. */
  const NO_DOCUMENTS: ReadDocument = (path) => ({ kind: "unreadable", path, why: "no job in this file leans on a document" });

  test("a job whose work never settles is dispatched, reported STUCK, and dispatched again — while the heartbeat goes on ticking", async () => {
    // The daemon-level statement of GPT Sol's S6. The in-memory
    // `attentionRunning` idiom this replaces would have produced exactly one
    // dispatch, no report at all, a healthy heartbeat, and a job that never ran
    // again — which is the picture a working fleet also makes.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T02:48:40.000Z");
    const lines: string[] = [];
    const spawned: number[] = [];

    const outcome = await runOverseer({
      root,
      baseUrl: "http://127.0.0.1:0",
      signal: new AbortController().signal,
      now: clock.now,
      tickMs: 5,
      log: (line) => lines.push(line),
      source: () =>
        (async function* () {
          yield payload(fixture("session-new-before"));
          await sleep(40);
          // Past the two-minute lease, on the daemon's own clock.
          clock.advance(180_000);
          await sleep(40);
        })(),
      jobs: {
        intervalMs: 5,
        arming: ARMED,
        launchSeparationMs: NO_SPACING, readDocument: NO_DOCUMENTS,
        definitions: [AUTHORISED],
        spawn: () => {
          spawned.push(spawned.length);
          // NEVER SETTLES. This is the hung model subprocess the whole lease
          // exists for, and it is the one shape the old guard could not survive.
          return { kind: "spawned", pid: 9191, done: new Promise<never>(() => undefined) };
        },
      },
    });

    expect(outcome.kind).toBe("stopped");
    expect(spawned.length).toBeGreaterThanOrEqual(2);
    expect(lines.some((line) => line.includes("STUCK"))).toBe(true);

    // REPORTED DURABLY, not only on a console somebody was not keeping.
    const notes = notesIn(root);
    const unaccounted = notes.filter((note) => note.kind === "job-unaccounted");
    expect(unaccounted.length).toBeGreaterThanOrEqual(1);
    expect(unaccounted[0]?.kind === "job-unaccounted" && unaccounted[0].reason).toBe("lease-expired");

    // AND THE TICK LOOP WAS NEVER BLOCKED — the heartbeat is the thing a reader
    // uses to tell a dead Overseer from a quiet one, so a scheduler that stalled
    // it would replace one blindness with another.
    const read = readCheckpoint(root);
    expect(read.kind).toBe("checkpoint");
    if (read.kind !== "checkpoint") return;
    expect(read.checkpoint.heartbeat.ticks).toBeGreaterThan(0);
    expect(read.checkpoint.jobs.occurrences.length).toBeGreaterThan(0);
  });

  /** The scheduler's own events, in order — the session ones the fixture also produces are another describe's business. */
  const scheduledKinds = (events: readonly OverseerEvent[]): string[] =>
    events.map((event) => event.kind).filter((kind) => kind.startsWith("job-occurrence") || kind.startsWith("rule-"));

  /** A rule job, pinned to its own fingerprint. The shipped pin lives in `rule-jobs.ts` and is tested in overseer-rules.test.ts; this file is about the daemon's timers. */
  const RULE: JobDefinition = {
    behaviour: {
      id: "wedged-work",
      what: "propose kills for wedged work",
      documents: [],
      work: { kind: "rule", rule: { kind: "wedged-work", minAgeSeconds: 4 * 3600, policy: "safe-to-kill", disposition: "propose" } }, dispatch: { kind: "live" },
    },
    schedule: { everyMs: 60_000, leaseMs: 120_000, initialDelayMs: 0 },
  };
  const RULE_AUTHORISED: AuthorisedJob = { definition: RULE, authorisedDocuments: [], authorisedHash: behaviourHash(RULE.behaviour) };

  test("A RULE STILL LOOKING WHEN THE DAEMON STOPS IS WAITED FOR, so its settlement is not lost", async () => {
    // GPT Sol's SC-1, the half that bites today. `runProposingRule` returns a hot
    // promise and the daemon used to neither retain nor await it, on a comment
    // saying every scheduled job is a separate process — which is true of a
    // session and false of a rule, because a rule runs INSIDE the daemon.
    //
    // So an orderly shutdown closed the store while `observe` was still in
    // flight, and `rule-settled` and `job-occurrence-finished` were then written
    // to a closed store and lost — leaving a `started` occurrence with no
    // ending, which the next boot reads as an unaccountable run. Nothing has
    // acted, so nothing is dangerous; it manufactures exactly the noise the
    // occurrence ledger exists to make meaningful.
    const root = tempRoot();
    let look: (() => void) | null = null;
    const { events } = await run(
      root,
      async function* () {
        yield payload(fixture("session-new-before"));
        // Long enough for the jobs ticker to dispatch and for `observe` to be
        // called; the source then ENDS with the rule still looking.
        await sleep(40);
        look?.();
      },
      {
        jobs: {
          intervalMs: 5,
          arming: ARMED,
          launchSeparationMs: NO_SPACING, readDocument: NO_DOCUMENTS,
          definitions: [RULE_AUTHORISED],
          rules: {
            selfPid: 4242,
            // Settles only when the source says so, which is the instant before
            // the daemon starts shutting down.
            observe: () =>
              new Promise((resolve) => {
                look = () => resolve({ kind: "wedged", candidates: [], scanned: 750 });
              }),
          },
        },
      },
    );
    // BOTH ENDINGS ARE ON THE DISK. Without the wait the run stops at
    // `rule-settled` — the completion append lands on a closed store, throws an
    // unhandled rejection out of a promise nobody is holding, and the occurrence
    // is unaccountable for ever.
    expect(scheduledKinds(events)).toEqual(["job-occurrence-reserved", "job-occurrence-started", "rule-settled", "job-occurrence-finished"]);
  });

  test("A RULE THAT NEVER SETTLES CANNOT HOLD SHUTDOWN OPEN, and the giving up is written down", async () => {
    // The bound on the wait above, and the other half of SC-1's live part: an
    // unbounded await would turn a hung observer into a daemon that cannot be
    // restarted, which is a worse failure than the one being fixed. The give-up
    // is its own durable note rather than a silent timeout, because a shutdown
    // that abandoned a run and said nothing is the shape of every bug in this
    // area.
    const root = tempRoot();
    const { notes, events } = await run(
      root,
      async function* () {
        yield payload(fixture("session-new-before"));
        await sleep(40);
      },
      {
        jobs: {
          intervalMs: 5,
          arming: ARMED,
          launchSeparationMs: NO_SPACING, readDocument: NO_DOCUMENTS,
          // Short enough that the test is quick; the shipped one is measured in
          // seconds against a ten-second observer timeout.
          settleGraceMs: 20,
          definitions: [RULE_AUTHORISED],
          rules: { selfPid: 4242, observe: () => new Promise(() => undefined) },
        },
      },
    );
    expect(scheduledKinds(events)).toEqual(["job-occurrence-reserved", "job-occurrence-started"]);
    const lost = notes.filter((note) => note.kind === "job-record-lost");
    expect(lost.length).toBe(1);
    expect(lost[0]?.kind === "job-record-lost" && lost[0].jobId).toBe("wedged-work");
    expect(lost[0]?.kind === "job-record-lost" && lost[0].fact).toBe("finished");
    expect(lost[0]?.kind === "job-record-lost" && lost[0].why).toContain("still running when the daemon stopped");
  });

  test("a daemon given no jobs writes no occurrences at all", async () => {
    // The option is absent in every other test in this file, so this asserts
    // what those tests silently rely on — and it is the check that would catch a
    // scheduler wired into the tick loop unconditionally.
    const root = tempRoot();
    const { events } = await run(root, async function* () {
      yield payload(fixture("session-new-before"));
    });
    expect(events.filter((event) => event.kind.startsWith("job-occurrence"))).toEqual([]);
    const read = readCheckpoint(root);
    if (read.kind !== "checkpoint") throw new Error("expected a checkpoint");
    expect(read.checkpoint.jobs.occurrences).toEqual([]);
    // AND THE CHECKPOINT SAYS SO, which is the half GPT Sol's C1 was about: an
    // empty occurrence list is what a disarmed scheduler and a busy-but-idle one
    // both produce, so the reader needs a field rather than an inference.
    expect(read.checkpoint.scheduler.kind).toBe("off");
    expect(read.checkpoint.scheduler.why).toContain("no scheduled jobs");
  });

  test("a completion the store would not take lands in daemon.jsonl, not only on a console", async () => {
    // GPT Sol's C5, at the level a person actually reads. The child finished and
    // the ledger could not be told, so the durable history says `started` for
    // ever — and until this note existed nothing anywhere said why. A console
    // line is not a report; the note log is.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T02:48:40.000Z");
    let settleRun: ((code: number) => void) | null = null;
    const { notes } = await run(
      root,
      async function* () {
        yield payload(fixture("session-new-before"));
        await sleep(30);
        // The child finishes AFTER the lock has been taken from under the
        // daemon, so its completion append is refused for real rather than by a
        // stub — the same shape as a second daemon starting beside this one.
        writeFileSync(
          join(root, "overseer.lock"),
          `${JSON.stringify({ pid: process.pid, instanceId: "somebody-else", hostname: "box", startedAt: "2026-09-08T02:00:00.000Z" })}\n`,
        );
        settleRun?.(0);
        await sleep(40);
      },
      {
        clock,
        // Taking the lock away is what refuses the append, and it correctly
        // stops the daemon a moment later — the note has to survive that.
        outcome: "lock-lost",
        jobs: {
          intervalMs: 5,
          arming: ARMED,
          launchSeparationMs: NO_SPACING, readDocument: NO_DOCUMENTS,
          definitions: [AUTHORISED],
          spawn: () => ({
            kind: "spawned",
            pid: 4242,
            done: new Promise<{ kind: "exited"; code: number }>((resolve) => {
              settleRun = (code) => resolve({ kind: "exited", code });
            }),
          }),
        },
      },
    );
    const lost = notes.filter((note) => note.kind === "job-record-lost");
    expect(lost.length).toBeGreaterThanOrEqual(1);
    expect(lost[0]?.kind === "job-record-lost" && lost[0].fact).toBe("finished");
    expect(lost[0]?.kind === "job-record-lost" && lost[0].jobId).toBe("prod-the-overseer");
  });

  test("a daemon that IS given jobs says armed, in the same field", async () => {
    const root = tempRoot();
    await run(root, async function* () {
      yield payload(fixture("session-new-before"));
    }, {
      jobs: {
        intervalMs: 5,
        arming: ARMED,
        launchSeparationMs: NO_SPACING, readDocument: NO_DOCUMENTS,
        definitions: [AUTHORISED],
        // Refused, so nothing is started and nothing outlives the test — the
        // arming is what is under test, not the dispatch.
        spawn: () => ({ kind: "refused", why: "not in a test" }),
      },
      schedulerDetail: "ARMED — prod-the-overseer",
    });
    const read = readCheckpoint(root);
    if (read.kind !== "checkpoint") throw new Error("expected a checkpoint");
    expect(read.checkpoint.scheduler.kind).toBe("armed");
    expect(read.checkpoint.scheduler.why).toContain("prod-the-overseer");
  });

  test("THE HEADLINE IS MADE OF FRESH EVIDENCE: a document edited while the daemon runs turns ARMED into BLOCKED", async () => {
    // RED FIRST, and it is Sol's P1-1 on plan 260910e. The headline used to be
    // computed once at start, so once the tick re-read documents it could refuse
    // a job while every checkpoint went on saying ARMED — the one line a person
    // trusts, saying the opposite of what the scheduler was doing.
    const root = tempRoot();
    const DOCUMENT = { path: "docs/fixture/daemon-headline.md", sha256: "e".repeat(64) };
    const behaviour: AuthorisedJob["definition"]["behaviour"] = {
      id: "follows-a-document",
      what: "follow the document",
      documents: [DOCUMENT],
      work: { kind: "session" },
      dispatch: { kind: "live" },
    };
    const job: AuthorisedJob = {
      definition: { behaviour, schedule: { everyMs: 60_000, leaseMs: 120_000, initialDelayMs: 0 } },
      authorisedHash: behaviourHash(behaviour),
      authorisedDocuments: [DOCUMENT],
    };
    let digest = DOCUMENT.sha256;
    const headlines: string[] = [];
    const headline = (): string => {
      const read = readCheckpoint(root);
      return read.kind === "checkpoint" ? read.checkpoint.scheduler.kind : read.kind;
    };
    await run(
      root,
      async function* () {
        yield payload(fixture("session-new-before"));
        await sleep(30);
        // NON-VACUOUS FIRST: it really did start ARMED.
        headlines.push(headline());
        digest = "f".repeat(64);
        await sleep(40);
      },
      {
        jobs: {
          intervalMs: 5,
          arming: ARMED,
          launchSeparationMs: NO_SPACING,
          definitions: [job],
          spawn: () => ({ kind: "refused", why: "not in a test" }),
          readDocument: (path) => ({ kind: "read", path, sha256: digest }),
        },
      },
    );
    headlines.push(headline());
    expect(headlines).toEqual(["armed", "blocked"]);
    const read = readCheckpoint(root);
    if (read.kind !== "checkpoint") throw new Error("expected a checkpoint");
    expect(read.checkpoint.scheduler.why).toContain(DOCUMENT.path);
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
