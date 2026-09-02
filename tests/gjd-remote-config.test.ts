/**
 * The per-repo config file, `.gjd-remote/config.toml`, and how a setup command
 * is chosen when it is absent.
 *
 * The rule these tests exist for is **a misspelt key is an error, not a
 * default** (docs/reusable/silent-success.md): `setpu = "..."` that quietly
 * does nothing is a repo that reports a successful setup having run none.
 * Every arm of the resolution order gets a test too, in pairs, because the
 * order is the whole behaviour and "it returned something" is not evidence it
 * returned the right something.
 *
 * See scripts/gjd-remote-config.ts and
 * docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConfigError,
  MAX_COMMAND_BYTES,
  NPM_SETUP_COMMAND,
  parseRepoConfig,
  readRepoConfig,
  type RepoConfigContext,
  SETUP_SCRIPT_COMMAND,
  setupScriptState,
} from "../scripts/gjd-remote-config.js";

/** Nothing on disk, nothing conventional: the bare context. */
const BARE: RepoConfigContext = { setupScript: "absent", packageJsonHasSetup: false };
const ctx = (over: Partial<RepoConfigContext> = {}): RepoConfigContext => ({ ...BARE, ...over });

describe("parseRepoConfig — the keys", () => {
  it("an empty file knows of no setup and no check", () => {
    const c = parseRepoConfig("", BARE);
    expect(c.setup).toEqual({ source: "none" });
    expect(c.check).toBeUndefined();
    expect(c.warnings).toEqual([]);
  });

  it("comments and blank lines alone are still an empty file", () => {
    const c = parseRepoConfig("# how this repo is set up\n\n   \n", BARE);
    expect(c.setup).toEqual({ source: "none" });
  });

  it("takes setup on its own", () => {
    const c = parseRepoConfig(`setup = "npm ci && npm run setup"`, BARE);
    expect(c.setup).toEqual({ command: "npm ci && npm run setup", source: "config" });
    expect(c.check).toBeUndefined();
  });

  it("takes check on its own", () => {
    const c = parseRepoConfig(`check = "npm run doctor"`, BARE);
    expect(c.setup).toEqual({ source: "none" });
    expect(c.check).toEqual({ command: "npm run doctor" });
  });

  it("takes both", () => {
    const c = parseRepoConfig(`setup = "make dev"\ncheck = "make check"\n`, BARE);
    expect(c.setup).toEqual({ command: "make dev", source: "config" });
    expect(c.check).toEqual({ command: "make check" });
  });
});

