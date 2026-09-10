/**
 * **IS SUPERVISION STILL WORKING?** — the fleet's reading of the Overseer's own
 * state, out of `~/.overseer/current.json`.
 *
 * ## Two kinds of fixture, and the first kind is the one that matters
 *
 * **The happy paths run against a checkpoint the REAL STORE WROTE.** A test
 * that hand-writes `{"heartbeat": {...}}` and then asserts the reader finds a
 * heartbeat proves that the test and the reader agree, which is worth nothing
 * if the producer spells the field differently — and this reader deliberately
 * does not import the producer's parser, so nothing else would catch it. So
 * `realCheckpoint()` opens a store, appends real events through the real fold,
 * and calls `store.checkpoint()`; the bytes on disk are the daemon's bytes.
 * That is the join `docs/postmortems/260908b` is about, in the direction this
 * file can still get wrong.
 *
 * **The pathological ones are hand-written, for the reason the reader exists.**
 * The file is the contract, so a schema this build does not know, a torn write
 * and a heartbeat with a nonsense tick are all things a producer cannot be
 * asked to emit — and one of them (schema 1) is a version of the producer that
 * no longer exists in the tree but was live on the box on 2026-09-08.
 *
 * ## What is being defended
 *
 * The two failures the direction doc names, which look identical through one
 * clock: a daemon that has **stopped** and a daemon that is ticking against a
 * dashboard it can no longer **hear**. Every test below that carries two
 * timestamps is about keeping those apart.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { projectOverseerStatus, readCheckpointFeeds } from "../tools/fleet/overseer-status.js";
import { identityOf, sessionKey, statusKey, type OverseerEvent } from "../tools/overseer/diff.js";
import type { ObservedRow } from "../tools/overseer/observation.js";
import { describeRefusal, openStore, type OverseerStore } from "../tools/overseer/store.js";

const roots: string[] = [];
const opened: OverseerStore[] = [];

afterEach(() => {
  for (const store of opened.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "fleet-overseer-status-"));
  roots.push(root);
  return root;
}

/* ------------------------------------------------------------------ *
 * A checkpoint the real store wrote.
 * ------------------------------------------------------------------ */

const GENERATION = 132280;

function observedRow(over: Partial<ObservedRow> = {}): ObservedRow {
  return {
    id: "$1991",
    name: "overseer-o1-store",
    // Required on a row and not what this file is about — an old producer's
    // shape, which is the honest default for a fixture nobody probed.
    execution: { kind: "unknown", cause: "not-reported", why: "the fixture carried no execution reading" },
    title: null,
    repo: "spideryarn/reading2",
    worktree: "overseer-o1-store",
    meta: { version: 1, kind: "claude", repo: "spideryarn/reading2", dir: "/home/greg/code/spideryarn2" },
    startedAt: "2026-09-08T09:00:00.000Z",
    paneId: "%12",
    panePid: 4242,
    /* Its own uuid: tests/fixture-ids.test.ts treats one appearing in two files
       as a collision, and nothing here touches the database. */
    claimedConversationId: "0e5ee0a1-0f1e-4000-8000-0000000000f1",
    question: null,
    status: { kind: "working" },
    ...over,
  };
}

function seenEvent(row: ObservedRow, at: string): OverseerEvent {
  return { kind: "session-seen", at, tmuxServerPid: GENERATION, key: sessionKey(identityOf(row)), identity: identityOf(row), row };
}

function statusEvent(row: ObservedRow, at: string, status: ObservedRow["status"]): OverseerEvent {
  return {
    kind: "session-status",
    at,
    tmuxServerPid: GENERATION,
    key: sessionKey(identityOf(row)),
    identity: identityOf(row),
    /* The real key functions rather than literals: the register stores what a
       change MEANS, and hand-typed keys would let the two drift apart. */
    from: statusKey(row.status),
    to: statusKey(status),
    status,
  };
}

/**
 * A store, some sessions, and a checkpoint — **written by the producer**.
 *
 * The first session is only ever SEEN, so its `statusSince` is a `lower-bound`:
 * the daemon found it already working and cannot see when it began. The second
 * is seen and then CHANGES, so its `statusSince` is `observed`. Those are the
 * two arms the `≥` on screen is about, and they are produced here by the fold
 * rather than asserted into existence.
 */
function realCheckpoint(root: string, lastGoodSnapshotAt: string | null): void {
  const result = openStore({ root, now: () => new Date("2026-09-08T12:41:07.000Z") });
  if (!result.ok) throw new Error(`could not open the store: ${describeRefusal(result.refusal)}`);
  const store = result.store;
  opened.push(store);
  const working = observedRow();
  const blocked = observedRow({
    id: "$1992",
    name: "fleet-dashboard",
    paneId: "%13",
    claimedConversationId: "0e5ee0a1-0f1e-4000-8000-0000000000f2",
  });
  store.append([seenEvent(working, "2026-09-08T12:10:00.000Z"), seenEvent(blocked, "2026-09-08T12:10:00.000Z")]);
  store.append([statusEvent(blocked, "2026-09-08T12:30:00.000Z", { kind: "needs-you" })]);
  store.checkpoint({
    lastGoodSnapshotAt,
    tick: true,
    scheduler: { kind: "armed", why: "the daemon was started with the scheduler on", at: "2026-09-08T12:00:00.000Z" },
    snapshotStaleAfterMs: 300_000,
  });
}

/* ------------------------------------------------------------------ *
 * A checkpoint written by hand, for the shapes a producer cannot emit.
 * ------------------------------------------------------------------ */

const WRITTEN_AT = "2026-09-08T12:41:07.000Z";

