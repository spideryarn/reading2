/**
 * **`gjd-remote restart-overseer`: the Overseer resumed by uuid, never by name.**
 *
 * A Claude resumed as `claude --resume Overseer` works for Claude and is
 * invisible to the steer route, which trusts a pane only when its command line
 * carries the conversation's uuid (queue item qi-d66em72h). The command reads
 * the uuid the route checks — `CLAUDE_SESSION_ID` in the holder's tmux
 * environment — and types the resume for you.
 * docs/plans/261010g-gjd-remote-restart-overseer-resumes-the-overseer-by-uuid.md.
 *
 * Two halves, as in gjd-remote-overseer-claim.test.ts: the decision against
 * parsed listings, then the box-side script against REAL TMUX on a disposable
 * socket, with a stub `claude` on PATH that records what it was started with.
 * Nothing here touches the live Overseer: every tmux call carries `-S <sock>`.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  METADATA_VERSION,
  OVERSEER_ROLE,
  ROW_COUNT,
  SESSION_SENTINEL,
  type Session,
  decideOverseerRestart,
  overseerResumeLine,
  parseSessions,
  resumeOverseerCommand,
  overseerRestartSucceeded,
} from "../scripts/gjd-remote-tmux.js";

const b64 = (t: string) => Buffer.from(t, "utf8").toString("base64");
const UUID = "606cb12a-ffc5-4df4-af3a-7dc881135b5f";
const DIR = "/home/greg/code/spideryarn2";

type RowOpts = { sid?: string; name?: string; role?: string; id?: string; proc?: string; legacy?: boolean };

/** One record as buildSessionScript prints it. */
const row = (o: RowOpts = {}): string =>
  [
    o.sid ?? "$1",
    "1757000000",
    "0",
    "1",
    "0",
    o.id ?? UUID,
    o.proc ?? "none",
    b64(o.name ?? "Overseer"),
    b64(""),
    o.legacy ? "" : METADATA_VERSION,
    o.legacy ? "" : "claude",
    o.legacy ? "" : "spideryarn/reading2",
    o.legacy ? "" : b64(DIR),
    b64(o.role ?? OVERSEER_ROLE),
  ].join("|");

function sessionsOf(rows: string[]): Session[] {
  const parsed = parseSessions([`${ROW_COUNT} ${rows.length}`, ...rows, SESSION_SENTINEL].join("\n"));
  expect(parsed.failure).toBeNull();
  return parsed.sessions;
}

function refusal(rows: string[]): string {
  const v = decideOverseerRestart(sessionsOf(rows));
  expect(v.kind).toBe("refused");
  return v.kind === "refused" ? v.why : "";
}

describe("deciding whether the Overseer can be resumed", () => {
  it("resumes the holder's own CLAUDE_SESSION_ID, in its own launch directory", () => {
    const list = sessionsOf([row({ sid: "$1", name: "other", role: "" }), row({ sid: "$7", name: "Overseer" })]);
    expect(decideOverseerRestart(list)).toEqual({
      kind: "restart",
      id: "$7",
      name: "Overseer",
      conversationId: UUID,
      dir: DIR,
    });
  });

  it("refuses when nobody holds the claim", () => {
    expect(refusal([row({ role: "" })])).toContain("no session holds the overseer claim");
  });

  it("refuses a contested claim rather than picking one", () => {
    expect(refusal([row({ sid: "$1", name: "a" }), row({ sid: "$2", name: "b" })])).toMatch(/2 sessions/);
  });

  it("refuses when a role could not be read", () => {
    expect(refusal([row({ sid: "$1", name: "a" }), row({ sid: "$2", name: "b", role: "Over Seer!" })])).toBeTruthy();
  });

  it("REFUSES WHILE ANYTHING RUNS IN THE PANE — it never kills or interrupts", () => {
    // `claude`: the Overseer is up. `busy`: something else is — which is how
    // `ls` reads a `claude --resume Overseer`, the very footgun.
    expect(refusal([row({ proc: "claude" })])).toMatch(/\/exit/);
    expect(refusal([row({ proc: "busy" })])).toMatch(/\/exit/);
    expect(refusal([row({ proc: "wait:30" })])).toBeTruthy();
    expect(refusal([row({ proc: "?" })])).toBeTruthy();
  });

  it("refuses a holder with no conversation id, or one that is not a lower-case uuid", () => {
    expect(refusal([row({ id: "" })])).toMatch(/CLAUDE_SESSION_ID/);
    expect(refusal([row({ id: UUID.toUpperCase() })])).toMatch(/CLAUDE_SESSION_ID/);
    expect(refusal([row({ id: "Overseer" })])).toMatch(/CLAUDE_SESSION_ID/);
  });

  it("refuses a legacy session with no launch directory — the project's settings matter", () => {
    expect(refusal([row({ legacy: true })])).toMatch(/directory/);
  });
});

