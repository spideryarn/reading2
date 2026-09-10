// @vitest-environment jsdom
/**
 * **THE OVERSEER STATUS CARD**, from the bytes the server composes to the words
 * on screen.
 *
 * ## The join, and why it is drawn through the real composer
 *
 * The class of bug this area keeps producing is a producer with no consumer:
 * every part tested, the edge between them missing, nothing red
 * (docs/postmortems/260908b). So the first test here writes a checkpoint the
 * REAL STORE wrote, composes the payload through `statePayload` — the function
 * `server.ts` calls — parses it with `parseFleetState`, which is the browser's
 * own parser, and asserts on text in the DOM. Four hops, none of them faked.
 *
 * The remaining tests drive the card directly, because *what does a stopped
 * daemon look like* is a rendering question and does not need a disk.
 *
 * ## What the card is FOR, in one line
 *
 * Telling a dead daemon from a deaf one. Those two produce the same silence
 * through a single clock, and the page has to separate them:
 *
 * > **A dead dashboard is a fact the Overseer records, not a silence it sits
 * > in.** — docs/project/overseer-direction.md § Two tenses
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readCheckpointFeeds } from "../tools/fleet/overseer-status.js";
import { statePayload } from "../tools/fleet/state.js";
import type { OverseerRegisterWork, PaneJob, PaneWork } from "../tools/fleet/wire.js";
import { OverseerStatusCard } from "../tools/fleet/web/src/OverseerPanel";
import { CLOCK_SKEW_UNMEASURED, parseFleetState, parseOverseer, type OverseerView } from "../tools/fleet/web/src/types";
import { identityOf, sessionKey, statusKey, type OverseerEvent } from "../tools/overseer/diff.js";
import type { ObservedRow } from "../tools/overseer/observation.js";
import { describeRefusal, openStore, type OverseerStore } from "../tools/overseer/store.js";

/* Without this React warns on every `act()` and does not flush effects the way
   a browser would — the same line every other .tsx suite here sets. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const roots: string[] = [];
const opened: OverseerStore[] = [];

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  for (const store of opened.splice(0)) store.close();
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "fleet-overseer-panel-"));
  roots.push(dir);
  return dir;
}

/** The page's text, whitespace flattened, so an assertion reads like a sentence. */
function screen(): string {
  return (container.textContent ?? "").replace(/\s+/g, " ");
}

/**
 * The card, at a fixed `now`, with the anchor a real page passes.
 *
 * `receivedAt` is the moment the payload arrived by this browser's clock, and
 * it is the anchor every age is measured against — a tab iOS froze must not age
 * a just-arrived checkpoint against the clock it fell asleep with.
 */
function draw(overseer: OverseerView | null, now: number, receivedAt: number | null = now): void {
  act(() => root.render(<OverseerStatusCard overseer={overseer} now={now} receivedAt={receivedAt} />));
}

/* ------------------------------------------------------------------ *
 * A checkpoint the real store wrote, through the real payload composer.
 * ------------------------------------------------------------------ */

const GENERATION = 132280;

/**
 * **THE FIXTURE'S CLOCK IS NOW, AND IT HAS TO BE.**
 *
 * The first version of this test pinned the checkpoint to a wall-clock time and
 * asserted the card said *supervision is running*; it said *the Overseer has
 * stopped writing*, correctly, because the payload's `servedAt` is stamped as
 * it is composed and the fixture was eight hours older than that. Skew
 * correction moves both clocks onto this browser's; it does not and must not
 * erase a genuine age. A fixture that means "fresh" is computed from the clock
 * the composer reads, for exactly the reason `state()` in fleet-web.test.tsx is.
 */
const BASE = Date.now();
const ago = (ms: number): string => new Date(BASE - ms).toISOString();

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
    claimedConversationId: "0e5ee0a1-0f1e-4000-8000-0000000000f3",
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
    from: statusKey(row.status),
    to: statusKey(status),
    status,
  };
}

function realCheckpoint(root: string): void {
  const result = openStore({ root, now: () => new Date(BASE - 20_000) });
  if (!result.ok) throw new Error(`could not open the store: ${describeRefusal(result.refusal)}`);
  opened.push(result.store);
  const blocked = observedRow({ id: "$1992", name: "fleet-dashboard", paneId: "%13" });
  /* **ONE OF EACH ARM, PRODUCED BY THE FOLD.** This one is only ever SEEN, so
     its `statusSince` is a floor and the row must carry `≥` all the way to the
     DOM — the hop that would otherwise stay green if the browser parser quietly
     turned every floor into a reading. GPT Sol's P2, 2026-09-08. */
  const unchanged = observedRow({
    id: "$1993",
    name: "worktree-schema-move",
    paneId: "%14",
    claimedConversationId: "0e5ee0a1-0f1e-4000-8000-0000000000f4",
  });
  result.store.append([seenEvent(blocked, ago(30 * 60_000)), seenEvent(unchanged, ago(30 * 60_000))]);
  /* SEEN, THEN CHANGED — so the fold produces an `observed` arm rather than a
     floor, and this row on screen carries no `≥`. */
  result.store.append([statusEvent(blocked, ago(10 * 60_000), { kind: "needs-you" })]);
  result.store.checkpoint({
    lastGoodSnapshotAt: ago(40_000),
    tick: true,
    scheduler: { kind: "armed", why: "started with the scheduler on", at: ago(60 * 60_000) },
    snapshotStaleAfterMs: 300_000,
  });
}

