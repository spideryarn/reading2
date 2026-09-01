/**
 * One dev-server port per worktree, reserved rather than guessed.
 *
 * **Nothing reads this yet.** Wiring it is step 3 of
 * docs/plans/260828r-worktrees.md, and that step has to land as one unit —
 * `vite.config.ts` reading the reservation, the Supabase redirect allow-list
 * covering the range, and an identity endpoint — because each half hides the
 * other's failure. What is here is the allocator and its properties, tested.
 *
 * ## A reservation, not a lock — and this distinction was a bug
 *
 * The first version of this file used `takeLockFile`. GPT Sol caught why that
 * cannot work (`260828r-worktrees-step2-review-sol.md`, finding 1): a lock
 * registers `process.on("exit", release)`, which is the whole point of a lock
 * and exactly wrong here. `worktree:setup` claims a port and **exits**, so the
 * lock would evaporate on the way out and the next setup would hand out the same
 * port. The tests could not have caught it either, because they hold every lease
 * inside one vitest process.
 *
 * So a port reservation is *persistent*: a file that outlives its creator and is
 * removed when the worktree is swept, not when a process ends. It borrows
 * `publishExclusive` from `scripts/lockfile.ts` for the one property it does
 * need — a file that appears once, with its contents already in it.
 *
 * The runtime half is a different question and is not this file's job: two
 * processes cannot both listen on one port whatever this says, and the loud
 * failure for that lives in `vite.config.ts`.
 *
 * ## Why not a hash, and why not scan-then-pick
 *
 * The plan first proposed hashing the worktree name into the range. GPT Sol did
 * the arithmetic: at ten worktrees in a 30-wide range that collides about
 * **99.96%** of the time, and a collision is not a crash — it is two servers
 * wanting one port, where the first one answers and an agent tests a peer's work
 * and reports success.
 *
 * A scan-then-pick has the same shape more subtly: two setups running together
 * both see 5274 free and both take it. So the claim has to *be* the test, which
 * is what an exclusive create gives.
 *
 * ## Why the reservations live in the shared git directory
 *
 * A reservation is only worth anything if every worktree can see it, and
 * worktrees have separate working directories. What they share is the
 * repository: `.git` in the primary, reachable from anywhere as
 * `git rev-parse --git-common-dir`. Two properties fall out of that choice
 * rather than needing to be arranged — every worktree sees the same set, and
 * they can never be committed by accident. Confirmed by Sol against a real
 * linked worktree, including that a worktree of a worktree still shares it, and
 * that a submodule correctly gets its own.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

import { publishExclusive } from "./lockfile.js";

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

/** The ports a worktree may be given: the range, minus the primary's. */
export function allocatablePorts(): number[] {
  return devPorts().filter((port) => port !== PRIMARY_PORT);
}

/** Is this a port the auth allow-list will have been told about? */
export function portInRange(port: number): boolean {
  if (!Number.isInteger(port)) return false;
  return port >= DEV_PORT_RANGE.first && port < DEV_PORT_RANGE.first + DEV_PORT_RANGE.count;
}

