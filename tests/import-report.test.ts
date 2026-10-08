/**
 * **What "Report this" on a failed import puts in the Feedback box.**
 *
 * Plan 261001s stage 1 carried ids, closed values and timestamps only (GPT
 * Sol's review item 6). Greg widened it on 2026-10-08 (spya-f9c9pe, answering
 * q-a7kffw): the source address, the uploaded file's name and the error
 * sentence go in too, in the box where the reader sees them and can delete
 * them before sending — docs/project/feedback.md § The one rule, and plan
 * 261008i § Stage 1. The article's title still does not.
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
  error: "The job's own summary sentence.",
  failureKind: "blocked",
  steps: [
    { name: "fetch", label: "Fetching the page", status: "error", error: ERROR },
    { name: "extract", label: "Reading the article", status: "pending" },
  ],
};

describe("importProblemReport", () => {
  it("names the job, where it came from, the failed step, its error and the times, for an address import", () => {
    const report = importProblemReport({ ...BASE, url: SECRET_URL });
    expect(report).toBe(
      [
        "This import failed.",
        "",
        "Job: spya-jobaaa",
        "Article: a-failed-import",
        "Status: error",
        `Source: ${SECRET_URL}`,
        "Failed at step: fetch",
        "Failure kind: blocked",
        `Error: ${ERROR}`,
        "Added: 2026-10-01T10:35:00.220Z",
        "Started: 2026-10-01T10:35:01.000Z",
        "Ended: 2026-10-01T10:36:12.004Z",
        "",
        "What I expected:",
        "",
      ].join("\n"),
    );
    /* The whole address, query string included: Greg chose that knowing it
       may carry a token, because the reader sees it and can delete it. */
    expect(report).toContain("token=hunter2");
    expect(report).not.toContain(BASE.title!);
  });

  it("names the file for an upload, and no source address", () => {
    const report = importProblemReport({
      ...BASE,
      upload: { id: "00000000-0000-4000-8000-0000000000aa", filename: FILENAME },
    });
    expect(report).toContain(`File: ${FILENAME}`);
    expect(report).not.toContain("Source:");
    /* The upload's id is ours and not the reader's business to read. */
    expect(report).not.toContain("0000000000aa");
  });

  it("falls back to the job's error when no step failed", () => {
    const report = importProblemReport({
      ...BASE,
      steps: [{ name: "fetch", label: "Fetching the page", status: "pending" }],
    });
    expect(report).toContain("Error: The job's own summary sentence.");
  });

  it("leaves out the lines it has nothing for — no origin, no failed step, no kind, no error, never started", () => {
    const { startedAt: _s, finishedAt: _f, failureKind: _k, error: _e, ...rest } = BASE;
    const report = importProblemReport({
      ...rest,
      steps: [{ name: "fetch", label: "Fetching the page", status: "pending" }],
    });
    for (const absent of ["Source:", "File:", "Failed at step", "Failure kind", "Error:", "Started:", "Ended:"]) {
      expect(report).not.toContain(absent);
    }
    /* `createdAt` is when it was added, not when it started — review item 8. */
    expect(report).toContain("Added: 2026-10-01T10:35:00.220Z");
  });

  it("cuts the error at 2,000 characters, so the box never opens fuller than Feedback allows", () => {
    const report = importProblemReport({
      ...BASE,
      steps: [{ name: "fetch", label: "Fetching the page", status: "error", error: "x".repeat(5000) }],
    });
    const line = report.split("\n").find((l) => l.startsWith("Error: "));
    expect(line).toBe(`Error: ${"x".repeat(2000)}…`);
  });
});
