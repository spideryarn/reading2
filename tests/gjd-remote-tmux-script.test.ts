/**
 * Running the remote script for real, against stub binaries.
 *
 * EVERY OTHER TEST IN THIS AREA STARTS DOWNSTREAM OF THE SHELL. They hand
 * `parseSessions` a string and check what comes out, which is worth having and
 * answers a different question — and it is why `gjd-remote ls` spent its whole
 * life silently dropping one session and nothing noticed. `$(…)` strips the
 * trailing newline, `printf '%s'` added none back, and `while read` discards an
 * unterminated final line. Ten sessions on the box, nine on screen, always the
 * last one alphabetically. Found by GPT Sol on 2026-09-01 reviewing something
 * else; see docs/postmortems/260901b-the-session-that-was-never-listed.md.
 *
 * The wire format is a seam, and both sides of it were being tested against the
 * same assumption about what the other side sends. These tests put `tmux`, `ps`
 * and `claude` on a PATH as small shell scripts and run `buildSessionScript()`
 * through bash, so the seam is exercised rather than assumed.
 *
 * They need bash and coreutils, which is what the box is. Skipped elsewhere
 * rather than failing, because a Mac without GNU `base64 -w0` is not a bug in
 * this script — the script only ever runs on the box.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSessionScript, parseSessions, sessionState } from "../scripts/gjd-remote-tmux.js";

/** GNU coreutils and bash, or there is nothing here to test. */
function usable(): boolean {
  try {
    execFileSync("bash", ["-c", "printf x | base64 -w0 >/dev/null && ps -o args= -p $$ >/dev/null"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

const CAN_RUN = usable();
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "gjd-script-"));
});
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** A stub binary, first on the PATH the script inherits. */
function stub(name: string, body: string): void {
  const bin = path.join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const file = path.join(bin, name);
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(file, 0o755);
}

/**
 * Run the script with the stubs in front of the real PATH.
 *
 * In front is the point: the script appends the standard directories rather
 * than prepending them, precisely so the environment it is given still wins.
 */
function run(opts: { agents?: boolean } = {}): string {
  return execFileSync("bash", ["-c", buildSessionScript({ agents: opts.agents ?? true })], {
    encoding: "utf8",
    maxBuffer: 8e6,
    env: { ...process.env, PATH: `${path.join(dir, "bin")}:${process.env.PATH ?? ""}`, HOME: dir },
  });
}

const UUIDS = [
  "3c67234f-2da6-4208-8473-9b5ee58be82a",
  "49348111-df07-44ac-a204-f2e168f46de5",
  "7d9a25bf-ef51-425f-9ec5-65ada264eb4c",
];

/**
 * `tmux ls -F` prints `n` rows; `show-environment` answers per session.
 *
 * The rows carry a real trailing newline, exactly as tmux prints them, because
 * the bug under test is about what happens to that newline.
 */
function stubTmux(n: number): void {
  const rows = Array.from({ length: n }, (_, i) => `$${i}|178819033${i}|0|1|session-${i}`).join("\\n");
  const panes = Array.from({ length: n }, (_, i) => `$${i} ${1000 + i}`).join("\\n");
  // One uuid per line, so the stub can look one up by session index with sed
  // rather than this file having to build a shell array.
  const ids = path.join(dir, "ids.txt");
  writeFileSync(ids, `${UUIDS.join("\n")}\n`);
  stub(
    "tmux",
    [
      `case "$1 $2" in`,
      `  "ls -F") printf '${rows}\\n' ;;`,
      `  "list-panes -a") printf '${panes}\\n' ;;`,
      `  "show-environment -t")`,
      // $3 is the session id, "$0", "$1"… — strip the dollar to get the index.
      `    idx=\${3#[$]}`,
      `    case "$4" in`,
      `      CLAUDE_SESSION_ID) echo "CLAUDE_SESSION_ID=$(sed -n "$((idx + 1))p" ${ids})" ;;`,
      `      GJD_PROVISIONAL) echo "GJD_PROVISIONAL=0" ;;`,
      `    esac ;;`,
      `esac`,
    ].join("\n"),
  );
}

