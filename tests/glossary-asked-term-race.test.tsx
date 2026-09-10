// @vitest-environment jsdom
/**
 * **An answer may only land under the question it was asked about.**
 *
 * The glossary's *Look up a term* box leaves the input editable while its
 * request is out — deliberately, because the call can take the better part of a
 * minute and freezing the box for that long is worse. So a reply can arrive
 * after the reader has typed something else, and an explanation of *attention
 * head* rendered beneath a box now reading *transformer* is the panel asserting
 * something false about the article.
 *
 * That is the feature's own subject matter, one layer up: it was built beside
 * docs/postmortems/260904c-the-glossary-said-the-term-was-not-there.md, where a
 * true sentence about one thing was rendered next to another thing and read as a
 * lie about it. Found by GPT Sol reviewing the built code, not by a test — the
 * first version cleared the previous answer only `if (asked || askFailed)`,
 * which during a request are both null, so the one moment there was something to
 * disown was the one moment it did nothing.
 *
 * The guard is a generation on a ref (`askGeneration`, src/web/useGlossary.ts),
 * bumped by `clearAsked`, which the box calls on every keystroke. This drives
 * the hook rather than the panel — the panel needs nuqs and the layout to mount
 * — so what it pins is the hook's half of the contract. The other half, *the box
 * calls `clearAsked` unconditionally*, is a one-line handler read beside it in
 * `AskATerm`.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskedTermAnswer, GlossaryResponse } from "../src/types.js";
import type { GlossaryRead } from "../src/web/useGlossary.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Replies are **held** until a test lets them go — `glossary-one-fetch.test.tsx`'s
 * device, and for its reason: a reply that resolves immediately makes the
 * in-flight window unobservable, so a test of what happens *during* a request
 * would pass on code that has no such window.
 */
const held: Array<() => void> = [];
function releaseAll(): void {
  for (const go of held.splice(0)) go();
}

/** What the server answers a `POST …/ask` with. */
const ANSWER: AskedTermAnswer = {
  term: "attention head",
  blockId: "spya-bbbbbb" as AskedTermAnswer["blockId"],
  quote: "Attention Heads",
  lookup: {
    answer: "An answer about attention heads.",
    citations: [],
    searches: 1,
    model: "a-model",
    at: "2026-09-04T00:00:00.000Z",
  },
};

const EMPTY_GLOSSARY = {
  glossary: { version: 1, model: "test", sourceHash: "abc", profileHash: null, entries: [] },
  stale: false,
  outdated: false,
  profileChanged: false,
} as unknown as GlossaryResponse;

vi.mock("../src/web/lib/api.js", () => {
  const api = {
    apiFetch: async (input: string) => {
      /* The read of the list answers at once; only the `ask` is held, because it
         is the only request this file is about. */
      if (!input.endsWith("/ask")) {
        return new Response(JSON.stringify(EMPTY_GLOSSARY), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      await new Promise<void>((go) => held.push(go));
      /* The route streams since 2026-09-10: a `begin`, the words, and one
         `done` carrying the same `AskedTermAnswer` the JSON reply used to be.
         Held whole rather than frame by frame, because what this file asks
         about is the reply as a unit landing late —
         tests/glossary-asked-term-stream.test.tsx holds it open mid-stream. */
      const { lookup: _lookup, ...found } = ANSWER;
      const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      return new Response(
        sse("begin", found) + sse("delta", { text: ANSWER.lookup.answer }) + sse("done", ANSWER),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    },
    readJson: async (res: Response) => res.json(),
    failure: async (res: Response) => new Error(String(res.status)),
    /* A whole-module mock leaves anything it omits `undefined` at the moment it
       is called, which TypeScript cannot see through a `vi.mock` factory — the
       landmine `glossary-one-fetch.test.tsx` names. Nothing here presses reset;
       `fetchOk` is here so that whoever adds that test does not find one. */
    fetchOk: async (input: string) => {
      const res = await api.apiFetch(input);
      if (!res.ok) throw new Error(String(res.status));
      return res;
    },
  };
  return api;
});

vi.mock("../src/web/useJobs.js", () => ({
  useJobs: () => ({
    jobs: [],
    loaded: true,
    error: null,
    driverFailures: {},
    lastFailure: () => null,
    run: async () => null,
    cancel: async () => {},
  }),
}));

vi.mock("../src/web/useProfile.js", () => ({ useHasProfile: () => false }));

const { useGlossary, useGlossaryRead } = await import("../src/web/useGlossary.js");

let band: ReturnType<typeof useGlossary> | null = null;

function Band({ slug, read }: { slug: string; read: GlossaryRead }): ReactElement {
  band = useGlossary(slug, read);
  return createElement("aside", null, band.asked ? band.asked.quote : "nothing");
}

function Reading({ slug }: { slug: string }): ReactElement {
  const read = useGlossaryRead(slug);
  return createElement(Band, { slug, read });
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  held.length = 0;
  band = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function mount(): Promise<void> {
  await act(async () => {
    root.render(createElement(Reading, { slug: "constitution" }));
  });
}

/** Start a lookup and leave it in flight. */
function start(term: string): Promise<void> {
  const running = band?.ask(term) ?? Promise.resolve();
  return running;
}

async function letTheReplyLand(running: Promise<void>): Promise<void> {
  await act(async () => {
    releaseAll();
    await running;
  });
}

describe("an answer that arrives after the reader has moved on", () => {
  it("is dropped rather than rendered under the new term", async () => {
    await mount();
    let running!: Promise<void>;
    await act(async () => {
      running = start("attention head");
    });
    expect(band?.asking).toBe(true);

    /* What a keystroke does. At this moment `asked` and `askFailed` are both
       null — there is nothing on screen to clear — and the reply is still
       coming, which is exactly the state the first version did nothing in. */
    await act(async () => {
      band?.clearAsked();
    });

    await letTheReplyLand(running);

    expect(band?.asked).toBeNull();
    expect(host.textContent).toBe("nothing");
    /* And the box is usable again: the request ended, superseded or not, so
       `asking` must come back false. Guarding the `finally` with the generation
       would leave the button disabled for the rest of the visit. */
    expect(band?.asking).toBe(false);
  });

  it("lands normally when the reader has not touched the box", async () => {
    /* The control, and it is what makes the case above mean something: without
       it, a hook that dropped *every* answer would pass the test named after
       dropping one. */
    await mount();
    let running!: Promise<void>;
    await act(async () => {
      running = start("attention head");
    });
    await letTheReplyLand(running);

    expect(band?.asked?.quote).toBe("Attention Heads");
    expect(host.textContent).toBe("Attention Heads");
    expect(band?.asking).toBe(false);
  });
});
