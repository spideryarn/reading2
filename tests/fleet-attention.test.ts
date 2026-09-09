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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

  it("refuses a list that could not judge more sessions than it scanned", () => {
    /* A count of failures larger than the count of attempts is corruption
       rather than a reading. It has to be refused rather than clamped, because
       the page subtracts one from the other to say how many WERE judged and a
       negative there would be drawn on screen. GPT Sol's C1. */
    const root = tempRoot();
    writeCheckpoint(root, {
      attention: { ...LIST, items: [], sessionsScanned: 3, sessionsUnreadable: 4 },
    });
    const feed = readAttention(root);
    expect(feed).toMatchObject({ kind: "published", list: { kind: "unknown" } });
    if (feed.kind !== "published" || feed.list.kind !== "unknown") return;
    expect(feed.list.why).toContain("more than it scanned");
  });

  it("refuses a list scanned after the checkpoint that carries it, because that clock is one clock", () => {
    /* **A FUTURE `scannedAt` IS A PERMANENTLY FRESH ONE.** The page's staleness
       check is `now − scannedAt`, and a timestamp in the future stays "0s ago"
       for as long as it stays in the future — so an empty list looks calm for
       exactly as long as the fault lasts, which is the failure the whole panel
       is about. This pair is checkable HERE and not on the page: the Overseer
       stamps both from one process, so there is no skew to tolerate.
       GPT Sol's C2, the server half. */
    const root = tempRoot();
    const after = new Date(Date.parse(WRITTEN_AT) + 60_000).toISOString();
    writeCheckpoint(root, { attention: { ...LIST, scannedAt: after } });
    const feed = readAttention(root);
    expect(feed).toMatchObject({ kind: "published", list: { kind: "unknown" } });
    if (feed.kind !== "published" || feed.list.kind !== "unknown") return;
    expect(feed.list.why).toContain("after");

    /* Equal is ORDINARY, not incoherent: the store stamps a not-yet-run list
       with the checkpoint's own instant, and refusing that would turn every
       fresh Overseer into an unreadable one. */
    const same = tempRoot();
    writeCheckpoint(same, { attention: { ...LIST, scannedAt: WRITTEN_AT } });
    expect(readAttention(same)).toMatchObject({ kind: "published", list: { kind: "list" } });
  });

  it("refuses a BLANK string wherever a card would draw one, not just a missing one", () => {
    /* `typeof x === "string"` accepted `""`, so `{kind: "dialog", question: "",
       options: []}` crossed the evidence boundary and arrived under the
       mechanical, observed heading with nothing in it — wire.ts names that
       exact value as the one that must not cross. Whitespace counts, because on
       screen it is the same thing. GPT Sol's C4. */
    for (const attention of [
      { ...LIST, items: [{ ...ITEM, id: "" }] },
      { ...LIST, items: [{ ...ITEM, sessionId: "  " }] },
      { ...LIST, items: [{ ...ITEM, sessionName: "" }] },
      { ...LIST, items: [{ ...ITEM, evidence: { kind: "dialog", question: "", options: [] } }] },
      { ...LIST, items: [{ ...ITEM, evidence: { kind: "dialog", question: "Drop it?", options: ["Yes", ""] } }] },
      { ...LIST, items: [{ ...ITEM, evidence: { kind: "prose", excerpt: "", why: "it stopped" } }] },
      { ...LIST, items: [{ ...ITEM, evidence: { kind: "prose", excerpt: "…and stopped", why: " " } }] },
      {
        ...LIST,
        items: [{ ...ITEM, duplicates: [{ sessionId: "", sessionName: "x", waitingSince: ITEM.waitingSince }] }],
      },
      {
        ...LIST,
        items: [{ ...ITEM, duplicates: [{ sessionId: "$9", sessionName: "", waitingSince: ITEM.waitingSince }] }],
      },
      /* **THE TWO THE FIRST PASS MISSED, AND THEY ARE THE ONES WITH THE LEAST TO
         FALL BACK ON.** The brief enumerated nine fields and these were not
         among them; the implementer's own report said so rather than letting it
         pass, which is the only reason they are here. An `answerability.why` is
         the ENTIRE content of the two arms that carry one. */
      { ...LIST, items: [{ ...ITEM, answerability: { kind: "needs-a-screen", why: "" } }] },
      { ...LIST, items: [{ ...ITEM, answerability: { kind: "unknown", why: "   " } }] },
    ]) {
      const root = tempRoot();
      writeCheckpoint(root, { attention });
      expect(readAttention(root), JSON.stringify(attention)).toMatchObject({
        kind: "published",
        list: { kind: "unknown" },
      });
    }
  });

  it("refuses an `unknown` list whose reason is blank, because the reason IS the output", () => {
    /* This arm draws "no ranked list: {why}" and has nothing else — so a blank
       `why` renders a sentence that stops at its colon, which reads as the page
       being broken rather than as the coordinator not having judged yet. It is
       the arm with the least to fall back on and it was the one still accepting
       `""` after C4's first pass. */
    for (const why of ["", "  "]) {
      const root = tempRoot();
      writeCheckpoint(root, { attention: { kind: "unknown", why, scannedAt: LIST.scannedAt } });
      const feed = readAttention(root);
      expect(feed, JSON.stringify(why)).toMatchObject({ kind: "published", list: { kind: "unknown" } });
      const list = (feed as { list: { kind: "unknown"; why: string } }).list;
      expect(list.why).not.toBe(why);
      expect(list.why.trim()).not.toBe("");
    }
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

  it("says unreadable, not absent, when it never found out whether a checkpoint is there", () => {
    /* **ONLY `ENOENT` ESTABLISHES ABSENCE.** Every open failure used to become
       `checkpoint-absent`, so a permissions error rendered as *no checkpoint has
       been published here* — a positive claim about the box manufactured out of
       a failure to look, and the page draws that one without a caveat. GPT Sol's
       C3.

       `ENOTDIR` is the errno used here because it is deterministic and does not
       depend on who is running the suite: a `chmod 000` proves nothing under a
       uid that ignores it, and `EACCES` is the case this test stands in for. */
    const root = tempRoot();
    writeFileSync(join(root, "not-a-directory"), "hello", "utf8");
    const feed = readAttention(join(root, "not-a-directory"));
    expect(feed.kind).toBe("checkpoint-unreadable");
    if (feed.kind !== "checkpoint-unreadable") return;
    expect(feed.why).toContain("ENOTDIR");
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

/**
 * **THE TWO OVERSEER MODULES `tools/fleet/` IS ALLOWED TO IMPORT, written down
 * so that adding a third is a decision somebody makes in a diff.**
 *
 * Both are leaf utilities that import nothing back, so they close no cycle and
 * duplicate no judgement, and `health-history.ts` says at length why it uses
 * them rather than copying them: *"The lock is `tools/overseer/lock.ts`'s,
 * imported, not a copy."*
 *
 * Everything else in `tools/overseer/` reaches the store — directly, or through
 * one hop of `usage.ts`, `observation.ts`, `memory.ts` — and the store is the
 * thing this seam exists to keep out: it pulls usage, memory, diff, lock and log
 * in behind it, and it holds the Overseer's own opinion about what a bad
 * checkpoint means.
 *
 * **THREE MORE ADDED ON 2026-09-09, for execution identity, and they pass the
 * same test rather than being exceptions to it.** `work.ts`, `work-probe.ts`
 * and `harness.ts` walk a process table and name what is holding a pane. Their
 * whole closure is `work.ts` → `fleet/claude-argv.js` (a true leaf),
 * `harness.ts` → `claude-argv.js` + `wire.js` (types only) + `work.js`, and
 * `work-probe.ts` → `node:child_process` + `work.js`. **None reaches the
 * store**, which is what this seam exists to keep out, and none closes a cycle.
 * `tools/fleet/execution-identity.ts` imports them because the alternative was
 * a second copy of a process-tree walk that is tested against captures taken
 * off this box.
 *
 * **The count is not the rule; the store is.** Five is not more permissive than
 * two in the way that matters — it is two more leaves on the safe side of the
 * same line. The Overseer took this decision explicitly rather than it being
 * slipped in with the diff.
 *
 * **AND THE REAL END STATE IS A MOVE, NOT A LONGER LIST.** Those three modules
 * are about panes and processes, which is the fleet's own domain — the Overseer
 * uses them for *interpretation*, which is a consumer relationship, not
 * ownership. Moving them under `tools/fleet/` would take this list back to two
 * and put each module where its subject lives. It is named in
 * docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md as work for a
 * later stage, and it is too large to do inside one.
 */
/**
 * **A MAP, SO A NEW ENTRY CANNOT BE ADDED WITHOUT SAYING WHY IT QUALIFIES.**
 *
 * It was an array of five bare strings, with the reasons in the prose above —
 * and a reader who scrolled to the list saw five names and no way to tell which
 * argument covered which. The `usage-limits-tab` session made the point while
 * writing this rule into `overseer-direction.md`: the list's LENGTH is a
 * consequence of the store rule rather than a limit of its own, and nothing in
 * a bare array says that to anybody.
 *
 * A value is not optional here, so the next addition answers for itself at the
 * point of being added rather than in a paragraph somebody has to find.
 */
const OVERSEER_MODULES_FLEET_MAY_IMPORT_WHY: Record<string, string> = {
  "jsonl.ts": "a leaf: append, truncate-to-last-line, atomic write. Imports nothing back.",
  "lock.ts": "a leaf: take, hold, release. `health-history.ts` uses it rather than copying it, and says so.",
  "work.ts": "the pure process-table parser and classifier. Its whole closure is `fleet/claude-argv.js`, which is a true leaf.",
  "work-probe.ts": "the `ps` adapter for the above. Closure: `node:child_process` + `work.ts`.",
  "harness.ts":
    "names what is holding a pane, purely, over an injected table. Closure: `claude-argv.js` + `wire.js` (types only) + `work.ts`.",
  /* Added 2026-09-09 by `usage-limits-tab`, NOT by the session that introduced
     the import — `routes-idea-queue.ts` landed on dev and left this list red,
     and its author's session had closed. Which is the mechanism working: the
     equality assertion turned a silent widening into a decision somebody had to
     take, and the closure below is the answer it was asking for. */
  "idea-queue.ts":
    "the queue's own file discipline. Closure: `node:` builtins, `fleet/wire.js` (types only), and `jsonl.ts` + `lock.ts`, which are already here. No store.",
  "idea-queue-wait.ts":
    "pure arithmetic over the queue's items — depth, throughput, how long one has waited. Closure: `fleet/wire.js` (types only) + `idea-queue.ts`.",
  /* Added 2026-09-09 by `questions-mode`, and — like `idea-queue.ts` above —
     NOT by the session that introduced the import. The Decisions tab landed on
     `dev` at `256d59e5`, left this list red, and that session had closed by the
     time the first recorded readiness run found it. Twice now the equality
     assertion has turned a silent widening into a decision somebody had to
     take, which is the whole argument for asserting the SET rather than
     containment: a containment check would have absorbed both without a word.

     The closure was read rather than assumed: `node:crypto`, `node:fs`,
     `node:os`, `node:path`, `fleet/wire.js` (types only), and `jsonl.ts` +
     `lock.ts`, both already permitted here. No store, and nothing new. */
  "decisions.ts":
    "the decision record's own file discipline — append, read, repair — for the Decisions tab. Closure: `node:` builtins, `fleet/wire.js` (types only), and `jsonl.ts` + `lock.ts`, which are already here. No store.",
};

const OVERSEER_MODULES_FLEET_MAY_IMPORT = Object.keys(OVERSEER_MODULES_FLEET_MAY_IMPORT_WHY);

/** Every `.ts`/`.tsx` file under a directory, recursively. Build output excluded. */
/**
 * Every `tools/overseer/` file reachable from a starting directory, by name.
 *
 * Extracted from the guard below so that the WALKER itself can be tested on a
 * synthetic tree. That matters more than it looks: the guard's whole value is
 * the transitive case, and the obvious demonstration — add an import to
 * `tools/overseer/lock.ts` and watch it fail — means mutating a file another
 * session owns in a tree we share, where a peer committing by pathspec during
 * those seconds would commit the mutation into their file. A fixture proves the
 * same property and touches nobody.
 *
 * `seen` comes back too, because a walker that resolved nothing would report an
 * empty `reached` and look exactly like a clean bill of health.
 */
function overseerClosure(fromDir: string, overseerDir: string): { reached: Set<string>; seen: Set<string> } {
  const reached = new Set<string>();
  const seen = new Set<string>();
  const queue = sourceFiles(fromDir);
  while (queue.length > 0) {
    const path = queue.pop();
    if (path === undefined || seen.has(path)) continue;
    seen.add(path);
    if (path.startsWith(overseerDir)) reached.add(basename(path));
    for (const specifier of relativeImports(readFileSync(path, "utf8"))) {
      const resolved = resolveSource(dirname(path), specifier);
      if (resolved !== null) queue.push(resolved);
    }
  }
  return { reached, seen };
}

/**
 * Relative import specifiers, ignoring anything inside a comment.
 *
 * **Comment lines are skipped, and that is not fussiness.** These files carry
 * long headers that name modules in prose — this very file does — and a raw
 * regex over the whole text reads `"../overseer/store.js"` in a docstring as an
 * import, which would fail the guard over a sentence. Sol raised it on
 * re-review. Line-oriented rather than a parser: a specifier only counts on a
 * line that is not comment-led, which is every real import in this tree.
 */
function relativeImports(source: string): string[] {
  const found: string[] = [];
  for (const line of source.split("\n")) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) continue;
    for (const match of line.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
      const specifier = match[1];
      if (specifier !== undefined) found.push(specifier);
    }
  }
  return found;
}

/**
 * A specifier to a file on disk, or null when it does not name one here.
 *
 * ESM spells a TypeScript import `./jsonl.js`, so the extension has to be put
 * back before the file exists. Anything that does not resolve — a bare package,
 * a `.css`, a path this walk does not care about — is null rather than a throw:
 * the walk is a bound on what is REACHED, and a specifier that reaches nothing
 * in this repo reaches no Overseer module either.
 */
function resolveSource(fromDir: string, specifier: string): string | null {
  const base = resolve(fromDir, specifier);
  const candidates = base.endsWith(".js")
    ? [`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`, base]
    : [base, `${base}.ts`, `${base}.tsx`];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      /* Bundled output re-states every import in a form no rule can read, and
         `node_modules` is nobody's decision. */
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      found.push(...sourceFiles(path));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      found.push(path);
    }
  }
  return found;
}

