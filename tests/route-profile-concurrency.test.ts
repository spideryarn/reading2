/**
 * **The artefact read and the profile read overlap — and the artefact's error
 * still wins, at the moment it always did.**
 *
 * Four artefact routes answer "here it is, and here is whether you have changed
 * since it was written". The second half is `resolveProfile`, two queries of its
 * own, and it used to start only after the artefact read had finished:
 *
 * ```ts
 * const found = await loadGlossary(at);            // …then, and only then:
 * send(res, 200, await withProfileChanged(at, found, found.glossary));
 * ```
 *
 * They are independent, so a reader waiting on a panel was waiting for both in
 * series for no reason. `withProfileChanged` now takes a **thunk** and starts
 * both. docs/plans/library-read-latency.md § 8.
 *
 * ## The four things that can go wrong, and they are what this file is
 *
 * 1. **They do not actually overlap.** A helper that takes a promise instead of
 *    a thunk lets every caller go on awaiting first and hand over something
 *    already settled — and a test of the helper passes anyway. So the check is
 *    that the profile read has *started* while the artefact read is still
 *    outstanding, driven through the real route.
 * 2. **The wrong error surfaces.** `Promise.all` rejects with whichever failed
 *    first, so a reader asking for an article that does not exist could be told
 *    about a profile failure instead. The test makes the profile reject
 *    *sooner* — otherwise it would pass under `all` too, which is exactly the
 *    tautology this repo keeps finding.
 * 3. **The error arrives late.** `Promise.allSettled` picks the right error but
 *    waits for both, so a hanging profile read would hold up a 404 the serial
 *    version answered at once. So one test holds the profile open *forever* and
 *    requires the 404 anyway. GPT Sol's first finding on the built code,
 *    2026-08-28.
 * 4. **A profile failure gets swallowed** into `profileChanged: false`, which
 *    would be a wrong answer nobody could see.
 *
 * **Every one of these runs against all four routes**, not just the one. Sol's
 * second finding: a test of the glossary alone would stay green while `tweets`,
 * `summary` or `ideas` went back to awaiting first.
 *
 * No database and no network: everything below the route is mocked.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashProfile, renderProfile } from "../src/profile.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

/** A promise somebody else decides the fate of. */
function held<T>() {
  let settle!: (value: T) => void;
  let fail!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, settle, fail };
}

/**
 * The routes that answer `profileChanged`, each with the field its stamp
 * lives under. Every test below runs once per row.
 */
const ROUTES = [
  { name: "tweets", url: "/api/tweets/anything", stamp: "thread" },
  { name: "glossary", url: "/api/glossary/anything", stamp: "glossary" },
  { name: "ideas", url: "/api/ideas/anything", stamp: "ideas" },
] as const;

/** What the store was asked, in the order it was asked. */
const asked: string[] = [];

/** What the reader's "about you" says, as the store holds it. */
const PROFILE = "A reader who likes short sentences.";

/**
 * The stamp on the artefact — **computed through the same two functions the
 * route uses**, not written by hand.
 *
 * `resolveProfile` joins the global profile with the article's purpose through
 * `renderProfile`, and it is the *rendered* string that gets hashed. A literal
 * here would make `profileChanged` come back true for a profile that had not
 * changed, and the test would then be asserting the wrong thing about a real
 * mechanism.
 */
const RENDERED = renderProfile({ profile: PROFILE, purpose: null });
if (RENDERED === null) throw new Error("the fixture profile rendered to nothing");
const STAMP = { profileHash: hashProfile(RENDERED) };

/** One gate per route, plus the profile's, all reset before every test. */
let gates: Record<string, ReturnType<typeof held<unknown>>> = {};
let profileGate = held<string | null>();

/** What a route's loader resolves to when its gate is released. */
const payloadFor = (stamp: string) => ({
  [stamp]: STAMP,
  stale: false,
  outdated: false,
  profiled: true,
});

vi.mock("../src/store/index.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/store/index.js")>();
  /* Named separately from the route table above because the mock factory is
     hoisted: it may not close over anything declared with `const` in this
     module, only over what it builds itself. */
  const loaders = {
    loadTweets: "tweets",
    loadGlossary: "glossary",
    loadIdeas: "ideas",
  } as const;
  const mocked: Record<string, unknown> = {};
  for (const [fn, route] of Object.entries(loaders)) {
    mocked[fn] = async () => {
      asked.push(route);
      return gates[route]!.promise;
    };
  }
  return {
    ...actual,
    ...mocked,
    readerStore: {
      ...actual.readerStore,
      readProfile: async () => {
        asked.push("profile");
        return profileGate.promise;
      },
    },
    shelfStore: {
      ...actual.shelfStore,
      read: async () => ({ opens: 0 }),
    },
  };
});

