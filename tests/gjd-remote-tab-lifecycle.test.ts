/**
 * The paint/un-paint lifecycle, driven through the real CLI in a real pty.
 *
 * `tests/gjd-remote-tab.test.ts` proves the bytes are right. It cannot prove the
 * feature works, and a reviewer said so plainly: every call site could be
 * deleted and that file would stay green. These tests run
 * `gjd-remote ssh` for real — a fake `ssh` on PATH, a fake host, and `script(1)`
 * to give it a pty — and read the recording back.
 *
 * The interrupt case is the one that earns its keep. `unpaint` runs after
 * `spawnSync` returns, and a Ctrl-C reaches the whole foreground process group,
 * so it used to kill this process too and the tab stayed violet forever.
 * `tunnel`'s documented way out is Ctrl-C, so that was the normal path, not an
 * edge case. What fixes it is an empty `SIGINT` listener in `runOnTheBox`, which
 * looks like dead code; delete it and the last test here goes red.
 *
 * macOS only: `script(1)`'s arguments differ on Linux, and iTerm is a Mac
 * program, so there is nothing to check on the box.
 */
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { colourSequence } from "../scripts/gjd-remote-tab.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIOLET = colourSequence({ r: 167, g: 139, b: 250 });
const RESET = colourSequence("default");
const RAN = "FAKE-SSH-RAN";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "gjd-remote-tab-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * An `ssh` that is first on PATH, says so twice, and then does what we tell it.
 *
 * Twice, because the two audiences need different things. `RAN` in the terminal
 * output is what the assertions read. The marker FILE is what the harness waits
 * on, and it has to be a file: `script` buffers its recording and flushes at
 * exit, so polling the recording to find out whether the child is running never
 * sees anything until the run is already over. That is not hypothetical — it is
 * what this test did at first, and the interrupt fired on the 20-second
 * fallback deadline every single time instead of when the child was ready,
 * which is how it came to fail under load on someone else's machine.
 */
function fakeSsh(body: string): void {
  const p = path.join(dir, "ssh");
  writeFileSync(p, `#!/bin/sh\n: > "${path.join(dir, "running")}"\nprintf '${RAN}\\n'\n${body}\n`);
  chmodSync(p, 0o755);
}

/**
 * Run `gjd-remote ssh` inside a pty and return the recording.
 *
 * `script(1)` is the pty: without it `process.stdout.isTTY` is false and
 * `canColourTab` correctly refuses, so the test would pass by testing nothing.
 *
 * The interrupt is a literal ^C byte written into `script`'s stdin, not
 * `process.kill`. `script` gives its child a new session, so signalling the
 * process group we spawned reaches `script` alone and the child sleeps on — the
 * first version of this test did exactly that and sat through the full 30
 * seconds. Feeding 0x03 to the pty makes the line discipline raise SIGINT for
 * the foreground group inside it, which is what a keyboard does.
 *
 * Getting a keystroke into `script`'s stdin took three tries, all of them the
 * same wall. `script` calls tcgetattr on its stdin and dies with
 * `tcgetattr/ioctl: Operation not supported on socket` unless it likes what it
 * finds — the trap `moshProbe` in gjd-remote.ts already records. Node's `"pipe"`
 * is a socketpair, so that fails; and macOS `script` rejects a **FIFO** too,
 * with the identical message. Only a real anonymous pipe works. Hence `cat
 * <fifo> | script …`: `cat` will read anything, and its stdout is the pipe
 * `script` wants. We write the ^C into the FIFO, opened `O_RDWR` so it never
 * reaches EOF and ends the session before we have interrupted it.
 *
 * Every one of those failures produced an EMPTY recording, which contains no
 * escape sequence and therefore looks exactly like a feature that painted
 * nothing — so the harness's own stderr is returned alongside the recording and
 * lands in the assertion message.
 */
