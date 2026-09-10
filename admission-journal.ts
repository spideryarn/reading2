/**
 * A small, many-writer record of memory-admission refusals.
 *
 * This leaf is imported by vitest.config.ts, so it deliberately depends on
 * Node builtins only. In particular, it must never pull the fleet dashboard
 * into the startup of every test run.
 */
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

const DEFAULT_ADMISSION_JOURNAL_DIR = join(homedir(), ".fleet-admission");
const MAX_REFUSAL_RECORD_BYTES = 1024;
/** Reader-enforced: JSON parsing and retained storage stop at this count. */
export const MAX_RETAINED_REFUSALS = 256;
const STALE_TEMPORARY_FILE_MS = 60 * 60 * 1_000;
const FINAL_REFUSAL_NAME =
  /^refusal-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-\d{10,16}-[0-9a-f]{16}\.json$/;

type JournalMemorySnapshot =
  | {
      kind: "linux";
      availableBytes: number;
      swapTotalBytes: number;
      swapFreeBytes: number;
    }
  | { kind: "not-linux"; platform: string }
  | { kind: "broken"; why: string };

type RefusalEntry = {
  at: string;
  source: "test-run" | "readiness-precheck";
  policyVersion: number;
  availableBytes: number | null;
  reserveBytes: number | null;
  swapTotalBytes: number | null;
  swapFreeBytes: number | null;
  pid: number;
  host: string;
};

/**
 * **The readings the decision was made on — values, never readers.**
 *
 * This type accepted a thunk as well as a value, and `vitest.config.ts` passed
 * `readMemorySnapshot` and `readReserveBytes` themselves, so the journal
 * re-read `/proc/meminfo` and the reserve file at record time. The numbers it
 * wrote were therefore a *second, later* sample and not the ones the gate
 * refused on — which is the one thing this record exists to hold, and the
 * difference is largest under exactly the memory pressure that produced the
 * refusal. It is a true number under a false label, the defect this whole
 * feature keeps generating.
 *
 * A test could have caught it at the call site; a type refuses it everywhere.
 * The caller now has to hold the readings it decided on and hand them over,
 * which is also the only way it *can* hand over the right ones.
 */
type RefusalInput = {
  source: RefusalEntry["source"];
  policyVersion: number;
  snapshot: JournalMemorySnapshot;
  reserveBytes: number | undefined;
};

type JournalOptions = {
  dir?: string | undefined;
  now?: (() => Date) | undefined;
  pid?: number | undefined;
  host?: string | undefined;
};

function timestampForName(at: string): string {
  return at.replaceAll(":", "-");
}

export function recordRefusal(input: RefusalInput, options: JournalOptions = {}): boolean {
  let temporaryPath: string | null = null;
  let temporaryCreated = false;
  let temporaryFd: number | null = null;
  try {
    const { snapshot, reserveBytes } = input;
    const at = (options.now ?? (() => new Date()))().toISOString();
    const entry: RefusalEntry = {
      at,
      source: input.source,
      policyVersion: input.policyVersion,
      availableBytes: snapshot.kind === "linux" ? snapshot.availableBytes : null,
      reserveBytes: reserveBytes ?? null,
      swapTotalBytes: snapshot.kind === "linux" ? snapshot.swapTotalBytes : null,
      swapFreeBytes: snapshot.kind === "linux" ? snapshot.swapFreeBytes : null,
      pid: options.pid ?? process.pid,
      host: options.host ?? hostname(),
    };
    const encoded = JSON.stringify(entry);
    /* `number` admits NaN, infinities and negatives, and hostile JS can still
       reach this boundary despite the TypeScript shape. Never report success
       for a record that this module's own reader will reject. */
    if (encoded === undefined || parseRefusalLine(encoded) === null) return false;
    if (Buffer.byteLength(encoded, "utf8") > MAX_REFUSAL_RECORD_BYTES) return false;
    const dir = options.dir ?? DEFAULT_ADMISSION_JOURNAL_DIR;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const suffix = randomBytes(8).toString("hex");
    const pid = String(entry.pid).padStart(10, "0");
    const finalPath = join(dir, `refusal-${timestampForName(at)}-${pid}-${suffix}.json`);
    temporaryPath = join(dir, `.tmp-${pid}-${suffix}`);

    /* Opening separately lets us distinguish our own partially-written temp
       from an `EEXIST` collision, which must never delete another writer's
       file during cleanup. Nothing reads a `.tmp-*` name. */
    temporaryFd = openSync(temporaryPath, "wx", 0o600);
    temporaryCreated = true;
    /* The exclusive temp name reserves this complete name tuple across
       writers that follow this protocol. Refuse a forced random collision
       instead of letting POSIX rename replace an earlier refusal. */
    if (existsSync(finalPath)) {
      closeSync(temporaryFd);
      temporaryFd = null;
      unlinkSync(temporaryPath);
      temporaryCreated = false;
      return false;
    }
    writeFileSync(temporaryFd, encoded, "utf8");
    const temporaryIdentity = fstatSync(temporaryFd, { bigint: true });
    renameSync(temporaryPath, finalPath);
    /* The temp pathname is free for reuse as soon as rename returns. From here
       on, cleanup must not unlink a different writer's new reservation. */
    temporaryCreated = false;
    const publishedIdentity = statSync(finalPath, { bigint: true });
    closeSync(temporaryFd);
    temporaryFd = null;
    /* Stale-temp cleanup can unlink a writer paused for over an hour. If
       another writer then reuses the forced-collision pathname, rename could
       otherwise publish that writer's inode under this call's name. Keeping
       our descriptor open makes inode reuse impossible; success belongs only
       to the inode we actually wrote. */
    return temporaryIdentity.dev === publishedIdentity.dev && temporaryIdentity.ino === publishedIdentity.ino;
  } catch {
    if (temporaryFd !== null) {
      try {
        closeSync(temporaryFd);
      } catch {
        /* The original write/publication failure remains the return value. */
      }
    }
    if (temporaryCreated && temporaryPath !== null) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        /* A crash can leave the same shape; the reader ignores it and later
           removes it once stale. Cleanup must not escape this best-effort leaf. */
      }
    }
    return false;
  }
}

