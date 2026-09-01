/**
 * Make a fresh worktree usable. Run it **inside** the worktree:
 *
 *     npm run worktree:setup
 *
 * Claude Code creates the worktree, checks out tracked files, takes a lock and
 * copies whatever `.worktreeinclude` names. It does not install dependencies and
 * it does not know about `data/`. That is this script.
 *
 * It has to be run by hand or by the agent rather than by a hook, because a
 * `WorktreeCreate` hook *replaces* worktree creation rather than following it —
 * see docs/project/worktrees.md.
 *
 * ## The guard, which is the most important line here
 *
 * This script runs `npm ci`, which **deletes `node_modules` and reinstalls it**.
 * A dozen agents work out of the primary checkout, so running this there by
 * accident would pull the toolchain out from under all of them mid-task. So it
 * refuses unless it is genuinely in a linked worktree, and it asks git rather
 * than guessing from the path: in a worktree `--git-dir` is
 * `…/.git/worktrees/<name>` while `--git-common-dir` is the primary's `.git`; in
 * the primary they are the same. `inLinkedWorktree` in scripts/worktree-port.ts,
 * verified against a real worktree.
 *
 * ## What it does not do
 *
 * **No port allocation.** Vite picks the port by walking upward from 5273, and
 * the kernel arbitrates, so there is nothing to hand out — see
 * scripts/worktree-port.ts for why the reservation this script was going to
 * write was deleted instead.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describeMaterialise, materialiseCorpus } from "./corpus-materialise.js";
import { inLinkedWorktree, PRIMARY_PORT } from "./worktree-port.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const say = (s = "") => console.log(s);
const ok = (s: string) => say(`  ok   ${s}`);
const bad = (s: string) => say(`  FAIL ${s}`);
const info = (s: string) => say(`  ·    ${s}`);

function refuse(why: string, detail: string[]): never {
  say();
  bad(why);
  for (const line of detail) say(`       ${line}`);
  say();
  process.exit(1);
}

say(`\nworktree:setup  ${ROOT}`);

/* ------------------------------------------------------------------ */
/* 1. Am I actually in a worktree?                                     */
/* ------------------------------------------------------------------ */

let linked: boolean;
try {
  linked = inLinkedWorktree(ROOT);
} catch (err) {
  refuse("could not ask git whether this is a worktree", [
    (err as Error).message,
    "Refusing rather than assuming, because the next step deletes node_modules.",
  ]);
}

if (!linked) {
  refuse("this is the primary checkout, not a worktree", [
    "`npm ci` deletes node_modules and reinstalls it, and a dozen agents are",
    "working out of this one. Doing that here would break all of them mid-task.",
    "",
    "Create a worktree and run this inside it:  claude --worktree <name>",
  ]);
}
ok("in a linked worktree");

/* ------------------------------------------------------------------ */
/* 2. Dependencies                                                     */
/* ------------------------------------------------------------------ */

/* `--prefer-offline` because the npm cache is shared and warm; the flags after
   it just cut noise. Measured at 16.6 s and 681 MB in a real worktree on
   2026-09-01 — the plan's earlier 4–5 s and 564 MB were both optimistic. */
info("npm ci --prefer-offline (about 15–20 s, 680 MB)");
const install = spawnSync("npm", ["ci", "--prefer-offline", "--no-audit", "--no-fund"], {
  cwd: ROOT,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
if (install.status !== 0) {
  refuse("npm ci failed", [`${install.stdout ?? ""}${install.stderr ?? ""}`.trimEnd().split("\n").slice(-15).join("\n       ")]);
}
ok("dependencies installed");
/* Benign, but it looks alarming and somebody will chase it: npm no longer runs
   package install scripts without approval, so esbuild's postinstall is skipped.
   Its platform binary arrives as an optional dependency instead, which is why
   vite and vitest work anyway — checked by running a suite in a worktree. */
if (`${install.stdout ?? ""}`.includes("install-scripts")) {
  info("npm skipped some install scripts (esbuild) — expected, and harmless here");
}

/* ------------------------------------------------------------------ */
/* 3. The article store the tests read                                 */
/* ------------------------------------------------------------------ */

const corpus = materialiseCorpus(ROOT, { note: info });
if (corpus.copied.length === 0) {
  refuse(describeMaterialise(corpus), [
    "Without a store the suite is not merely reduced, it is misleading: 95 of",
    "477 files fail and most cannot even be collected, so a green-looking",
    "subset is what is left. Check tests/fixtures/data-root/ is present.",
  ]);
}
ok(describeMaterialise(corpus));

/* ------------------------------------------------------------------ */
/* 4. What this script cannot fix, said out loud                       */
/* ------------------------------------------------------------------ */

if (existsSync(path.join(ROOT, ".env.local"))) {
  ok(".env.local is here");
} else {
  bad(".env.local is missing — client tests cannot collect and no model call will work");
  info("`.worktreeinclude` names it, so this means the worktree was made by hand");
  info(`copy it in:  cp <primary>/.env.local ${ROOT}/`);
}

say();
info(`npm test         — expect ~14 of 477 files red, about what the primary has`);
info(`npm run dev      — walks up from ${PRIMARY_PORT}; a port outside the range warns at startup`);
info("and read docs/project/worktrees.md before landing anything");
say();