describe("the join, all four hops", () => {
  it("turns a real checkpoint into two ages on screen, through `statePayload`", () => {
    const dir = tempRoot();
    realCheckpoint(dir);

    /* THE FUNCTION PRODUCTION GOES THROUGH. `statePayload()` in server.ts is one
       call to this with the same deps; the only difference is which directory
       the reader is pointed at. */
    const payload: unknown = JSON.parse(
      statePayload({
        snapshot: null,
        error: null,
        health: null,
        refreshMs: 60_000,
        answeringEnabled: true,
        attemptedAt: null,
        producer: { instance: "1a2b3c4d", publication: 0, inventory: null },
        readCheckpoint: () => readCheckpointFeeds(dir),
      }),
    );
    /* **THE BROWSER'S OWN PARSER, AND ITS CLOCK IS TWENTY MINUTES FAST.** That
       is the hop the first version of this test could not see: `receivedAt` is
       what the skew is measured against, so a phone ahead of the box must still
       draw a healthy card with correct ages. Twenty minutes rather than four,
       because both staleness thresholds are five: at four minutes, deleting the
       `shiftToBrowserClock` calls left every assertion green. Now it turns the
       headline into *the Overseer has stopped writing*. GPT Sol's P2, both
       rounds, 2026-09-08. */
    const receivedAt = Date.now() + 20 * 60_000;
    const read = parseFleetState(payload, receivedAt);
    expect(read.ok, read.ok ? "" : read.why).toBe(true);
    if (!read.ok) return;

    draw(read.state.overseer, receivedAt, receivedAt);

    /* THE SENTENCE THE STAGE EXISTS FOR — both clocks, in one line, honestly.
       The payload's `servedAt` is stamped as it is composed, so the skew
       correction maps the box's clock onto this browser's and the two ages come
       out relative to the write rather than to a real 2026 wall clock. */
    /* THE EXACT AGES, not merely the labels: the checkpoint was written 20s
       before the payload and the source heard from 40s before it, and those two
       numbers are what the skew correction has to preserve. */
    expect(screen()).toContain("Overseer last wrote 20s ago");
    expect(screen()).toContain("its fleet source last updated 40s ago");
    expect(screen()).toContain("Supervision is running.");
    /* The heartbeat the STORE wrote, not one this test invented. */
    expect(screen()).toContain(`pid ${process.pid}`);
    expect(screen()).toContain("1 ticks");
    expect(screen()).toContain("Scheduler armed");
    /* And the register, as history — with BOTH arms the fold produced, and the
       floor still marked after a trip through JSON and the browser's parser. */
    expect(screen()).toContain("fleet-dashboard");
    expect(screen()).toContain("needs-you");
    expect(screen()).toContain("as history rather than as a claim");
    expect(screen()).toContain("≥30m");
    expect(screen()).toContain("≥ is a floor");
    /* The changed one is a READING and carries no mark. A regex because the two
       spans are adjacent in the markup, with no space of their own. */
    expect(screen()).toMatch(/needs-you\s*10m/);
    expect(screen()).toMatch(/working\s*≥30m/);
  });

  it("reads the checkpoint ONCE per payload", () => {
    /* **THE PROPERTY, MEASURED RATHER THAN ASSERTED.** The two projections share
       a read so that the inbox's clock and the checkpoint's clock cannot come
       out of two versions of a file replaced by atomic rename — and the way that
       breaks is `statePayload` calling its reader twice. Counting the calls is
       the only form of this test that could fail; comparing two projections of a
       file nobody is writing passes either way. GPT Sol's P2, 2026-09-08. */
    const dir = tempRoot();
    realCheckpoint(dir);
    let reads = 0;
    const payload: unknown = JSON.parse(
      statePayload({
        snapshot: null,
        error: null,
        health: null,
        refreshMs: 60_000,
        answeringEnabled: true,
        attemptedAt: null,
        producer: { instance: "1a2b3c4d", publication: 0, inventory: null },
        readCheckpoint: () => {
          reads += 1;
          return readCheckpointFeeds(dir);
        },
      }),
    );
    expect(reads).toBe(1);
    /* And both feeds are on the payload, out of that one read. */
    const both = payload as { attention?: { kind?: string }; overseer?: { kind?: string } };
    expect(both.attention?.kind).toBe("published");
    expect(both.overseer?.kind).toBe("published");
  });
});

/* ------------------------------------------------------------------ *
 * The states, drawn.
 * ------------------------------------------------------------------ */

const NOW = Date.parse("2026-09-08T13:00:00.000Z");

function published(over: Partial<Parameters<typeof card>[0]> = {}): OverseerView {
  return card({
    writtenAt: "2026-09-08T12:59:30.000Z",
    lastGoodSnapshotAt: "2026-09-08T12:59:00.000Z",
    lastTickAt: "2026-09-08T12:59:30.000Z",
    ...over,
  });
}

