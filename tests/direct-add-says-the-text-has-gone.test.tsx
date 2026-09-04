// @vitest-environment jsdom
/**
 * **The direct-add pages must say where the article's text went.**
 *
 * The shelf's add box carries `ADDING_SENDS_TEXT_AWAY` beside its Add button
 * (src/web/AddArticle.tsx), so the reader who types a URL is told before
 * anything happens. `/add/<url>` and `/add/upload/<id>` are the other two ways
 * in — the bookmarklet and the share sheet — and they have no box, no button
 * and no pause: `AddPage` queues the ingest from its first effect, and the
 * whole point of the page is that the request fits in an address.
 *
 * So until 2026-09-01 somebody arriving that way sent a manuscript to a
 * third-party model provider having been shown nothing at all. GPT Sol called
 * it the most serious thing in the built code
 * (docs/plans/260831an-referee-mode-code-review-sol.md, finding 1), and it is
 * the finding the plan's § Confidentiality was written for.
 *
 * **The fix is a sentence, not a gate.** A confirmation on a deliberately
 * frictionless surface is a product decision and it is Greg's; the plan says
 * so. And the sentence is in the **past tense** — `DIRECT_ADD_SENT_TEXT_AWAY`
 * rather than `ADDING_SENDS_TEXT_AWAY` — because by the time anybody can read
 * it the POST has gone, and a present-tense warning about something already
 * done is false. That asymmetry between the two add surfaces is deliberate, it
 * is the same one `REFEREE_TEXT_ALREADY_SENT` exists for, and this file asserts
 * it in both directions so that "tidying up the inconsistency" goes red.
 *
 * ## What is posed and why
 *
 * `useJobs` is posed, because none of this is about polling: the question is
 * what the page renders, and a real queue would drag in `apiFetch`, Supabase
 * and a timer for no gain. `JobCard` is stubbed for the same reason — it is
 * imported from AddArticle.tsx, which pulls in the upload picker and the whole
 * shadcn button.
 *
 * The assertion is on `textContent` of the mounted page rather than on the
 * module's exports, which would be the tautology version: importing the string
 * in the test and checking the component imports it too proves nothing about
 * whether it is ever on screen.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../src/types.js";
import type { UseJobs } from "../src/web/useJobs.js";

/* React only permits `act` when the environment says it is a test one. Without
   this the renders below still happen, and warn, and the effects they are meant
   to flush may not have — a green test over work that never ran. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every URL and upload id the page asked to queue, in order. */
const queued: string[] = [];

/**
 * Whether the posed `addUpload` succeeds.
 *
 * **It has to be answerable both ways since 2026-09-03**, because the upload
 * arm's tense now depends on it. This page used to say *"the text has been
 * sent"* the moment it rendered, whatever came back. It says that only once the
 * POST has produced a job, because until then nothing has reached a model
 * provider and the past tense is a false statement about somebody's manuscript.
 * `textHasGone` in AddPage.tsx, and GPT Sol's third finding on
 * docs/plans/260903j-background-pdf-upload-so-add-does-not-wait.md.
 *
 * A URL is unaffected, and the case below still asserts it: that arm posts
 * before the first paint and has no state in which it has not.
 */
let uploadQueues = true;

const queue: UseJobs = {
  jobs: [],
  loaded: true,
  error: null,
  /* Stage 5's per-job driver health. Empty, because nothing here is about a
     driver that has stopped getting through — src/job-state.ts § driverStalled. */
  driverFailures: {},
  lastFailure: () => null,
  /* Stage 6's blocking job. Null, because nothing here presses a button on an
     article somebody else's job is holding — src/web/useStepJob.ts. */
  add: async (url: string) => {
    queued.push(url);
    return null as Job | null;
  },
  addUpload: async (uploadId: string) => {
    queued.push(uploadId);
    return uploadQueues ? ({ id: "job-1" } as Job) : null;
  },
  run: async () => null,
  cancel: async () => {},
  retry: async () => {},
  forget: async () => {},
};

