/**
 * **A selection across a formula can be commented on, and asked about** — both
 * anchor checks in src/routes.ts, through `handleApi`, against a real article
 * whose paragraph holds TeX.
 *
 * The reader's browser draws that TeX as maths (src/web/maths.ts), so the quote
 * a selection across it sends is the formula's **symbols**; `block.text` holds
 * its **TeX**. Both checks refused that with a 400 until fb30 stage 1b — found
 * by the stage-1 browser check. What they share now is src/quote-in-block.ts,
 * and tests/quote-in-block.test.ts pins its rule; this pins that **both routes
 * use it**, and that it still refuses what it should.
 *
 * Its own file and its own scratch article rather than a case in
 * tests/routes.test.ts and tests/chat-anchor-route.test.ts: both of those seed
 * their article once for every case, and changing a paragraph under all of them
 * to put TeX in it would be changing their fixture to suit this one. The
 * request harness is chat-anchor-route's, for the reason it gives: the status
 * codes and the frames are the route's own.
 *
 * `fetch` is stubbed so no model is reached — every assertion is about what
 * happens before the first token, as in chat-anchor-route.
 */
import { readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import type { Block } from "../src/types.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-maths-quote-route";

await pgReady({
  suite: "tests/maths-quote-route.test.ts",
  tables: ["spideryarn.chat_threads", "spideryarn.comments", "spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");
const { chatStore, commentStore } = await import("../src/store/index.js");

/** The paragraph, as `block.text` stores it: one displayed-in-the-prose formula. */
const TEXT = String.raw`We define \(I(X;Y) = \sum_{x} P(x) \log_2 \frac{P(x)}{Q(x)}\) and use it below.`;

/**
 * A selection starting before the formula and ending inside it, as the reader's
 * browser measures it. The symbols are read off temml by
 * tests/maths-parity.test.ts rather than asserted here: `I(X;Y)=` is the start
 * of that formula's rendered text.
 */
const ACROSS = { quote: "define I(X;Y)=", start: 3 };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

let article: ScratchArticle | undefined;
let BLOCK = "";

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, {
    ownerId: TEST_OWNER,
    /* Change the text, keep the ids — `ScratchOptions.mutate`, which mirrors
       the edit into the other blocks file and re-stamps the hierarchy. */
    mutate: async (dir) => {
      const at = path.join(dir, "blocks.json");
      const doc = JSON.parse(await readFile(at, "utf8")) as { blocks: Block[] };
      const target = doc.blocks.find((b) => b.tag === "p" && b.text.trim().length > 30);
      if (!target) throw new Error("the fixture article has no paragraph to put a formula in");
      target.text = TEXT;
      target.words = TEXT.split(" ").length;
      target.html = `<p id="${target.id}">${esc(TEXT)}</p>`;
      await writeFile(at, JSON.stringify(doc));
    },
  });
  const seeded = article.blocks.find((b) => b.text === TEXT);
  if (!seeded) throw new Error("the TeX paragraph did not survive the load");
  BLOCK = seeded.id;
}, 60_000);

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() => Promise.reject(new Error("no model in tests"))) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

interface Result {
  status: number;
  body: Record<string, unknown> | null;
  frames: { event: string }[];
}

/** One request through `handleApi` — tests/chat-anchor-route.test.ts § `post`. */
async function post(pathname: string, body: unknown): Promise<Result> {
  const payload = [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method: "POST", url: pathname, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;
  let written = "";
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    writeHead(code: number) {
      (this as { statusCode: number }).statusCode = code;
    },
    flushHeaders() {},
    on() {},
    write(chunk: string) {
      written += chunk;
      return true;
    },
    end(chunk?: string) {
      if (chunk) written += chunk;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, acceptAny);
  const frames = written
    .split("\n\n")
    .filter((b) => b.startsWith("event: "))
    .map((b) => ({ event: (b.split("\n")[0] as string).slice("event: ".length) }));
  let parsed: Record<string, unknown> | null = null;
  if (frames.length === 0 && written.trim()) {
    try {
      parsed = JSON.parse(written) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  }
  /* `writeHead` is how a JSON answer sets its code; a stream that began has
     already said 200 by the time its first frame is written. */
  return { status: res.statusCode || (frames.length ? 200 : 0), body: parsed, frames };
}

const comment = (quote: string, start: number) =>
  post(`/api/comments/${SLUG}`, { blockId: BLOCK, quote, start });

const commentsHere = () => asTestOwner(() => commentStore.load(SLUG));

let thread = 0;
const ask = (quote: string, start: number) =>
  post(`/api/chat/${SLUG}`, {
    threadId: `spya-mq${String(++thread).padStart(4, "0")}`,
    question: "what does this say?",
    anchor: { blockId: BLOCK, quote, start },
  });

describe("creating a comment on a selection in a paragraph with a formula", () => {
  it("saves a quote across the formula, as the reader saw it drawn", async () => {
    const r = await comment(ACROSS.quote, ACROSS.start);
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    expect((await commentsHere()).some((c) => c.quote === ACROSS.quote)).toBe(true);
  });

  it("still saves a quote of the TeX source", async () => {
    const quote = String.raw`\(I(X;Y)`;
    const r = await comment(quote, TEXT.indexOf(quote));
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
  });

  it("still refuses words that are in neither form", async () => {
    const before = (await commentsHere()).length;
    const r = await comment("define J(X)", 3);
    expect(r.status).toBe(400);
    expect(r.body?.error).toBe("quote is not in that block");
    expect((await commentsHere()).length).toBe(before);
  });
});

describe("anchoring a chat on a selection in a paragraph with a formula", () => {
  it("anchors on a quote across the formula", async () => {
    const r = await ask(ACROSS.quote, ACROSS.start);
    expect(r.frames[0]?.event, JSON.stringify(r.body)).toBe("begin");
    const stored = await asTestOwner(() => chatStore.load(SLUG));
    expect(stored.some((t) => t.anchor && "quote" in t.anchor && t.anchor.quote === ACROSS.quote)).toBe(true);
  });

  it("still refuses words that are in neither form", async () => {
    const r = await ask("define J(X)", 3);
    expect(r.status).toBe(400);
    expect(r.body?.error).toBe("anchor.quote is not in that block");
  });
});
