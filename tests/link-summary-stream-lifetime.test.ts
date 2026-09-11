/**
 * **A link summary is still being written when the request says it is** —
 * `GET /api/link-summary`, held open mid-stream, with the single-flight claim
 * in the real database.
 *
 * ## Why this file exists, and why it exists *before* the move it is for
 *
 * `serveAuthenticatedApi`'s `if` chain is being emptied into `AUTH_ROUTES` one
 * contiguous slice at a time
 * (docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md). The
 * article block — `article`, the two link routes, `visibility`, `source`,
 * `asset`, `export`, `metadata`, `tweets` — is a later slice, and one of its
 * guards streams:
 *
 *     await streamLinkSummary(at, query.get("url"), query.get("block"), res);
 *
 * Moved into a row, that becomes a closure `dispatchAuthRoute` awaits — the same
 * lifetime **if** the closure still awaits the stream. One that launches it
 * typechecks, and then the request ends while the model is still writing and
 * anything the stream throws after its headers lands nowhere. The queue of gaps
 * in docs/plans/260908a-chat-and-live-sessions-join-the-route-table.md § *The
 * queue after this slice* names this route: nothing drove a successful HTTP
 * stream through it.
 *
 * **The claim is the real one.** `linkSummaryStore.claim` is a row in Postgres,
 * leased and fenced on a token (tests/link-summary-cache.test.ts § 2 and § 3),
 * and a mocked promise could not say whether a second request is really kept
 * out while the first is streaming (260908f § G). So the claim, the fill and the
 * reader's allowance all run against the local database; only the model and the
 * preview are stubbed. A pass-through records the real claim's returned kind,
 * because the route deliberately frames a thrown store error as `pending` too:
 * the frame and model-call count alone could not tell those two paths apart.
 *
 * **These cases were written and run against the guard while it was still in
 * the chain**, and nothing in them reads the route's source or shape, so the
 * move must need no edit here — green before and green after is the claim.
 *
 * ## The mutations, watched rather than reasoned
 *
 * Results in docs/plans/260911c-paid-single-flight-joins-the-route-table.md
 * § *The link-summary oracle*, rather than here.
 *
 * | Mutation | What must go red |
 * |---|---|
 * | the guard's `await streamLinkSummary(…)` → `void streamLinkSummary(…)` | both cases, at the handshake |
 * | `if (claim.kind === "pending") return yield …` deleted from `linkSummaryStream` | *a second hover … buys nothing* |
 *
 * **Outside this oracle.** What the model is told and whether its answer is any
 * good — `openRouterStream` is stubbed, so no provider is called and no ledger
 * row is written; tests/link-summary-prompt.test.ts holds the prompt. The
 * preview cache — `linkPreviewStore.read` is stubbed for this one link, because
 * tests/link-preview-cache.test.ts empties that ownerless table between its
 * cases and would otherwise race this file in the same database. Which mention
 * of a link is summarised: tests/link-summary-occurrence.test.ts.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../src/db/client.js";
import { linkSummaries } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { acceptAny, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-link-summary-stream-lifetime";

/**
 * The stubbed model stream, one gate per call, handed out in order — the
 * comment-answer oracle's harness. A call that finds no gate throws, and
 * `calls` counts every call, so "the second hover bought nothing" is a number.
 *
 * `vi.hoisted` because `vi.mock` is hoisted above this module's statements.
 */
const stub = vi.hoisted(() => {
  function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }
  interface Gate {
    reached: () => Promise<void>;
    arrive: () => void;
    hold: () => Promise<void>;
    release: () => void;
  }
  const queue: Gate[] = [];
  let taken = 0;
  return {
    calls: 0,
    /** Outcomes returned by the real Postgres claim, observed without replacing it. */
    claimKinds: [] as Array<"hit" | "claimed" | "pending">,
    /** The target the stubbed preview answers for, set once the fixture is read. */
    target: "",
    make(): Gate {
      const arrived = deferred();
      const released = deferred();
      const gate: Gate = {
        reached: () => arrived.promise,
        arrive: () => arrived.resolve(),
        hold: () => released.promise,
        release: () => released.resolve(),
      };
      queue.push(gate);
      return gate;
    },
    take(): Gate {
      const gate = queue[taken++];
      if (!gate) throw new Error("a model call began that no case made a gate for");
      return gate;
    },
    releaseAll(): void {
      for (const gate of queue) gate.release();
    },
  };
});

/* Only the stream is replaced. It yields a first sentence, signals, holds, and
   then finishes the way a complete response does — `[DONE]` seen and a `stop`
   reason, both of which `classifyEnd` requires before a summary may be stored. */
vi.mock("../src/ai-call.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/ai-call.js")>()),
  async *openRouterStream(
    _job: unknown,
    _body: unknown,
    options: { end: { terminated: boolean; finishReason?: string | null } },
  ) {
    stub.calls++;
    const gate = stub.take();
    yield { choices: [{ delta: { content: "It is the source " } }] };
    gate.arrive();
    await gate.hold();
    yield { choices: [{ delta: { content: "of the claim." }, finish_reason: "stop" }] };
    options.end.terminated = true;
    options.end.finishReason = "stop";
  },
}));

/* The preview for this file's one link. The summary store stays real; its
   pass-through records which outcome Postgres actually returned. */
