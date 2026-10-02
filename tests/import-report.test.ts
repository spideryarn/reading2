/**
 * **What "Report this" on a failed import puts in the Feedback box.**
 *
 * Plan 261001s, stage 1, as GPT Sol's review item 6 changed it: ids, closed
 * values and timestamps only. A source URL can carry a private token, a
 * filename is the reader's own words, and a step's error sentence is ours but
 * open-ended — none of them is "something the reader typed into this dialog",
 * so none of them is pre-typed for them (docs/project/feedback.md § The one
 * rule). The card still shows all three; the report does not carry them.
 */
import { describe, expect, it } from "vitest";

import type { Job } from "../src/types.js";
import { importProblemReport } from "../src/web/import-report.js";

const SECRET_URL = "https://example.com/private/paper.pdf?token=hunter2";
const FILENAME = "my-secret-draft.pdf";
const ERROR = "The page answered 403 Forbidden, so we could not read it.";

const BASE: Job = {
  id: "spya-jobaaa",
  ownerId: "00000000-0000-4000-8000-00000000c0de" as Job["ownerId"],
  slug: "a-failed-import",
  title: "A title the reader may not want sent",
  status: "error",
  createdAt: "2026-10-01T10:35:00.220Z",
  startedAt: "2026-10-01T10:35:01.000Z",
  finishedAt: "2026-10-01T10:36:12.004Z",
  error: ERROR,
  failureKind: "blocked",
  steps: [
    { name: "fetch", label: "Fetching the page", status: "error", error: ERROR },
    { name: "extract", label: "Reading the article", status: "pending" },
  ],
};

function neverLeaks(report: string): void {
  for (const secret of [SECRET_URL, "hunter2", "example.com", FILENAME, ERROR, "403", BASE.title!]) {
    expect(report, `the report carries ${secret}`).not.toContain(secret);
  }
}

describe("importProblemReport", () => {
  it("names the job, the article, the failed step and the times, for an address import", () => {
    const report = importProblemReport({ ...BASE, url: SECRET_URL });
    expect(report).toBe(
      [
        "This import failed.",
        "",
        "Job: spya-jobaaa",
        "Article: a-failed-import",
        "Status: error",
        "Failed at step: fetch",
        "Failure kind: blocked",
        "Added: 2026-10-01T10:35:00.220Z",
        "Started: 2026-10-01T10:35:01.000Z",
        "Ended: 2026-10-01T10:36:12.004Z",
        "",
        "What I expected:",
        "",
      ].join("\n"),
    );
    neverLeaks(report);
  });

  it("carries no filename for an upload", () => {
    const report = importProblemReport({
      ...BASE,
      upload: { id: "00000000-0000-4000-8000-0000000000aa", filename: FILENAME },
    });
    neverLeaks(report);
    expect(report).toContain("Job: spya-jobaaa");
  });

  it("leaves out the lines it has nothing for — no failed step, no kind, never started", () => {
    const { startedAt: _s, finishedAt: _f, failureKind: _k, ...rest } = BASE;
    const report = importProblemReport({
      ...rest,
      steps: [{ name: "fetch", label: "Fetching the page", status: "pending" }],
    });
    expect(report).not.toContain("Failed at step");
    expect(report).not.toContain("Failure kind");
    expect(report).not.toContain("Started:");
    expect(report).not.toContain("Ended:");
    /* `createdAt` is when it was added, not when it started — review item 8. */
    expect(report).toContain("Added: 2026-10-01T10:35:00.220Z");
    neverLeaks(report);
  });
});
