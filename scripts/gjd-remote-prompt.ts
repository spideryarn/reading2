/**
 * The two interactive questions gjd-remote asks — a yes/no and a checklist —
 * and the ONLY file that imports `@inquirer/prompts`. One door, so the
 * dependency can be swapped or dropped by rewriting this file alone, and so
 * nothing else in the tool has to know about prompt contexts, raw mode or
 * `ExitPromptError`. Chosen over `@clack/prompts` and over hand-rolled
 * `readline` in docs/research/260902a-tui-prompt-library-for-gjd-remote.md.
 *
 * **Streams are always explicit, never `process.stdin`.** gjd-remote can read
 * its prompt text off stdin (`new-claude -p -`), which spends fd 0; from then
 * on the keyboard is a freshly-opened `/dev/tty` and `process.stdin` is an
 * exhausted pipe. Every function here takes the streams to use and passes them
 * to inquirer's `context` argument, so a prompt reached after `-p -` reads the
 * keyboard rather than an EOF. `interactiveStdin()` in scripts/gjd-remote.ts is
 * where that fd comes from; `promptIo()` below turns its answer into the shape
 * these functions want, and callers should use it rather than building one by
 * hand — see the warning on it.
 *
 * **The refusal is ours, not the library's.** Handed a non-TTY, inquirer does
 * not throw: `@inquirer/core` guards its raw-mode call behind `isTTY` and then
 * sits there waiting for a keypress that cannot arrive. So we check `isTTY`
 * ourselves, before the library is called, and throw `NotInteractive` with a
 * message naming what to run instead. A hang and a refusal look identical from
 * the outside for the first few seconds, and only one of them ends.
 */
import { checkbox, confirm } from "@inquirer/prompts";
import { openSync } from "node:fs";
import { ReadStream, WriteStream } from "node:tty";

/**
 * The streams a prompt talks on. `isTTY` is optional because Node only puts it
 * on tty-backed streams, and its absence is exactly the "not a terminal" case
 * these functions refuse on.
 */
export type PromptIo = {
  input: NodeJS.ReadableStream & { isTTY?: boolean };
  output: NodeJS.WritableStream;
};

/**
 * No terminal to ask on. The caller should `die(err.message)`: the message is
 * written in the tool's voice, first line lower-case, later lines indented,
 * and it names something the user can actually run.
 */
export class NotInteractive extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotInteractive";
  }
}

/**
 * What `main()` prints for a cancellation nobody described any further. True
 * for a Ctrl-C at the first question, and only there: once something has been
 * done, the caller re-throws a `Cancelled` that says what remains.
 */
export const CANCELLED_NOTHING_CHANGED = "cancelled, nothing changed";

/**
 * The user pressed Ctrl-C, or the prompt was aborted, and gave no answer.
 *
 * **The message travels**, and `main()` in scripts/gjd-remote.ts prints it —
 * GPT Sol's Stage 3 finding 4. The single sentence this used to be replaced
 * with was always "nothing changed", which is false at the second question of
 * `cloneThenSetUp`: the clone has happened by then and the tree is on the box.
 * A caller that knows more than the prompt does re-throws with the fuller
 * sentence, and the exit code stays 130 either way.
 */
export class Cancelled extends Error {
  constructor(message = CANCELLED_NOTHING_CHANGED) {
    super(message);
    this.name = "Cancelled";
  }
}

/**
 * Inquirer's three "no answer" errors, recognised by `name` rather than by
 * `instanceof`.
 *
 * `@inquirer/prompts` re-exports the prompts and nothing else — the error
 * classes live in `@inquirer/core`, which is a transitive dependency here, not
 * a declared one. Importing it would be a second door onto the library, and a
 * lockfile change away from resolving to a different copy than the one the
 * prompts throw from, at which point `instanceof` silently says no and a Ctrl-C
 * comes out as a stack trace. The `name` fields are set as literals in
 * `@inquirer/core`'s errors.js and are part of its documented surface.
 */
function isNoAnswer(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "ExitPromptError" || error.name === "CancelPromptError" || error.name === "AbortPromptError";
}

/**
 * Where a prompt would draw, and how the controlling terminal gets opened.
 * Injected so a test can hand in a stdout that is not a terminal without
 * redirecting the real one out from under the rest of the suite.
 */
export type PromptStreams = {
  stdout: NodeJS.WritableStream & { isTTY?: boolean };
  /** Opens `/dev/tty` for writing. Throws when the process has no terminal. */
  openTty: () => NodeJS.WritableStream;
};

const REAL_STREAMS: PromptStreams = {
  stdout: process.stdout,
  // The fd is deliberately never closed: it lives as long as the process, and
  // closing it would take the prompt's own output with it.
  openTty: () => new WriteStream(openSync("/dev/tty", "w")),
};

/**
 * The streams for a keyboard, from whatever `interactiveStdin()` returned.
 *
 * Worth using rather than assembling a `PromptIo` by hand, for two reasons.
 *
 * **Input.** The obvious way to wrap the `/dev/tty` fd —
 * `createReadStream(null, { fd })` — produces a stream with **no `isTTY`**, and
 * every prompt here would then refuse in precisely the `-p -` case the fd was
 * opened for. `tty.ReadStream` is the one that carries `isTTY`.
 *
 * **Output, which is not stdout once stdout stops being a terminal.**
 * `gjd-remote … > out.txt` sends fd 1 to a file, and the question then goes
 * into the file while the terminal shows a cursor waiting for an answer to
 * something nobody can read — a prompt that presents as a hang. So the question
 * goes to `/dev/tty`, the controlling terminal whatever fd 1 became. If there
 * is no controlling terminal to open, there is no terminal at all: this returns
 * `null`, and every function below turns that into `NotInteractive` rather than
 * printing into the pipe.
 *
 * The asymmetry is deliberate. The OUTPUT is upgraded; the INPUT never is. A
 * redirected stdin stays a non-TTY and the prompt refuses, because a command
 * that changes the box when nobody was there to say no is the thing being
 * avoided.
 */
