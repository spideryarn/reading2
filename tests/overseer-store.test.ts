/**
 * The Overseer's store: a torn log, a second daemon, and a checkpoint that was
 * half written.
 *
 * **Every test here is about a failure that does not announce itself.** A torn
 * final line is not a crash — the next append lands against it and the log goes
 * on looking like a log. A second daemon is not an error — both write, and the
 * history reads perfectly while describing a fleet that never existed. A half
 * written `current.json` is not an exception — `JSON.parse` either throws once,
 * loudly, or (worse) succeeds on a truncation that happens to close its braces
 * and hands back a register missing a session. So the assertions are on the
 * BYTES ON DISK and on what a second reader gets back, not on the return value
 * of the call that was supposed to do the work.
 *
 * The temp directory is per test and the real `~/.overseer` is never touched:
 * every `openStore` here is given an explicit `root`.
 */
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { identityOf, sessionKey, statusKey, type OverseerEvent } from "../tools/overseer/diff.js";
import type { ObservedRow } from "../tools/overseer/observation.js";
import {
  CHECKPOINT_FILE,
  EVENTS_FILE,
  LOCK_FILE,
  describeOpening,
  describeRefusal,
  foldEvents,
  isProcessAlive,
  openStore,
  readCheckpoint,
  storeRoot,
  type OverseerStore,
} from "../tools/overseer/store.js";

const opened: OverseerStore[] = [];
const roots: string[] = [];