describe("the box-side command", () => {
  it("requires an exact receipt and a successful exit", () => {
    expect(overseerRestartSucceeded({ status: 0, stdout: "GJD_TYPED\n" })).toBe(true);
    for (const status of [null, 3, 4, 5, 255]) {
      expect(overseerRestartSucceeded({ status, stdout: "GJD_TYPED\n" })).toBe(false);
    }
    for (const stdout of ["", "NOT_GJD_TYPED", "GJDERR failed\nGJD_TYPED", "noise GJD_TYPED"]) {
      expect(overseerRestartSucceeded({ status: 0, stdout })).toBe(false);
    }
  });
  it("throws on anything that is not tmux's id, a lower-case uuid, or an absolute directory", () => {
    const ok = { id: "$7", conversationId: UUID, dir: DIR };
    expect(() => resumeOverseerCommand(ok)).not.toThrow();
    expect(() => resumeOverseerCommand({ ...ok, id: "Overseer" })).toThrow();
    expect(() => resumeOverseerCommand({ ...ok, conversationId: "Overseer" })).toThrow();
    expect(() => resumeOverseerCommand({ ...ok, dir: "relative/dir" })).toThrow();
  });

  it("refuses a directory carrying a terminal control byte — quoting cannot stop send-keys delivering it", () => {
    for (const c of ["\n", "\r", "\t", "\x1b", "\x03", "\x00", "\x7f"]) {
      expect(() => overseerResumeLine({ conversationId: UUID, dir: `/home/greg/a${c}b` })).toThrow(/control/);
    }
  });

  it("types the uuid, never a name, and carries the launch's permission mode", () => {
    expect(overseerResumeLine({ conversationId: UUID, dir: DIR })).toBe(
      `cd -- '${DIR}' && claude --resume ${UUID} --permission-mode auto`,
    );
    expect(resumeOverseerCommand({ id: "$7", conversationId: UUID, dir: DIR })).toContain("'$7'");
  });
});

