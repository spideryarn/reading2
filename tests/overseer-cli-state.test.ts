/**
 * The `overseer` CLI's two lists, and the one substitution that would ruin them.
 *
 * **Nearly every test here is about `absent` versus `unusable`.** The list of
 * sessions the Overseer is looking after is the input to `tick` (whose turns do
 * I read?), `closeout` (whose name do I drop?) and `dispatch` (whose name do I
 * add?). If a file this build cannot parse were read as an empty list, all three
 * would carry on cheerfully: the tick would print nothing and look like a quiet
 * fleet, and the first write afterwards would overwrite the list it could not
 * read. That is docs/reusable/silent-success.md exactly, so it is the thing
 * these tests are pointed at rather than round-tripping.
 *
 * The pure edits are tested separately from the disk, the way `health.ts` and
 * `pause.ts` are split, so the join (`cliStateForWriting`) can be tested as
 * itself rather than inferred from its parts —
 * docs/postmortems/260908b-the-parts-were-all-tested-and-none-of-the-joins-were.md.
 */
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import {
  CLI_STATE_FILE,
  CLI_STATE_LOCK_FILE,
  CLI_STATE_SCHEMA,
  isCanonicalInstant,
  updateCliState,
  EMPTY_CLI_STATE,
  addMine,
  cliStateForWriting,
  cliStatePath,
  parseCliState,
  readCliState,
  recordPause,
  recordResume,
  removeMine,
  whyNotASessionName,
  writeCliState,
  type CliState,
} from "../tools/overseer/cli-state.js";
import { runMine } from "../scripts/overseer.js";

/** The worktree root, so a spawned child resolves `tsx` and the repo's modules from the right place. */
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    try {
      chmodSync(root, 0o755);
    } catch {
      /* it was never made read-only */
    }
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-cli-state-test-"));
  roots.push(root);
  return root;
}

function put(root: string, text: string): void {
  writeFileSync(cliStatePath(root), text, "utf8");
}

describe("an unreadable state file is not an empty one", () => {
  test("no file at all is absent, and absent is a legitimate empty state", () => {
    const root = tempRoot();
    expect(readCliState(root)).toEqual({ kind: "absent" });
    const forWriting = cliStateForWriting(root);
    expect(forWriting).toEqual({ ok: true, state: EMPTY_CLI_STATE });
  });

  test("bytes this build cannot parse are UNUSABLE, and no writer may proceed", () => {
    const root = tempRoot();
    put(root, "{not json");
    const read = readCliState(root);
    expect(read.kind).toBe("unusable");

    const forWriting = cliStateForWriting(root);
    expect(forWriting.ok).toBe(false);
    // The refusal has to name the file, because the Overseer reads this under
    // time pressure and "could not be read" alone does not say what to go and look at.
    if (!forWriting.ok) expect(forWriting.why).toContain(CLI_STATE_FILE);
  });

  test("a JSON array is not a state object, however well-formed", () => {
    const root = tempRoot();
    put(root, '["overseer-cli"]');
    expect(readCliState(root).kind).toBe("unusable");
  });

  test("a name in `mine` that is not a session name makes the whole file unusable", () => {
    // NOT "skip the bad entry and carry on": a dropped name is a worktree nobody
    // closes out, and the entry that got dropped is the one nobody sees.
    const root = tempRoot();
    put(root, JSON.stringify({ mine: ["fine-name", "Not A Name"], paused: [] }));
    const read = readCliState(root);
    expect(read.kind).toBe("unusable");
    if (read.kind === "unusable") expect(read.why).toContain("Not A Name");
  });

  test("a paused entry missing its instant makes the file unusable, not the session un-paused", () => {
    const root = tempRoot();
    put(root, JSON.stringify({ mine: [], paused: [{ session: "some-agent", door: "steer", why: "usage 71%" }] }));
    const read = readCliState(root);
    expect(read.kind).toBe("unusable");
    if (read.kind === "unusable") expect(read.why).toContain("some-agent");
  });

  test("a paused entry with an unknown door is unusable rather than defaulted", () => {
    const root = tempRoot();
    put(
      root,
      JSON.stringify({ mine: [], paused: [{ session: "some-agent", at: "2026-09-09T08:00:00.000Z", door: "carrier-pigeon", why: "" }] }),
    );
    expect(readCliState(root).kind).toBe("unusable");
  });

  test("A NULL FIELD IS NOT AN EMPTY ONE — the fail-open this file existed to prevent", () => {
    // GPT Sol's P0 on Stage 1, and the sharpest finding of the review: `?? []`
    // turned `{"mine": null}` into valid empty state, so `mine list` said
    // "nothing is being looked after" and the next `mine add` replaced the
    // malformed file. The module's whole guarantee, defeated by the one line
    // that did not think of itself as a parse.
    //
    // MUTATION: put `?? []` back on either field and this goes red.
    for (const text of ['{"mine": null, "paused": null}', '{"mine": [], "paused": null}', '{"mine": null, "paused": []}']) {
      const root = tempRoot();
      put(root, text);
      expect(readCliState(root).kind, text).toBe("unusable");
    }
  });

  test("a missing key is unusable too — there is no writer that omits one", () => {
    // This test used to assert the opposite ("a first write need not carry
    // both") and was wrong: `writeCliState` takes a complete CliState and always
    // writes both arrays, so a file missing one was never legitimate. A test
    // asserting the lenient behaviour is how a hole gets a certificate.
    for (const text of ["{}", '{"mine": []}', '{"paused": []}']) {
      const root = tempRoot();
      put(root, text);
      expect(readCliState(root).kind, text).toBe("unusable");
    }
  });
});

