/**
 * **An entry's *Check the web* streams its answer, and only an answer that
 * was saved is ever called done.** `POST /api/glossary/:slug/:id/lookup`, at
 * the route — cluster E stage 2,
 * docs/plans/260910g-stream-glossary-answers-as-they-arrive.md.
 *
 * The claims:
 *
 * 1. **Useful text is written before the provider has finished** — a provider
 *    that sends one delta and then holds.
 * 2. **`done` is written only after the lookup is stored, and carries what was
 *    stored**; a fresh read of the glossary — what a page refresh does — then
 *    has it on the entry.
 * 3. **Nothing is stored and no `done` is written** when the provider refuses
 *    before its first word, when the body ends without finishing, or when the
 *    answer ran out of room.
 * 4. **A save that fails after the words arrived is an `error`, never a
 *    `done`** — driven by the article being removed while its answer streams,
 *    which is also the removal case.
 * 5. **The reader leaving does not stop the paid call, and the answer is still
 *    kept.** The panel promises "the answer is saved against this term either
 *    way", and this is the one route in the pair where that is the deal: the
 *    unsaved box cancels on leave, because nothing it produces outlives the
 *    page.
 * 6. **Refusals stay JSON before a header**, and a request costs one call.
 *
 * Harness from tests/glossary-asked-term-stream-route.test.ts.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import type { Block, GlossaryEntry, GlossaryResponse } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-glossary-lookup-stream-route";
const DOOMED_SLUG = "test-glossary-lookup-stream-doomed";
/** The entry this file adds, anchored to a word the article really uses. */
const TERM_ID = "spya-strmaa";

await pgReady({
  suite: "tests/glossary-lookup-stream-route.test.ts",
  tables: ["spideryarn.revision_blocks", "spideryarn.glossary_lookups"],
});

const { handleApi } = await import("../src/routes.js");

let article: ScratchArticle | undefined;
let doomed: ScratchArticle | undefined;

const realFetch = globalThis.fetch;
const noModel = (() => Promise.reject(new Error("no model in tests"))) as unknown as typeof fetch;

/**
 * Add one entry named after a whole word from the article's first paragraph,
 * so `anchorIn` finds it however stale the corpus glossary is in this checkout.
 */
async function addAnAnchoredTerm(dir: string): Promise<void> {
  const { blocks } = JSON.parse(await readFile(path.join(dir, "blocks.json"), "utf8")) as {
    blocks: Block[];
  };
  let word = "";
  let blockId = "";
  for (const b of blocks) {
    const hit = b.text ? /\b[A-Za-z]{7,}\b/.exec(b.text) : null;
    if (hit) {
      word = hit[0];
      blockId = b.id;
      break;
    }
  }
  if (!word) throw new Error("the fixture has no word long enough to look up");
  const at = path.join(dir, "glossary.json");
  const glossary = JSON.parse(await readFile(at, "utf8")) as { entries: unknown[] };
  glossary.entries = [
    ...glossary.entries,
    {
      id: TERM_ID,
      name: word,
      kind: "concept",
      aliases: [],
      background: "A word the article uses.",
      difficulty: 0.4,
      centrality: 0.4,
      blocks: [blockId],
    },
  ];
  await writeFile(at, JSON.stringify(glossary));
}

beforeAll(async () => {
  const stub = globalThis.fetch;
  globalThis.fetch = realFetch;
  try {
    article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER, mutate: addAnAnchoredTerm });
    doomed = await scratchArticleInPg(DOOMED_SLUG, {
      ownerId: TEST_OWNER,
      mutate: addAnAnchoredTerm,
    });
  } finally {
    globalThis.fetch = stub;
  }
  globalThis.fetch = noModel;
}, 120_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  await article?.remove();
  await doomed?.remove();
  await closeDb();
});

beforeEach(() => {
  globalThis.fetch = noModel;
});

const chunk = (data: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);

