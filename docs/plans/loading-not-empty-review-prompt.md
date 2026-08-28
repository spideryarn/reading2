# Review: showing a spinner while a fetch is out, instead of an empty state that is wrong

Read-only. Do not edit files. Rank findings by how much damage they would do, and mark each
must-fix / should-fix / note. Say plainly if you find nothing in a section.

## The bug being fixed

Greg, 2026-08-27:

> I tried loading Chat mode on a slow internet connection, and it initially told me there were no
> chats (even though I knew there were)! Then eventually the existing chats loaded and replaced that
> message. Better to show a loading spinner when loading, rather than default to the empty/initial
> state (which is wrong and worrying). This should be true in all other relevant places too.

An empty array means two different things — "you have none" and "we have not asked" — and three
components in this client read it as the first.

## What to read

- `docs/plans/loading-not-empty.md` — the plan, written after the fact, with the survey results.
- The scoped evidence is at
  `/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/fd1806a6-7501-48d6-9973-586046272c7a/scratchpad/loading.diff`
  — read it first for the shape, then read the real files in the repo, which are authoritative.
- `docs/project/web-client.md` § **Empty is not the same as not asked yet** (new section) — the rule
  as written down.
- `src/web/useSlow.ts` — the 600ms threshold and why it exists.
- `src/web/SearchPanel.tsx` around line 620 — the pattern the other panels should match; it already
  had this fix.

**Important caveat about the working tree.** Several other agents are working in this same checkout
and have uncommitted changes in `src/web/ChatPanel.tsx`, `src/web/App.tsx` and `src/web/styles.css`
that are **not mine** — a `kind` field on `ChatThread`, an `onSendNew` prop, dictation work. Ignore
those. The evidence file quotes only my hunks from those three files; `src/web/useComments.ts`,
`src/web/Dock.tsx` and `src/web/ProfilePage.tsx` are mine alone and their whole `git diff` is in
there. There are also pre-existing test failures in this tree from other agents
(`tests/admin-page.test.tsx`, `tests/hover-card-touch.test.tsx`, `tests/doc-links.test.ts`,
`tests/library-log-volume.test.ts`, `tests/store-jobs-parity.test.ts`, `tests/api.test.ts`,
`tests/extraction-inventory.test.ts`) — not mine, please do not report them.

The three fixes:

1. **`src/web/ChatPanel.tsx`** — a third branch `!loaded && threads.length === 0` renders
   `ChatListLoading` instead of `ThreadList`'s "Nothing asked yet." `loaded` was already a prop,
   used for a different purpose.
2. **`src/web/useComments.ts` + `src/web/Dock.tsx` + `src/web/App.tsx`** — `CommentsApi` gains
   `loaded`, set on both the success and the failure path of the one fetch. `Dock`'s `drawer` object
   gains `loaded`, and `Questions` shows `QuestionsLoading` instead of "Nothing asked yet."
3. **`src/web/ProfilePage.tsx`** — `shelf` becomes `LibraryEntry[] | "error" | null`; a failed
   `GET /api/library` no longer becomes `[]`; the footer counts with `Array.isArray(shelf)` rather
   than `shelf !== null`.

Tests: `tests/chat-list-loading.test.tsx`, `tests/dock-questions-loading.test.tsx`,
`tests/profile-shelf-failure.test.tsx` (all new).

## What I most want you to attack

1. **Is the `loaded` flag on `useComments` actually correct across a slug change?** The effect does
   `setComments([])` and `setLoaded(false)` at the top and sets `loaded` in both `.then` and
   `.catch`, guarded by a `live` flag. Walk the interleavings: fast switch between two articles,
   a slow first request landing after a second one was issued, unmount mid-flight. Can `loaded` end
   up true for the wrong slug's fetch, or stuck false for ever? Compare against how `useChat` and
   `useSearch` do the same thing — is there a difference that matters?

2. **The `!loaded && length === 0` shape — is the second half right, or is it hiding a case?**
   In `ChatPanel` the argument for it is that the reader can create a local thread before the fetch
   lands, so `!loaded` alone would draw a spinner over their own conversation. Does the same argument
   hold in `Dock`'s `Questions`, where nothing local can be created? Is `!loaded` alone better there,
   and does it matter? Conversely, is there a state where the list has stale rows from the *previous*
   article and `length > 0` suppresses the spinner while the new article's fetch is out — i.e. does
   the reader see another article's questions with no indication they are stale?

3. **`useSlow(true)` in a component that is mounted and unmounted by the branch above it.** Both
   `ChatListLoading` and `QuestionsLoading` call `useSlow(true)` unconditionally and rely on being
   unmounted when the fetch lands. Is that sound, or does it misbehave on remount (e.g. a panel that
   is toggled shut and open again while the fetch is still out — does the 600ms clock restart, and is
   restarting it right or wrong)?

4. **Layout.** `.chat-loading` and `.dock-loading` render an empty element for the first 600ms so the
   panel does not jump when the spinner appears. Does that actually hold, given the padding and
   `min-height` chosen? Is an empty bordered/padded box worse than `null` here? Would you rather the
   component returned `null` before `slow`?

5. **`ProfilePage`.** Is `Array.isArray(shelf)` used everywhere it needs to be — did I miss a
   consumer that still treats `"error"` as a shelf? Is `"error"` as a sentinel in the state union the
   right call here, or does it want a separate `shelfError` boolean? And the copy: *"Could not reach
   the shelf. It is still there — reload to try again."* — is that honest? It fires on any thrown
   error from `apiFetch`/`readJson`, which includes a 500 and a non-JSON 200, not only a network
   failure.

6. **The tests, hardest.** Each of the three files claims to cover "the two loading states and the
   two states the spinner must not eat". Check that claim. In particular:
   - `tests/profile-shelf-failure.test.tsx` mocks `apiFetch`/`readJson` by smuggling the URL through
     a response header. Is that mock faithful enough to be evidence, or does it paper over something?
     Is `settle()` — three awaited microtask ticks — actually enough, and is it the kind of thing
     that will flake?
   - Are the fake-timer + `act` interactions right in the other two? `useNow` has a real interval in
     `ChatPanel`.
   - Is there an assertion that would still pass if the fix were reverted? (I checked each file
     against the pre-fix condition and watched the loading assertions go red and the guard ones stay
     green, but tell me if a specific assertion is weaker than it looks.)

7. **Did the survey miss anywhere?** A subagent walked every `use*` hook in `src/web/` and their
   consumers and reported that the rest already distinguish the states — `useGlossary`, `useIdeas`,
   `useSimilar`, `useProjection` (status unions); `useSearch`, `useJobs`, `useChat`,
   `useLibrarySearch` (booleans); `useShelf`, `useProfile`, `useAdminUsers` (`null` vs `[]`). Spot
   check a few of those and tell me if any of them is wrong, or if there is a fetching component that
   is not behind a hook at all and was therefore missed. `src/web/Metadata.tsx`, `src/web/Library.tsx`
   and `src/web/AddArticle.tsx` are the likely places.

8. **The doc.** `docs/project/web-client.md` § Empty is not the same as not asked yet. Is the rule
   stated in a way somebody could follow next time without re-deriving it? Is anything in it wrong,
   or missing the case that would bite next?