/** Execute the generated bash, even where the sandbox forbids tmux sockets. */
describe("against captured tmux replies", () => {
  function runCaptured(cur: string, cx: number, below = "", previous = "", failSend = 0, uuid = "00000000-0000-4000-8000-000000000000", pgrepStatus = 1) {
    const dir = mkdtempSync(path.join(tmpdir(), "gjd-restart-capture-"));
    const sends = path.join(dir, "sends");
    const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
    try {
      const stub = `#!/bin/bash
[ "$1" = -S ] || exit 90
shift 2
case "$1" in
  list-panes) printf '%%1 999999\\n';;
  show-environment) case "\${@: -1}" in
    GJD_ROLE) printf 'GJD_ROLE=overseer\\n';;
    CLAUDE_SESSION_ID) printf '%s\\n' ${quote(`CLAUDE_SESSION_ID=${uuid}`)};;
    GJD_REMOTE_DIR) printf 'GJD_REMOTE_DIR=/tmp\\n';;
  esac;;
  display-message) printf '0 0 ${cx} 1 bash 120 20\\n';;
  capture-pane) case "$*" in
    *' -J '*) printf '%s\\n' ${quote(previous.length >= 120 ? `${previous}${cur}` : `${previous}\n${cur}`)};;
    *' -S 1 -E 1') printf '%s\\n' ${quote(cur)};;
    *) printf '%s\\n' ${quote(`${previous}\n${cur}\n${below}`)};;
  esac;;
  send-keys) printf '%s\\n' "$*" >> ${quote(sends)}; mapfile -t sent < ${quote(sends)}; [ "\${#sent[@]}" -ne ${failSend} ] || exit 1;;
  *) exit 91;;
esac
`;
      writeFileSync(path.join(dir, "tmux"), stub);
      writeFileSync(path.join(dir, "pgrep"), `#!/bin/sh\nexit ${pgrepStatus}\n`);
      for (const name of ["tmux", "pgrep"]) chmodSync(path.join(dir, name), 0o755);
      const cmd = resumeOverseerCommand({ id: "$1", conversationId: "00000000-0000-4000-8000-000000000000", dir: "/tmp" })
        .replaceAll("tmux ", `tmux -S ${quote(path.join(dir, "sock"))} `);
      let status = 0;
      let out = "";
      try {
        out = execFileSync("bash", ["-c", cmd], {
          encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PATH: `${dir}:${process.env["PATH"]}` },
        });
      } catch (e) {
        const err = e as { status: number; stdout: string };
        status = err.status;
        out = err.stdout;
      }
      return { status, out, sends: existsSync(sends) ? readFileSync(sends, "utf8") : "" };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it.each(["bash-5.2$ ", "bash-5.2# ", "greg@gjd-remote:~/code/spideryarn2$ "])("accepts ordinary empty prompt %s", (prompt) => {
    const r = runCaptured(prompt, prompt.length);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toBe("GJD_TYPED\n");
    expect(r.sends.split("\n").filter(Boolean)).toHaveLength(2);
  });

  it.each([
    ["bash-5.2$ read x # ", 19, "", ""],
    ["bash-5.2$ ", 10, "read x", ""],
    ["界$ ", 4, "", ""],
    ["bash-5.2$ á", 11, "", ""],
    ["bash-5.2$ ", 10, "", "x".repeat(120)],
  ])("refuses unsafe capture %j without sending keys", (cur, cx, below, previous) => {
    const r = runCaptured(String(cur), Number(cx), String(below), String(previous));
    expect(r.status, r.out).toBe(3);
    expect(r.sends).toBe("");
  });

  it.each([1, 2])("reports failure of send %i with no success receipt", (failSend) => {
    const r = runCaptured("bash-5.2$ ", 10, "", "", failSend);
    expect(r.status, r.out).toBe(4);
    expect(r.out).not.toContain("GJD_TYPED");
    expect(r.sends.split("\n").filter(Boolean)).toHaveLength(failSend);
  });

  it("refuses a UUID changed since the listing without sending keys", () => {
    const r = runCaptured("bash-5.2$ ", 10, "", "", 0, "00000000-0000-4000-8000-000000000001");
    expect(r.status, r.out).toBe(5);
    expect(r.out).toContain("metadata changed");
    expect(r.sends).toBe("");
  });

  it.each([0, 2])("refuses pgrep status %i without sending keys", (status) => {
    const r = runCaptured("bash-5.2$ ", 10, "", "", 0, "00000000-0000-4000-8000-000000000000", status);
    expect(r.status, r.out).toBe(3);
    expect(r.sends).toBe("");
  });
});

/** tmux, bash and GNU ps, or the real-tmux half is skipped. */
function usable(): boolean {
  const probe = mkdtempSync(path.join(tmpdir(), "gjd-restart-probe-"));
  try {
    execFileSync("tmux", ["-S", path.join(probe, "sock"), "-V"], { stdio: "ignore" });
    execFileSync("ps", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

describe.runIf(usable())("against a real tmux server", () => {
  /*
   * THREE GUARDS AGAINST REACHING A REAL CLAUDE, because the first version of
   * this block did. Its pane got the stub through `tmux new-session -e PATH=…`,
   * the typed `claude` resolved to the real one anyway, and with the live
   * Overseer's uuid in the line it resumed that conversation from a test pane
   * for about five seconds — appending records to its transcript — until
   * `kill-server` ended it. 2026-10-10; see the plan doc. So:
   *  1. a uuid that names no conversation anywhere;
   *  2. every pane's shell starts under `env -i` with PATH = the stub's
   *     directory ONLY and HOME = a scratch directory, so no other `claude` is
   *     findable and none could find a transcript;
   *  3. before the one test that expects typing, the pane is asked what
   *     `claude` resolves to, and the test stops unless it is the stub.
   */
  const FAKE = "00000000-0000-4000-8000-000000000000";
  const dir = mkdtempSync(path.join(tmpdir(), "gjd-restart-overseer-"));
  const sock = path.join(dir, "sock");
  const bin = path.join(dir, "bin");
  const badBin = path.join(dir, "bad-bin");
  const home = path.join(dir, "home");
  // Every character `shq` has to neutralise, as a literal path.
  const work = path.join(dir, "work 'q' $(false); `x` & *");
  const record = path.join(dir, "argv");
  const which = path.join(dir, "which");
  const shell = `/usr/bin/env -i PATH=${bin} HOME=${home} TERM=xterm /bin/bash --norc --noprofile -i`;
  const tmux = (...args: string[]): string =>
    execFileSync("tmux", ["-S", sock, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let made = 0;

  /** A fresh session at an empty prompt, by name; returns its tmux id. */
  async function fresh(): Promise<string> {
    const name = `s${made++}`;
    tmux("new-session", "-d", "-s", name, "-x", "120", "-y", "20", shell);
    tmux("set-environment", "-t", `${name}:`, "GJD_ROLE", OVERSEER_ROLE);
    tmux("set-environment", "-t", `${name}:`, "CLAUDE_SESSION_ID", FAKE);
    tmux("set-environment", "-t", `${name}:`, "GJD_REMOTE_DIR", work);
    const ready = () => /^bash-[0-9.]+[$#]( |$)/m.test(tmux("capture-pane", "-p", "-t", `${name}:`));
    for (let i = 0; i < 50 && !ready(); i++) await sleep(50);
    expect(ready(), "the isolated bash pane must reach its default prompt").toBe(true);
    return tmux("display-message", "-p", "-t", `${name}:`, "#{session_id}").trim();
  }
  const keys = (id: string, ...k: string[]) => tmux("send-keys", "-t", `${id}:`, ...k);
  const screen = (id: string) => tmux("capture-pane", "-p", "-t", `${id}:`);

  function run(id: string, extraPath?: string): { status: number; out: string } {
    const cmd = resumeOverseerCommand({ id, conversationId: FAKE, dir: work }).replaceAll("tmux ", `tmux -S ${sock} `);
    const env = extraPath ? { ...process.env, PATH: `${extraPath}:${process.env["PATH"] ?? ""}` } : process.env;
    try {
      return { status: 0, out: execFileSync("bash", ["-c", cmd], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }) };
    } catch (e) {
      const err = e as { status: number; stdout: string };
      return { status: err.status, out: err.stdout };
    }
  }
  async function waitFor(file: string): Promise<boolean> {
    for (let i = 0; i < 50; i++) {
      if (existsSync(file)) return true;
      await sleep(100);
    }
    return false;
  }
  /** Set a pane up, then assert the command refuses with `why` and types nothing. */
  async function refuses(setUp: (id: string) => void | Promise<void>, why: RegExp, extraPath?: string, status = 3) {
    const id = await fresh();
    await setUp(id);
    await sleep(300);
    const before = screen(id);
    const r = run(id, extraPath);
    expect(r.status, r.out).toBe(status);
    expect(r.out).toMatch(why);
    expect(r.out).toContain("nothing was typed");
    await sleep(200);
    expect(screen(id)).toBe(before);
  }

  beforeAll(() => {
    for (const d of [bin, badBin, home, work]) mkdirSync(d, { recursive: true });
    // The stub records its argv one per line, then its working directory.
    // Absolute paths only: its PATH holds nothing but itself.
    const r = JSON.stringify(record);
    writeFileSync(path.join(bin, "claude"), `#!/bin/bash\n{ printf '%s\\n' "$@"; pwd; } > ${r}.tmp && /bin/mv ${r}.tmp ${r}\n`);
    chmodSync(path.join(bin, "claude"), 0o755);
    // A pgrep that fails the way a broken one does: neither "found" nor "none".
    writeFileSync(path.join(badBin, "pgrep"), "#!/bin/sh\nexit 2\n");
    chmodSync(path.join(badBin, "pgrep"), 0o755);
  });

  afterAll(() => {
    try {
      tmux("kill-server");
    } catch {
      /* already gone */
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("types the resume into a shell at an empty prompt, in the launch directory", async () => {
    const id = await fresh();
    // Guard 3: the `claude` this pane would run is the stub, or nothing is typed.
    keys(id, "-l", `command -v claude > ${which}`);
    keys(id, "Enter");
    expect(await waitFor(which)).toBe(true);
    expect(readFileSync(which, "utf8").trim()).toBe(path.join(bin, "claude"));
    await sleep(200);

    const r = run(id);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("GJD_TYPED");
    expect(await waitFor(record), screen(id)).toBe(true);
    const lines = readFileSync(record, "utf8").trimEnd().split("\n");
    expect(lines).toEqual(["--resume", FAKE, "--permission-mode", "auto", work]);
  });

  it("refuses a half-typed line rather than erasing it", async () => {
    await refuses((id) => void keys(id, "-l", "half typed"), /input line|empty shell prompt/);
  });

  it("refuses unfinished input ending in a prompt marker", async () => {
    await refuses((id) => void keys(id, "-l", "read x # "), /input line|empty shell prompt/);
  });

  it("types below a full-width line that did NOT wrap — what Claude Code leaves when it exits", async () => {
    const id = await fresh();
    keys(id, "-l", "printf '%s\\n' " + "-".repeat(120));
    keys(id, "Enter");
    await sleep(300);
    const r = run(id);
    expect(r.status, `${r.out}\n${screen(id)}`).toBe(0);
    expect(r.out).toContain("GJD_TYPED");
  });

  it("refuses wrapped input hidden below the cursor row", async () => {
    await refuses((id) => {
      keys(id, "-l", `${" ".repeat(140)}read x`);
      keys(id, "C-a");
    }, /input line|empty shell prompt/);
  });

  it("refuses a wide-character prompt rather than slicing display columns as characters", async () => {
    await refuses((id) => {
      keys(id, "-l", "PS1='界$ '");
      keys(id, "Enter");
      keys(id, "-l", "read x # ");
    }, /input line|empty shell prompt/);
  });

  it("refuses text AFTER the cursor too", async () => {
    await refuses((id) => {
      keys(id, "-l", "abc");
      keys(id, "C-a");
    }, /input line/);
  });

  it("refuses a continuation prompt — the typed line would join an earlier command", async () => {
    await refuses((id) => {
      keys(id, "-l", "echo one \\");
      keys(id, "Enter");
    }, /empty shell prompt/);
  });

  it("refuses a builtin `read`, which has no child process to find", async () => {
    await refuses((id) => {
      keys(id, "-l", "read x");
      keys(id, "Enter");
    }, /empty shell prompt/);
  });

  it("refuses a pane with a child running in it", async () => {
    await refuses((id) => {
      keys(id, "-l", "/bin/sleep 30");
      keys(id, "Enter");
    }, /not sitting at its bash shell|running/);
  });

  it("refuses a shell back at its prompt with a background child — only pgrep sees that one", async () => {
    await refuses((id) => {
      keys(id, "-l", "/bin/sleep 30 &");
      keys(id, "Enter");
      keys(id, "C-l");
    }, /something is running/);
  });

  it("refuses a pane in copy mode", async () => {
    await refuses((id) => void tmux("copy-mode", "-t", `${id}:`), /copy mode/);
  });

  it("refuses when pgrep fails, rather than reading the failure as 'nothing running'", async () => {
    await refuses(() => undefined, /could not check/, badBin);
  });

  it("refuses when the claim was released after the listing", async () => {
    await refuses((id) => void tmux("set-environment", "-u", "-t", id, "GJD_ROLE"), /metadata changed/, undefined, 5);
  });

  it("refuses when the launch directory changed after the listing", async () => {
    await refuses((id) => void tmux("set-environment", "-t", id, "GJD_REMOTE_DIR", home), /metadata changed/, undefined, 5);
  });

  it("refuses a session with more than one pane", async () => {
    await refuses((id) => void tmux("split-window", "-t", `${id}:`, shell), /more than one pane/);
  });
});
