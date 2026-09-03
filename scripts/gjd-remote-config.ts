/**
 * The per-repo config, `.gjd-remote/config.toml` — how `gjd-remote` sets up
 * *this* repo on the box. Pure functions and plain filesystem reads only: no
 * ssh, no process spawning, nothing that needs a server. So the rule that
 * matters can be tested without one, in tests/gjd-remote-config.test.ts.
 *
 * Split out of scripts/gjd-remote.ts for the same reason
 * scripts/gjd-remote-env.ts is: that file runs main() on import, and an
 * entrypoint guard is a bad thing to depend on.
 *
 * ## What the file may say
 *
 *     setup = "npm ci && npm run setup"   # run from the checkout, on the box
 *     check = "npm run doctor"            # read-only "is it still working"
 *
 * Two keys, both optional, and **no file at all still works** — the setup
 * command falls back through conventions (see `resolveSetup`). The config may
 * not decide the remote path, the ssh host, or anything that runs on the
 * laptop; those stay tool-owned. See
 * docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md.
 *
 * ## Why every deviation is an error rather than a default
 *
 * A misspelt key (`setpu`) that does nothing, or a `.gjd-remote/setup` sitting
 * there without its execute bit, is the exact failure shape in
 * docs/reusable/silent-success.md: the tool reports a clean setup having run
 * none, and the first sign of trouble is a session in a broken checkout an hour
 * later. So an unknown key throws, a wrong-typed key throws, malformed TOML
 * throws *with its line*, and the two cases where something on disk is being
 * ignored come back as `warnings` for the CLI to print.
 *
 * `none` is deliberately a union arm rather than an absent string: "no setup
 * known for this repo" is a thing to say out loud, not a nullish value to fall
 * through a `?? ""` into running nothing successfully.
 *
 * ## smol-toml
 *
 * A **direct** dependency, added for this. It was already in `node_modules`
 * through knip, and scripts/deploy-checks.ts hand-wrote a parser rather than
 * import a package nobody had declared — a fair objection, and declaring it is
 * the whole of the answer, the same move tests/no-undeclared-spend.test.ts
 * describes for `@babel/parser`. TOML because supabase/config.toml already
 * makes it the hand-edited format in this repo and in hellozenno.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseToml, TomlError } from "smol-toml";

/** The dotdir, relative to the repo's toplevel. */
export const CONFIG_DIR = ".gjd-remote";
/** The config file, relative to the repo's toplevel. */
export const CONFIG_FILE = `${CONFIG_DIR}/config.toml`;
/** The optional executable, relative to the repo's toplevel. */
export const SETUP_SCRIPT = `${CONFIG_DIR}/setup`;
/** How that executable is invoked on the box, from the checkout. */
export const SETUP_SCRIPT_COMMAND = `./${SETUP_SCRIPT}`;
/** The last convention, for a repo with a `setup` script in its package.json. */
export const NPM_SETUP_COMMAND = "npm ci && npm run setup";

/** The keys this version understands. Anything else is an error, by name. */
const KNOWN_KEYS = ["setup", "check"] as const;

/**
 * Where a setup command came from — printed by the CLI, so the reader can tell
 * "the repo asked for this" from "I guessed by convention".
 */
export type SetupSource = "config" | "script" | "npm-convention";

/**
 * A setup command, or the absence of one. A union rather than `string |
 * undefined` so that "we do not know how to set this repo up" cannot be
 * defaulted into an empty command that exits 0.
 */
export type SetupPlan = { command: string; source: SetupSource } | { source: "none" };

export type RepoConfig = {
  setup: SetupPlan;
  /** The read-only health command, if the repo named one. */
  check: { command: string } | undefined;
  /**
   * Things on disk that are being ignored, in the tool's voice, for the CLI to
   * print. Never empty for a reason the user could fix by hand.
   */
  warnings: readonly string[];
};

/** `.gjd-remote/setup`, as far as the resolution order cares. */
export type SetupScriptState = "executable" | "not-executable" | "absent";

/** Everything `parseRepoConfig` needs from the filesystem, so it needs none. */
export type RepoConfigContext = {
  setupScript: SetupScriptState;
  /** `package.json` at the toplevel has a non-empty `scripts.setup`. */
  packageJsonHasSetup: boolean;
};

/** Anything wrong with a repo's config, in the CLI's voice. `gjd-remote` catches
 *  these and hands the message straight to `die()`. */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

function errnoCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("code" in err)) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** What a TOML value turned out to be, for an error message. TOML has no null,
 *  so every arm here is reachable from a real file. */
