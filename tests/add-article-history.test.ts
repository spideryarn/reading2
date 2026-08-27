/**
 * Which ingest jobs the homepage shows without being asked.
 *
 * A successful job leaves the "Add an article" box after eight seconds,
 * because the article it made is on the shelf below. **A failed one never left
 * at all** — the card is the only account of what went wrong — and the server
 * keeps fifty per reader, preferring failures when it prunes. So the box that
 * says "here is what is happening now" filled up with every import that had
 * ever gone wrong. Since 2026-08-27 anything that ended before the tab was
 * opened is folded behind a disclosure, and that line is `earlier`.
 *
 * The rule worth pinning is the one that fails quietly: **when in doubt, show
 * it.** A job hidden by mistake is a failure the reader never learns about, and
 * nothing on the page would look wrong.
 *
 * See src/web/AddArticle.tsx and docs/project/ingest-queue.md § The box only
 * shows this sitting.
 */
import { describe, expect, it } from "vitest";
import { DEV_OWNER_ID } from "../src/owner.js";
import type { Job, JobStatus } from "../src/types.js";
import { earlier } from "../src/web/AddArticle.js";

const OPENED = Date.parse("2026-08-27T12:00:00.000Z");
const BEFORE = "2026-08-27T11:00:00.000Z";
const AFTER = "2026-08-27T12:30:00.000Z";

const job = (status: JobStatus, finishedAt?: string): Job => ({
  id: "j",
  slug: "s",
  ownerId: DEV_OWNER_ID,
  status,
  createdAt: BEFORE,
  steps: [],
  ...(finishedAt ? { finishedAt } : {}),
});

describe("what the add box folds away", () => {
  it("folds away anything that finished before the tab was opened", () => {
    for (const status of ["done", "error", "cancelled"] as const) {
      expect(earlier(job(status, BEFORE), OPENED)).toBe(true);
    }
  });

  it("keeps what finished during this sitting", () => {
    // The case that matters most: adding an article navigates to /add/<url>,
    // and coming home remounts the component. A per-mount clock would fold the
    // failure you caused thirty seconds ago into "earlier" before you had read
    // it, which is why the cutoff is the tab's load rather than the mount's.
    for (const status of ["done", "error", "cancelled"] as const) {
      expect(earlier(job(status, AFTER), OPENED)).toBe(false);
    }
  });

  it("never folds away a job that is still going", () => {
    // Its `createdAt` is before the cutoff and it has no `finishedAt` at all,
    // so a version of this that reached for the wrong date would hide the one
    // card the reader is actually watching.
    expect(earlier(job("queued"), OPENED)).toBe(false);
    expect(earlier(job("running"), OPENED)).toBe(false);
  });

  it("shows, rather than hides, a job whose end it cannot date", () => {
    // Both of these should be unreachable — every terminal state in
    // src/jobs.ts stamps `finishedAt` — and both err towards the reader
    // seeing a card they did not need, rather than missing one they did.
    expect(earlier(job("error"), OPENED)).toBe(false);
    expect(earlier(job("error", "soon"), OPENED)).toBe(false);
  });
});