type RefusalRead =
  | { kind: "read"; entries: RefusalEntry[]; unparseableLines: number }
  | { kind: "directory-absent" }
  | { kind: "unreadable"; why: string };

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function nullableBytes(input: unknown): input is number | null {
  return input === null || (typeof input === "number" && Number.isSafeInteger(input) && input >= 0);
}

function parseRefusalLine(line: string): RefusalEntry | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const at = raw["at"];
  const source = raw["source"];
  const policyVersion = raw["policyVersion"];
  const availableBytes = raw["availableBytes"];
  const reserveBytes = raw["reserveBytes"];
  const swapTotalBytes = raw["swapTotalBytes"];
  const swapFreeBytes = raw["swapFreeBytes"];
  const pid = raw["pid"];
  const host = raw["host"];
  if (
    typeof at !== "string" ||
    !Number.isFinite(Date.parse(at)) ||
    (source !== "test-run" && source !== "readiness-precheck") ||
    typeof policyVersion !== "number" ||
    !Number.isSafeInteger(policyVersion) ||
    policyVersion < 0 ||
    !nullableBytes(availableBytes) ||
    !nullableBytes(reserveBytes) ||
    !nullableBytes(swapTotalBytes) ||
    !nullableBytes(swapFreeBytes) ||
    typeof pid !== "number" ||
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    typeof host !== "string" ||
    host.trim() === ""
  ) {
    return null;
  }
  return {
    at,
    source,
    policyVersion,
    availableBytes,
    reserveBytes,
    swapTotalBytes,
    swapFreeBytes,
    pid,
    host,
  };
}

type PruneOptions = {
  dir?: string | undefined;
  maxRecords?: number | undefined;
  nowMs?: number | undefined;
  unlinkFile?: ((path: string) => void) | undefined;
};

type JournalSnapshot = {
  retainedNames: string[];
  removed: boolean;
};

function removeIfPresent(path: string, unlinkFile: (path: string) => void): boolean {
  try {
    unlinkFile(path);
    return true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw cause;
  }
}

function pruneSnapshot(dir: string, names: string[], options: Omit<PruneOptions, "dir">): JournalSnapshot {
  const maxRecords = options.maxRecords ?? MAX_RETAINED_REFUSALS;
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 0) {
    throw new RangeError("maxRecords must be a non-negative safe integer");
  }
  const unlinkFile = options.unlinkFile ?? unlinkSync;
  const nowMs = options.nowMs ?? Date.now();
  let removed = false;

  for (const name of names) {
    if (!name.startsWith(".tmp-")) continue;
    const path = join(dir, name);
    let modifiedMs: number;
    try {
      modifiedMs = statSync(path).mtimeMs;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw cause;
    }
    if (nowMs - modifiedMs >= STALE_TEMPORARY_FILE_MS) {
      removed = removeIfPresent(path, unlinkFile) || removed;
    }
  }

  const finalNames = names.filter((name) => FINAL_REFUSAL_NAME.test(name)).sort();
  const excess = Math.max(0, finalNames.length - maxRecords);
  for (const name of finalNames.slice(0, excess)) {
    removed = removeIfPresent(join(dir, name), unlinkFile) || removed;
  }
  return { retainedNames: finalNames.slice(excess), removed };
}

export function pruneRefusals(options: PruneOptions = {}): boolean {
  const dir = options.dir ?? DEFAULT_ADMISSION_JOURNAL_DIR;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw cause;
  }
  return pruneSnapshot(dir, names, options).removed;
}

type ReadRefusalOptions = Pick<JournalOptions, "dir"> & {
  readFile?: ((path: string) => string) | undefined;
  maxRecords?: number | undefined;
  nowMs?: number | undefined;
  unlinkFile?: ((path: string) => void) | undefined;
};

export function readRefusals(options: ReadRefusalOptions = {}): RefusalRead {
  const dir = options.dir ?? DEFAULT_ADMISSION_JOURNAL_DIR;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { kind: "directory-absent" };
    return { kind: "unreadable", why: `${dir} could not be read: ${(cause as Error).message}` };
  }
  let retainedNames: string[];
  try {
    retainedNames = pruneSnapshot(dir, names, {
      maxRecords: options.maxRecords,
      nowMs: options.nowMs,
      unlinkFile: options.unlinkFile,
    }).retainedNames;
  } catch (cause) {
    return { kind: "unreadable", why: `${dir} could not be pruned: ${(cause as Error).message}` };
  }
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  const entries: RefusalEntry[] = [];
  let unparseableLines = 0;
  for (const name of retainedNames) {
    let encoded: string;
    try {
      encoded = readFile(join(dir, name));
    } catch (cause) {
      /* Another reader may have taken an older snapshot and pruned this file.
         That is retention, not a failure to read the directory. */
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") continue;
      return {
        kind: "unreadable",
        why: `${join(dir, name)} could not be read: ${(cause as Error).message}`,
      };
    }
    const entry = parseRefusalLine(encoded);
    if (entry === null) unparseableLines += 1;
    else entries.push(entry);
  }
  return { kind: "read", entries, unparseableLines };
}
