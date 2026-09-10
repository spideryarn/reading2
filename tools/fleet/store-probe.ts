/**
 * **What each file in a store directory looks like from the outside** — there
 * or not, how big, how old, which schema it declares, and whether an
 * append-only log ends mid-line. docs/plans/260910f § D5.
 *
 * Generic on purpose, and fleet-owned: `overseer diagnose` uses it over the
 * Overseer's store, and the dashboard's `GET /api/diagnostics` uses it over the
 * same files — and `tools/fleet/` may not import `tools/overseer/`. So nothing
 * here knows what a file MEANS: it names what the file declares, and the
 * caller compares that with the schema its own build reads.
 *
 * ## Four answers that must not collapse
 *
 *  - `absent` is not `unreadable`: a daemon that has never written a file is a
 *    different fact from a file this process cannot open.
 *  - `schema: "none-declared"` means the record parsed and has no schema field;
 *    `schema: null` means there was nothing this probe could read a schema
 *    from, and `schemaUnread` says which of the reasons it was. The first is a
 *    file's design; the second is a question left open.
 *  - `tornTail: true` is a log caught between an append's first byte and its
 *    newline — ordinary while a writer is mid-append, and not corruption. It is
 *    reported rather than judged.
 *
 * ## The per-request contract (Sol's F8)
 *
 * The dashboard runs this on every request, and the dashboard has no
 * authentication. So:
 *
 *  - **A fixed allow-list of names whose contents are read.**
 *    {@link STORE_PROBE_FILES} is the store's file set, and the dashboard's
 *    route probes exactly it. Any other plain name — an entry `overseer
 *    diagnose` found by listing the directory — is `lstat`ed only: sized, aged,
 *    its kind named, never opened. A name with a separator, `.` or `..` is
 *    refused without touching the filesystem, so no caller can steer a probe
 *    out of the store directory. `readStoreTail` reads allow-listed names only.
 *  - **`lstat` first, and nothing followed.** A symbolic link is reported as
 *    one and never opened, dangling or not; so is a directory, FIFO, socket or
 *    device. Opening a FIFO for reading blocks until a writer appears, which is
 *    a request that never answers. The open itself is `O_NOFOLLOW | O_NONBLOCK`
 *    and the descriptor is re-checked against the `lstat`, so a file swapped
 *    between the two is caught rather than read.
 *  - **Bounded reads.** A JSONL log only grows (`usage.jsonl` is 1.7 MB on the
 *    box), so only its last {@link JSONL_TAIL_BYTES} are read; the first line
 *    in that window is usually the back half of a record and is dropped rather
 *    than parsed. A JSON file is read whole up to {@link JSON_MAX_BYTES}; past
 *    that it is sized and aged, and its schema is unknown with the reason.
 *
 * Read-only and lock-free: nothing here writes, and a file replaced by rename
 * mid-probe is read as one version or the other.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, type Stats } from "node:fs";
import { extname, join } from "node:path";

import type { StoreFileProbe } from "./wire.js";

export type { StoreFileProbe } from "./wire.js";

/** How much of the end of a JSONL log is read to find its last complete line. */
export const JSONL_TAIL_BYTES = 64 * 1024;

/**
 * A JSON file larger than this is sized and aged, and its schema not read. The
 * largest on the box is `current.json` at ~110 KB (2026-09-10); a megabyte is
 * ten times that and still cheap to parse once per request.
 */
export const JSON_MAX_BYTES = 1024 * 1024;

/** A file to probe: its name, or its name and the field its records call their schema. */
export type ProbeTarget = string | { readonly name: string; readonly schemaField: string };

/**
 * **The allow-list: every file the Overseer's store holds**, as literal names
 * because the constants that name them live in `tools/overseer/`, which this
 * directory may not import. `tests/overseer-diagnose.test.ts` probes
 * `diagnose`'s own list over an empty store and expects every row `absent`, so
 * a name the Overseer adds without adding it here fails there, as "not on this
 * probe's allow-list".
 */
export const STORE_PROBE_FILES: readonly ProbeTarget[] = [
  "current.json",
  "recovery.json",
  "events.jsonl",
  "daemon.jsonl",
  "schedule.json",
  "attention.json",
  // Its envelope field is `lineSchema`, not `schema` (usage-history-record.ts).
  { name: "usage.jsonl", schemaField: "lineSchema" },
  "reports.jsonl",
  "decisions.jsonl",
  "queue.jsonl",
  "cli-state.json",
  "descriptions.json",
  "last-snapshot.json",
  "overseer.lock",
];

