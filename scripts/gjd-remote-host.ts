/**
 * Which address `gjd-remote` should ssh to, and how it knows.
 *
 * Three sources, in this order: the `GJD_REMOTE_HOST` variable, then the
 * machine's own `/etc/gjd-remote-host`, then Terraform state.
 *
 * The middle one is why this file exists. `gjd-remote` also runs ON the box —
 * it has a keypair that reaches only itself — but the address was told to it by
 * an environment variable exported from /etc/profile.d/, which only a LOGIN
 * shell reads. Every agent tool shell there is non-login, so the variable was
 * unset, the tool fell through to Terraform state the box has not got, and died
 * saying "could not read the server address from Terraform state". That reads
 * as "this tool does not run here", and on 2026-09-05 it was written into the
 * docs as exactly that. A machine should be able to say where it is without
 * being told.
 *
 * The file beats Terraform rather than the other way round because on the box
 * Terraform is not merely absent but WRONG: state holds the public address, and
 * ssh to it from the box is `Permission denied (publickey)` — the loopback key
 * is offered only for `Host 127.0.0.1` under `IdentitiesOnly yes`.
 *
 * Separated from scripts/gjd-remote.ts so it can be tested at all: that file
 * calls main() at import time, so nothing inside it can be imported by a test.
 * See tests/gjd-remote-host.test.ts and
 * docs/plans/260905d-gjd-remote-resolves-the-box-address-without-an-env-var.md.
 */

import { lstatSync, readFileSync } from "node:fs";

/** Where a machine says which address `gjd-remote` should use *on it*. */
export const BOX_HOST_FILE = "/etc/gjd-remote-host";

/** Which of the three sources answered. */
export type HostSource = "env" | "box-file" | "terraform";

export type HostAnswer = { ok: true; host: string; source: HostSource } | { ok: false; why: string };

/**
 * What reading the box file found.
 *
 * `absent` is ENOENT and NOTHING else. A permission error, a directory or a
 * symlink is `bad`, because a broad catch here would report a Terraform problem
 * on a machine whose actual problem is one line in /etc — the same
 * wrong-diagnosis this module exists to end, one layer down.
 */
export type BoxHostRead = { kind: "absent" } | { kind: "found"; host: string } | { kind: "bad"; why: string };

/**
 * A bare address: a hostname or an IP, and nothing else on the line.
 *
 * Deliberately narrow. This string is interpolated into `user@host` and handed
 * to ssh, so a value that begins `-` or carries a space, a quote or a semicolon
 * is refused rather than passed on and hoped about.
 */
const HOST_TOKEN = /^[A-Za-z0-9][A-Za-z0-9.:_-]*$/;

/** Longer than any real hostname; a guard against a file that is not one. */
const MAX_HOST_LENGTH = 255;

/** For an error message: the value as written, short enough to read. */
function quoted(value: string): string {
  const shown = value.length > 40 ? `${value.slice(0, 40)}…` : value;
  return JSON.stringify(shown);
}

/**
 * The bytes of the file → an address, or the reason it is not one.
 *
 * One line, one address, optionally one trailing newline. Whitespace is refused
 * rather than trimmed: this file is written by provisioning and read by a tool
 * that decides which machine every later command talks to, so " 127.0.0.1" is a
 * file somebody edited by hand and the right response is to say so.
 */
export function parseBoxHost(text: string, pathname: string): BoxHostRead {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (body === "") return { kind: "bad", why: `${pathname}: is empty, wanted one address` };
  if (body.includes("\n")) {
    return { kind: "bad", why: `${pathname}: holds ${body.split("\n").length} lines, wanted one address` };
  }
  if (body.length > MAX_HOST_LENGTH) {
    return { kind: "bad", why: `${pathname}: holds ${body.length} characters, which is not an address` };
  }
  if (!HOST_TOKEN.test(body)) {
    return { kind: "bad", why: `${pathname}: holds ${quoted(body)}, which is not a bare hostname or IP` };
  }
  return { kind: "found", host: body };
}

/**
 * Read the machine's own answer, if it has one.
 *
 * `lstat` rather than `stat`, and before the read: the address decides which
 * machine every later command talks to, so the file that holds it is not a
 * thing to reach through a redirection that `cat` cannot show you.
 */
export function readBoxHostFile(pathname: string = BOX_HOST_FILE): BoxHostRead {
  let stat;
  try {
    stat = lstatSync(pathname);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { kind: "absent" };
    return { kind: "bad", why: `${pathname}: cannot be read (${code ?? (err as Error).message})` };
  }
  if (stat.isSymbolicLink()) {
    return { kind: "bad", why: `${pathname}: is a symlink, and this file may not be one` };
  }
  if (!stat.isFile()) {
    return { kind: "bad", why: `${pathname}: is not a regular file` };
  }
  let text: string;
  try {
    text = readFileSync(pathname, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { kind: "bad", why: `${pathname}: cannot be read (${code ?? (err as Error).message})` };
  }
  return parseBoxHost(text, pathname);
}

/** What `doctor` and `resolve` print beside the address, so it can be chased. */
export function describeSource(source: HostSource): string {
  switch (source) {
    case "env":
      return "from the GJD_REMOTE_HOST environment variable";
    case "box-file":
      return `from ${BOX_HOST_FILE}`;
    case "terraform":
      return "from Terraform state";
  }
}

/**
 * The three sources, in order, each one asked only if the one before had no
 * answer — `terraform()` is a subprocess and `host()` is called on every ssh,
 * scp and mosh, so the laziness is the design rather than a tidiness.
 *
 * A `bad` file stops the whole thing. It must never fall through to Terraform:
 * the machine with a broken /etc would then be told its Terraform is missing.
 */
export function resolveHost(deps: {
  env: NodeJS.ProcessEnv;
  boxFile: () => BoxHostRead;
  terraform: () => { ok: true; host: string } | { ok: false; why: string };
}): HostAnswer {
  const fromEnv = deps.env.GJD_REMOTE_HOST;
  if (fromEnv) return { ok: true, host: fromEnv, source: "env" };

  const file = deps.boxFile();
  if (file.kind === "found") return { ok: true, host: file.host, source: "box-file" };
  if (file.kind === "bad") {
    return {
      ok: false,
      why: `${file.why}\n  Fix that file, or set GJD_REMOTE_HOST=<address> for this command.`,
    };
  }

  const tf = deps.terraform();
  return tf.ok ? { ok: true, host: tf.host, source: "terraform" } : { ok: false, why: tf.why };
}
