/**
 * A query string must not decide whether a route exists.
 *
 * `serveApi` computes `path` — `req.url` up to the first `?` — and hands it, the
 * parsed `query` and the raw URL down to the dispatcher. Every route pattern is
 * `$`-anchored and its slug class `[\w.%-]+` excludes `?`, so a matcher run
 * against the raw URL cannot match once a query string is present. It does not
 * mis-route; it stops routing at all, and the request falls through to the
 * catch-all 404.
 *
 * That is what happened to `GET /api/chat/<slug>?summary=1` — the reading view's
 * only call for which conversations are anchored to which passage. The handler
 * for it was written, commented and shipped; the matcher above it was run against
 * the raw URL, so the branch was never once reached, for five days.
 * docs/postmortems/260901a-the-route-the-query-string-hid.md.
 *
 * **The pair of cases below is the point.** The same list is asked for twice,
 * with and without `?summary=1`, against a thread that really exists — so the
 * query string is the only difference between them, and the two answers must
 * differ in exactly the way the handler says they do. An earlier version of this
 * file asked only about an absent slug, where both branches answer
 * `{ threads: [] }`; GPT Sol pointed out that deleting the `summary` branch
 * outright would have left it green.
 *
 * ## It ran on the filesystem store until 2026-09-04
 *
 * The thread that *really exists* used to be a `chat.json` under a throwaway
 * `data/<slug>/`, written by a `chatStore` the flag had left pointing at the
 * filesystem — so the branch this file was written to prove was being proved
 * against the store that is not deployed
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § B). It now pins `postgres` before any import and seeds a real article with
 * `scratchArticleInPg`.
 *
 * **`summarise` is a projection either way** — it takes the loaded threads and
 * drops their transcripts — so what moved is not that half of the branch but
 * the sentence under it. On files, *a thread that really exists* meant a JSON
 * file this suite had just written, and the list route would answer 200 for a
 * slug no article had ever been published under. Under Postgres it means rows
 * that exist only because the article, its current revision and the requesting
 * owner all line up, which is the condition the shipped route is under.
 *
 * ## The mutations, watched rather than reasoned — 2026-09-04
 *
 * Stage B asks each converted file for evidence it can still go red, and for
 * what that red does not reach. Two were run here.
 *
 * **Mutation.** 1 — the subject of the file, and it went red. `src/routes.ts` §
 * `serveApi`: `const path = url.split("?")[0] ?? url;` made `const path = url;`,
 * which is the postmortem's bug put back. **2 failed of 4** — *reaches the
 * summaries branch when it carries ?summary=1* and *ignores a query string
 * nothing reads*, both on `expected 'No API route for GET /api/chat/test-t…'
 * not to match /^No API route for/`. The two that stayed green are the control
 * pair: the no-query-string case, and the `STORE` check.
 *
 * **Mutation.** 2 — the Postgres-only half of the sentence above, and it
 * STAYED GREEN. `src/store/owned-slug.ts` § `ownedSlug`: `return
 * and(eq(articles.slug, slug), eq(articles.ownerId, ownerId ??
 * currentOwnerId()));` made `return
 * and(eq(articles.slug, slug));` — the owner term deleted from the one
 * sanctioned article lookup. **4 passed of 4.** The reason is the seeding: this
 * file makes exactly one article, owns it as `TEST_OWNER`, and asks for it as
 * `TEST_OWNER` through `acceptAny`. A predicate that has narrowed to one row
 * anyway cannot be caught narrowing it for the wrong reason. So *rows that
 * exist only because … the requesting owner line up* is true of the store and
 * **is not tested here**; tests/owner-isolation.test.ts is where it is held.
 *
 * **Blind to.** Mutation 1 says nothing about the other half of the same split
 * (`query`, parsed from `url.slice(path.length)`): breaking that makes
 * `?summary=1` an unreachable *branch* rather than an unreachable *route*,
 * which this file would catch on the `messages` assertion but for a different
 * reason than it claims. It says nothing about the three other route families
 * that read a query string.
 *
 * **Blind to.** Mutation 2 reaches only the owner term; `threadsFor`'s own
 * `articleId` scoping — the predicate that stops one article's conversations
 * appearing under another — is untouched by both, and with one seeded article
 * this file could not see it move.
 *
 * **And the same run corrects the sentence.** `chatStore.load` reaches the
 * article through `articleIdForOwned`, which predicates on `ownedSlug` **alone**
 * — `onTheShelf`, the *has a published revision* rule, is not in this path at
 * all. So "its current revision" above is wrong about which predicate does the
 * work, and nothing here could have told you.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `SPIDERYARN_STORE=postgres`, before **any** import runs — `src/store/live.ts`
 * reads the flag once and imports are hoisted above every statement. Copied
 * from tests/candidates-route.test.ts, which explains the shape.
 */
