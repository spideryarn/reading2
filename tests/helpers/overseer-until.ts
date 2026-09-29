/**
 * **Stop a test daemon when the thing under test has happened, not after a
 * number of milliseconds.**
 *
 * The daemon tests used to abort `runOverseer` after a fixed 300–700 ms and
 * then assert that a pass had run, or that its result was on disk. That is a
 * bet that the box can fit N intervals and a tick into the window, and on the
 * deploy gate at load 7–9 it lost: 13 failures across four files in one run,
 * none of them in the daemon. The window is not the thing being tested, so it
 * is gone; the only clock left is the deadline below, which is there to turn a
 * condition that never comes into a failure that names it.
 * docs/postmortems/260930a-a-fixed-window-stands-in-for-a-condition.md.
 */
import { expect, vi } from "vitest";

import { readCheckpoint } from "../../tools/overseer/store.js";

/** Under vitest's 30 s `testTimeout`, so a stuck wait fails with its own name rather than a bare timeout. */
const UNTIL = { timeout: 20_000, interval: 10 };

export async function until(what: string, condition: () => boolean): Promise<void> {
  await vi.waitFor(() => {
    expect(condition(), `waited ${UNTIL.timeout / 1000} s for ${what}`).toBe(true);
  }, UNTIL);
}

/** Which heartbeat tick `current.json` was last written by, or null before the first. */
function lastTick(root: string): string | null {
  const read = readCheckpoint(root);
  return read.kind === "checkpoint" ? `${read.checkpoint.heartbeat.instanceId}#${read.checkpoint.heartbeat.ticks}` : null;
}

/** How many heartbeat ticks the daemon writing `current.json` has made. */
export function ticks(root: string): number {
  const read = readCheckpoint(root);
  return read.kind === "checkpoint" ? read.checkpoint.heartbeat.ticks : 0;
}

/**
 * **Wait for a checkpoint written by a tick that ran after this call.**
 *
 * The daemon puts a pass's result in memory and only the next heartbeat tick
 * writes it to `current.json`; stopping does not write it. So "the pass
 * finished" is not "the pass is on disk", and a test that reads the file needs
 * both. Call this once the pass is known to have finished: the tick it waits
 * for started later, so it carried the result. Keyed on the instance as well as
 * the count, because a restarted daemon counts its ticks from zero again.
 */
export async function tickAfter(root: string): Promise<void> {
  const before = lastTick(root);
  await until(`a heartbeat tick after ${before ?? "none"}`, () => {
    const now = lastTick(root);
    return now !== null && now !== before;
  });
}

/** A source that yields nothing and ends when the daemon is told to stop — including if it already was. */
export async function heldOpen(signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve());
  });
}
