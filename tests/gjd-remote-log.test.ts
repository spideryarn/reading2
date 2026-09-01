/**
 * The log that lets a lost job be noticed.
 *
 * `--wait 2h` sleeps in the job script on the box, and a reboot kills every
 * sleeping job silently — the session is simply not there, which looks exactly
 * like one that finished. These tests hold the two rules that make the report
 * worth reading:
 *
 *  - an answer the box did not actually give must never read as "nothing was
 *    scheduled" or "nothing ran" — a bad connection would otherwise report
 *    every job as LOST, and a report that cries wolf is a report nobody reads
 *  - a job Greg killed on purpose is not a loss
 *
 * See docs/reusable/silent-success.md and docs/project/hetzner-remote-server-box.md.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FACTS_SENTINEL,
  LOG_SCHEMA,
  MAX_LINE_BYTES,
  buildFactsScript,
  formatLine,
  logDir,
  logPath,
  parseFacts,
  parseLine,
  parseLog,
  startMarkerCommand,
  verdict,
  type BoxFacts,
  type LogRecord,
} from "../scripts/gjd-remote-log.js";

const UUID_A = "3f2c1b0a-1111-4222-8333-444455556666";
const UUID_B = "aa11bb22-3333-4444-8555-666677778888";

const rec = (o: Partial<LogRecord> = {}): LogRecord => ({
  v: LOG_SCHEMA,
  t: "2026-09-01T00:30:00+03:00",
  ms: 1788219000000,
  cmd: "new-claude",
  name: "fix-the-toc",
  id: UUID_A,
  ...o,
});

describe("where the log lives", () => {
  it("takes the override first, so tests never write to Greg's own log", () => {
    expect(logDir({ GJD_REMOTE_LOG_DIR: "/tmp/x", XDG_STATE_HOME: "/s" }, "/home/greg")).toBe("/tmp/x");
  });

  it("then XDG_STATE_HOME, then the default", () => {
    expect(logDir({ XDG_STATE_HOME: "/s" }, "/home/greg")).toBe(path.join("/s", "gjd-remote"));
    expect(logDir({}, "/home/greg")).toBe(path.join("/home/greg", ".local", "state", "gjd-remote"));
  });

  // A relative XDG_STATE_HOME would put the log wherever the command happened
  // to be run from — a different file per directory, which is the exact failure
  // that keeping it out of the repo was meant to avoid.
  it("ignores a relative XDG_STATE_HOME", () => {
    expect(logDir({ XDG_STATE_HOME: "state" }, "/home/greg")).toBe(
      path.join("/home/greg", ".local", "state", "gjd-remote"),
    );
  });

  it("is one file, not one per day", () => {
    expect(logPath({ GJD_REMOTE_LOG_DIR: "/tmp/x" }, "/h")).toBe("/tmp/x/gjd-remote.ndjson");
  });
});

describe("formatLine", () => {
  it("is one JSON object on one line", () => {
    const line = formatLine(rec());
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trimEnd()).not.toContain("\n");
    expect(JSON.parse(line)).toMatchObject({ cmd: "new-claude", id: UUID_A });
  });

  it("round-trips through parseLine", () => {
    const full = rec({
      dir: "/home/greg/code/spideryarn2",
      host: "greg@203.0.113.7",
      waitSeconds: 7200,
      waitUntilMs: 1788226200000,
      promptBytes: 412,
      promptPath: "/home/greg/gjd-remote/prompts/x.md",
    });
    expect(parseLine(formatLine(full))).toEqual(full);
  });

  it("drops absent fields rather than writing null", () => {
    // "there was no wait" and "the wait was recorded as nothing" must not be
    // the same bytes.
    expect(formatLine(rec())).not.toContain("null");
    expect(formatLine(rec())).not.toContain("waitSeconds");
  });

  // The atomic append is per write() call and per line. A line the kernel may
  // split is a line that can corrupt its neighbour, and nobody would find out
  // until they read the file months later.
  it("clips a very long path instead of growing the line", () => {
    const line = formatLine(rec({ dir: `/home/greg/${"deep/".repeat(400)}end` }));
    expect(Buffer.byteLength(line, "utf8")).toBeLessThan(MAX_LINE_BYTES);
    expect(line).toContain("…");
  });

  it("refuses a line that could not append atomically", () => {
    expect(() => formatLine({ ...rec(), cmd: "x".repeat(MAX_LINE_BYTES) })).toThrow(/atomically/);
  });
});

describe("parseLine fails closed", () => {
  it("rejects anything that is not a record of this shape", () => {
    const bad = [
      "",
      "   ",
      "not json",
      "[]",
      "null",
      '"a string"',
      "{}",
      '{"v":1,"t":"x","ms":1}', // no cmd
      '{"v":1,"t":"x","cmd":"ls"}', // no ms
      '{"v":1,"ms":1,"cmd":"ls"}', // no t
      '{"t":"x","ms":1,"cmd":"ls"}', // no v
      '{"v":0,"t":"x","ms":1,"cmd":"ls"}', // v below 1
      '{"v":1,"t":"","ms":1,"cmd":"ls"}', // empty t
      '{"v":1,"t":"x","ms":0,"cmd":"ls"}', // epoch 0
      '{"v":1,"t":"x","ms":-5,"cmd":"ls"}',
      '{"v":1,"t":"x","ms":"1","cmd":"ls"}', // ms as a string
      '{"v":1,"t":"x","ms":1,"cmd":""}',
      '{"v":1,"t":"x","ms":1', // half-written line, the one a bad append leaves
    ];
    for (const line of bad) expect(parseLine(line), line).toBeNull();
  });

  // A newer gjd-remote could add a field that changes what an existing one
  // MEANS. A reader that shrugs at the version answers confidently from a record
  // it does not understand, which is worse than counting it unreadable.
  it("rejects a schema version it was not written against", () => {
    expect(parseLine(`{"v":${LOG_SCHEMA + 1},"t":"x","ms":1,"cmd":"new-claude"}`)).toBeNull();
    expect(parseLine('{"v":1.5,"t":"x","ms":1,"cmd":"new-claude"}')).toBeNull();
    expect(parseLine(`{"v":${LOG_SCHEMA},"t":"x","ms":1,"cmd":"new-claude"}`)).not.toBeNull();
  });

  it("drops a field of the wrong type rather than believing it", () => {
    const r = parseLine('{"v":1,"t":"x","ms":1,"cmd":"new-claude","waitSeconds":"soon","name":42}');
    expect(r).not.toBeNull();
    expect(r?.waitSeconds).toBeUndefined();
    expect(r?.name).toBeUndefined();
  });
});

describe("parseLog", () => {
  it("counts what it could not read instead of quietly shortening the list", () => {
    const text = [formatLine(rec()), "garbage\n", "\n", formatLine(rec({ id: UUID_B }))].join("");
    const { records, unreadable } = parseLog(text);
    expect(records).toHaveLength(2);
    expect(unreadable).toBe(1);
  });

  it("reads an empty file as no records, not as a failure", () => {
    expect(parseLog("")).toEqual({ records: [], unreadable: 0 });
  });
});

describe("verdict", () => {
  const now = 1788226200000;
  const none = new Set<string>();
  const facts = (o: Partial<{ live: string[]; started: string[] }> = {}): BoxFacts => ({
    live: new Set(o.live ?? []),
    started: new Set(o.started ?? []),
  });

  it("is waiting while the session exists and the deadline has not passed", () => {
    const r = rec({ waitSeconds: 7200, waitUntilMs: now + 60_000 });
    expect(verdict(r, facts({ live: [UUID_A] }), { now, killed: none })).toBe("waiting");
  });

  it("is running when the box says it started and the session is still there", () => {
    const r = rec({ waitUntilMs: now - 60_000 });
    expect(verdict(r, facts({ live: [UUID_A], started: [UUID_A] }), { now, killed: none })).toBe("running");
  });

  it("is ran when it started and has since gone", () => {
    expect(verdict(rec(), facts({ started: [UUID_A] }), { now, killed: none })).toBe("ran");
  });

  // The whole point: a session that is gone, never started, and whose time has
  // come is the reboot case.
  it("is lost when the deadline passed and nothing ever started it", () => {
    const r = rec({ waitSeconds: 7200, waitUntilMs: now - 1 });
    expect(verdict(r, facts(), { now, killed: none })).toBe("lost");
  });

  // Without this clause every `gjd-remote kill` would be reported as a loss,
  // and the report would be ignored inside a week.
  it("is killed when the log itself shows it was called off", () => {
    const r = rec({ waitUntilMs: now - 1 });
    expect(verdict(r, facts(), { now, killed: new Set([UUID_A]) })).toBe("killed");
  });

  // The kill is matched BY UUID. `gjd-remote ls` renames a provisional session
  // to Claude's own title, so by the time it is killed its name is usually not
  // the name it was launched under — matching on names reported every renamed,
  // deliberately killed session as a loss. Found by GPT Sol.
  it("is not excused by a kill of a different session that shares its name", () => {
    const r = rec({ waitUntilMs: now - 1, name: "fix-the-toc" });
    expect(verdict(r, facts(), { now, killed: new Set([UUID_B]) })).toBe("lost");
  });

  // A live session past its deadline with no start line means the marker did
  // not get written. Calling that "ran" would hide the one bug this feature
  // exists to catch.
  it("says unknown rather than guessing when the evidence disagrees", () => {
    const r = rec({ waitUntilMs: now - 1 });
    expect(verdict(r, facts({ live: [UUID_A] }), { now, killed: none })).toBe("unknown");
    // A record with no session id — one of the plain one-per-command lines —
    // can never be given a verdict, and must not be guessed at.
    const noId: LogRecord = { v: LOG_SCHEMA, t: "2026-09-01T00:30:00+03:00", ms: 1788219000000, cmd: "ls" };
    expect(verdict(noId, facts(), { now, killed: none })).toBe("unknown");
  });

  it("treats a launch with no wait as due immediately", () => {
    expect(verdict(rec(), facts(), { now, killed: none })).toBe("lost");
  });
});

describe("asking the box", () => {
  it("ends with a sentinel, because empty output is what a broken box looks like", () => {
    expect(buildFactsScript("/home/greg/gjd-remote")).toContain(`echo ${FACTS_SENTINEL}`);
  });

  it("asks tmux with no target at all", () => {
    const s = buildFactsScript("/home/greg/gjd-remote");
    expect(s).toContain("tmux ls -F '#{session_id}'");
    // `display -p -t` is the trap this repo has already been bitten by twice:
    // it takes a target PANE, and returns empty fields with exit 0.
    expect(s).not.toContain("display -p");
  });

  it("treats a box that never ran a job as empty, not broken", () => {
    expect(buildFactsScript("/home/greg/gjd-remote")).toContain("2>/dev/null");
  });
});

describe("parseFacts fails closed", () => {
  const ok = (body: string) => `${body}\n${FACTS_SENTINEL}`;

  it("reads live and started ids", () => {
    const { facts, failure } = parseFacts(ok(`live ${UUID_A}\nstarted ${UUID_B}`));
    expect(failure).toBeNull();
    expect([...facts.live]).toEqual([UUID_A]);
    expect([...facts.started]).toEqual([UUID_B]);
  });

  // Silence is the dangerous answer here: with no sentinel, every scheduled job
  // would be reported LOST because the box appeared to have nothing.
  it("refuses an answer with no sentinel", () => {
    const { facts, failure } = parseFacts(`live ${UUID_A}`);
    expect(failure).toMatch(/completion marker/);
    expect(facts.live.size).toBe(0);
    expect(parseFacts("").failure).toMatch(/completion marker/);
  });

  it("passes on what the box said went wrong", () => {
    expect(parseFacts("GJDERR tmux is not on this box").failure).toBe("tmux is not on this box");
  });

  // The started ids are cut out of a JSON line with shell parameter expansion,
  // so a malformed line yields a fragment. A fragment in this set would mark
  // some other job as having run.
  it("ignores anything that is not a whole uuid", () => {
    const { facts } = parseFacts(
      ok(`started ${UUID_A.slice(0, 20)}\nstarted not-a-uuid\nstarted \nlive ${UUID_A.toUpperCase()}\nstarted ${UUID_B}`),
    );
    expect([...facts.started]).toEqual([UUID_B]);
    expect(facts.live.size).toBe(0);
  });

  it("strips the trailing quote the shell cut leaves behind", () => {
    const { facts } = parseFacts(ok(`started ${UUID_B}","name":"x"}`));
    expect([...facts.started]).toEqual([UUID_B]);
  });
});

describe("the marker the job writes", () => {
  it("appends, and makes its directory first", () => {
    const cmd = startMarkerCommand("/home/greg/gjd-remote", UUID_A, "fix-the-toc");
    expect(cmd).toContain("mkdir -p /home/greg/gjd-remote/log");
    expect(cmd).toContain(">> /home/greg/gjd-remote/log/starts.ndjson");
    expect(cmd).toContain(UUID_A);
  });

  // It must never be the reason a session fails to start: the marker is
  // evidence about the job, not part of it.
  it("cannot fail the job", () => {
    expect(startMarkerCommand("/w", UUID_A, "x")).toMatch(/\|\| true$/);
  });

  it("refuses anything that is not a uuid and a slug", () => {
    for (const bad of ["", "nope", `${UUID_A} `, "'; rm -rf ~; '"]) {
      expect(() => startMarkerCommand("/w", bad, "x"), bad).toThrow(/session uuid/);
    }
    for (const bad of ["", "Bad Name", "x'; id; '", "../etc", "a".repeat(42)]) {
      expect(() => startMarkerCommand("/w", UUID_A, bad), bad).toThrow(/session name/);
    }
  });
});

describe("what reaches the file, and what must not", () => {
  // There is no argv field and no prompt field, so there is no redaction step
  // to get wrong later — a field never passed in cannot leak.
  it("has nowhere to put the prompt text or the raw arguments", () => {
    const line = formatLine(rec({ promptBytes: 412, promptPath: "/home/greg/gjd-remote/prompts/x.md" }));
    const keys = Object.keys(JSON.parse(line));
    expect(keys).not.toContain("argv");
    expect(keys).not.toContain("prompt");
    expect(keys).not.toContain("promptSha");
    expect(keys).toContain("promptBytes");
  });

  // And the honest half, which an earlier version of this file denied: an
  // unnamed session's NAME is the first five words of its prompt, so the log
  // does carry a fragment of it. That is why the file is 0600 and lives outside
  // both the repo and Dropbox. Asserted so nobody can quietly widen it.
  it("carries the provisional name, which is derived from the prompt", () => {
    const name = "fix-the-toc-ordering-bug";
    expect(formatLine(rec({ name }))).toContain(name);
  });
});
