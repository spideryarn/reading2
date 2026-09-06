/**
 * **The journal on disk: one JSON document per line, appended, never rewritten.**
 *
 * The sink half of [`src/debate-journal.ts`](../../src/debate-journal.ts), kept
 * here rather than in `src/` because the only thing that opens one is an eval
 * and the path it writes to is gitignored. A record carries a stranger's page
 * extract and, through the answer text, sentences of the article — so
 * `output/debate-runs/` and never `evals/results/`, the same call
 * `evals/summaries/` made about its judging prompts.
 *
 * ## Append, and one line at a time
 *
 * JSONL rather than one JSON array, because the point of the format is that a
 * process which dies mid-run leaves everything it had already written. An array
 * would need a closing bracket somebody has to be alive to write, which is
 * precisely the case this exists for: on 2026-09-05 an OOM kill between the two
 * passes billed pass A and left no record at all.
 *
 * **Writes are chained rather than concurrent.** `runPass` awaits each one, so
 * they are already sequential today; the chain is here so that a future caller
 * which does not await cannot interleave two half-lines into one.
 *
 * ## `write` never throws, and that is not swallowing
 *
 * It is called from a `finally` in `runPass`, where an exception replaces the
 * failure the pass was already reporting — a broken journal would hide exactly
 * the failure it exists to record. So an IO failure is caught, counted in
 * `failures`, and the runner refuses to describe a run whose journal has any.
 * Counted and reported is the opposite of swallowed
 * ([silent-success.md](../../docs/reusable/silent-success.md)).
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { DebateJournal, DebateJournalEvent } from "../../src/debate-journal.js";

/** An event that could not be written down, and why. */
export interface JournalWriteFailure {
  event: DebateJournalEvent["event"];
  attemptId: string;
  error: string;
}

/**
 * A journal file, ready to be handed to `generateDebate`.
 *
 * `await open(...)` rather than a constructor, so the directory exists before
 * the first append can fail on it.
 */
export class JournalFile implements DebateJournal {
  readonly file: string;
  /** **Non-empty means this journal is not a record of the run.** */
  readonly failures: JournalWriteFailure[] = [];
  private chain: Promise<void> = Promise.resolve();

  private constructor(file: string) {
    this.file = file;
  }

  static async open(dir: string, name = "journal.jsonl"): Promise<JournalFile> {
    await mkdir(dir, { recursive: true });
    return new JournalFile(path.join(dir, name));
  }

  write(event: DebateJournalEvent): Promise<void> {
    this.chain = this.chain.then(async () => {
      try {
        await appendFile(this.file, `${JSON.stringify(event)}\n`, "utf-8");
      } catch (err) {
        this.failures.push({
          event: event.event,
          attemptId: event.attemptId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
    return this.chain;
  }
}

/** What a journal file turned out to hold. */
export interface JournalContents {
  events: DebateJournalEvent[];
  /**
   * Lines that were not a JSON object with an `event` and an `attemptId`.
   *
   * **Reported rather than skipped.** A truncated last line is the ordinary
   * signature of a process that died mid-write, and it is evidence about the
   * run — a reader who is told "27 events" and not "and one line we could not
   * read" has been told the file was complete.
   */
  malformedLines: number[];
}

const KINDS = new Set(["attempt-started", "provider-response", "attempt-finished"]);

/** Read one back. Missing file is an error: an absent journal is not an empty one. */
export async function readJournal(file: string): Promise<JournalContents> {
  const text = await readFile(file, "utf-8");
  const events: DebateJournalEvent[] = [];
  const malformedLines: number[] = [];
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      malformedLines.push(index + 1);
      continue;
    }
    const record = parsed as { event?: unknown; attemptId?: unknown };
    if (typeof record.event !== "string" || !KINDS.has(record.event)) {
      malformedLines.push(index + 1);
      continue;
    }
    if (typeof record.attemptId !== "string" || record.attemptId === "") {
      malformedLines.push(index + 1);
      continue;
    }
    events.push(parsed as DebateJournalEvent);
  }
  return { events, malformedLines };
}