/** A provider that says `first` and then waits for the test. */
function heldProvider(first: string) {
  let calls = 0;
  let sent: AbortSignal | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const close = () => {
    try {
      controller?.close();
    } catch {
      // Cancelled already.
    }
  };
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    calls += 1;
    sent = init?.signal ?? undefined;
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
          c.enqueue(chunk({ model: "a-model", choices: [{ delta: { content: first } }] }));
        },
      }),
    } as unknown as Response);
  }) as unknown as typeof fetch;

  return {
    calls: () => calls,
    signal: () => sent,
    finish(rest: string) {
      controller?.enqueue(chunk({ choices: [{ delta: { content: rest } }] }));
      controller?.enqueue(chunk({ choices: [{ finish_reason: "stop", delta: {} }] }));
      controller?.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      close();
    },
    cut() {
      close();
    },
    runOutOfRoom() {
      controller?.enqueue(chunk({ choices: [{ finish_reason: "length", delta: {} }] }));
      controller?.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      close();
    },
  };
}

/** One request and its response — the asked-term route test's `serve`. */
function serve(method: string, url: string) {
  const req = Object.assign(
    (async function* () {
      yield* [Buffer.from("{}")];
    })(),
    { method, url, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;

  let written = "";
  let head = 0;
  const closers: (() => void)[] = [];
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    writeHead(status: number) {
      head = status;
      (this as { statusCode: number }).statusCode = status;
    },
    flushHeaders() {},
    on(event: string, fn: () => void) {
      if (event === "close") closers.push(fn);
    },
    write(piece: string) {
      written += piece;
      return true;
    },
    end(piece?: string) {
      if (piece) written += piece;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;

  return {
    req,
    res,
    close(): void {
      (res as unknown as { destroyed: boolean }).destroyed = true;
      for (const fn of closers) fn();
    },
    status: () => (res as unknown as { statusCode: number }).statusCode,
    body: () => written,
    streamed: () => head === 200 && written.includes("event: "),
  };
}

const lookupUrl = (slug: string, id = TERM_ID) => `/api/glossary/${slug}/${id}/lookup`;

function frames(body: string): { name: string; data: unknown }[] {
  return body
    .split("\n\n")
    .map((f) => {
      const name = /^event: (.*)$/m.exec(f)?.[1];
      const data = /^data: (.*)$/m.exec(f)?.[1];
      return name && data ? { name, data: JSON.parse(data) as unknown } : null;
    })
    .filter((f): f is { name: string; data: unknown } => f !== null);
}

const terminals = (body: string) =>
  frames(body).filter((f) => f.name === "done" || f.name === "error");

async function until(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !ready(); i++) await new Promise((r) => setTimeout(r, 5));
}

/** What a page refresh would read back for the entry: the owner's glossary GET. */
async function storedEntry(slug: string): Promise<GlossaryEntry | undefined> {
  const call = serve("GET", `/api/glossary/${slug}`);
  await handleApi(call.req, call.res, acceptAny);
  const body = JSON.parse(call.body()) as GlossaryResponse;
  return body.glossary.entries.find((e) => e.id === TERM_ID);
}

describe("a lookup that is still arriving", () => {
  it("writes the first words before the provider finishes, and `done` only once stored", async () => {
    const provider = heldProvider("The first sentence. ");
    const call = serve("POST", lookupUrl(SLUG));
    const handled = handleApi(call.req, call.res, acceptAny);

    await until(() => call.body().includes("event: delta"));
    const early = frames(call.body());
    provider.finish("The second sentence.");
    await handled;

    expect(early.some((f) => f.name === "delta")).toBe(true);
    expect(early.some((f) => f.name === "done")).toBe(false);

    const ends = terminals(call.body());
    expect(ends.map((f) => f.name)).toEqual(["done"]);
    /* The public shape, unchanged: `{ entry }` with the lookup on it. */
    const done = ends[0]?.data as { entry: GlossaryEntry };
    expect(Object.keys(done)).toEqual(["entry"]);
    expect(done.entry.id).toBe(TERM_ID);
    expect(done.entry.lookup?.answer).toBe("The first sentence. The second sentence.");
    expect(provider.calls()).toBe(1);

    /* **The refresh.** The same answer, from the store rather than the frame. */
    expect((await storedEntry(SLUG))?.lookup?.answer).toBe(
      "The first sentence. The second sentence.",
    );
  });
});

describe("a lookup that did not finish stores nothing", () => {
  /* Each case asserts the stored answer is *unchanged* rather than absent,
     because the case above has already stored one: a failed re-check must not
     overwrite a good answer with half of a new one. */
  it("ends in `error` when the body stops without finishing", async () => {
    const before = (await storedEntry(SLUG))?.lookup?.answer;
    const provider = heldProvider("Half an answer ");
    const call = serve("POST", lookupUrl(SLUG));
    const handled = handleApi(call.req, call.res, acceptAny);
    await until(() => provider.calls() > 0);
    provider.cut();
    await handled;

    expect(call.streamed()).toBe(true);
    expect(terminals(call.body()).map((f) => f.name)).toEqual(["error"]);
    expect((await storedEntry(SLUG))?.lookup?.answer).toBe(before);
  });

  it("ends in `error` when the answer ran out of room", async () => {
    const before = (await storedEntry(SLUG))?.lookup?.answer;
    const provider = heldProvider("Half an answer that ");
    const call = serve("POST", lookupUrl(SLUG));
    const handled = handleApi(call.req, call.res, acceptAny);
    await until(() => provider.calls() > 0);
    provider.runOutOfRoom();
    await handled;

    const ends = terminals(call.body());
    expect(ends.map((f) => f.name)).toEqual(["error"]);
    expect((ends[0]?.data as { error?: string } | undefined)?.error).toMatch(/\[gl-cut-off\]/);
    expect((await storedEntry(SLUG))?.lookup?.answer).toBe(before);
  });

  it("ends in `error` when the provider refuses before its first word", async () => {
    const before = (await storedEntry(SLUG))?.lookup?.answer;
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: false,
        status: 429,
        headers: new Headers(),
        text: () => Promise.resolve("rate limited"),
        body: null,
      } as unknown as Response)) as unknown as typeof fetch;
    const call = serve("POST", lookupUrl(SLUG));
    await handleApi(call.req, call.res, acceptAny);

    expect(terminals(call.body()).map((f) => f.name)).toEqual(["error"]);
    expect((await storedEntry(SLUG))?.lookup?.answer).toBe(before);
  });
});

