// @vitest-environment jsdom
/** The real quiz reader and job hook, through completion and a failed GET.
 * Only the queue transport is posed; useStepJob must notice the terminal job
 * and call the real reader's refresh. The panel keeps every rewrite entry
 * held, and its recovery button reads without posting another paid job. */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Job, Quiz, QuizResponse } from "../src/types.js";
import type { QuizRead, UseQuiz } from "../src/web/useQuiz.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let jobs: Job[] = [];
const posted: unknown[] = [];
const job = (status: Job["status"]) => ({
  id: "quiz-rewrite", slug: "a-piece", status,
  steps: [{ name: "quiz", status: status === "done" ? "done" : "pending" }],
  createdAt: "2026-10-02T12:00:00Z",
}) as Job;
vi.mock("../src/web/useJobs.js", () => ({
  useJobs: () => ({
    jobs, loaded: true, driverFailures: {}, lastFailure: () => null,
    run: async (request: unknown) => {
      posted.push(request);
      return job("queued");
    },
    cancel: async () => {},
  }),
}));
vi.mock("../src/web/useAutoRun.js", () => ({ useAutoRun: () => {} }));
vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: () => ({ dictation: { supported: false }, readOnly: false, toggle: () => {} }),
}));
vi.mock("../src/web/DictationStrip.js", () => ({
  DictationButton: () => null, DictationStrip: () => null,
}));

const batch = (batchId: string) => ({
  batchId, slug: "a-piece", profileHash: "the-old-profile", questions: [],
}) as unknown as Quiz;
const response = (batchId: string, stale = false): Response => Response.json({
  quiz: batch(batchId), stale, outdated: false, profileChanged: batchId === "old-batch",
} satisfies QuizResponse);
let openingStale = false;
let nextRead: Promise<Response> | null = null;
let reads = 0;
vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (url: string) => {
    if (url.startsWith("/api/reader")) {
      return Response.json({ profile: "My current profile", purpose: null });
    }
    reads++;
    return nextRead ?? response("old-batch", openingStale);
  },
  readJson: async (res: Response) => {
    /* Declared for a reader, as the real `readJson`'s `HttpError` is. */
    if (!res.ok) {
      const { ReaderFacingError } = await import("../src/web/lib/reader-facing.js");
      throw new ReaderFacingError("Couldn't read the questions.");
    }
    return res.json();
  },
}));

