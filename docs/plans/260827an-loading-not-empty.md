# A spinner while it loads, not an empty state that is wrong

**Status:** built, 2026-08-27.

## The bug

Greg, 2026-08-27:

> I tried loading Chat mode on a slow internet connection, and it initially told me there were no
> chats (even though I knew there were)! Then eventually the existing chats loaded and replaced that
> message. Better to show a loading spinner when loading, rather than default to the empty/initial
> state (which is wrong and worrying). This should be true in all other relevant places too.

Every list in the client starts `[]`, and a fetch that has not come back yet leaves it `[]`. So
`items.length === 0` answers two different questions with the same value — *you have none* and *we
have not asked* — and a component that reads it as the first says something false for as long as the
request takes. On localhost that is 40ms and nobody sees it. On a train it is seconds, and what the
reader sees is the app denying their own work.

**Wrong and worrying is the whole of it.** A spinner says "wait"; an empty state says "there is
nothing", and a reader who knows better has just been told the app has lost something.

## What was surveyed

A subagent walked every `use*` hook in `src/web/` that fetches, and every consumer of each. Most of
the client already got this right, in three different idioms — a `status` union (`useGlossary`,
`useIdeas`, `useSimilar`, `useProjection`), a `loaded` boolean (`useChat`, `useSearch`, `useJobs`,
`useLibrarySearch`'s `asked`), or `null` against `[]` (`useShelf`, `useProfile`, `useAdminUsers`).
`SearchPanel` in particular already had the exact fix, comment and all, which is what the chat panel
should have copied.

Three places did not.

## What changed

**1. The chat list — the one Greg hit.** `ChatPanel`'s `ThreadList` rendered *"Nothing asked yet."*
off `sorted.length === 0`, with `loaded` sitting right there in its props being used for something
else entirely. Now the panel takes a third branch, `!loaded && threads.length === 0`, and shows
`ChatListLoading`.

`threads.length === 0` and not just `!loaded`, because a list can have something in it before the
fetch lands: press `+`, type a draft, close it, and `leave` keeps that conversation. A spinner drawn
over the reader's own conversation is its own wrong answer.

**2. The questions drawer — the same bug, second location.** `useComments` had no flag at all: no
`loaded`, no `status`, nothing. `Questions` in `Dock.tsx` said *"Nothing asked yet. Select a sentence
in the article and the model will explain it."* off `comments.length === 0`, so opening the drawer on
a slow connection denied the questions the reader had opened it to find. Added `CommentsApi.loaded`,
set on **both** the success and the failure path — it means *we have asked*, not *it worked*, or a
spinner turns for ever beside an error message and one of them is lying.

**3. The profile page's shelf — the same mistake one step along.** `GET /api/library` failing was
turned into `setShelf([])` in a `.catch`, so a dropped connection was reported as *"Nothing on the
shelf yet"* with *"0 on the shelf"* underneath it. The fix was already written out ten lines below,
on the `/api/models` fetch, whose comment says exactly why a third state is needed. `shelf` is now
`LibraryEntry[] | "error" | null`, and the footer counts with `Array.isArray` rather than `!== null`
so it does not print "0 on the shelf" under "could not reach the shelf".

## Two rules that came with it

**Behind `useSlow`.** A fetch that finishes in 40ms draws nothing at all. A spinner that flashes and
vanishes reads as breakage, which is the failure this replaces rather than a second copy of it.
`SLOW_AFTER_MS` is 600 and there is one of it.

**Name what is being waited for.** "Fetching your conversations…", "Fetching your questions…",
"Fetching your shelf…" — not "Loading…". The reader is waiting for a specific thing and the sentence
is free. Same rule as `docs/project/copy.md`, and the same rule `useSlow`'s own docstring asks for.

## What the review changed

The code went to GPT Sol — `260827an-loading-not-empty-review-prompt.md`, answer in
`260827an-loading-not-empty-review-sol.md`. Five findings, all taken:

**1 (must-fix) — the failed fetch made the same claim, one beat later.** `loaded` means *we have
asked*, not *it worked*, and that is deliberate: a reader whose server is down should still be able
to open a conversation rather than face a panel that never resolves. Which meant every panel dropped
straight out of the spinner into "Nothing asked yet" the moment a failing request gave up. The
original bug, arrived at from the other side, and the first fix walked into it.

So each hook gained `loadFailed` beside `loaded` — `useComments`, `useChat`, and `useSearch`, which
had the loading half since 2026-08-26 and was missing this half too. It is not `error !== null`:
`error` carries any transport failure in these hooks, including a retry that failed long after the
list arrived, and it is cleared when a later request succeeds. A `200 { error }` body counts as a
failed load, because there are no rows in it. Four panels now say *"Couldn't load your …. Reload to
try again."* rather than making the claim.

**2 (must-fix) — the new profile test did not typecheck.** `LibraryEntry` has eight more required
fields than the fixture had. `vitest` transpiles past it; `tsc` does not. My mistake was checking
`npm run typecheck` output with a grep that named only one of the three new files.

**3 (should-fix) — the failure copy promised more than was known.** *"It is still there — reload to
try again"* fires on anything `readJson` throws, including a 500 and a non-JSON 200, and only a
dropped connection is evidence that the data is fine. All four messages now stop at "Couldn't load".

**4 (should-fix) — the panel tests proved nothing about the hook.** They pose `loaded` and
`loadFailed` directly, so they could not catch the hook leaving them wrong — which is exactly what
finding 1 was. `tests/use-comments-load-state.test.ts` is the missing one: real `readJson`, stubbed
`apiFetch`, deferred promises, and the interleaving where the article you left answers late.

**5 (should-fix) — the written rule overclaimed and missed the gate.** "Every waiting state behind
`useSlow`" was contradicted by the search panel's immediate spinner and the profile page's immediate
text, and the doc asserted that an error prevents an empty claim when no panel enforced it. The rule
is now: *an empty claim requires a fetch that came back and worked*; `useSlow` applies where the
indicator stands in place of the content, which a caption in a permanent status line does not. The
two immediate indicators were moved behind `useSlow` rather than written up as exceptions.

## What the second review changed

The fixes went back to GPT Sol — `260827an-loading-not-empty-review-2-prompt.md`, answer in
`260827an-loading-not-empty-review-2-sol.md`. One must-fix, two should-fixes, a note; all taken.

**1 (must-fix) — `useChat` could not tell two fetches for the same article apart.** The mount effect
guarded its result with `showing.current !== slug`, which distinguishes *articles*, not *runs of the
effect*. `StrictMode` deliberately runs it twice, so two requests for one slug were in flight and
both passed the guard: the first one failing after the second one succeeded set `loadFailed` back to
true under a list that was on screen. A `let live = true` closed over by the effect's cleanup — the
shape `useComments` and `useSearch` already used — is per-run by construction.

**2 (should-fix) — the delicate new paths had no tests**, which is exactly why finding 1 got through.
`tests/load-failed-flags.test.ts` covers `useChat` and `useSearch` the way
`use-comments-load-state.test.ts` covers comments, and mounts under a real `StrictMode` for the case
above — asserting the double-run happened rather than assuming it.

**3 (should-fix) — the delayed indicators had no accessible semantics, and the search one still
jumped.** All four now carry `role="status"`, so a sentence arriving 600ms late is announced
politely rather than to nobody; `.srch-waiting` holds one line's height through the quiet window, as
`.chat-loading` and `.dock-loading` already did.

**4 (note) — the doc said `error` is cleared when a later request succeeds.** It is not: comments and
search clear it when a retry *starts*, and chat never clears it at all. Corrected, and the point it
was making — that `loadFailed` cannot be spelled `error !== null` — is stronger for it.

## The tests

`tests/use-comments-load-state.test.ts` and `tests/load-failed-flags.test.ts` (the hooks),
`tests/chat-list-loading.test.tsx`, `tests/dock-questions-loading.test.tsx`,
`tests/profile-shelf-failure.test.tsx` (the panels).

The panel files cover the states that must not make the claim — waiting, waiting-and-under-600ms,
failed — **and** the ones the indicator must not eat: a real empty list, and a real populated one.
Without those last two, a component that simply never showed its empty state passes everything else.
(The profile file is the exception: its card has no under-600ms case worth posing, so it has four
tests rather than five.) Every fix was watched red against the pre-fix condition before being kept —
the loading assertions fail, the guard assertions still pass, which is the shape that says the test
is testing the thing it names.

## Where it is written down

`docs/project/web-client.md` § *Empty is not the same as not asked yet* — the rule, the three
idioms the client spells it in, why `loaded` is not enough on its own, the `useSlow` gate and where
it stops applying, and the two cases the whole thing does not cover: a wait so short it is structural
(the auth SDK's first frame) and a case where "empty" is itself the suspicious answer (the admin
page).