export function promptIo(keyboard: number | "inherit" | null, streams: PromptStreams = REAL_STREAMS): PromptIo | null {
  if (keyboard === null) return null;
  const output = promptOutput(streams);
  if (output === null) return null;
  if (keyboard === "inherit") return { input: process.stdin, output };
  return { input: new ReadStream(keyboard), output };
}

function promptOutput(streams: PromptStreams): NodeJS.WritableStream | null {
  if (streams.stdout.isTTY) return streams.stdout;
  try {
    return streams.openTty();
  } catch {
    return null;
  }
}

/** What to tell the user to do instead, when there is no terminal. */
function refusal(what: string, instead: string | undefined): NotInteractive {
  return new NotInteractive(
    `${what}, and there is no terminal to ask on.\n` +
      (instead ? `  ${instead}` : "  Run this again from a terminal."),
  );
}

/**
 * A yes/no question. `false` unless `opts.default` says otherwise, because
 * every use of this so far guards something that costs time or writes to the
 * box, and Enter should not be the answer that does it.
 *
 * `opts.instead` is the line printed when there is no terminal; give it the
 * commands that do the same job non-interactively.
 */
export async function confirmOrRefuse(
  question: string,
  io: PromptIo | null,
  opts?: { default?: boolean; instead?: string },
): Promise<boolean> {
  if (io === null || !io.input.isTTY) throw refusal(`'${question}' needs a yes or no`, opts?.instead);
  try {
    return await confirm({ message: question, default: opts?.default ?? false }, { input: io.input, output: io.output });
  } catch (error) {
    if (isNoAnswer(error)) throw new Cancelled();
    throw error;
  }
}

/**
 * A checklist: some items pre-ticked, a one-line reason under whichever is
 * highlighted, space to toggle, `a` for all-or-none, Enter to accept.
 *
 * `a` and `i` (invert) are inquirer's own defaults, passed explicitly so that
 * this file says what the keys are and a change upstream cannot move them
 * quietly. The `all` handler is a genuine toggle: it ticks everything if
 * anything is unticked, and otherwise unticks everything.
 *
 * Returns the values of the ticked items, in the order they were given. An
 * empty return is a real answer — "none of them" — not a failure.
 *
 * **`disabled` is a row that cannot be ticked at all.** `push-env` has two of
 * them — a token that can delete the box, and a database URL pointing somewhere
 * that is not a loopback address — and they are shown rather than hidden,
 * because a key that quietly is not on the list is a key you go looking for. The
 * library refuses the space bar on one, skips it when arrowing, and — the part
 * that matters — excludes it from the `a` shortcut, which is `isSelectable` in
 * @inquirer/checkbox and is the reason "select all" cannot select these.
 *
 * The REASON travels as the `disabled` value rather than as `description`,
 * because inquirer only draws a description for the highlighted row and a
 * disabled row can never be highlighted. A `disabled` string is drawn on the row
 * itself, so the reason is on screen for exactly the rows that need one. Neither
 * this nor the library's refusal is the guarantee: `applyGuards` in
 * scripts/gjd-remote-envpolicy.ts re-applies both guards to whatever comes back,
 * because a checkbox library's `disabled` is presentation.
 */
export async function checklistOrRefuse<T extends string>(opts: {
  message: string;
  items: readonly { value: T; label: string; description?: string; checked: boolean; disabled?: boolean }[];
  io: PromptIo | null;
  instead?: string;
}): Promise<readonly T[]> {
  // A checklist with nothing on it renders as a prompt that cannot be answered.
  // That is a caller's bug, and it should say so rather than hang.
  if (opts.items.length === 0) throw new Error("checklistOrRefuse was given no items to choose from");
  if (opts.io === null || !opts.io.input.isTTY) throw refusal(`'${opts.message}' needs a choice`, opts.instead);
  const choices = opts.items.map((item) => {
    // Built field by field rather than with a conditional spread: a spread
    // launders the key name, so `descriptoin` in there would compile clean and
    // silently drop every reason line. Assigning to a typed local does not.
    const choice: {
      value: T;
      name: string;
      description?: string;
      checked: boolean;
      disabled?: boolean | string;
    } = {
      value: item.value,
      name: item.label,
      // A disabled row is never ticked, whatever the caller asked for. The
      // library would draw a ticked-and-disabled row and then return it from
      // the prompt, which is a row saying "this is going" about a key that is
      // not.
      checked: item.checked && item.disabled !== true,
    };
    if (item.description !== undefined) choice.description = item.description;
    // The description doubles as the disabled reason: see the docblock. `true`
    // when there is no description, which the library draws as "(disabled)" —
    // less useful, and still unmistakably not tickable.
    if (item.disabled === true) choice.disabled = item.description ?? true;
    return choice;
  });
  try {
    return await checkbox(
      { message: opts.message, choices, shortcuts: { all: "a", invert: "i" }, pageSize: 20 },
      { input: opts.io.input, output: opts.io.output },
    );
  } catch (error) {
    if (isNoAnswer(error)) throw new Cancelled();
    throw error;
  }
}
