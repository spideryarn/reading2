/**
 * **The edge the fleet server did not have**: reading the attention inbox out
 * of the Overseer's checkpoint file.
 *
 * Two things are under test and the second is the one that surprises people.
 *
 * **The arms must not merge.** `checkpoint-absent` says nothing has been
 * published at the path we looked at; `checkpoint-unreadable` says something is
 * there and we could not read it; `published` with an `unknown` list says the
 * coordinator is running and has judged nothing. Fold any of them into an empty
 * list and the page says *nothing needs you*, which is the reading least likely
 * to make anyone look.
 *
 * **The reader parses the FILE, not the Overseer's parser**, and these tests
 * hand-write checkpoints for that reason: the file is the contract. `readAttention`
 * takes three fields out of a file that has eight, so a checkpoint with a
 * corrupt `register` still yields a perfectly good inbox — which is the
 * behaviour a borrowed `parseCheckpoint` would NOT have had, since that one
 * fails whole on a bad register entry by design. There is a test for exactly
 * that below.
 *
 * Verified against the real thing as well as against these fixtures: on
 * 2026-09-08 the live `~/.overseer/current.json` (95KB, schema 2) read back as
 * `published` with 2 items, `sessionsScanned: 11`, `sessionsUnreadable: 1`.
 * That check is not in the suite because the file belongs to a daemon another
 * session owns and a test that fails when somebody restarts it is a test that
 * teaches people to ignore it.
 *
 * The other half of the join — the payload reaching the DOM — is in
 * tests/fleet-web.test.tsx, which drives the same `statePayload` production
 * composes through.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readAttention } from "../tools/fleet/attention.js";
import { fleetState } from "../tools/fleet/state.js";
import type { AttentionItem, AttentionList } from "../tools/fleet/wire.js";

const roots: string[] = [];
const savedStoreDir = process.env["OVERSEER_STORE_DIR"];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (savedStoreDir === undefined) delete process.env["OVERSEER_STORE_DIR"];
  else process.env["OVERSEER_STORE_DIR"] = savedStoreDir;
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "fleet-attention-"));
  roots.push(root);
  return root;
}

const ITEM: AttentionItem = {
  id: "item-1",
  sessionId: "$215",
  sessionName: "worktree-schema-move",
  waitingSince: "2026-09-08T02:11:00.000Z",
  kind: "irreversible",
  evidence: { kind: "dialog", question: "Drop the sessions table?", options: ["Yes", "No"] },
  answerability: { kind: "phone" },
  duplicates: [],
};

const LIST: AttentionList = {
  kind: "list",
  items: [ITEM],
  sessionsScanned: 32,
  sessionsUnreadable: 0,
  scannedAt: "2026-09-08T12:40:00.000Z",
};

const WRITTEN_AT = "2026-09-08T12:41:07.000Z";

/**
 * A checkpoint on disk, spelled the way the Overseer spells one.
 *
 * Hand-written rather than produced by `openStore`, and that IS the point: this
 * reader's contract is the file. The fields it never looks at are included
 * because a real checkpoint has them, and one test below deliberately corrupts
 * them.
 */