/** Is this a port a *worktree* may hold? Excludes the primary's. */
export function allocatable(port: number): boolean {
  return portInRange(port) && port !== PRIMARY_PORT;
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

/** Where reservations live: one file per port, in the shared git directory. */
export function reservationDir(gitCommonDir: string): string {
  return path.join(gitCommonDir, "spideryarn-worktree-ports");
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

/** Only `<port>.reserved`, so a stray file named `5273` is not a reservation. */
const RESERVATION_FILE = /^(\d+)\.reserved$/;

export interface Reservation {
  port: number;
  /** Who claimed it — a worktree path, so a full range can name its holders. */
  holder: string;
  since: string;
}

export interface PortReservation extends Reservation {
  /** Give the port back. For the sweep, not for process exit. */
  release(): void;
}

export interface ReservePortOptions {
  /** Reservation directory. Defaults to the shared git dir, which is the point. */
  dir?: string;
  /** Recorded in the file so a full range can say who holds what. */
  holder?: string;
  /**
   * Ask for one specific port instead of the first free one. Refused if it is
   * not allocatable — a caller that has computed a port is exactly the caller
   * that might have computed a wrong one.
   */
  want?: number;
  /** Injected for tests. Every candidate is still range-checked. */
  ports?: readonly number[];
  /** Clock, injected for tests. */
  now?(): Date;
}

/**
 * Reserve a port for the life of the worktree, or throw.
 *
 * Walks the candidates low to high and returns the first whose file it can
 * actually create, so the claim is the test. An existing file means somebody has
 * that port, so move on; **any other error is rethrown**, because "could not
 * write the reservation" and "this port is taken" are opposite diagnoses and
 * treating the first as the second walks the whole range, calls it full, and
 * reports a wrong reason for a real problem.
 *
 * **Every candidate is checked, not just `want`.** GPT Sol's finding 5: the
 * first version validated only `want`, so `reservePort({ports: [9999]})`
 * succeeded through an exported option and the stated invariant — "a port
 * outside the range is refused" — was simply false.
 */
export function reservePort(opts: ReservePortOptions = {}): PortReservation {
  const dir = opts.dir ?? reservationDir(gitCommonDir());
  const holder = opts.holder ?? process.cwd();
  const now = opts.now ?? (() => new Date());
  const candidates = opts.want === undefined ? (opts.ports ?? allocatablePorts()) : [opts.want];

  for (const port of candidates) {
    if (allocatable(port)) continue;
    throw new Error(
      port === PRIMARY_PORT
        ? `port ${port} belongs to the primary checkout and is never given to a worktree`
        : `port ${port} is outside the worktree range ${DEV_PORT_RANGE.first}–${lastPort()}. ` +
          "Supabase's redirect allow-list names these ports exactly, and one outside it gives a " +
          "sign-in that appears to work and then drops the return path — supabase/config.toml.",
    );
  }

  mkdirSync(dir, { recursive: true });
  const since = now().toISOString();

  for (const port of candidates) {
    const file = path.join(dir, `${port}.reserved`);
    if (publishExclusive(file, `${holder}\n${since}\n`)) {
      return { port, holder, since, release: () => releaseFile(file) };
    }
  }

  throw new Error(
    opts.want !== undefined
      ? `port ${opts.want} is already reserved by ${readReservation(path.join(dir, `${opts.want}.reserved`))?.holder ?? "another worktree"}`
      : `all ${candidates.length} worktree ports are reserved (${dir}). ` +
        "Either that many worktrees exist, or a removed one left its reservation behind — " +
        "these are plain files naming their holder, so read one before deleting it.",
  );
}

function releaseFile(file: string): void {
  try {
    unlinkSync(file);
  } catch (err) {
    /* Already gone is the same outcome as removing it. Anything else is real. */
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/** Read one reservation, or `null` when there is none. */
export function readReservation(file: string): Reservation | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const port = Number(RESERVATION_FILE.exec(path.basename(file))?.[1]);
  const [holder = "", since = ""] = text.split("\n");
  return { port, holder, since };
}

/**
 * Ports currently reserved, low to high. Reads, never claims.
 *
 * `ENOENT` on the directory means nothing has ever been reserved. Every other
 * failure is thrown, because reporting a permissions problem as "nothing is
 * reserved" is the fail-open shape this whole file is about.
 */
export function reservedPorts(dir: string): number[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((name) => {
      if (!RESERVATION_FILE.test(name)) return false;
      /* A directory called `5274.reserved` is not a reservation either. */
      try {
        return statSync(path.join(dir, name)).isFile();
      } catch {
        return false;
      }
    })
    .map((name) => Number(RESERVATION_FILE.exec(name)?.[1]))
    .sort((a, b) => a - b);
}
