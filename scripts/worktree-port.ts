/**
 * The dev-server port range, and the one thing that must be true of a port.
 *
 * ## What this file used to be, and why it shrank
 *
 * It held an allocator: a reservation per worktree, in the shared git directory,
 * built on an exclusive file create. Greg deleted the idea with one question on
 * 2026-09-01 — *"maybe it's better to just make the whole thing dynamic"* — and
 * he was right for a reason worth keeping:
 *
 * **`bind()` is already an atomic port allocator, and the kernel is a better
 * arbiter than any file we can write.** A reservation answers "does another
 * worktree claim this port", which is a proxy for "can I listen on it", and a
 * weak proxy both ways: a reserved port can be taken by something outside this
 * repo, and an unreserved one can be free. Vite already walks upward from its
 * configured port when `strictPort` is false, so dynamic allocation is *less*
 * machinery, not more — and it re-decides on every start, so a port stolen by
 * something outside our control needs no release path, no staleness rule and no
 * sweep step.
 *
 * The assumption underneath the reservation was that a worktree needs a *stable*
 * port. It does not: `supabase/config.toml`'s redirect allow-list accepts any
 * port it names, so sign-in does not care which one you get. Stating that killed
 * 250 lines that had already been written, reviewed and tested.
 *
 * ## So what is left, and what still has to be true
 *
 * Vite allocates. This file owns the **range**, because that part is a real
 * constraint rather than a choice: the allow-list is a list of exact ports, and
 * a port outside it produces a sign-in that *appears to work* and then silently
 * drops the return path. `vite.config.ts` checks the resolved port against
 * `portInRange` after `listening` and says so loudly when it is outside — which
 * is the whole enforcement, and it lives where the answer is known rather than
 * where it was asked for.
 *
 * See docs/project/worktrees.md § Ports and the ceiling.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Every port the Supabase redirect allow-list must name, low to high.
 *
 * This is the ceiling, and it is a real one: `additional_redirect_urls` in
 * `supabase/config.toml` is a list of exact ports, so a port outside it produces
 * a sign-in that *appears to work* and silently drops the return path. Raising
 * `count` therefore means regenerating that list and restarting Supabase — one
 * edit here, but not only here.
 *
 * Greg, 2026-09-01: *"Conceivably we'd want to one day support >10 (e.g. 20 or
 * 30), though I realise that would require us to scale up this box to support
 * it."* So 31: the primary plus thirty worktrees.
 */
export const DEV_PORT_RANGE = { first: 5273, count: 31 } as const;

/**
 * The primary checkout's port, and **never allocated to a worktree**.
 *
 * Every doc, every browser check and the auth allow-list name 5273. GPT Sol's
 * finding 4: without this exclusion a worktree calling `reservePort()` was handed
 * 5273 first, so either the primary was already running and the worktree got an
 * unusable reservation, or it was not and the worktree quietly took the port the
 * primary is documented to keep.
 */
export const PRIMARY_PORT = 5273;

/** Every port in the range, low to high. */
export function devPorts(): number[] {
  return Array.from({ length: DEV_PORT_RANGE.count }, (_, i) => DEV_PORT_RANGE.first + i);
}

/** Is this a port the auth allow-list will have been told about? */
export function portInRange(port: number): boolean {
  if (!Number.isInteger(port)) return false;
  return port >= DEV_PORT_RANGE.first && port < DEV_PORT_RANGE.first + DEV_PORT_RANGE.count;
}

/**
 * The ports GoTrue will actually accept a redirect to, read from the config.
 *
 * **Not `DEV_PORT_RANGE`.** That constant is the range we *intend* the allow-list
 * to cover; this is what it covers today, and on 2026-09-01 those were 31 ports
 * and 1 port respectively. Trusting the constant made the startup warning in
 * `vite.config.ts` sit silent on 5274 — a port where sign-in genuinely does not
 * work — which is the exact failure the warning exists to prevent, rebuilt one
 * level up. Caught by running a worktree's dev server and watching it walk to
 * 5274 and say nothing.
 *
 * So the file is the source of truth, and the warning tells you what is true now
 * rather than what will be true after somebody extends the list and restarts
 * Supabase. Regex rather than a TOML parser, matching `declaredBuckets` in
 * scripts/deploy-checks.ts, which reads the same file the same way.
 *
 * Remember that **the running container is a third answer**: GoTrue bakes the
 * list in at start and never re-reads it, so a freshly-edited file still means a
 * broken sign-in until `npx supabase stop && npx supabase start`
 * (docs/project/setup-dev.md).
 */