afterEach(() => {
  for (const store of opened.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A directory that exists. Its sibling below is the cold-start case. */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-store-test-"));
  roots.push(root);
  return root;
}

/** A path inside a temp directory that does NOT exist yet — the cold start. */
function unmadeRoot(): string {
  return join(tempRoot(), "never-created", "overseer");
}

function mustOpen(root: string, now?: () => Date): OverseerStore {
  const result = openStore({ root, ...(now === undefined ? {} : { now }) });
  if (!result.ok) throw new Error(`expected to open the store, got: ${describeRefusal(result.refusal)}`);
  opened.push(result.store);
  return result.store;
}

function observedRow(over: Partial<ObservedRow> = {}): ObservedRow {
  return {
    id: "$1991",
    name: "overseer-o1-store",
    title: null,
    repo: "spideryarn/reading2",
    worktree: "overseer-o1-store",
    meta: { version: 1, kind: "claude", repo: "spideryarn/reading2", dir: "/home/greg/code/spideryarn2" },
    startedAt: "2026-09-08T09:00:00.000Z",
    paneId: "%12",
    panePid: 4242,
    claimedConversationId: "11111111-1111-4111-8111-111111111111",
    question: null,
    status: { kind: "working" },
    ...over,
  };
}

const GENERATION = 132280;

function seenEvent(row: ObservedRow, at: string): OverseerEvent {
  return {
    kind: "session-seen",
    at,
    tmuxServerPid: GENERATION,
    key: sessionKey(identityOf(row)),
    identity: identityOf(row),
    row,
  };
}

function statusEvent(row: ObservedRow, at: string, status: ObservedRow["status"]): OverseerEvent {
  return {
    kind: "session-status",
    at,
    tmuxServerPid: GENERATION,
    key: sessionKey(identityOf(row)),
    identity: identityOf(row),
    // The real key function rather than a literal: the register stores what a
    // change MEANS, and a hand-typed key here would let the two drift apart.
    from: statusKey(row.status),
    to: statusKey(status),
    status,
  };
}

function goneEvent(row: ObservedRow, at: string): OverseerEvent {
  return {
    kind: "tmux-session-gone",
    at,
    tmuxServerPid: GENERATION,
    key: sessionKey(identityOf(row)),
    identity: identityOf(row),
    name: row.name,
    why: "absent-from-snapshot",
  };
}

function replacedEvent(was: ObservedRow, now: ObservedRow, at: string): OverseerEvent {
  return {
    kind: "session-replaced",
    at,
    tmuxServerPid: GENERATION,
    key: sessionKey(identityOf(now)),
    identity: identityOf(now),
    previous: identityOf(was),
    previousKey: sessionKey(identityOf(was)),
    row: now,
  };
}

/** Which sessions the register says are there, in one comparable shape. */
function keysIn(store: OverseerStore): string[] {
  return [...store.register.keys()].sort();
}

describe("where the store lives", () => {
  test("it is ~/.overseer, outside every checkout, and OVERSEER_STORE_DIR overrides it", () => {
    expect(storeRoot({})).toBe(join(homedir(), ".overseer"));
    expect(storeRoot({ OVERSEER_STORE_DIR: "/somewhere/else" })).toBe("/somewhere/else");
    // The hazard this is really about: a store inside a worktree is deleted by
    // the next agent to finish, and `git status` says it was safe to.
    expect(storeRoot({})).not.toContain("worktrees");
  });
});

describe("a cold start", () => {
  test("a missing directory starts cold, says so, and creates the store", () => {
    const root = unmadeRoot();
    expect(existsSync(root)).toBe(false);

    const store = mustOpen(root);

    expect(store.opening.start).toEqual({ kind: "cold", why: "no-store-directory" });
    expect(store.opening.repair).toEqual({ torn: false });
    expect(store.opening.eventsReplayed).toBe(0);
    expect(store.register.size).toBe(0);
    expect(describeOpening(store.opening)).toMatch(/cold/i);
    expect(existsSync(root)).toBe(true);
    expect(existsSync(join(root, LOCK_FILE))).toBe(true);
  });

  test("an empty store directory starts cold rather than refusing", () => {
    const store = mustOpen(tempRoot());
    expect(store.opening.start).toEqual({ kind: "cold", why: "no-checkpoint" });
  });

  test("a log of pure garbage still opens — losing history costs history and nothing else", () => {
    const root = tempRoot();
    writeFileSync(join(root, EVENTS_FILE), "not json\n{ also not json\n");

    const store = mustOpen(root);

    expect(store.opening.unreadableLines).toBe(2);
    expect(store.register.size).toBe(0);
    // And it can still be written to.
    expect(store.append([seenEvent(observedRow(), "2026-09-08T10:00:00.000Z")]).ok).toBe(true);
  });
});

describe("the torn-write sequence", () => {
  test("tear, restart, append, append, read", () => {
    const root = tempRoot();
    const events = join(root, EVENTS_FILE);
    const rowA = observedRow();
    const rowB = observedRow({ id: "$1992", name: "fleet-dashboard" });

    const first = mustOpen(root);
    first.append([seenEvent(rowA, "2026-09-08T10:00:00.000Z"), seenEvent(rowB, "2026-09-08T10:00:00.000Z")]);
    first.close();

    // THE TEAR. A real partial line on disk: a crash between the write and the
    // newline. `{"kind":"session-` is the plan's own example.
    const torn = '{"kind":"session-seen","at":"2026-09-08T10:01:00.0';
    appendFileSync(events, torn);
    const tornBytes = readFileSync(events).byteLength;

    const second = mustOpen(root);

    expect(second.opening.repair).toEqual({ torn: true, droppedBytes: torn.length, droppedText: torn });
    expect(readFileSync(events).byteLength).toBe(tornBytes - torn.length);

    second.append([statusEvent(rowA, "2026-09-08T10:02:00.000Z", { kind: "idle" })]);
    second.append([goneEvent(rowB, "2026-09-08T10:03:00.000Z")]);

    const read = second.readEvents();
    expect(read.unreadable).toEqual([]);
    expect(read.events.map((event) => [event.kind, event.at])).toEqual([
      ["session-seen", "2026-09-08T10:00:00.000Z"],
      ["session-seen", "2026-09-08T10:00:00.000Z"],
      ["session-status", "2026-09-08T10:02:00.000Z"],
      ["tmux-session-gone", "2026-09-08T10:03:00.000Z"],
    ]);

    // The bytes themselves, because the failure the plan names is a VALID event
    // concatenated onto corrupt bytes — which parses as one unreadable line and
    // loses the first post-restart event without anything looking wrong.
    const raw = readFileSync(events, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw.split("\n").filter((line) => line !== "")).toHaveLength(4);
    expect(raw).not.toContain("10:01:00.0");
  });

  test("a file that is one torn line and nothing else truncates to empty", () => {
    const root = tempRoot();
    const torn = '{"kind":"session-seen"';
    writeFileSync(join(root, EVENTS_FILE), torn);

    const store = mustOpen(root);

    expect(store.opening.repair).toEqual({ torn: true, droppedBytes: torn.length, droppedText: torn });
    expect(readFileSync(join(root, EVENTS_FILE), "utf8")).toBe("");
    store.append([seenEvent(observedRow(), "2026-09-08T10:00:00.000Z")]);
    expect(store.readEvents().events).toHaveLength(1);
  });

  test("a well-formed log is not touched", () => {
    const root = tempRoot();
    const store = mustOpen(root);
    store.append([seenEvent(observedRow(), "2026-09-08T10:00:00.000Z")]);
    const before = readFileSync(join(root, EVENTS_FILE), "utf8");
    store.close();

    const again = mustOpen(root);
    expect(again.opening.repair).toEqual({ torn: false });
    expect(readFileSync(join(root, EVENTS_FILE), "utf8")).toBe(before);
  });

  test("a line of valid JSON that is not an event is unreadable, not an event", () => {
    const root = tempRoot();
    const store = mustOpen(root);
    store.append([seenEvent(observedRow(), "2026-09-08T10:00:00.000Z")]);
    // Parses perfectly. This is the shape a `JSON.parse` and a cast would let
    // through, and it would reach the fold as an event with no kind at all.
    appendFileSync(join(root, EVENTS_FILE), '{"kind":"session-invented","at":"2026-09-08T10:00:30.000Z","key":"$1 none"}\n');
    appendFileSync(join(root, EVENTS_FILE), "42\n");

    const read = store.readEvents();

    expect(read.events).toHaveLength(1);
    expect(read.unreadable.map((line) => line.line)).toEqual([2, 3]);
  });

  test("a garbage line in the middle is reported rather than silently skipped", () => {
    const root = tempRoot();
    const store = mustOpen(root);
    store.append([seenEvent(observedRow(), "2026-09-08T10:00:00.000Z")]);
    appendFileSync(join(root, EVENTS_FILE), "{not json}\n");
    store.append([goneEvent(observedRow(), "2026-09-08T10:01:00.000Z")]);

    const read = store.readEvents();
    expect(read.events).toHaveLength(2);
    expect(read.unreadable).toEqual([{ line: 2, text: "{not json}" }]);
  });
});

describe("one daemon, enforced", () => {
  test("a second open refuses, and names who holds it", () => {
    const root = tempRoot();
    mustOpen(root);

    const second = openStore({ root });

    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.refusal.reason).toBe("already-running");
    if (second.refusal.reason !== "already-running") throw new Error("unreachable");
    expect(second.refusal.holder.pid).toBe(process.pid);
    expect(describeRefusal(second.refusal)).toMatch(/already running/i);
  });

  test("a refused second daemon writes nothing at all", () => {
    const root = tempRoot();
    const first = mustOpen(root);
    first.append([seenEvent(observedRow(), "2026-09-08T10:00:00.000Z")]);
    const before = readFileSync(join(root, EVENTS_FILE), "utf8");
    const lockBefore = readFileSync(join(root, LOCK_FILE), "utf8");

    openStore({ root });

    expect(readFileSync(join(root, EVENTS_FILE), "utf8")).toBe(before);
    expect(readFileSync(join(root, LOCK_FILE), "utf8")).toBe(lockBefore);
  });

  test("a lock left behind by a dead process is taken over", () => {
    const root = tempRoot();
    const dead = aDefinitelyDeadPid();
    writeFileSync(
      join(root, LOCK_FILE),
      `${JSON.stringify({ pid: dead, instanceId: "ghost", hostname: "box", startedAt: "2026-09-08T09:00:00.000Z" })}\n`,
    );

    const store = mustOpen(root);

    expect(store.opening.start.kind).toBe("cold");
    const holder = JSON.parse(readFileSync(join(root, LOCK_FILE), "utf8")) as { pid: number };
    expect(holder.pid).toBe(process.pid);
  });

  test("closing releases the lock so the next start is not refused", () => {
    const root = tempRoot();
    const first = mustOpen(root);
    first.close();
    expect(existsSync(join(root, LOCK_FILE))).toBe(false);
    const second = mustOpen(root);
    expect(second.opening.start.kind).toBe("cold");
  });

  test("a lock nobody can be identified from is refused rather than stolen", () => {
    const root = tempRoot();
    writeFileSync(join(root, LOCK_FILE), "");

    const result = openStore({ root });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.refusal.reason).toBe("lock-unreadable");
    expect(describeRefusal(result.refusal)).toContain(LOCK_FILE);
  });

  test("isProcessAlive tells this process from a dead one", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(aDefinitelyDeadPid())).toBe(false);
  });

  test("a write refuses once the lock has been taken from under it", () => {
    const root = tempRoot();
    const store = mustOpen(root);
    // Somebody else's lock, written over ours. The daemon must stop rather than
    // go on appending beside a second writer.
    writeFileSync(
      join(root, LOCK_FILE),
      `${JSON.stringify({ pid: process.pid, instanceId: "someone-else", hostname: "box", startedAt: "2026-09-08T09:00:00.000Z" })}\n`,
    );

    const appended = store.append([seenEvent(observedRow(), "2026-09-08T10:00:00.000Z")]);
    const written = store.checkpoint({ lastGoodSnapshotAt: null, tick: true });

    expect(appended.ok).toBe(false);
    expect(written.ok).toBe(false);
    expect(readFileSync(join(root, EVENTS_FILE), "utf8")).toBe("");
    expect(existsSync(join(root, CHECKPOINT_FILE))).toBe(false);
  });
});