function checkpointObject(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 2,
    writtenAt: WRITTEN_AT,
    lastGoodSnapshotAt: "2026-09-08T12:41:00.000Z",
    cursor: { events: 456, bytes: 168_199 },
    heartbeat: {
      pid: 2_375_511,
      instanceId: "8e8ff0bb-e53a-47a0-b9fe-029a455d87e0",
      startedAt: "2026-09-08T12:00:00.000Z",
      lastTickAt: WRITTEN_AT,
      ticks: 28,
    },
    register: [
      {
        key: "$215 none",
        tmuxId: "$215",
        name: "worktree-schema-move",
        lastStatusKey: "needs-you",
        statusSince: { kind: "lower-bound", at: "2026-09-08T12:28:00.000Z" },
      },
    ],
    attention: { kind: "unknown", why: "no pass has run", scannedAt: WRITTEN_AT },
    usage: { kind: "none", why: "no usage pass has run", at: WRITTEN_AT },
    scheduler: { kind: "off", why: "started with OVERSEER_SCHEDULER=0", at: "2026-09-08T12:00:00.000Z" },
    snapshotStaleAfterMs: 300_000,
    ...over,
  };
}

function writeCheckpoint(root: string, over: Record<string, unknown> = {}): void {
  writeFileSync(join(root, "current.json"), `${JSON.stringify(checkpointObject(over), null, 2)}\n`, "utf8");
}

function recognisedWork(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "work",
    jobs: [
      {
        recogniser: "codex-review",
        label: "GPT review",
        startedAt: "2026-09-08T12:23:00.000Z",
        ranForMs: 18 * 60_000,
        pid: 8123,
        depth: 8,
        command: "codex exec",
      },
    ],
    inspected: 12,
    paneCommand: "claude",
    paneStartedAt: "2026-09-08T09:00:00.000Z",
    ...over,
  };
}

function workScan(panes: unknown[], over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "scan",
    scannedAt: "2026-09-08T12:41:01.000Z",
    sourceCollectedAt: "2026-09-08T12:41:00.000Z",
    panes,
    ...over,
  };
}

/** The projection, or a failure this test would rather see than a `toMatchObject` on undefined. */
function mustPublish(root: string): Extract<ReturnType<typeof readCheckpointFeeds>["overseer"], { kind: "published" }> {
  const feed = readCheckpointFeeds(root).overseer;
  if (feed.kind !== "published") throw new Error(`expected a published status, got ${JSON.stringify(feed)}`);
  return feed;
}

/* ------------------------------------------------------------------ */

describe("against a checkpoint the real store wrote", () => {
  it("reads both clocks, the heartbeat and the scheduler line off the producer's own bytes", () => {
    const root = tempRoot();
    realCheckpoint(root, "2026-09-08T12:41:00.000Z");

    const { status } = mustPublish(root);
    expect(status.schema).toBe(2);
    expect(status.writtenAt).toBe("2026-09-08T12:41:07.000Z");
    /* THE SECOND CLOCK, and the whole reason there are two: this is the
       producer's own `collectedAt`, not ours. */
    expect(status.lastGoodSnapshotAt).toBe("2026-09-08T12:41:00.000Z");
    expect(status.sourceStaleAfterMs).toBe(300_000);
    expect(status.heartbeat.kind).toBe("reading");
    if (status.heartbeat.kind === "reading") {
      expect(status.heartbeat.pid).toBe(process.pid);
      expect(status.heartbeat.ticks).toBe(1);
      expect(status.heartbeat.lastTickAt).toBe("2026-09-08T12:41:07.000Z");
    }
    expect(status.scheduler).toEqual({
      kind: "armed",
      why: "the daemon was started with the scheduler on",
      at: "2026-09-08T12:00:00.000Z",
    });
  });

  it("carries the register's two arms as the fold produced them, oldest status first", () => {
    const root = tempRoot();
    realCheckpoint(root, "2026-09-08T12:41:00.000Z");

    const { status } = mustPublish(root);
    expect(status.register.kind).toBe("read");
    if (status.register.kind !== "read") return;
    expect(status.register.total).toBe(2);
    /* THE ARMS ARE THE PRODUCER'S. A session only ever SEEN is a floor — the
       daemon found it already working; one that CHANGED in front of it is a
       reading. Rendering the first as a duration is the `13m` bug. */
    expect(status.register.sessions.map((s) => [s.name, s.status, s.since.kind])).toEqual([
      ["overseer-o1-store", "working", "lower-bound"],
      ["fleet-dashboard", "needs-you", "observed"],
    ]);
    expect(status.register.sessions[1]?.since.at).toBe("2026-09-08T12:30:00.000Z");
  });

  it("says NEVER rather than nothing when the Overseer has accepted no snapshot", () => {
    /* THE DEAF CASE IN ITS PUREST FORM. A daemon that is up, ticking and has
       never heard the dashboard: `null` is a reading and the card draws it as
       an alarm, which is why the reader may not fold it in with "absent". */
    const root = tempRoot();
    realCheckpoint(root, null);
    expect(mustPublish(root).status.lastGoodSnapshotAt).toBeNull();
  });

  it("hands back the inbox and the status together, agreeing about the clock", () => {
    /* **THE WEAKER HALF OF THE ONE-READ PROPERTY, AND IT SAYS SO.** Nothing is
       writing the file during this test, so an implementation that read it twice
       would pass here identically — GPT Sol's P2, and he is right. What this
       proves is that both feeds come back from one call and agree; that the call
       happens ONCE PER PAYLOAD is counted in tests/fleet-overseer-panel.test.tsx,
       against `statePayload`, which is where it can actually go wrong. */
    const root = tempRoot();
    realCheckpoint(root, "2026-09-08T12:41:00.000Z");
    const feeds = readCheckpointFeeds(root);
    expect(feeds.overseer.kind).toBe("published");
    expect(feeds.attention.kind).toBe("published");
    if (feeds.attention.kind === "published" && feeds.overseer.kind === "published") {
      expect(feeds.attention.coordinatorWrittenAt).toBe(feeds.overseer.status.writtenAt);
    }
  });
});

