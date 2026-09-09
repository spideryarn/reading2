/**
 * **The join: a usage pass in, a line on disk out.**
 *
 * Three pieces exist and are each tested on their own — the daemon's `onPass`
 * hook (`tools/overseer/daemon.ts`), the mapping (`usage-history-from-report.ts`)
 * and the store (`usage-history.ts`). **Every one of them can be green while
 * nothing connects them**, which is the failure `health-wiring.ts` was written
 * to close after four features shipped built, tested, routed and dead.
 *
 * So the composition is a function rather than a paragraph of `scripts/overseer.ts`,
 * and `tests/fleet-usage-history-wiring.test.ts` drives the **real daemon**
 * against a scratch store and reads the bytes back off the disk.
 *
 * **Opened lazily, and that is the lock argument rather than a convenience.**
 * The store refuses to open for writing unless the Overseer's daemon lock is
 * held — there is one writer on this box, and a second election could leave the
 * real daemon read-only for ever with nothing able to say why. The lock is taken
 * inside `runOverseer`, after the composition root has built this. Opening on
 * the first pass makes the ordering *structural*: `onPass` is only ever called
 * from the usage ticker, which cannot run before `runOverseer` holds the lock.
 * By the time this opens, the predicate is true by construction.
 */
import { openUsageHistoryForWrite, type UsageHistoryWriter } from "./usage-history.js";
import { usageHistoryLineFrom, type PassInput } from "./usage-history-from-report.js";
import type { CodexUsageReading } from "./wire.js";

export type UsageRetention = {
  /**
   * Leave the concurrent Codex reading for the next synchronous `onPass`.
   * The daemon's single-flight guard is what makes "next" mean this same pass.
   */
  stashCodex: (reading: CodexUsageReading) => void;
  /** Hand this straight to `DaemonOptions.usage.onPass`. */
  onPass: (outcome: PassInput) => void;
  /** Release the fd when the daemon stops. Safe to call when nothing was ever opened. */
  close: () => void;
  /** Where it is writing, or null before the first pass. For the startup log line. */
  path: () => string | null;
};

export type UsageRetentionOptions = {
  /**
   * The collector's cadence, written ONTO every record.
   *
   * A reader that assumed 300 s would call every interval of a changed or
   * injected cadence a recorder failure — and adding the field later is a
   * persisted-format change, which is the expensive kind.
   */
  nextDueMs: number;
  now?: () => Date;
  /** Announced once, when the store is first opened. */
  log?: (line: string) => void;
};

export function makeUsageRetention(dir: string, options: UsageRetentionOptions): UsageRetention {
  const now = options.now ?? (() => new Date());
  let writer: UsageHistoryWriter | null = null;
  let stashedCodex: CodexUsageReading | null = null;

  return {
    path: () => writer?.path ?? null,
    close: () => writer?.close(),
    stashCodex(reading: CodexUsageReading): void {
      stashedCodex = reading;
    },
    onPass(outcome: PassInput): void {
      /* Consume before touching the writer. If append fails, a later pass must
         not silently inherit this pass's Codex observation. */
      const codex =
        stashedCodex ??
        ({
          kind: "unknown",
          why: "the Codex collector left no observation for this usage pass",
          retryable: true,
        } satisfies CodexUsageReading);
      stashedCodex = null;
      if (writer === null) {
        writer = openUsageHistoryForWrite(dir, { daemonLockHeld: () => true });
        options.log?.(`usage history: ${writer.path}`);
      }
      writer.append(
        usageHistoryLineFrom(outcome, {
          nextDueMs: options.nextDueMs,
          recordedAt: now().toISOString(),
          codex,
        }),
      );
    },
  };
}
