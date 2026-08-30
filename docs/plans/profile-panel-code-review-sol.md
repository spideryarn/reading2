STOP. Three correctness defects remain.

1. Blocker — the “always fresh” purpose can be served stale from IndexedDB.

`/api/reader` is explicitly cacheable, and the complete response is stored ([api.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/lib/api.ts:413), [api.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/lib/api.ts:494)). But editing a purpose PATCHes `/api/library/<slug>` ([Metadata.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Metadata.tsx:348)), which invalidates only that prefix—not `/api/reader?slug=<slug>`.

Concrete sequence:

1. Read article A online; `useHasProfile` caches A’s old purpose.
2. Edit A’s purpose successfully.
3. Lose the connection before another reader GET.
4. Return to A and open the panel.
5. `apiFetch` supplies the old cached body as a synthetic 200; the panel presents it as current.

This is precisely the stale cache the rewritten plan says was avoided. The reader-cache entry is also marked as global (`slugOf` returns `""` for `/api/reader`), so article eviction will not remove it ([api.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/lib/api.ts:465)).

2. Blocker — a failed purpose read is reported as “you never wrote one.”

`resolveProfileParts` catches every shelf error and substitutes an empty shelf ([routes.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:2832)). That policy was defensible for prompt generation: the global profile can still be used. It is wrong for an inspection panel.

Concrete sequence:

1. The global profile query succeeds.
2. The valid article’s shelf query fails—corrupt file, database failure, timeout.
3. The route answers 200 with `purpose: null`.
4. The panel says “You haven't said why you're reading this one.”

The panel’s failure state only covers rejection of the entire request ([ProfilePanel.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ProfilePanel.tsx:195)). The failure test mocks exactly that and therefore passes against this real partial-failure bug.

3. High — `live` does not protect the StrictMode double request.

The app mounts under `StrictMode`, but the test does not. The development sequence is:

1. Effect A sets `live=true` and starts request A.
2. StrictMode cleanup sets it false.
3. Effect B sets the same ref back to true and starts request B.
4. B returns and renders the newer value.
5. A returns later, sees `live=true`, and overwrites B.

The guard at [ProfilePanel.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ProfilePanel.tsx:193) protects a genuine unmount, not effect generations. It also guarantees two requests per opening in development. A generation number or abort signal is required.

4. Medium — the strings are already fetched eagerly, contrary to the design justification.

All five `useHasProfile` call sites request `/api/reader?slug=` and discard everything except `hasProfile` ([useProfile.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useProfile.ts:210)). Now that the route includes both strings, every mounted caller downloads and caches them. Opening the panel adds another request; it does not make the text on-demand.

I found no cross-reader leak: the route is authenticated, Postgres reads are owner-filtered, public components do not mount these hooks, and offline entries are partitioned by user and removed on sign-out.

5. Low — dirty whitespace purpose produces contradictory UI.

Both shelf readers can return a legacy whitespace-only value. `renderProfile` normalises it away, so `hasProfile` is false, but the route returns the raw spaces and `PanelBody` treats the truthy string as content. The result is a blank box instead of the empty-state sentence.

Other attacked areas:

- The new and old `hasProfile` calculations otherwise agree for valid/invalid slugs, missing articles, shelf failures, and normal stored values. Removing the duplicate profile read improves consistency.
- Ordinary interaction does not leave two panels open: another pointer press triggers outside dismissal, and tabbing away triggers focus-out dismissal. No central owner is needed for the read-only version.
- The badge’s tab count is unchanged; the old span already had `tabIndex=0`. No missed `.prof-use`, `.prof-badge`, sibling, or `:has()` selector turned up.
- The three hook-owned slugs are returned from their current hook arguments, and `OwnedArticle` is keyed by slug. I found no visitor arm or navigation mismatch.
- `location.search` is effectively refreshed because the subscribed reader parent re-renders when query state changes.

Test assessment: the reachability and disabled-trigger tests genuinely cover their named structural regressions. The failure test misses partial shelf failure; the refetch test misses StrictMode, response ordering, authentication delay, and the real offline cache. Its one-microtask helper works only because the entire API module is mocked with an immediate response. Dispatching Escape on `document` exercises Floating UI’s listener, but it bypasses real window capture handlers and never asserts the claimed focus restoration.

The targeted suite still passes: 5/5.