# Second review: the fixes for your five findings

You reviewed this change earlier today (`docs/plans/260827an-loading-not-empty-review-sol.md`) and returned
five findings. All five were taken, and finding 1 turned out to be the largest part of the work —
it spread the change into two more hooks and a fourth panel. This is the review of that.

Read-only. Do not edit files. Rank findings by damage, mark each must-fix / should-fix / note. Say
plainly if a section is clean.

## What to read

- `docs/plans/260827an-loading-not-empty.md` — the plan, with a new section saying what your review changed.
- `docs/plans/260827an-loading-not-empty-review-sol.md` — your own five findings.
- `docs/project/web-client.md` § **Empty is not the same as not asked yet** — rewritten around your
  finding 5.
- The scoped evidence:
  `/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/fd1806a6-7501-48d6-9973-586046272c7a/scratchpad/loading2.diff`
  — read that for the shape, then the real files, which are authoritative.

**Same caveat as last time.** Other agents are working in this checkout. `src/web/ChatPanel.tsx`,
`src/web/App.tsx` and `src/web/styles.css` contain uncommitted work that is not mine (`kind` and
`stance` on chat threads, `onSendNew`, dictation) — ignore it, and ignore test failures in
`tests/ai-call.test.ts`, `tests/chat-empty-answer-log.test.ts`, `tests/api.test.ts`,
`tests/library-log-volume.test.ts`, `tests/store-jobs-parity.test.ts`, `tests/db-schema.test.ts`,
`tests/fixture-ids.test.ts`, which belong to them. Everything else is mine.

## What changed since your review

**Finding 1.** Each hook gained `loadFailed` beside `loaded`: `useComments`, `useChat`, `useSearch`.
Set only by the mount effect, on three paths — a thrown request, a `200 { error }` body, and (in
`useChat`) `refresh()` returning false. `useChat.refresh` now returns `Promise<boolean>` and the
mount effect reads it; every other caller ignores it. Four panels grew a failed branch:
`ChatPanel`, `Dock`'s `Questions`, `SearchPanel`'s `Saved`, `ProfilePage`'s shelf card.

**Finding 2.** The `LibraryEntry` fixture now has every required field; `npm run typecheck` is clean
for all four of my test files.

**Finding 3.** All four failure messages are now `Couldn't load your <thing>. Reload to try again.`

**Finding 4.** `tests/use-comments-load-state.test.ts` is new: real `readJson`, stubbed `apiFetch`,
deferred promises, seven cases including the late-answer interleaving.

**Finding 5.** The doc rule is rewritten around *an empty claim requires a fetch that came back and
worked*. Rather than write the two immediate indicators up as exceptions, both were moved behind
`useSlow` — `SearchPanel`'s `SavedLoading` and `ProfilePage`'s shelf line.

## What I most want you to attack

1. **`useChat.refresh` now returns a boolean, and its meaning is subtle.** It returns `false` on a
   `showing.current !== mine` bail-out — which is "not our slug any more", not "it failed" — and the
   mount effect turns `!ok` into `setLoadFailed(true)`. Walk it: can a slug change between the
   effect firing and the promise settling leave `loadFailed` true for the *new* slug? The effect
   guards with `if (showing.current !== slug) return`, but `showing.current` is a ref set by this
   same effect, so check the ordering under React 18 StrictMode double-invocation as well as under a
   fast slug change. If it can go wrong, say exactly which interleaving.

2. **Did I get every `return` in `refresh`?** It has several early exits and I added a return value
   to each by hand. Check each one against what it means — in particular the `(running.current.get(only) ?? 0) > 1`
   bail-out, which I made `true`, and the per-thread path where the server does not have the thread.

3. **`loadFailed` in `useSearch` and `useComments`.** Same walk: slug change, unmount mid-flight,
   the `live` flag, and whether anything other than the mount effect can set or clear either flag.
   `useSearch` has an `ask`/`retry`/`remove` set that also touches `error`.

4. **The four panels' branch order.** Each now has three empty-list branches in a row. Is the order
   right in each, and is there a state that falls through all three into a list render with nothing
   in it? `ChatPanel` in particular has `open`/`threads.find` above them and a peer's `kind`/`stance`
   work around them.

5. **`SavedLoading` and the profile shelf line, newly behind `useSlow`.** Both render an
   always-present wrapper with the content inside conditional on `slow` — a `<p className="srch-working">`
   with nothing in it, and a `<p>` containing ` `. Is the non-breaking space a hack that will
   read badly to a screen reader? Would `aria-busy` or a visually-hidden "Loading" be better? And is
   holding the empty wrapper actually preventing a layout jump, or just producing one 600ms later?

6. **The new hook test, hardest.** `tests/use-comments-load-state.test.ts` mocks `apiFetch` via
   `vi.mock` + `importActual` so the real `readJson` runs. Is that faithful? `apiFetch` in the real
   client also touches the offline cache and the online/offline banner — does bypassing that make any
   of the seven cases misleading? Is `settle()` (three awaited microtask ticks) load-bearing in a way
   that will flake? Is the late-answer test actually exercising the interleaving it claims, or does
   the render order make it trivially pass?

7. **Anything the second round introduced that the first did not have.** New required props on
   `SearchPanel`, `ChatPanel` and `Dock`'s `drawer` mean every call site had to be updated —
   `src/web/preview-colour.tsx`, `tests/search-colour-picker.test.tsx`,
   `tests/chat-list-composer.test.tsx` (another agent's file). Did I miss one, and is passing
   `loadFailed={false}` in a preview the right default there?

8. **The doc and the plan.** Are they now accurate about what the code does, and would they stop the
   next person making either half of this mistake?
