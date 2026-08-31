# The profile panel — one place that says what you're being written for

Greg, 2026-08-30:

> Wherever it says "Use your profile" (e.g. for customising LLM calls), perhaps link to both
> article- and user-profiles, with a rich tooltip explaining how this works, and displaying what
> they currently are set to. Do you think it would make sense to make this a reusable component
> (even better if you make it easy to edit in place)?

Today the checkbox says four words and nothing else. A reader who ticks it is told neither what the
profile *is*, nor what theirs currently says, nor where to go and change it. The two boxes it joins
live on two different pages, one of which is not the one they are on.

This adds **one shared popover**, opened from beside that checkbox and from the `written for you`
badge, which explains the thing, shows both boxes as they currently stand, and carries a working
link to each editor.

Background: [reader-profile.md](../project/reader-profile.md) — the two boxes, the one string they
join into, and the provenance stamp. Read its § *The two controls, and why one of them is not a
control* before this one; the split it describes is kept.

**It is a reusable component already.** `UseProfile` in
[WrittenForYou.tsx](../../src/web/WrittenForYou.tsx) is used in ten places across the glossary,
summary, ideas, tweets and chat panels. The work is giving that one component something to say.

## How this plan got to here

The first version proposed a rich hover tooltip. The second proposed a click-opened panel with both
textareas in it, editable. Both were wrong, and the record of why is the useful part.

### A tooltip in this app cannot hold a link, and one already doesn't

`.tooltip-anchor` is `pointer-events: none` ([styles.css](../../src/web/styles.css) § tooltip), and
`Tooltip` passes `handleClose: null` — every card in this app is read, never entered. So a link
inside one cannot be clicked, and the pointer cannot travel to it anyway.

**This is measured, and it is already shipping.** `WrittenForYou`'s tooltip carries
`<Link href="/profile">Edit your profile →</Link>`. Mounting the real component with the real
stylesheet in headless Chrome, hovering the badge with real pointer events, and asking the browser
where a click at the link's own centre would land:

```
{ "tooltipOpen": true, "linkFound": true, "anchorPointerEvents": "none",
  "linkText": "Edit your profile →",
  "hitTarget": "DIV.pv-page", "hitIsTheLink": false,
  "control": true }
```

`control` is the same `elementFromPoint` test on an ordinary in-flow copy of that link on the same
page. It returns `true`, so the probe can report a reachable link and the `false` above is about the
tooltip rather than about the probe — [silent-success.md](../reusable/silent-success.md).

**So that link has never been clickable.** Fixing it is the floor of this work, not a side errand.

### And the editor did not belong in a 352px floating card

GPT Sol's review of the second version ([260830c-profile-panel-review-sol.md](260830c-profile-panel-review-sol.md))
found four blockers in it, and the sharpest was not the one about taste:
[`useDictation`](../../src/web/useDictation.ts)'s unmount cleanup **aborts rather than stops, on
purpose**, so it never delivers a last result. A popover that dismisses on outside press therefore
throws away whatever was being dictated into it — and on the browsers where words only arrive after
stopping, it throws away all of them. Save-on-blur has the matching hole: the outside `pointerdown`
unmounts the textarea, so the blur that would have flushed it need never fire.

Greg chose read-only with links out, 2026-08-30, knowing that. **Nothing is typed in the band**, and
with that one decision four of the review's findings stop existing: no save path, no dismissal
hazard, no `usePurpose` extraction, and no artefact left lying about its own provenance because
somebody edited a profile two inches from it.

## The shape

```
  ☑ Use your profile [👤]      [ Find the terms ]
                      │ click
                      ▼
  ┌─────────────────────────────────────────┐
  │ What the glossary, summaries, chat  [×] │
  │ and explanations are written for. It    │
  │ changes what gets explained and how     │
  │ much — never what the article says.     │
  │                                         │
  │ ABOUT YOU                       Edit →  │
  │ Cognitive scientist, twenty years,      │
  │ mostly memory and learning. Rusty on    │
  │ transformer internals.                  │
  │                                         │
  │ WHY YOU'RE READING THIS ONE     Edit →  │
  │ I want the evidence, not the history.   │
  └─────────────────────────────────────────┘
```