describe("writing", () => {
  test("round-trips through the disk", () => {
    const root = tempRoot();
    const state: CliState = {
      mine: ["agent-one", "agent-two"],
      paused: [{ session: "agent-two", at: "2026-09-09T08:00:00.000Z", door: "steer", why: "five-hour window at 71%" }],
    };
    expect(writeCliState(root, state)).toEqual({ ok: true });
    expect(readCliState(root)).toEqual({ kind: "read", state });
  });

  test("the temp file it renames from carries this process's pid", () => {
    // Two `overseer mine add` runs in the same second is an ordinary tick, and a
    // shared `${path}.tmp` would have each writing into the other's half-written
    // file. The rename is the atomic step; this is about what precedes it.
    const root = tempRoot();
    expect(writeCliState(root, EMPTY_CLI_STATE)).toEqual({ ok: true });
    const written = readFileSync(cliStatePath(root), "utf8");
    expect(JSON.parse(written)).toEqual({ schema: CLI_STATE_SCHEMA, ...EMPTY_CLI_STATE });
    // and nothing is left behind
    expect(() => readFileSync(`${cliStatePath(root)}.${process.pid}.tmp`, "utf8")).toThrow();
  });

  test("a directory it cannot write to is a refusal with a reason, never a silent no-op", () => {
    const root = tempRoot();
    chmodSync(root, 0o500);
    const out = writeCliState(root, { mine: ["agent-one"], paused: [] });
    // Running as root would make this writable anyway; then the write genuinely
    // succeeded and there is nothing to assert. Said out loud rather than skipped
    // silently, because a test that passes both ways is not a check.
    if (process.getuid?.() === 0) {
      expect(out).toEqual({ ok: true });
      return;
    }
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.why).toContain(CLI_STATE_FILE);
  });
});

