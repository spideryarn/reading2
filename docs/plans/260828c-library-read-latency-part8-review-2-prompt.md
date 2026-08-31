# Second code review: Part 8, after your two findings

You reviewed this yesterday and returned **not ready to commit**, in
`docs/plans/260828c-library-read-latency-part8-review-sol.md`. Both findings were right and both are fixed.
This is the re-review.

## What changed, and what I did to check it rather than believe it

**Your first finding — `allSettled` delays the artefact's own failure.** Correct, and I had the
claim backwards in three places: the code comment, the plan, and `docs/project/reader-profile.md`
all said `allSettled` "preserves exactly the order the serial version had". It preserves the
*identity* of the error and not the *moment*, which is the half that matters to a reader behind a
proxy. I took the shape you proposed verbatim:

```ts
const artefact = load();
const profile = resolveProfile(slug);
void profile.catch(() => {});

const found = await artefact;
const now = await profile;
```

and added the test you asked for: reject the artefact while the profile gate is **never** released,
and require the 404 anyway; then fail the profile afterwards and drain the queue, so an unattached
rejection would show up.

**Your second finding — the test only drove the glossary route.** Also correct. The file now runs
its four cases against all four routes via `describe.each`.

**I then ran the mutations rather than reasoning about them**, in a detached worktree at `HEAD`,
each applied for real and the run observed:

| what was broken | what went red |
| --- | --- |
| the serial shape that was on `main` | `asks for the profile while the artefact read is still outstanding` ×4 — `expected [ 'glossary' ] to deeply equal [ 'glossary', 'profile' ]` |
| one call site pre-awaits and hands over `Promise.resolve(found)` — **the `tweets` route only** | the same test ×1, and it was the `tweets` one. Under the old glossary-only file this mutation was invisible; that is your second finding, demonstrated |
| `Promise.all` | `reports the article's own failure, even when the profile fails first` ×4 — `{ status: 500, error: "the profile store fell over" }` where a 404 was expected |
| **`Promise.allSettled`** — the shape you rejected, which is what I would have committed | `answers the article's own 404 without waiting for the profile` ×4 — it did not assert, it **hung**, and vitest killed each at 5004 ms. Your first finding, demonstrated |
| the profile's rejection swallowed to `null` | `still reports a profile failure when the artefact was fine` ×4 — `expected 200 to be 500` |
| `void profile.catch(() => {})` deleted | **no test failed** — 16 passed, "Test Files 1 passed", 8 unhandled rejections, exit code 1. Only the exit code disagrees, which I have written into the test's comment because it is easy to misread |

Gates: `npm run typecheck` clean across all three projects. `npm test` has 5 failures, all in other
agents' in-flight files (`db-schema-drift`, `doc-links` — 11 links from a plan doc I did not write,
`no-undeclared-spend`, `owner-isolation` — a new `public-slug.ts`). None is in this change.

## What I want from you now

1. **Is the new shape actually right?** Especially: is `void profile.catch(() => {})` enough to keep
   the both-failed case quiet, or does the later `await profile` re-arm anything? Is there an
   ordering in which the profile rejects *between* the `.catch` and the `await` that behaves
   differently?
2. **Does the new 404 test prove what it claims?** It is the only guard against the `allSettled`
   regression, and it proves itself by hanging rather than by asserting, which is a weaker kind of
   evidence than an assertion. Is there a wrong implementation it would pass?
3. **Anything else in the four call sites or the two docs** that is now inconsistent with the code.
4. The one thing I did **not** take from your review: I did not add a "no redundant probe load"
   count beyond `expect(asked).toEqual([name, "profile"])` after the response, because that
   assertion is already exact and would catch a second load. Tell me if that is wrong.

Check each claim against the code. Verdict at the end: **ready to commit** or **not ready to
commit**.

---

## The diff (src/routes.ts — every hunk here is mine; the file is otherwise clean at HEAD)