describe("the checkpoint", () => {
  test("it carries both clocks, the cursor, the heartbeat and the register", () => {
    const root = tempRoot();
    const at = new Date("2026-09-08T10:05:00.000Z");
    const store = mustOpen(root, () => at);
    store.append([seenEvent(observedRow(), "2026-09-08T10:00:00.000Z")]);

    const written = store.checkpoint({ lastGoodSnapshotAt: "2026-09-08T10:04:58.000Z", tick: true });

    expect(written.ok).toBe(true);
    if (!written.ok) throw new Error("unreachable");
    expect(written.checkpoint.writtenAt).toBe("2026-09-08T10:05:00.000Z");
    expect(written.checkpoint.lastGoodSnapshotAt).toBe("2026-09-08T10:04:58.000Z");
    expect(written.checkpoint.cursor.events).toBe(1);
    expect(written.checkpoint.cursor.bytes).toBe(readFileSync(join(root, EVENTS_FILE)).byteLength);
    expect(written.checkpoint.heartbeat.pid).toBe(process.pid);
    expect(written.checkpoint.heartbeat.ticks).toBe(1);
    expect(written.checkpoint.heartbeat.lastTickAt).toBe("2026-09-08T10:05:00.000Z");
    expect(written.checkpoint.register).toHaveLength(1);

    expect(readCheckpoint(root)).toEqual({ kind: "checkpoint", checkpoint: written.checkpoint });
  });

  test("each write REPLACES the file rather than modifying it", () => {
    const root = tempRoot();
    const store = mustOpen(root);
    store.checkpoint({ lastGoodSnapshotAt: null, tick: true });
    const first = statSync(join(root, CHECKPOINT_FILE)).ino;
    store.checkpoint({ lastGoodSnapshotAt: null, tick: true });
    const second = statSync(join(root, CHECKPOINT_FILE)).ino;

    // The inode is the observable difference between temp-then-rename and
    // writing in place, and it is the whole of the atomicity claim: a rename
    // swaps one complete file for another, so a reader sees the old one or the
    // new one. Writing in place keeps the inode and passes through a state
    // where the file is half of each — which is the state that costs a
    // register.
    expect(second).not.toBe(first);
  });

  test("a checkpoint leaves no half-written file behind", () => {
    const root = tempRoot();
    const store = mustOpen(root);
    store.checkpoint({ lastGoodSnapshotAt: null, tick: true });
    store.checkpoint({ lastGoodSnapshotAt: null, tick: true });

    expect(readdirSync(root).sort()).toEqual([CHECKPOINT_FILE, EVENTS_FILE, LOCK_FILE].sort());
  });

  test("a restart resumes from it and does not replay what it already folded", () => {
    const root = tempRoot();
    const rowA = observedRow();
    const first = mustOpen(root);
    first.append([seenEvent(rowA, "2026-09-08T10:00:00.000Z")]);
    first.checkpoint({ lastGoodSnapshotAt: "2026-09-08T10:00:00.000Z", tick: true });
    first.close();

    const second = mustOpen(root);

    expect(second.opening.start).toEqual({
      kind: "resumed",
      checkpointWrittenAt: expect.any(String),
      lastGoodSnapshotAt: "2026-09-08T10:00:00.000Z",
    });
    expect(second.opening.eventsReplayed).toBe(0);
    expect(keysIn(second)).toEqual([sessionKey(identityOf(rowA))]);
  });

  test("events appended after the last checkpoint are replayed on resume", () => {
    const root = tempRoot();
    const rowA = observedRow();
    const rowB = observedRow({ id: "$1992", name: "fleet-dashboard" });
    const first = mustOpen(root);
    first.append([seenEvent(rowA, "2026-09-08T10:00:00.000Z")]);
    first.checkpoint({ lastGoodSnapshotAt: "2026-09-08T10:00:00.000Z", tick: true });
    // The crash window: appended, never checkpointed.
    first.append([seenEvent(rowB, "2026-09-08T10:01:00.000Z")]);
    first.close();

    const second = mustOpen(root);

    expect(second.opening.eventsReplayed).toBe(1);
    expect(keysIn(second)).toEqual([sessionKey(identityOf(rowA)), sessionKey(identityOf(rowB))].sort());
  });

  test("the tick count is this instance's, and starts again on restart", () => {
    const root = tempRoot();
    const first = mustOpen(root);
    first.checkpoint({ lastGoodSnapshotAt: null, tick: true });
    first.checkpoint({ lastGoodSnapshotAt: null, tick: true });
    first.close();

    const second = mustOpen(root);
    const written = second.checkpoint({ lastGoodSnapshotAt: null, tick: true });
    expect(written.ok).toBe(true);
    if (!written.ok) throw new Error("unreachable");
    expect(written.checkpoint.heartbeat.ticks).toBe(1);
  });
});

