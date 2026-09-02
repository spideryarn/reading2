/**
 * The prompt wrapper, both halves: the refusals, which need no terminal, and
 * the prompts themselves, which need a real one.
 *
 * The refusal half is ordinary unit testing. The other half cannot be: a
 * checkbox is raw-mode cursor arithmetic, and `@inquirer/core` explicitly
 * discards any keystroke that arrives before its first render (see the
 * `setImmediate` comment in create-prompt.js), so feeding a fake stream and
 * asserting on strings would prove nothing about what a person typing sees. So
 * these run the real prompts inside a real pty, the same way
 * tests/gjd-remote-tab-lifecycle.test.ts runs the real CLI: `script(1)` gives
 * the pty, a FIFO carries the keystrokes, and the child writes its answer to a
 * file rather than to the recording, because the recording is full of escape
 * sequences that can split any marker you try to grep for.
 *
 * macOS only, for the same two reasons as that file: `script(1)`'s arguments
 * differ on Linux, and gjd-remote's prompts only ever happen on the laptop —
 * the box's end of this tool is ssh and tmux, neither of which asks anything.
 */
import { execFileSync, spawn } from "node:child_process";
import {
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
import { PassThrough } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Cancelled, checklistOrRefuse, confirmOrRefuse, NotInteractive } from "../scripts/gjd-remote-prompt.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "gjd-remote-prompt-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A readable that is not a terminal — what fd 0 is after `-p -` has drained it.
 * A fresh PassThrough rather than `process.stdin`, which would mean setting
 * `isTTY = false` on the real one and breaking whatever ran next.
 */
function notATerminal(): { input: NodeJS.ReadableStream & { isTTY?: boolean }; output: NodeJS.WritableStream } {
  return { input: new PassThrough(), output: process.stdout };
}

describe("refusing when there is no terminal", () => {
  it("confirmOrRefuse throws NotInteractive when there is no controlling terminal", async () => {
    const err = await confirmOrRefuse("Clone it?", null, { instead: "gjd-remote clone && gjd-remote setup" }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NotInteractive);
    expect((err as Error).message).toContain("no terminal");
    // The point of the refusal: it names something the user can run instead.
    expect((err as Error).message).toContain("gjd-remote clone && gjd-remote setup");
  });

  it("confirmOrRefuse throws NotInteractive when the stream is not a TTY", async () => {
    const err = await confirmOrRefuse("Clone it?", notATerminal()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotInteractive);
    // No `instead` given, so the generic alternative has to be there.
    expect((err as Error).message).toContain("Run this again from a terminal");
  });

  it("checklistOrRefuse throws NotInteractive with no terminal, and with a non-TTY stream", async () => {
    const items = [{ value: "OPENROUTER_API_KEY" as const, label: "OPENROUTER_API_KEY", checked: true }];
    const noTty = await checklistOrRefuse({ message: "Which keys?", items, io: null, instead: "edit the toml by hand" })
      .then(() => undefined)
      .catch((e: unknown) => e);
    expect(noTty).toBeInstanceOf(NotInteractive);
    expect((noTty as Error).message).toContain("edit the toml by hand");

    const notTty = await checklistOrRefuse({ message: "Which keys?", items, io: notATerminal() })
      .then(() => undefined)
      .catch((e: unknown) => e);
    expect(notTty).toBeInstanceOf(NotInteractive);
    expect((notTty as Error).message).toContain("Run this again from a terminal");
  });

  it("checklistOrRefuse rejects an empty item list rather than showing an unanswerable prompt", async () => {
    const err = await checklistOrRefuse({ message: "Which keys?", items: [], io: null })
      .then(() => undefined)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NotInteractive);
    expect((err as Error).message).toContain("no items");
  });
});

/**
 * Run one expression from the wrapper inside a pty, type `keys` at it, and give
 * back what it resolved or rejected with.
 *
 * `body` is an expression evaluated in a generated module; it gets `io`, a
 * PromptIo over the pty. The marker file is written just before the prompt is
 * awaited and the keystrokes wait on it plus a beat, because keys typed before
 * inquirer's first render are deliberately thrown away — send them early and
 * every one of these tests would hang instead of failing.
 */
