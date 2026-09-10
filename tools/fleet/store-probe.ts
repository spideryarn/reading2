/**
 * **What each file in a store directory looks like from the outside** — there
 * or not, how big, how old, which schema it declares, and whether an
 * append-only log ends mid-line. docs/plans/260910f § D5.
 *
 * Generic on purpose, and fleet-owned: `overseer diagnose` uses it over the
 * Overseer's store, and the dashboard's diagnostics route (Stage 3) will use it
 * over the same files — and `tools/fleet/` may not import `tools/overseer/`. So
 * nothing here knows what a file MEANS: it names what the file declares, and
 * the caller compares that with the schema its own build reads.
 *
 * ## Four answers that must not collapse
 *
 *  - `absent` is not `unreadable`: a daemon that has never written a file is a
 *    different fact from a file this process cannot open.
 *  - `schema: "none-declared"` means the record parsed and has no schema field;
 *    `schema: null` means there was nothing this probe could read a schema
 *    from (unparseable, not a number, no complete line). The first is a file's
 *    design; the second is a question left open.
 *  - `tornTail: true` is a log caught between an append's first byte and its
 *    newline — ordinary while a writer is mid-append, and not corruption. It is
 *    reported rather than judged.
 *
 * ## Bounded reads
 *
 * A JSONL log only grows (`usage.jsonl` is 1.7 MB on the box), so only its last
 * {@link JSONL_TAIL_BYTES} are read. The first line in that window is usually
 * the back half of a record, so it is dropped rather than parsed. A JSON file is
 * read whole, up to {@link JSON_MAX_BYTES}; beyond that its schema is `null`.
 *
 * Read-only and lock-free: nothing here writes, and a file replaced by rename
 * mid-probe is read as one version or the other.
 */
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { extname, join } from "node:path";

/** How much of the end of a JSONL log is read to find its last complete line. */
export const JSONL_TAIL_BYTES = 64 * 1024;

/** A JSON file larger than this is sized and aged, and its schema not read. */
export const JSON_MAX_BYTES = 4 * 1024 * 1024;

/** A file to probe: its name, or its name and the field its records call their schema. */
export type ProbeTarget = string | { readonly name: string; readonly schemaField: string };

export type StoreFileProbe =
  | { name: string; state: "absent" }
  | { name: string; state: "unreadable"; why: string }
  | {
      name: string;
      state: "present";
      bytes: number;
      /** Against the clock the caller gave; negative when the file is from the future. */
      mtimeAgeMs: number;
      format: "json" | "jsonl" | "other";
      /** See the header: a number declared, `none-declared`, or `null` for could-not-read. */
      schema: number | null | "none-declared";
      /** JSONL only: the file does not end in a newline. `null` for any other format. */
      tornTail: boolean | null;
      /** JSONL only: the last complete record's own timestamp, when it has one. */
      lastLineAt?: string;
    };

/** The fields a record might carry its own instant in, in the order they are tried. */
const INSTANT_FIELDS = ["at", "recordedAt", "submittedAt", "writtenAt"] as const;

export function probeStoreFiles(root: string, targets: readonly ProbeTarget[], now: Date): StoreFileProbe[] {
  return targets.map((target) => {
    const name = typeof target === "string" ? target : target.name;
    const schemaField = typeof target === "string" ? "schema" : target.schemaField;
    return probeOne(join(root, name), name, schemaField, now.getTime());
  });
}

function probeOne(path: string, name: string, schemaField: string, nowMs: number): StoreFileProbe {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (cause) {
    if (isErrno(cause, "ENOENT")) return { name, state: "absent" };
    return { name, state: "unreadable", why: describeCause(cause) };
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { name, state: "unreadable", why: `${name} is not a file` };
    const bytes = stat.size;
    const mtimeAgeMs = nowMs - Math.round(stat.mtimeMs);
    const extension = extname(name);
    if (extension === ".jsonl") {
      const tail = readTail(fd, bytes, JSONL_TAIL_BYTES);
      const last = lastCompleteLine(tail, bytes > tail.byteLength);
      const record = last === null ? null : parseRecord(last);
      const lastLineAt = record === null ? undefined : instantOf(record);
      return {
        name,
        state: "present",
        bytes,
        mtimeAgeMs,
        format: "jsonl",
        schema: record === null ? null : schemaOf(record, schemaField),
        tornTail: bytes > 0 && tail[tail.byteLength - 1] !== 0x0a,
        ...(lastLineAt === undefined ? {} : { lastLineAt }),
      };
    }
    if (extension === ".json") {
      const record = bytes > JSON_MAX_BYTES ? null : parseRecord(readTail(fd, bytes, bytes).toString("utf8"));
      return { name, state: "present", bytes, mtimeAgeMs, format: "json", schema: record === null ? null : schemaOf(record, schemaField), tornTail: null };
    }
    return { name, state: "present", bytes, mtimeAgeMs, format: "other", schema: null, tornTail: null };
  } catch (cause) {
    return { name, state: "unreadable", why: describeCause(cause) };
  } finally {
    closeSync(fd);
  }
}

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

function schemaOf(record: Record<string, unknown>, field: string): number | null | "none-declared" {
  if (!Object.hasOwn(record, field)) return "none-declared";
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
