# A quick-search box in the bottom bar, searching as you type

Up: [search.md](../project/search.md) · builds on
[261002e-quick-search-v1.md](261002e-quick-search-v1.md) (quick search itself) · feedback note
[261001_1800-quick-search-on-jev.md](../user-feedback/261001_1800-quick-search-on-jev.md), whose
"not done yet" list named both halves of this job.

## What Greg asked for

> I'm excited about the quick search. Can we add a searchbar somehow in the bottom bar that makes it
> easy to trigger a quick search from anywhere?
>
> — Greg, 2026-10-02

and, a few hours later, the half the first brief had kept out:

> Q-quick-ui let's try the search-as-you-type, just for fun. Will it automatically delete the
> obsolete versions as I keep typing?
>
> — Greg, 2026-10-02

## The answer to Greg's question, first

**Yes, in effect: one typing session keeps one saved search.** As you pause, the same saved row is
re-asked with the new words — same row, same colour, same place in the list — and when you stop, it
stays with the words you ended on. Nothing a reader chose to keep is ever deleted, and there is no
row per keystroke. Starting a fresh session (the box emptied and typed into again, or Enter pressed
and then more typing) starts a fresh row.

## What it looks like

```
 desktop / iPad landscape — the box sits in the bar's slack, before Comments … Feedback

 ┌────────────────────────────────────────────────────────────────────────────────────┐
 │ ⌂ ⌘ │ ▤ ⊞ │ 𝐀 ✳ │ 🔍 ⌸ ✎ │ ⚡ quick search…  / │ 💬 ⓘ  ?  Feedback │
 └────────────────────────────────────────────────────────────────────────────────────┘

 typing "why replication fails" … pause … Search mode opens on the results, matcher = quick,
 the box keeps focus, the article does not move:

 ┌────────┬───────────────────────────┬────────────────────────────────────┐
 │ spine  │ [why replication fails ]  │  …the prose, where you were…       │
 │        │ (words)(⚡QUICK)(meaning)  │ ┃ a matched paragraph               │
 │        │ ☑ ▌why replication fails  │                                    │
 │        │   quick · flesh out    ✕  │                                    │
 │        │ ▐91▌ …studies fail when…  │                                    │
 ├────────┴───────────────────────────┴────────────────────────────────────┤
 │ … 🔍 ⌸ ✎ │ ⚡ why replication fails     │ 💬 ⓘ ? Feedback              │
 └──────────────────────────────────────────────────────────────────────────┘

 phone (390px) — no room for a box; a ⚡ button opens Search mode on quick with its box focused

 ┌──────────────────────────────────────┐
 │ ⌂ ⌘ │ ▤ ⊞ 𝐀 🔍 ⌸ … │ ⚡ │ ? ✉ │       (the row scrolls, as it does today)
 └──────────────────────────────────────┘
```

## The decision, in four parts

### 1. One draft, two boxes onto it — not a second search

The bar box and the Search panel's box are **two views of one draft**: the words typed and the
typing session they belong to. Typing in either updates both. The asking — debounce, cancel, the
one row per session — happens in exactly one place, `SearchBand`, which already owns `useSearch`.
So there is still one request (`POST /api/search/<slug>` with `kind: "quick"`), one results list,
one set of marks and colours, one saved row type.

The catch the code map found: `useSearch` and the panel's draft both live inside Search mode and
vanish when it closes. The draft moves out into a tiny per-article store
(`src/web/search-draft.ts`, `useSyncExternalStore`), which the dock box and the panel both read.
`useSearch` stays where it is: the dock box opens Search mode on the reader's first pause, so the
band is mounted before the first ask is due.

Typing in the bar box when Search mode is closed:

1. The first keystroke changes nothing visible but the box.
2. The first debounced pause (600 ms, at least 3 characters) opens Search mode with
   `?match=quick` — a URL change through the existing `useActivateMode`, pushed once — and the band
   asks. Focus stays in the bar box; the article does not scroll.
3. Later pauses revise the same row (part 3).

Enter skips the wait and asks now. Escape in the bar box clears it and blurs. On a phone, the ⚡
button opens Search mode on quick and focuses the panel's box, and the panel's box searches as you
type the same way.

Passed over: **a box that is only a launcher** (it opens Search mode and hands focus to the panel's
box on the first keystroke). Simpler — no shared draft — but focus jumps away mid-word, and on a
wide screen the reader would type at the bottom of the screen and find their words appearing
somewhere else. On a phone, where the box does not fit anyway, that *is* what we do, because there
the ⚡ is a button, not a box.