describe("the seam between the two tools", () => {
  /* **THE NAME NO LONGER CARRIES A COUNT, DELIBERATELY.** It said "exactly two"
     while the list held eight — written when there were two, and stale by the
     time three separate sessions had added an entry apiece. A count in a name is
     a second copy of the thing the assertion already states, and it is the copy
     nobody updates: the list below is the count, and it answers for itself. */
  it("imports only the Overseer modules that were argued for, and every one of them was", () => {
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
     * **AN ALLOWLIST RATHER THAN A BAN ON `store.js`, and the difference is the
     * whole value.** The previous version scanned the immediate `tools/fleet/*.ts`
     * for a double-quoted `from "../overseer/store.js"`, so single quotes, a
     * dynamic `import()`, anything under `web/src/`, and — the one that matters —
     * ANY INTERMEDIATE MODULE all walked past it. A new `import { … } from
     * "../overseer/usage.js"` reaches the store transitively and would have been
     * waved through by a denylist naming only the destination. Asserting the SET
     * fails on it, and fails on the next one too, without anybody having to
     * enumerate what reaches the store. GPT Sol's C6, 2026-09-08.
     *
     * Equality rather than containment on purpose: removing one of the two is
     * also a change worth seeing, and the list above carries the reason each is
     * permitted, so a diff that extends it is a diff that answers for it.
     *
     * **A CLOSURE, NOT A SCAN OF WHAT IS WRITTEN IN THESE FILES — and the first
     * version was the scan.** It collected only specifiers spelled inside
     * `tools/fleet/`, so the day `lock.js` grew an import of `usage.js` the store
     * would have become reachable from the dashboard while this test stayed
     * green: a guard on the first hop of the very thing it exists to bound.
     * `tests/fleet-imports.test.ts` cannot cover it either — that walker starts
     * from everything under `tools/`, not from this directory. GPT Sol's C6 on
     * re-review, after his C6 on the first pass had already replaced a denylist
     * here. The finding survived its own fix, which is the reason a fix gets
     * re-reviewed rather than marked closed.
     *
     * So: start at every file under `tools/fleet/`, follow every relative import
     * INCLUDING through the Overseer modules reached, and assert the set of
     * `tools/overseer/*` files in that closure. Two hops or twenty, it is the
     * same question — what can this tool reach.
     */
    const fleetDir = fileURLToPath(new URL("../tools/fleet/", import.meta.url));
    const overseerDir = fileURLToPath(new URL("../tools/overseer/", import.meta.url));
    const { reached: imported, seen } = overseerClosure(fleetDir, overseerDir);
    /* The scan is only evidence while it is still finding the files: a rename of
       the directory, or a walker that silently returned nothing, would leave an
       empty set that passes nothing and looks like a clean bill of health. */
    expect(sourceFiles(fleetDir).length).toBeGreaterThan(20);
    /* The walk is only evidence while it is still following edges. A resolver
       that quietly returned null for everything would visit the fleet's own
       files, reach no Overseer module, and report a clean bill of health — so
       assert it crossed into `tools/overseer/` at all, and that it went deeper
       than the files it started from. */
    expect(seen.size).toBeGreaterThan(sourceFiles(fleetDir).length);
    expect(imported.size).toBeGreaterThan(0);
    expect([...imported].sort()).toEqual([...OVERSEER_MODULES_FLEET_MAY_IMPORT].sort());
  });

  it("follows a hop THROUGH an allowed module, which is the case it was rewritten for", () => {
    /* The first version of this guard collected only specifiers written inside
       `tools/fleet/`, so a forbidden module reached VIA a permitted one stayed
       invisible. That is the shape the rewrite exists to catch, and asserting it
       against the real tree proves nothing: the real tree does not have the
       problem, and would pass either way. So build the shape.

           fleet/entry.ts  ->  ../overseer/lock.js  ->  ./store.js

       A direct-import scan sees `lock.js` and stops. A closure sees both, and
       the guard above then fails on the set — which is the behaviour that keeps
       `tools/fleet/` from reaching the Overseer's store through a side door. */
    const root = mkdtempSync(join(tmpdir(), "closure-"));
    const fleet = join(root, "fleet");
    const overseer = join(root, "overseer");
    mkdirSync(fleet);
    mkdirSync(overseer);
    writeFileSync(join(fleet, "entry.ts"), 'import { hold } from "../overseer/lock.js";\nexport { hold };\n');
    writeFileSync(join(overseer, "lock.ts"), 'import { append } from "./store.js";\nexport const hold = append;\n');
    writeFileSync(join(overseer, "store.ts"), "export const append = 1;\n");

    const { reached } = overseerClosure(fleet, overseer);
    expect([...reached].sort()).toEqual(["lock.ts", "store.ts"]);

    /* And the comment-blindness, in the same tree: a docstring naming the module
       is prose, not an edge. Without this the guard could fail over a sentence —
       which is how a guard gets deleted rather than fixed. */
    writeFileSync(
      join(fleet, "prose.ts"),
      '/** See "../overseer/usage.js" for why. */\n// import { x } from "../overseer/diff.js";\nexport const n = 1;\n',
    );
    expect([...overseerClosure(fleet, overseer).reached].sort()).toEqual(["lock.ts", "store.ts"]);

    rmSync(root, { recursive: true, force: true });
  });
});

