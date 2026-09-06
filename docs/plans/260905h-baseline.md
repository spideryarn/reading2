# Behavioural baseline for 260905h

Base SHA: `6eecb377f24d92446086a006d5b3103daae40aef` (worktree
`a2-mode-failure-containment`, branch `worktree-a2-mode-failure-containment`). No source, test or
doc file other than this one was touched to produce it. Date: 2026-09-05. Machine: `/home/greg/` —
the Hetzner box. Each file below was run alone (`npx vitest run <path> --reporter=dot`), not as a
batch.

## Test files run

| file | tests | result | notes |
| --- | --- | --- | --- |
| tests/public-network-trace.test.tsx | 60 | pass | one benign stderr line (`[api] 204 (no url)`) from a test that presses "?" twice |
| tests/modes-that-start-themselves.test.tsx | 21 | pass | |
| tests/passage-mode-cleanup.test.tsx | 4 | pass | benign stderr 404 traces — the test deliberately leaves a passage-mode artefact unbuilt |
| tests/access-sharing.test.tsx | 40 | pass | benign stderr 500 traces — the test deliberately simulates failed writes |
| tests/glossary-band-selection.test.tsx | 2 | pass | |
| tests/conversation-band-send-new.test.tsx | 3 | pass | one "not wrapped in act(...)" React warning on stderr, non-fatal |
| tests/arrows-belong-to-the-article.test.tsx | 13 | pass | many "environment not configured to support act(...)" warnings on stderr, non-fatal |
| tests/referee-tooltips.test.tsx | 14 | pass | |
| tests/remember-url-rules.test.tsx | 10 | pass | |
| tests/feedback-button-visibility.test.tsx | 4 | pass | |
| tests/not-found-route.test.tsx | 3 | pass | |
| tests/offline-remount.test.tsx | 5 | pass | the client-side offline-remount/offline-reading file (found by grepping `tests/*.tsx` for "offline"; `api-fetch-offline.test.ts` and `offline-store.test.ts` also match the filename grep but test the store/fetch layer directly rather than mounting a client surface, so they were left out as not what "offline reading of an article in the client" means here); many act(...) warnings on stderr, non-fatal |

**Total: 12 files, 179 tests, 179 passing, 0 failing.**

## Failures established as not ours

None. Every file above passed clean, alone, on this base commit. The stderr lines noted in the
table (204/404/500 traces logged by the app's own `[api]` logger, and React's `act(...)` warnings)
are expected output of tests that deliberately drive those code paths — they are not failures and
none of them failed the run.

## The public-network-trace harness

- **Mocks:** `../src/web/useSession.js` returns a module-level `session.user` var directly (no
  Supabase round-trip). `../src/web/lib/supabase.js` is a fake `auth` object whose
  `onAuthStateChange` just pushes the callback into an `authListeners[]` array instead of firing it.
- **Fetch spy:** `vi.stubGlobal("fetch", …)` in `beforeEach` — not a spy on `apiFetch` — pushes every
  call onto `trace: {url, method, auth}[]` and answers it via `reply(url, method)`, a hand-rolled
  router keyed on URL prefix (`/api/public/article/:slug`, `/api/article/:slug`, `/api/reader`,
  any POST → 204, `/api/comments/`, `/api/chat/`, `/api/glossary/`, `/api/jobs`, else `{}`).
- **jsdom gaps stubbed:** `ResizeObserver`, `window.matchMedia`, `window.scrollTo`, `CSS.escape`.
- `App` and `experimental-store` are imported with dynamic `await import(...)` after the mocks, both
  for load-time speed and because `experimental-store` calls `onAuthStateChange` at module load.
- **Helpers:** `json(body, status=200)`; `reply(url, method)` (the fake server);
  `settle(turns=6): Promise<void>` flushes `turns` macrotask ticks inside `act`;
  `remount(): Promise<void>` unmounts and rebuilds `root`/`host` (needed before a second `open()` in
  one test, else React reconciles instead of remounting); `open(search="", path=""): Promise<void>`
  sets `history.replaceState` to `/read/:slug:path:search`, renders `<NuqsAdapter><App/></NuqsAdapter>`
  in `act`, then replays `SIGNED_IN`/`SIGNED_OUT` to every `authListeners` entry (posing
  `session.user`), then calls `settle()`; `modeAfterPress(before): Promise<string>` polls
  `location.search`'s `mode` param up to 40×10ms for the throttled URL push;
  `readable(root: Element): string` clones a node and strips `[aria-hidden]`/`[hidden]` before
  reading `.textContent`; `outsidePublic()` filters `trace` to URLs not starting with `/api/public/`;
  `buttonNamed(label)`, `chatButtons()`, `helpButtons()`, `modeRadios()`, `modeInUrl()` find DOM nodes
  by accessible name/role.
- **Owner vs. visitor:** `session.user` is a module-level mutable var — `null` for a visitor,
  `{id, email}` for a signed-in reader — set before each `open()` call, which reads it to decide
  whether to replay `SIGNED_IN` or `SIGNED_OUT`. Owner-but-not-owner and session-unconfirmed cases
  additionally repoint `owned = () => json({error}, 404 | 401)` instead of the default
  `owned = () => json(OWNED)`.

## Request traces already covered

Owner-side, mode-scoped request traces already exist for Plain, Ideas and Chat, all in the
`"the same address, as the owner"` describe block (`session.user = {id: "owner-1", ...}`, then
`open()`):

- **Plain** (the default view, `open()` with no `?mode=`):
  - `asks for its own queue on the default view, with no band open`
  - `draws the chat button beside every paragraph`
  - `draws the "?" beside every paragraph`
  - `spends once when the '?' is double-tapped`
  - `mounts the private hooks and the record-open POST`
- **Ideas** (`?mode=ideas`, or arriving from the default view and clicking the dock button):
  - `starts the job when the owner presses a mode nobody has run`
  - `does not start it for an owner who merely arrives at the mode`
- **Chat** (`?mode=chat`, `?thread=…`, or the gutter's chat chip from the default view):
  - `does not offer an account to a reader who has one` (visitor variant, `?mode=chat`, in
    `"a signed-out browser on a shared document"`)
  - `opens the conversation the chat chip is counting, not an empty composer`
  - `still offers a way to start a second conversation, from the reopened panel`
  - `offers no new-conversation door on a chat that is not about a paragraph`
  - `spends once when the '?' is double-tapped` (also a Chat trace — the "?" opens a chat thread)

All 60 test names in the file, from `--reporter=verbose`, are grouped under four `describe` blocks:
`a signed-out browser on a shared document` (33 tests), `when the reader changes underneath the
page` (2), `a signed-in reader who does not own it` (6), `when the reader's own session cannot be
confirmed` (6), and `the same address, as the owner` (13).