Passed over: **lifting `useSearch` to `Reader`** so a search can run with the mode closed. Results
nobody can see are no use, and Reader.tsx is the file fb96 is changing today.

### 2. Search-as-you-type applies to quick everywhere, not only to the bar

The panel's box, with *quick* chosen, searches as you type too; *meaning* stays pressed (it costs
cents and takes 15–40 s), and *words* already runs every keystroke. One rule — quick asks on a
pause — is simpler to explain and to build than two quick boxes that behave differently. The *find*
button stays for quick, as the "now, don't wait" key, as Enter is.

### 3. One row per typing session, revised in place — chosen over "save nothing until Enter"

| | **one row, revised in place** (chosen) | **save nothing until Enter** | **new row each pause, delete the last** |
|---|---|---|---|
| what the reader sees | one row whose words follow the box | an unsaved "draft" result, saved on Enter | one row, but its colour changes each pause |
| what stays if they walk away | the last words they paused on | nothing | the last words |
| new code | a *revise* branch beside the retry branch on the server | a whole unsaved-run path: no `begin`/`finish`, a client row that is not a `SearchRun`, and a second ask (or an upload) on Enter | none on the server |
| deletes | none | none | one per pause |

Colour is hashed from the run id (`assignSlots` in `src/web/hit-colours.ts`), so a new id each
pause repaints every mark on every pause — that rules out the third column. The second would be the
"second search path" this job is asked not to build, and quick results are already saved on Enter
today, so a typed session leaving nothing behind would be the odd one out.

**The revise branch.** `POST /api/search/<slug>` gains an optional `revises: true`. With it, an
existing **quick** row of this article, named by `id`, is reset in place with the new criterion —
status `pending`, hits cleared, a new attempt token — exactly as the retry branch in `withRun`
(`src/searches.ts`) resets a failed row, keeping `createdAt` and the reader's colour. The attempt
fence already in `finish` means a superseded attempt's late answer cannot land on the revised row,
which is the race this would otherwise have. Without `revises`, the existing rules are unchanged:
a different criterion under a held id still mints a new one.

What ends a session (the next words start a new row): Enter or *find*; the box emptied; a switch
of matcher; the session's row deleted or *fleshed out*. Within a session, words that match a row
already saved from an earlier session are just revisions of this one — two rows with the same
words are allowed today, and no dedupe is added.

### 4. Cancel the superseded ask, at both ends

Today nothing cancels a search: the client reads an abandoned stream to its end, and the route
passes no signal, so a superseded Jev call runs to completion. The plan adds:

- **client:** an `AbortController` per send in `useSearch`; a revision aborts the previous attempt's
  fetch, and the abort is not an error row.
- **server:** the search route aborts on `res.on("close")`, as the chat routes already do, and
  passes the signal to `quickPassagesStream` (which takes one). The meaning path gets it too, if
  `findPassagesStream` accepts a signal; otherwise noted, not built.

## Cost per typing session

A quick search is about **$0.0004** on a typical article and $0.003 on a 540-paragraph one. With a
600 ms pause and a 3-character floor, a typed question of four or five words produces roughly 3–6
asks, some cancelled mid-flight (a cancelled request may still be billed). So **about $0.001–0.003
per session on a typical article, and up to about $0.02 on a very long one.** It is metered like
every quick search (`search-quick` in `ai_calls`), so the real number will be visible within a
day.

## The keyboard

**`/` focuses the bar box** (on a phone, the ⚡ button's action), from anywhere in the reading view
that is not a text box or a dialog. It is the web's usual key for "jump to search" (GitHub, YouTube,
Gmail), it is unbound here, and it follows the rules G already follows in keyboard.md: no modifiers,
no auto-repeat, not while typing, not over a modal. ⌘K stays the command bar; ⌘F stays the
browser's find, because keyboard.md's rule is that we do not take the browser's own features.

## Phone and iPad

The bar is a scrolling row with a fit ladder (`src/web/dock-fit.ts`, three rungs that drop labels).
The box gets a rung of its own: a full box (≈14rem) on the widest rung, a narrower one (≈9rem) on
rungs 1–2, and the ⚡ button on rung 3 and under `max-width: 731px`. An iPad in landscape keeps the
box; in portrait it lands where the ladder puts it. The browser check confirms each.

The dock hides on scroll on narrow windows; `.dock:focus-within` already keeps it shown, so a
focused box does not vanish under the reader's thumb.

## Keeping out of fb96's way