describe("a half-written current.json", () => {
  test("truncated JSON does not produce a half-valid register", () => {
    const root = tempRoot();
    const rowA = observedRow();
    const first = mustOpen(root);
    first.append([seenEvent(rowA, "2026-09-08T10:00:00.000Z")]);
    first.checkpoint({ lastGoodSnapshotAt: "2026-09-08T10:00:00.000Z", tick: true });
    first.close();

    const whole = readFileSync(join(root, CHECKPOINT_FILE), "utf8");
    writeFileSync(join(root, CHECKPOINT_FILE), whole.slice(0, Math.floor(whole.length * 0.6)));

    const second = mustOpen(root);

    expect(second.opening.start).toEqual({ kind: "rebuilt", why: "checkpoint-malformed" });
    expect(second.opening.eventsReplayed).toBe(1);
    // Rebuilt from the log — the same answer the checkpoint would have given.
    expect(keysIn(second)).toEqual([sessionKey(identityOf(rowA))]);
  });

  test("a register entry that is missing a field discards the WHOLE checkpoint", () => {
    const root = tempRoot();
    const rowA = observedRow();
    const rowB = observedRow({ id: "$1992", name: "fleet-dashboard" });
    const first = mustOpen(root);
    first.append([seenEvent(rowA, "2026-09-08T10:00:00.000Z"), seenEvent(rowB, "2026-09-08T10:00:01.000Z")]);
    first.checkpoint({ lastGoodSnapshotAt: "2026-09-08T10:00:01.000Z", tick: true });
    first.close();

    const parsed = JSON.parse(readFileSync(join(root, CHECKPOINT_FILE), "utf8")) as {
      register: Record<string, unknown>[];
    };
    // Valid JSON, one good entry and one that lost the field a reboot needs.
    const [good, bad] = parsed.register;
    if (good === undefined || bad === undefined) throw new Error("expected two register entries");
    delete bad["meta"];
    writeFileSync(join(root, CHECKPOINT_FILE), JSON.stringify(parsed));

    const second = mustOpen(root);

    expect(second.opening.start.kind).toBe("rebuilt");
    // NOT ONE. Keeping the entries that happened to parse is how a fleet of
    // thirty-six comes back as thirty-five with nothing to say so.
    expect(second.register.size).toBe(2);
  });

  test("an entry whose key does not match its own identity discards the checkpoint", () => {
    const root = tempRoot();
    const rowA = observedRow();
    const first = mustOpen(root);
    first.append([seenEvent(rowA, "2026-09-08T10:00:00.000Z")]);
    first.checkpoint({ lastGoodSnapshotAt: "2026-09-08T10:00:00.000Z", tick: true });
    first.close();

    const parsed = JSON.parse(readFileSync(join(root, CHECKPOINT_FILE), "utf8")) as {
      register: Record<string, unknown>[];
    };
    const [entry] = parsed.register;
    if (entry === undefined) throw new Error("expected one register entry");
    entry["key"] = "$9999 none";
    writeFileSync(join(root, CHECKPOINT_FILE), JSON.stringify(parsed));

    const second = mustOpen(root);

    expect(second.opening.start).toEqual({ kind: "rebuilt", why: "checkpoint-malformed" });
    expect(keysIn(second)).toEqual([sessionKey(identityOf(rowA))]);
  });

  test("a relative meta.dir discards the checkpoint — a resume would land in the wrong tree", () => {
    const root = tempRoot();
    const rowA = observedRow();
    const first = mustOpen(root);
    first.append([seenEvent(rowA, "2026-09-08T10:00:00.000Z")]);
    first.checkpoint({ lastGoodSnapshotAt: "2026-09-08T10:00:00.000Z", tick: true });
    first.close();

    const parsed = JSON.parse(readFileSync(join(root, CHECKPOINT_FILE), "utf8")) as {
      register: { meta: { dir: string } }[];
    };
    const [entry] = parsed.register;
    if (entry === undefined) throw new Error("expected one register entry");
    // Parses perfectly, and a later resumer would restart a real conversation
    // in whatever directory the daemon happened to be sitting in. GPT Sol S2-06.
    entry.meta.dir = "code/spideryarn2";
    writeFileSync(join(root, CHECKPOINT_FILE), JSON.stringify(parsed));

    const second = mustOpen(root);

    expect(second.opening.start).toEqual({ kind: "rebuilt", why: "checkpoint-malformed" });
  });

  test("a cursor past the end of the log rebuilds instead of resuming half way", () => {
    const root = tempRoot();
    const rowA = observedRow();
    const first = mustOpen(root);
    first.append([seenEvent(rowA, "2026-09-08T10:00:00.000Z")]);
    first.checkpoint({ lastGoodSnapshotAt: "2026-09-08T10:00:00.000Z", tick: true });
    first.close();

    const parsed = JSON.parse(readFileSync(join(root, CHECKPOINT_FILE), "utf8")) as {
      cursor: { bytes: number; events: number };
    };
    // A checkpoint describing a log that has since shrunk — a truncation, a
    // hand-edit, a restored backup. Resuming from it would skip the whole file.
    parsed.cursor.bytes += 100_000;
    writeFileSync(join(root, CHECKPOINT_FILE), JSON.stringify(parsed));

    const second = mustOpen(root);

    expect(second.opening.start.kind).toBe("rebuilt");
    expect(second.opening.eventsReplayed).toBe(1);
    expect(keysIn(second)).toEqual([sessionKey(identityOf(rowA))]);
  });

  test("an empty current.json starts cold rather than refusing", () => {
    const root = tempRoot();
    writeFileSync(join(root, CHECKPOINT_FILE), "");

    const store = mustOpen(root);

    expect(store.opening.start).toEqual({ kind: "cold", why: "checkpoint-empty" });
    expect(store.register.size).toBe(0);
  });

  test("a checkpoint from a schema we do not know is refused, not guessed at", () => {
    const root = tempRoot();
    writeFileSync(join(root, CHECKPOINT_FILE), JSON.stringify({ schema: 99, register: [] }));

    const store = mustOpen(root);

    expect(store.opening.start).toEqual({ kind: "cold", why: "checkpoint-malformed" });
  });

  test("readCheckpoint says which of absent, unusable and present it found", () => {
    const root = tempRoot();
    expect(readCheckpoint(root).kind).toBe("absent");
    writeFileSync(join(root, CHECKPOINT_FILE), "{oops");
    expect(readCheckpoint(root).kind).toBe("unusable");
  });
});