vi.mock("../src/web/useJobs.js", () => ({ useJobs: () => queue }));

/* The progress card belongs to the shelf's add box and brings the upload
   picker and shadcn with it. Stubbed rather than rendered: this file is about
   the sentence above it, and with a posed queue there is never a job anyway. */
vi.mock("../src/web/AddArticle.js", () => ({ JobCard: () => null }));

const { AddPage } = await import("../src/web/AddPage.js");
const { ADDING_SENDS_TEXT_AWAY, DIRECT_ADD_SENT_TEXT_AWAY } = await import("../src/messages.js");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  queued.length = 0;
  uploadQueues = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Let the posed POST resolve and its state land, then read the page again. */
async function settled(): Promise<string> {
  await act(async () => {
    await Promise.resolve();
  });
  return host.textContent ?? "";
}

function render(source: Parameters<typeof AddPage>[0]["source"]): string {
  act(() => {
    root.render(createElement(AddPage, { source }));
  });
  return host.textContent ?? "";
}

describe("the direct-add pages disclose where the text went", () => {
  it("says it on /add/<url>, on the same render that queues the ingest", () => {
    const text = render({ kind: "url", url: "example.com/an-essay" });
    // Both halves in one assertion, because either on its own is passable and
    // wrong: a page that discloses and never queues, or the bug as it was.
    expect(queued).toEqual(["https://example.com/an-essay"]);
    expect(text).toContain(DIRECT_ADD_SENT_TEXT_AWAY);
  });

  it("says it on /add/upload/<id> too, where there is not even an address to look at", async () => {
    /* **Flushed, because the upload arm's tense is now state.** `addUpload`
       resolves in a microtask, `setStarted` runs then, and the past tense
       follows from it — where before 2026-09-03 the sentence was the same on
       every render and reading it synchronously was enough. */
    render({ kind: "upload", uploadId: "up_abc123" });
    const text = await settled();
    expect(queued).toEqual(["up_abc123"]);
    expect(text).toContain(DIRECT_ADD_SENT_TEXT_AWAY);
  });

  it("uses the present tense on an upload the server would not queue", async () => {
    /* **The same rule, pointed the other way**, and new on 2026-09-03. The page
       is reached at byte zero now, so `POST /api/jobs {uploadId}` can be refused
       — the bytes have not arrived yet, the quota is spent — and then nothing
       has gone anywhere. Saying *"has been sent"* there is as false as omitting
       the sentence altogether, and it is about a manuscript.

       The disclosure is still made either way, which is what this file exists
       for. Only its tense moves. */
    uploadQueues = false;
    render({ kind: "upload", uploadId: "up_refused" });
    const text = await settled();
    expect(queued).toEqual(["up_refused"]);
    expect(text).toContain(ADDING_SENDS_TEXT_AWAY);
    expect(text, "the page claimed a refused upload had gone to a provider").not.toContain(
      DIRECT_ADD_SENT_TEXT_AWAY,
    );
  });

  it("uses the past tense, not the add box's present tense", () => {
    /* The two sentences differ by one verb and the difference is the whole
       point: on the shelf the reader still has a choice, and here they do not.
       Asserted as an absence as well as a presence so that somebody making the
       three disclosures "consistent" finds out here rather than by shipping a
       page that warns about something it has already done. */
    const text = render({ kind: "url", url: "example.com/an-essay" });
    expect(text).not.toContain(ADDING_SENDS_TEXT_AWAY);
    expect(DIRECT_ADD_SENT_TEXT_AWAY).not.toBe(ADDING_SENDS_TEXT_AWAY);
  });

  it("does not claim anything was sent when the address was refused", () => {
    /* `ok` is false, the effect returns before posting, and nothing has gone
       anywhere — so the past tense would be a lie. The one case where silence
       is the honest answer. */
    const text = render({ kind: "url", url: "javascript:alert(1)" });
    expect(queued).toEqual([]);
    expect(text).not.toContain(DIRECT_ADD_SENT_TEXT_AWAY);
  });
});
