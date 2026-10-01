/**
 * `pass0` must not report an abort complete while pdf.js still owns its worker.
 *
 * A real PDF finishes too quickly to distinguish “called destroy” from
 * “awaited destroy”. This loading task rejects as soon as destruction starts,
 * but its `destroy()` promise remains pending until the test releases it. The
 * parser may reject with the caller's abort only after that promise settles.
 */
import { expect, it, vi } from "vitest";

const task = vi.hoisted(() => ({
  opened: 0,
  destroyStarted: 0,
  rejectLoad: null as null | ((err: unknown) => void),
  finishDestroy: null as null | (() => void),
}));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: () => {
    task.opened += 1;
    const promise = new Promise<never>((_, reject) => {
      task.rejectLoad = reject;
    });
    let destruction: Promise<void> | null = null;
    return {
      promise,
      destroy: () => {
        task.destroyStarted += 1;
        task.rejectLoad?.(Object.assign(new Error("Worker was destroyed"), { name: "AbortException" }));
        destruction ??= new Promise<void>((resolve) => {
          task.finishDestroy = resolve;
        });
        return destruction;
      },
    };
  },
}));

const { pass0 } = await import("../src/pdf.js");

const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

it("awaits worker destruction before an abort leaves pass0", async () => {
  const controller = new AbortController();
  const parsing = pass0(BYTES, { signal: controller.signal });
  await vi.waitFor(() => expect(task.opened).toBe(1));

  controller.abort(new Error("paper deadline"));
  await vi.waitFor(() => expect(task.destroyStarted).toBeGreaterThan(0));

  let settled = false;
  void parsing.catch(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(settled, "pass0 returned while pdf.js was still destroying its worker").toBe(false);

  task.finishDestroy?.();
  await expect(parsing).rejects.toThrow("paper deadline");
});