describe("the field on the payload", () => {
  it("carries what it is given, unchanged, and through the wire", () => {
    const root = tempRoot();
    writeCheckpoint(root);
    const state = fleetState(null, null, null, 60_000, true, null, readAttention(root), { kind: "not-asked" }, {
      kind: "not-asked",
    });
    expect(state.attention).toMatchObject({ kind: "published", list: LIST });
    /* The only form the browser ever sees. A `readonly` array that survives a
       function call has not been shown to survive a serialisation. */
    const wire = JSON.parse(JSON.stringify(state)) as {
      attention: { list: { items: { evidence: { question: string } }[] } };
    };
    expect(wire.attention.list.items[0]?.evidence.question).toBe("Drop the sessions table?");
  });
});


describe("the evidence disclosure sits above the card's tap overlay", () => {
  /**
   * **A PARTIAL DETECTOR FOR A BUG NO UNIT TEST CAN SEE, and it says so rather
   * than pretending otherwise.**
   *
   * The attention card is a stretched link: `.session-open::after` covers it
   * `inset: 0`, and a positioned element paints above in-flow content whatever
   * the DOM order says. So the evidence disclosure inside it received NO pointer
   * input at all — measured 2026-09-08 in Chrome on the box, `elementFromPoint`
   * at every corner and the centre of its `<summary>` returned
   * `button.session-open`, Playwright refused the click as intercepted, and a
   * real wheel over the opened `<pre>` left `scrollTop` at 0.
   *
   * **Keyboard focus was unaffected**, so Tab+Enter opened it and every unit test
   * passed. jsdom has no layout, no paint order and no `elementFromPoint` worth
   * the name, so nothing in this suite could have caught it and nothing in this
   * suite can catch its return. The real check is a browser.
   *
   * What this CAN do is fail if either half of the fix is deleted, which is the
   * likely way it comes back — a class dropped in a refactor, or the rule tidied
   * out of a stylesheet nobody connects to a component. Both halves, or neither.
   */
  it("keeps the class and the rule that lift it, which are useless apart", () => {
    const panel = readFileSync(new URL("../tools/fleet/web/src/AttentionPanel.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../tools/fleet/web/src/tailwind.css", import.meta.url), "utf8");

    expect(panel).toContain('<details className="attention-evidence');
    expect(css).toMatch(/\.session-card \.attention-evidence[\s\S]{0,80}z-index:\s*1;/);
  });
});