**Not `Tooltip`.** Sol's first blocker: controlled state does not disable `useHover` or `useFocus` —
`Tooltip` installs both unconditionally — so a click-opened card would still be closed by the
pointer leaving the trigger, and `useRole({role: "tooltip"})` is wrong for a container with links in
it. The app already has the right component: **`ColourPicker`**
([SearchPanel.tsx](../../src/web/SearchPanel.tsx) § the picker) is a Floating UI click-popover with
`useClick`, `useDismiss`, `useRole({role: "dialog"})` and `FloatingFocusManager` at `modal={false}`,
and its docstring already argues every one of those choices. `ProfilePanel` copies that shape. It
does not turn `Tooltip` into two components wearing one name.

Non-modal: no focus trap, Tab order that follows the trigger, Escape to dismiss, focus returned to
the trigger on close.

**The trigger is a separate button, not the words.** `.prof-use` is a `<label>`, so a click anywhere
in it toggles the checkbox. Hanging "open the panel" off the same target would be one click doing
two things, decided by which pixel. The `👤` button sits *outside* the label, after it.

**The trigger survives a reader with no profile.** `UseProfile` returns `null` today when
`hasProfile` is false, so a new reader has no checkbox, no badge and — in the second version of this
plan — would have had no way to find out what any of it meant. Only the **checkbox** hides. The
button stays, the panel says *"nothing written yet"* in both boxes, and the two links are how a
first profile gets written. Sol's second blocker, and it is the state the feature most needs to
work in.

**The trigger is not disabled while a job runs.** The checkbox is, and rightly — the profile is
frozen onto a job at its start. But "what am I being written for" is a question a reader asks *most*
while they are waiting, and a disabled control teaches them they failed at something.

**The badge becomes a way in too.** `written for you` is documented as a label rather than a control,
and that rule was about not offering to change the artefact — it already carries a link, it is
already the place a reader asks this question, and the link is the broken one. It becomes a button
that opens the same panel. Its hover tooltip goes; the panel replaces it.

## Where the data comes from

`GET /api/reader?slug=` already answers most of this: `{ profile, hasProfile }`. It gains `purpose`.

`resolveProfile` currently reads both halves and returns only the joined string, throwing the
purpose away. It splits: **`resolveProfileParts(slug) → { profile, purpose }`**, and `resolveProfile`
becomes `renderProfile(await resolveProfileParts(slug))`. Every existing caller is untouched, and the
rule that lives in there — *the shelf read is allowed to fail and the global half still counts*,
which GPT Sol put there on 2026-08-26 — stays in one place rather than being copied into the route.

**`purpose` is always present, `null` when there is no `?slug=`.** Not absent: a field that appears
on some responses and not others gets dropped silently at a boundary and read as "this reader has no
purpose" rather than "nobody asked" — three states pretending to be two. Four assertions in
`tests/routes.test.ts` use `toEqual` on the whole body and will go red. They get the new field; they
do not get loosened to `toMatchObject`.

### The panel fetches its own text, when it opens

The obvious move was to put the two strings on the boolean every panel already fetches. It is the
wrong one, and Sol's third blocker is why: `useHasProfile(slug)` is called from **five** separate
hooks, so a reading view already makes five `/api/reader?slug=` requests. Adding the text means the
reader's profile fetched five times per page, and any attempt to share it needs a store with
subscriptions, per-key generations, rejection eviction and an invalidation path — a lot of machinery
guarding a string nobody has asked to see.

So: **`useHasProfile` is not touched at all**, and `ProfilePanel` fetches `/api/reader?slug=` itself
when it is opened. One request, on demand, by the only component that wants the text.

That is not a compromise, it is better on every axis that matters here. It is **always fresh** — a
reader who edits their profile on `/profile`, comes back and opens the panel sees what they wrote,
where a cache would have shown them the old text and a store would have needed an invalidation path
to avoid it. And nine test files mock `useHasProfile`; leaving the export alone leaves all nine
alone.

