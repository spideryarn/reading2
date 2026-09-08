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
 *
 * **The skip did not skip, and the check that was supposed to arrange it passed
 * on a Mac.** `base64 -w0` was the probe, and FreeBSD's `base64` — which is what
 * macOS ships — *accepts* `-w0` silently. So `usable()` said yes on Greg's
 * laptop, all sixteen ran, and the deploy gate's `test` step could not go green
 * there. The actual incompatibility is one line further on: `wc -l` pads its
 * count to a width on BSD, so the script emits `GJDROWS        1` where the
 * parser wants `GJDROWS 1`, and every row count is unreadable.
 *
 * The probe is now `wc --version`, which BSD has no such option for at all,
 * rather than another flag BSD might happen to tolerate. It asks the question
 * the docstring above always meant — *is this GNU coreutils* — instead of
 * sampling one flag and generalising from it.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSessionScript, parseSessions, sessionState } from "../scripts/gjd-remote-tmux.js";

/**
 * GNU coreutils and bash, or there is nothing here to test.
 *
 * `wc --version` is the probe because BSD's `wc` has no long options and exits
 * non-zero on one — there is no way for it to look like it worked. A flag test
 * cannot promise that: `base64 -w0` was the old probe and BSD takes it happily.
 * Grepping for the word GNU as well, so a third `wc` that grew `--version`
 * without growing GNU's output format still counts as "not the box".
 */
