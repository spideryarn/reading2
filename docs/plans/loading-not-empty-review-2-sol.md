One must-fix, two should-fixes, and one note.

1. **must-fix — `useChat` confuses two StrictMode fetches for the same slug.** The guard distinguishes slugs, not effect invocations ([useChat.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:580), [useChat.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:617)). The app mounts under `StrictMode`.

   Exact failure:

   1. StrictMode setup A starts fetch A.
   2. Its simulated cleanup does nothing; setup B starts fetch B for the same slug.
   3. B succeeds empty, setting `loadFailed=false`, `loaded=true`.
   4. A then fails. `showing.current === mine` because both slugs match, so A sets the error and returns `false`.
   5. A’s continuation sets `loadFailed=true`; the panel now says it could not load despite B succeeding.

   With populated B data, the list wins because `threads.length > 0`, but the stale transport error still appears. A fast change to a different slug is safe: the captured-slug guard rejects A, and `Reader` is keyed by slug. The bug is specifically concurrent same-slug invocations.

2. **should-fix — the most delicate new paths remain untested.** The new hook test covers `useComments`, but nothing tests `useChat`’s boolean-returning `refresh`, StrictMode duplication, `useSearch.loadFailed`, Search’s failure branch, or its delayed indicator. This is why finding 1 passes all current tests. The plan overstates coverage when it says each panel file covers all five states ([loading-not-empty.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/loading-not-empty.md:107)).

3. **should-fix — the delayed indicators lack accessible status semantics, and Search still jumps.** `SavedLoading` inserts its words after 600ms into an ordinary element, with no `role="status"`, `aria-live`, or `aria-busy` ([SearchPanel.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/SearchPanel.tsx:615)). Its empty `<p>` has no minimum height, so the text still increases the panel height at 600ms ([styles.css](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:4771)). The wrapper preserves padding, not the line.

   The profile NBSP does preserve line height ([ProfilePage.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ProfilePage.tsx:241)). I would not claim it is spoken badly by screen readers; the stronger problem is that neither waiting state is expressed semantically. Prefer reserved CSS height plus busy/status semantics.

4. **note — one canonical-doc claim is inaccurate.** It says `error` is cleared when a later request succeeds ([web-client.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/web-client.md:436)). `useChat` never clears it, while Comments and Search clear it when starting a retry, not after success.

Clean sections:

- Every `refresh` return is otherwise correct: stale slug `false`; `body.error` and throws `false`; concurrent per-thread writer `true`; missing server thread `true` after removing it. Only the mount caller reads the boolean.
- `useComments` and `useSearch` slug changes, unmounts, and `live` guards are clean. Mutation operations do not alter `loadFailed`.
- All four panel branch orders are sound; no empty list accidentally falls into an empty list renderer.
- All required call sites are wired. `loadFailed={false}` is correct for the populated preview.
- The new Comments test faithfully tests the hook layer. Stubbing `apiFetch` appropriately excludes offline/auth behaviour; cached offline data would simply arrive as a successful response. The late-answer test genuinely exercises cleanup. Three microtask ticks are implementation-coupled but currently deterministic.
- Failure copy and the completed `LibraryEntry` fixture are clean.

Verification: 45 focused tests passed. The web TypeScript project passes. The wrapper was blocked by its sandbox IPC socket; direct checking found no scoped-file type errors. No files were edited.