const { useQuiz, useQuizRead } = await import("../src/web/useQuiz.js");
const { QuizPanel } = await import("../src/web/QuizPanel.js");
let owner: UseQuiz;
let showBand = true;
function Probe() {
  const read = useQuizRead("a-piece");
  return showBand ? createElement(Band, { read }) : null;
}
function Band({ read }: { read: QuizRead }) {
  owner = useQuiz("a-piece", read);
  return createElement(QuizPanel, { owner, blocks: new Map(), onJump: () => {} });
}
let host: HTMLDivElement;
let root: Root;
const paint = async () => act(async () => root.render(createElement(Probe)));
const button = (label: string) => [...document.querySelectorAll("button")].find(
  (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === label,
);
const press = async (b: HTMLButtonElement | undefined) => {
  expect(b, "the button must exist before the press").toBeDefined();
  await act(async () => b!.click());
};
const open = async () => press(document.querySelector<HTMLButtonElement>(".prof-badge") ?? undefined);

beforeEach(() => {
  jobs = [];
  posted.length = 0;
  reads = 0;
  nextRead = null;
  openingStale = false;
  showBand = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it.each([false, true])("holds a completed rewrite across a delayed and failed GET (stale=%s), then retries only the read", async (stale) => {
  openingStale = stale;
  await paint();
  expect(reads).toBe(1);
  await open();
  expect(button("Regenerate")?.disabled).toBe(false);
  expect(document.querySelector(".prof-panel")?.textContent).toContain("your answers so far are cleared");
  await press(button("Regenerate"));
  expect(posted).toEqual([{ slug: "a-piece", steps: ["quiz"], force: ["quiz"] }]);
  expect(owner.rewriting).toBe(true);

  let finishRead!: (res: Response) => void;
  nextRead = new Promise((resolve) => { finishRead = resolve; });
  jobs = [job("done")];
  await paint();
  expect(reads).toBe(2); // real useStepJob completion, not a hand-called refresh
  expect(owner.job).toBeNull();
  expect(owner.starting).toBe(false);
  await open();
  expect(button("Regenerate")?.disabled).toBe(true);
  expect(button("Write them again")).toBeUndefined();
  await press(button("Done"));

  await act(async () => finishRead(new Response(null, { status: 500 })));
  expect(owner.quiz?.batchId).toBe("old-batch");
  expect(owner.error).toBe("Couldn't read the questions.");
  expect(owner.rewriting).toBe(true);
  expect(button("Write them again")).toBeUndefined();
  nextRead = Promise.resolve(response("new-batch"));
  await press(button("Read the new questions"));
  expect(reads).toBe(3);
  expect(posted).toHaveLength(1);
  expect(owner.quiz?.batchId).toBe("new-batch");
  expect(owner.rewriting).toBe(false);
  expect(owner.profileChanged).toBe(false);
  expect(button("Read the new questions")).toBeUndefined();
});

/* GPT Sol's remaining P1 on 261002f: the band unmounts on Recall or any other
   mode while the paid job runs on. The hold lives outside the band (it was on the read until
   2026-10-04; src/web/rewrite-hold.ts now), so it survives;
   docs/postmortems/261002f-a-band-local-hold-cannot-protect-a-job-that-outlives-the-band.md. */
it("keeps the hold when the band is closed and reopened while the replacement is still being read", async () => {
  await paint();
  await open();
  await press(button("Regenerate"));
  expect(posted).toHaveLength(1);

  /* Away to Recall; the job finishes while the band is closed, so nothing in
     this tab announced it. */
  showBand = false;
  await paint();
  jobs = [job("done")];
  let finishRead!: (res: Response) => void;
  nextRead = new Promise((resolve) => { finishRead = resolve; });
  showBand = true;
  await paint();
  await open();
  expect(button("Regenerate")?.disabled, "a reopened band offered a second paid rewrite").toBe(true);
  await press(button("Done"));

  await act(async () => finishRead(new Response(null, { status: 500 })));
  expect(owner.quiz?.batchId).toBe("old-batch");
  expect(owner.rewriting, "a failed read is not the replacement").toBe(true);

  nextRead = Promise.resolve(response("new-batch"));
  await press(button("Read the new questions"));
  expect(owner.quiz?.batchId).toBe("new-batch");
  expect(owner.rewriting).toBe(false);
  expect(posted).toHaveLength(1);
});

it("lets go when the rewrite failed while the band was closed, once a read shows the same batch", async () => {
  await paint();
  await open();
  await press(button("Regenerate"));

  showBand = false;
  await paint();
  /* The job errored while away: a fresh mount's `useStepJob` does not know it
     was ours, so `failed` stays null. The job listed as over and a read that
     lands with the old batch is the server saying nothing replaced it.

     The list carries the failed job, as the real one does (`KEEP_FINISHED`,
     src/jobs.ts). It was `[]` here until 2026-10-04, and an empty list is also
     what a job not polled yet looks like — which is how a band reopened before
     the poll released the hold on a rewrite that was about to run (F9,
     rewrite-hold.ts § Why the hold carries the job's id). */
  jobs = [job("error")];
  showBand = true;
  await paint();
  await act(async () => {});
  expect(owner.quiz?.batchId).toBe("old-batch");
  expect(owner.rewriting, "held for ever after a rewrite that failed out of sight").toBe(false);
  await open();
  expect(button("Regenerate")?.disabled).toBe(false);
});
