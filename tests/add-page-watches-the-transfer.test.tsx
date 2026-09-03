// @vitest-environment jsdom
/**
 * **`/add/upload/<id>` while the file is still going up**, which is a page state
 * that did not exist before 2026-09-03 and which GPT Sol's code review found
 * had no test at all.
 *
 * Everything else about this page is about a job. There is no job until the
 * bytes land, and the reader now arrives here at byte zero — so the states
 * below are all new, and three of them were wrong when they were first written:
 *
 *  - the **disclosure sentence's tense**, which claimed a reader's manuscript
 *    had gone to a model provider while it sat cancelled in their browser;
 *  - the **quota retry**, hidden by `worthRetrying` exactly when it was the
 *    thing to press;
 *  - **Stop during `queueing`**, offered over a request that cannot be undone.
 *
 * The engine is posed here rather than driven — this file is about what the page
 * renders for a given phase, and `tests/upload-engine.test.ts` is where the
 * phases themselves are earned. Posing it is what lets a single render put the
 * transfer in a state that would otherwise need a network to reach.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Job } from "../src/types.js";
import type { UseJobs } from "../src/web/useJobs.js";
import type { Transfer, TransferPhase } from "../src/web/uploadEngine.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const UPLOAD_ID = "up-abc";

const queue: UseJobs = {
  jobs: [],
  loaded: true,
  error: null,
  driverFailures: {},
  lastFailure: () => null,
  add: async () => null,
  addUpload: async () => null,
  run: async () => null,
  cancel: async () => {},
  retry: async () => {},
  forget: async () => {},
};
vi.mock("../src/web/useJobs.js", () => ({ useJobs: () => queue, useJobSession: () => {} }));

/* `JobCard` comes from AddArticle.tsx, which drags in the upload picker and the
   whole shadcn button for no gain here — there is never a job in this file. */
vi.mock("../src/web/AddArticle.js", () => ({ JobCard: () => null }));

let transfer: Transfer | null = null;
const retried: number[] = [];
const cancelled: number[] = [];
vi.mock("../src/web/useUpload.js", () => ({ useUpload: () => transfer }));
vi.mock("../src/web/uploadEngine.js", () => ({
  uploadEngine: {
    retry: () => retried.push(1),
    cancel: () => cancelled.push(1),
  },
}));

const { AddPage } = await import("../src/web/AddPage.js");
const { ADDING_SENDS_TEXT_AWAY, DIRECT_ADD_SENT_TEXT_AWAY } = await import("../src/messages.js");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  transfer = null;
  retried.length = 0;
  cancelled.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const inPhase = (phase: TransferPhase): Transfer => ({
  uploadId: UPLOAD_ID,
  filename: "paper.pdf",
  bytes: 11_000_000,
  phase,
});

function render(phase: TransferPhase | null): string {
  transfer = phase === null ? null : inPhase(phase);
  act(() => {
    root.render(createElement(AddPage, { source: { kind: "upload", uploadId: UPLOAD_ID } }));
  });
  return host.textContent ?? "";
}

const buttonSaying = (label: string): HTMLButtonElement | undefined =>
  ([...host.querySelectorAll("button")] as HTMLButtonElement[]).find((b) =>
    (b.textContent ?? "").includes(label),
  );