describe("parseRepoConfig — strictness", () => {
  const bad = (text: string, ctxIn: RepoConfigContext = BARE): string => {
    let thrown: unknown;
    try {
      parseRepoConfig(text, ctxIn);
    } catch (err) {
      thrown = err;
    }
    expect(thrown, `expected '${text}' to be refused`).toBeInstanceOf(ConfigError);
    return (thrown as ConfigError).message;
  };

  it("names the key it does not recognise", () => {
    expect(bad(`setpu = "npm ci"`)).toContain("setpu");
  });

  it("names every unrecognised key, not just the first", () => {
    const msg = bad(`setup = "a"\nteardown = "b"\nchekc = "c"\n`);
    expect(msg).toContain("teardown");
    expect(msg).toContain("chekc");
  });

  it("refuses a setup that is a number", () => {
    const msg = bad("setup = 3");
    expect(msg).toContain("setup");
    expect(msg).toMatch(/number/);
  });

  it("refuses a setup that is a table", () => {
    const msg = bad("[setup]\ncommand = 'npm ci'\n");
    expect(msg).toContain("setup");
  });

  it("refuses a check that is a boolean", () => {
    expect(bad("check = true")).toContain("check");
  });

  it("refuses a setup that is an array of commands", () => {
    expect(bad(`setup = ["npm ci", "npm run setup"]`)).toContain("setup");
  });

  it("refuses an empty command rather than running nothing", () => {
    expect(bad(`setup = "   "`)).toContain("setup");
  });

  it("refuses a multi-line command and points at the script instead", () => {
    const msg = bad(`setup = """\nnpm ci\nnpm run setup\n"""\n`);
    expect(msg).toContain(".gjd-remote/setup");
  });

  it("reports malformed TOML with the line, rather than reading it as empty", () => {
    const msg = bad(`setup = "npm ci"\nthis is not toml\n`);
    expect(msg).toMatch(/line 2/);
  });

  /**
   * A command is printed back to Greg in the clone prompt before it is ever
   * run, so a `setup` carrying escape sequences gets to repaint the question it
   * is being asked inside — move the cursor up, clear the line, dress a "no" as
   * a "yes". GPT Sol asked for this in Stage 1 (finding 10), against a version
   * that stopped at CR, LF and NUL.
   *
   * Every arm of the character class gets a case, because a range typed wrong
   * looks exactly like a range typed right until something in the gap arrives.
   */
  it("refuses a command carrying terminal escape sequences", () => {
    // ESC [ 2 K — erase the line, the one that makes a repaint convincing.
    const msg = bad(`setup = "npm ci\\u001b[2K && rm -rf /"`);
    expect(msg).toMatch(/control character/);
    expect(msg).toMatch(/0x1b/);
    // The offset, so it can be found — and NOT the string, which is the thing
    // that cannot be trusted on a terminal.
    expect(msg).toMatch(/byte 6/);
    expect(msg).not.toContain("rm -rf");
  });

  it("refuses every C0 control character except tab, and DEL", () => {
    for (const code of [0x00, 0x01, 0x08, 0x0b, 0x0c, 0x0e, 0x1b, 0x1f, 0x7f]) {
      const hex = code.toString(16).padStart(4, "0");
      expect(bad(`setup = "npm\\u${hex}ci"`), hex).toMatch(/control character/);
    }
    // Tab is a space, not an escape, and a command may hold one.
    expect(parseRepoConfig(`setup = "npm\\tci"`, BARE).setup).toEqual({ command: "npm\tci", source: "config" });
  });

  /**
   * A command, not a program. The long ones belong in `.gjd-remote/setup`,
   * which has no limit, and an unbounded string here ends up echoed in a prompt
   * and joined onto an ssh command line.
   */
  it("refuses a command over the byte cap, and accepts one at it", () => {
    const at = "x".repeat(MAX_COMMAND_BYTES);
    expect(parseRepoConfig(`setup = "${at}"`, BARE).setup).toEqual({ command: at, source: "config" });
    const over = bad(`setup = "${"x".repeat(MAX_COMMAND_BYTES + 1)}"`);
    expect(over).toContain(`${MAX_COMMAND_BYTES + 1} bytes`);
    expect(over).not.toContain("xxxxxxxxxx");
  });

  /** Bytes, not characters: a cap counted in UTF-16 units would let a command
   *  of multi-byte characters through at roughly three times the size. */
  it("counts the cap in bytes rather than characters", () => {
    // 1500 characters, and 3000 bytes because each one is two.
    expect(bad(`setup = "${"é".repeat(1500)}"`)).toContain("3000 bytes");
  });
});

describe("parseRepoConfig — the resolution order", () => {
  const CONFIG = `setup = "just bootstrap"`;

  it("config beats an executable script", () => {
    const c = parseRepoConfig(CONFIG, ctx({ setupScript: "executable" }));
    expect(c.setup).toEqual({ command: "just bootstrap", source: "config" });
  });

  it("and says out loud that the script it shadowed will not run", () => {
    const c = parseRepoConfig(CONFIG, ctx({ setupScript: "executable" }));
    expect(c.warnings.join("\n")).toContain(".gjd-remote/setup");
  });

  it("an executable script beats the npm convention", () => {
    const c = parseRepoConfig("", ctx({ setupScript: "executable", packageJsonHasSetup: true }));
    expect(c.setup).toEqual({ command: SETUP_SCRIPT_COMMAND, source: "script" });
  });

  it("the npm convention beats nothing at all", () => {
    const c = parseRepoConfig("", ctx({ packageJsonHasSetup: true }));
    expect(c.setup).toEqual({ command: NPM_SETUP_COMMAND, source: "npm-convention" });
  });

  it("and with none of the three, the answer is 'none' — not an empty command", () => {
    const c = parseRepoConfig("", BARE);
    expect(c.setup).toEqual({ source: "none" });
  });

  it("a setup file that is not executable is not used", () => {
    const c = parseRepoConfig("", ctx({ setupScript: "not-executable", packageJsonHasSetup: true }));
    expect(c.setup).toEqual({ command: NPM_SETUP_COMMAND, source: "npm-convention" });
  });

  it("but it is warned about, because a file sitting there doing nothing is the silent failure", () => {
    const c = parseRepoConfig("", ctx({ setupScript: "not-executable" }));
    expect(c.setup).toEqual({ source: "none" });
    expect(c.warnings.join("\n")).toMatch(/not executable|chmod/);
  });
});