**This reverses a decision written down in [useProfile.ts](../../src/web/useProfile.ts)** — *"The
text never reaches these panels: they have no use for it."* They have one now. The reversal is
narrow, and `useProfile: boolean` on a generate request is untouched: a client that could *supply*
profile text is a way to put arbitrary text into a prompt, and that stays impossible.
`GET /api/metadata/:slug` has shipped `profile` to the client since the metadata page was built, so
this is the second door rather than the first.

### The slug is already there

Neither `UseProfile` nor `WrittenForYou` has a slug today, and none of the three panels takes one —
Sol's eighth finding, and the reason "five one-line changes" was wrong.

But it needs no threading. `useGlossary(slug, read)`, `useSummaries(slug)` and `useIdeas(slug)` all
hold it, and their owner interfaces already carry `hasProfile` with a docstring saying *"Resolved
here rather than in the panel because the slug is here."* `slug` joins it on the same object, which
the panels already receive. `ChatPanel` and `Tweets` have theirs directly.

**Required, not optional.** A panel without a slug could not name the article whose purpose it is
showing, and would have to render `purpose: null` as if the reader had written nothing.

## The pieces

| File | What happens |
|---|---|
| `src/routes.ts` | `resolveProfile` splits into `resolveProfileParts`; `GET /api/reader` gains `purpose` |
| `src/web/ProfilePanel.tsx` | **new** — the popover and its `👤` trigger, on `ColourPicker`'s shape |
| `src/web/WrittenForYou.tsx` | `UseProfile` takes `slug`, renders the trigger even with no profile, hides only the checkbox; the badge opens the panel and loses its dead tooltip |
| `src/web/useGlossary.ts`, `useSummaries.ts`, `useIdeas.ts` | `slug` onto the owner interface, beside `hasProfile` |
| `src/web/ChatPanel.tsx`, `Tweets.tsx` | pass the slug they already hold |
| `src/web/styles.css` | § profile: the popover, the trigger, the two blocks inside 352px |
| `docs/project/reader-profile.md` | the panel, the reversal, and the dead link that started it |

`useProfile.ts` is untouched. `Metadata.tsx` is untouched. `ProfileBox`, `useDictationField` and
`usePurpose`-that-never-was are all out of scope.

## The things that will go wrong

**Links inside a floating panel are the whole point, so prove they are reachable.** `.tooltip-anchor`
is `pointer-events: none` and `ProfilePanel` must not inherit that. **jsdom has no layout and will
report any link as reachable**, so the unit test cannot see this — it is the same shared assumption
that let the current dead link ship. The `elementFromPoint` probe re-runs against the finished panel,
in a browser, as a gate.

**Two panels open at once.** Two triggers can be on screen — the badge and the checkbox's button.
`useDismiss` should close the first when the second is pressed. Should, not does; check it.

**352px, and 288px.** `.tooltip`-class panels are `max-width: min(22rem, calc(100vw - 1.75rem))`;
the band is 400px at `MODE_IDEAL` and 288px at `MODE_MIN`. A 1,500-character profile needs a line
clamp and an overflow that scrolls inside the panel rather than growing it off screen.

**A profile the reader has not written, and one that could not be read.** Three states, not two:
written, empty, and *the fetch failed*. The third must not render as the second — a reader told
"nothing written yet" about a profile they wrote last week will go and write it again.

**Escape inside the panel.** The reading view's `keynav` listens on `window`, but it returns unless
the key is an arrow and already ignores typing targets, so the `stopPropagation` the previous version
of this plan wanted was unnecessary **and would have swallowed Escape** before `useDismiss` saw it.
Sol's ninth finding. Nothing goes on the wrapper.

**The visitor path.** A visitor makes no `/api/reader` request today, and that holds structurally —
owner hooks are not mounted for them. Preserve it, and test it, because the guard is a component
boundary rather than a check anybody can see.

## Tests

| Test | What it holds |
|---|---|
| `tests/routes.test.ts` | `GET /api/reader?slug=` returns the article's `purpose`; with no slug the field is present and `null`. The four whole-body `toEqual`s stay whole-body |
| `tests/profile-panel.test.tsx` | opened from the real `UseProfile` **with `hasProfile: false`**, which is the state the trigger has to survive: both blocks say "nothing written yet" and both links are rendered |
| `tests/profile-panel.test.tsx` | click opens, Tab reaches the first link, Escape closes, focus returns to the trigger — the four things `role="tooltip"` would have broken |
| `tests/profile-panel.test.tsx` | a failed `/api/reader` renders "we couldn't read your profile", not "nothing written yet" |
| `tests/profile-panel.test.tsx` | the trigger is present while `disabled` (a job is running) even though the checkbox is not |
| `tests/visitor-gaps.test.ts` | a visitor makes zero `/api/reader` requests |
| browser gate | `elementFromPoint` at each link's centre returns that link, at 400px and at 288px |