const PREVIOUS_STORE_FLAG = vi.hoisted(() => {
  const previous = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return previous;
});

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

/** A throwaway slug, so the conversation written below belongs to nobody. */
const SLUG = "test-the-query-string-does-not-decide-the-route";

const { reachable } = await pgReady({
  suite: "tests/the-query-string-does-not-decide-the-route.test.ts",
  tables: ["spideryarn.chat_threads", "spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");
const { chatStore, STORE } = await import("../src/store/index.js");

if (PREVIOUS_STORE_FLAG === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = PREVIOUS_STORE_FLAG;

const when = reachable ? describe : describe.skip;

describe("the store these tests are actually talking to", () => {
  it("is the Postgres one", () => {
    /* Not gated on the database being up, deliberately: a control that vanishes
       when Postgres is missing is a control that vanishes exactly when it
       matters. A flag that failed to take looks precisely like this suite
       working — the filesystem chat store answers both branches happily for a
       slug that is not an article at all. */
    expect(STORE).toBe("postgres");
  });
});

/** Drive `handleApi` with a fake GET, and give back the status and parsed body. */
async function get(url: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = Object.assign(
    (async function* () {})(),
    { method: "GET", url, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;

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

/**
 * The catch-all at the bottom of the dispatcher, which is the failure this is
 * about. Asserting on the *message* rather than on the status matters: a route
 * that matched can legitimately answer 404 because the article is not there, and
 * a test that only counted statuses could not tell the two apart.
 */
const NO_ROUTE = /^No API route for/;

let article: ScratchArticle | undefined;
/** The id the store minted, read back rather than guessed. */
let THREAD = "";

beforeAll(async () => {
  if (!reachable) return;
  /* `TEST_OWNER`, because `acceptAny` authenticates as that reader and the
     Postgres reader filters every article by owner — an article seeded as
     anybody else is invisible and both routes below answer 404, which looks
     exactly like the bug this file is about. `ScratchOptions.ownerId`. */
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  /* One real conversation, written straight to the store. No model is involved:
     `begin` appends the question and a pending answer, which is all the two
     assertions below need — one turn, and a `messages` array to be missing from
     the summary. Under Postgres it needs the article row above to hang off. */
  await asTestOwner(async () => {
    await chatStore.begin(SLUG, {
      threadId: "spya-qryst1",
      question: "Does the query string route?",
    });
    /* Read back rather than assumed: the store mints the id it stores, and
       asserting against the one this file asked for would be asserting against
       a guess. */
    const id = (await chatStore.load(SLUG))[0]?.id;
    if (id === undefined) throw new Error("the store kept no conversation for this slug");
    THREAD = id;
  });
}, 60_000);

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

type Thread = Record<string, unknown>;
const threadsIn = (body: Record<string, unknown>): Thread[] => body.threads as Thread[];

when("a query string does not decide whether a route exists", () => {
  it("answers the chat list when the URL carries no query string", async () => {
    const { status, body } = await get(`/api/chat/${SLUG}`);
    expect(status).toBe(200);
    const [thread] = threadsIn(body);
    expect(thread?.id).toBe(THREAD);
    // The full list, which is what makes the summary below a difference.
    expect(thread).toHaveProperty("messages");
  });

  it("reaches the summaries branch when it carries ?summary=1", async () => {
    const { status, body } = await get(`/api/chat/${SLUG}?summary=1`);
    expect(String(body.error ?? "")).not.toMatch(NO_ROUTE);
    expect(status).toBe(200);
    const [thread] = threadsIn(body);
    expect(thread?.id).toBe(THREAD);
    /* `summarise` drops the transcript and counts the questions instead. Both
       halves are asserted: the branch is only proven by what is *missing*. */
    expect(thread).not.toHaveProperty("messages");
    expect(thread?.turns).toBe(1);
  });

  it("ignores a query string nothing reads", async () => {
    const { status, body } = await get(`/api/chat/${SLUG}?whatever=1`);
    expect(String(body.error ?? "")).not.toMatch(NO_ROUTE);
    expect(status).toBe(200);
    // Unrecognised parameters are ignored, not refused — see `ApiRequest`.
    expect(threadsIn(body)[0]).toHaveProperty("messages");
  });
});
