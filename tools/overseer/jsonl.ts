/**
 * The append-only-file discipline the Overseer's two logs share.
 *
 * `events.jsonl` (the fleet's history, store.ts) and `daemon.jsonl` (the
 * Overseer's own condition, notes.ts) are the same kind of file, opened the same
 * way, for the same reasons. They were also the same twenty lines, written
 * twice: `store.ts` kept its version private, so notes.ts arrived as a
 * **duplicate of a subtle rule rather than a reuse of one**, said so in a
 * comment, and reported it as a finding because that file was under review at the
 * time. This module is that finding closed.
 *
 * Nothing here knows what a line MEANS. Parsing, validating and folding stay
 * with whichever module owns the records; what is here is the three rules that
 * are about bytes on a disk, and each of them exists because of a specific way
 * a log rots.
 *
 * ## 1. Truncate to the last complete line ON OPEN — not skip it on read
 *
 * A process killed mid-write leaves `{"kind":"condition-deg` with no newline.
 * The next append lands immediately after those bytes, so a valid record is now
 * welded onto a corrupt one and, one append later, the malformed record is no
 * longer the final line — a reader that only forgives the LAST line then loses a
 * good record too. Forgiving on read cannot recover from this; cutting the file
 * back before anything appends to it can.
 *
 * ## 2. One write, on an `O_APPEND` fd
 *
 * `O_APPEND` makes the seek-to-end and the write one atomic step in the kernel,
 * so a record cannot be interleaved into the middle of another. That guarantee
 * is per WRITE, not per record, so a batch has to be one write — see `writeAll`,
 * which is also why the caller opens the fd with mode `"a"` and not `"w"`.
 *
 * ## 3. A short write is not an error, so it has to be looked at
 *
 * `writeSync` returns a count and does not promise to have written everything.
 * A short write on a regular file is rare rather than impossible — a signal, a
 * full disk — and trusting the count produces exactly the torn line rule 1
 * repairs, except with nothing having gone wrong at the time and no error
 * anywhere.
 *
 * Reads have the same count contract. `readFully` is shared by both reads in
 * the repair path so a short first read cannot leave zero-filled bytes hiding
 * the newline or the text that is about to be dropped.
 *
 * ## The difference between the two copies, which was real
 *
 * They were not identical, and the divergences all resolved towards store.ts:
 *
 *  - notes.ts's append loop was `while (written < n) written += writeSync(…)`,
 *    with no check that the count was positive. `writeSync` returning 0 is the
 *    same rare case rule 3 is about, and there it is an **infinite loop inside a
 *    daemon** rather than a torn line. `writeAll` throws.
 *  - notes.ts did not `fsync` after truncating. The repair is meant to be on
 *    disk before the first append is, and without the flush a machine that dies
 *    in between comes back to the torn line the last start thought it had
 *    removed.
 *  - notes.ts reported `droppedBytes` and threw the dropped text away, so its log
 *    line could say how much was lost but never what. `JsonlRepair` carries both.
 */
import { closeSync, existsSync, fstatSync, fsyncSync, ftruncateSync, openSync, readSync, renameSync, writeSync } from "node:fs";
import { randomUUID } from "node:crypto";

/** How much of a torn line is kept for the log message. The bytes count is exact regardless. */
export const DROPPED_TEXT_CAP = 4096;

/**
 * What a start found at the end of the file.
 *
 * ONE TYPE FOR BOTH LOGS. They had two — `LogRepair` and `NoteRepair`, differing
 * only in that the second dropped the text — and two names for one fact is how
 * the rule itself came to be written twice.
 */
export type JsonlRepair = { torn: false } | { torn: true; droppedBytes: number; droppedText: string };

export type JsonlSplit = {
  /** Newline-terminated records, without their newline bytes. */
  completeLines: string[];
  /** An append observed between its first byte and newline. Not corruption. */
  tornTail: string | null;
  /** Bytes through the final newline, and therefore a safe cursor. */
  completeBytes: number;
};

type JsonlReader = (fd: number, buffer: Buffer, offset: number, length: number, position: number) => number;

function readFully(fd: number, buffer: Buffer, position: number, reader: JsonlReader): void {
  let read = 0;
  while (read < buffer.length) {
    const count = reader(fd, buffer, read, buffer.length - read, position + read);
    if (count <= 0) throw new Error(`read ${count} of ${buffer.length - read} remaining bytes`);
    read += count;
  }
}