const nameOf = (target: ProbeTarget): string => (typeof target === "string" ? target : target.name);

const ALLOWED: ReadonlySet<string> = new Set(STORE_PROBE_FILES.map(nameOf));

/** The fields a record might carry its own instant in, in the order they are tried. */
const INSTANT_FIELDS = ["at", "recordedAt", "submittedAt", "writtenAt"] as const;

export function probeStoreFiles(root: string, targets: readonly ProbeTarget[], now: Date): StoreFileProbe[] {
  return targets.map((target) => {
    const name = nameOf(target);
    const schemaField = typeof target === "string" ? "schema" : target.schemaField;
    return probeOne(root, name, schemaField, now.getTime());
  });
}

/** An open, verified-regular store file, or why not. The caller closes `fd`. */
type Opened = { kind: "open"; fd: number; stat: Stats } | { kind: "absent" } | { kind: "unreadable"; why: string };

function openRegular(root: string, name: string): Opened {
  if (!ALLOWED.has(name)) return { kind: "unreadable", why: `${JSON.stringify(name)} is not on this probe's allow-list of store file names` };
  const path = join(root, name);
  let before: Stats;
  try {
    before = lstatSync(path);
  } catch (cause) {
    if (isErrno(cause, "ENOENT")) return { kind: "absent" };
    return { kind: "unreadable", why: describeCause(cause) };
  }
  if (before.isSymbolicLink()) return { kind: "unreadable", why: `${name} is a symbolic link, which this probe reports and does not follow` };
  if (!before.isFile()) return { kind: "unreadable", why: `${name} is ${kindOf(before)}, not a regular file, so it is not opened` };
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (cause) {
    if (isErrno(cause, "ENOENT")) return { kind: "absent" };
    if (isErrno(cause, "ELOOP")) return { kind: "unreadable", why: `${name} became a symbolic link while being probed, and was not followed` };
    return { kind: "unreadable", why: describeCause(cause) };
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev) {
      closeSync(fd);
      return { kind: "unreadable", why: `${name} was replaced by something else while being probed` };
    }
    return { kind: "open", fd, stat };
  } catch (cause) {
    closeSync(fd);
    return { kind: "unreadable", why: describeCause(cause) };
  }
}

function kindOf(stat: Stats): string {
  if (stat.isDirectory()) return "a directory";
  if (stat.isFIFO()) return "a FIFO";
  if (stat.isSocket()) return "a socket";
  if (stat.isCharacterDevice() || stat.isBlockDevice()) return "a device";
  return "something other than a file";
}

/**
 * The last `maxBytes` of an allow-listed store file, under the same contract
 * as the probe — for a reader that needs the records themselves, such as the
 * dashboard's reader of the daemon's start note. `windowed` means the chunk
 * starts mid-file, so its first line is part of an earlier record.
 */
export type StoreTail =
  | { kind: "read"; tail: Buffer; bytes: number; windowed: boolean }
  | { kind: "absent" }
  | { kind: "unreadable"; why: string };

export function readStoreTail(root: string, name: string, maxBytes: number): StoreTail {
  const opened = openRegular(root, name);
  if (opened.kind !== "open") return opened;
  try {
    const bytes = opened.stat.size;
    const tail = readTail(opened.fd, bytes, maxBytes);
    return { kind: "read", tail, bytes, windowed: bytes > tail.byteLength };
  } catch (cause) {
    return { kind: "unreadable", why: describeCause(cause) };
  } finally {
    closeSync(opened.fd);
  }
}

/** One entry in the store directory: no separators, not `.` or `..`, no NUL. */
function isPlainName(name: string): boolean {
  return name !== "" && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\\") && !name.includes("\0");
}

/**
 * A plain name that is NOT on the allow-list — an entry `overseer diagnose`
 * found by listing the directory — is `lstat`ed and never opened: sized, aged,
 * its kind named, and its contents not read. So a probe can be pointed at a
 * name nobody catalogued without reading it, and at a path not at all.
 */
function statOnly(root: string, name: string, nowMs: number): StoreFileProbe {
  let stat: Stats;
  try {
    stat = lstatSync(join(root, name));
  } catch (cause) {
    if (isErrno(cause, "ENOENT")) return { name, state: "absent" };
    return { name, state: "unreadable", why: describeCause(cause) };
  }
  if (stat.isSymbolicLink()) return { name, state: "unreadable", why: `${name} is a symbolic link, which this probe reports and does not follow` };
  if (!stat.isFile()) return { name, state: "unreadable", why: `${name} is ${kindOf(stat)}, not a regular file, so it is not opened` };
  return {
    name,
    state: "present",
    bytes: stat.size,
    mtimeAgeMs: nowMs - Math.round(stat.mtimeMs),
    format: "other",
    ...unread("not on this probe's allow-list of store files, so its contents are not read"),
    tornTail: null,
  };
}

