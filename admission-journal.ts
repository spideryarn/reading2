/**
 * A small, many-writer record of memory-admission refusals.
 *
 * This leaf is imported by vitest.config.ts, so it deliberately depends on
 * Node builtins only. In particular, it must never pull the fleet dashboard
 * into the startup of every test run.
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

const DEFAULT_ADMISSION_JOURNAL_DIR = join(homedir(), ".fleet-admission");
const REFUSALS_FILE = "refusals.jsonl";
const PREVIOUS_REFUSALS_FILE = "refusals.prev.jsonl";
const MAX_REFUSAL_LINE_BYTES = 1024;
const MAX_REFUSAL_FILE_BYTES = 64 * 1024;

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

export function recordRefusal(input: RefusalInput, options: JournalOptions = {}): boolean {
  try {
    const { snapshot, reserveBytes } = input;
    const entry: RefusalEntry = {
      at: (options.now ?? (() => new Date()))().toISOString(),
      source: input.source,
      policyVersion: input.policyVersion,
      availableBytes: snapshot.kind === "linux" ? snapshot.availableBytes : null,
      reserveBytes: reserveBytes ?? null,
      swapTotalBytes: snapshot.kind === "linux" ? snapshot.swapTotalBytes : null,
      swapFreeBytes: snapshot.kind === "linux" ? snapshot.swapFreeBytes : null,
      pid: options.pid ?? process.pid,
      host: options.host ?? hostname(),
    };
    const line = `${JSON.stringify(entry)}\n`;
    if (Buffer.byteLength(line, "utf8") > MAX_REFUSAL_LINE_BYTES) return false;
    const dir = options.dir ?? DEFAULT_ADMISSION_JOURNAL_DIR;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    appendFileSync(join(dir, REFUSALS_FILE), line, {
      encoding: "utf8",
      /* Node's `a` is O_APPEND | O_CREAT | O_WRONLY. */
      flag: "a",
      mode: 0o600,
    });
    return true;
  } catch {
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

export function pruneRefusals(options: { dir?: string; maxFileBytes?: number } = {}): boolean {
  const dir = options.dir ?? DEFAULT_ADMISSION_JOURNAL_DIR;
  const live = join(dir, REFUSALS_FILE);
  let size: number;
  try {
    size = statSync(live).size;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw cause;
  }
  if (size <= (options.maxFileBytes ?? MAX_REFUSAL_FILE_BYTES)) return false;
  renameSync(live, join(dir, PREVIOUS_REFUSALS_FILE));
  return true;
}

type ReadRefusalOptions = Pick<JournalOptions, "dir"> & {
  readFile?: ((path: string) => string) | undefined;
};

export function readRefusals(options: ReadRefusalOptions = {}): RefusalRead {
  const dir = options.dir ?? DEFAULT_ADMISSION_JOURNAL_DIR;
  try {
    statSync(dir);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { kind: "directory-absent" };
    return { kind: "unreadable", why: `${dir} could not be read: ${(cause as Error).message}` };
  }
  try {
    pruneRefusals({ dir });
  } catch (cause) {
    return { kind: "unreadable", why: `${dir} could not be pruned: ${(cause as Error).message}` };
  }
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  const entries: RefusalEntry[] = [];
  let unparseableLines = 0;
  for (const name of [PREVIOUS_REFUSALS_FILE, REFUSALS_FILE]) {
    let text: string;
    try {
      text = readFile(join(dir, name));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") continue;
      return {
        kind: "unreadable",
        why: `${join(dir, name)} could not be read: ${(cause as Error).message}`,
      };
    }
    const lines = text.split("\n");
    if (lines.at(-1) === "") lines.pop();
    for (const line of lines) {
      const entry = parseRefusalLine(line);
      if (entry === null) unparseableLines += 1;
      else entries.push(entry);
    }
  }
  return { kind: "read", entries, unparseableLines };
}