function writeCheckpoint(root: string, over: Record<string, unknown> = {}): void {
  const checkpoint = {
    schema: 2,
    writtenAt: WRITTEN_AT,
    lastGoodSnapshotAt: "2026-09-08T12:41:00.000Z",
    cursor: { events: 456, bytes: 168_199 },
    heartbeat: {
      pid: 2_375_511,
      instanceId: "e410d37a-320b-4184-8202-e2f2e4b75b78",
      startedAt: "2026-09-08T12:00:00.000Z",
      lastTickAt: WRITTEN_AT,
      ticks: 28,
    },
    register: [{ key: "$215 none", tmuxId: "$215", name: "worktree-schema-move" }],
    attention: LIST,
    usage: { kind: "none", why: "no usage pass has run", at: WRITTEN_AT },
    ...over,
  };
  writeFileSync(join(root, "current.json"), `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
}

describe("readAttention", () => {
  it("hands back the published list, with the CHECKPOINT's clock beside it", () => {
    const root = tempRoot();
    writeCheckpoint(root);

    const feed = readAttention(root);
    expect(feed.kind).toBe("published");
    if (feed.kind !== "published") return;
    expect(feed.list).toEqual(LIST);
    /* The checkpoint's clock, not the list's. They come apart on purpose — the
       pass costs model calls and runs less often than a tick — and a fixture
       where they were equal would not notice them being swapped. The page reads
       both, because a stopped daemon and a stopped pass are different faults. */
    expect(feed.coordinatorWrittenAt).toBe(WRITTEN_AT);
    expect(feed.coordinatorWrittenAt).not.toBe(LIST.scannedAt);
  });

  it("takes three fields and ignores the five that are none of its business", () => {
    /* **THE REASON THIS FILE HAS ITS OWN PARSER.** The Overseer's
       `parseCheckpoint` fails the WHOLE checkpoint on one malformed register
       entry, deliberately, because the register is the thing there is no second
       copy of. Borrowing it would make a corrupt row in a part of the file we
       do not read render as *the inbox is unreadable* — and the inbox is fine.
       overseer-direction.md's cycle argument is the other half of the same
       decision. */
    const root = tempRoot();
    writeCheckpoint(root, {
      register: [{ this: "is not a register entry" }, 7, null],
      cursor: "not a cursor",
      heartbeat: null,
      usage: { kind: "a kind from 2027" },
      lastGoodSnapshotAt: 12,
    });
    expect(readAttention(root)).toMatchObject({ kind: "published", list: LIST });
  });

  it("says absent when there is no checkpoint at the path it looked at", () => {
    /* An empty directory, which is what a box with no Overseer looks like — and
       also what one with an Overseer pointed elsewhere looks like, which is why
       the arm is named after the observation rather than after the inference. */
    expect(readAttention(tempRoot())).toEqual({ kind: "checkpoint-absent" });
  });

  it("says unreadable, not absent, for a file that will not parse", () => {
    const root = tempRoot();
    writeFileSync(join(root, "current.json"), "{ this is not json", "utf8");

    const feed = readAttention(root);
    expect(feed.kind).toBe("checkpoint-unreadable");
    if (feed.kind !== "checkpoint-unreadable") return;
    expect(feed.why).toContain("not JSON");
  });

  it("says unreadable for an empty file, which is a coordinator caught mid-write", () => {
    const root = tempRoot();
    writeFileSync(join(root, "current.json"), "", "utf8");
    expect(readAttention(root)).toMatchObject({ kind: "checkpoint-unreadable" });
  });

  it("refuses a schema it does not know, rather than reading the fields it recognises", () => {
    /* **Checked as a number it knows, not as "not something else"** —
       overseer-direction.md, and the argument is not hypothetical: the bump from
       1 to 2 turned `statusSince` from a timestamp into a pair, and a tolerant
       reader would have drawn a blank age instead of an error. A field we read
       today can change meaning under a schema we have not seen. */
    for (const schema of [1, 3, "2", undefined, null]) {
      const root = tempRoot();
      writeCheckpoint(root, { schema });
      const feed = readAttention(root);
      expect(feed.kind, `schema ${JSON.stringify(schema)}`).toBe("checkpoint-unreadable");
      if (feed.kind !== "checkpoint-unreadable") continue;
      expect(feed.why).toContain("schema");
    }
  });

  it("refuses a checkpoint with no readable clock, rather than inventing one", () => {
    /* An inbox with no clock is the failure this whole panel exists to prevent:
       a list that stopped being produced looks exactly like a calm fleet. */
    const root = tempRoot();
    writeCheckpoint(root, { writtenAt: "8th September" });
    expect(readAttention(root)).toMatchObject({ kind: "checkpoint-unreadable" });
  });

  it("passes an `unknown` list straight through, so a not-yet-run pass stays a not-yet-run pass", () => {
    const root = tempRoot();
    const unknown: AttentionList = {
      kind: "unknown",
      why: "the gateway returned 429 before anything was judged",
      scannedAt: "2026-09-08T12:41:00.000Z",
    };
    writeCheckpoint(root, { attention: unknown });
    expect(readAttention(root)).toMatchObject({ kind: "published", list: unknown });
  });

  it("degrades a malformed list to `unknown`, never to an empty one", () => {
    /* Absent, malformed and *nothing needs you* are three different facts and
       only the third is a claim. A checkpoint is not replayed over a bad inbox —
       the next pass regenerates it — so the list degrades and the rest stands. */
    for (const attention of [
      "not an object",
      { kind: "list", items: [], sessionsScanned: 3, sessionsUnreadable: 0 },
      { kind: "list", items: {}, sessionsScanned: 3, sessionsUnreadable: 0, scannedAt: LIST.scannedAt },
      { kind: "list", items: [], sessionsScanned: -1, sessionsUnreadable: 0, scannedAt: LIST.scannedAt },
      { kind: "unknown", scannedAt: LIST.scannedAt },
      { kind: "an arm from 2027", scannedAt: LIST.scannedAt },
    ]) {
      const root = tempRoot();
      writeCheckpoint(root, { attention });
      expect(readAttention(root), JSON.stringify(attention)).toMatchObject({
        kind: "published",
        list: { kind: "unknown" },
      });
    }
  });

  it("refuses a list with no `sessionsUnreadable`, because zero is a claim", () => {
    /* **This is where we part company with the store's own parser**, which
       comments that a producer lacking the field "made no claim either way" and
       then returns 0 anyway. Zero is the strongest claim available: that every
       judgement the pass attempted succeeded. The whole reason the field exists
       is that an incomplete observation may not be read as a negative one, and
       reading its absence as zero is that mistake wearing the fix's name.

       It costs nothing that lasts — the pass runs every two minutes — and the
       page says so rather than showing a confident list. GPT Sol's finding 5.
       (The defect is the store's and is being reported to them; their file is
       not edited from here.) */
    const root = tempRoot();
    const { sessionsUnreadable: _dropped, ...withoutTheField } = LIST as Extract<AttentionList, { kind: "list" }>;
    writeCheckpoint(root, { attention: withoutTheField });

    const feed = readAttention(root);
    expect(feed).toMatchObject({ kind: "published", list: { kind: "unknown" } });
    if (feed.kind !== "published" || feed.list.kind !== "unknown") return;
    expect(feed.list.why).toContain("completeness");
    /* And the clock is the LIST's own, not the checkpoint's: the pass really did
       run at that instant, we just cannot say how complete it was. */
    expect(feed.list.scannedAt).toBe(LIST.scannedAt);
  });

  it("degrades the WHOLE list when one item will not parse", () => {
    /* Not "drop it and count", which is what the session rows get. An inbox of
       one out of two says *this is the one that needs you* and is then wrong
       about the other; a short inbox is a negative claim about everything not
       in it. */
    const root = tempRoot();
    writeCheckpoint(root, {
      attention: { ...LIST, items: [ITEM, { id: "half-a-card", sessionId: "$9" }] },
    });
    expect(readAttention(root)).toMatchObject({ kind: "published", list: { kind: "unknown" } });
  });

  it("refuses a dialog with no question, so it cannot arrive wearing the observed arm", () => {
    /* The one boundary the inbox is built to hold. `dialog` means the harness
       SAW a dialog and enumerated it; `prose` means we inferred it and may be
       wrong. A half-built dialog crossing here would be drawn as something
       observed, on the card whose evidence is meant to be checkable. */
    const root = tempRoot();
    writeCheckpoint(root, {
      attention: { ...LIST, items: [{ ...ITEM, evidence: { kind: "dialog" } }] },
    });
    expect(readAttention(root)).toMatchObject({ kind: "published", list: { kind: "unknown" } });
  });

  it("cannot throw, even on a relative OVERSEER_STORE_DIR", () => {
    /* **THE GUARD THAT PROTECTS SOMETHING OTHER THAN THIS FEATURE.** The
       Overseer's `storeRoot` throws on a relative override — correctly; it means
       two stores and two histories — and this runs while composing /api/state.
       `deps.publish()` in refresh.ts sits OUTSIDE the try/catch that guards
       collection, so a throw here escapes `refreshOnce` and ends the refresh
       loop: the dashboard then sits there wearing its last good timestamp,
       which is the exact silent stall `attemptedAt` was added to expose.

       So the fault must cost the inbox and nothing else, and it must not be
       `checkpoint-absent` — we did not establish that nothing was published, we
       failed to look. */
    process.env["OVERSEER_STORE_DIR"] = "relative/overseer";
    const feed = readAttention();
    expect(feed.kind).toBe("checkpoint-unreadable");
    if (feed.kind !== "checkpoint-unreadable") return;
    expect(feed.why).toContain("absolute");
  });

  it("cannot throw on a path that is a directory rather than a file", () => {
    const root = tempRoot();
    mkdirSync(join(root, "current.json"));
    expect(readAttention(root)).toMatchObject({ kind: "checkpoint-unreadable" });
  });

  it("refuses a checkpoint too large to load, rather than blocking the event loop on it", () => {
    /* Atomic rename means a reader never sees a torn file. It does nothing about
       an enormous one, and this read is synchronous on the loop serving the
       page. The real file is ~95KB; the ceiling is 4MB. */
    const root = tempRoot();
    writeFileSync(join(root, "current.json"), "x".repeat(5 * 1024 * 1024), "utf8");
    const feed = readAttention(root);
    expect(feed.kind).toBe("checkpoint-unreadable");
    if (feed.kind !== "checkpoint-unreadable") return;
    expect(feed.why).toContain("ceiling");
  });
});

describe("the seam between the two tools", () => {
  it("has the dashboard importing the Overseer's STORE from nowhere", () => {
    /* **THE CYCLE THIS READER EXISTS TO AVOID, checked rather than remembered.**
     * docs/project/overseer-direction.md: *"`tools/overseer/` already imports
     * `collect.ts` and `status.ts` from `tools/fleet/`, so a `tools/fleet/` that
     * imported `readCheckpoint` would close a cycle between the two things this
     * seam exists to keep apart. The file is the contract; the function is one
     * implementation of reading it."*
     *
     * The first version of this stage imported `readCheckpoint`, and it looked
     * entirely reasonable — which is why the rule needs something that fails
     * rather than a paragraph somebody has to have read.
     *
     * **Scoped to `store.ts`, and the scope was corrected by a measurement.**
     * The first version of this test banned every `../overseer/` import and went
     * red on `health-history.ts`, which imports `jsonl.ts` and `lock.ts` on
     * purpose and says so at length: *"The lock is `tools/overseer/lock.ts`'s,
     * imported, not a copy."* Those are leaf utilities that import nothing back,
     * so they close no cycle and duplicate no judgement. The store is the one
     * that does both — it pulls usage, memory, diff, lock and log in behind it,
     * and it holds the Overseer's own opinion about what a bad checkpoint means.
     *
     * A text scan rather than a graph walk: the edge is one directory deep and
     * tests/fleet-imports.test.ts already owns the transitive walking.
     */
    const dir = new URL("../tools/fleet/", import.meta.url);
    const offenders: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".ts")) continue;
      const source = readFileSync(new URL(name, dir), "utf8");
      if (/from\s+"\.\.\/overseer\/store\.js"/.test(source)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});

describe("the field on the payload", () => {
  it("carries what it is given, unchanged, and through the wire", () => {
    const root = tempRoot();
    writeCheckpoint(root);
    const state = fleetState(null, null, null, 60_000, true, null, readAttention(root));
    expect(state.attention).toMatchObject({ kind: "published", list: LIST });
    /* The only form the browser ever sees. A `readonly` array that survives a
       function call has not been shown to survive a serialisation. */
    const wire = JSON.parse(JSON.stringify(state)) as {
      attention: { list: { items: { evidence: { question: string } }[] } };
    };
    expect(wire.attention.list.items[0]?.evidence.question).toBe("Drop the sessions table?");
  });
});