function describeValue(value: unknown): string {
  if (typeof value === "string") return "a string";
  if (typeof value === "number" || typeof value === "bigint") return "a number";
  if (typeof value === "boolean") return "a boolean";
  if (Array.isArray(value)) return "an array";
  if (value instanceof Date) return "a date";
  if (typeof value === "object" && value !== null) return "a table";
  return `a ${typeof value}`;
}

/**
 * The most a command may be. A `setup` line is a command, not a program: the
 * long ones belong in `.gjd-remote/setup`, which has no limit at all. The cap
 * is here because this string is echoed in a confirmation prompt and joined
 * into an ssh command line, and neither of those has a sensible answer for a
 * megabyte.
 */
export const MAX_COMMAND_BYTES = 2000;

/**
 * Anything in C0 except TAB, plus DEL. ESC is the one that matters: this string
 * is printed back to Greg in the clone prompt before it ever runs, so a `setup`
 * carrying escape sequences could repaint the question it is being asked inside
 * — move the cursor, clear the line, colour a "no" to look like a "yes". A
 * config file is not a trusted input once `gjd-remote` runs in whichever repo
 * you happen to be in.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: naming them is the point
const FORBIDDEN_CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

/**
 * A key's value as a single-line shell command, or an error saying what it was
 * instead. Newlines are refused rather than passed through: a command reaches
 * the box as one non-interactive `sh -c`, and anything that wants several lines
 * wants the script file, which is what it is for.
 *
 * NO ERROR HERE ECHOES THE VALUE. The point of refusing control characters is
 * that this string cannot be trusted on a terminal, and an error message that
 * quotes it back would hand it the terminal anyway — the offset and the
 * character's code say everything the reader needs to find it.
 */
function requireCommand(key: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new ConfigError(
      `${key} in ${CONFIG_FILE} must be a shell command in quotes, but it is ${describeValue(value)}.\n` +
        `  For example: ${key} = "npm ci && npm run setup"`,
    );
  }
  if (/[\r\n]/.test(value)) {
    throw new ConfigError(
      `${key} in ${CONFIG_FILE} runs as one command, so it may not span lines.\n` +
        `  Put the steps in ${SETUP_SCRIPT}, make it executable, and drop the ${key} key.`,
    );
  }
  const control = value.search(FORBIDDEN_CONTROL);
  if (control !== -1) {
    // A UTF-16 index counts surrogate pairs as two, and the reader is looking
    // at bytes in a file, so convert. The control character itself is always
    // one byte, so the offset it reports is the one `hexdump -C` would show.
    const offset = Buffer.byteLength(value.slice(0, control), "utf8");
    const code = value.charCodeAt(control).toString(16).padStart(2, "0");
    throw new ConfigError(
      `${key} in ${CONFIG_FILE} contains a control character (0x${code}) at byte ${offset}.\n` +
        `  A command is printed back to you before it is run, so escape sequences are not\n` +
        `  allowed in one. Tab is; everything else below a space is not.`,
    );
  }
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > MAX_COMMAND_BYTES) {
    throw new ConfigError(
      `${key} in ${CONFIG_FILE} is ${bytes} bytes, over the ${MAX_COMMAND_BYTES} a command may be.\n` +
        `  Put the steps in ${SETUP_SCRIPT}, make it executable, and drop the ${key} key —\n` +
        `  a script file has no limit.`,
    );
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ConfigError(
      `${key} in ${CONFIG_FILE} is empty. Give it a command, or remove the key —\n` +
        `  an empty command would run nothing and report success.`,
    );
  }
  return trimmed;
}

/**
 * The resolution order, in one place: what the config said, then the script,
 * then the npm convention, then nothing. The `warnings` are the two ways a file
 * on disk ends up ignored.
 */
function resolveSetup(fromConfig: string | undefined, ctx: RepoConfigContext): { setup: SetupPlan; warnings: string[] } {
  const warnings: string[] = [];
  if (ctx.setupScript === "not-executable") {
    warnings.push(
      `${SETUP_SCRIPT} exists but is not executable, so it is being ignored — 'chmod +x ${SETUP_SCRIPT}'.`,
    );
  }
  if (fromConfig !== undefined) {
    if (ctx.setupScript === "executable") {
      warnings.push(`setup in ${CONFIG_FILE} wins, so ${SETUP_SCRIPT} will not be run.`);
    }
    return { setup: { command: fromConfig, source: "config" }, warnings };
  }
  if (ctx.setupScript === "executable") {
    return { setup: { command: SETUP_SCRIPT_COMMAND, source: "script" }, warnings };
  }
  if (ctx.packageJsonHasSetup) {
    return { setup: { command: NPM_SETUP_COMMAND, source: "npm-convention" }, warnings };
  }
  return { setup: { source: "none" }, warnings };
}

