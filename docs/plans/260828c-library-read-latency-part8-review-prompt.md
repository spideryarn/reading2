# Code review: Part 8 of library-read-latency — overlapping the profile read with the artefact read

You reviewed the plan for this work (`docs/plans/260828c-library-read-latency.md`) and then the built code.
Both reviews are in the repo:

- `docs/plans/260828c-library-read-latency-review-sol.md` (plan stage)
- `docs/plans/260828c-library-read-latency-code-review-sol.md` (code stage)

Parts 1–7 of that plan are committed (`b688fc6`, `d88b422`). **This review is Part 8 only**, which
was deliberately split out and held back because `src/routes.ts` was carrying another agent's
in-flight work in a shared tree. Your code review's closing paragraph said:

> Splitting Parts 1–7 from the route concurrency change is correct, and the route overlap test
> genuinely proves concurrency.

and your first finding included one typecheck error in this scope:

> Passing nullable `renderProfile(...)` into `hashProfile` in
> `tests/route-profile-concurrency.test.ts:68`.

That error is fixed. `npm run typecheck` is now clean for every file in this change, and
`npx vitest run tests/route-profile-concurrency.test.ts` passes (3 tests).

**What I want from you is a fresh adversarial pass over the final Part 8 code**, not a re-run of the
earlier review. In particular:

1. **Is the concurrency test capable of failing?** It is the only evidence that the two reads
   actually overlap. If reverting `src/routes.ts` to the serial form leaves it green, it is worth
   nothing. Tell me which mutation, if any, it would miss. This project has a specific failure mode
   written up in `docs/reusable/silent-success.md` — a check that passes while the thing it checks
   is broken — and a memory note that async test mocks manufacture green in at least four ways
   (resolve-instantly, reply-time state, issue-order release, objects instead of SQL).
2. **Error semantics.** The serial version awaited the artefact, and only then read the profile. The
   new one starts both. I claim `Promise.allSettled` plus rethrowing the artefact's rejection first
   preserves exactly the old observable behaviour (same error, same status code, same order), and
   that the profile's rejection is rethrown rather than swallowed because "could not read the
   profile" is not "the profile has not changed". Is that airtight? Consider: a slug that does not
   exist; a profile read that rejects while the artefact read also rejects; unhandled rejection
   warnings; and whether any of the four routes can now emit a different status code than before.
3. **The thunk.** I took `() => Promise<T>` rather than a promise or a value, on your fifth
   plan-stage finding, so that the overlap is a property of this function rather than a caller
   convention. Does the type actually enforce that? Can a caller still defeat it?
4. **Anything the four call sites now do differently** that I have not noticed — evaluation order,
   `slugPart` timing, the `send(res, 200, ...)` shape.

Check each claim against the code rather than the prose. If a claim is wrong, say so plainly.

---

## The diff (src/routes.ts, my hunks only)

The file also carries ~370 lines of another agent's uncommitted work on comments and bookmarks;
those hunks are excluded here and are not mine to review or commit.

