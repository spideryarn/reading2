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
 */
import { rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { handleApi } from "../src/routes.js";
import { chatStore } from "../src/store/index.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

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

/** A throwaway slug, so the conversation written below belongs to nobody. */
const SLUG = "test-the-query-string-does-not-decide-the-route";
const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
afterAll(() => rm(DIR, { recursive: true, force: true }));

/* One real conversation, written straight to the store. No model is involved:
   `begin` appends the question and a pending answer, which is all the two
   assertions below need — one turn, and a `messages` array to be missing from
   the summary. */
await chatStore.begin(SLUG, {
  threadId: "spya-qryst1",
  question: "Does the query string route?",
});
/* Read back rather than assumed: the store mints the id it stores, and asserting
   against the one this file asked for would be asserting against a guess. */
const THREAD = (await chatStore.load(SLUG))[0]?.id;
if (THREAD === undefined) throw new Error("the store kept no conversation for this slug");

type Thread = Record<string, unknown>;
const threadsIn = (body: Record<string, unknown>): Thread[] => body.threads as Thread[];

describe("a query string does not decide whether a route exists", () => {
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