fb96 (mode press toggles off; three frames in the bar) is changing `Dock.tsx`'s mode area,
`dock-fit.css` and `narrow-window.css`, and `Reader.tsx`. This job's bar component lives in a new
file, `src/web/DockQuickSearch.tsx`, with its CSS in a new `src/web/styles/dock-quick-search.css`;
`Dock.tsx` gets one element and one entry in `fitSignature`. Nothing here touches `Reader.tsx`.
Merge origin/dev at every stage.

## Stages

1. **Server: revise and cancel.** Tests first, seen red: `withRun` revises a quick row (keeps
   `createdAt`, colour, id; new attempt), refuses to revise a meaning row or an unknown id, and a
   superseded attempt's `finish` is fenced; the route accepts `revises` and aborts on close.
2. **Client: the shared draft and the typing session.** `search-draft.ts`; the panel reads it; the
   session logic in `SearchBand` (debounce, revise, end-of-session rules, abort); unit tests for the
   session rules as a pure reducer.
3. **The bar box, `/`, and the narrow widths.** `DockQuickSearch.tsx`, CSS, the fit rungs, the
   ⚡ button; a test that `/` focuses it and is ignored while typing.
4. **Docs and browser check.** search.md (where quick search lives, the session rule, the cost),
   mode.md, keyboard.md, help if it lists the bar; Playwright at 1440, 1024 and 390 wide.

Sol reviews this plan before stage 1, and the code at the end.

## Not doing

- No quick search with Search mode closed (results nobody can see).
- No search-as-you-type for *meaning*.
- No new keyboard chord beyond `/`.

## Plan review (GPT Sol and Opus, 2026-10-02) and what changed

Sol: [261002h-quick-search-bar-in-the-dock-plan-review-sol.md](261002h-quick-search-bar-in-the-dock-plan-review-sol.md),
*proceed with changes*. Opus (a subagent, asked to arbitrate the product questions) agreed with
the shape and added the touch and flicker points. **Both independently said the same simpler thing
first: build search-as-you-type in the panel, then put the bar control on top of it.** That is now
the stage order; the bar box stays, because Greg asked for a box in the bar.

What changed, finding by finding:

- **Sol F1** — the first ask waits for the saved list's GET (`loaded`), or the GET's arrival would
  replace the list under the pending row. The latest intent is carried until then; Enter skips the
  pause, not this gate.
- **Sol F2** — the panel's box no longer autofocuses when Search mode was opened from the bar box
  (it does for the ⚡ button, `/` on a narrow window, and the ordinary Search button).
- **Sol F3** — the attempt fence orders *finishes*, not *begins*. So a session sends **one request
  at a time**: a revision waits for the previous request's `begin` frame, edits made meanwhile
  coalesce to the latest words, and only then is the old fetch aborted and the revision sent. The
  revise branch is its own UPDATE (it sets `criterion`; the retry UPDATE matches on the old one and
  on `error`).
- **Sol F4** — the client fences too: each send has a generation, and a superseded send's frames,
  renames and errors are dropped before they touch the row or `?runs=`. A deleted session row is
  never resurrected by a revision.
- **Sol F5 / Opus** — the session rules, precisely (they are a pure reducer in
  `src/web/quick-session.ts`, so they are tested on their own):
  - a session **starts** at the first edit of the box with *quick* chosen, and acquires its row on
    its first ask;
  - each later pause **revises** that row; unchanged words ask nothing;
  - it **ends** on Enter or *find* (after flushing changed words into the row), the box emptied, a
    matcher switch, ↺ or ✕ or *flesh out* on its row, leaving Search mode or the article, and —
    Opus — **the box blurred for longer than a pause**, so somebody who searches, reads for five
    minutes and types again starts a new row rather than overwriting a search they may want;
  - revisions do not re-tick a row the reader unticked, and add nothing new to `?runs=`;
  - words left in the box after a session ends are inert: remounting never asks.
- **Opus** — a revision keeps the previous answer's marks on screen until the new one arrives,
  rather than wiping every highlight on every pause.
- **Opus** — the pause is **600 ms**, and needs at least 3 characters; whether a word boundary
  should also be required is measured in the browser check rather than argued.
- **Sol F6** — the shared draft is one way: the bar box writes the draft only while it has focus;
  the panel's quick/meaning box reads and writes it; *words* keeps `?find=` and never launches a
  quick call. Fetches never write the draft.