function probeOne(root: string, name: string, schemaField: string, nowMs: number): StoreFileProbe {
  if (!isPlainName(name)) return { name, state: "unreadable", why: `${JSON.stringify(name)} is not a plain file name in the store directory` };
  if (!ALLOWED.has(name)) return statOnly(root, name, nowMs);
  const opened = openRegular(root, name);
  if (opened.kind === "absent") return { name, state: "absent" };
  if (opened.kind === "unreadable") return { name, state: "unreadable", why: opened.why };
  const { fd, stat } = opened;
  try {
    const bytes = stat.size;
    const mtimeAgeMs = nowMs - Math.round(stat.mtimeMs);
    const extension = extname(name);
    if (extension === ".jsonl") {
      const tail = readTail(fd, bytes, JSONL_TAIL_BYTES);
      const last = lastCompleteLine(tail, bytes > tail.byteLength);
      const record = last === null ? null : parseRecord(last);
      const lastLineAt = record === null ? undefined : instantOf(record);
      const schema = last === null
        ? unread(`no complete line in the last ${JSONL_TAIL_BYTES / 1024} KB`)
        : record === null
          ? unread("the last complete line is not a JSON object")
          : schemaOf(record, schemaField);
      return {
        name,
        state: "present",
        bytes,
        mtimeAgeMs,
        format: "jsonl",
        ...schema,
        tornTail: bytes > 0 && tail[tail.byteLength - 1] !== 0x0a,
        ...(lastLineAt === undefined ? {} : { lastLineAt }),
      };
    }
    if (extension === ".json") {
      let schema: SchemaReading;
      if (bytes > JSON_MAX_BYTES) {
        schema = unread(`too large to read in a request: ${bytes} bytes, over the ${JSON_MAX_BYTES / (1024 * 1024)} MB ceiling`);
      } else {
        const record = parseRecord(readTail(fd, bytes, bytes).toString("utf8"));
        schema = record === null ? unread("the file is not a JSON object") : schemaOf(record, schemaField);
      }
      return { name, state: "present", bytes, mtimeAgeMs, format: "json", ...schema, tornTail: null };
    }
    return { name, state: "present", bytes, mtimeAgeMs, format: "other", ...unread("not a record file, so no schema is read"), tornTail: null };
  } catch (cause) {
    return { name, state: "unreadable", why: describeCause(cause) };
  } finally {
    closeSync(fd);
  }
}

type SchemaReading = { schema: number | "none-declared"; schemaUnread: null } | { schema: null; schemaUnread: string };

const unread = (why: string): SchemaReading => ({ schema: null, schemaUnread: why });

/** The last `limit` bytes of a file of `size` bytes, read fully (a short read is looped, not trusted). */
function readTail(fd: number, size: number, limit: number): Buffer {
  const length = Math.min(size, limit);
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const count = readSync(fd, buffer, read, length - read, size - length + read);
    if (count <= 0) break;
    read += count;
  }
  return buffer.subarray(0, read);
}

/**
 * The last newline-terminated line in `tail`, or null when there is none.
 * `windowed` means the tail started mid-file, so text before its first newline
 * is part of an earlier record and is never a candidate.
 */
function lastCompleteLine(tail: Buffer, windowed: boolean): string | null {
  const end = tail.lastIndexOf(0x0a);
  if (end === -1) return null;
  const floor = windowed ? tail.indexOf(0x0a) : -1;
  if (floor >= end) return null;
  const lines = tail.subarray(floor + 1, end).toString("utf8").split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line !== undefined && line.trim() !== "") return line;
  }
  return null;
}

function parseRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function schemaOf(record: Record<string, unknown>, field: string): SchemaReading {
  if (!Object.hasOwn(record, field)) return { schema: "none-declared", schemaUnread: null };
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? { schema: value, schemaUnread: null } : unread(`its \`${field}\` field is not a number`);
}

function instantOf(record: Record<string, unknown>): string | undefined {
  for (const field of INSTANT_FIELDS) {
    const value = record[field];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function isErrno(cause: unknown, code: string): boolean {
  return typeof cause === "object" && cause !== null && (cause as NodeJS.ErrnoException).code === code;
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