describe("the four ways there is no reading", () => {
  it("is ABSENT when nothing has been published at the path we looked at", () => {
    /* Not "the Overseer is not running", which the evidence does not support. */
    const feeds = readCheckpointFeeds(tempRoot());
    expect(feeds.overseer).toEqual({ kind: "checkpoint-absent" });
    expect(feeds.work).toEqual({ kind: "checkpoint-absent" });
  });

  it("is UNREADABLE, not absent, for a torn write", () => {
    const root = tempRoot();
    writeFileSync(join(root, "current.json"), '{"schema":2,"writtenAt":"2026-09-08T12:4', "utf8");
    const feeds = readCheckpointFeeds(root);
    const feed = feeds.overseer;
    expect(feed.kind).toBe("checkpoint-unreadable");
    if (feed.kind === "checkpoint-unreadable") expect(feed.why).toContain("not JSON");
    expect(feeds.work.kind).toBe("checkpoint-unreadable");
    if (feeds.work.kind === "checkpoint-unreadable") expect(feeds.work.why).toContain("not JSON");
  });

  it("is UNREADABLE for an empty file, which is what an interrupted write leaves", () => {
    const root = tempRoot();
    writeFileSync(join(root, "current.json"), "", "utf8");
    expect(readCheckpointFeeds(root).overseer.kind).toBe("checkpoint-unreadable");
  });

  it("REFUSES schema 1 by name — the version that was live on the box", () => {
    /* Measured 2026-09-08: `~/.overseer/current.json` said schema 1 while the
       checked-in store said 2. Coercing it would `Date.parse` a bare timestamp
       where this build expects a pair and draw confident nonsense. */
    const root = tempRoot();
    writeCheckpoint(root, { schema: 1 });
    expect(readCheckpointFeeds(root).overseer).toEqual({ kind: "unsupported-schema", saw: "1", known: 2 });
  });

  it("REFUSES a schema from the future the same way, rather than reading what it recognises", () => {
    const root = tempRoot();
    writeCheckpoint(root, { schema: 3 });
    expect(readCheckpointFeeds(root).overseer).toEqual({ kind: "unsupported-schema", saw: "3", known: 2 });
  });

  it("names a missing schema rather than printing `undefined`", () => {
    const root = tempRoot();
    const { schema: _dropped, ...noSchema } = checkpointObject();
    writeFileSync(join(root, "current.json"), JSON.stringify(noSchema), "utf8");
    const feed = readCheckpointFeeds(root).overseer;
    expect(feed).toEqual({ kind: "unsupported-schema", saw: "no schema at all", known: 2 });
  });

  it("refuses the whole reading when either clock is unreadable, and leaves the inbox alone", () => {
    /* THE TWO CLOCKS ARE THE CARD. A reading missing one is not a degraded
       card, it is no card — and the inbox beside it is unaffected, because the
       two projections share a read and nothing else. */
    const root = tempRoot();
    writeCheckpoint(root, { writtenAt: "yesterday" });
    expect(readCheckpointFeeds(root).overseer.kind).toBe("checkpoint-unreadable");

    const other = tempRoot();
    writeCheckpoint(other, { lastGoodSnapshotAt: 1_757_000_000_000 });
    const feed = readCheckpointFeeds(other).overseer;
    expect(feed.kind).toBe("checkpoint-unreadable");
    if (feed.kind === "checkpoint-unreadable") expect(feed.why).toContain("lastGoodSnapshotAt");
  });

  it("refuses a source clock from the future of its own checkpoint", () => {
    /* Both come off ONE clock in one process, so there is no skew to tolerate —
       and a future timestamp reads as "0s ago" for as long as the fault lasts,
       which suppresses the stale-source warning this card exists to raise. */
    const root = tempRoot();
    writeCheckpoint(root, { lastGoodSnapshotAt: "2026-09-08T13:00:00.000Z" });
    expect(readCheckpointFeeds(root).overseer.kind).toBe("checkpoint-unreadable");
  });
});

