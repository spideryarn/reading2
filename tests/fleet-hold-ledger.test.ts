/**
 * The durable half of the quarantine — tools/fleet/hold-ledger.ts.
 *
 * **WHAT THIS FILE IS ABOUT IS BYTES ON A DISK, NOT HOLDS.** Whether a hold is
 * the right answer is tests/fleet-quarantine.test.ts's question; whether the
 * record of one survives the process that wrote it is this one's, and the two
 * are tested apart because the ledger has failure modes a book cannot have — a
 * torn tail, a second writer, a file that grows for ever.
 *
 * The restart itself is tests/fleet-hold-restart.test.ts, which rebuilds a whole
 * composition from these bytes. Nothing here sends a keystroke, and every
 * directory is a fresh `mkdtemp`.
 *
 * docs/plans/260908j § Stage 4b.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_HOLDS_DIR,
  LEDGER_FILE,
  MAX_LEDGER_BYTES,
  MAX_WHAT_CHARS,
  foldLedger,
  holdLedgerDir,
  ledgerLine,
  openHoldLedger,
  parseLedgerLine,
  type AttemptRecord,
  type HeldRecord,
  type HoldLedger,
  type HoldLedgerRecord,
} from "../tools/fleet/hold-ledger.js";

const SESSION = "$97101";
const OTHER = "$97102";
/* ITS OWN, NOT A COPY OF fleet-quarantine.test.ts's. Copying that file's CONVO
   in went red at `tests/fixture-ids.test.ts`, which refuses one uuid declared by
   two test files: vitest runs files in parallel against one database, so the
   file that tears down first would delete the other's row. Nothing here touches
   a database, and the guard is still right to refuse — it cannot tell, and a
   shared id is one insert away from being a real one. */
const CONVO = "7d3c9b21-4e58-4a17-9c62-1f0ab5d67e04";

const opened: HoldLedger[] = [];
const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "s4b-holds-"));
  roots.push(root);
  return root;
}

/** Open a ledger and remember it, so no test leaves a writer lock behind. */
function open(dir: string): HoldLedger {
  const result = openHoldLedger(dir);
  if (result.kind !== "open") throw new Error(`the ledger would not open: ${result.why}`);
  opened.push(result.ledger);
  return result.ledger;
}

afterEach(() => {
  while (opened.length > 0) opened.pop()?.close();
  while (roots.length > 0) rmSync(roots.pop() ?? "", { recursive: true, force: true });
});

function attempt(over: Partial<Omit<AttemptRecord, "schema" | "kind">> = {}): Omit<AttemptRecord, "schema" | "kind"> {
  return {
    at: 1_700_000_000_000,
    sessionId: SESSION,
    paneId: "%97101",
    claudeSessionId: CONVO,
    origin: "direct-steer",
    what: "message (42 characters)",
    serverInstanceId: "1a2b3c4d",
    tmuxGeneration: 990_001,
    ...over,
  };
}

function held(over: Partial<Omit<HeldRecord, "schema" | "kind">> = {}): Omit<HeldRecord, "schema" | "kind"> {
  return {
    at: 1_700_000_001_000,
    sessionId: SESSION,
    holdId: "1a2b3c4d-h1",
    version: 1,
    openedAt: 1_700_000_001_000,
    lastSendAt: 1_700_000_001_000,
    incidents: 1,
    reading: "partial",
    origin: "direct-steer",
    what: "message (42 characters)",
    paneId: "%97101",
    claudeSessionId: CONVO,
    serverInstanceId: "1a2b3c4d",
    tmuxGeneration: 990_001,
    ...over,
  };
}

describe("where the ledger lives", () => {
  it("is the dashboard's own directory, not the health store's and not the Overseer's", () => {
    expect(DEFAULT_HOLDS_DIR.endsWith("/.fleet-holds")).toBe(true);
    expect(DEFAULT_HOLDS_DIR).not.toContain(".overseer");
    expect(DEFAULT_HOLDS_DIR).not.toContain(".fleet-health");
  });

  it("takes an absolute override and refuses a relative one", () => {
    expect(holdLedgerDir("/srv/holds")).toEqual({ ok: true, dir: "/srv/holds" });
    const relative = holdLedgerDir("holds");
    expect(relative.ok).toBe(false);
    if (relative.ok) return;
    // The same argument health-history.ts makes: a relative path resolves
    // differently for a systemd unit and for a person in a worktree.
    expect(relative.why).toContain("absolute");
  });

  it("an empty override is not an override", () => {
    expect(holdLedgerDir("")).toEqual({ ok: true, dir: DEFAULT_HOLDS_DIR });
    expect(holdLedgerDir(undefined)).toEqual({ ok: true, dir: DEFAULT_HOLDS_DIR });
  });
});