describe("a save that fails after the words arrived", () => {
  it("is an `error`, never a `done` — the article removed while its answer streamed", async () => {
    const provider = heldProvider("Words the reader has already read. ");
    const call = serve("POST", lookupUrl(DOOMED_SLUG));
    const handled = handleApi(call.req, call.res, acceptAny);
    await until(() => call.body().includes("event: delta"));

    await doomed?.remove();
    provider.finish("And the rest.");
    await handled;

    expect(frames(call.body()).some((f) => f.name === "delta")).toBe(true);
    expect(terminals(call.body()).map((f) => f.name)).toEqual(["error"]);
  });
});

describe("the reader leaving", () => {
  it("does not stop the paid call, and the answer is still kept", async () => {
    const provider = heldProvider("Kept for when they come back. ");
    const call = serve("POST", lookupUrl(SLUG));
    const handled = handleApi(call.req, call.res, acceptAny);
    await until(() => provider.signal() !== undefined);

    call.close();
    provider.finish("All of it.");
    await handled;

    expect(provider.signal()?.aborted).toBe(false);
    expect((await storedEntry(SLUG))?.lookup?.answer).toBe(
      "Kept for when they come back. All of it.",
    );
  });
});

describe("a lookup that cannot be asked", () => {
  it("is refused as JSON before a header, with no provider call", async () => {
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      return Promise.reject(new Error("no model in tests"));
    }) as unknown as typeof fetch;
    const call = serve("POST", lookupUrl(SLUG, "spya-nobody"));
    await handleApi(call.req, call.res, acceptAny);

    expect(call.status()).toBe(404);
    expect(call.streamed()).toBe(false);
    expect(calls).toBe(0);
  });
});