describe("the parts that degrade on their own", () => {
  it("keeps the two clocks when the heartbeat is unreadable", () => {
    const root = tempRoot();
    writeCheckpoint(root, { heartbeat: { pid: "many", instanceId: "", ticks: -1 } });
    const { status } = mustPublish(root);
    expect(status.writtenAt).toBe(WRITTEN_AT);
    expect(status.heartbeat.kind).toBe("unreadable");
    /* NOT "there is no daemon": the field is there and we cannot read it. */
    if (status.heartbeat.kind === "unreadable") expect(status.heartbeat.why).toContain("pid");
  });

  it("tells a daemon that has not ticked yet from one whose tick is nonsense", () => {
    const root = tempRoot();
    writeCheckpoint(root, { heartbeat: { ...(checkpointObject()["heartbeat"] as object), lastTickAt: null } });
    const fresh = mustPublish(root).status.heartbeat;
    expect(fresh.kind).toBe("reading");
    if (fresh.kind === "reading") expect(fresh.lastTickAt).toBeNull();

    const other = tempRoot();
    writeCheckpoint(other, { heartbeat: { ...(checkpointObject()["heartbeat"] as object), lastTickAt: "soon" } });
    expect(mustPublish(other).status.heartbeat.kind).toBe("unreadable");
  });

  it("refuses a heartbeat that ticked after the checkpoint it wrote", () => {
    const root = tempRoot();
    writeCheckpoint(root, {
      heartbeat: { ...(checkpointObject()["heartbeat"] as object), lastTickAt: "2026-09-08T13:00:00.000Z" },
    });
    expect(mustPublish(root).status.heartbeat.kind).toBe("unreadable");
  });

  it("reads a STOPPED heartbeat as a reading, because that is what it is", () => {
    /* A daemon that died an hour ago leaves its last tick in the file. The
       reader hands the timestamp over and the page ages it; refusing it here
       would turn the loudest fact on the card into a shrug. */
    const root = tempRoot();
    writeCheckpoint(root, {
      writtenAt: "2026-09-08T11:00:00.000Z",
      lastGoodSnapshotAt: "2026-09-08T10:59:00.000Z",
      heartbeat: { ...(checkpointObject()["heartbeat"] as object), startedAt: "2026-09-08T09:00:00.000Z", lastTickAt: "2026-09-08T11:00:00.000Z" },
    });
    const heartbeat = mustPublish(root).status.heartbeat;
    expect(heartbeat.kind).toBe("reading");
    if (heartbeat.kind === "reading") expect(heartbeat.lastTickAt).toBe("2026-09-08T11:00:00.000Z");
  });

  it("reads an UNKNOWN scheduler kind as one unreadable LINE, not a broken card", () => {
    /* 260908g's Stage 3c may widen the discriminant. A `paused` scheduler must
       not render as `off` — which would say disarmed about a running one — and
       must not take the two clocks down with it. Asked for by that stage. */
    const root = tempRoot();
    writeCheckpoint(root, { scheduler: { kind: "paused", why: "the box was over its load ceiling", at: WRITTEN_AT } });
    const { status } = mustPublish(root);
    expect(status.scheduler.kind).toBe("unreadable");
    if (status.scheduler.kind === "unreadable") expect(status.scheduler.why).toContain("paused");
    expect(status.writtenAt).toBe(WRITTEN_AT);
    expect(status.heartbeat.kind).toBe("reading");
    expect(status.register.kind).toBe("read");
  });

  it("says NOBODY HAS SAID for the store's own `unknown`, which is not `off`", () => {
    const root = tempRoot();
    writeCheckpoint(root, {
      scheduler: { kind: "unknown", why: "no daemon in this build has said", at: WRITTEN_AT },
    });
    expect(mustPublish(root).status.scheduler.kind).toBe("not-said");
  });

  it("says BLOCKED for a scheduler that is switched on with nothing runnable", () => {
    /* GPT Sol's S8-7. Until 2026-09-09 the daemon wrote `armed` for this — the
       word came from an environment variable rather than from the definitions —
       so the page reported a healthy scheduler about a box on which not one job
       could run. It must reach the page as its own state, and NOT be folded into
       either `armed` or `off`. */
    const root = tempRoot();
    writeCheckpoint(root, {
      scheduler: { kind: "blocked", why: "the scheduler is switched on and NOT ONE loaded job can run", at: WRITTEN_AT },
    });
    const scheduler = mustPublish(root).status.scheduler;
    expect(scheduler.kind).toBe("blocked");
    if (scheduler.kind === "blocked") expect(scheduler.why).toContain("NOT ONE loaded job can run");
  });

  it("cannot tell about a scheduler line that is simply absent", () => {
    const root = tempRoot();
    const { scheduler: _dropped, ...without } = checkpointObject();
    writeFileSync(join(root, "current.json"), JSON.stringify(without), "utf8");
    expect(mustPublish(root).status.scheduler.kind).toBe("unreadable");
  });

  it("joins a scan only to the register entry carrying the same session key", () => {
    const root = tempRoot();
    writeCheckpoint(root, {
      register: [
        { key: "a", tmuxId: "$1", name: "review", lastStatusKey: "idle", statusSince: { kind: "observed", at: "2026-09-08T09:00:00.000Z" } },
        { key: "b", tmuxId: "$2", name: "working", lastStatusKey: "working", statusSince: { kind: "observed", at: "2026-09-08T12:00:00.000Z" } },
      ],
      work: workScan([{ key: "a", work: recognisedWork() }]),
    });

    const register = mustPublish(root).status.register;
    expect(register.kind).toBe("read");
    if (register.kind !== "read") return;
    expect(register.work).toEqual({ kind: "scanned", scannedAt: "2026-09-08T12:41:01.000Z" });
    expect(register.sessions.map((session) => [session.name, session.work])).toEqual([
      ["review", recognisedWork()],
      ["working", null],
    ]);
  });

  it("publishes the accepted scan as grouped work", () => {
    const root = tempRoot();
    writeCheckpoint(root, {
      work: workScan([{ key: "$215 none", work: recognisedWork() }]),
    });

    const feed = readCheckpointFeeds(root).work;
    expect(feed.kind).toBe("published");
    if (feed.kind !== "published") return;
    expect(feed.work).toEqual({
      kind: "scan",
      scannedAt: "2026-09-08T12:41:01.000Z",
      groups: [{
        session: "$215 none",
        recogniser: "codex-review",
        jobs: 1,
        oldestStartedAt: "2026-09-08T12:23:00.000Z",
        longestRanForMs: 18 * 60_000,
      }],
      groupsDropped: 0,
      panes: { work: 1, none: 0, cannotTell: 0 },
    });
  });

  it("refuses a scan for a different inventory while leaving the register readable", () => {
    const root = tempRoot();
    writeCheckpoint(root, {
      work: workScan([{ key: "$215 none", work: recognisedWork() }], {
        sourceCollectedAt: "2026-09-08T12:40:00.000Z",
      }),
    });

    const register = mustPublish(root).status.register;
    expect(register.kind).toBe("read");
    if (register.kind !== "read") return;
    expect(register.sessions.map((session) => session.name)).toEqual(["worktree-schema-move"]);
    expect(register.sessions[0]?.work).toBeNull();
    expect(register.work.kind).toBe("unavailable");
    if (register.work.kind === "unavailable") {
      expect(register.work.why).toContain("2026-09-08T12:40:00.000Z");
      expect(register.work.why).toContain("2026-09-08T12:41:00.000Z");
    }
  });

  it("gives work history the register's exact refusal for a scan from another inventory", () => {
    const root = tempRoot();
    writeCheckpoint(root, {
      work: workScan([{ key: "$215 none", work: recognisedWork() }], {
        sourceCollectedAt: "2026-09-08T12:40:00.000Z",
      }),
    });

    const feeds = readCheckpointFeeds(root);
    expect(feeds.overseer.kind).toBe("published");
    expect(feeds.work.kind).toBe("published");
    if (feeds.overseer.kind !== "published" || feeds.work.kind !== "published") return;
    const register = feeds.overseer.status.register;
    expect(register.kind).toBe("read");
    if (register.kind !== "read" || register.work.kind !== "unavailable") return;
    expect(feeds.work.work).toEqual({ kind: "unavailable", why: register.work.why });
  });

  it("refuses a scan taken before the inventory it claims to describe", () => {
    const root = tempRoot();
    writeCheckpoint(root, {
      work: workScan([{ key: "$215 none", work: recognisedWork() }], {
        scannedAt: "2026-09-08T12:40:59.000Z",
      }),
    });

    const register = mustPublish(root).status.register;
    expect(register.kind).toBe("read");
    if (register.kind !== "read") return;
    expect(register.work.kind).toBe("unavailable");
    expect(register.sessions[0]?.work).toBeNull();
  });

  it("does not attach a failed probe to a different accepted inventory", () => {
    const root = tempRoot();
    writeCheckpoint(root, {
      work: {
        kind: "probe-failed",
        why: "ps was denied",
        attemptedAt: "2026-09-08T12:40:01.000Z",
        sourceCollectedAt: "2026-09-08T12:40:00.000Z",
      },
    });

    const register = mustPublish(root).status.register;
    expect(register.kind).toBe("read");
    if (register.kind !== "read" || register.work.kind !== "unavailable") return;
    expect(register.work.why).toContain("2026-09-08T12:40:00.000Z");
    expect(register.work.why).toContain("2026-09-08T12:41:00.000Z");
    expect(register.work.why).not.toBe("ps was denied");
  });

  it("carries the daemon's own reason for work that has not run and for a failed probe", () => {
    const notRun = tempRoot();
    writeCheckpoint(notRun, {
      work: { kind: "not-yet-run", why: "the work pass has not run yet", at: WRITTEN_AT },
    });
    const notRunRegister = mustPublish(notRun).status.register;
    expect(notRunRegister.kind).toBe("read");
    if (notRunRegister.kind === "read") {
      expect(notRunRegister.work).toEqual({ kind: "unavailable", why: "the work pass has not run yet" });
    }

    const failed = tempRoot();
    writeCheckpoint(failed, {
      work: {
        kind: "probe-failed",
        why: "ps was denied",
        attemptedAt: "2026-09-08T12:41:01.000Z",
        sourceCollectedAt: "2026-09-08T12:41:00.000Z",
      },
    });
    const failedRegister = mustPublish(failed).status.register;
    expect(failedRegister.kind).toBe("read");
    if (failedRegister.kind === "read") {
      expect(failedRegister.work).toEqual({ kind: "unavailable", why: "ps was denied" });
    }
  });

  it("publishes a failed work probe as unavailable with the daemon's own reason", () => {
    const root = tempRoot();
    writeCheckpoint(root, {
      work: {
        kind: "probe-failed",
        why: "ps was denied by the kernel",
        attemptedAt: "2026-09-08T12:41:01.000Z",
        sourceCollectedAt: "2026-09-08T12:41:00.000Z",
      },
    });

    expect(readCheckpointFeeds(root).work).toEqual({
      kind: "published",
      work: { kind: "unavailable", why: "ps was denied by the kernel" },
      coordinatorWrittenAt: WRITTEN_AT,
    });
  });

  it("treats an absent work field as an old producer, without failing the register", () => {
    const root = tempRoot();
    const { work: _dropped, ...withoutWork } = checkpointObject();
    writeFileSync(join(root, "current.json"), JSON.stringify(withoutWork), "utf8");

    const register = mustPublish(root).status.register;
    expect(register.kind).toBe("read");
    if (register.kind === "read") {
      expect(register.work.kind).toBe("unavailable");
      if (register.work.kind === "unavailable") expect(register.work.why).toContain("before the Overseer recorded work scans");
    }
  });

  it("publishes an old checkpoint with no work key as unavailable rather than an empty scan", () => {
    const root = tempRoot();
    const { work: _dropped, ...withoutWork } = checkpointObject();
    writeFileSync(join(root, "current.json"), JSON.stringify(withoutWork), "utf8");

    const feed = readCheckpointFeeds(root).work;
    expect(feed.kind).toBe("published");
    if (feed.kind !== "published") return;
    expect(feed.work.kind).toBe("unavailable");
    if (feed.work.kind === "unavailable") {
      expect(feed.work.why).toContain("before the Overseer recorded work scans");
    }
  });

  it("degrades malformed work rather than the register", () => {
    const root = tempRoot();
    writeCheckpoint(root, {
      work: workScan([{ key: "$215 none", work: recognisedWork({ inspected: "twelve" }) }]),
    });

    const { status } = mustPublish(root);
    expect(status.register.kind).toBe("read");
    expect(status.heartbeat.kind).toBe("reading");
    if (status.register.kind === "read") {
      expect(status.register.sessions.map((session) => session.name)).toEqual(["worktree-schema-move"]);
      expect(status.register.sessions[0]?.work).toBeNull();
      expect(status.register.work.kind).toBe("unavailable");
      if (status.register.work.kind === "unavailable") expect(status.register.work.why).toContain("could not be read");
    }
  });

  it("degrades a measured pane start after the scan rather than reporting an impossible absence", () => {
    const root = tempRoot();
    writeCheckpoint(root, {
      work: workScan([
        {
          key: "$215 none",
          work: {
            kind: "none",
            inspected: 1,
            paneCommand: "claude",
            paneStartedAt: "2026-09-08T12:42:00.000Z",
          },
        },
      ]),
    });

    const register = mustPublish(root).status.register;
    expect(register.kind).toBe("read");
    if (register.kind === "read") {
      expect(register.work.kind).toBe("unavailable");
      expect(register.sessions.map((session) => session.name)).toEqual(["worktree-schema-move"]);
      expect(register.sessions[0]?.work).toBeNull();
    }
  });

  it("degrades a duration that disagrees with the job and scan clocks", () => {
    const root = tempRoot();
    writeCheckpoint(root, {
      work: workScan([
        {
          key: "$215 none",
          work: recognisedWork({
            jobs: [
              {
                recogniser: "codex-review",
                label: "GPT review",
                startedAt: "2026-09-08T12:23:01.000Z",
                ranForMs: 99 * 60_000,
                pid: 8123,
                depth: 8,
                command: "codex exec",
              },
            ],
          }),
        },
      ]),
    });

    const register = mustPublish(root).status.register;
    expect(register.kind).toBe("read");
    if (register.kind !== "read") return;
    expect(register.work.kind).toBe("unavailable");
    expect(register.sessions[0]?.work).toBeNull();
  });

  it("keeps valid bare panes, unknown job starts and scan-time job starts", () => {
    const cases: unknown[] = [
      { kind: "none", inspected: 0, paneCommand: "claude", paneStartedAt: "2026-09-08T12:41:01.000Z" },
      recognisedWork({
        jobs: [
          {
            recogniser: "codex-review",
            label: "GPT review",
            startedAt: null,
            ranForMs: null,
            pid: 8123,
            depth: 8,
            command: "codex exec",
          },
        ],
      }),
      recognisedWork({
        jobs: [
          {
            recogniser: "codex-review",
            label: "GPT review",
            startedAt: "2026-09-08T12:41:01.000Z",
            ranForMs: 0,
            pid: 8123,
            depth: 1,
            command: "codex exec",
          },
        ],
      }),
    ];

    for (const paneWork of cases) {
      const root = tempRoot();
      writeCheckpoint(root, { work: workScan([{ key: "$215 none", work: paneWork }]) });
      const register = mustPublish(root).status.register;
      expect(register.kind).toBe("read");
      if (register.kind === "read") expect(register.work.kind).toBe("scanned");
    }
  });

  it("degrades a job start after the scan and a depth-zero child reading", () => {
    const cases = [
      {
        startedAt: "2026-09-08T12:41:02.000Z",
        ranForMs: 0,
        depth: 1,
      },
      {
        startedAt: "2026-09-08T12:23:01.000Z",
        ranForMs: 18 * 60_000,
        depth: 0,
      },
    ];

    for (const job of cases) {
      const root = tempRoot();
      writeCheckpoint(root, {
        work: workScan([
          {
            key: "$215 none",
            work: recognisedWork({
              jobs: [
                {
                  recogniser: "codex-review",
                  label: "GPT review",
                  pid: 8123,
                  command: "codex exec",
                  ...job,
                },
              ],
            }),
          },
        ]),
      });
      const register = mustPublish(root).status.register;
      expect(register.kind).toBe("read");
      if (register.kind === "read") expect(register.work.kind).toBe("unavailable");
    }
  });

  it("degrades positive evidence that could not have come from the pane walk", () => {
    const cases = [
      recognisedWork({
        paneStartedAt: "2026-09-08T12:30:00.000Z",
        jobs: [
          {
            recogniser: "codex-review",
            label: "GPT review",
            startedAt: "2026-09-08T12:23:01.000Z",
            ranForMs: 18 * 60_000,
            pid: 8123,
            depth: 8,
            command: "codex exec",
          },
        ],
      }),
      recognisedWork({
        inspected: 0,
        jobs: [
          {
            recogniser: "codex-review",
            label: "GPT review",
            startedAt: "2026-09-08T12:23:01.000Z",
            ranForMs: 18 * 60_000,
            pid: 8123,
            depth: 1,
            command: "codex exec",
          },
        ],
      }),
      recognisedWork({
        jobs: [
          {
            recogniser: "codex-review",
            label: "GPT review",
            startedAt: "2026-09-08T12:23:01.000Z",
            ranForMs: 18 * 60_000,
            pid: 8123,
            depth: 8,
            command: "codex exec",
          },
          {
            recogniser: "codex-review",
            label: "GPT review",
            startedAt: "2026-09-08T12:23:01.000Z",
            ranForMs: 18 * 60_000,
            pid: 8123,
            depth: 8,
            command: "codex exec",
          },
        ],
      }),
    ];

    for (const paneWork of cases) {
      const root = tempRoot();
      writeCheckpoint(root, { work: workScan([{ key: "$215 none", work: paneWork }]) });
      const register = mustPublish(root).status.register;
      expect(register.kind).toBe("read");
      if (register.kind === "read") expect(register.work.kind).toBe("unavailable");
    }
  });

  it("refuses a scan timestamp after the checkpoint that reports it", () => {
    const root = tempRoot();
    writeCheckpoint(root, {
      work: workScan([], { scannedAt: "2026-09-08T12:41:08.000Z" }),
    });

    const register = mustPublish(root).status.register;
    expect(register.kind).toBe("read");
    if (register.kind === "read") {
      expect(register.work.kind).toBe("unavailable");
      if (register.work.kind === "unavailable") {
        expect(register.work.why).toContain("2026-09-08T12:41:08.000Z");
        expect(register.work.why).toContain(WRITTEN_AT);
      }
    }
  });

  it("degrades the whole register on one unreadable entry, and keeps everything else", () => {
    /* One bad ITEM degrades the list, the way the inbox does and unlike the way
       a bad row is dropped from `rows`: *these are the oldest status records
       worth showing* is a negative claim about everything not shown. */
    const root = tempRoot();
    writeCheckpoint(root, {
      register: [
        {
          key: "$215 none",
          tmuxId: "$215",
          name: "worktree-schema-move",
          lastStatusKey: "needs-you",
          statusSince: { kind: "lower-bound", at: "2026-09-08T12:28:00.000Z" },
        },
        { key: "$216 none", tmuxId: "$216", name: "half-written" },
      ],
    });
    const { status } = mustPublish(root);
    expect(status.register.kind).toBe("unreadable");
    expect(status.writtenAt).toBe(WRITTEN_AT);
    expect(status.heartbeat.kind).toBe("reading");
  });

  it("refuses a schema-1 register entry's bare `statusSince`, even if one reached it", () => {
    /* The version bump is the first gate and this is the second: in schema 1
       `statusSince` was a timestamp rather than a pair, and reading it as a pair
       would blank every duration on the card. */
    const root = tempRoot();
    writeCheckpoint(root, {
      register: [
        { key: "$215 none", tmuxId: "$215", name: "old", lastStatusKey: "working", statusSince: "2026-09-08T12:00:00.000Z" },
      ],
    });
    expect(mustPublish(root).status.register.kind).toBe("unreadable");
  });

  it("keeps idle sessions with recognised work, drops idle sessions with none, and counts the whole register", () => {
    const root = tempRoot();
    writeCheckpoint(root, {
      register: [
        { key: "a", tmuxId: "$1", name: "review", lastStatusKey: "idle", statusSince: { kind: "observed", at: "2026-09-08T09:00:00.000Z" } },
        { key: "b", tmuxId: "$2", name: "quiet", lastStatusKey: "idle", statusSince: { kind: "observed", at: "2026-09-08T10:00:00.000Z" } },
        { key: "c", tmuxId: "$3", name: "busy", lastStatusKey: "working", statusSince: { kind: "observed", at: "2026-09-08T12:00:00.000Z" } },
      ],
      work: workScan([
        { key: "a", work: recognisedWork() },
        { key: "b", work: { kind: "none", inspected: 1, paneCommand: "claude", paneStartedAt: "2026-09-08T09:00:00.000Z" } },
      ]),
    });
    const register = mustPublish(root).status.register;
    expect(register.kind).toBe("read");
    if (register.kind !== "read") return;
    expect(register.total).toBe(3);
    expect(register.sessions.map((s) => s.name)).toEqual(["review", "busy"]);
  });

  it("keeps an idle cannot-tell and a missing pane reading distinct from measured quiet", () => {
    const root = tempRoot();
    writeCheckpoint(root, {
      register: [
        { key: "a", tmuxId: "$1", name: "unreadable", lastStatusKey: "idle", statusSince: { kind: "observed", at: "2026-09-08T09:00:00.000Z" } },
        { key: "b", tmuxId: "$2", name: "quiet", lastStatusKey: "idle", statusSince: { kind: "observed", at: "2026-09-08T10:00:00.000Z" } },
        { key: "c", tmuxId: "$3", name: "missing", lastStatusKey: "idle", statusSince: { kind: "observed", at: "2026-09-08T11:00:00.000Z" } },
      ],
      work: workScan([
        { key: "a", work: { kind: "cannot-tell", cause: "pane-not-in-table", why: "the pane process was absent" } },
        { key: "b", work: { kind: "none", inspected: 0, paneCommand: "claude", paneStartedAt: "2026-09-08T09:00:00.000Z" } },
      ]),
    });

    const register = mustPublish(root).status.register;
    expect(register.kind).toBe("read");
    if (register.kind !== "read") return;
    expect(register.sessions.map((session) => [session.name, session.work?.kind ?? "missing"])).toEqual([
      ["unreadable", "cannot-tell"],
      ["missing", "missing"],
    ]);
  });

  it("refuses duplicate register keys before one pane measurement can be attributed twice", () => {
    const root = tempRoot();
    writeCheckpoint(root, {
      register: [
        { key: "same", tmuxId: "$1", name: "first", lastStatusKey: "working", statusSince: { kind: "observed", at: "2026-09-08T09:00:00.000Z" } },
        { key: "same", tmuxId: "$2", name: "second", lastStatusKey: "working", statusSince: { kind: "observed", at: "2026-09-08T10:00:00.000Z" } },
      ],
      work: workScan([{ key: "same", work: recognisedWork() }]),
    });

    expect(mustPublish(root).status.register.kind).toBe("unreadable");
  });

  it("caps the rows and keeps the oldest status records, so the card is not a second session list", () => {
    const root = tempRoot();
    writeCheckpoint(root, {
      register: Array.from({ length: 12 }, (_, i) => ({
        key: `k${i}`,
        tmuxId: `$${i}`,
        name: `session-${i}`,
        lastStatusKey: "working",
        /* Later index, later timestamp — so the OLDEST are `session-0…7`. */
        statusSince: { kind: "observed", at: new Date(Date.parse("2026-09-08T10:00:00.000Z") + i * 60_000).toISOString() },
      })),
    });
    const register = mustPublish(root).status.register;
    if (register.kind !== "read") throw new Error("expected a readable register");
    expect(register.total).toBe(12);
    expect(register.sessions).toHaveLength(8);
    expect(register.sessions[0]?.name).toBe("session-0");
    expect(register.sessions[7]?.name).toBe("session-7");
  });

  it("is a readable, empty register when the Overseer is holding nothing", () => {
    /* A GENUINELY EMPTY FLEET IS A READING. It must not be able to render the
       same way an unreadable register does — one says nothing is running, the
       other says we cannot tell. */
    const root = tempRoot();
    writeCheckpoint(root, { register: [] });
    expect(mustPublish(root).status.register).toMatchObject({ kind: "read", total: 0, sessions: [] });
  });
});