```diff
diff --git a/src/routes.ts b/src/routes.ts
index 1f1f221..da719e2 100644
--- a/src/routes.ts
+++ b/src/routes.ts
@@ -2494,7 +2494,7 @@ async function jobForSlug(slug: string): Promise<Job | null> {
 }
 
 /**
- * Decorate an artefact response with "your profile changed since this".
+ * An artefact, and whether the reader has changed since it was written.
  *
  * **In the route rather than in the store adapters**, and that placement is not
  * tidiness. Answering it needs the reader's current profile, which lives behind
@@ -2506,9 +2506,6 @@ async function jobForSlug(slug: string): Promise<Job | null> {
  * is what they are for: `stale` and `outdated` are properties of the artefact
  * against the piece, and this one is a property of the artefact against the
  * person.
- */
-/**
- * An artefact, and whether the reader has changed since it was written.
  *
  * ## It takes a thunk, and that is the whole design
  *
@@ -2524,19 +2521,30 @@ async function jobForSlug(slug: string): Promise<Job | null> {
  * Sol's fifth finding on docs/plans/260828c-library-read-latency.md. Taking the thunk
  * moves the responsibility in here, where it can be proved.
  *
- * ## `allSettled`, and why not `all`
+ * ## Why not `Promise.all`, and why not `allSettled` either
+ *
+ * Three shapes were tried, and the two obvious ones are both wrong:
+ *
+ * - **`Promise.all`** rejects with whichever failed *first*, so a reader asking
+ *   for an article that does not exist could be told about a profile failure
+ *   instead of getting a 404. The error would name the wrong thing.
+ * - **`Promise.allSettled`** picks the right error, but it waits for *both*
+ *   before looking at either. A profile read that hangs would then hold up a
+ *   404 that the serial version answered at once, and what the reader would see
+ *   is a client or proxy timeout — a worse failure than the one it fixed. GPT
+ *   Sol's first finding on the built code, 2026-08-28.
  *
- * `Promise.all` rejects with whichever failed *first*, so a reader asking for an
- * article that does not exist could be told about a profile failure instead of
- * getting a 404 — a real change in behaviour, and a confusing one, because the
- * error would name the wrong thing. Settling both and rethrowing the artefact's
- * rejection first preserves exactly the order the serial version had.
+ * So: start both, await the artefact, and await the profile only after the
+ * artefact is in hand. A rejecting artefact throws at the first `await`, as it
+ * always did, and the profile's own rejection still surfaces when the artefact
+ * was fine — because a profile that could not be read is not the same as a
+ * profile that has not changed, and reporting `profileChanged: false` for it
+ * would be a silent wrong answer.
  *
- * The profile's rejection is rethrown after, rather than swallowed: a profile
- * that could not be read is not the same as a profile that has not changed, and
- * reporting `profileChanged: false` for it would be a silent wrong answer.
- * Attaching `allSettled` immediately is also what keeps the losing rejection
- * from surfacing as an unhandled one.
+ * The bare `.catch` is load-bearing rather than decorative. Without it, the
+ * artefact-fails-and-profile-fails-too case throws before anything has ever
+ * looked at the profile promise, and Node reports an unhandled rejection for a
+ * failure we deliberately chose not to report.
  *
  * Starting `resolveProfile` for a slug that turns out not to exist is harmless:
  * its shelf read already catches, and the global half still counts.
@@ -2547,12 +2555,14 @@ async function withProfileChanged<R extends { profileChanged: boolean }>(
   stampOf: (found: Omit<R, "profileChanged">) => { profileHash?: string | null },
 ): Promise<R> {
   /* Both started before either is awaited — that is the point of the thunk. */
-  const settled = await Promise.allSettled([load(), resolveProfile(slug)] as const);
-  const [artefact, profile] = settled;
-  if (artefact.status === "rejected") throw artefact.reason;
-  if (profile.status === "rejected") throw profile.reason;
-  const found = artefact.value as Omit<R, "profileChanged">;
-  const now = profile.value as string | null;
+  const artefact = load();
+  const profile = resolveProfile(slug);
+  /* Handled here so that throwing below cannot leave this one unhandled; the
+     `await` further down is what actually reports it. */
+  void profile.catch(() => {});
+
+  const found = await artefact;
+  const now = await profile;
   return {
     ...found,
     profileChanged: profileIsStale(stampOf(found).profileHash, now ? hashProfile(now) : null),
```

## The test in full (tests/route-profile-concurrency.test.ts, new file)

```ts
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
 * both. docs/plans/260828c-library-read-latency.md § 8.
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
 * The four routes that answer `profileChanged`, each with the field its stamp
 * lives under. Every test below runs once per row.
 */
const ROUTES = [
  { name: "tweets", url: "/api/tweets/anything", stamp: "thread" },
  { name: "glossary", url: "/api/glossary/anything", stamp: "glossary" },
  { name: "summary", url: "/api/summary/anything", stamp: "summaries" },
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
    loadSummaries: "summary",
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
    const reply = call(url);
    await settleQueue();

    /* **The profile is never released.** Under `Promise.allSettled` this test
       does not fail an assertion — it hangs, and vitest kills it on the
       timeout, which is exactly the shape of the bug: the reader's 404 held
       behind a profile read that has nothing to do with it. */
    gates[name]!.fail(missing());
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
```

## Also in this commit

- `docs/plans/260828c-library-read-latency.md` § 8 — rewritten for the corrected shape, with the mutation
  table above.
- `docs/project/reader-profile.md` — a new section "Reading the stamp costs nothing extra, because
  it runs alongside the artefact", plus the test in the file table, plus `ideas` added to the list
  of routes that answer `profileChanged` (it always did; the doc said three).
- `tests/store-shelf-reads.test.ts` — one filter widened from this file's own fixture prefix to
  every `test-` slug. A concurrently-running suite's fixture (`test-reader-state-parity`) has a null
  title, and the test asserted that a row it does not own was still on the shelf between two reads.
  Read that one and tell me whether widening the filter has made the check vacuous; the sibling test
  above it already filtered the same way, for the same reason.

## Ground rules

- Read the repo yourself rather than trusting the summary above.
- Say which claims you could not verify in this environment, and why.