/**
 * A whole-process snapshot, as `ps -eo pid=,ppid=,etimes=,args=` prints it:
 * `pid ppid etimes args…`. Each pane is a login shell with nothing under it.
 */
function stubPs(lines: string[]): void {
  stub("ps", `printf '%s\\n' ${lines.map((l) => `'${l}'`).join(" ")}`);
}

/** Panes 1000..1000+n-1, each a bare login shell. */
const idlePanes = (n: number) => Array.from({ length: n }, (_, i) => `${1000 + i} 1 3600 bash -l`);

function stubPsIdle(n = 1): void {
  stubPs(idlePanes(n));
}

function stubClaude(json: string): void {
  stub("claude", `[ "$1 $2" = "agents --json" ] && printf '%s' '${json}'`);
}

describe.skipIf(!CAN_RUN)("the remote script, actually run", () => {
  /**
   * THE ONE THAT MATTERS. Two rows in must be two rows out. The old script
   * produced one, and every test in the neighbouring file agreed with it,
   * because they all began after the shell had already lost the row.
   */
  it("does not lose the last session tmux gave it", () => {
    stubTmux(2);
    stubPsIdle(2);
    stubClaude("[]");
    const { sessions, failure, unreadable } = parseSessions(run());
    expect(failure).toBeNull();
    expect(unreadable).toEqual([]);
    expect(sessions.map((s) => s.name)).toEqual(["session-0", "session-1"]);
  });

  it("does not lose it at one session either, where a short list is an empty box", () => {
    stubTmux(1);
    stubPsIdle();
    stubClaude("[]");
    expect(parseSessions(run()).sessions.map((s) => s.name)).toEqual(["session-0"]);
  });

  it("agrees with itself about how many rows there were", () => {
    stubTmux(5);
    stubPsIdle(5);
    stubClaude("[]");
    const out = run();
    expect(out).toContain("GJDROWS 5");
    expect(parseSessions(out).sessions).toHaveLength(5);
  });

  /**
   * A box with tmux running and nothing in it. The one genuine empty case, and
   * it must not trip the row-count guard.
   */
  it("reads an empty box as empty rather than as a failure", () => {
    stub("tmux", `case "$1 $2" in "ls -F"|"list-panes -a") printf '' ;; esac`);
    stubPsIdle();
    stubClaude("[]");
    const { sessions, failure } = parseSessions(run());
    expect(failure).toBeNull();
    expect(sessions).toEqual([]);
  });

  /**
   * A sleep in a pane that is NOT one of our job scripts — somebody typed it
   * into the shell the job left behind. It is not a scheduled job, and saying
   * it is would invent a `--wait` that nobody asked for.
   */
  it("does not call a hand-typed sleep a scheduled job", () => {
    stubTmux(1);
    stubPs(["1000 1 3600 bash -l", "2000 1000 60 sleep 900"]);
    stubClaude("[]");
    const { sessions, agents } = parseSessions(run());
    expect(sessions[0]?.proc).toEqual({ kind: "none" });
    expect(sessions[0] && sessionState(sessions[0], agents).kind).toBe("no-claude");
  });

  /** The same sleep, under one of our job scripts, IS the wait. */
  it("counts down a sleep that our own job script is sitting in", () => {
    stubTmux(1);
    stubPs(["1000 1 3600 bash /home/greg/gjd-remote/jobs/some-job.sh", "2000 1000 60 sleep 900"]);
    stubClaude("[]");
    const { sessions, agents } = parseSessions(run());
    expect(sessions[0]?.proc).toEqual({ kind: "wait", secondsLeft: 840 });
    expect(sessions[0] && sessionState(sessions[0], agents)).toEqual({ kind: "waiting", secondsLeft: 840 });
  });

  /**
   * The measured case: a Claude that is running and that `agents --json` does
   * not list. It must not read as a session with no Claude in it.
   */
  it("sees a running Claude that Claude Code did not list", () => {
    stubTmux(1);
    stubPs([
      "1000 1 3600 bash /home/greg/gjd-remote/jobs/some-job.sh",
      `2000 1000 60 claude --session-id ${UUIDS[0]}`,
    ]);
    stubClaude("[]");
    const { sessions, agents } = parseSessions(run());
    expect(sessions[0]?.proc).toEqual({ kind: "claude" });
    const st = sessions[0] && sessionState(sessions[0], agents);
    expect(st?.kind).toBe("unknown");
  });

  /** A neighbour's Claude must not answer for this session. */
  it("will not take another session's Claude for this one's", () => {
    stubTmux(1);
    stubPs(["1000 1 3600 bash -l", `2000 1000 60 claude --session-id ${UUIDS[2]}`]);
    stubClaude("[]");
    expect(parseSessions(run()).sessions[0]?.proc).toEqual({ kind: "none" });
  });

  /**
   * THE ONE SOL FOUND. `ps --ppid <pid>` exits 1 for "no children" — the
   * ordinary case — so the first version threw the status away, and a `ps` that
   * failed for any other reason was indistinguishable from a pane with nothing
   * under it. Sol ran the generated script with a `ps` returning 2 and got
   * `none`, which reads on screen as "this session has no Claude in it".
   *
   * There is one checked snapshot now, so a failing `ps` says so.
   */
  it("says it could not look when ps fails, rather than that there was nothing to see", () => {
    stubTmux(1);
    stub("ps", "exit 2");
    stubClaude("[]");
    const { sessions, failure } = parseSessions(run());
    expect(failure).toBeNull();
    expect(sessions[0]?.proc).toEqual({ kind: "unknown" });
  });

  it("says the same when ps succeeds but tells it nothing", () => {
    stubTmux(1);
    stub("ps", "exit 0");
    stubClaude("[]");
    expect(parseSessions(run()).sessions[0]?.proc).toEqual({ kind: "unknown" });
  });

  /**
   * THE OTHER ONE SOL FOUND. `#{pane_pid}` is the active pane of the session's
   * CURRENT window, so a Claude in a second window or a split was not seen —
   * and a session that is not seen and is not in the agents list reads as one
   * with no Claude in it. Every pane is probed now.
   */
  it("finds a Claude in a window that is not the one on screen", () => {
    stub(
      "tmux",
      `case "$1 $2" in
         "ls -F") printf '$0|1788190330|0|2|session-0\\n' ;;
         "list-panes -a") printf '$0 1000\\n$0 1500\\n' ;;
         "show-environment -t")
           case "$4" in
             CLAUDE_SESSION_ID) echo "CLAUDE_SESSION_ID=${UUIDS[0]}" ;;
             GJD_PROVISIONAL) echo "GJD_PROVISIONAL=0" ;;
           esac ;;
       esac`,
    );
    // The pane tmux would have named is idle; the Claude is under the other one.
    stubPs(["1000 1 3600 bash -l", "1500 1 3600 bash -l", `2000 1500 60 claude --session-id ${UUIDS[0]}`]);
    stubClaude("[]");
    const { sessions, agents } = parseSessions(run());
    expect(sessions[0]?.proc).toEqual({ kind: "claude" });
    expect(sessions[0] && sessionState(sessions[0], agents).kind).toBe("unknown");
  });

  /**
   * `new-claude` wraps Claude in a job script, so on the box `claude` is always
   * a CHILD of the pane. `tmux new-window 'claude …'` makes it the pane process
   * itself, whose parent is the tmux server. The first version of the probe only
   * looked at children and said `none` about a session with a live Claude in it
   * — found by building that session by hand while checking the multi-window fix.
   */
  it("sees a Claude that is the pane process rather than its child", () => {
    stub(
      "tmux",
      `case "$1 $2" in
         "ls -F") printf '$0|1788190330|0|1|session-0\\n' ;;
         "list-panes -a") printf '$0 2000\\n' ;;
         "show-environment -t")
           case "$4" in
             CLAUDE_SESSION_ID) echo "CLAUDE_SESSION_ID=${UUIDS[0]}" ;;
             GJD_PROVISIONAL) echo "GJD_PROVISIONAL=0" ;;
           esac ;;
       esac`,
    );
    // ppid 1 is the tmux server, not another pane — the pane IS the claude.
    stubPs([`2000 1 60 claude --session-id ${UUIDS[0]}`]);
    stubClaude("[]");
    expect(parseSessions(run()).sessions[0]?.proc).toEqual({ kind: "claude" });
  });

  /** tmux not naming any pane for a session is a question it could not answer,
   *  not an answer of "nothing". */
  it("says it could not look when tmux named no pane for the session", () => {
    stub(
      "tmux",
      `case "$1 $2" in
         "ls -F") printf '$0|1788190330|0|1|session-0\\n' ;;
         "list-panes -a") printf '' ;;
       esac`,
    );
    stubPsIdle();
    stubClaude("[]");
    expect(parseSessions(run()).sessions[0]?.proc).toEqual({ kind: "unknown" });
  });

  /**
   * A `claude` that answers nothing is what a version too old for `--json`
   * looks like, and it must not read as a box where nothing is running.
   */
  it("reports a silent claude as a failure, not as an empty agents list", () => {
    stubTmux(1);
    stubPsIdle();
    stubClaude("");
    const { agents, agentsWhy } = parseSessions(run());
    expect(agents).toBeNull();
    expect(agentsWhy).toContain("printed nothing");
  });

  it("reports a claude that prints something other than JSON as a failure too", () => {
    stubTmux(1);
    stubPsIdle();
    stub("claude", `echo "NAME   STATUS"; echo "foo    busy"`);
    expect(parseSessions(run()).agents).toBeNull();
  });

  /** The three live states, end to end through the shell. */
  it("carries Claude Code's own statuses through the wire format", () => {
    stubTmux(3);
    stubPs([
      ...idlePanes(3),
      `2000 1000 60 claude --session-id ${UUIDS[0]}`,
      `2001 1001 60 claude --session-id ${UUIDS[1]}`,
      `2002 1002 60 claude --session-id ${UUIDS[2]}`,
    ]);
    stubClaude(
      JSON.stringify([
        { sessionId: UUIDS[0], status: "waiting" },
        { sessionId: UUIDS[1], status: "busy" },
        { sessionId: UUIDS[2], status: "idle" },
      ]).replace(/'/g, ""),
    );
    const { sessions, agents } = parseSessions(run());
    expect(sessions.map((s) => sessionState(s, agents).kind)).toEqual(["needs-you", "working", "idle"]);
  });

  /** Only `ls` pays for the agents call; nothing else may even send it. */
  it("does not run claude at all when the caller did not ask for states", () => {
    stubTmux(1);
    stubPsIdle();
    stub("claude", `echo "CLAUDE WAS RUN" >> ${path.join(dir, "ran.txt")}`);
    const out = run({ agents: false });
    expect(out).not.toContain("GJDAGENTS");
    const { agents, agentsWhy, sessions } = parseSessions(out);
    expect(agents).toBeNull();
    expect(agentsWhy).toBeNull();
    expect(sessions).toHaveLength(1);
  });

  /** A session name with the field separator in it, through the real base64. */
  it("survives a session name containing the field separator", () => {
    stub(
      "tmux",
      `case "$1 $2" in
         "ls -F") printf '$0|1788190330|0|1|weird|name\\n' ;;
         "list-panes -a") printf '$0 1000\\n' ;;
       esac`,
    );
    stubPsIdle();
    stubClaude("[]");
    expect(parseSessions(run()).sessions[0]?.name).toBe("weird|name");
  });
});