function runCli(opts: { interrupt?: boolean } = {}): Promise<string> {
  const recording = path.join(dir, "typescript");
  const tsx = path.join(REPO, "node_modules/.bin/tsx");
  const cli = path.join(REPO, "scripts/gjd-remote.ts");
  const fifo = path.join(dir, "stdin");
  execFileSync("mkfifo", [fifo]);
  const keyboard = openSync(fifo, constants.O_RDWR);
  const errPath = path.join(dir, "stderr");
  const err = openSync(errPath, "w");
  const child = spawn("sh", ["-c", `cat "$1" | script -q "$2" "$3" "$4" ssh`, "sh", fifo, recording, tsx, cli], {
    cwd: REPO,
    stdio: ["ignore", "ignore", err],
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH ?? ""}`,
      TERM_PROGRAM: "iTerm.app",
      GJD_REMOTE_HOST: "203.0.113.1",
      // vitest sets CI, and every one of these is a reason canColourTab refuses.
      // Left in place they would make the test pass while painting nothing.
      CI: "",
      TMUX: "",
      STY: "",
      SSH_CONNECTION: "",
      SSH_TTY: "",
    },
  });

  const read = () => {
    try {
      return readFileSync(recording, "utf8");
    } catch {
      return "";
    }
  };

  // Releasing the FIFO's only writer is what ends `cat`, and therefore the shell
  // pipeline; `script` finishing is not enough. But it must not happen too
  // early: opening a FIFO for reading BLOCKS until a writer exists, so closing
  // before `cat` has opened it leaves `cat` waiting for a writer that will never
  // come, and the run hangs until the test times out. That is why both paths
  // wait for the recording to show the child running before touching it.
  let open = true;
  const releaseKeyboard = () => {
    if (!open) return;
    open = false;
    closeSync(keyboard);
  };

  return new Promise((resolve, reject) => {
    child.on("error", reject);

    // Purely a backstop now: a CLI that dies before it ever runs the child must
    // fail with its stderr rather than deadlock on a `cat` nobody released.
    const deadline = Date.now() + 30_000;
    const waiting = setInterval(() => {
      // Wait for the fake ssh to actually be running before interrupting, or
      // the ^C races the paint and the test proves nothing.
      if (!existsSync(path.join(dir, "running")) && Date.now() < deadline) return;
      clearInterval(waiting);
      if (opts.interrupt) writeSync(keyboard, "\u0003");
      releaseKeyboard();
    }, 50);

    child.on("close", () => {
      clearInterval(waiting);
      releaseKeyboard();
      closeSync(err);
      // The recording plus anything script or tsx complained about: a harness
      // that silently ran nothing looks identical to a feature that painted
      // nothing.
      resolve(read() + readFileSync(errPath, "utf8"));
    });
  });
}

const macOnly = process.platform === "darwin" ? describe : describe.skip;

macOnly("gjd-remote ssh, in a real pty", () => {
  it("paints before the child starts and resets after it exits", async () => {
    fakeSsh("exit 0");
    const out = await runCli();
    expect(out).toContain(RAN);
    expect(out.indexOf(VIOLET)).toBeGreaterThanOrEqual(0);
    expect(out.indexOf(VIOLET)).toBeLessThan(out.indexOf(RAN));
    expect(out.lastIndexOf(RESET)).toBeGreaterThan(out.indexOf(RAN));
  }, 60_000);

  it("resets the tab when the child is interrupted with Ctrl-C", async () => {
    fakeSsh("sleep 30");
    const out = await runCli({ interrupt: true });
    expect(out).toContain(RAN);
    expect(out).toContain(VIOLET);
    // The whole point. Before the empty SIGINT listener, the process died here
    // and this line never appeared.
    expect(out.lastIndexOf(RESET)).toBeGreaterThan(out.indexOf(RAN));
  }, 60_000);

  it("paints nothing when the environment says it must not", async () => {
    fakeSsh("exit 0");
    const outside = await new Promise<string>((resolve) => {
      // No `script`, so no pty: isTTY is false and the sequence must not be
      // written, because it would land in whatever is reading our stdout.
      const tsx = path.join(REPO, "node_modules/.bin/tsx");
      const child = spawn(tsx, [path.join(REPO, "scripts/gjd-remote.ts"), "ssh"], {
        cwd: REPO,
        env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}`, TERM_PROGRAM: "iTerm.app", GJD_REMOTE_HOST: "203.0.113.1" },
      });
      let out = "";
      child.stdout.on("data", (d) => {
        out += String(d);
      });
      child.on("close", () => resolve(out));
    });
    expect(outside).toContain(RAN);
    expect(outside).not.toContain(VIOLET);
    expect(outside).not.toContain(RESET);
  }, 60_000);
});