describe("the fold, which is what makes the checkpoint disposable", () => {
  test("seen adds, status updates, gone removes", () => {
    const rowA = observedRow();
    const rowB = observedRow({ id: "$1992", name: "fleet-dashboard" });
    const register = foldEvents(
      [
        seenEvent(rowA, "2026-09-08T10:00:00.000Z"),
        seenEvent(rowB, "2026-09-08T10:00:00.000Z"),
        statusEvent(rowA, "2026-09-08T10:01:00.000Z", { kind: "waiting", secondsLeft: 3600 }),
        goneEvent(rowB, "2026-09-08T10:02:00.000Z"),
      ],
      new Map(),
    );

    expect([...register.keys()]).toEqual([sessionKey(identityOf(rowA))]);
    const entry = register.get(sessionKey(identityOf(rowA)));
    if (entry === undefined) throw new Error("expected the surviving session");
    // The KEY, not the status object: `secondsLeft` counts down every minute
    // and a register full of it is a register nothing can compare.
    expect(entry.lastStatusKey).toBe("waiting");
    expect(entry.statusSince).toBe("2026-09-08T10:01:00.000Z");
    expect(entry.lastSeenAlive).toBe("2026-09-08T10:01:00.000Z");
    // The reboot-resume material, which is not recoverable from anywhere else.
    expect(entry.meta).toEqual(rowA.meta);
    expect(entry.name).toBe(rowA.name);
    expect(entry.tmuxId).toBe(rowA.id);
    expect(entry.claimedConversationId).toBe(rowA.claimedConversationId);
  });

  test("a restarted wait starts the clock again without changing the state", () => {
    const row = observedRow({ status: { kind: "waiting", secondsLeft: 60 } });
    const register = foldEvents(
      [
        seenEvent(row, "2026-09-08T10:00:00.000Z"),
        {
          kind: "session-wait-restarted",
          at: "2026-09-08T10:01:00.000Z",
          tmuxServerPid: GENERATION,
          key: sessionKey(identityOf(row)),
          identity: identityOf(row),
          previousDeadline: "2026-09-08T10:01:00.000Z",
          deadline: "2026-09-08T11:01:00.000Z",
          status: { kind: "waiting", secondsLeft: 3600 },
        },
      ],
      new Map(),
    );

    const entry = register.get(sessionKey(identityOf(row)));
    if (entry === undefined) throw new Error("expected the waiting session");
    expect(entry.lastStatusKey).toBe("waiting");
    // A NEW wait, so the duration a triage view reports starts again here.
    expect(entry.statusSince).toBe("2026-09-08T10:01:00.000Z");
  });

  test("a replacement retires the old identity rather than leaving two", () => {
    const was = observedRow();
    const now = observedRow({ claimedConversationId: "22222222-2222-4222-8222-222222222222" });
    const register = foldEvents(
      [seenEvent(was, "2026-09-08T10:00:00.000Z"), replacedEvent(was, now, "2026-09-08T10:01:00.000Z")],
      new Map(),
    );

    expect([...register.keys()]).toEqual([sessionKey(identityOf(now))]);
  });

  test("the register survives a round trip through the checkpoint file", () => {
    const root = tempRoot();
    const rowA = observedRow({ meta: { version: "legacy" } });
    const first = mustOpen(root);
    first.append([seenEvent(rowA, "2026-09-08T10:00:00.000Z")]);
    first.checkpoint({ lastGoodSnapshotAt: "2026-09-08T10:00:00.000Z", tick: true });
    first.close();

    const second = mustOpen(root);
    expect([...second.register.values()]).toEqual([
      ...foldEvents([seenEvent(rowA, "2026-09-08T10:00:00.000Z")], new Map()).values(),
    ]);
  });
});

describe("reading a tail", () => {
  test("a byte cursor returns only what came after it", () => {
    const root = tempRoot();
    const store = mustOpen(root);
    store.append([seenEvent(observedRow(), "2026-09-08T10:00:00.000Z")]);
    const after = store.readEvents().nextByte;
    store.append([goneEvent(observedRow(), "2026-09-08T10:01:00.000Z")]);

    const tail = store.readEvents(after);

    expect(tail.events.map((event) => event.kind)).toEqual(["tmux-session-gone"]);
  });
});

/**
 * A pid nothing is using, found rather than guessed.
 *
 * `process.kill(pid, 0)` is the real check the store makes, so the test uses
 * the real one too: a hard-coded "surely nothing is 4000000" is a test that
 * goes green for the wrong reason on the day something is.
 */
function aDefinitelyDeadPid(): number {
  for (let pid = 4194303; pid > 4190000; pid -= 7) {
    if (!isProcessAlive(pid)) return pid;
  }
  throw new Error("could not find an unused pid to test the stale-lock takeover with");
}