vi.mock("../src/store/index.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/index.js")>();
  const linkPreviewStore = Object.assign(Object.create(real.linkPreviewStore) as typeof real.linkPreviewStore, {
    async read(target: string) {
      if (target === stub.target) {
        return {
          kind: "ok" as const,
          page: { title: "The page the article cites" },
          excerpt: "The opening of the destination page, which says what it is about.",
        };
      }
      return real.linkPreviewStore.read(target);
    },
  });
  const linkSummaryStore = Object.assign(Object.create(real.linkSummaryStore) as typeof real.linkSummaryStore, {
    async claim(...args: Parameters<typeof real.linkSummaryStore.claim>) {
      const claim = await real.linkSummaryStore.claim(...args);
      stub.claimKinds.push(claim.kind);
      return claim;
    },
  });
  return { ...real, linkPreviewStore, linkSummaryStore };
});

await pgReady({
  suite: "tests/link-summary-stream-lifetime.test.ts",
  tables: ["spideryarn.link_summaries", "spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");
const { requestTarget } = await import("../src/urls.js");

/** A request started but not waited for — tests/comment-answer-stream-lifetime.test.ts's `begin`. */
function begin(url: string): {
  promise: Promise<void>;
  settled: () => boolean;
  ended: () => boolean;
  written: () => string;
} {
  const req = Object.assign(
    (async function* () {
      /* A GET: no body. */
    })(),
    { method: "GET", url, headers: AUTHED_HEADERS },
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
  const promise = handleApi(req, res, acceptAny).then(
    () => {
      settled = true;
    },
    (err: unknown) => {
      settled = true;
      throw err;
    },
  );
  return { promise, settled: () => settled, ended: () => ended, written: () => written };
}

/** Wait for the model's checkpoint, failing fast if the request answers instead. */
async function reachedOrSettled(
  gate: { reached: () => Promise<void> },
  call: { promise: Promise<void>; written: () => string },
): Promise<void> {
  const early = call.promise.then(
    () => {
      throw new Error(
        `the request settled before the model was reached — launched rather than awaited? ${call.written()}`,
      );
    },
    () => {
      throw new Error("the request failed before the model was reached");
    },
  );
  early.catch(() => {});
  await Promise.race([gate.reached(), early]);
  await Promise.resolve();
}

/** The terminal frames a stream wrote, by name, in order. */
const terminals = (written: string): string[] =>
  [...written.matchAll(/^event: (\w+)$/gm)]
    .map((m) => m[1] ?? "")
    .filter((name) => name !== "delta");

describe("a link summary outlives nothing it should", { timeout: 60_000 }, () => {
  let article: ScratchArticle;
  let summaryUrl = "";

  beforeAll(async () => {
    /* The noema essay, because it has outbound links in its paragraphs and the
       default fixture has none. `TEST_OWNER`, because `acceptAny` authenticates
       as that reader and every article read is owner-scoped. */
    article = await scratchArticleInPg(SLUG, {
      ownerId: TEST_OWNER,
      from: "noema-mythology-of-conscious-ai",
    });
    for (const block of article.blocks) {
      const href = /href="(https:\/\/[^"]+)"/.exec(block.html)?.[1];
      if (href && !href.includes("noemamag.com")) {
        stub.target = requestTarget(href) ?? "";
        summaryUrl =
          `/api/link-summary?slug=${SLUG}&url=${encodeURIComponent(href)}` +
          `&block=${encodeURIComponent(block.id)}`;
        break;
      }
    }
    if (!stub.target) throw new Error("the fixture has no outbound link to summarise");
  }, 60_000);

  /* Each case starts cold: no stored summary and no claim for this article. */
  beforeEach(async () => {
    await getDb().delete(linkSummaries).where(eq(linkSummaries.articleId, article.articleId));
  });

  afterAll(async () => {
    stub.releaseAll();
    await article?.remove();
  });

  it("holds the request open until the summary is written, and only then answers", async () => {
    const gate = stub.make();
    const call = begin(summaryUrl);
    await reachedOrSettled(gate, call);

    /* The handshake fired, so the stream is running and has sent its first
       sentence. Both of these are false for a guard that launched it. */
    expect(call.settled(), "the request answered while the summary was still being written").toBe(false);
    expect(call.ended(), "the response was ended mid-stream").toBe(false);

    gate.release();
    await call.promise;

    expect(call.ended()).toBe(true);
    expect(terminals(call.written()), call.written()).toEqual(["ready"]);
  });

  it("a second hover while the first is streaming is told pending by the claim, and buys nothing", async () => {
    const gate = stub.make();
    const callsBefore = stub.calls;
    const claimsBefore = stub.claimKinds.length;
    const first = begin(summaryUrl);
    await reachedOrSettled(gate, first);
    expect(stub.claimKinds.slice(claimsBefore), "the first hover did not win a real database claim").toEqual([
      "claimed",
    ]);

    /* **The claim, asked while the first stream holds it.** The second request
       finds no stored summary and reaches `claim`, and the row the first one
       took is still there — so `pending`, no allowance spent and no model
       called. */
    const second = begin(summaryUrl);
    await second.promise;
    expect(terminals(second.written()), second.written()).toEqual(["pending"]);
    expect(
      stub.claimKinds.slice(claimsBefore),
      "the second hover's pending frame did not come from the real database claim",
    ).toEqual(["claimed", "pending"]);
    expect(first.settled(), "the first hover ended with the second").toBe(false);

    gate.release();
    await first.promise;
    expect(terminals(first.written())).toEqual(["ready"]);

    /* **And the claim became the stored answer before the first request
       settled**, so a third hover straight afterwards is served from the row —
       no gate was made for it, so a model call here would throw. */
    const third = begin(summaryUrl);
    await third.promise;
    expect(terminals(third.written()), third.written()).toEqual(["ready"]);
    expect(stub.claimKinds.slice(claimsBefore), "the stored answer went back through the claim").toEqual([
      "claimed",
      "pending",
    ]);
    expect(stub.calls - callsBefore, "a hover that should have waited or read the row called the model").toBe(1);
  });
});
