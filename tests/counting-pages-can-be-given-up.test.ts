/**
 * **The job's deadline has to be able to reach pdf.js**, and for a day it could
 * not.
 *
 * Stage 1 of the page cap opens a stranger's file in this process to read one
 * number out of it (`countPdfPages`, src/pdf.ts). The claimant aborts its own
 * step at `LEASE_MS - DEADLINE_MARGIN_MS` — 740 s — and that abort is the only
 * bound on how long any step may take. `countPdfPages` took no signal and
 * `refuseAnOverlongPdf` passed none, so the bound was **not swallowed but
 * unwired**: a pathological PDF could hold the acquisition step until the
 * platform killed the function ⟨GPT Sol, reviewing the built stage 4, 2026-09-04⟩.
 *
 * The irony worth not repeating: docs/project/security.md gained a note in that
 * same stage saying that opening a stranger's file in-process is where the
 * attack surface is.
 *
 * **pdf.js is mocked, and the mock is the whole test.** A real PDF opens in tens
 * of milliseconds, so a test against one would be a race with itself and would
 * pass whether or not anything was wired up. The loading task here **never
 * settles on its own** — the only thing that can end it is `destroy()`, which is
 * what the abort has to call. A `countPdfPages` that ignores its signal does not
 * fail this file, it hangs in it.
 */
import { describe, expect, it, vi } from "vitest";

const task = vi.hoisted(() => ({
  /** How many loading tasks have been asked for, and how many destroyed. */
  opened: 0,
  destroyed: 0,
  /** Rejects the pending `loadingTask.promise`, as pdf.js's own `destroy` does. */
  end: null as null | ((err: unknown) => void),
}));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: () => {
    task.opened += 1;
    let end: (err: unknown) => void = () => {};
    /* Never resolves. A document that opens instantly cannot show whether an
       abort reaches the parser; one that never opens can show nothing else. */
    const promise = new Promise<never>((_, reject) => {
      end = reject;
    });
    task.end = end;
    return {
      promise,
      destroy: async () => {
        task.destroyed += 1;
        end(Object.assign(new Error("Worker was destroyed"), { name: "AbortException" }));
      },
    };
  },
}));

const { countPdfPages } = await import("../src/pdf.js");

/* Never parsed — pdf.js is mocked. */
const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

/**
 * Wait until the document has been asked for.
 *
 * Polled rather than slept: `countPdfPages` imports pdf.js dynamically, and on a
 * loaded box that import is slow enough that a fixed pause makes this file fail
 * for a reason that has nothing to do with what it is testing.
 */
async function opened(): Promise<void> {
  const was = task.opened;
  for (let i = 0; i < 400; i++) {
    if (task.opened > was) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("the document was never asked for");
}

describe("counting the pages of a file that will not open", () => {
  it("gives up when the step's deadline fires, and lets the worker go", async () => {
    const claimant = new AbortController();
    const counting = countPdfPages(BYTES, claimant.signal);
    await opened();

    /* The shape the deadline actually uses: `controller.abort(reason)` in
       src/jobs.ts, with the reason carrying the sentence. */
    claimant.abort(new Error("this claimant is out of time"));

    await expect(counting).rejects.toThrow(/out of time/);
    /* Not only "it stopped waiting". The worker is a process resource, and a
       counter that walks away from one per hostile upload is a slower version
       of the same denial of service. */
    expect(task.destroyed, "left the parser running after giving up").toBeGreaterThan(0);
  });

  it("does not open the file at all when the deadline has already passed", async () => {
    const before = task.opened;
    const gone = AbortSignal.abort(new Error("already over"));

    await expect(countPdfPages(BYTES, gone)).rejects.toThrow(/already over/);
    expect(task.opened, "opened a stranger's file after the step had given up").toBe(before);
  });

  it("still counts pages when nobody is hurrying it", async () => {
    /* The control: the signal is optional and its absence must not change what
       the function does. Resolved by hand, since this file's pdf.js never
       finishes on its own. */
    const counting = countPdfPages(BYTES);
    await opened();
    expect(task.end).not.toBeNull();
    task.end?.(new Error("the parser gave up on its own"));
    await expect(counting).rejects.toThrow(/on its own/);
  });
});