function card(args: {
  writtenAt: string;
  lastGoodSnapshotAt: string | null;
  lastTickAt: string | null;
  sourceStaleAfterMs?: number | null;
  work?: OverseerRegisterWork;
  sessions?: {
    name: string;
    tmuxId: string;
    status: string;
    since: { kind: "observed" | "lower-bound"; at: string };
    work?: PaneWork | null;
  }[];
  total?: number;
}): OverseerView {
  return {
    kind: "published",
    status: {
      schema: 2,
      writtenAt: args.writtenAt,
      lastGoodSnapshotAt: args.lastGoodSnapshotAt,
      /* `in` rather than `??`, so a fixture can say NULL and mean it — the
         daemon did not publish a deadline — instead of getting the default back. */
      sourceStaleAfterMs: "sourceStaleAfterMs" in args ? (args.sourceStaleAfterMs ?? null) : 300_000,
      heartbeat: {
        kind: "reading",
        pid: 2_375_511,
        instanceId: "649e0574-aaf3-47e4-92a3-349360168865",
        startedAt: "2026-09-08T12:00:00.000Z",
        lastTickAt: args.lastTickAt,
        ticks: 28,
      },
      scheduler: { kind: "armed", why: "started with the scheduler on", at: "2026-09-08T12:00:00.000Z" },
      register: {
        kind: "read",
        total: args.total ?? (args.sessions?.length ?? 0),
        work: args.work ?? { kind: "unavailable", why: "this fixture carries no work scan" },
        sessions: (args.sessions ?? []).map((entry) => ({ ...entry, work: entry.work ?? null })),
      },
    },
  };
}

describe("a dead daemon and a deaf one do not look alike", () => {
  it("says SUPERVISION IS RUNNING only when both clocks are fresh", () => {
    draw(published(), NOW);
    expect(screen()).toContain("Supervision is running.");
    expect(screen()).not.toContain("stale");
  });

  it("says the Overseer STOPPED WRITING when its own clock has gone quiet", () => {
    draw(published({ writtenAt: "2026-09-08T12:40:00.000Z", lastGoodSnapshotAt: "2026-09-08T12:39:00.000Z" }), NOW);
    expect(screen()).toContain("The Overseer has stopped writing.");
  });

  it("warns about a stale SOURCE while the heartbeat is advancing — the case a watchdog would bless", () => {
    /* THE WHOLE REASON THERE ARE TWO CLOCKS. The daemon is writing every thirty
       seconds and has not heard from the dashboard in twenty minutes; through
       one clock this is a perfectly healthy Overseer. */
    draw(published({ lastGoodSnapshotAt: "2026-09-08T12:40:00.000Z" }), NOW);
    expect(screen()).toContain("The Overseer is writing, but it is not hearing from this dashboard.");
    expect(screen()).toContain("its view of the fleet is stale, however recently it wrote");
    expect(screen()).not.toContain("Supervision is running.");
  });

  it("says NEVER, loudly, when it has accepted no snapshot at all", () => {
    draw(published({ lastGoodSnapshotAt: null }), NOW);
    expect(screen()).toContain("its fleet source last updated never");
    expect(screen()).toContain("it has never accepted a snapshot from this dashboard");
  });

  it("prefers the daemon's own deadline, and says when it is falling back to its own", () => {
    /* A source 4 minutes old is FRESH under the daemon's 5-minute deadline and
       STALE under a 60-second one. The card must use the daemon's number when
       it has one — the two ends already drifted once at exactly this value. */
    const fourMinutes = { lastGoodSnapshotAt: "2026-09-08T12:56:00.000Z" };
    draw(published({ ...fourMinutes, sourceStaleAfterMs: 60_000 }), NOW);
    expect(screen()).toContain("not hearing from this dashboard");
    draw(published({ ...fourMinutes, sourceStaleAfterMs: 300_000 }), NOW);
    expect(screen()).toContain("Supervision is running.");
  });

  it("tells a daemon that has not ticked yet from one whose tick has stopped", () => {
    draw(published({ lastTickAt: null }), NOW);
    expect(screen()).toContain("no tick finished yet");
    draw(published({ lastTickAt: "2026-09-08T12:59:00.000Z" }), NOW);
    expect(screen()).toContain("last tick 1m ago");
  });

  it("treats an age it cannot compute as stale rather than as fresh", () => {
    /* A timestamp AHEAD of the anchor is a broken clock, and reading it as "0s
       ago" would suppress the alarm for exactly as long as the fault lasted. */
    draw(published({ writtenAt: "2026-09-08T13:30:00.000Z" }), NOW);
    expect(screen()).toContain("The Overseer has stopped writing.");
    expect(screen()).toContain("at a time this page cannot read");
  });
});