/** Split a lock-free snapshot without calling its unfinished suffix corrupt. */
export function splitJsonl(bytes: Buffer): JsonlSplit {
  const lastNewline = bytes.lastIndexOf(0x0a);
  if (lastNewline === -1) {
    return {
      completeLines: [],
      tornTail: bytes.byteLength === 0 ? null : bytes.toString("utf8"),
      completeBytes: 0,
    };
  }
  const completeText = bytes.subarray(0, lastNewline).toString("utf8");
  return {
    completeLines: completeText === "" ? [] : completeText.split("\n"),
    tornTail: lastNewline === bytes.byteLength - 1 ? null : bytes.subarray(lastNewline + 1).toString("utf8"),
    completeBytes: lastNewline + 1,
  };
}

/**
 * Cut the file back to its last complete line, **on disk**, before anything
 * appends to it.
 *
 * Scanning backwards in chunks rather than reading the file, because this runs at
 * every start and the file only grows. A file with no newline at all truncates to
 * empty — that is a single torn line and there is nothing in it to keep. A file
 * that does not exist is not torn.
 */
export function truncateToLastLine(path: string, reader: JsonlReader = readSync): JsonlRepair {
  if (!existsSync(path)) return { torn: false };
  const fd = openSync(path, "r+");
  try {
    const size = fstatSync(fd).size;
    if (size === 0) return { torn: false };

    const CHUNK = 64 * 1024;
    let end = size;
    let lastNewline = -1;
    while (end > 0) {
      const start = Math.max(0, end - CHUNK);
      const buffer = Buffer.alloc(end - start);
      readFully(fd, buffer, start, reader);
      const index = buffer.lastIndexOf(0x0a);
      if (index !== -1) {
        lastNewline = start + index;
        break;
      }
      end = start;
    }
    if (lastNewline === size - 1) return { torn: false };

    const keep = lastNewline + 1;
    const droppedBytes = size - keep;
    const dropped = Buffer.alloc(Math.min(droppedBytes, DROPPED_TEXT_CAP));
    // READ BEFORE THE TRUNCATE. Afterwards those bytes are gone, and a repair
    // that can say how much it lost but not what is a repair nobody can check.
    readFully(fd, dropped, keep, reader);
    ftruncateSync(fd, keep);
    fsyncSync(fd);
    return { torn: true, droppedBytes, droppedText: dropped.toString("utf8") };
  } finally {
    closeSync(fd);
  }
}

/**
 * Write every byte, because `writeSync` does not promise to.
 *
 * It returns a COUNT, and a short write on a regular file is rare rather than
 * impossible — a signal, a full disk. Trusting the count without looking at it
 * would produce exactly the torn line this module opens by repairing, except with
 * nothing having gone wrong at the time and no error anywhere. The loop costs
 * nothing and removes the class.
 *
 * **The `wrote <= 0` throw is not decoration.** Without it a zero-length write
 * makes this spin forever, inside a daemon, silently — which is what one of the
 * two copies of this loop did.
 */
export function writeAll(fd: number, text: string): void {
  const buffer = Buffer.from(text, "utf8");
  let written = 0;
  while (written < buffer.length) {
    const wrote = writeSync(fd, buffer, written, buffer.length - written);
    if (wrote <= 0) throw new Error(`wrote ${wrote} of ${buffer.length - written} remaining bytes`);
    written += wrote;
  }
}

/**
 * Write, flush, then rename over the target.
 *
 * For the file beside the log that is NOT append-only — the checkpoint — where
 * the hazard is the opposite one: a reader must never see half of it, so it is
 * written somewhere else and moved into place in one step.
 *
 * The `fsync` before the rename is what makes the new file's CONTENT durable; the
 * directory `fsync` after it is what makes the rename itself durable, and it is
 * best-effort because opening a directory for reading is a Linux affordance
 * rather than a portable one. The temp file is a sibling on purpose: a rename
 * across filesystems is not atomic and is not even the same syscall.
 */
export function writeAtomically(path: string, directory: string, text: string): void {
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const fd = openSync(temp, "w");
  try {
    writeAll(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
  try {
    const dir = openSync(directory, "r");
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  } catch {
    /* Not every platform lets you fsync a directory. The rename still happened. */
  }
}
