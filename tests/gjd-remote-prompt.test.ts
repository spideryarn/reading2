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
import {
  Cancelled,
  checklistOrRefuse,
  confirmOrRefuse,
  NotInteractive,
  promptIo,
  type PromptStreams,
} from "../scripts/gjd-remote-prompt.js";

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
 * WHERE THE QUESTION IS DRAWN, which is not stdout once stdout is a file.
 *
 * `gjd-remote clone > out.txt` puts the question in the file and leaves the
 * terminal showing a cursor waiting for an answer to something nobody can read
 * — a prompt that presents as a hang. GPT Sol asked for this in Stage 1
 * (finding 9), against a version that always wrote to `process.stdout`.
 *
 * The streams are injected rather than mocked: setting `isTTY = false` on the
 * real `process.stdout` would break whatever ran next in the same worker.
 */
describe("choosing the output stream", () => {
  const streams = (isTTY: boolean, openTty: () => NodeJS.WritableStream): PromptStreams => ({
    stdout: Object.assign(new PassThrough(), { isTTY }),
    openTty,
  });

  it("uses stdout when stdout is a terminal", () => {
    const tty = new PassThrough();
    const s = streams(true, () => tty);
    expect(promptIo("inherit", s)?.output).toBe(s.stdout);
  });

  it("opens /dev/tty when stdout has been redirected", () => {
    const tty = new PassThrough();
    const s = streams(false, () => tty);
    const io = promptIo("inherit", s);
    expect(io?.output).toBe(tty);
    expect(io?.output).not.toBe(s.stdout);
  });

  /** No controlling terminal at all — cron, a daemon. `null` here is what every
   *  prompt turns into `NotInteractive`, rather than printing into the pipe. */
  it("gives up when there is no controlling terminal to open", async () => {
    const io = promptIo("inherit", {
      stdout: Object.assign(new PassThrough(), { isTTY: false }),
      openTty: () => {
        throw Object.assign(new Error("ENXIO: no such device or address, open '/dev/tty'"), { code: "ENXIO" });
      },
    });
    expect(io).toBeNull();
    await expect(confirmOrRefuse("Clone it?", io)).rejects.toBeInstanceOf(NotInteractive);
  });

  it("still refuses a null keyboard before it looks at the output at all", () => {
    let opened = false;
    expect(
      promptIo(null, {
        stdout: Object.assign(new PassThrough(), { isTTY: false }),
        openTty: () => {
          opened = true;
          return new PassThrough();
        },
      }),
    ).toBeNull();
    expect(opened).toBe(false);
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
 *
 * `ioExpr` is how `io` gets built, so the `-p -` shape — a numeric `/dev/tty`
 * fd rather than `"inherit"` — can be exercised as well. It has to be a real
 * pty for that: `tty.ReadStream` is what carries `isTTY`, and nothing short of
 * a terminal can tell the right wrapper from the wrong one.
 */
function inPty(
  body: string,
  keys: string | readonly string[],
  ioExpr = `promptIo("inherit")`,
): Promise<{ ok?: unknown; err?: string; log: string }> {
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
    `import { openSync, writeFileSync } from "node:fs";\n` +
      `import { checklistOrRefuse, confirmOrRefuse, promptIo } from ${JSON.stringify(path.join(REPO, "scripts/gjd-remote-prompt.ts"))};\n` +
      `const io = ${ioExpr};\n` +
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

  /**
   * THE REASON LINE, which is the whole point of the checklist over a list of
   * yes/no questions: the highlighted item explains itself, so "which of these
   * keys?" can be answered without going and looking each one up.
   *
   * It survived every other test here — deleting the line in
   * `checklistOrRefuse` that copies `description` onto the choice left the
   * suite green, which GPT Sol named in Stage 1 (finding 12). Nothing but the
   * recording can see it, because the description is drawn and never returned.
   */
  it("draws the highlighted item's description, so the reason is on screen", async () => {
    const r = await inPty(CHECKLIST, "\r");
    expect(r, r.log).toMatchObject({ ok: ["ALPHA"] });
    expect(r.log).toContain("local dev only");
  }, 60_000);

  /**
   * The `-p -` shape: fd 0 has been spent reading the prompt, so the keyboard
   * is a freshly-opened `/dev/tty` and `promptIo` is handed its number. Wrap
   * that fd the obvious way — `createReadStream(null, { fd })` — and the stream
   * has no `isTTY`, so every prompt refuses in exactly the case the fd was
   * opened for. Only a real terminal can tell the two apart.
   */
  it("promptIo wraps a raw /dev/tty fd as something the prompts accept", async () => {
    const r = await inPty(`confirmOrRefuse("Clone it?", io)`, "y\r", `promptIo(openSync("/dev/tty", "r"))`);
    expect(r, r.log).toMatchObject({ ok: true });
  }, 60_000);

  /**
   * And the same fd, examined rather than typed at — because answering through
   * it proves less than it looks. Inside this pty, `process.stdin` is the same
   * terminal, so a `promptIo` that ignored its fd and handed back
   * `process.stdin` would answer that test perfectly and break `-p -` in
   * production, where fd 0 is a drained pipe. Two facts kill both mutations:
   * the stream is the fd's own, and it carries `isTTY`.
   */
  it("the fd becomes its own stream, and one that carries isTTY", async () => {
    const r = await inPty(
      `Promise.resolve({ ownStream: io.input !== process.stdin, isTTY: io.input.isTTY === true })`,
      "",
      `promptIo(openSync("/dev/tty", "r"))`,
    );
    expect(r, r.log).toMatchObject({ ok: { ownStream: true, isTTY: true } });
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
   * A ROW THAT CANNOT BE TICKED, which is what the two hard guards look like on
   * screen: `push-env` shows the key and says why it is never sent, rather than
   * leaving it off the list, because a key that is quietly absent is a key you
   * go hunting for.
   *
   * Both halves are typed at for real, because they are different code paths in
   * the library and only one of them is the dangerous one: the space bar refuses
   * on an active disabled row, and `a` — "select all" — skips it. `a` is the one
   * that matters, because it is what a reader in a hurry presses.
   */
  const GUARDED =
    `checklistOrRefuse({ message: "Which keys?", io, items: [` +
    `{ value: "ALPHA", label: "ALPHA", description: "local dev only", checked: false },` +
    `{ value: "HETZNER_CLOUD_API_TOKEN", label: "HETZNER_CLOUD_API_TOKEN", ` +
    `description: "never sent: this key can destroy the box", checked: false, disabled: true },` +
    `{ value: "OMEGA", label: "OMEGA", checked: false }] })`;

  it("'a' ticks every row except the disabled one", async () => {
    const r = await inPty(GUARDED, "a\r");
    expect(r, r.log).toMatchObject({ ok: ["ALPHA", "OMEGA"] });
  }, 60_000);

  it("draws the disabled row with its reason, rather than hiding it", async () => {
    const r = await inPty(GUARDED, "a\r");
    expect(r.log).toContain("HETZNER_CLOUD_API_TOKEN");
    expect(r.log).toContain("never sent: this key can destroy the box");
  }, 60_000);

  /**
   * Aimed at the disabled row on purpose. The space bar cannot reach it —
   * arrowing skips a disabled row, so it never becomes the active one — but
   * inquirer's number keys jump straight to the nth choice and toggle it, which
   * is the one input that can name a row without walking to it. It must come
   * back unticked, and nothing else may be ticked in its place.
   */
  it("cannot be toggled by the number key that names it", async () => {
    const r = await inPty(GUARDED, "2\r");
    expect(r, r.log).toMatchObject({ ok: [] });
  }, 60_000);

  /** A caller that asks for a disabled row to start ticked is refused it —
   *  otherwise the prompt returns a key it has just said is never sent. */
  it("never returns a disabled row, even one the caller pre-ticked", async () => {
    const r = await inPty(
      `checklistOrRefuse({ message: "Which keys?", io, items: [` +
        `{ value: "ALPHA", label: "ALPHA", checked: true },` +
        `{ value: "DATABASE_URL_PROD", label: "DATABASE_URL_PROD", description: "never sent: not a loopback address", ` +
        `checked: true, disabled: true }] })`,
      "\r",
    );
    expect(r, r.log).toMatchObject({ ok: ["ALPHA"] });
  }, 60_000);

  /**
   * The checklist's own Ctrl-C, which the confirm test above did not cover:
   * they catch separately, so deleting the conversion from one of them leaves
   * the other's test green. An unconverted `ExitPromptError` reaches the CLI as
   * a stack trace instead of "cancelled." — and worse, `[]` from a checklist is
   * a real answer, so a Ctrl-C read as an answer would be read as "none of
   * them" and acted on.
   */
  it("checklistOrRefuse turns Ctrl-C into Cancelled, not a stack trace", async () => {
    const r = await inPty(CHECKLIST, "");
    expect(r, r.log).toMatchObject({ err: new Cancelled().name });
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
