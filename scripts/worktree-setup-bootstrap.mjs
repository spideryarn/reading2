/**
 * The front door of `npm run worktree:setup`, in plain Node.
 *
 * It is `.mjs` and imports only built-in modules **because it has to run in a
 * tree with nothing installed** — which is every new worktree on the box since
 * 2026-10-05, when they moved to `/var/tmp/spideryarn-worktrees/<name>`. Until
 * then the script was `tsx scripts/worktree-setup.ts` and worked by accident:
 * under `<primary>/.claude/worktrees/` npm found the primary's `tsx` in an
 * ancestor's `node_modules/.bin`, and the one package the script imports resolved
 * the same way. With no ancestor to borrow from it was `sh: 1: tsx: not found`,
 * from the command whose job is to install. So do not import a package here, and
 * do not turn this into TypeScript.
 *
 * Three cases:
 *
 *   a finished install is here          → run scripts/worktree-setup.ts, as before
 *   there is none, in a linked worktree → `npm ci`, then run it
 *   there is none, anywhere else        → refuse
 *
 * **The third is the one that matters.** `npm ci` deletes `node_modules` before it
 * reinstalls, and a dozen agents work out of the primary checkout, so this
 * installs only where git itself says the tree is a linked worktree — the same
 * question, asked the same way, as `inLinkedWorktree` in scripts/worktree-port.ts,
 * which cannot be imported from here. A git that cannot answer is a refusal.
 *
 * After its own install it passes the digest of the lockfile it installed from,
 * so that setup can skip a second `npm ci` when its merge of the trunk did not
 * move the lockfile — scripts/worktree-deps.ts.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");
/** `INSTALLED_LOCK_ENV` in scripts/worktree-deps.ts; tests/worktree-setup-bootstrap.test.ts holds the two together. */
const INSTALLED_LOCK_ENV = "SPIDERYARN_SETUP_INSTALLED_LOCK";

function refuse(why, detail) {
  console.error(`\nworktree:setup  ${ROOT}\n\n  FAIL ${why}`);
  for (const line of detail) console.error(`       ${line}`);
  console.error("");
  process.exit(1);
}

function gitPath(flag) {
  const out = execFileSync("git", ["rev-parse", "--path-format=absolute", flag], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env,
  }).trim();
  if (out === "") throw new Error(`git rev-parse ${flag} printed nothing`);
  return path.resolve(out);
}

/**
 * Is there an install here that setup can start from? `tsx` alone is not the
 * answer: an `npm ci` killed half-way can leave it behind with the package setup
 * imports still missing, and setup then dies on that import before it reaches
 * its own install. npm writes `node_modules/.package-lock.json` last, so its
 * presence is what says an install finished (GPT Sol, plan review of 261005l).
 */
function installed() {
  return existsSync(TSX) && existsSync(path.join(ROOT, "node_modules", ".package-lock.json"));
}

/** sha256 of the lockfile, or null. `lockDigest` in scripts/worktree-deps.ts is the same sum, in TypeScript. */
function lockDigest() {
  try {
    return createHash("sha256").update(readFileSync(path.join(ROOT, "package-lock.json"))).digest("hex");
  } catch {
    return null;
  }
}

// Whatever this run inherited, a claim is passed on only by the branch below that earns it.
const env = { ...process.env };
delete env[INSTALLED_LOCK_ENV];
// cwd must select this checkout, even when invoked from a git hook or a shell
// that was inspecting another tree. Setup's own git guard needs this too.
for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE"]) delete env[key];

if (!installed()) {
  let linked;
  try {
    linked = gitPath("--git-dir") !== gitPath("--git-common-dir");
  } catch (err) {
    refuse("no finished install here, and git could not say whether this is a worktree", [
      err instanceof Error ? (err.message.trim().split("\n")[0] ?? "") : String(err),
      "Refusing rather than assuming, because the next step deletes node_modules.",
    ]);
  }
  if (!linked) {
    refuse("no finished install here, and this is the primary checkout, not a worktree", [
      "`npm ci` deletes node_modules before it reinstalls, and other agents work out of this checkout.",
      "If the primary really has lost its dependencies, install them there yourself, deliberately.",
    ]);
  }

  console.log(`\nworktree:setup  ${ROOT}`);
  console.log("  ·    no finished install here yet, so first: npm ci --prefer-offline (about 15–20 s, 680 MB)");
  // Read BEFORE the install and again after: the claim is "installed from this
  // lockfile", and a lockfile that moved while npm ran makes that unknowable.
  const before = lockDigest();
  const install = spawnSync("npm", ["ci", "--prefer-offline", "--no-audit", "--no-fund"], { cwd: ROOT, stdio: "inherit", env });
  if (install.status !== 0 || !installed()) {
    refuse("npm ci failed, so setup cannot start", [
      install.error ? install.error.message : `exit ${install.status ?? `on signal ${install.signal}`}; its own output is above`,
    ]);
  }
  // No digest, or two that differ: no claim, and setup installs again, which is only slower.
  if (before !== null && before === lockDigest()) env[INSTALLED_LOCK_ENV] = before;
}

const setup = spawnSync(TSX, ["scripts/worktree-setup.ts", ...process.argv.slice(2)], { cwd: ROOT, stdio: "inherit", env });
if (setup.error) refuse("could not start scripts/worktree-setup.ts", [setup.error.message]);
process.exit(setup.status ?? 1);
