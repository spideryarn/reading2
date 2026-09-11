/**
 * **A glossary answer is still being written when the request says it is** —
 * `POST /api/glossary/:slug/:termId/lookup` and `POST /api/glossary/:slug/ask`,
 * each held open mid-stream.
 *
 * ## Why this file exists, and why it exists *before* the move it is for
 *
 * `serveAuthenticatedApi`'s `if` chain is being emptied into `AUTH_ROUTES` one
 * contiguous slice at a time
 * (docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md), and
 * the last slice — the glossary guards and the six from `ideas` to `quizMark` —
 * holds two glossary guards that stream:
 *
 *     await withSpendAttribution({ articleSlug: at }, () =>
 *       streamTermLookup(at, slugPart(lookup, 2), res),
 *     );
 *     await withSpendAttribution({ articleSlug: at }, () => streamAskedTerm(at, askBody?.term, res));
 *
 * Moved into a row, each becomes a closure `dispatchAuthRoute` awaits — the same
 * lifetime **if** the closure still awaits the stream. One that launches it
 * typechecks, and then the request settles while the model is still writing,
 * the spend collector closes before the call it is counting, and anything the
 * stream throws after its headers lands nowhere. The lookup's promise is
 * sharper than the asked term's: **`done` means stored**
 * (src/term-lookup.ts § `TermLookupEvent`), so a request that settles before
 * the save has told the reader a thing it cannot yet know.
 *
 * **These cases were written and run against the guards while they were still
 * in the chain**, and nothing in them reads the route's source or shape — they
 * go in through `handleApi` by method and path — so the move must need no edit
 * here, and green before and green after is the claim. Harness from
 * tests/link-summary-stream-lifetime.test.ts and
 * tests/comment-answer-stream-lifetime.test.ts.
 *
 * ## The mutations, watched rather than reasoned
 *
 * Each applied to src/routes.ts alone, this file run, and reverted. The results
 * are in the plan that moves these guards,
 * docs/plans/260911d-close-the-route-transition.md, rather than here.
 *
 * | Mutation | What must go red |
 * |---|---|
 * | the `lookup` guard's `await withSpendAttribution(` → `void withSpendAttribution(` | both lookup cases, at the handshake |
 * | the `askTerm` guard, the same | both asked-term cases, at the handshake |
 * | `frame("error", …)` deleted from `streamTermLookup`'s `catch` | *a lookup that fails mid-answer …* |
 * | `res.end()` deleted from `streamAskedTerm`'s `finally` | both asked-term cases |
 *
 * **Outside this oracle.** What the model is told and whether its answer is any
 * good — `explainStream` is stubbed, so no model is called and no ledger row is
 * written; tests/glossary-lookup-stream-route.test.ts and
 * tests/glossary-asked-term-stream-route.test.ts drive the real stream against
 * a stubbed provider, and hold the refusals and the reader-leaving cases. The
 * spend collector's own window: no assertion here reads the ledger.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../src/db/client.js";
import { glossaryLookups } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import type { Block } from "../src/types.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-glossary-stream-lifetime";
/** The entry this file adds, named after a word the article really uses. */
const TERM_ID = "spya-gstrmz";

/**
 * The stubbed stream, one gate per call, **queued by the quote the stream was
 * asked about** — the lookup's word and the asked term's word are different
 * words, so an orphaned stream from one route's mutation cannot take the other
 * route's gate and turn its cases red as collateral.
 *
 * A gate made with `fail` throws where the other would finish, after the first
 * delta has been written. `vi.hoisted` because `vi.mock` is hoisted above this
 * module's statements.
 */
const gates = vi.hoisted(() => {
  function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }
  interface Gate {
    fail: boolean;
    reached: () => Promise<void>;
    arrive: () => void;
    hold: () => Promise<void>;
    release: () => void;
  }
  const queues = new Map<string, { gates: Gate[]; taken: number }>();
  const all: Gate[] = [];
  /* By prefix, case-folded: the asked term's quote is the characters the
     matcher found, which may be the word capitalised or with a plural on. */
  const queueFor = (quote: string) => {
    const folded = quote.toLowerCase();
    for (const [key, q] of queues) if (folded.startsWith(key)) return q;
    const q = { gates: [] as Gate[], taken: 0 };
    queues.set(folded, q);
    return q;
  };
  return {
    make(quote: string, opts: { fail?: boolean } = {}): Gate {
      const arrived = deferred();
      const released = deferred();
      const gate: Gate = {
        fail: opts.fail ?? false,
        reached: () => arrived.promise,
        arrive: () => arrived.resolve(),
        hold: () => released.promise,
        release: () => released.resolve(),
      };
      queueFor(quote).gates.push(gate);
      all.push(gate);
      return gate;
    },
    take(quote: string): Gate {
      const q = queueFor(quote);
      const gate = q.gates[q.taken++];
      if (!gate) throw new Error(`a stream began for "${quote}" that no case made a gate for`);
      return gate;
    },
    releaseAll(): void {
      for (const gate of all) gate.release();
    },
  };
});