function inPty(body: string, keys: string | readonly string[]): Promise<{ ok?: unknown; err?: string; log: string }> {
  const marker = path.join(dir, "started");
  const resultPath = path.join(dir, "result.json");
  // `.mts`, not `.ts`: the temp directory has no package.json, so tsx reads a
  // `.ts` file there as CommonJS and esbuild refuses the top-level await with
  // "Top-level await is currently not supported with the cjs output format".
  // The child then dies before writing the marker, and the harness waits out
  // its full deadline — a transform error that presents as a hang.
  const child = path.join(dir, "child.mts");
  writeFileSync(
    child,
    `import { writeFileSync } from "node:fs";\n` +
      `import { checklistOrRefuse, confirmOrRefuse, promptIo } from ${JSON.stringify(path.join(REPO, "scripts/gjd-remote-prompt.ts"))};\n` +
      `const io = promptIo("inherit");\n` +
      `writeFileSync(${JSON.stringify(marker)}, "");\n` +
      `try {\n` +
      `  const ok = await (${body});\n` +
      `  writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ ok }));\n` +
      `} catch (e) {\n` +
      `  writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ err: (e as Error).name }));\n` +
      `}\n`,
  );

  const recording = path.join(dir, "typescript");
  const fifo = path.join(dir, "stdin");
  execFileSync("mkfifo", [fifo]);
  // O_RDWR so the FIFO never sees EOF before we have typed; `cat` feeding
  // `script` is the only stdin `script` will accept (a socketpair or a FIFO
  // handed to it directly makes it die in tcgetattr) — the same wall
  // tests/gjd-remote-tab-lifecycle.test.ts documents at length.
  const keyboard = openSync(fifo, constants.O_RDWR);
  const tsx = path.join(REPO, "node_modules/.bin/tsx");
  const errPath = path.join(dir, "stderr");
  const err = openSync(errPath, "w");
  const proc = spawn("sh", ["-c", `cat "$1" | script -q "$2" "$3" "$4"`, "sh", fifo, recording, tsx, child], {
    cwd: REPO,
    stdio: ["ignore", "ignore", err],
    env: { ...process.env, TERM: "xterm-256color", FORCE_COLOR: "0" },
  });

  return new Promise((resolve, reject) => {
    proc.on("error", reject);
    const deadline = Date.now() + 30_000;
    let typed = false;
    const waiting = setInterval(() => {
      if (typed) return;
      if (!existsSync(marker) && Date.now() < deadline) return;
      typed = true;
      // One burst per prompt, spaced out. The marker says the child reached the
      // first call, not that inquirer has rendered — a render is a setImmediate
      // plus a write into the pty — and a second prompt discards anything typed
      // before ITS first render too, so a two-prompt body needs its answers in
      // two bursts or the second one waits for a key that already went by.
      const bursts = typeof keys === "string" ? [keys] : keys;
      let next = 0;
      const type = () => {
        const burst = bursts[next++];
        if (burst === undefined) {
          // Give the child time to answer and exit before the FIFO's only
          // writer goes away, which is what ends `cat` and the pipeline.
          setTimeout(() => {
            clearInterval(waiting);
            try {
              closeKeyboard();
            } catch {
              /* already closed by the close handler */
            }
          }, 1_500);
          return;
        }
        writeSync(keyboard, burst);
        setTimeout(type, 700);
      };
      setTimeout(type, 500);
    }, 50);

    let open = true;
    const closeKeyboard = () => {
      if (!open) return;
      open = false;
      closeSync(keyboard);
    };

    proc.on("close", () => {
      clearInterval(waiting);
      closeKeyboard();
      closeSync(err);
      const log =
        (existsSync(recording) ? readFileSync(recording, "utf8") : "") +
        (existsSync(errPath) ? readFileSync(errPath, "utf8") : "");
      // An empty result file and a wrong answer look nothing alike, but an
      // absent one and a hang look identical — so the recording and the
      // child's stderr ride along into the assertion message.
      if (!existsSync(resultPath)) {
        resolve({ log });
        return;
      }
      resolve({ ...(JSON.parse(readFileSync(resultPath, "utf8")) as { ok?: unknown; err?: string }), log });
    });
  });
}

const macOnly = process.platform === "darwin" ? describe : describe.skip;

macOnly("answering for real, in a pty", () => {
  it("confirmOrRefuse returns true when you type y", async () => {
    const r = await inPty(`confirmOrRefuse("Clone spideryarn/reading2 to ~/code/spideryarn2?", io)`, "y\r");
    expect(r, r.log).toMatchObject({ ok: true });
  }, 60_000);

  it("confirmOrRefuse returns the default when you just press Enter", async () => {
    const r = await inPty(`confirmOrRefuse("Clone it?", io)`, "\r");
    expect(r, r.log).toMatchObject({ ok: false });
  }, 60_000);

  it("confirmOrRefuse turns Ctrl-C into Cancelled, not a stack trace", async () => {
    const r = await inPty(`confirmOrRefuse("Clone it?", io)`, "");
    expect(r, r.log).toMatchObject({ err: new Cancelled().name });
  }, 60_000);

  const CHECKLIST =
    `checklistOrRefuse({ message: "Which keys?", io, items: [` +
    `{ value: "ALPHA", label: "ALPHA", description: "local dev only", checked: true },` +
    `{ value: "BETA", label: "BETA", checked: false },` +
    `{ value: "GAMMA", label: "GAMMA", description: "production secret", checked: false }] })`;

  it("checklistOrRefuse returns only the pre-ticked items when you press Enter", async () => {
    const r = await inPty(CHECKLIST, "\r");
    expect(r, r.log).toMatchObject({ ok: ["ALPHA"] });
  }, 60_000);

  it("the 'a' shortcut ticks everything, and Enter returns all of it", async () => {
    const r = await inPty(CHECKLIST, "a\r");
    expect(r, r.log).toMatchObject({ ok: ["ALPHA", "BETA", "GAMMA"] });
  }, 60_000);

  it("'a' again unticks everything, so it is one key for all and none", async () => {
    const r = await inPty(CHECKLIST, "aa\r");
    expect(r, r.log).toMatchObject({ ok: [] });
  }, 60_000);

  /**
   * Two prompts in a row, because inquirer pipes its output through a
   * MuteStream and `end()`s it when a prompt finishes, and a legacy stream's
   * `pipe` ends its destination by default. If that reached the real stdout the
   * first prompt would work and every prompt after it would draw nothing —
   * exactly the confirm-then-checklist shape Stage 3 needs, and not something
   * a single-prompt test could ever notice.
   */
  it("a second prompt still works after the first has finished", async () => {
    const r = await inPty(`(async () => [await confirmOrRefuse("One?", io), await confirmOrRefuse("Two?", io)])()`, [
      "y\r",
      "y\r",
    ]);
    expect(r, r.log).toMatchObject({ ok: [true, true] });
  }, 60_000);
});