describe("one line, and back", () => {
  it("round-trips each of the three record kinds", () => {
    const records: HoldLedgerRecord[] = [
      { schema: 1, kind: "attempt", ...attempt() },
      { schema: 1, kind: "held", ...held() },
      { schema: 1, kind: "resolved", at: 2, sessionId: SESSION, how: "delivered" },
    ];
    for (const record of records) {
      const line = ledgerLine(record);
      expect(line.endsWith("\n")).toBe(true);
      expect(line.includes("\n", 0)).toBe(true);
      expect(parseLedgerLine(line)).toEqual(record);
    }
  });

  it("refuses a line that does not name a session, a kind and a schema", () => {
    expect(parseLedgerLine("")).toBeNull();
    expect(parseLedgerLine("not json")).toBeNull();
    expect(parseLedgerLine("[]")).toBeNull();
    expect(parseLedgerLine(JSON.stringify({ schema: 2, kind: "attempt", ...attempt() }))).toBeNull();
    expect(parseLedgerLine(JSON.stringify({ schema: 1, kind: "invented", sessionId: SESSION, at: 1 }))).toBeNull();
    expect(parseLedgerLine(JSON.stringify({ schema: 1, kind: "resolved", at: 1, sessionId: SESSION, how: "posted" }))).toBeNull();
    expect(parseLedgerLine(JSON.stringify({ schema: 1, kind: "attempt", ...attempt({ origin: "telepathy" as never }) }))).toBeNull();
  });

  it("bounds `what`, so a record has a size and the file has a growth rate", () => {
    const line = ledgerLine({ schema: 1, kind: "attempt", ...attempt({ what: "x".repeat(5_000) }) });
    const back = parseLedgerLine(line);
    expect(back?.kind).toBe("attempt");
    if (back?.kind !== "attempt") return;
    expect(back.what.length).toBeLessThanOrEqual(MAX_WHAT_CHARS);
  });
});

describe("the fold — the last record for a session decides", () => {
  it("an attempt with nothing after it is unresolved", () => {
    const live = foldLedger([{ schema: 1, kind: "attempt", ...attempt() }]);
    expect([...live.keys()]).toEqual([SESSION]);
    expect(live.get(SESSION)?.kind).toBe("attempt");
  });

  it("a resolution removes it, whichever way the send went", () => {
    for (const how of ["delivered", "nothing-was-sent", "released", "superseded"] as const) {
      const live = foldLedger([
        { schema: 1, kind: "attempt", ...attempt() },
        { schema: 1, kind: "resolved", at: 3, sessionId: SESSION, how },
      ]);
      expect(live.size).toBe(0);
    }
  });

  it("a hold replaces the attempt it came out of, and is itself unresolved", () => {
    const live = foldLedger([
      { schema: 1, kind: "attempt", ...attempt() },
      { schema: 1, kind: "held", ...held() },
    ]);
    expect(live.size).toBe(1);
    const state = live.get(SESSION);
    expect(state?.kind).toBe("held");
    if (state?.kind !== "held") return;
    expect(state.holdId).toBe("1a2b3c4d-h1");
  });

  it("a later hold record wins, so a version bump survives", () => {
    const live = foldLedger([
      { schema: 1, kind: "held", ...held() },
      { schema: 1, kind: "held", ...held({ version: 2, incidents: 2, reading: "unknown" }) },
    ]);
    const state = live.get(SESSION);
    expect(state?.kind === "held" && state.version).toBe(2);
  });

  it("sessions do not touch each other", () => {
    const live = foldLedger([
      { schema: 1, kind: "attempt", ...attempt() },
      { schema: 1, kind: "attempt", ...attempt({ sessionId: OTHER }) },
      { schema: 1, kind: "resolved", at: 4, sessionId: OTHER, how: "delivered" },
    ]);
    expect([...live.keys()]).toEqual([SESSION]);
  });
});

describe("the file, opened and reopened", () => {
  it("carries an unresolved attempt across a close and a reopen", () => {
    const root = tempRoot();
    const first = open(root);
    first.noteAttempt(attempt());
    expect(first.live()).toHaveLength(1);
    first.close();

    const second = open(root);
    const live = second.live();
    expect(live).toHaveLength(1);
    expect(live[0]?.sessionId).toBe(SESSION);
  });

  it("carries NOTHING across when the attempt was accounted for", () => {
    const root = tempRoot();
    const first = open(root);
    first.noteAttempt(attempt());
    first.noteResolved({ at: 5, sessionId: SESSION, how: "delivered" });
    first.close();

    expect(open(root).live()).toEqual([]);
  });

  it("carries a hold across, with the id and version the page was looking at", () => {
    const root = tempRoot();
    const first = open(root);
    first.noteAttempt(attempt());
    first.noteHold(held({ version: 3, incidents: 3 }));
    first.close();

    const state = open(root).live()[0];
    expect(state?.kind).toBe("held");
    if (state?.kind !== "held") return;
    expect(state.holdId).toBe("1a2b3c4d-h1");
    expect(state.version).toBe(3);
    expect(state.reading).toBe("partial");
  });

  it("repairs a torn last line at open rather than forgiving it on read", () => {
    const root = tempRoot();
    const first = open(root);
    first.noteAttempt(attempt());
    first.close();
    const path = join(root, LEDGER_FILE);
    writeFileSync(path, `${readFileSync(path, "utf8")}{"schema":1,"kind":"att`, "utf8");

    const second = open(root);
    expect(second.status().repaired.torn).toBe(true);
    expect(second.live()).toHaveLength(1);
    // THE POINT OF REPAIRING AT OPEN: the next append lands on clean bytes, so
    // the record after the torn one is readable rather than welded to it.
    second.noteAttempt(attempt({ sessionId: OTHER }));
    second.close();
    expect(open(root).live()).toHaveLength(2);
  });

  it("counts a line it cannot read rather than throwing the file away", () => {
    const root = tempRoot();
    const first = open(root);
    first.noteAttempt(attempt());
    first.close();
    const path = join(root, LEDGER_FILE);
    writeFileSync(path, `${readFileSync(path, "utf8")}{"schema":1,"kind":"nonsense"}\n`, "utf8");

    const second = open(root);
    expect(second.status().unreadableLines).toBe(1);
    expect(second.live()).toHaveLength(1);
  });
});