describe("two writers at once", () => {
  test("A LOST UPDATE IS THE FAILURE, and the lock is what stops it", async () => {
    // GPT Sol's P1-1. Rename-atomicity stops a TORN file and does nothing about
    // this: two processes read {mine:["a"]}, one adds "b" and one adds "c", both
    // rename, and the survivor holds a,b or a,c with nothing said. The first
    // draft of cli-state.ts accepted that in a comment.
    //
    // MUTATION TO CHECK: delete the takeLock/releaseLock pair in
    // `updateCliState` and this test goes red — with the read-modify-write
    // unguarded, the two children interleave and one name disappears.
    //
    // Real child processes, not two calls in one process: an in-process test
    // shares a module and cannot see a file lock at all.
    const root = tempRoot();
    writeCliState(root, { mine: ["agent-a"], paused: [] });

    // A BARRIER, NOT A SLEEP. The first version of this test slept 60ms in each
    // child and passed under the mutation — the read-modify-write is fast enough
    // that two processes serialise by luck, so the test proved nothing. Sol's
    // review asked for "two barrier-synchronised child processes" and this is
    // why. The barrier runs inside `edit`, which the lock already holds open, so
    // no seam is added to the production code for the test's benefit:
    //
    //   A: take lock → read → touch a-read → WAIT for b-read → write → release
    //   B: WAIT for a-read → take lock → read → touch b-read → write → release
    //
    // A waits for B to have READ, not merely to have started: waiting on "B has
    // started" left a window in which A could finish first and B would then read
    // the new state and lose nothing, which is how the second draft of this test
    // also passed under the mutation.
    //
    // Unlocked, B's read happens inside A's window and one name is lost.
    // Locked, B cannot get in at all until A releases; A's wait times out, and
    // B then reads what A wrote. The timeout is the locked path's cost and it is
    // why this test has a long budget.
    const url = JSON.stringify(pathToFileURL(join(REPO, "tools/overseer/cli-state.ts")).href);
    const common = [
      `const { updateCliState, addMine } = await import(${url});`,
      "const fs = await import('node:fs');",
      "const [root, name] = process.argv.slice(2);",
      "const p = (f) => `${root}/${f}`;",
      "const waitFor = async (f) => { for (let i = 0; i < 400; i += 1) { if (fs.existsSync(p(f))) return true; await new Promise((r) => setTimeout(r, 10)); } return false; };",
      "const attempt = async (edit) => { let last = null; for (let i = 0; i < 800; i += 1) { const out = updateCliState(root, edit); if (out.ok) return true; last = out.why; await new Promise((r) => setTimeout(r, 10)); } console.error(`${name} gave up: ${last}`); return false; };",
    ].join("\n");

    const first = join(root, "first.mjs");
    writeFileSync(
      first,
      [
        common,
        // Synchronous inside `edit`, because `updateCliState` is synchronous and
        // the whole point is to hold the read open across B's attempt.
        "const holdOpen = () => { const until = Date.now() + 4000; while (Date.now() < until) { if (fs.existsSync(p('b-read'))) return; } };",
        "const ok = await attempt((s) => { fs.writeFileSync(p('a-read'), ''); holdOpen(); return addMine(s, name).state; });",
        "process.exit(ok ? 0 : 1);",
      ].join("\n"),
      "utf8",
    );

    const second = join(root, "second.mjs");
    writeFileSync(
      second,
      [
        common,
        "if (!(await waitFor('a-read'))) { console.log('the first writer never read'); process.exit(1); }",
        // A refusal is the lock working; retrying is what a caller does with it,
        // and a test that treated a refusal as a pass would prove nothing.
        // `b-read` is written INSIDE the edit, so it means "B has read", which is
        // the fact A is waiting on.
        "const ok = await attempt((s) => { fs.writeFileSync(p('b-read'), ''); return addMine(s, name).state; });",
        "process.exit(ok ? 0 : 1);",
      ].join("\n"),
      "utf8",
    );

    const run = (script: string, name: string): Promise<number> =>
      new Promise((resolve) => {
        const child = spawn("npx", ["tsx", script, root, name], { cwd: REPO, stdio: "inherit" });
        child.on("exit", (code) => resolve(code ?? 1));
      });
    const [b, c] = await Promise.all([run(first, "agent-b"), run(second, "agent-c")]);
    expect(b).toBe(0);
    expect(c).toBe(0);

    const read = readCliState(root);
    expect(read.kind).toBe("read");
    if (read.kind === "read") expect([...read.state.mine].sort()).toEqual(["agent-a", "agent-b", "agent-c"]);
  }, 60_000);

  test("a lock held by a live process is a named refusal, not a hang and not a silent overwrite", () => {
    const root = tempRoot();
    // A lock file claiming THIS process, which is certainly alive.
    writeFileSync(
      join(root, CLI_STATE_LOCK_FILE),
      `${JSON.stringify({ pid: process.pid, instanceId: "someone-else", hostname: "here", startedAt: new Date().toISOString() })}\n`,
      "utf8",
    );
    const out = updateCliState(root, (s) => addMine(s, "agent-b").state);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.why).toContain(CLI_STATE_LOCK_FILE);
    // and nothing was written
    expect(readCliState(root)).toEqual({ kind: "absent" });
  });

  test("an edit may refuse, and then nothing is written", () => {
    const root = tempRoot();
    writeCliState(root, { mine: ["agent-a"], paused: [] });
    const out = updateCliState(root, () => ({ refuse: "not today" }));
    expect(out).toEqual({ ok: false, why: "not today" });
    const read = readCliState(root);
    if (read.kind === "read") expect(read.state.mine).toEqual(["agent-a"]);
  });
});