describe("the guarantees the refresh loop depends on", () => {
  it("refuses a source deadline outside the range a daemon could mean, and falls back only when none was given", () => {
    /* AN UNBOUNDED DEADLINE MAKES A DEAD SOURCE HEALTHY FOR EVER. `1e300` with a
       source from 2020 renders as *supervision is running*, and the daemon's own
       cap is not this reader's to assume. Out of range is *it did not say*, and
       the page then falls back to a deadline it names. GPT Sol's P1, 2026-09-08. */
    const root = tempRoot();
    /* **PRESENT AND WRONG FAILS THE READING**, rather than quietly becoming
       *the daemon did not say*: those two collapsed into one for a review round,
       and the blur let a four-minute-old source with a deadline of one hour and
       a millisecond read as *supervision is running*. GPT Sol, round two. */
    /* `NaN` is deliberately not in this list: `JSON.stringify` writes it as
       `null`, so a FILE cannot contain one, and asserting on it would be
       asserting about a value the boundary can never see. */
    for (const absurd of [1e300, 60 * 60_000 + 1, 0, -1, "300000"]) {
      writeCheckpoint(root, { snapshotStaleAfterMs: absurd });
      const feed = readCheckpointFeeds(root).overseer;
      expect(feed.kind, String(absurd)).toBe("checkpoint-unreadable");
    }
    /* ABSENT, on the other hand, is an older daemon that never published one —
       the page falls back to its own deadline and names it on screen. */
    const { snapshotStaleAfterMs: _dropped, ...without } = checkpointObject();
    writeFileSync(join(root, "current.json"), JSON.stringify(without), "utf8");
    expect(mustPublish(root).status.sourceStaleAfterMs).toBeNull();
    writeCheckpoint(root, { snapshotStaleAfterMs: null });
    expect(mustPublish(root).status.sourceStaleAfterMs).toBeNull();
    /* The daemon's real value, at the documented normal, still crosses. */
    writeCheckpoint(root, { snapshotStaleAfterMs: 300_000 });
    expect(mustPublish(root).status.sourceStaleAfterMs).toBe(300_000);
    /* And the ceiling itself is inclusive on the hour. */
    writeCheckpoint(root, { snapshotStaleAfterMs: 60 * 60_000 });
    expect(mustPublish(root).status.sourceStaleAfterMs).toBe(60 * 60_000);
  });

  it("cannot throw for anything a file can contain, whatever is in it or the environment", () => {
    /* `publish()` in refresh.ts sits OUTSIDE the try/catch that guards
       collection, so a throw here ends the refresh loop and leaves the page
       wearing its last good timestamp. Every input, one assertion. */
    const root = tempRoot();
    for (const body of ["", "null", "[]", '"a string"', "{}", '{"schema":2}', '{"schema":2,"writtenAt":null}']) {
      writeFileSync(join(root, "current.json"), body, "utf8");
      expect(() => readCheckpointFeeds(root)).not.toThrow();
      expect(readCheckpointFeeds(root).overseer.kind).not.toBe("published");
    }
    /* **AND THE PROJECTION ITSELF, HANDED THINGS NO FILE COULD CONTAIN.** The
       last two are the ones that matter: `JSON.stringify` throws on a cyclic
       object and on a `bigint`, and this function's signature says `unknown`.
       Nothing that survives `JSON.parse` can be either, so production cannot
       reach it — but the contract says *never throws* and a caller who has not
       read this file is entitled to that. GPT Sol's P2, 2026-09-08. */
    const cyclic: Record<string, unknown> = { writtenAt: WRITTEN_AT };
    cyclic["schema"] = cyclic;
    for (const value of [undefined, null, 0, "", [], { schema: 2 }, cyclic, { schema: 10n }]) {
      expect(() => projectOverseerStatus(value)).not.toThrow();
      expect(projectOverseerStatus(value).kind).not.toBe("published");
    }
  });

  it("refuses a relative store directory rather than resolving it against a cwd nobody controls", () => {
    const saved = process.env["OVERSEER_STORE_DIR"];
    process.env["OVERSEER_STORE_DIR"] = "relative/overseer";
    try {
      const feed = readCheckpointFeeds().overseer;
      expect(feed.kind).toBe("checkpoint-unreadable");
      if (feed.kind === "checkpoint-unreadable") expect(feed.why).toContain("absolute");
    } finally {
      if (saved === undefined) delete process.env["OVERSEER_STORE_DIR"];
      else process.env["OVERSEER_STORE_DIR"] = saved;
    }
  });
});
