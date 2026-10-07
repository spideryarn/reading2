/**
 * `npm run worktree:setup` in a tree with nothing installed, against a real git
 * repository with a real linked worktree.
 *
 * The bug: since 2026-10-05 a new worktree is at
 * `/var/tmp/spideryarn-worktrees/<name>`, with no `node_modules` in any ancestor,
 * and the script was `tsx scripts/worktree-setup.ts` — so the command whose job
 * is to install dependencies needed one to start (`sh: 1: tsx: not found`).
 * Under `.claude/worktrees/` it had been borrowing the primary's without anybody
 * knowing.
 *
 * The real bootstrap is run as a child process, with a fake `npm` first on PATH
 * and a fake `tsx` that the fake `npm ci` leaves behind, each writing down how
 * it was called. What it must never do is the first thing asserted for the
 * primary: run `npm ci` there, which deletes `node_modules` under every agent.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { alreadyInstalled, INSTALLED_LOCK_ENV, lockDigest } from "../scripts/worktree-deps.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BOOTSTRAP = "scripts/worktree-setup-bootstrap.mjs";
const LOCK = '{"name":"fixture","lockfileVersion":3}\n';

let root: string;
let primary: string;
let tree: string;
let bin: string;
let calls: string;

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function script(file: string, body: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
}

/** What a real `npm ci` leaves behind: the `tsx` the bootstrap goes on to run, and the file npm writes last. */
function fakeTsx(dir: string, finished = true): void {
  script(
    path.join(dir, "node_modules/.bin/tsx"),
    `printf 'tsx %s cwd=%s lock=%s\\n' "$*" "$PWD" "\${${INSTALLED_LOCK_ENV}-unset}" >> "${calls}"`,
  );
  if (finished) writeFileSync(path.join(dir, "node_modules/.package-lock.json"), "{}\n");
}

const NPM_CI = "npm ci --prefer-offline --no-audit --no-fund";

function run(cwd: string, checkout: string = cwd, env: Record<string, string> = {}): { status: number | null; out: string; calls: string[] } {
  // File-backed output survives Node's immediate process.exit on a refusal.
  const output = path.join(root, "bootstrap-output.log");
  const fd = openSync(output, "w");
  let got: ReturnType<typeof spawnSync>;
  try {
    got = spawnSync(process.execPath, [path.join(checkout, BOOTSTRAP)], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", fd, fd],
      env: { PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: root, ...env },
    });
  } finally {
    closeSync(fd);
  }
  expect(got.error).toBeUndefined();
  const log = existsSync(calls) ? readFileSync(calls, "utf8").split("\n").filter(Boolean) : [];
  return { status: got.status, out: readFileSync(output, "utf8"), calls: log };
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "spideryarn-bootstrap-")));
  primary = path.join(root, "primary");
  tree = path.join(root, "elsewhere", "tree");
  bin = path.join(root, "bin");
  calls = path.join(root, "calls.log");

  git(["init", "--quiet", "-b", "dev", primary], root);
  git(["config", "user.email", "test@example.com"], primary);
  git(["config", "user.name", "Test"], primary);
  mkdirSync(path.join(primary, "scripts"));
  copyFileSync(path.join(REPO, BOOTSTRAP), path.join(primary, BOOTSTRAP));
  writeFileSync(path.join(primary, "package-lock.json"), LOCK);
  git(["add", "--", BOOTSTRAP, "package-lock.json"], primary);
  git(["commit", "--quiet", "-m", "first"], primary);
  // Outside the primary, as on the box: no ancestor has a node_modules to borrow.
  git(["worktree", "add", "--quiet", "-b", "worktree-tree", tree], primary);

  // `npm ci` writes down that it ran, and where, and leaves a tsx behind.
  script(
    path.join(bin, "npm"),
    `printf 'npm %s cwd=%s\\n' "$*" "$PWD" >> "${calls}"
[ "$1" = ci ] || exit 0
mkdir -p node_modules/.bin
cat > node_modules/.bin/tsx <<'EOF'
#!/bin/sh
printf 'tsx %s cwd=%s lock=%s\\n' "$*" "$PWD" "\${${INSTALLED_LOCK_ENV}-unset}" >> "${calls}"
EOF
chmod +x node_modules/.bin/tsx
echo '{}' > node_modules/.package-lock.json`,
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("package.json § worktree:setup", () => {
  it("starts with node, which is there before anything is installed", () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["worktree:setup"]).toBe(`node ${BOOTSTRAP}`);
  });
});