describe("the schema", () => {
  test("a file from a newer build is unusable, not partially defaulted", () => {
    const root = tempRoot();
    put(root, JSON.stringify({ schema: CLI_STATE_SCHEMA + 1, mine: ["agent-a"], paused: [] }));
    const read = readCliState(root);
    expect(read.kind).toBe("unusable");
    if (read.kind === "unusable") expect(read.why).toContain(String(CLI_STATE_SCHEMA + 1));
  });

  test("a file written before the field existed is read as schema 1, not refused", () => {
    const root = tempRoot();
    put(root, JSON.stringify({ mine: ["agent-a"], paused: [] }));
    expect(readCliState(root).kind).toBe("read");
  });

  test("what we write carries the schema", () => {
    const root = tempRoot();
    writeCliState(root, EMPTY_CLI_STATE);
    expect(JSON.parse(readFileSync(cliStatePath(root), "utf8")).schema).toBe(CLI_STATE_SCHEMA);
  });
});

describe("session names", () => {
  test("accepts the names the fleet actually uses", () => {
    for (const name of ["overseer-cli", "fb2p-quotes-always-outlined-in-text", "s-260908-172048", "260908f"]) {
      expect(whyNotASessionName(name)).toBeNull();
    }
  });

  test("refuses what would not be a name anywhere else either", () => {
    for (const name of ["", "-leading-dash", "Upper", "has space", "semi;colon", "a".repeat(42)]) {
      expect(whyNotASessionName(name)).not.toBeNull();
    }
  });
});

describe("the `mine` command, end to end against a real directory", () => {
  // The join, not the parts: `runMine` is what reads the disk, decides, writes
  // and prints. Every arm below is a sentence the Overseer reads under time
  // pressure, and a silent arm is the one that costs a worktree.
  function say(fn: () => number): { code: number; out: string; err: string } {
    const out: string[] = [];
    const err: string[] = [];
    const realOut = console.log;
    const realErr = console.error;
    console.log = (...a: unknown[]) => out.push(a.map(String).join(" "));
    console.error = (...a: unknown[]) => err.push(a.map(String).join(" "));
    try {
      return { code: fn(), out: out.join("\n"), err: err.join("\n") };
    } finally {
      console.log = realOut;
      console.error = realErr;
    }
  }

  test("an empty list says so in words rather than printing nothing", () => {
    const root = tempRoot();
    const r = say(() => runMine(root, { command: "mine", action: "list" }));
    expect(r.code).toBe(0);
    expect(r.out).toContain("nothing is being looked after");
  });

  test("add then list then rm, each saying what it did", () => {
    const root = tempRoot();
    expect(say(() => runMine(root, { command: "mine", action: "add", name: "some-agent" })).out).toContain("added some-agent");
    expect(say(() => runMine(root, { command: "mine", action: "list" })).out).toBe("some-agent");
    expect(say(() => runMine(root, { command: "mine", action: "rm", name: "some-agent" })).out).toContain("removed some-agent");
    expect(say(() => runMine(root, { command: "mine", action: "list" })).out).toContain("nothing is being looked after");
  });

  test("adding twice is not an error and does not pretend it wrote", () => {
    const root = tempRoot();
    runMine(root, { command: "mine", action: "add", name: "some-agent" });
    const again = say(() => runMine(root, { command: "mine", action: "add", name: "some-agent" }));
    expect(again.code).toBe(0);
    expect(again.out).toContain("already on the list");
  });

  test("removing a name that is not there says so rather than succeeding silently", () => {
    const root = tempRoot();
    const r = say(() => runMine(root, { command: "mine", action: "rm", name: "never-here" }));
    expect(r.code).toBe(0);
    expect(r.out).toContain("was not on the list");
  });

  test("a state file this build cannot read REFUSES the write — it does not start a new list", () => {
    // The mutation to try: make `cliStateForWriting` return an empty state on
    // `unusable`. This test and its sibling in the first describe both go red,
    // and without them the Overseer's list would be silently replaced by one
    // name the first time the file was touched by anything.
    const root = tempRoot();
    put(root, "{not json");
    const r = say(() => runMine(root, { command: "mine", action: "add", name: "some-agent" }));
    expect(r.code).toBe(1);
    expect(r.err).toContain(CLI_STATE_FILE);
    // and the unreadable bytes are still there, unclobbered
    expect(readFileSync(cliStatePath(root), "utf8")).toBe("{not json");
  });

  test("listing an unreadable file is a refusal too, not an empty fleet", () => {
    const root = tempRoot();
    put(root, "{not json");
    const r = say(() => runMine(root, { command: "mine", action: "list" }));
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
  });

  test("a name that is not a session name is refused before anything is read", () => {
    const root = tempRoot();
    const r = say(() => runMine(root, { command: "mine", action: "add", name: "Not A Name" }));
    expect(r.code).toBe(1);
    expect(r.err).toContain("Not A Name");
  });
});

