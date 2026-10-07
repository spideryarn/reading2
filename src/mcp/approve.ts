/**
 * **The person approves sending mail and publishing — not the model, and not
 * the app the model runs in.** Plan 261007j § Sending mail and publishing ask
 * the human, as settled after GPT Sol's round-2 F12.
 *
 * MCP elicitation was the first design, and it does not hold: an elicitation
 * answer is whatever the client sends back, and nothing in MCP shows a person
 * produced it. So the server asks the person itself, outside the protocol,
 * with a native dialog on the Mac it runs on. The model can neither see nor
 * answer it, and no tool argument reaches it.
 *
 * `Approver` is injected, so tests stub it and a later host can bring its own.
 * The default refuses on anything but macOS rather than going ahead unasked.
 */

import { execFile as nodeExecFile } from "node:child_process";

/** One operation, as the person is asked about it. */
export interface Operation {
  readonly title: string;
  readonly lines: readonly string[];
}

export interface Approver {
  /** True only when the person said yes to exactly this. Anything else — no, no answer, an error — is false. */
  approve(op: Operation): Promise<boolean>;
}

/** Thrown, not answered false, when no person can be asked at all: the tool says why. */
export class CannotAsk extends Error {
  override name = "CannotAsk";
}

const LINE_MAX = 300;
const TOTAL_MAX = 2000;
const DIALOG_SECONDS = 120;

/**
 * Text fit for a dialog: control characters out (a note can carry anything a
 * reader typed into an email the agent read), each line and the whole capped.
 */
export function dialogText(op: Operation): { message: string; title: string } {
  const clean = (s: string) => s.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ");
  const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const message = cap(op.lines.map((line) => cap(clean(line), LINE_MAX)).join("\n"), TOTAL_MAX);
  return { message, title: cap(clean(op.title), 100) };
}

/**
 * **`osascript`'s arguments, with the text passed as data.** The script is
 * fixed; the message and title arrive as `argv` items after `--`, so an
 * address or a note containing `" & do shell script "…` is shown, never run.
 * Nothing here may interpolate the operation into an `-e` string.
 */
export function osascriptArgs(op: Operation): string[] {
  const { message, title } = dialogText(op);
  return [
    "-e",
    "on run argv",
    "-e",
    `display dialog (item 1 of argv) with title (item 2 of argv) buttons {"Cancel", "Approve"} default button "Cancel" cancel button "Cancel" giving up after ${DIALOG_SECONDS}`,
    "-e",
    "end run",
    "--",
    message,
    title,
  ];
}

type ExecFile = (
  file: string,
  args: readonly string[],
  options: { timeout: number },
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => unknown;

/** Approved only on the Approve button, and not on a dialog that gave up waiting. */
export function readDialogAnswer(stdout: string): boolean {
  return /button returned:Approve\b/.test(stdout) && !/gave up:true/.test(stdout);
}

/**
 * The default: a blocking native dialog on macOS, defaulting to Cancel and
 * giving up after two minutes. Cancel exits non-zero, which is a no; so is a
 * timeout, an error, or any answer that is not plainly Approve.
 */
export function defaultApprover(
  deps: { platform?: NodeJS.Platform; execFile?: ExecFile } = {},
): Approver {
  const platform = deps.platform ?? process.platform;
  const run = deps.execFile ?? (nodeExecFile as unknown as ExecFile);
  return {
    async approve(op: Operation): Promise<boolean> {
      if (platform !== "darwin") {
        throw new CannotAsk(
          "Sending mail and publishing need a confirmation dialog, which this server can only show on macOS; " +
            "do it in Spideryarn itself instead (/admin/vouchers, or the article's sharing card). Nothing was done.",
        );
      }
      return await new Promise<boolean>((resolve) => {
        run("osascript", osascriptArgs(op), { timeout: (DIALOG_SECONDS + 10) * 1000 }, (error, stdout) => {
          resolve(error ? false : readDialogAnswer(String(stdout)));
        });
      });
    },
  };
}