describe("readRepoConfig", () => {
  const dirs: string[] = [];
  const tmp = (): string => {
    const d = mkdtempSync(path.join(tmpdir(), "gjd-remote-config-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    while (dirs.length) {
      const d = dirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  const gjd = (root: string): string => {
    const d = path.join(root, ".gjd-remote");
    mkdirSync(d, { recursive: true });
    return d;
  };

  it("a repo with no .gjd-remote at all is not an error", () => {
    const c = readRepoConfig(tmp());
    expect(c.setup).toEqual({ source: "none" });
    expect(c.check).toBeUndefined();
  });

  it("an executable .gjd-remote/setup is the setup command", () => {
    const root = tmp();
    const script = path.join(gjd(root), "setup");
    writeFileSync(script, "#!/bin/sh\nnpm ci\n");
    chmodSync(script, 0o755);
    expect(readRepoConfig(root).setup).toEqual({ command: SETUP_SCRIPT_COMMAND, source: "script" });
  });

  it("a .gjd-remote/setup that is not executable is ignored, and said so", () => {
    const root = tmp();
    const script = path.join(gjd(root), "setup");
    writeFileSync(script, "#!/bin/sh\nnpm ci\n");
    chmodSync(script, 0o644);
    const c = readRepoConfig(root);
    expect(c.setup).toEqual({ source: "none" });
    expect(c.warnings.join("\n")).toContain("setup");
  });

  it("a directory called setup is not a setup script", () => {
    const root = tmp();
    mkdirSync(path.join(gjd(root), "setup"), { recursive: true });
    expect(setupScriptState(root)).toBe("absent");
  });

  it("package.json's scripts.setup is the last convention", () => {
    const root = tmp();
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { setup: "tsx x.ts" } }));
    expect(readRepoConfig(root).setup).toEqual({ command: NPM_SETUP_COMMAND, source: "npm-convention" });
  });

  it("a package.json with no setup script does not count", () => {
    const root = tmp();
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { build: "vite" } }));
    expect(readRepoConfig(root).setup).toEqual({ source: "none" });
  });

  it("the config file wins over both", () => {
    const root = tmp();
    writeFileSync(path.join(gjd(root), "config.toml"), `setup = "make dev"\ncheck = "make check"\n`);
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { setup: "tsx x.ts" } }));
    const c = readRepoConfig(root);
    expect(c.setup).toEqual({ command: "make dev", source: "config" });
    expect(c.check).toEqual({ command: "make check" });
  });

  it("an unreadable config file is an error, not 'no config'", () => {
    if (process.getuid?.() === 0) return; // root reads anything; the test would prove nothing.
    const root = tmp();
    const file = path.join(gjd(root), "config.toml");
    writeFileSync(file, `setup = "make dev"`);
    chmodSync(file, 0o000);
    expect(() => readRepoConfig(root)).toThrow(ConfigError);
  });

  it("a .gjd-remote that is a file, not a directory, is an error", () => {
    const root = tmp();
    writeFileSync(path.join(root, ".gjd-remote"), "oops");
    expect(() => readRepoConfig(root)).toThrow(ConfigError);
  });

  it("a package.json that is not JSON is an error, not a missing convention", () => {
    const root = tmp();
    writeFileSync(path.join(root, "package.json"), "{ this is not json");
    expect(() => readRepoConfig(root)).toThrow(ConfigError);
  });
});

describe("this repo's own config", () => {
  it("is the worked example, and it parses", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const c = readRepoConfig(root);
    expect(c.setup).toEqual({ command: NPM_SETUP_COMMAND, source: "config" });
    expect(c.warnings).toEqual([]);
  });
});
