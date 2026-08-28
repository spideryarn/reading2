// @vitest-environment jsdom
/**
 * **The server's reason for refusing a job must still be on screen a second
 * later.**
 *
 * `useStepJob` says `postFailed ? reason : stopped`, and until 2026-08-28 the
 * reason it read was `queue.error` — which is **shared polling state**, not a
 * record of what happened. The sequence nobody had driven:
 *
 *   1. the POST to `/api/jobs` is refused, and `readJson` throws the server's
 *      own `{ error }` sentence;
 *   2. `act` in useJobs.ts catches it, puts that sentence in `error`, and then
 *      its `finally` **immediately pokes the poller**;
 *   3. the poll answers normally, because the server is perfectly well — and
 *      `setError(null)` on the success path wipes the sentence;
 *   4. `failed` falls back to *"Couldn't start the job."*
 *
 * So the reader gets the truth for one frame — long enough for a test with a
 * static mock to see it, and not long enough for a person to read it. That is
 * exactly the shape docs/reusable/silent-success.md is about: the check agrees
 * with the code because it shares its assumption, and here the shared
 * assumption is that nothing else touches `error` between the failure and the
 * render.
 *
 * ## Why this file mocks so little
 *
 * `tests/background-reload-keeps-the-list.test.tsx` covers the same `failed`
 * expression with a **posed** `useJobs` whose `error` is a fixed value and
 * whose `run` never pokes anything. That proves the ternary. It cannot prove
 * the sequence, because the sequence *is* the poll.
 *
 * So the real `useJobs`, the real `apiFetch` and the real `readJson` run here,
 * against a stubbed global `fetch` — the pattern
 * `tests/refused-writes-are-reported.test.tsx` established, and for the same
 * reason: the durability being tested is a property of how those three
 * interact, and any stand-in for one of them decides the answer.
 *
 * The poll's replies are **held**, so the test can look at the state before the
 * poll lands and again after it. Both readings are asserted, and the first one
 * is what tells a failing run apart from a test that never reached the bug:
 * before the poll, both the broken and the fixed code say the right thing.
 *
 * One surface is driven rather than three. All three go through `useStepJob`,
 * and `tests/step-job-force.test.tsx` is what proves that they do.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The auth client, and nothing else from `lib/`. `apiFetch` asks for an access
 * token before every request; an anonymous one is what these requests are.
 * Copied from `tests/refused-writes-are-reported.test.tsx`.
 */
vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      refreshSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));

vi.mock("../src/web/useProfile.js", () => ({ useHasProfile: () => false }));

const { useIdeas } = await import("../src/web/useIdeas.js");

/** What the server says when it refuses the job. */
const REFUSED = "You are out of credit for today.";

/** Every request the stub was asked to make, so a test can prove one happened. */
let sent: { method: string; url: string }[] = [];
/** Whether the next `POST /api/jobs` is refused. The second test turns it off. */
let refusing = true;
/** Job-list polls waiting to be answered. See the header — the holding is the test. */
let heldPolls: Array<() => void> = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let host: HTMLDivElement;
let root: Root;
let ideas: ReturnType<typeof useIdeas> | null = null;

function Harness(): ReactElement {
  ideas = useIdeas("constitution");
  return createElement("div", null, ideas.failed ?? "");
}

beforeEach(() => {
  sent = [];
  heldPolls = [];
  ideas = null;
  refusing = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      sent.push({ method, url });
      if (method === "POST" && url === "/api/jobs") {
        /* Received and **refused**, with a reason written for a reader. This is
           the case `postFailed` cannot tell from a dead network on its own. */
        if (refusing) return json({ error: REFUSED }, 402);
        return json({ id: "job1", slug: "constitution", status: "queued", steps: [] });
      }
      if (url === "/api/jobs") {
        /* The poll, and the server is fine — which is the whole point. Held, so
           the test decides when it lands. */
        await new Promise<void>((go) => heldPolls.push(go));
        return json({ jobs: [] });
      }
      /* Nobody has asked for ideas on this article yet: the ordinary 404, and
         the state the button is pressed from. */
      return new Response(null, { status: 404 });
    }),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  /* Let anything still held go, so no request outlives the test. */
  for (const go of heldPolls.splice(0)) go();
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/** Let the microtasks settle and any renders they cause commit. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Answer every poll now waiting, and let the renders finish. */
async function answerPolls(): Promise<void> {
  await act(async () => {
    for (const go of heldPolls.splice(0)) go();
    await Promise.resolve();
  });
  await settle();
}

function polls(): number {
  return sent.filter((r) => r.method === "GET" && r.url === "/api/jobs").length;
}

describe("a job the server received and refused", () => {
  it("goes on saying what the server said after the next poll succeeds", async () => {
    await act(async () => {
      root.render(createElement(Harness));
    });
    await settle();
    /* The opening poll, out of the way, so the one that matters below is the
       one the failed POST provoked. */
    await answerPolls();
    expect(polls()).toBe(1);

    await act(async () => {
      await ideas?.find();
    });
    await settle();

    /* Before the poll lands. **The broken code passes this**, which is why it
       is here: it is the frame the reader never sees, and a test that stopped
       at this line is the one that proved a ternary. */
    expect(ideas?.failed).toBe(REFUSED);
    expect(sent.some((r) => r.method === "POST" && r.url === "/api/jobs")).toBe(true);

    /* And the poll the failed POST started really is out — without this the
       test could pass by never reaching the thing that wipes the message. */
    expect(polls()).toBe(2);

    await answerPolls();

    /* After a perfectly successful poll. The job was still refused and the
       reason is still the server's. */
    expect(ideas?.failed).toBe(REFUSED);
    expect(host.textContent).toBe(REFUSED);
  });

  it("lets go of it the moment a run does start", async () => {
    /* The other half, and the risk the fix introduces: a message that survives
       a poll must not survive the reader's next press. Without this, "durable"
       and "stuck" are the same test. */
    await act(async () => {
      root.render(createElement(Harness));
    });
    await settle();
    await answerPolls();

    await act(async () => {
      await ideas?.find();
    });
    await settle();
    await answerPolls();
    expect(ideas?.failed).toBe(REFUSED);

    refusing = false;
    await act(async () => {
      await ideas?.find();
    });
    await settle();
    await answerPolls();

    expect(ideas?.failed).toBeNull();
    expect(host.textContent).toBe("");
  });
});