describe("the history, which is history", () => {
  const entries = [
    { name: "worktree-schema-move", tmuxId: "$215", status: "needs-you", since: { kind: "lower-bound" as const, at: "2026-09-08T12:30:00.000Z" } },
    { name: "fleet-dashboard", tmuxId: "$1992", status: "working", since: { kind: "observed" as const, at: "2026-09-08T12:45:00.000Z" } },
  ];

  it("marks a floor with ≥ and a reading without it, and explains the mark once", () => {
    draw(published({ sessions: entries, total: 36 }), NOW);
    /* `≥30m` is the four-identical-13m-rows bug, made visible. */
    expect(screen()).toContain("≥30m");
    expect(screen()).toContain("15m");
    expect(screen()).toContain("≥ is a floor");
  });

  it("says how many it is showing out of how many it holds", () => {
    draw(published({ sessions: entries, total: 36 }), NOW);
    expect(screen()).toContain("36 sessions in the Overseer's register");
    expect(screen()).toContain("the oldest 2 status records worth showing");
  });

  const review: PaneWork = {
    kind: "work",
    jobs: [
      {
        recogniser: "codex-review",
        label: "GPT review",
        startedAt: "2026-09-08T12:41:00.000Z",
        ranForMs: 18 * 60_000,
        pid: 42_812,
        depth: 8,
        command: "codex exec",
      },
    ],
    inspected: 11,
    paneCommand: "claude",
    paneStartedAt: "2026-09-08T10:00:00.000Z",
  };

  const idleReview = {
    name: "codex-cli-as-subagent-agent",
    tmuxId: "$2077",
    status: "idle",
    since: { kind: "lower-bound" as const, at: "2026-09-08T12:18:00.000Z" },
    work: review,
  };

  it("shows an idle pane beside fresh recognised work, using the frozen duration", () => {
    draw(
      published({
        work: { kind: "scanned", scannedAt: "2026-09-08T12:59:00.000Z" },
        sessions: [idleReview],
      }),
      NOW,
    );
    expect(screen()).toContain("pane: idle · work: GPT review, running 18m");
    expect(screen()).toContain("Process table read 1m ago");
  });

  it("freezes a stale scan's duration and says when it was checked", () => {
    draw(
      published({
        lastGoodSnapshotAt: "2026-09-08T12:00:00.000Z",
        work: { kind: "scanned", scannedAt: "2026-09-08T12:00:00.000Z" },
        sessions: [idleReview],
      }),
      NOW,
    );
    expect(screen()).toContain("pane: idle · work: GPT review — was running 18m when checked 1h ago");
    expect(screen()).not.toContain("running 1h 18m");
  });

  it("keeps cannot-tell separate from nothing recognised", () => {
    draw(
      published({
        work: { kind: "scanned", scannedAt: "2026-09-08T12:59:00.000Z" },
        sessions: [
          {
            ...idleReview,
            status: "working",
            work: { kind: "cannot-tell", cause: "pane-start-unavailable", why: "the pane start could not be read" },
          },
        ],
      }),
      NOW,
    );
    expect(screen()).toContain("pane: working · work: cannot tell — the pane start could not be read");
    expect(screen()).not.toContain("work: idle");
    expect(screen()).not.toContain("nothing recognised");
  });

  it("keeps an idle cannot-tell visible instead of summarising it as idle", () => {
    draw(
      published({
        work: { kind: "scanned", scannedAt: "2026-09-08T12:59:00.000Z" },
        sessions: [
          {
            ...idleReview,
            work: { kind: "cannot-tell", cause: "pane-not-in-table", why: "the pane process was absent" },
          },
        ],
      }),
      NOW,
    );
    expect(screen()).toContain("pane: idle · work: cannot tell — the pane process was absent");
  });

  it("says when the scan carried no reading for a shown session", () => {
    draw(
      published({
        work: { kind: "scanned", scannedAt: "2026-09-08T12:59:00.000Z" },
        sessions: [{ ...idleReview, status: "working", work: null }],
      }),
      NOW,
    );
    expect(screen()).toContain("pane: working · work: the scan carried no reading for this session");
    expect(screen()).not.toContain("nothing recognised");
  });

  it("says how many processes a no-work reading inspected", () => {
    draw(
      published({
        work: { kind: "scanned", scannedAt: "2026-09-08T12:59:00.000Z" },
        sessions: [
          {
            ...idleReview,
            status: "working",
            work: {
              kind: "none",
              inspected: 17,
              paneCommand: "claude",
              paneStartedAt: "2026-09-08T10:00:00.000Z",
            },
          },
        ],
      }),
      NOW,
    );
    expect(screen()).toContain("work: nothing recognised under it (17 processes inspected)");
  });

  it("puts stale negative readings in the past rather than turning them into current claims", () => {
    draw(
      published({
        lastGoodSnapshotAt: "2026-09-08T12:00:00.000Z",
        work: { kind: "scanned", scannedAt: "2026-09-08T12:00:00.000Z" },
        sessions: [
          {
            ...idleReview,
            status: "working",
            work: {
              kind: "none",
              inspected: 17,
              paneCommand: "claude",
              paneStartedAt: "2026-09-08T10:00:00.000Z",
            },
          },
          {
            ...idleReview,
            name: "unreadable-pane",
            status: "working",
            work: { kind: "cannot-tell", cause: "pane-missing", why: "the pane process was absent" },
          },
        ],
      }),
      NOW,
    );
    expect(screen()).toContain("work: nothing was recognised under it when checked 1h ago (17 processes inspected)");
    expect(screen()).toContain("work: could not tell when checked 1h ago — the pane process was absent");
    expect(screen()).not.toContain("work: nothing recognised under it");
  });

  it("draws an unavailable scan once above the list and no per-row work", () => {
    draw(
      published({
        work: { kind: "unavailable", why: "the process table could not be read" },
        sessions: [
          idleReview,
          {
            name: "worktree-schema-move",
            tmuxId: "$215",
            status: "needs-you",
            since: { kind: "lower-bound", at: "2026-09-08T12:30:00.000Z" },
            work: review,
          },
        ],
      }),
      NOW,
    );
    expect(screen()).toContain("Work evidence is unavailable — the process table could not be read");
    expect(screen()).not.toContain("pane:");
    expect(screen()).not.toContain("work: GPT review");
  });

  it("puts the scan evidence and ordering caveat in the work tooltip", () => {
    draw(
      published({
        work: { kind: "scanned", scannedAt: "2026-09-08T12:59:00.000Z" },
        sessions: [idleReview],
      }),
      NOW,
    );
    expect(screen()).toContain("codex exec");
    expect(screen()).toContain("pid 42812");
    expect(screen()).toContain("depth 8");
    expect(screen()).toContain("11 processes inspected");
    expect(screen()).toContain("2026-09-08T12:59:00.000Z");
    expect(screen()).toContain("ordered by pane-status age, not by child-work age");
  });

  it("leaves the legend off when every row is a reading", () => {
    draw(published({ sessions: [entries[1]!], total: 4 }), NOW);
    expect(screen()).not.toContain("≥ is a floor");
  });

  it("says an empty register is empty, and an unreadable one unreadable", () => {
    draw(published({ sessions: [], total: 0 }), NOW);
    expect(screen()).toContain("holding no sessions in its register");

    const unreadable = published();
    if (unreadable.kind !== "published") throw new Error("fixture");
    draw(
      {
        kind: "published",
        status: { ...unreadable.status, register: { kind: "unreadable", why: "an entry is not one this page can read" } },
      },
      NOW,
    );
    expect(screen()).toContain("The register could not be read");
    /* AND THE FLEET IS UNAFFECTED, said on screen: the sessions are collected
       by this dashboard and owe nothing to the Overseer's file. */
    expect(screen()).toContain("Sessions tab are unaffected");
  });

  it("says all-idle rather than empty when the register holds idle sessions only", () => {
    draw(published({ sessions: [], total: 7 }), NOW);
    expect(screen()).toContain("All 7 sessions in the Overseer's register had pane status idle");
  });
});