/* Only the stream is replaced; src/term-lookup.ts takes its default from this
   import, so both `lookUpTerm` and `askAboutTerm` in src/store/index.ts get it. */
vi.mock("../src/explain.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/explain.js")>()),
  async *explainStream(req: { quote: string }) {
    const gate = gates.take(req.quote);
    yield { type: "delta", text: "half an explanation" };
    gate.arrive();
    await gate.hold();
    if (gate.fail) throw new Error("the provider went away mid-answer");
    yield {
      type: "done",
      ending: "finished",
      answer: "the whole explanation",
      citations: [],
      searches: 0,
      model: "stub",
    };
  },
}));

await pgReady({
  suite: "tests/glossary-stream-lifetime.test.ts",
  tables: ["spideryarn.revision_blocks", "spideryarn.glossary_lookups"],
});

const { handleApi } = await import("../src/routes.js");

/**
 * A request started but not waited for — the comment-answer oracle's `begin`,
 * plus **what the response looked like at the moment the request settled**,
 * recorded by the same continuation that sets `settled`. The failure cases read
 * that snapshot rather than the response afterwards, so a response ended a
 * moment *after* the request settled cannot pass for one ended before it.
 */
function begin(
  url: string,
  body?: unknown,
): {
  promise: Promise<void>;
  settled: () => boolean;
  ended: () => boolean;
  written: () => string;
  atSettle: () => { ended: boolean; written: string } | undefined;
} {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method: "POST", url, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;

  let written = "";
  let ended = false;
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    flushHeaders() {},
    writeHead() {},
    on() {},
    write(chunk: string) {
      written += chunk;
      return true;
    },
    end(chunk?: string) {
      if (chunk) written += chunk;
      ended = true;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;

  let settled = false;
  let snapshot: { ended: boolean; written: string } | undefined;
  const promise = handleApi(req, res, acceptAny).then(
    () => {
      settled = true;
      snapshot = { ended, written };
    },
    (err: unknown) => {
      settled = true;
      snapshot = { ended, written };
      throw err;
    },
  );
  return {
    promise,
    settled: () => settled,
    ended: () => ended,
    written: () => written,
    atSettle: () => snapshot,
  };
}

/** Wait for the stream's checkpoint, failing fast if the request answers instead. */
async function reachedOrSettled(
  gate: { reached: () => Promise<void> },
  call: { promise: Promise<void>; written: () => string },
): Promise<void> {
  const early = call.promise.then(
    () => {
      throw new Error(
        `the request settled before the stream was entered — launched rather than awaited? ${call.written()}`,
      );
    },
    () => {
      throw new Error("the request failed before the stream was entered");
    },
  );
  early.catch(() => {});
  await Promise.race([gate.reached(), early]);
  await Promise.resolve();
}

/** The frames a stream wrote other than `delta`, by name, in order. */
const terminals = (written: string): string[] =>
  [...written.matchAll(/^event: (\w+)$/gm)]
    .map((m) => m[1] ?? "")
    .filter((name) => name !== "delta");

/** Two different whole words from the prose: one for the entry, one to ask about. */
const words = { lookup: "", ask: "" };

/**
 * Add one entry named after a whole word from the article, so `anchorIn` finds
 * it however stale the corpus glossary is — tests/glossary-lookup-stream-route.test.ts's
 * `addAnAnchoredTerm`, which also picks the asked term's word, a different one.
 */
async function addAnAnchoredTerm(dir: string): Promise<void> {
  const { blocks } = JSON.parse(await readFile(path.join(dir, "blocks.json"), "utf8")) as {
    blocks: Block[];
  };
  let blockId = "";
  for (const b of blocks) {
    for (const hit of b.text ? b.text.matchAll(/\b[A-Za-z]{7,}\b/g) : []) {
      if (!words.lookup) {
        words.lookup = hit[0];
        blockId = b.id;
      } else if (
        /* Neither a prefix of the other, so the two gate queues cannot collide. */
        !hit[0].toLowerCase().startsWith(words.lookup.toLowerCase()) &&
        !words.lookup.toLowerCase().startsWith(hit[0].toLowerCase())
      ) {
        words.ask = hit[0];
        break;
      }
    }
    if (words.ask) break;
  }
  if (!words.lookup || !words.ask) throw new Error("the fixture has no two words long enough to use");
  const at = path.join(dir, "glossary.json");
  const glossary = JSON.parse(await readFile(at, "utf8")) as { entries: unknown[] };
  glossary.entries = [
    ...glossary.entries,
    {
      id: TERM_ID,
      name: words.lookup,
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

let article: ScratchArticle | undefined;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  /* `TEST_OWNER`, because `acceptAny` authenticates as that reader and every
     article read is owner-scoped. */
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER, mutate: addAnAnchoredTerm });
  /* Nothing here should reach a provider — `explainStream` is the only model
     call on either path — so a `fetch` that rejects makes a paid call nobody
     stubbed a failure rather than a bill. */
  globalThis.fetch = (() => Promise.reject(new Error("no model in tests"))) as unknown as typeof fetch;
}, 120_000);

