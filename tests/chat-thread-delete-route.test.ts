/**
 * `DELETE /api/chat/:slug/:threadId` — the route, not the lock.
 *
 * **What this file is for, stated before it can be misread.** It exists because
 * the twelve chat guards are about to move from `serveAuthenticatedApi`'s `if`
 * chain into `AUTH_ROUTES`, and this one holds `inTurnOrder` across its
 * response:
 *
 * ```ts
 * threads: await inTurnOrder(`${slug}/${id}`, () => chatStore.remove(slug, id))
 * ```
 *
 * A move that dropped that `await` would typecheck. `send` stringifies
 * synchronously, so `{ threads: <Promise> }` serialises as `{"threads":{}}` and
 * the reader is told the thread is gone while the deletion is still in flight.
 * Nothing on the server side asked this route anything before this file:
 * tests/chat-delete-live-turn.test.ts and tests/api-fetch-offline.test.ts are
 * `jsdom` client tests with a stubbed `fetch`, and the only other hit is the
 * static contract reader.
 * docs/plans/260908a-chat-and-live-sessions-join-the-route-table.md § Stage 1.
 *
 * ## What it does NOT claim, which is the more important half
 *
 * **It is not a test that the lock is held**, and it must never be read as one.
 * Replacing `inTurnOrder(k, () => chatStore.remove(…))` with a bare
 * `chatStore.remove(…)` changes no byte of the response, and every assertion
 * below stays green. That is stated here in advance rather than discovered
 * later, because the header of tests/turn-order.test.ts records that an earlier
 * attempt to test the routes' *use* of the lock **passed with the lock
 * removed** — "which is worse than no test at all". The exclusion property is
 * held there, on its own, with no HTTP and no store; what stops the lock being
 * quietly deleted during this migration is the normalised body diff, which sees
 * two different tokens.
 *
 * So: two mutations, two catchers, and only one of them is this file's.
 *
 * | Mutation | Response | Caught by |
 * |---|---|---|
 * | `await inTurnOrder(…)` → `inTurnOrder(…)` | `{"threads":{}}` | **here** |
 * | `inTurnOrder(k, f)` → `f()` | unchanged | the body diff, and nothing else |
 *
 * ## The mutations, watched rather than reasoned
 *
 * Recorded when this file was written, against the routes **as they are today**
 * — before the move, so that a red here after the move is attributable to the
 * move and not to this file having always been red.
 *
 * Green unmutated: **2 passed of 2**.
 *
 * **Mutation 1** — the subject. `src/routes.ts`, the `oneThread && "DELETE"`
 * guard: `threads: await inTurnOrder(…)` made `threads: inTurnOrder(…)`.
 * **2 failed of 2**, and the second failure is the more interesting one:
 *
 * - *answers with the remaining conversations* — `threads was not an array — a
 *   promise was not awaited: expected false to be true`, which is the predicted
 *   `{"threads":{}}`.
 * - *really removed it, and not only in the reply* — `expected [ 'spya-j827m6',
 *   'spya-dmkgcy' ] to deeply equal [ 'spya-dmkgcy' ]`. **Both conversations
 *   were still in the store** when the next request looked. That is the defect
 *   itself and not a proxy for it: the reply had already gone out saying the
 *   thread was deleted.
 *
 * **Mutation 2** — the control, and it is *expected to stay green*.
 * `threads: await inTurnOrder(`${slug}/${id}`, () => chatStore.remove(slug, id))`
 * made `threads: await chatStore.remove(slug, id)` — the lock gone, the await
 * kept. **2 passed of 2**, as predicted before it was run. The lock can be
 * deleted from this route and every assertion here still holds, which is why
 * the header above says what it says: this is not a test of the lock, and the
 * body diff is the only thing standing between the migration and that
 * deletion.
 *
 * **Outside this oracle.** Everything about ordering and exclusion under
 * concurrency; the `articleId` scoping inside `threadsFor`; and — with one
 * owner seeding one article — whether the owner predicate in `ownedSlug` is
 * doing any work, for
 * the same reason tests/the-query-string-does-not-decide-the-route.test.ts
 * records against its own mutation 2. tests/owner-isolation.test.ts holds that.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

/** A throwaway slug, so the conversations written below belong to nobody. */
const SLUG = "test-chat-thread-delete-route";

await pgReady({
  suite: "tests/chat-thread-delete-route.test.ts",
  tables: ["spideryarn.chat_threads", "spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");
const { chatStore } = await import("../src/store/index.js");

/**
 * Drive `handleApi` with a fake request, and give back the status and the parsed
 * body.
 *
 * Deliberately the same minimal `res` as the two files beside this one: no
 * `write`, no `writeHead`, no `on`. This route answers with `send` and nothing
 * else, so a route that started streaming would fail here loudly rather than
 * quietly passing — which is the property tests/routes.test.ts § `callStreaming`
 * calls load-bearing rather than lucky.
 */
async function call(
  method: string,
  url: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = Object.assign((async function* () {})(), {
    method,
    url,
    headers: AUTHED_HEADERS,
  }) as unknown as IncomingMessage;

  let status = 0;
  let text = "";
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader() {},
    end(chunk: string) {
      text = chunk;
    },
  } as unknown as ServerResponse;

  await handleApi(req, res, acceptAny);
  return { status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

let article: ScratchArticle | undefined;
/** The ids the store minted, read back rather than guessed. */
let doomed = "";
let survivor = "";

beforeAll(async () => {
  /* `TEST_OWNER`, because `acceptAny` authenticates as that reader and the
     Postgres reader filters every article by owner — an article seeded as
     anybody else is invisible and the route answers 404, which looks exactly
     like a broken matcher. */
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });

  /* **Two conversations, not one.** With a single thread the reply after a
     successful delete is `{ threads: [] }`, and an empty list is what several
     wrong answers also look like — a handler that never ran, a slug that
     resolved to nothing. A survivor makes the assertion say *this* thread went
     and *that* one did not. */
  await asTestOwner(async () => {
    await chatStore.begin(SLUG, { threadId: "spya-del001", question: "the one that goes" });
    await chatStore.begin(SLUG, { threadId: "spya-del002", question: "the one that stays" });
    const threads = await chatStore.load(SLUG);
    const ids = threads.map((t) => t.id);
    if (ids.length !== 2) throw new Error(`expected two conversations, the store kept ${ids.length}`);
    [doomed, survivor] = ids as [string, string];
  });
}, 60_000);

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

type Thread = Record<string, unknown>;

describe("DELETE /api/chat/:slug/:threadId", () => {
  it("answers with the remaining conversations, resolved rather than pending", async () => {
    const { status, body } = await call("DELETE", `/api/chat/${SLUG}/${doomed}`);
    expect(status).toBe(200);

    /* **This is the assertion the migration is about.** A dropped `await`
       leaves a Promise here, and `JSON.stringify` renders a Promise as `{}` —
       so `threads` would be an object rather than an array, and the request
       would have answered before the deletion finished. Asserting the array
       first, and by name, is what makes the failure message say so. */
    expect(Array.isArray(body.threads), "threads was not an array — a promise was not awaited").toBe(
      true,
    );

    const ids = (body.threads as Thread[]).map((t) => t.id);
    expect(ids).toEqual([survivor]);
  });

  it("really removed it, and not only in the reply", async () => {
    /* The reply is the route's word for it. This is the store's, and the two
       being asserted separately is what stops a handler that answers correctly
       and writes nothing from passing. */
    const kept = await asTestOwner(() => chatStore.load(SLUG));
    expect(kept.map((t) => t.id)).toEqual([survivor]);
  });
});
