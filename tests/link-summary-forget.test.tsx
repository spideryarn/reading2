// @vitest-environment jsdom
/**
 * **A link's summary written for the old profile does not outlive the new one.**
 *
 * The summary on a link's hover card is written from the reader's profile and
 * purpose, and cached per tab in front of a server that would have noticed the
 * change (src/web/link-facts.ts § `forgetSummaries`). Clearing the finished
 * answers is not enough, three ways, and each is a case below:
 *
 * 1. a stream **already in flight** when the cache is cleared finishes later and
 *    writes its answer back in — on an ordinary save too;
 * 2. the same stream's partial text and its pending entry survive the clear, so
 *    a card re-hovered straight afterwards joins the old stream;
 * 3. the `keepalive` saves — `leaveProfile` and `leavePurpose`, which
 *    `useAutosavedText` fires on `pagehide` and on unmount — did not clear
 *    anything at all.
 *
 * XZ-X10 in docs/plans/261003f-fifth-codebase-sweep-umbrella.md; the fence is
 * docs/plans/261004b-sweep-clusters-7-and-10-link-summary-fence-and-illustrated-refusal.md.
 *
 * **The assertions are the request list and the text the hook returns**, never a
 * spy on `forgetSummaries`: a card drawn from a stale cache and one drawn from a
 * fresh answer look identical, and "the function was called" was true of the
 * ordinary saves all along while hole 1 stayed open under them.
 *
 * One URL per case — the caches are module-level and outlive a test
 * (tests/no-block-no-summary.test.tsx says the same).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LinkFacts } from "../src/web/link-facts.js";
import type { LinkPreview } from "../src/web/link-preview.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** One `/api/link-summary` stream, held open until the test says otherwise. */
interface HeldStream {
  path: string;
  body: ReadableStream<Uint8Array>;
  delta(text: string): void;
  ready(summary: string): void;
  /** The pairing has nothing to summarise: remembered as nothing. */
  unavailable(): void;
  transient(name: "refused" | "pending"): void;
  /** The stream just stops, with no terminal frame. */
  end(): void;
  /** The connection breaks. */
  fail(): void;
}

/** Every summary stream the client opened, in order. */
const streams: HeldStream[] = [];
/** Every keepalive request, each settled by the test. */
const leaving: { path: string; settle(): void }[] = [];

vi.mock("../src/web/lib/api.js", () => {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const api = {
    apiFetch: async (input: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return json(JSON.parse(String(init.body)));
      }
      if (input.startsWith("/api/library")) return json({ articles: [] });
      if (input.startsWith("/api/link-preview")) {
        return json({
          state: "ready",
          page: { title: "A paper", description: "What the paper says, at length." },
        });
      }
      const encoder = new TextEncoder();
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
        },
      });
      const frame = (name: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`));
      streams.push({
        path: input,
        body,
        delta: (text) => frame("delta", { text }),
        ready: (summary) => {
          frame("ready", { summary });
          controller.close();
        },
        unavailable: () => {
          frame("unavailable", {});
          controller.close();
        },
        transient: (name) => {
          frame(name, {});
          controller.close();
        },
        end: () => controller.close(),
        fail: () => controller.error(new TypeError("network error")),
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    },
    leavingFetch: (input: string) =>
      new Promise<void>((resolve) => {
        leaving.push({ path: input, settle: resolve });
      }),
    readJson: async (res: Response) => res.json(),
    failure: async (res: Response) => new Error(String(res.status)),
    fetchOk: async (input: string) => api.apiFetch(input),
    statusOf: () => undefined,
  };
  return api;
});

const { forgetSummaries, useLinkFacts } = await import("../src/web/link-facts.js");
const { leaveProfile, saveProfile } = await import("../src/web/useProfile.js");
const { leavePurpose, savePurpose } = await import("../src/web/purpose.js");

function aLink(url: string): LinkPreview {
  return {
    kind: "external",
    host: "destination.example",
    sameSite: false,
    trail: [],
    file: null,
    citation: null,
    wiki: null,
    url,
  };
}

let host: HTMLDivElement;
let root: Root;
/** What the card would draw for the summary, as of the last render. */
let shown: LinkFacts["summary"] = null;

beforeEach(() => {
  streams.length = 0;
  leaving.length = 0;
  shown = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

/** Let the chained lookups and any stream frames land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

const BLOCK = "spya-aaaaaa";

/** Open the card over one link — a fresh mount, as a re-hover is. */
async function hover(url: string): Promise<void> {
  function Probe() {
    shown = useLinkFacts(aLink(url), "https://noema.example/the-piece", "a-slug", BLOCK).summary;
    return null;
  }
  await act(async () => root.render(null));
  await act(async () => root.render(<Probe />));
  await settle();
}

async function emit(send: () => void): Promise<void> {
  await act(async () => send());
  await settle();
}

it.each([
  ["saveProfile", () => saveProfile("A different description.")],
  ["savePurpose", () => savePurpose("a-slug", "A different reason.")],
] as const)("%s refreshes a mounted card without needing another hover", async (name, save) => {
  await hover(`https://destination.example/mounted-${name}`);
  await emit(() => streams[0]!.ready("The old answer."));
  expect(shown).toEqual({ text: "The old answer.", streaming: false });

  await act(async () => {
    await save();
  });
  await settle();
  expect(shown).toBeNull();
  expect(streams).toHaveLength(2);
  await emit(() => streams[1]!.ready("The new answer."));
  expect(shown).toEqual({ text: "The new answer.", streaming: false });
});