describe("the pure edits", () => {
  test("adding is idempotent and sorted", () => {
    const first = addMine(EMPTY_CLI_STATE, "zeta-agent");
    expect(first.changed).toBe(true);
    const second = addMine(first.state, "alpha-agent");
    expect(second.state.mine).toEqual(["alpha-agent", "zeta-agent"]);
    const again = addMine(second.state, "alpha-agent");
    expect(again.changed).toBe(false);
    expect(again.state).toBe(second.state);
  });

  test("removing a name that was never there says so rather than pretending", () => {
    const out = removeMine(EMPTY_CLI_STATE, "never-here");
    expect(out.changed).toBe(false);
  });

  test("parseCliState de-duplicates a name the file lists twice", () => {
    const parsed = parseCliState({ mine: ["agent-one", "agent-one"], paused: [] });
    expect(parsed).toEqual({ kind: "read", state: { mine: ["agent-one"], paused: [] } });
  });

  test("pausing the same session twice replaces rather than appends", () => {
    // `resume --check` walks this list; two entries for one session would report
    // it twice and read as two agents still asleep.
    const one = recordPause(EMPTY_CLI_STATE, { session: "agent-one", at: "2026-09-09T08:00:00.000Z", door: "steer", why: "first" });
    const two = recordPause(one, { session: "agent-one", at: "2026-09-09T09:00:00.000Z", door: "elsewhere", why: "second" });
    expect(two.paused).toHaveLength(1);
    expect(two.paused[0]?.why).toBe("second");
    expect(two.paused[0]?.door).toBe("elsewhere");
  });

  test("resuming hands back the record it removed, so the caller can say how long it slept", () => {
    const paused = recordPause(EMPTY_CLI_STATE, { session: "agent-one", at: "2026-09-09T08:00:00.000Z", door: "steer", why: "usage" });
    const out = recordResume(paused, "agent-one");
    expect(out.was?.at).toBe("2026-09-09T08:00:00.000Z");
    expect(out.state.paused).toEqual([]);
    expect(recordResume(out.state, "agent-one").was).toBeUndefined();
  });

  test("AN OFFSET TIMESTAMP SORTS WRONG, so it is refused rather than stored", () => {
    // GPT Sol's P2. `Date.parse` accepts `2026-09-09T09:00:00+02:00`, which is
    // 07:00Z — chronologically BEFORE `2026-09-09T08:00:00.000Z` — and sorts
    // AFTER it as a string. overseer.md § The tick says "resume oldest-first
    // after the reset", so the wrong order here wakes the fleet in the wrong
    // order and nothing looks broken.
    //
    // MUTATION: relax `isCanonicalInstant` back to `!Number.isNaN(Date.parse(s))`
    // and both halves of this go red.
    expect(isCanonicalInstant("2026-09-09T08:00:00.000Z")).toBe(true);
    for (const bad of ["2026-09-09T09:00:00+02:00", "2026-09-09", "2026-09-09T08:00:00Z", "Wed, 09 Sep 2026 08:00:00 GMT"]) {
      expect(isCanonicalInstant(bad), bad).toBe(false);
    }
    expect(() =>
      recordPause(EMPTY_CLI_STATE, { session: "agent-one", at: "2026-09-09T09:00:00+02:00", door: "steer", why: "" }),
    ).toThrow();
    const root = tempRoot();
    put(root, JSON.stringify({ mine: [], paused: [{ session: "agent-one", at: "2026-09-09T09:00:00+02:00", door: "steer", why: "" }] }));
    expect(readCliState(root).kind).toBe("unusable");
  });

  test("the paused list stays in the order it will be resumed in — oldest first", () => {
    // overseer.md § The tick: "resume oldest-first after the reset".
    const a = recordPause(EMPTY_CLI_STATE, { session: "later-agent", at: "2026-09-09T09:00:00.000Z", door: "steer", why: "" });
    const b = recordPause(a, { session: "earlier-agent", at: "2026-09-09T08:00:00.000Z", door: "steer", why: "" });
    expect(b.paused.map((p) => p.session)).toEqual(["earlier-agent", "later-agent"]);
  });
});
