# A new wire field is checked only where the fixtures are typed

Up: [postmortems.md](../project/postmortems.md) · change: [plan 261008j](../plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md)

Two tests in `tests/dock-corner-controls.test.tsx` went red on `dev` with "shelf.topics undefined" in
`PublicShelfTopics.tsx`, after a push whose typecheck was green. Another agent found it on merging
`dev`; the Overseer reported it. No reader was affected.

## Root cause

Commit `d02837c32` made `topics: PublicShelfTopic[]` a **required** field of `PublicLibrary` (the wire
answer of `GET /api/public/library`) and added a client component whose `publicTerms(shelf)` reads
`shelf.topics.map(...)`. Typecheck did its job for every fixture typed as `PublicLibrary` or
`PublicLibraryEntry`; those three test files were fixed. But the dock test mocks the endpoint with an
untyped literal, `json({ entries: [], truncated: false })`, and `json()` takes `unknown`. The compiler
could not see that fixture, so it kept the old shape. `tests/public-showcase.test.tsx` has the same
literal; it passes only because it never renders the pills.

Underneath: the wire type is a promise about the server, but the tests fake the server through a seam
(`unknown`) that the type cannot cross. And the second reader of the shape is not a test at all: a
browser tab open across the deploy, or a cached answer, really does hold the previous shape.

## The class

**A required field added to a wire type while untyped fixtures and old peers still carry the previous
shape, so the compiler's green covers only the typed half.** A cousin of
[silent success](../reusable/silent-success.md): the obvious check agrees because it shares the
code's assumption that the type is the whole truth.

The process half: the author ran targeted suites plus typecheck. The full `npm test` was started and
stopped before it finished, to unblock a peer waiting on a migration in the same push.

## Fix

Shipped in `0142412b2`: the fixture carries `topics: []`, and `publicTerms` reads `shelf.topics ?? []`
and `e.topics ?? []`. A page test pins it ("treats an answer from a server older than the pills as
having none", `tests/public-shelf-page.test.tsx`). The tolerant read is the right long-term shape for
a wire field, since the two ends never deploy together. The fixture fix alone would have been a patch.

## What would have caught it, ranked by ease against value

1. **Run the full `npm test` before pushing**, and when it must be cut short, say so in the push and
   name what did not run. Costs nothing; it would have caught this exact failure.
2. **On the reading side, treat a new wire field as optional until both ends have shipped** (`?? []`
   at the read, plus a test with the field absent). Done here. This defends against the real old
   client or server, which no fixture fix can.
3. **A typed helper for mocking a route's answer**, e.g. `mockApi<"/api/public/library">(...)`, keyed to
   the response type, so a fixture cannot be untyped. Nothing like it exists in `tests/helpers`. Worth
   it if a second case turns up; the endpoints are many and each needs a route-to-type map.
4. **Grep for other mocks of the endpoint when you change its type** (`grep -rn "api/public/library"
   tests`). Cheap but relies on remembering; it is item 1 done by hand.
5. Generated wire types with runtime validation (zod) at the client edge: rejected. It adds a
   dependency and a parse on every response for a gap that item 2 closes at one line per field.