it("does not let a stream that was in flight refill the cache after it was cleared", async () => {
  const url = "https://destination.example/in-flight";
  await hover(url);
  expect(streams).toHaveLength(1);
  await emit(() => streams[0]?.delta("Written for the old"));
  /* The control: the harness really does show what arrives, so the nulls below
     are the fence and not a probe that never sees anything. */
  expect(shown).toEqual({ text: "Written for the old", streaming: true });

  await emit(() => forgetSummaries());
  expect(shown).toBeNull();

  await emit(() => streams[0]?.ready("Written for the old profile."));
  expect(shown).toBeNull();
  expect(streams[0]!.body.locked).toBe(false);

  /* The replacement is requested on forget, and re-hovering must not reveal
     an old answer that silently refilled the cache in the meantime. */
  await hover(url);
  expect(streams).toHaveLength(2);
  expect(shown).toBeNull();
  await emit(() => streams[1]?.ready("Written for the new profile."));
  expect(shown).toEqual({ text: "Written for the new profile.", streaming: false });
});

/* **The three endings that remember "nothing here"**, which a fence on the
   `ready` branch alone would leave open — and a stale `null` is the worse
   refill, because it silences the link for the rest of the session. GPT Sol,
   2026-10-04, PL-2. */
it.each([
  ["unavailable", (s: HeldStream) => s.unavailable()],
  ["end", (s: HeldStream) => s.end()],
  ["fail", (s: HeldStream) => s.fail()],
] as const)("does not remember an overtaken stream's `%s` as nothing to show", async (name, finish) => {
  const url = `https://destination.example/overtaken-${name}`;
  await hover(url);
  expect(streams).toHaveLength(1);
  await emit(() => forgetSummaries());
  await emit(() => {
    const old = streams[0];
    if (old) finish(old);
  });
  await hover(url);
  expect(streams).toHaveLength(2);
  /* The mounted card now starts its replacement immediately on forget.
     Let that CURRENT stream leave no cached answer, then re-hover: a stale
     null written by the old run would incorrectly suppress this request. */
  await emit(() => streams[1]!.transient("pending"));
  await hover(url);
  expect(streams).toHaveLength(3);
});

it("releases an overtaken reader on a delta without changing the replacement stream", async () => {
  await hover("https://destination.example/stale-delta");
  await emit(() => streams[0]!.delta("Old words"));
  await emit(forgetSummaries);
  expect(streams).toHaveLength(2);
  await emit(() => streams[1]!.delta("New words"));
  await emit(() => streams[0]!.delta("More old words"));
  expect(streams[0]!.body.locked).toBe(false);
  expect(shown).toEqual({ text: "New words", streaming: true });
  await hover("https://destination.example/stale-delta");
  expect(streams).toHaveLength(2);
  await emit(() => streams[1]!.ready("The new answer."));
});

it.each([
  ["unavailable", (s: HeldStream) => s.unavailable(), true],
  ["end", (s: HeldStream) => s.end(), true],
  ["fail", (s: HeldStream) => s.fail(), true],
  ["refused", (s: HeldStream) => s.transient("refused"), false],
  ["pending", (s: HeldStream) => s.transient("pending"), false],
] as const)("cleans up a current `%s` stream and wakes the mounted card", async (name, finish, remembered) => {
  const url = `https://destination.example/current-${name}`;
  await hover(url);
  await emit(() => streams[0]!.delta("Unfinished words"));
  expect(shown).toEqual({ text: "Unfinished words", streaming: true });
  await emit(() => finish(streams[0]!));
  expect(shown).toBeNull();
  expect(streams[0]!.body.locked).toBe(false);
  await hover(url);
  expect(streams).toHaveLength(remembered ? 1 : 2);
});

it("starts a new stream after a clear, and the old one ending does not disturb it", async () => {
  const url = "https://destination.example/re-hovered";
  await hover(url);
  await emit(() => streams[0]?.delta("Old words"));
  await emit(() => forgetSummaries());

  /* Re-hovered while the old stream is still open: a new request, not a seat at
     the old one. */
  await hover(url);
  expect(streams).toHaveLength(2);
  await emit(() => streams[1]?.delta("New words"));
  expect(shown).toEqual({ text: "New words", streaming: true });

  /* The old stream ends now. Its clean-up must not take the new run's partial
     text or its pending entry with it. */
  await emit(() => streams[0]?.ready("Old answer."));
  expect(shown).toEqual({ text: "New words", streaming: true });
  await hover(url);
  expect(streams).toHaveLength(2);
  expect(shown).toEqual({ text: "New words", streaming: true });

  await emit(() => streams[1]?.ready("New answer."));
  expect(shown).toEqual({ text: "New answer.", streaming: false });
});

it.each([
  ["leaveProfile", "/api/reader", () => leaveProfile("A different description.")],
  ["leavePurpose", "/api/library/a-slug", () => leavePurpose("a-slug", "A different reason.")],
] as const)("%s forgets the summaries when it sends and again when the write settles", async (name, path, leave) => {
  const url = `https://destination.example/${name}`;
  await hover(url);
  await emit(() => streams[0]?.ready("Written for the old profile."));
  /* The control: a finished summary is a cache hit, and a hit never asks. If
     this hover asked, every count below would be true of a cache that does not
     work. */
  await hover(url);
  expect(streams).toHaveLength(1);
  expect(shown).toEqual({ text: "Written for the old profile.", streaming: false });

  await emit(() => leave());
  expect(leaving.map((l) => l.path)).toEqual([path]);
  expect(shown).toBeNull();
  await hover(url);
  expect(streams).toHaveLength(2);

  /* **The window the second forget is for.** The write has left and has not
     landed, so the server answers this one from the profile it still has. */
  await emit(() => streams[1]?.ready("Still written for the old profile."));
  expect(shown).toEqual({ text: "Still written for the old profile.", streaming: false });

  await emit(() => leaving[0]?.settle());
  expect(shown).toBeNull();
  await hover(url);
  expect(streams).toHaveLength(3);
});
