// @vitest-environment jsdom
/**
 * **An interrupted import has to say so on the card**, and until 2026-09-01 it
 * said nothing at all.
 *
 * `settleExpired` (src/store/pg-jobs.ts) ends a job whose claimant walked away.
 * Stage 2 settled the abandoned running step to `pending` for *both* endings —
 * the reader's Stop and an interruption nobody asked for — on the argument that
 * `StepRow` renders `step.error` in full, so copying `INTERRUPTED.message` onto
 * the step would print the same paragraph twice.
 *
 * **The second half of that argument was wrong about the built UI.** `JobCard`
 * renders `step.error` and `queue.error` — the shared poll state — and **never
 * `job.error`**. So an expired import showed one muted grey line and a Retry
 * button, with no sentence anywhere saying what had happened or why pressing
 * Retry was worth it. That is docs/reusable/silent-success.md with the reader
 * as the thing that fails quietly, and it is the failure a passing store test
 * cannot see: the row was correct, and the person could not tell.
 * GPT Sol, 2026-09-01, finding 2 on the built stage 2.
 *
 * ## Why this file mounts the card rather than reading a function
 *
 * Because the claim under test is *a reader can see this*, and every cheaper
 * way of checking it re-states the assumption that broke. The fixtures are
 * exactly what the two settlements write — see the parity suite's "settles the
 * step that was running, and says why only when nobody asked", which is where
 * the shape of these rows is pinned — so if the store's endings change, that
 * test goes red and this one keeps passing against a fiction. The pair is the
 * point: one says the row is right, this one says the row is legible.
 *
 * ## And the mirror case
 *
 * A **cancelled** job must not carry an explanation, because the reader is the
 * explanation. Asserting only the presence of a sentence would pass an
 * implementation that printed INTERRUPTED on everything, which is precisely the
 * behaviour that was there before stage 2 and that stage 2 removed.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

import { INTERRUPTED } from "../src/messages.js";
import type { Job, JobStep } from "../src/types.js";
import { JobCard } from "../src/web/AddArticle.js";
import type { UseJobs } from "../src/web/useJobs.js";

/**
 * A queue that does nothing, because this file is about what is drawn.
 *
 * Every action is a no-op rather than a spy: the card's buttons are covered
 * elsewhere, and a stub that recorded calls would invite this file to grow into
 * a second copy of that.
 */
const queue: UseJobs = {
  jobs: [],
  loaded: true,
  error: null,
  lastFailure: () => null,
  add: async () => null,
  addUpload: async () => null,
  run: async () => null,
  cancel: async () => undefined,
  retry: async () => undefined,
  forget: async () => undefined,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** What the pipeline's first two steps look like once one of them was abandoned. */
function steps(settled: JobStep): JobStep[] {
  return [
    {
      name: "fetch",
      label: "Fetching the page",
      status: "done",
      startedAt: "2026-09-01T00:00:00.000Z",
      finishedAt: "2026-09-01T00:00:02.000Z",
    },
    settled,
  ];
}

function render(job: Job): void {
  act(() => {
    root.render(<JobCard job={job} queue={queue} onHide={() => undefined} />);
  });
}

const BASE = {
  id: "spya-cardaa",
  ownerId: "00000000-0000-4000-8000-00000000c0de" as Job["ownerId"],
  slug: "an-abandoned-import",
  title: "An abandoned import",
  createdAt: "2026-09-01T00:00:00.000Z",
  finishedAt: "2026-09-01T00:12:40.000Z",
};

it("says what happened when an import was interrupted with nobody watching", () => {
  render({
    ...BASE,
    status: "error",
    error: INTERRUPTED.message,
    failureKind: INTERRUPTED.kind,
    steps: steps({
      name: "extract",
      label: "Reading the article",
      status: "error",
      error: INTERRUPTED.message,
      startedAt: "2026-09-01T00:00:02.000Z",
      finishedAt: "2026-09-01T00:12:40.000Z",
    }),
  });

  /* The whole sentence, not a fragment of it: the half that says a retry picks
     up where it left off is the half that makes the button worth pressing. */
  expect(host.textContent).toContain(INTERRUPTED.message);
  /* And it is on the card once. `job.error` is not rendered anywhere, so this
     also guards the other direction — somebody adding a `job.error` line
     without removing the step's would double the paragraph. */
  const shown = host.textContent!.split(INTERRUPTED.message).length - 1;
  expect(shown, "the explanation is printed twice").toBe(1);

  // The step that was abandoned reads as the one that ended, not as a spinner.
  expect(host.querySelectorAll(".cmt-spinner")).toHaveLength(0);
  // And the way out is offered, since an interruption is worth another go.
  expect(host.textContent).toContain("Retry");
});

it("says nothing extra when the reader stopped it themselves", () => {
  render({
    ...BASE,
    status: "cancelled",
    steps: steps({ name: "extract", label: "Reading the article", status: "pending" }),
  });

  /* No sentence, and that is the point of the two endings differing: telling
     somebody who pressed Stop that their import "did not come back" is telling
     them a thing that did not happen. */
  expect(host.textContent).not.toContain(INTERRUPTED.message);
  expect(host.querySelectorAll(".cmt-spinner")).toHaveLength(0);
  // Still offered, because stopping something is not the same as not wanting it.
  expect(host.textContent).toContain("Retry");
});