- **Sol F7** — the server cancels through the existing `sse(res).gone` seam, not a new listener,
  **for quick only**: a cancelled quick attempt finishes as an error through the fence (so a
  superseded one changes nothing and an abandoned one does not sit `pending`). The `searching` key
  becomes attempt-aware, so an old attempt's `finally` cannot release a newer one's. *Meaning* keeps
  running when the tab closes, as today — changing that is a product call this job does not need.
- **Sol F8** — the bar control and `/` exist only where the band can answer: an owner's reading
  view (visitors get the read-only band and no control).
- **Sol F9 / Opus** — **touch devices (`pointer: coarse`) always get the ⚡ button**, at any width:
  an input in a fixed bar at the foot of an iPad is where the on-screen keyboard misbehaves. On a
  mouse, the box at the wide rungs and the ⚡ at the narrowest, sized by the fit ladder's classes
  (no React swap during measurement). Opus: iOS only raises the keyboard for a focus inside the tap
  itself, so the ⚡ focuses synchronously where it can; if the band's box mounts too late for
  that, a second tap is the accepted cost and is written down — the Playwright check cannot show
  it, so say so rather than claim it.
- **Opus** — while Search mode is open and the bar box does not have focus, it shows as the ⚡, so
  there is only one box to edit.
- **Sol F10** — `/` is Firefox's Quick Find. Kept anyway, like GitHub: it overrides a niche
  duplicate of ⌘F/Ctrl-F, not the browser's main find, and keyboard.md says so. Shift is not
  rejected (some layouts need it for `/`); IME, editable and dialog guards are.

Not taken: Opus's suggestion to make *quick* the default matcher. It is a product call and the bar
control sets `?match=quick` itself, so this job does not need it — offered to Greg instead.

### Stages, revised

1. **Server**: the revise UPDATE in `withRun`/`begin`, the attempt-aware `searching` key, `gone`
   for quick, a cancelled quick attempt finishing as an error. Tests first.
2. **Panel search-as-you-type**: `quick-session.ts` (pure, tested), the one-at-a-time send with a
   generation fence and an `AbortController` in `useSearch`, marks kept across a revision, the
   `loaded` gate.
3. **Bar control**: `search-draft.ts`, `DockQuickSearch.tsx` (box, ⚡, the owner gate, coarse
   pointer), `/`, no autofocus steal.
4. **Docs and browser check** at 1440, 1024 (landscape iPad), 768 (portrait) and 390.

## Stage notes

**Stage 1 (server), landed.** `withRun` has a third result, `"revised"`, taken only with
`revises: true`, a `wantedId` naming a **quick** row and a quick request — in any status, since the
previous attempt may still be running. Anything else named by `revises` (a meaning row, a quick row
asked as meaning, an unknown id) falls through to the old rules: an unknown id mints under that id,
a held one mints a new id. `pgSearchStore.begin` takes `options: { revises }` as a sixth argument
and runs its own UPDATE (sets `criterion`, clears `hits`/`model`/`error`, fresh `sourceHash` and
attempt; `created_at` and `colour` untouched; predicate id + article + `kind = 'quick'` repeated in
SQL). The route validates `revises` as a boolean (400 otherwise), passes `sse(res).gone` to
`quickPassagesStream` only, skips `captureFailure` when `gone` has fired, and still finishes the
attempt as an error through the fence. `searching` is now a `Map` from key to a per-request symbol,
and a request releases the key only if it still holds it; `liveRuns` is exported for the test that
proves it (watched red with the old unconditional delete).

**Stage 2 (panel search-as-you-type), landed.** The rules are `stepQuickSession` in
`src/web/quick-session.ts` (pure; `tests/quick-session.test.ts`); the timers around it are
`useTypingSession` in `SearchMode.tsx`, and the box reaches it through an optional
`typing: TypingControls` on the owner arm of `SearchAccess` (absent, quick asks on Enter/*find*
only — which is what tests that mount the panel alone get). Two deviations from the letter of the
rules: Enter/*find* still wait for `loaded` and are dropped before it, as *find* always was (only a
pause is carried); and *flesh out* on **any** row ends the session, not only on the session's own
row, because the panel's `onAsk` does not say which row asked. `useSearch.revise(id, words)` keeps
one lane per row (`lanes`): a revision before the current request's `begin` is parked (latest words
win) and sent from that `begin`; after it, the old request is marked `superseded`, its fetch aborted,
and every frame, rename, failure and clean-up of a superseded send is dropped. A revision keeps the
row's previous hits until its own first hit. A queued revision is still sent if the request it
waited on failed before `begin` (the server then mints under the same id). Tested through the real
band in `tests/search-as-you-type.test.tsx` and the hook in `tests/use-search.test.ts`.