/**
 * The pure half: config text plus what is on disk around it, in; a resolved
 * plan, out. Empty text is a valid config that says nothing — which is not the
 * same as saying "no setup", because the conventions still apply.
 */
export function parseRepoConfig(text: string, ctx: RepoConfigContext): RepoConfig {
  let table: Record<string, unknown>;
  try {
    table = parseToml(text) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof TomlError) {
      throw new ConfigError(
        `${CONFIG_FILE} is not valid TOML, at line ${err.line}, column ${err.column}: ${err.message.split("\n")[0]}`,
      );
    }
    throw new ConfigError(`${CONFIG_FILE} could not be parsed: ${reason(err)}`);
  }

  const known = new Set<string>(KNOWN_KEYS);
  const unknown = Object.keys(table).filter((k) => !known.has(k));
  if (unknown.length) {
    // Named, and refused. A key that is quietly ignored is a repo whose setup
    // silently does nothing, which is the failure this whole file is against.
    const plural = unknown.length === 1 ? "a key" : "keys";
    throw new ConfigError(
      `${CONFIG_FILE} has ${plural} I do not understand: ${unknown.map((k) => `'${k}'`).join(", ")}.\n` +
        `  Only ${KNOWN_KEYS.map((k) => `'${k}'`).join(" and ")} are understood, and a key I ignore is a\n` +
        `  setup that quietly does nothing. Fix the spelling, or delete the line.`,
    );
  }

  const fromConfig = "setup" in table ? requireCommand("setup", table.setup) : undefined;
  const check = "check" in table ? { command: requireCommand("check", table.check) } : undefined;
  const { setup, warnings } = resolveSetup(fromConfig, ctx);
  return { setup, check, warnings };
}

/**
 * `.gjd-remote/setup`, on disk. A directory of that name is `absent`, not a
 * script; the execute bit is any of the three, because the box runs it as the
 * same user that owns the checkout.
 */
export function setupScriptState(toplevel: string): SetupScriptState {
  const file = path.join(toplevel, SETUP_SCRIPT);
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(file);
  } catch (err) {
    // ENOENT only. ENOTDIR, EACCES and friends mean something IS there and we
    // could not look at it, and "no setup script" would be a lie about it.
    if (errnoCode(err) === "ENOENT") return "absent";
    throw new ConfigError(`could not look at ${SETUP_SCRIPT}: ${reason(err)}`);
  }
  if (!stat.isFile()) return "absent";
  return (stat.mode & 0o111) !== 0 ? "executable" : "not-executable";
}

/** A non-empty `scripts.setup` in the toplevel `package.json` — the last
 *  convention before giving up. A package.json we cannot parse is an error, not
 *  a repo without the convention. */
function packageJsonHasSetup(toplevel: string): boolean {
  const file = path.join(toplevel, "package.json");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    if (errnoCode(err) === "ENOENT") return false;
    throw new ConfigError(`could not read ${file}: ${reason(err)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`${file} is not valid JSON, so I cannot tell whether it has a setup script: ${reason(err)}`);
  }
  if (typeof parsed !== "object" || parsed === null) return false;
  const scripts = (parsed as Record<string, unknown>).scripts;
  if (typeof scripts !== "object" || scripts === null) return false;
  const setup = (scripts as Record<string, unknown>).setup;
  return typeof setup === "string" && setup.trim().length > 0;
}

/**
 * The whole thing, for a repo checked out at `toplevel`. A missing
 * `.gjd-remote/` is ordinary — the conventions still get their turn. A
 * `.gjd-remote` that is not a directory, or a config file that exists and
 * cannot be read, is an error: "no config" and "a config I was not allowed to
 * open" must not come out the same way.
 */
export function readRepoConfig(toplevel: string): RepoConfig {
  const dir = path.join(toplevel, CONFIG_DIR);
  let dirStat: ReturnType<typeof statSync> | undefined;
  try {
    dirStat = statSync(dir);
  } catch (err) {
    if (errnoCode(err) !== "ENOENT") throw new ConfigError(`could not look at ${CONFIG_DIR}: ${reason(err)}`);
  }
  if (dirStat && !dirStat.isDirectory()) {
    throw new ConfigError(`${dir} is not a directory. ${CONFIG_DIR} holds config.toml and an optional setup script.`);
  }

  let text = "";
  if (dirStat) {
    try {
      text = readFileSync(path.join(toplevel, CONFIG_FILE), "utf8");
    } catch (err) {
      if (errnoCode(err) !== "ENOENT") throw new ConfigError(`could not read ${CONFIG_FILE}: ${reason(err)}`);
    }
  }

  return parseRepoConfig(text, {
    setupScript: dirStat ? setupScriptState(toplevel) : "absent",
    packageJsonHasSetup: packageJsonHasSetup(toplevel),
  });
}