describe("the five ways there is no reading", () => {
  it("draws NOTHING before a payload has arrived, and a LINE once one has", () => {
    /* TWO DIFFERENT SILENCES. `null` is a page that has been told nothing —
       a line there would flash on every load. `not-asked` is a payload that
       arrived from a server which does not report supervision at all, and
       drawing nothing for that puts the tab back to its pre-stage appearance
       with nothing saying why. GPT Sol's P1, 2026-09-08. */
    draw(null, NOW);
    expect(screen()).toBe("");

    draw({ kind: "not-asked" }, NOW);
    expect(screen()).toContain("this server did not report whether anything is watching");
    /* AND IT IS NOT A CLAIM ABOUT THE BOX: nothing looked, which is not the
       same as nothing watching. */
    expect(screen()).not.toContain("no Overseer checkpoint");
  });

  it("says nothing has been published HERE, rather than that the Overseer is dead", () => {
    draw({ kind: "checkpoint-absent" }, NOW);
    expect(screen()).toContain("no Overseer checkpoint has been published where this server looked");
    expect(screen()).not.toContain("is not running");
  });

  it("names both versions when the schema is one this build does not read", () => {
    /* The live case on 2026-09-08: the box's file said 1, the build said 2. */
    draw({ kind: "unsupported-schema", saw: "1", known: 2 }, NOW);
    expect(screen()).toContain("the checkpoint says schema 1 and this page reads schema 2");
  });

  it("separates a checkpoint it could not read from an answer it could not read", () => {
    draw({ kind: "checkpoint-unreadable", why: "current.json is not JSON" }, NOW);
    expect(screen()).toContain("the checkpoint could not be read");
    draw({ kind: "feed-unreadable", why: "the kind is one this page does not know" }, NOW);
    expect(screen()).toContain("could not read the server's answer");
  });
});