describe("bounded, because a file that grows for ever is a different bug", () => {
  it("compacts to the live records rather than keeping the history", () => {
    const root = tempRoot();
    const ledger = open(root);
    /* **THE LIVE RECORD GOES IN FIRST, AND THE ORDER IS THE TEST.** Written
       last, it would land in the file a compaction had just emptied and survive
       whatever the compaction did — which is how the first version of this test
       passed while a compaction that wrote an empty file did too. It has to be
       one of the records the rewrite is responsible for carrying over. */
    ledger.noteAttempt(attempt());

    /* Enough resolved cycles to pass the cap several times over. Each is a real
       pair — attempted, then accounted for — so nothing from the loop is live
       at the end. */
    const cycles = Math.ceil(MAX_LEDGER_BYTES / 300) * 2;
    for (let i = 0; i < cycles; i += 1) {
      ledger.noteAttempt(attempt({ sessionId: `$${i}` }));
      ledger.noteResolved({ at: 6, sessionId: `$${i}`, how: "delivered" });
    }

    const size = statSync(join(root, LEDGER_FILE)).size;
    expect(size).toBeLessThanOrEqual(MAX_LEDGER_BYTES);
    expect(ledger.status().compactions).toBeGreaterThan(0);
    // AND THE LIVE RECORD SURVIVED THE COMPACTION, which is the half that
    // matters: a compaction that dropped an open hold would be the bug this
    // whole stage is about, arriving through the tidying-up.
    expect(ledger.live()).toHaveLength(1);
    expect(ledger.live()[0]?.sessionId).toBe(SESSION);
    /* READ BACK OFF THE DISK, because `live()` is this process's own map and a
       compaction that wrote nothing would leave it looking perfectly right. */
    ledger.close();
    const reopened = open(root).live();
    expect(reopened).toHaveLength(1);
    expect(reopened[0]?.sessionId).toBe(SESSION);
  });
});

describe("one writer", () => {
  it("a second opener reads the holds and does not write", () => {
    const root = tempRoot();
    const first = open(root);
    first.noteAttempt(attempt());

    const second = open(root);
    // IT STILL REHYDRATES. Two dashboards both refusing to send to a held
    // session is the safe direction; two of them writing one file is not.
    expect(second.live()).toHaveLength(1);
    expect(second.status().lockedOutBy).not.toBeNull();
    expect(first.status().lockedOutBy).toBeNull();

    second.noteAttempt(attempt({ sessionId: OTHER }));
    expect(second.live()).toHaveLength(1);
    first.close();
    expect(open(root).live()).toHaveLength(1);
  });
});

describe("a ledger that cannot write says so and does not stop the dashboard", () => {
  it("records the failure and goes on answering", () => {
    const root = tempRoot();
    const result = openHoldLedger(root, {
      writeLine: () => {
        throw new Error("ENOSPC: no space left on device");
      },
    });
    expect(result.kind).toBe("open");
    if (result.kind !== "open") return;
    opened.push(result.ledger);
    expect(() => result.ledger.noteAttempt(attempt())).not.toThrow();
    expect(result.ledger.status().failure).toContain("ENOSPC");
    /* AND THE STATE IS NOT PRETENDED. Nothing reached the disk, so nothing is
       claimed to have: a later reader of this file finds no attempt, and
       `live()` must not say otherwise. */
    expect(result.ledger.live()).toEqual([]);
  });

  it("refuses a directory it cannot make, without throwing", () => {
    const root = tempRoot();
    writeFileSync(join(root, "file"), "not a directory", "utf8");
    const result = openHoldLedger(join(root, "file", "holds"));
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.why.length).toBeGreaterThan(20);
    expect(existsSync(join(root, "file", "holds"))).toBe(false);
  });
});