describe("what the page says has happened to the article's text", () => {
  /**
   * **The finding I most wanted broken, and it broke.**
   *
   * The tense was decided by "has the transfer stopped", which is not the same
   * question as "has anything been sent to a model provider" — and the gap
   * between them is four ordinary states. Press Stop halfway through the PUT and
   * the page said the text *had been sent*, about a file that never left the
   * browser. So did a queue-time 402. So did a second tab, in the sentence
   * directly above one saying the file was still arriving. GPT Sol, finding 3.
   *
   * It is asked as `textHasGone` now: past tense only once something queued it.
   *
   * Watched red 2026-09-03 by restoring `!stillSending(mine)`: the `cancelled`,
   * `failed` and no-transfer cases all flipped to the past tense.
   */
  it.each([
    ["sending", { kind: "sending", sent: 1 } as TransferPhase],
    ["hashing", { kind: "hashing" } as TransferPhase],
    ["granting", { kind: "granting" } as TransferPhase],
    ["queueing", { kind: "queueing" } as TransferPhase],
    ["cancelled", { kind: "cancelled" } as TransferPhase],
    [
      "failed at sending",
      { kind: "failed", at: "sending", reason: "gone [st-net]", status: null } as TransferPhase,
    ],
    [
      "failed at queueing",
      { kind: "failed", at: "queueing", reason: "No room. [pay-free]", status: 402 } as TransferPhase,
    ],
  ])("is present tense while it is %s", (_name, phase) => {
    const text = render(phase);
    expect(text).toContain(ADDING_SENDS_TEXT_AWAY);
    expect(text, "the page claimed the text had gone").not.toContain(DIRECT_ADD_SENT_TEXT_AWAY);
  });

  it("turns past tense only once the ingest exists", () => {
    const text = render({
      kind: "queued",
      job: { id: "job-1", slug: "paper", status: "queued", steps: [] } as unknown as Job,
    });
    expect(text).toContain(DIRECT_ADD_SENT_TEXT_AWAY);
    expect(text).not.toContain(ADDING_SENDS_TEXT_AWAY);
  });

  it("is present tense in a tab that is only watching, too", () => {
    /* No transfer of this tab's own: a reload, or a second tab. It is about to
       say the file is still arriving, and saying the text has gone in the
       sentence above that is the version Sol quoted back at me. */
    const text = render(null);
    expect(text).toContain(ADDING_SENDS_TEXT_AWAY);
    expect(text).not.toContain(DIRECT_ADD_SENT_TEXT_AWAY);
  });
});

describe("Stop", () => {
  it("is there while the bytes are moving", () => {
    render({ kind: "sending", sent: 2_000_000 });
    expect(buttonSaying("Stop"), "no way to stop a transfer in flight").toBeDefined();
    act(() => buttonSaying("Stop")?.click());
    expect(cancelled).toHaveLength(1);
  });

  it("is gone once the ingest is being queued", () => {
    /* Finding 2. The bytes are in Storage and `POST /api/jobs` is in flight —
       nothing to abort that would undo anything, and the server may already have
       made the job. A Stop there said "cancelled" while the job poll drove the
       ingest to completion. */
    const text = render({ kind: "queueing" });
    expect(buttonSaying("Stop"), "Stop was offered over a request it cannot undo").toBeUndefined();
    expect(text, "the page went quiet instead of saying what was happening").toContain(
      "safely uploaded",
    );
  });

  it("says so afterwards, and says nothing was added", () => {
    const text = render({ kind: "cancelled" });
    expect(text).toContain("You stopped that upload");
  });
});

describe("Try again", () => {
  it("is offered for a quota refusal on the queue request", () => {
    /* **The landing blocker.** `worthRetrying` calls every quota code `blocked`,
       which is right everywhere else — the count will be the same next time —
       and exactly wrong here, because this button is what a reader presses
       *after* upgrading, and it re-posts without re-sending 40 MB. Hiding it
       made the recovery reachable only from DevTools. GPT Sol, finding 1.

       Watched red by dropping the `at === "queueing"` clause: no button. */
    const text = render({
      kind: "failed",
      at: "queueing",
      reason: "No room left on your plan. [pay-free]",
      status: 402,
    });
    const button = buttonSaying("Try again");
    expect(button, "a quota refusal left the reader nothing to press").toBeDefined();
    expect(text, "the button did not say it would not re-send the file").toContain(
      "safely uploaded",
    );
    act(() => button?.click());
    expect(retried).toHaveLength(1);
  });

  it("says it will re-send the file when it was the sending that failed", () => {
    const text = render({
      kind: "failed",
      at: "sending",
      reason: "The upload stopped before it finished. [st-net]",
      status: null,
    });
    expect(buttonSaying("Try again")).toBeDefined();
    expect(text).toContain("sends the file again");
  });
});