Every one of these is written to fail first. The reachability one in particular: **run it against the
panel before the `pointer-events` fix**, or it is a test that has never been red.

## Deliberately not

**No editing in the band**, which is the decision above and the reason this plan is small.

**Not a third box.** The summary panel's steer stays out of the panel: it is one rewrite of one
artefact, read by summaries only, and putting it beside two durable boxes would blur the carve-up
[reader-profile.md](../project/reader-profile.md#there-was-a-third-box-and-it-was-a-copy-of-the-second)
draws.

**Not a way to see the joined string.** `renderProfile`'s output — the two halves with their
prefixes, as the model receives it — is the wrong altitude for a reader. The two boxes are what they
wrote; the joining is ours.

**Not a new band mode.** The band's modes are a curated list of nine in
[`src/modes.ts`](../../src/modes.ts), each one reader-facing in the dock, the URL, page titles and
the public shell, and each new one has cost that list a word. A profile editor is not a way of
reading the article.

**Not on the public view.** A visitor has no profile and no checkbox.

## What the review of the built code found

[260830c-profile-panel-code-review-sol.md](260830c-profile-panel-code-review-sol.md). Verdict was STOP again, on
three correctness defects and one wrong justification. All four are fixed; each is written up where
it belongs rather than only here.

| # | Finding | Where it went |
|---|---|---|
| 1 | `/api/reader` is cached offline, and `PATCH /api/library/<slug>` invalidated only its own prefix — so the panel could serve last week's purpose as current, and `hasProfile` could stay `false` for a reader who had just written one | `lib/api.ts` § `saving` names the second resource |
| 2 | `resolveProfileParts` swallows a shelf failure, so a shelf that fell over rendered as "you never wrote this" | `purposeFailed` on the route; the panel shows it |
| 3 | The `live` boolean does not survive StrictMode's double-mount — the first request could land last and overwrite the second | a generation counter, as `useProfile` already uses |
| 4 | The strings were *already* fetched eagerly by all five `useHasProfile` callers, so "the panel fetches its own so we don't send it five times" was false | the justification corrected in the code and the docs; consolidating the six reads into one deferred, with its price named (nine test mocks) |
| 5 | A legacy whitespace-only value comes back truthy beside `hasProfile: false` | normalised on the way out |

Finding 5 is worth one more line, because the first test written for it **could not fail**: it posed
a whitespace-only *global profile*, and `loadReaderProfile` already normalises on read, so the state
was unreachable. The reachable half is `purpose` — the shelf normalises on write and reads raw
(`src/shelf.ts`). A fixture aimed at the wrong half is a green test about nothing.

Sol also cleared several things I had expected to be wrong, and those are worth recording so nobody
re-litigates them: no cross-reader leak (the route is authenticated, Postgres reads are
owner-filtered, public components never mount these hooks); two panels do not stay open together,
because a second pointer press dismisses the first; the badge's tab count is unchanged, since the
old `<span>` already had `tabIndex={0}`; and no `.prof-use` / `.prof-badge` selector was missed by
the move to `.prof-row`.

## Sequence

1. `resolveProfileParts` and `purpose` on `GET /api/reader`, with the four `toEqual`s updated.
2. `slug` onto the three owner interfaces; `ChatPanel` and `Tweets` pass theirs.
3. `ProfilePanel` on `ColourPicker`'s shape, and the CSS.
4. `UseProfile` gains the trigger and stops hiding it with the checkbox; the badge is repointed and
   its tooltip removed.
5. Browser gate at 400px and 288px: open, Tab, Escape, and the `elementFromPoint` probe on both
   links — run once against the unfixed panel to watch it fail.
6. Docs, then the review of the built code.