export function allowListedPorts(configToml: string): number[] {
  const block = /additional_redirect_urls\s*=\s*\[([^\]]*)\]/.exec(configToml)?.[1] ?? "";
  const ports = new Set<number>();
  for (const m of block.matchAll(/https?:\/\/[^"'\s:]+:(\d+)/g)) {
    const port = Number(m[1]);
    if (Number.isInteger(port)) ports.add(port);
  }
  return [...ports].sort((a, b) => a - b);
}

/**
 * Parse `SPIDERYARN_DEV_PORT`, or throw saying why.
 *
 * `undefined` when the variable is absent, which is the primary's case and means
 * "use `PRIMARY_PORT`". **A value that is set but unusable throws**, rather than
 * falling back. GPT Sol's finding 3: the first version did
 * `Number(value) || 5273`, so `SPIDERYARN_DEV_PORT=oops` became 5273 and
 * collided with the primary, while `SPIDERYARN_DEV_PORT=6000` sailed past the
 * range check into Vite. A worktree whose port variable is malformed must not
 * silently become a second primary.
 */
export function parseDevPortEnv(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`SPIDERYARN_DEV_PORT=${JSON.stringify(raw)} is not a port number`);
  }
  const port = Number(trimmed);
  if (!portInRange(port)) {
    throw new Error(
      `SPIDERYARN_DEV_PORT=${port} is outside ${DEV_PORT_RANGE.first}–${lastPort()}. ` +
        "Supabase's redirect allow-list names these ports exactly, and one outside it gives a " +
        "sign-in that appears to work and then drops the return path — supabase/config.toml.",
    );
  }
  return port;
}

function lastPort(): number {
  return DEV_PORT_RANGE.first + DEV_PORT_RANGE.count - 1;
}

/** The shared `.git`, which is the primary's even when called from a worktree. */
export function gitCommonDir(cwd: string = process.cwd()): string {
  const out = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd,
    encoding: "utf8",
  }).trim();
  if (!out) throw new Error("git rev-parse --git-common-dir printed nothing");
  return out;
}

/**
 * Is `root` a **linked worktree** rather than the primary checkout?
 *
 * The guard `scripts/worktree-setup.ts` refuses on, and it has to be right in
 * one direction above all: that script runs `npm ci`, so mistaking the primary
 * for a worktree wipes and reinstalls `node_modules` while a dozen agents are
 * working in it.
 *
 * Asks git rather than looking at the path, because a path can be moved and a
 * `.git` entry can be a file for other reasons (a submodule). In a linked
 * worktree `--git-dir` is `…/.git/worktrees/<name>` while `--git-common-dir` is
 * the primary's `…/.git`; in the primary the two are identical. Verified against
 * a real worktree on 2026-09-01.
 */
export function inLinkedWorktree(
  root: string = process.cwd(),
  gitDirs: (root: string) => { dir: string; common: string } = readGitDirs,
): boolean {
  const { dir, common } = gitDirs(root);
  return path.resolve(dir) !== path.resolve(common);
}

function readGitDirs(root: string): { dir: string; common: string } {
  return { dir: gitDir(root), common: gitCommonDir(root) };
}

/** This checkout's own `.git`: the primary's, or `…/.git/worktrees/<name>`. */
export function gitDir(cwd: string = process.cwd()): string {
  const out = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-dir"], {
    cwd,
    encoding: "utf8",
  }).trim();
  if (!out) throw new Error("git rev-parse --git-dir printed nothing");
  return out;
}