describe("the client's own parse", () => {
  it("shifts work instants onto the browser clock but leaves the observed duration alone", () => {
    const view = parseOverseer(
      {
        kind: "published",
        status: {
          schema: 2,
          writtenAt: "2026-09-08T12:59:30.000Z",
          lastGoodSnapshotAt: "2026-09-08T12:59:00.000Z",
          sourceStaleAfterMs: 300_000,
          heartbeat: { kind: "reading", pid: 1, instanceId: "i", startedAt: "2026-09-08T12:00:00.000Z", lastTickAt: null, ticks: 3 },
          scheduler: { kind: "armed", why: "on", at: "2026-09-08T12:00:00.000Z" },
          register: {
            kind: "read",
            total: 1,
            work: { kind: "scanned", scannedAt: "2026-09-08T12:59:00.000Z" },
            sessions: [
              {
                name: "review",
                tmuxId: "$1",
                status: "idle",
                since: { kind: "observed", at: "2026-09-08T12:30:00.000Z" },
                work: {
                  kind: "work",
                  jobs: [{ recogniser: "codex-review", label: "GPT review", startedAt: "2026-09-08T12:41:00.000Z", ranForMs: 1_080_000, pid: 42_812, depth: 8, command: "codex exec" }],
                  inspected: 11,
                  paneCommand: "claude",
                  paneStartedAt: "2026-09-08T10:00:00.000Z",
                },
              },
            ],
          },
        },
      },
      { kind: "known", ms: 20 * 60_000 },
    );
    if (view.kind !== "published" || view.status.register.kind !== "read") throw new Error("expected register");
    expect(view.status.register.work).toEqual({ kind: "scanned", scannedAt: "2026-09-08T12:39:00.000Z" });
    const entry = view.status.register.sessions[0];
    if (entry?.work?.kind !== "work") throw new Error("expected work");
    expect(entry.work.paneStartedAt).toBe("2026-09-08T09:40:00.000Z");
    expect(entry.work.jobs[0]?.startedAt).toBe("2026-09-08T12:21:00.000Z");
    expect(entry.work.jobs[0]?.ranForMs).toBe(1_080_000);
  });

  it("degrades malformed work without losing the register", () => {
    const raw = published({
      work: { kind: "scanned", scannedAt: "2026-09-08T12:59:00.000Z" },
      sessions: [
        {
          name: "review",
          tmuxId: "$1",
          status: "idle",
          since: { kind: "observed", at: "2026-09-08T12:30:00.000Z" },
          work: null,
        },
      ],
    });
    if (raw.kind !== "published" || raw.status.register.kind !== "read") throw new Error("fixture");
    const payload: unknown = {
      ...raw,
      status: {
        ...raw.status,
        register: {
          ...raw.status.register,
          sessions: raw.status.register.sessions.map((entry) => ({ ...entry, work: { kind: "work", jobs: [] } })),
        },
      },
    };
    const view = parseOverseer(payload, CLOCK_SKEW_UNMEASURED);
    if (view.kind !== "published") throw new Error("expected published");
    expect(view.status.register.kind).toBe("read");
    if (view.status.register.kind !== "read") return;
    expect(view.status.register.work.kind).toBe("unavailable");
    expect(view.status.register.sessions).toHaveLength(1);
  });

  it("degrades impossible measured work without losing the register", () => {
    const raw = published({
      work: { kind: "scanned", scannedAt: "2026-09-08T12:59:00.000Z" },
      sessions: [
        {
          name: "review",
          tmuxId: "$1",
          status: "working",
          since: { kind: "observed", at: "2026-09-08T12:30:00.000Z" },
          work: {
            kind: "none",
            inspected: 1,
            paneCommand: "claude",
            paneStartedAt: "2026-09-08T13:00:00.000Z",
          },
        },
      ],
    });
    const view = parseOverseer(raw, CLOCK_SKEW_UNMEASURED);
    if (view.kind !== "published" || view.status.register.kind !== "read") throw new Error("expected register");
    expect(view.status.register.work.kind).toBe("unavailable");
    expect(view.status.register.sessions).toHaveLength(1);
    expect(view.status.register.sessions[0]?.work).toBeNull();
  });

  it("degrades a duration that was not measured by the job and scan clocks", () => {
    const raw = published({
      work: { kind: "scanned", scannedAt: "2026-09-08T12:59:00.000Z" },
      sessions: [
        {
          name: "review",
          tmuxId: "$1",
          status: "working",
          since: { kind: "observed", at: "2026-09-08T12:30:00.000Z" },
          work: {
            kind: "work",
            jobs: [
              {
                recogniser: "codex-review",
                label: "GPT review",
                startedAt: "2026-09-08T12:41:00.000Z",
                ranForMs: 99 * 60_000,
                pid: 42_812,
                depth: 8,
                command: "codex exec",
              },
            ],
            inspected: 11,
            paneCommand: "claude",
            paneStartedAt: "2026-09-08T10:00:00.000Z",
          },
        },
      ],
    });
    const view = parseOverseer(raw, CLOCK_SKEW_UNMEASURED);
    if (view.kind !== "published" || view.status.register.kind !== "read") throw new Error("expected register");
    expect(view.status.register.work.kind).toBe("unavailable");
    expect(view.status.register.sessions[0]?.work).toBeNull();
  });

  it("keeps the valid edges and rejects future and depth-zero jobs at the browser boundary", () => {
    const base = {
      recogniser: "codex-review",
      label: "GPT review",
      pid: 42_812,
      command: "codex exec",
    };
    const workOf = (job: PaneJob): "scanned" | "unavailable" => {
      const raw = published({
        work: { kind: "scanned", scannedAt: "2026-09-08T12:59:00.000Z" },
        sessions: [
          {
            name: "review",
            tmuxId: "$1",
            status: "working",
            since: { kind: "observed", at: "2026-09-08T12:30:00.000Z" },
            work: {
              kind: "work",
              jobs: [job],
              inspected: 11,
              paneCommand: "claude",
              paneStartedAt: "2026-09-08T10:00:00.000Z",
            },
          },
        ],
      });
      const view = parseOverseer(raw, CLOCK_SKEW_UNMEASURED);
      if (view.kind !== "published" || view.status.register.kind !== "read") throw new Error("expected register");
      return view.status.register.work.kind;
    };

    expect(workOf({ ...base, startedAt: null, ranForMs: null, depth: 8 })).toBe("scanned");
    expect(workOf({ ...base, startedAt: "2026-09-08T12:59:00.000Z", ranForMs: 0, depth: 1 })).toBe("scanned");
    expect(workOf({ ...base, startedAt: "2026-09-08T12:40:59.000Z", ranForMs: 18 * 60_000, depth: 1 })).toBe("scanned");
    expect(workOf({ ...base, startedAt: "2026-09-08T12:59:01.000Z", ranForMs: 0, depth: 1 })).toBe("unavailable");
    expect(workOf({ ...base, startedAt: "2026-09-08T12:41:00.000Z", ranForMs: 18 * 60_000, depth: 0 })).toBe("unavailable");
  });

  it("rejects positive browser evidence that contradicts its pane walk", () => {
    const workKind = (inspected: number, paneStartedAt: string): "scanned" | "unavailable" => {
      const raw = published({
        work: { kind: "scanned", scannedAt: "2026-09-08T12:59:00.000Z" },
        sessions: [
          {
            name: "review",
            tmuxId: "$1",
            status: "working",
            since: { kind: "observed", at: "2026-09-08T12:30:00.000Z" },
            work: {
              kind: "work",
              jobs: [
                {
                  recogniser: "codex-review",
                  label: "GPT review",
                  startedAt: "2026-09-08T12:41:00.000Z",
                  ranForMs: 18 * 60_000,
                  pid: 42_812,
                  depth: 1,
                  command: "codex exec",
                },
              ],
              inspected,
              paneCommand: "claude",
              paneStartedAt,
            },
          },
        ],
      });
      const view = parseOverseer(raw, CLOCK_SKEW_UNMEASURED);
      if (view.kind !== "published" || view.status.register.kind !== "read") {
        throw new Error("expected register");
      }
      return view.status.register.work.kind;
    };

    expect(workKind(0, "2026-09-08T10:00:00.000Z")).toBe("unavailable");
    expect(workKind(1, "2026-09-08T12:50:00.000Z")).toBe("unavailable");
  });

  it("reads an absent field as `not-asked` and a broken one as `feed-unreadable`", () => {
    /* ABSENT IS SILENCE, PRESENT-AND-WRONG IS A FAULT. Collapsing the second
       into the first would say *nobody asked* about a server that did. */
    expect(parseOverseer(undefined, CLOCK_SKEW_UNMEASURED)).toEqual({ kind: "not-asked" });
    expect(parseOverseer({ kind: "banana" }, CLOCK_SKEW_UNMEASURED).kind).toBe("feed-unreadable");
    expect(parseOverseer(null, CLOCK_SKEW_UNMEASURED).kind).toBe("feed-unreadable");
  });

  it("refuses a PUBLISHED status whose checkpoint schema this build has never read", () => {
    /* THE OLD-TAB-AFTER-A-DEPLOY CASE, and the reason this parser exists at all:
       the server refuses an unknown schema, but a NEWER server that had learned
       schema 3 would send it inside a `published` arm, and this build would draw
       ages off fields whose meaning had moved. GPT Sol's P1, 2026-09-08. */
    const view = parseOverseer(
      {
        kind: "published",
        status: {
          schema: 3,
          writtenAt: "2026-09-08T12:59:30.000Z",
          lastGoodSnapshotAt: "2026-09-08T12:59:00.000Z",
          sourceStaleAfterMs: 300_000,
          heartbeat: { kind: "reading", pid: 1, instanceId: "i", startedAt: "2026-09-08T12:00:00.000Z", lastTickAt: null, ticks: 3 },
          scheduler: { kind: "armed", why: "on", at: "2026-09-08T12:00:00.000Z" },
          register: { kind: "read", total: 0, sessions: [] },
        },
      },
      CLOCK_SKEW_UNMEASURED,
    );
    expect(view.kind).toBe("feed-unreadable");
    if (view.kind === "feed-unreadable") expect(view.why).toContain("schema 3");
  });

  it("refuses an absurd source deadline rather than letting it bless a dead source", () => {
    /* An unbounded deadline taken on trust makes a source from 2020 read as
       fresh — *supervision is running* over a dashboard the Overseer has not
       heard from in years. Out of range means *the daemon did not say*, and the
       card falls back to a deadline it names. GPT Sol's P1. */
    const status = (sourceStaleAfterMs: unknown): unknown => ({
      kind: "published",
      status: {
        schema: 2,
        writtenAt: "2026-09-08T12:59:30.000Z",
        lastGoodSnapshotAt: "2020-01-01T00:00:00.000Z",
        sourceStaleAfterMs,
        heartbeat: { kind: "reading", pid: 1, instanceId: "i", startedAt: "2026-09-08T12:00:00.000Z", lastTickAt: null, ticks: 3 },
        scheduler: { kind: "armed", why: "on", at: "2026-09-08T12:00:00.000Z" },
        register: { kind: "read", total: 0, sessions: [] },
      },
    });
    /* **PRESENT AND WRONG FAILS THE READING.** Collapsing it into *the server
       did not say* left the boundary blurred: a four-minute-old source with a
       deadline of one hour and a millisecond would have read as healthy off a
       number nobody could have meant. GPT Sol, round two. */
    for (const absurd of [1e300, 60 * 60_000 + 1, 0, -1, "300000"]) {
      expect(parseOverseer(status(absurd), CLOCK_SKEW_UNMEASURED).kind, String(absurd)).toBe("feed-unreadable");
    }
    /* ABSENT IS DIFFERENT: an older server that never sent the field. The card
       falls back to its own deadline, says which it used, and the ancient source
       above is loudly stale rather than blessed. */
    const view = parseOverseer(status(undefined), CLOCK_SKEW_UNMEASURED);
    if (view.kind !== "published") throw new Error("expected published");
    expect(view.status.sourceStaleAfterMs).toBeNull();
    draw(view, NOW);
    expect(screen()).toContain("not hearing from this dashboard");
    expect(screen()).toContain("this page's fallback");
    /* AND IT SAYS SO ON THE HEALTHY PATH TOO, which is the one moment a reader
       cannot infer it from anything else on the card. */
    draw(published({ sourceStaleAfterMs: null }), NOW);
    expect(screen()).toContain("Supervision is running.");
    expect(screen()).toContain("source deadline: this page's own 5m");
  });

  it("names both versions for a future schema whose SHAPE has changed too", () => {
    /* The version is read BEFORE the body, so a schema-3 status that no longer
       looks like a schema-2 one still produces the diagnostic somebody can act
       on rather than a shrug about an unreadable body. GPT Sol, round two. */
    const view = parseOverseer({ kind: "published", status: { schema: 3 } }, CLOCK_SKEW_UNMEASURED);
    expect(view.kind).toBe("feed-unreadable");
    if (view.kind === "feed-unreadable") expect(view.why).toContain("schema 3");
  });

  it("refuses an unsupported-schema arm that does not name its versions", () => {
    expect(parseOverseer({ kind: "unsupported-schema", saw: "1" }, CLOCK_SKEW_UNMEASURED).kind).toBe("feed-unreadable");
  });

  it("keeps a scheduler state it has never seen as one unreadable line", () => {
    /* The second door. The server refuses a widened discriminant, and so does
       this — 260908g's Stage 3c may add one, and it must not read as `off`. */
    const view = parseOverseer(
      {
        kind: "published",
        status: {
          schema: 2,
          writtenAt: "2026-09-08T12:59:30.000Z",
          lastGoodSnapshotAt: "2026-09-08T12:59:00.000Z",
          sourceStaleAfterMs: 300_000,
          heartbeat: { kind: "reading", pid: 1, instanceId: "i", startedAt: "2026-09-08T12:00:00.000Z", lastTickAt: null, ticks: 3 },
          scheduler: { kind: "paused", why: "the box was over its load ceiling", at: "2026-09-08T12:00:00.000Z" },
          register: { kind: "read", total: 0, sessions: [] },
        },
      },
      CLOCK_SKEW_UNMEASURED,
    );
    expect(view.kind).toBe("published");
    if (view.kind !== "published") return;
    expect(view.status.scheduler.kind).toBe("unreadable");
    /* And the two clocks survive it. */
    expect(view.status.writtenAt).toBe("2026-09-08T12:59:30.000Z");
  });

  it("refuses a register that claims to show more than it holds", () => {
    const view = parseOverseer(
      {
        kind: "published",
        status: {
          schema: 2,
          writtenAt: "2026-09-08T12:59:30.000Z",
          lastGoodSnapshotAt: null,
          sourceStaleAfterMs: null,
          heartbeat: { kind: "unreadable", why: "the heartbeat is not an object" },
          scheduler: { kind: "not-said", why: "no daemon has said", at: "2026-09-08T12:00:00.000Z" },
          register: {
            kind: "read",
            total: 1,
            sessions: [
              { name: "a", tmuxId: "$1", status: "working", since: { kind: "observed", at: "2026-09-08T12:00:00.000Z" } },
              { name: "b", tmuxId: "$2", status: "working", since: { kind: "observed", at: "2026-09-08T12:00:00.000Z" } },
            ],
          },
        },
      },
      CLOCK_SKEW_UNMEASURED,
    );
    if (view.kind !== "published") throw new Error("expected published");
    expect(view.status.register.kind).toBe("unreadable");
    expect(view.status.heartbeat.kind).toBe("unreadable");
    expect(view.status.scheduler.kind).toBe("not-said");
  });
});
