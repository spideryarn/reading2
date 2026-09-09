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
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  CLI_STATE_FILE,
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

  test("missing keys are empty lists, because a first write need not carry both", () => {
    const root = tempRoot();
    put(root, "{}");
    expect(readCliState(root)).toEqual({ kind: "read", state: { mine: [], paused: [] } });
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
    expect(JSON.parse(written)).toEqual(EMPTY_CLI_STATE);
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

  test("the paused list stays in the order it will be resumed in — oldest first", () => {
    // overseer.md § The tick: "resume oldest-first after the reset".
    const a = recordPause(EMPTY_CLI_STATE, { session: "later-agent", at: "2026-09-09T09:00:00.000Z", door: "steer", why: "" });
    const b = recordPause(a, { session: "earlier-agent", at: "2026-09-09T08:00:00.000Z", door: "steer", why: "" });
    expect(b.paused.map((p) => p.session)).toEqual(["earlier-agent", "later-agent"]);
  });
});