```diff
diff --git a/src/routes.ts b/src/routes.ts
index 92d5f7d..1f1f221 100644
--- a/src/routes.ts
+++ b/src/routes.ts
@@ -2369,15 +2507,55 @@ async function jobForSlug(slug: string): Promise<Job | null> {
  * against the piece, and this one is a property of the artefact against the
  * person.
  */
+/**
+ * An artefact, and whether the reader has changed since it was written.
+ *
+ * ## It takes a thunk, and that is the whole design
+ *
+ * `resolveProfile` is two queries of its own and has nothing to do with the
+ * artefact read. They used to run one after the other — the route awaited the
+ * artefact, then called this, which then went to the database again — so a
+ * reader waiting on a panel waited for both in series.
+ *
+ * A **thunk** rather than the value, and rather than a promise. A promise
+ * parameter would make the overlap a caller convention: every route could go on
+ * writing `const found = await loadGlossary(at)` and hand over an
+ * already-settled promise, and a test of this function would still pass. GPT
+ * Sol's fifth finding on docs/plans/260828c-library-read-latency.md. Taking the thunk
+ * moves the responsibility in here, where it can be proved.
+ *
+ * ## `allSettled`, and why not `all`
+ *
+ * `Promise.all` rejects with whichever failed *first*, so a reader asking for an
+ * article that does not exist could be told about a profile failure instead of
+ * getting a 404 — a real change in behaviour, and a confusing one, because the
+ * error would name the wrong thing. Settling both and rethrowing the artefact's
+ * rejection first preserves exactly the order the serial version had.
+ *
+ * The profile's rejection is rethrown after, rather than swallowed: a profile
+ * that could not be read is not the same as a profile that has not changed, and
+ * reporting `profileChanged: false` for it would be a silent wrong answer.
+ * Attaching `allSettled` immediately is also what keeps the losing rejection
+ * from surfacing as an unhandled one.
+ *
+ * Starting `resolveProfile` for a slug that turns out not to exist is harmless:
+ * its shelf read already catches, and the global half still counts.
+ */
 async function withProfileChanged<R extends { profileChanged: boolean }>(
   slug: string,
-  found: Omit<R, "profileChanged">,
-  artefact: { profileHash?: string | null },
+  load: () => Promise<Omit<R, "profileChanged">>,
+  stampOf: (found: Omit<R, "profileChanged">) => { profileHash?: string | null },
 ): Promise<R> {
-  const now = await resolveProfile(slug);
+  /* Both started before either is awaited — that is the point of the thunk. */
+  const settled = await Promise.allSettled([load(), resolveProfile(slug)] as const);
+  const [artefact, profile] = settled;
+  if (artefact.status === "rejected") throw artefact.reason;
+  if (profile.status === "rejected") throw profile.reason;
+  const found = artefact.value as Omit<R, "profileChanged">;
+  const now = profile.value as string | null;
   return {
     ...found,
-    profileChanged: profileIsStale(artefact.profileHash, now ? hashProfile(now) : null),
+    profileChanged: profileIsStale(stampOf(found).profileHash, now ? hashProfile(now) : null),
   } as R;
 }
 
@@ -2962,6 +3140,12 @@ async function serveApi(
   const source = /^\/api\/source\/([\w.%-]+)$/.exec(url);
   const comments = /^\/api\/comments\/([\w.%-]+)$/.exec(url);
   const one = /^\/api\/comments\/([\w.%-]+)\/([\w.%-]+)$/.exec(url);
+  /* Answering is its own sub-path rather than a field on the POST, because it
+     is the one thing a comment can do that spends money and streams. **There is
+     deliberately no route for linking a comment to its conversation**: the only
+     place that knows the real thread id is the chat stream itself, so the link
+     is written there. See docs/plans/260828a-comments-and-bookmarks.md. */
+  const commentAnswer = /^\/api\/comments\/([\w.%-]+)\/([\w.%-]+)\/answer$/.exec(url);
   const chat = /^\/api\/chat\/([\w.%-]+)$/.exec(url);
   const oneThread = /^\/api\/chat\/([\w.%-]+)\/([\w.%-]+)$/.exec(url);
   const chatStop = /^\/api\/chat\/([\w.%-]+)\/([\w.%-]+)\/stop$/.exec(url);
@@ -3136,16 +3320,14 @@ async function serveApi(
     if (tweets && req.method === "GET") {
       {
         const at = slugPart(tweets, 1);
-        const found = await loadTweets(at);
-        send(res, 200, await withProfileChanged<ThreadResponse>(at, found, found.thread));
+        send(res, 200, await withProfileChanged<ThreadResponse>(at, () => loadTweets(at), (found) => found.thread));
       }
       return true;
     }
     if (glossary && req.method === "GET") {
       {
         const at = slugPart(glossary, 1);
-        const found = await loadGlossary(at);
-        send(res, 200, await withProfileChanged<GlossaryResponse>(at, found, found.glossary));
+        send(res, 200, await withProfileChanged<GlossaryResponse>(at, () => loadGlossary(at), (found) => found.glossary));
       }
       return true;
     }
@@ -3172,16 +3354,14 @@ async function serveApi(
     if (summary && req.method === "GET") {
       {
         const at = slugPart(summary, 1);
-        const found = await loadSummaries(at);
-        send(res, 200, await withProfileChanged<SummariesResponse>(at, found, found.summaries));
+        send(res, 200, await withProfileChanged<SummariesResponse>(at, () => loadSummaries(at), (found) => found.summaries));
       }
       return true;
     }
     if (ideas && req.method === "GET") {
       {
         const at = slugPart(ideas, 1);
-        const found = await loadIdeas(at);
-        send(res, 200, await withProfileChanged<IdeasResponse>(at, found, found.ideas));
+        send(res, 200, await withProfileChanged<IdeasResponse>(at, () => loadIdeas(at), (found) => found.ideas));
       }
       return true;
     }
```