function usable(): boolean {
  try {
    execFileSync("bash", ["-c", "wc --version 2>/dev/null | grep -q GNU && ps -o args= -p $$ >/dev/null"], {
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
function stubTmux(n: number, meta: Record<string, string> = {}): void {
  const rows = Array.from({ length: n }, (_, i) => `$${i}|178819033${i}|0|1|session-${i}`).join("\\n");
  const panes = Array.from({ length: n }, (_, i) => `$${i} ${1000 + i}`).join("\\n");
  // One uuid per line, so the stub can look one up by session index with sed
  // rather than this file having to build a shell array.
  const ids = path.join(dir, "ids.txt");
  writeFileSync(ids, `${UUIDS.join("\n")}\n`);
  // A variable this stub is not given answers the way tmux answers for one it
  // has never been set: nothing on stdout and a complaint on stderr. That is
  // what every session on the box looked like before the metadata existed.
  const metaCases = Object.entries(meta).map(([k, v]) => `      ${k}) echo "${k}=${v}" ;;`);
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
      ...metaCases,
      `      *) echo "unknown variable: $4" >&2; exit 1 ;;`,
      `    esac ;;`,
      `esac`,
    ].join("\n"),
  );
}

/** The four variables a session started by the current gjd-remote carries. */
const METADATA = {
  GJD_METADATA_VERSION: "1",
  GJD_KIND: "claude",
  GJD_REPO: "gregdetre/reading2",
  GJD_REMOTE_DIR: "/home/greg/code/spideryarn2",
};

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
    // `busy` rather than `none` since 2026-09-05: something IS running in this
    // pane, and that is now a thing the probe reports. What this test is about
    // is unchanged and is the line below — the sleep is not OUR wait, so the
    // STATE is `no-claude` and never a countdown.
    expect(sessions[0]?.proc).toEqual({ kind: "busy" });
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

  /**
   * A neighbour's Claude must not answer for this session.
   *
   * `busy` rather than `none` since 2026-09-05 — a process IS under this pane.
   * The claim under test is that it is not reported as `claude`, which would
   * make a neighbour's session answer for this one.
   */
  it("will not take another session's Claude for this one's", () => {
    stubTmux(1);
    stubPs(["1000 1 3600 bash -l", `2000 1000 60 claude --session-id ${UUIDS[2]}`]);
    stubClaude("[]");
    expect(parseSessions(run()).sessions[0]?.proc).toEqual({ kind: "busy" });
  });

  /**
   * **THE PROBE'S OWN COMMAND-LINE GRAMMAR.** Every case above this one hands
   * the awk a well-behaved `claude --session-id <uuid>`, which is exactly why
   * the substring test it used to be lived here undisturbed. These are the
   * shapes that tell a substring search apart from a reading of the command
   * line, and the rule they assert is the one settled in
   * `docs/plans/260908h-one-shared-reader-for-a-claude-command-line.md`.
   *
   * The two directions do not cost the same. A false positive labels a pane
   * "running but unlisted" — noise. A false negative says there is no agent in
   * a pane that has one, and that is the one somebody acts on.
   */
  describe("reading a claude command line under a pane", () => {
    /**
     * One idle pane with one child running `args`, and the probe's verdict for
     * the session — whose CLAUDE_SESSION_ID is `UUIDS[0]` throughout.
     *
     * `busy` is what "not this session's claude" looks like here: something IS
     * running under the pane, it just is not a claude answering for this id.
     */
    function procForChild(args: string) {
      stubTmux(1);
      stubPs(["1000 1 3600 bash -l", `2000 1000 60 ${args}`]);
      stubClaude("[]");
      return parseSessions(run()).sessions[0]?.proc;
    }

    /** D3. Word one decides, and `grep` is not `claude` however it is spelled. */
    it("does not call a grep for the uuid a claude", () => {
      expect(procForChild(`grep -r --session-id ${UUIDS[0]} logs/`)).toEqual({ kind: "busy" });
    });

    /**
     * D3, the other half, and the one that is real on this box: the launcher at
     * `scripts/gjd-remote.ts` puts the whole prompt into argv, so a sibling
     * agent briefed to go and look at this conversation carries this uuid in
     * its own command line.
     */
    it("does not let another conversation's prompt claim this session", () => {
      expect(procForChild(`claude --session-id ${UUIDS[1]} -- read the log for --session-id ${UUIDS[0]}`)).toEqual({
        kind: "busy",
      });
    });

    /**
     * D4, and the expensive direction. `steer.ts` and `harness.ts` both accept
     * this spelling; the awk required a literal space and would read a live
     * agent as an empty pane.
     */
    it("accepts the --session-id=<id> spelling", () => {
      expect(procForChild(`claude --session-id=${UUIDS[0]}`)).toEqual({ kind: "claude" });
    });

    /** A full path is how the box actually execs it. */
    it("accepts a claude invoked by absolute path", () => {
      expect(procForChild(`/home/greg/.nvm/versions/node/v26.8.1/bin/claude --session-id ${UUIDS[0]}`)).toEqual({
        kind: "claude",
      });
    });

    /**
     * D1. Everything after a bare `--` is positional by definition, and the
     * launcher emits one before every prompted run. The pane's own id counts
     * because it is before the `--`; the other one is prose.
     */
    it("reads the ids before a bare -- and none of the prose after it", () => {
      expect(
        procForChild(`claude --session-id ${UUIDS[0]} -- also look at --session-id ${UUIDS[1]} while you are there`),
      ).toEqual({ kind: "claude" });
    });

    /** Exact tokens, not substrings: a uuid with one character glued on is a different uuid. */
    it("does not match a uuid with a suffix", () => {
      expect(procForChild(`claude --session-id ${UUIDS[0]}9`)).toEqual({ kind: "busy" });
    });

    /** And not a prefix either, which is the mistake a `startsWith` fix would make. */
    it("does not match the first eight characters of the uuid", () => {
      expect(procForChild(`claude --session-id ${UUIDS[0]?.slice(0, 8)}`)).toEqual({ kind: "busy" });
    });

    /** A flag with nothing after it has no value, and a missing value is a refusal. */
    it("refuses a --session-id with no value after it", () => {
      expect(procForChild("claude --session-id")).toEqual({ kind: "busy" });
    });

    it("refuses a --session-id whose value is the next flag", () => {
      expect(procForChild(`claude --session-id --permission-mode acceptEdits ${UUIDS[0]}`)).toEqual({ kind: "busy" });
    });

    /**
     * An empty inline value is missing too, and this is the one shape where
     * saying so changes the answer: a later, real `--session-id` would
     * otherwise be the first non-empty value seen and would be accepted on its
     * own. Added after mutation testing — dropping the empty-value refusal was
     * the only mutant the first draft of this block did not catch.
     */
    it("refuses an empty inline value even when a real id follows it", () => {
      expect(procForChild(`claude --session-id= --session-id ${UUIDS[0]}`)).toEqual({ kind: "busy" });
    });

    /** D2. Two occurrences of the SAME id converge on one value whichever end the CLI keeps. */
    it("accepts two occurrences of the same id", () => {
      expect(procForChild(`claude --session-id ${UUIDS[0]} --session-id ${UUIDS[0]}`)).toEqual({ kind: "claude" });
    });

    /** D2. Two that differ mean the answer depends on the CLI's parser. We do not guess. */
    it("refuses two ids that differ", () => {
      expect(procForChild(`claude --session-id ${UUIDS[0]} --session-id ${UUIDS[1]}`)).toEqual({ kind: "busy" });
    });

    /**
     * D2 at three, which is Sol's P2-2: comparing only the first two accepts
     * `A A B` as `A`. The rule is a set over every occurrence before the
     * boundary, so the third one still refuses.
     */
    it("refuses three ids where two agree and one differs", () => {
      expect(procForChild(`claude --session-id ${UUIDS[0]} --session-id ${UUIDS[0]} --session-id ${UUIDS[1]}`)).toEqual(
        { kind: "busy" },
      );
    });

    /** The same, with the odd one out first, so neither end is privileged. */
    it("refuses three ids where the odd one comes first", () => {
      expect(procForChild(`claude --session-id ${UUIDS[1]} --session-id ${UUIDS[0]} --session-id ${UUIDS[0]}`)).toEqual(
        { kind: "busy" },
      );
    });
  });

  /**
   * **The eight ghost sessions, told apart.** On 2026-09-05 `gjd-remote ls`
   * showed eight rows reading `shell`; seven were running `npm test` for other
   * agents and one had been an abandoned prompt for fifteen hours, and nothing
   * on screen distinguished them. This is the probe that does.
   */
  it("calls a shell with nothing under it idle", () => {
    stubTmux(1);
    stubPsIdle();
    stubClaude("[]");
    const { sessions, agents } = parseSessions(run());
    expect(sessions[0]?.proc).toEqual({ kind: "none" });
    expect(sessions[0] && sessionState({ ...sessions[0], claudeId: null }, agents)).toEqual({
      kind: "shell",
      busy: false,
    });
  });

  /**
   * The real shape on the box: `bash -l` → `npm test` → `node …`.
   *
   * The probe walks the ancestry rather than testing for a direct child. With a
   * complete process table the two agree — the direct ancestor is always in it
   * — so this test does not distinguish them and is not claiming to. The walk
   * is there for the table that is not complete: `ps` is one snapshot, and a
   * middle process that exits between the pane's line and its grandchild's is
   * the ordinary way a chain arrives with a hole in it.
   */
  it("calls a shell with a grandchild busy, not idle", () => {
    stubTmux(1);
    stubPs([
      "1000 1 3600 bash -l",
      "2000 1000 600 npm test",
      "3000 2000 590 node /home/greg/code/spideryarn2/node_modules/.bin/vitest run",
    ]);
    stubClaude("[]");
    const { sessions, agents } = parseSessions(run());
    expect(sessions[0]?.proc).toEqual({ kind: "busy" });
    expect(sessions[0] && sessionState({ ...sessions[0], claudeId: null }, agents)).toEqual({
      kind: "shell",
      busy: true,
    });
  });

  /**
   * A process table is read a line at a time and can contain a cycle — a pid
   * reused between the parent's line and the child's is enough. The walk is
   * bounded so the script cannot hang the whole of `ls` on one, which is a
   * failure that would look exactly like a slow box.
   */
  it("does not hang on a parent cycle in the process table", () => {
    stubTmux(1);
    stubPs(["1000 1 3600 bash -l", "2000 3000 60 a", "3000 2000 60 b"]);
    stubClaude("[]");
    const { sessions, failure } = parseSessions(run());
    expect(failure).toBeNull();
    // Nothing in the cycle reaches the pane, so the pane really is idle.
    expect(sessions[0]?.proc).toEqual({ kind: "none" });
  });

  /**
   * **THE ONE SOL FOUND IN REVIEW.** The walk skips pane processes, so a session
   * whose work IS the pane — `tmux new-session -d -s x 'npm test'`, which is
   * what the old testing.md recipe produced — had nothing left to look at and
   * reported `none`. `ls` called a session running the suite `shell idle`,
   * which is the one direction that gets live work killed.
   */
  it("calls a session busy when the work is the pane process itself", () => {
    stubTmux(1);
    stubPs(["1000 1 600 npm test"]);
    stubClaude("[]");
    expect(parseSessions(run()).sessions[0]?.proc).toEqual({ kind: "busy" });
  });

  /** A pane that really is only a login shell still reads idle, in every spelling. */
  it("still calls a bare login shell idle", () => {
    for (const shell of ["bash -l", "-bash", "/bin/bash", "sh", "-sh", "/usr/bin/zsh", "zsh"]) {
      stubTmux(1);
      stubPs([`1000 1 3600 ${shell}`]);
      stubClaude("[]");
      expect(parseSessions(run()).sessions[0]?.proc, shell).toEqual({ kind: "none" });
    }
  });

  /**
   * An unrecognised pane command is called BUSY, not idle. The check errs
   * towards "something is happening here" because the other direction is the
   * one somebody kills a running test suite over.
   */
  it("errs towards busy for a pane command it does not recognise", () => {
    stubTmux(1);
    stubPs(["1000 1 3600 /opt/weird/oil-shell"]);
    stubClaude("[]");
    expect(parseSessions(run()).sessions[0]?.proc).toEqual({ kind: "busy" });
  });

  /**
   * A pane in a SECOND window counts. `busy` walks to any pane of the session,
   * which is the same reason the probe asks `list-panes -a` rather than reading
   * `#{pane_pid}` — see the test above about the pane that happens to be on
   * screen.
   */
  it("sees work running in a pane that is not the visible one", () => {
    stub(
      "tmux",
      `case "$1 $2" in
         "ls -F") printf '$0|1788190330|0|2|0|two-windows\n' ;;
         "list-panes -a") printf '$0 1000\n$0 1001\n' ;;
       esac`,
    );
    stubPs(["1000 1 3600 bash -l", "1001 1 3600 bash -l", "2000 1001 600 npm test"]);
    stubClaude("[]");
    expect(parseSessions(run()).sessions[0]?.proc).toEqual({ kind: "busy" });
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

  /**
   * The metadata, through the shell rather than through a fixture string.
   *
   * The four `show-environment` calls and the four extra printf fields are a
   * seam like every other one in this file, and the fixture tests next door
   * cannot see it: they assert on a record this file is the only thing that
   * actually produces.
   */
  it("carries a session's repo and checkout through the wire format", () => {
    stubTmux(1, METADATA);
    stubPsIdle();
    stubClaude("[]");
    const { sessions, failure } = parseSessions(run());
    expect(failure).toBeNull();
    expect(sessions[0]?.meta).toEqual({
      version: 1,
      kind: "claude",
      repo: "gregdetre/reading2",
      dir: "/home/greg/code/spideryarn2",
    });
  });

  /** Every session already on the box has none of these, and must still list. */
  it("reads a session with none of the metadata as one that predates it", () => {
    stubTmux(1);
    stubPsIdle();
    stubClaude("[]");
    const { sessions, failure } = parseSessions(run());
    expect(failure).toBeNull();
    expect(sessions[0]?.meta).toEqual({ version: "legacy" });
  });

  /** Which is why the directory travels base64: a path may contain the
   *  separator, and `~/code/a|b` would otherwise shift every field after it. */
  it("survives a checkout path containing the field separator", () => {
    stubTmux(1, { ...METADATA, GJD_REMOTE_DIR: "/home/greg/code/a|b" });
    stubPsIdle();
    stubClaude("[]");
    expect(parseSessions(run()).sessions[0]?.meta).toMatchObject({ dir: "/home/greg/code/a|b" });
  });

  /**
   * Half the metadata is the state the version exists to make visible: without
   * it, a session that lost its repo on the way looks exactly like one started
   * before the repo was ever recorded, and `ls` would print `(unknown)` beside
   * a session whose repo the box knows perfectly well.
   */
  it("refuses the whole listing when the box reports only half the metadata", () => {
    stubTmux(1, { GJD_REPO: "gregdetre/reading2" });
    stubPsIdle();
    stubClaude("[]");
    const { sessions, failure } = parseSessions(run());
    expect(sessions).toEqual([]);
    expect(failure).toContain("GJD_METADATA_VERSION");
    expect(failure).toContain("session-0");
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
