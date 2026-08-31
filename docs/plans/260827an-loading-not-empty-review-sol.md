## Findings

1. **must-fix — Failed fetches still render the false empty state.** `useComments` sets both `error` and `loaded = true` on failure ([useComments.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useComments.ts:146)), after which `Questions` falls through to “Nothing asked yet” ([Dock.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Dock.tsx:826)). The error is not passed into the drawer; it sits behind the drawer’s scrim in the controls bar.

   Chat and Search have the same missed fourth state: each displays its error, sets `loaded = true`, and then also renders its empty claim ([ChatPanel.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ChatPanel.tsx:361), [SearchPanel.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/SearchPanel.tsx:630)). This is the reported bug again, on failure rather than delay. A `loading | ready | error` load outcome, distinct from mutation errors, would close it cleanly.

2. **must-fix — The new profile test fails the required typecheck.** `ARTICLE` omits required `LibraryEntry` fields such as `words`, `minutes`, `blocks`, `parts`, `sections`, `comments`, `opens`, and `has` ([profile-shelf-failure.test.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/profile-shelf-failure.test.tsx:50), [types.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:986)). Vitest transpiles past this, but direct `tsc` reports TS2740.

3. **should-fix — The shelf failure copy promises more than is known.** [ProfilePage.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ProfilePage.tsx:237) says “Could not reach” and “It is still there” for every exception, including HTTP 500 and malformed successful responses from `readJson`. “Couldn’t load your shelf. Reload to try again.” would be honest.

4. **should-fix — The questions tests do not test the newly added state lifecycle.** They pass `comments` and `loaded` directly to `Dock` ([dock-questions-loading.test.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/dock-questions-loading.test.tsx:40)). They would not catch `useComments` staying false after success/failure, a stale response winning, or incorrect App wiring. This also explains why finding 1 passes. Add a hook/integration test using deferred A/B requests and a rejected request.

5. **should-fix — The canonical rule overclaims and misses the important gate.** The doc says every fetch needs a third state and every waiting state uses `useSlow` ([web-client.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/web-client.md:411)). That is too broad, and contradicted by the immediate Search spinner and immediate Profile text. More importantly, it says error prevents an empty claim although Chat, Search, and Questions do not enforce that. The actionable rule should be: an empty claim requires a successfully completed collection fetch. The plan also says “five of each,” but the files contain 5, 5, and 4 tests ([260827an-loading-not-empty.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827an-loading-not-empty.md:69)).

## Requested checks

1. **`useComments` slug interleavings:** no defect in the GET lifecycle. Cleanup makes the prior `live` false; late A responses cannot settle B, failure and success both finish B, and unmount responses are ignored. It is stronger than `useChat`’s shared `showing` ref under StrictMode and matches `useSearch`. `Reader` is also keyed by slug, providing a fresh hook instance.

2. **`!loaded && length === 0`:** justified for Chat because a local thread can exist before loading completes. Dock has no legitimate equivalent; `!loaded` alone is clearer and more defensive. Current previous-article rows cannot survive because `Reader` remounts per slug.

3. **`useSlow(true)` remounting:** sound. Closing and reopening restarts the visible 600ms wait. That avoids flashing a spinner if the request completes just after reopening.

4. **Layout:** nothing wrong found. Neither placeholder is bordered. The empty element preserves the spinner row’s space; this matters particularly for the bottom-anchored drawer. Returning `null` would make that drawer expand when the spinner appears.

5. **Profile state:** all shelf consumers handle `"error"` correctly. The sentinel is consistent with `models` and preferable to another loosely coupled boolean. Only the copy is wrong. Its initial loading text also bypasses the newly documented `useSlow`/spinner rule, so either code or rule needs an explicit exception.

6. **Tests:** fake-timer usage is correct. `useNow`’s minute interval does not fire during the 601ms advance and is cleaned up. The response-header mock is adequate for component branching, but does not prove real `apiFetch`/`readJson` failure variants. Three microtask ticks are deterministic today but implementation-coupled; the footer’s negative-only failure assertion could pass if settlement broke, so pair it with a positive terminal-state assertion.

7. **Survey:** the failure-state miss in finding 1 invalidates “the rest already distinguish the states.” Spot checks of Library, Metadata, Tweets, AddArticle, `useShelf`, and `useLibrarySearch` found no additional false empty state. AddArticle is blank while job history loads, but makes no false claim.

8. **Doc:** finding 5 is the substantive problem; otherwise the intent and examples are clear.

Verification: all 14 scoped Vitest tests passed. No files were edited. The normal typecheck wrapper could not create its IPC socket in this sandbox; direct `tsc` exposed finding 2, alongside unrelated shared-tree errors.