## The test (tests/route-profile-concurrency.test.ts, new file, untracked)

```ts
/**
 * **The artefact read and the profile read now overlap — and the 404 still wins.**
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
 * ## The two things that can go wrong, and they are what this file is
 *
 * 1. **They do not actually overlap.** A helper that takes a promise instead of
 *    a thunk lets every caller go on awaiting first and hand over something
 *    already settled — and a test of the helper passes anyway. So the check is
 *    that the profile read has *started* while the artefact read is still
 *    outstanding, driven through the real route.
 * 2. **The wrong error surfaces.** `Promise.all` rejects with whichever failed
 *    first, so a reader asking for an article that does not exist could be told
 *    about a profile failure instead. That is `Promise.allSettled` plus
 *    rethrowing the artefact's rejection first, and the test makes the profile
 *    reject *sooner* — otherwise it would pass under `all` too, which is
 *    exactly the tautology this repo keeps finding.
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
const glossary = { entries: [], profileHash: hashProfile(RENDERED) };
let glossaryGate = held<{ glossary: typeof glossary; stale: boolean; outdated: boolean; profiled: boolean }>();
let profileGate = held<string | null>();

vi.mock("../src/store/index.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/store/index.js")>();
  return {
    ...actual,
    loadGlossary: async () => {
      asked.push("glossary");
      return glossaryGate.promise;
    },
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

describe("an artefact route and the reader's profile", () => {
  beforeEach(() => {
    asked.length = 0;
    glossaryGate = held();
    profileGate = held();
  });

  it("asks for the profile while the artefact read is still outstanding", async () => {
    const reply = call("/api/glossary/anything");

    /* **Nothing released.** If the route awaited the artefact first, the
       profile read would not have been reached at all — which is what this
       assertion is, and it is why the gates are held rather than resolved. A
       mock that resolves instantly cannot tell the two shapes apart. */
    await settleQueue();
    expect(asked).toEqual(["glossary", "profile"]);

    glossaryGate.settle({ glossary, stale: false, outdated: false, profiled: true });
    profileGate.settle(PROFILE);
    const { status, body } = await reply;
    expect(status).toBe(200);
    /* The same profile string the artefact was written under, so nothing has
       changed — proving the two halves were joined and not merely started. */
    expect(body.profileChanged).toBe(false);
  });

  it("reports the article's own failure, even when the profile fails first", async () => {
    const reply = call("/api/glossary/anything");
    await settleQueue();

    /* **The profile fails first, deliberately.** Under `Promise.all` this is the
       rejection that would surface, and the reader would be told about their
       profile when what actually happened is that the article does not exist.
       Under `allSettled` with the artefact rethrown first, the 404 wins. */
    profileGate.fail(new Error("the profile store fell over"));
    await settleQueue();
    glossaryGate.fail(Object.assign(new Error('No article artefacts for "anything".'), { status: 404 }));

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
    const reply = call("/api/glossary/anything");
    await settleQueue();
    glossaryGate.settle({ glossary, stale: false, outdated: false, profiled: true });
    profileGate.fail(new Error("the profile store fell over"));

    const { status } = await reply;
    expect(status).toBe(500);
  });
});
```

## Ground rules

- Read the repo yourself: `src/routes.ts`, `src/profile.ts` (or wherever `resolveProfile`,
  `hashProfile`, `profileIsStale`, `renderProfile` live), and the four `load*` functions.
- The verdict I need at the end is one of **ready to commit** or **not ready to commit**, with the
  must-fixes ranked first.
- If you cannot verify something in this environment, say which and why, rather than assuming.