describe("the bootstrap", () => {
  it("installs first in a worktree with no node_modules, then runs setup and says what it installed from", () => {
    const got = run(tree);
    expect(got.out).toContain("npm ci");
    expect(got.status).toBe(0);
    const digest = createHash("sha256").update(LOCK).digest("hex");
    expect(got.calls).toEqual([
      `npm ci --prefer-offline --no-audit --no-fund cwd=${tree}`,
      `tsx scripts/worktree-setup.ts cwd=${tree} lock=${digest}`,
    ]);
  });

  it("works from a subdirectory, because the tree is found from the script and not from where you stand", () => {
    const got = run(path.join(tree, "scripts"), tree);
    expect(got.status).toBe(0);
    expect(got.calls[0]).toBe(`npm ci --prefer-offline --no-audit --no-fund cwd=${tree}`);
  });

  it("NEVER installs in the primary: it refuses, and npm is not run", () => {
    const got = run(primary);
    expect(got.calls).toEqual([]);
    expect(got.status).not.toBe(0);
    expect(got.out).toContain("primary checkout");
    expect(existsSync(path.join(primary, "node_modules"))).toBe(false);
  });

  it("NEVER installs in the primary when inherited git variables point at a linked tree", () => {
    const gitDir = git(["rev-parse", "--path-format=absolute", "--git-dir"], tree);
    const got = run(primary, primary, { GIT_DIR: gitDir, GIT_WORK_TREE: tree, GIT_COMMON_DIR: path.join(primary, ".git") });
    expect(got.status).not.toBe(0);
    expect(got.calls).toEqual([]);
    expect(got.out).toContain("primary checkout");
  });

  it("refuses without running npm when git is missing", () => {
    const got = run(tree, tree, { PATH: bin });
    expect(got.status).not.toBe(0);
    expect(got.calls).toEqual([]);
    expect(got.out).toContain("git could not say");
  });

  it("fails without starting setup when npm is missing", () => {
    const gitBinary = execFileSync("/bin/sh", ["-c", "command -v git"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    symlinkSync(gitBinary, path.join(bin, "git"));
    rmSync(path.join(bin, "npm"));
    const got = run(tree, tree, { PATH: bin });
    expect(got.status).toBe(1);
    expect(got.calls).toEqual([]);
    expect(got.out).toContain("npm ci failed");
    expect(got.out).toContain("ENOENT");
  });

  it("does not claim an install from a missing lockfile", () => {
    rmSync(path.join(tree, "package-lock.json"));
    const got = run(tree);
    expect(got.status).toBe(0);
    expect(got.calls).toEqual([`${NPM_CI} cwd=${tree}`, `tsx scripts/worktree-setup.ts cwd=${tree} lock=unset`]);
  });

  it("refuses rather than installs when git cannot say where it is", () => {
    const loose = path.join(root, "loose");
    mkdirSync(path.join(loose, "scripts"), { recursive: true });
    copyFileSync(path.join(REPO, BOOTSTRAP), path.join(loose, BOOTSTRAP));
    const got = run(loose);
    expect(got.calls).toEqual([]);
    expect(got.status).not.toBe(0);
  });

  it("goes straight to setup when tsx is already here, and claims no install", () => {
    fakeTsx(tree);
    const got = run(tree);
    expect(got.status).toBe(0);
    expect(got.calls).toEqual([`tsx scripts/worktree-setup.ts cwd=${tree} lock=unset`]);
  });

  it("does not pass on a claim it inherited and did not earn", () => {
    fakeTsx(tree);
    const got = spawnSync(process.execPath, [path.join(tree, BOOTSTRAP)], {
      cwd: tree,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: root, [INSTALLED_LOCK_ENV]: "stale" },
    });
    expect(got.status).toBe(0);
    expect(readFileSync(calls, "utf8").trim()).toBe(`tsx scripts/worktree-setup.ts cwd=${tree} lock=unset`);
  });

  /* An `npm ci` killed half-way leaves `tsx` and not the package setup imports;
     setup would then die on that import before reaching its own install. */
  it("installs over a half-finished install: tsx alone does not mean setup can start", () => {
    fakeTsx(tree, false);
    const got = run(tree);
    expect(got.status).toBe(0);
    expect(got.calls[0]).toBe(`${NPM_CI} cwd=${tree}`);
    expect(got.calls).toHaveLength(2);
  });

  it("NEVER installs over a half-finished install in the primary either", () => {
    fakeTsx(primary, false);
    const got = run(primary);
    expect(got.calls).toEqual([]);
    expect(got.status).not.toBe(0);
  });

  /* The claim is "installed from THIS lockfile". If it moved while npm ran, which
     one was installed from is not knowable, and setup must install again. */
  it("claims nothing when the lockfile changed while npm was installing", () => {
    script(
      path.join(bin, "npm"),
      `printf 'npm %s\\n' "$*" >> "${calls}"
mkdir -p node_modules/.bin
printf '#!/bin/sh\\nprintf "tsx lock=%%s\\\\n" "\${${INSTALLED_LOCK_ENV}-unset}" >> "${calls}"\\n' > node_modules/.bin/tsx
chmod +x node_modules/.bin/tsx
echo '{}' > node_modules/.package-lock.json
echo ' ' >> package-lock.json`,
    );
    const got = run(tree);
    expect(got.status).toBe(0);
    expect(got.calls).toEqual([NPM_CI, "tsx lock=unset"]);
  });

  it("hands a finished primary install to setup without installing", () => {
    fakeTsx(primary);
    const got = run(primary);
    expect(got.calls).toEqual([`tsx scripts/worktree-setup.ts cwd=${primary} lock=unset`]);
  });

  it("does not pass repository-selection overrides to setup after a finished install", () => {
    fakeTsx(primary);
    script(path.join(primary, "node_modules/.bin/tsx"), `printf 'git=%s,%s,%s,%s\\n' "\${GIT_DIR-unset}" "\${GIT_WORK_TREE-unset}" "\${GIT_COMMON_DIR-unset}" "\${GIT_INDEX_FILE-unset}" >> "${calls}"`);
    const got = run(primary, primary, { GIT_DIR: tree, GIT_WORK_TREE: tree, GIT_COMMON_DIR: tree, GIT_INDEX_FILE: tree });
    expect(got.status).toBe(0);
    expect(got.calls).toEqual(["git=unset,unset,unset,unset"]);
  });

  it("fails, and does not go on to setup, when npm ci fails", () => {
    script(path.join(bin, "npm"), `printf 'npm %s\\n' "$*" >> "${calls}"; exit 7`);
    const got = run(tree);
    expect(got.status).not.toBe(0);
    expect(got.calls).toEqual(["npm ci --prefer-offline --no-audit --no-fund"]);
  });

  it("does not claim or start an install when npm exits zero without finishing it", () => {
    fakeTsx(tree, false);
    script(path.join(bin, "npm"), `printf 'npm %s\\n' "$*" >> "${calls}"`);
    const got = run(tree);
    expect(got.status).not.toBe(0);
    expect(got.calls).toEqual([NPM_CI]);
  });

  it("passes setup's own exit status back", () => {
    fakeTsx(tree);
    script(path.join(tree, "node_modules/.bin/tsx"), "exit 3");
    expect(run(tree).status).toBe(3);
  });
});

describe("alreadyInstalled", () => {
  const digest = createHash("sha256").update(LOCK).digest("hex");

  it("agrees with the bootstrap about what a lockfile's digest is", () => {
    expect(lockDigest(tree)).toBe(digest);
  });

  it("is true only when the bootstrap installed from the lockfile that is here now", () => {
    fakeTsx(tree);
    expect(alreadyInstalled(tree, { [INSTALLED_LOCK_ENV]: digest })).toBe(true);
  });

  it("is false when the merge moved the lockfile after the install", () => {
    fakeTsx(tree);
    writeFileSync(path.join(tree, "package-lock.json"), `${LOCK} `);
    expect(alreadyInstalled(tree, { [INSTALLED_LOCK_ENV]: digest })).toBe(false);
  });

  it("is false when nothing claims an install, which is every run that did not need the bootstrap", () => {
    fakeTsx(tree);
    expect(alreadyInstalled(tree, {})).toBe(false);
    expect(alreadyInstalled(tree, { [INSTALLED_LOCK_ENV]: "" })).toBe(false);
  });

  it("is false when the claim is right and node_modules is not there", () => {
    expect(alreadyInstalled(tree, { [INSTALLED_LOCK_ENV]: digest })).toBe(false);
  });

  it("is false when there is no lockfile to compare", () => {
    fakeTsx(tree);
    rmSync(path.join(tree, "package-lock.json"));
    expect(lockDigest(tree)).toBeNull();
    expect(alreadyInstalled(tree, { [INSTALLED_LOCK_ENV]: digest })).toBe(false);
  });
});
