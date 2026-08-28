## Findings

1. **Must-fix — `allSettled` changes the artefact-failure path and can turn a 404 into a hung request.**

[`withProfileChanged`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:2550) waits for both operations before inspecting either result. Previously, an artefact rejection returned immediately and the profile read never began.

Now, if the artefact returns 404 but `readerStore.readProfile()` is slow or never settles, the route delays or never emits that 404. A proxy or client timeout could therefore become the observable status. The shelf catch in [`resolveProfile`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:2700) does not protect against the global profile read hanging.

The selected error is otherwise correct once both promises settle:

- Both reject: the artefact error wins.
- Only the artefact rejects: its error and status win.
- Only the profile rejects: its error is rethrown.
- Both fulfil: response remains 200.

There are no unhandled-rejection warnings: `allSettled` attaches handlers immediately. When both reject, the profile error is handled but deliberately suppressed, not rethrown—that matches the serial error priority.

You can preserve concurrency, immediate artefact failure, and rejection handling with this shape:

```ts
const artefact = load();
const profile = resolveProfile(slug);
void profile.catch(() => {});

const found = await artefact;
const now = await profile;
```

Add a test where the artefact rejects while the profile gate remains held, and require the 404 response before releasing the profile. Then reject the profile afterward to prove it was already handled.

2. **Should-fix — the thunk type encourages concurrency but does not enforce it.**

The signature rejects a value or bare promise, but this still compiles and serializes the route:

```ts
const found = await loadTweets(at);
await withProfileChanged(at, () => Promise.resolve(found), (value) => value.thread);
```

The four current call sites are correct: each directly invokes its loader inside the thunk at [`src/routes.ts:3320`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:3320). But the test exercises only the glossary route, so the serialization mutation above in tweets, summaries, or ideas would remain green.

The test would also miss a redundant “probe” load followed by a second serial load because it never reasserts `asked` after the response. A final exact call-count assertion would close that hole.

## Concurrency-test verdict

Yes, it is capable of failing on the important serial-helper mutation. With:

```ts
const found = await load();
const now = await resolveProfile(slug);
```

the assertion at [`tests/route-profile-concurrency.test.ts:137`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/route-profile-concurrency.test.ts:137) observes only `["glossary"]`, because the held artefact promise has not been released. It cannot manufacture green through immediate resolution, reply-time state, or release ordering.

I freshly ran the unchanged test: all 3 tests passed. I could not execute the transformed serial mutation itself because the read-only sandbox refused Vitest’s temporary SSR directory; the failure above follows directly from the held gate and pre-release assertion.

## Call-site audit

No present call-site defect found:

- `slugPart` still runs once before either read.
- JavaScript evaluates `load()` before `resolveProfile(slug)`, preserving artefact-first invocation.
- All four real loaders are async and all four thunks start fresh work.
- The same nested artefacts provide the stamp: `thread`, `glossary`, `summaries`, and `ideas`.
- `send(res, 200, …)` and the returned object shape are unchanged.
- Stamp lookup moved from before profile resolution to afterward. That is harmless for the plain store objects, though it would differ for a mutable object or getter.
- The adjacent duplicate JSDoc blocks at [`src/routes.ts:2500`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:2500) are only a cleanup nit.

Test TypeScript compilation is clean. Direct root compilation reported only unrelated errors in `evals/dictation/bench-vocabulary-sources.ts`.

**Verdict: not ready to commit.**