afterAll(async () => {
  gates.releaseAll();
  globalThis.fetch = realFetch;
  await article?.remove();
});

async function storedLookup(): Promise<string | undefined> {
  if (!article) throw new Error("no article");
  const rows = await getDb()
    .select({ answer: glossaryLookups.answer })
    .from(glossaryLookups)
    .where(and(eq(glossaryLookups.articleId, article.articleId), eq(glossaryLookups.entryId, TERM_ID)));
  return rows[0]?.answer;
}

describe("a glossary lookup outlives nothing it should", { timeout: 60_000 }, () => {
  const lookupUrl = () => `/api/glossary/${SLUG}/${TERM_ID}/lookup`;

  /* Each case starts with no stored answer for the entry. */
  beforeEach(async () => {
    if (!article) return;
    await getDb()
      .delete(glossaryLookups)
      .where(and(eq(glossaryLookups.articleId, article.articleId), eq(glossaryLookups.entryId, TERM_ID)));
  });

  it("holds the request open until the lookup is stored, and only then answers", async () => {
    const gate = gates.make(words.lookup);
    const call = begin(lookupUrl());
    await reachedOrSettled(gate, call);

    /* The handshake fired, so the handler is inside the stream and has written
       its first words. Both of these are false for a guard that launched it. */
    expect(call.settled(), "the request answered while the lookup was still being written").toBe(false);
    expect(call.ended(), "the response was ended mid-stream").toBe(false);

    gate.release();
    await call.promise;

    expect(call.atSettle()?.ended, "the response was still open when the request settled").toBe(true);
    expect(terminals(call.atSettle()?.written ?? ""), call.written()).toEqual(["done"]);
    expect(await storedLookup(), "`done` was written before the lookup was stored").toBe(
      "the whole explanation",
    );
  });

  it("a lookup that fails mid-answer says so, and ends the response, before the request settles", async () => {
    /* The half of the lifetime a success cannot show: a launched stream's
       failure lands nowhere, and the request has already been answered. */
    const gate = gates.make(words.lookup, { fail: true });
    const call = begin(lookupUrl());
    await reachedOrSettled(gate, call);
    expect(call.settled(), "the request answered while the lookup was still being written").toBe(false);

    gate.release();
    await call.promise;

    expect(terminals(call.atSettle()?.written ?? ""), call.written()).toEqual(["error"]);
    expect(call.atSettle()?.ended, "the response was still open when the request settled").toBe(true);
    expect(await storedLookup(), "a failed lookup stored something").toBeUndefined();
  });
});

describe("an asked term outlives nothing it should", { timeout: 60_000 }, () => {
  const askUrl = `/api/glossary/${SLUG}/ask`;

  it("holds the request open until the answer is written, and only then answers", async () => {
    const gate = gates.make(words.ask);
    const call = begin(askUrl, { term: words.ask });
    await reachedOrSettled(gate, call);

    expect(call.settled(), "the request answered while the answer was still being written").toBe(false);
    expect(call.ended(), "the response was ended mid-stream").toBe(false);

    gate.release();
    await call.promise;

    expect(call.atSettle()?.ended, "the response was still open when the request settled").toBe(true);
    expect(terminals(call.atSettle()?.written ?? ""), call.written()).toEqual(["begin", "done"]);
  });

  it("an answer that fails mid-stream says so, and ends the response, before the request settles", async () => {
    const gate = gates.make(words.ask, { fail: true });
    const call = begin(askUrl, { term: words.ask });
    await reachedOrSettled(gate, call);
    expect(call.settled(), "the request answered while the answer was still being written").toBe(false);

    gate.release();
    await call.promise;

    expect(terminals(call.atSettle()?.written ?? ""), call.written()).toEqual(["begin", "error"]);
    expect(call.atSettle()?.ended, "the response was still open when the request settled").toBe(true);
  });
});