const { handleApi } = await import("../src/routes.js");

async function call(url: string): Promise<{ status: number; body: Record<string, unknown> }> {
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

/** Let every already-queued microtask run, without settling anything. */
const settleQueue = () => new Promise((r) => setTimeout(r, 0));

/** The 404 a missing article throws, as the artefact readers throw it. */
const missing = () =>
  Object.assign(new Error('No article artefacts for "anything".'), { status: 404 });

describe.each(ROUTES)("$name and the reader's profile", ({ name, url, stamp }) => {
  beforeEach(() => {
    asked.length = 0;
    gates = Object.fromEntries(ROUTES.map((r) => [r.name, held<unknown>()]));
    profileGate = held();
  });

  it("asks for the profile while the artefact read is still outstanding", async () => {
    const reply = call(url);

    /* **Nothing released.** If the route awaited the artefact first, the
       profile read would not have been reached at all — which is what this
       assertion is, and it is why the gates are held rather than resolved. A
       mock that resolves instantly cannot tell the two shapes apart. */
    await settleQueue();
    expect(asked).toEqual([name, "profile"]);

    gates[name]!.settle(payloadFor(stamp));
    profileGate.settle(PROFILE);
    const { status, body } = await reply;
    expect(status).toBe(200);
    /* The same profile string the artefact was written under, so nothing has
       changed — proving the two halves were joined and not merely started. */
    expect(body.profileChanged).toBe(false);
    /* And exactly once each. A "probe" read followed by a real one would
       overlap just as well and do twice the work. Sol's second finding. */
    expect(asked).toEqual([name, "profile"]);
  });

  it("answers the article's own 404 without waiting for the profile", async () => {
    /* **Whether the answer has gone out, as a flag rather than an `await`.**
       The obvious way to write this is to await the reply and let a wrong
       implementation hang until vitest's timeout kills it. That does work — it
       is how the `allSettled` version was caught — but a five-second hang is
       slow and says nothing about *why*. Sol's second point on the re-review.
       So the answer is recorded as it arrives and asserted directly, and the
       timeout is left as the backstop rather than the evidence. */
    let answered = false;
    const reply = call(url).then((r) => {
      answered = true;
      return r;
    });
    await settleQueue();

    /* **The profile is never released.** The serial code answered this 404
       without ever reading the profile; `Promise.allSettled` would hold it
       behind a read that has nothing to do with it, and what the reader would
       see is their client giving up. */
    gates[name]!.fail(missing());
    await settleQueue();
    expect({ answeredWithProfileStillOutstanding: answered }).toEqual({
      answeredWithProfileStillOutstanding: true,
    });

    const { status, body } = await reply;
    expect({ status, error: body.error }).toEqual({
      status: 404,
      error: 'No article artefacts for "anything".',
    });

    /* Now let the profile fail, after the answer has already gone out, and let
       the queue drain. If the losing rejection were unattached, vitest reports
       an unhandled rejection here — and note what that looks like, because it
       is not what you would expect: the summary still says "16 passed" and
       "Test Files 1 passed", and only the exit code goes to 1. Verified by
       deleting the `.catch` and running it. */
    profileGate.fail(new Error("the profile store fell over"));
    await settleQueue();
  });

  it("reports the article's own failure, even when the profile fails first", async () => {
    const reply = call(url);
    await settleQueue();

    /* **The profile fails first, deliberately.** Under `Promise.all` this is the
       rejection that would surface, and the reader would be told about their
       profile when what actually happened is that the article does not exist. */
    profileGate.fail(new Error("the profile store fell over"));
    await settleQueue();
    gates[name]!.fail(missing());

    const { status, body } = await reply;
    expect({ status, error: body.error }).toEqual({
      status: 404,
      error: 'No article artefacts for "anything".',
    });
  });

  it("still reports a profile failure when the artefact was fine", async () => {
    /* The other direction, so the rule is not "swallow whatever the profile
       says". A profile that could not be read is not a profile that has not
       changed, and answering `profileChanged: false` to it would be a wrong
       answer nobody could see. */
    const reply = call(url);
    await settleQueue();
    gates[name]!.settle(payloadFor(stamp));
    profileGate.fail(new Error("the profile store fell over"));

    const { status } = await reply;
    expect(status).toBe(500);
  });
});
