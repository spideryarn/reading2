# Ask why you are reading, and a Trajectory for that intent

Status: shipped on `dev` 2026-09-30, not deployed. Sentry SPIDERYARN-READING2-60, from Greg (admin, verified by account id),
on `nihms-536461-spya-nr87dn`. Note:
[260930_0905](../user-feedback/260930_0905-ask-why-you-are-reading-and-a-route-for-it.md).

> So the feedback I keep getting is that people want to come with an intent and perhaps a
> background, but a specific focused intent for what they want to get from the paper. So we
> definitely do want to ask people that, you know, why are you reading this in a prompt when they
> first open it. And then, so the follow-up idea to that is maybe, so they can already use the
> semantic search, but maybe they could also, maybe there'd be a way to create custom trajectories.
> So there'd be a search box in the trajectory mode to add a new custom trajectory, because that
> would keep them grounded in the paper, but also, you know, I don't know, think about whether
> there's a best of both worlds that somehow marries the trajectory and search without, or maybe
> there's a single extra trajectory that's added that's specific to their reading intent if they
> provided one.
>
> — Greg, 2026-09-30

## What is already there, which changes the question

- **The answer already has a home.** `articles.purpose` — *Why you're reading this one*, per
  article, 600 characters — has existed since 2026-08-26 ([reader-profile.md](../project/reader-profile.md)).
  It reaches every profiled prompt: glossary, quotes, ideas, tweets, summaries, chat, explain, and
  the Trajectory route. **But it is only asked for on the Metadata page**, which a reader reaches
  on purpose or not at all. So "we definitely do want to ask people" is not a new field; it is
  asking for this one at the right moment.
- **The route already bends to it.** The Trajectory call is handed the profile and the purpose, and
  the Quotes the route stops at are profiled too. A reader who has said *"I want to know how they
  handled missing data"* already gets a route planned for that — if they said it before the route
  was planned.
- **Timing is everything.** Since 260930c the add page queues Tweets, Glossary, Quotes, Ideas and
  Trajectory the moment an import finishes, and each job freezes the profile when it is posted
  (reader-profile.md § One profile per job). A purpose saved *before* those POSTs means every one of
  them is written for it from the start. Saved *after*, they are all written without it, Trajectory
  goes stale, and the rest carry a "profile changed" label — a second spend to get what the reader
  asked for.

## What this ships

### Stage 1 — ask on the add page, while the import runs

The import is a ~45-second wait (median; the `hierarchy` step) on a page the reader is already
watching. That is the "when they first open it" moment, and it is the only one where answering
costs nothing extra.

- An optional box under the auto-modes tick box, shown in the same interval (`offerAutoModes`):
  **"Why are you reading this?"**, placeholder *e.g. I want to know how they handled missing data*,
  600-character cap and counter (the existing `ProfileBox`, so it gets the same hint style;
  dictation is not added in v1 — see Deferred). Hint: *"Shapes the quotes, ideas, glossary and the
  reading route — for this article only. Never what the article says. You can change it later on
  the article's Metadata page."*
- **Completion is deterministic** (GPT Sol's consult, then its plan review F1, F2, F4). All three
  ways an add finishes — a job reaching `done`, an upload answered as an existing article
  (`alreadyArticle`), the retention-path `{article}` answer in the posting effect — **record**
  `{ key, slug }` into one piece of state; they no longer queue or navigate themselves. One
  render-driven transition then decides, reading the draft through a ref (a promise callback made
  by the posting effect would otherwise see the draft as it was when the request went out):
  - the draft is **empty after trimming and the box does not have focus** → exactly today: queue
    the modes (if ticked), open the article;
  - otherwise → do not navigate. The phase becomes **ready**: *Ready* with **Save and open** (and
    ⌘/Ctrl+Enter in the box) and **Open without it**. It waits indefinitely; a blur or a pause is
    not a decision.
  - **Save and open**: if the draft is non-empty, `PATCH /api/library/<slug> { purpose }` and
    **await** it; then queue the modes; then navigate. The save happens whether or not the tick box
    is ticked — chat and explain read the purpose too. **An empty draft is never sent** (F1): a
    PATCH of `null` clears the stored purpose, and on a re-add that would erase a sentence the
    reader cannot see on this page. Empty means "leave it alone", always.
  - **If the save fails**, back to *ready* with the draft intact and the error beside it; nothing is
    queued (no unprofiled modes).
  - The phases are a discriminated union — `running | ready | saving | opened` — and a synchronous
    ref guards the terminal decision, so StrictMode's second effect, or a double press of the two
    buttons, queues and navigates exactly once. Both buttons are disabled while *saving*.
  - The purpose box is drawn from this state, not from `offerAutoModes` (F4): shown while the add
    runs and through *ready* and *saving*; the tick box keeps its own predicate.
  - The box is a plain `<textarea>` with the shared classes, not `ProfileBox` (F5): `ProfileBox`
    commits on blur and on the shortcut alike, and brings dictation, and here blur must do nothing.
- **Retry after a failed import** (F3, found by the review, pre-existing): the add page keeps
  watching the failed job's id while Retry makes a new one, so a retried import that succeeds
  never opens. To be confirmed red-first; if real, `retry` reports the replacement job and the add
  page follows it — otherwise a typed purpose would be stranded on a page that never finishes.
- **What "written for it from the start" rests on** (F7): `patchShelf` commits before it answers,
  and each `POST /api/jobs` resolves the profile from Postgres, so on the normal path every queued
  mode reads the new purpose. `resolveProfile` fails open on a shelf read error (a job must not die
  over a purpose), so in that rare case a mode is written without it and carries the ordinary
  label. Not worth new machinery; stated rather than promised.
- One small client module, `src/web/purpose.ts`: `savePurpose(slug, text)` — the PATCH, the
  server's normalised answer back, and `forgetSummaries()` (the link cards were written from the old
  sentence; Metadata already does this). Metadata's `savePurpose` calls it, so there is one PATCH
  for the purpose in the client, not two. And `usePurpose(slug)` for stage 2.

### Stage 2 — Trajectory says what it was planned for, and asks when nobody has said

The in-reading-view half of "ask when they first open it", put where the answer is used at once, and
the visible half of "a trajectory specific to their reading intent".

Owner only (a visitor never sees or is asked for the owner's purpose). A compact line in the band,
above the list (and in the empty state):

```
  ┌─ TRAJECTORY ────────────────────────────── ⓘ ┐
  │  ● ● ○ ○ ○        Gist · More · Most          │
  │  Reading for: how they handled missing …  Edit│  ← purpose set
  │  1  Results › Imputation                      │
  │     "We used multiple imputation …"           │
```

```
  │  What do you want from this piece?            │  ← no purpose yet
  │  ┌──────────────────────────────────────────┐ │
  │  │ e.g. how they handled missing data       │ │
  │  └──────────────────────────────────────────┘ │
  │  [ Plan the route for this ]   a few cents    │
```

- **Purpose set**: *Reading for: …* on one line, the whole sentence in a tooltip, and **Edit** — a
  link to the Metadata page's box (`/read/<slug>/metadata`), which is where it is edited. When the
  route was planned for a *different* profile, the existing profile-changed banner already says so
  and offers *Plan it again*; this line does not repeat it.
- **No purpose, and a route already on screen**: the box and **Plan the route for this**. Pressing
  it saves the purpose (`savePurpose`) and, once that has answered, calls `ensure()` — unforced is
  enough, because a route's stamp carries the profile hash and the server re-plans a route written
  for a different profile (src/pipeline.ts; Sol F6/answer 3), and unforced de-duplicates better. The
  button is disabled while a Trajectory job is starting or running. It re-plans **the route only**,
  over the existing Quotes: the other modes then carry their ordinary "profile changed" label and
  are not rewritten behind the reader's back. The note beside it says it is a paid call.
- **Not in the empty state** (Sol F6). When there is no route yet, `useAutoRun` plans one the moment
  the mode opens; a box there would race it and pay for two differently profiled routes (the
  profile is in the job's work key, so they do not de-duplicate). A new article's purpose comes from
  stage 1; an old article with no route gets the ordinary automatic run, and then the box.
- If the purpose could not be read (`purposeFailed` from `GET /api/reader?slug=`), the line is not
  drawn at all rather than inviting the reader to type over a sentence they already wrote.

## What this passes over, and why

- **A "Your question" walk in Trajectory built from a meaning search** (2b in the consult — the
  real "marry trajectory and search"). Opus recommended building it now, through an adapter that
  feeds a `SearchRun`'s hits into `useTrajectoryMode` as synthetic quotes and stops (≈200 lines, the
  route arithmetic untouched). Sol recommended against it for v1. **It is deferred, and the reason
  is a defence, not the size**: a saved search is published to every visitor of a public article,
  criterion included (`PublicSearchRun`, src/public-types.ts; built in `src/public/dto.ts`). A search
  run from the reader's purpose would publish the purpose, which is owner-only everywhere else. Not
  publishing it means a filter in the public DTO — a file
  [security-map.md](../project/security-map.md#where-the-defences-physically-live) lists as a
  defence — or a separate private artefact. An unattended run does not edit a defence, so this is
  written up for Greg (§ For Greg) rather than built.
- **Several saved custom trajectories** (Greg's "search box in the trajectory mode to add a new
  custom trajectory"): the same blocker, and more UI. After the walk above.
- **A general first-open card in the reading view** (1b). Needs "was asked" state, and an answer
  given after the modes were generated costs a second spend. Stage 2's prompt, inside Trajectory, is
  the targeted version. Revisit if readers skip the add-page box.
- **Refreshing Quotes and Ideas for a changed purpose.** *Plan it again* re-plans over the existing
  Quotes, which may have been chosen for the old purpose (Sol's trap). A truthful "refresh for this
  purpose" would regenerate Quotes, Ideas, then the route (≈20¢, not 2¢). Deferred; named here.
- **Dictation on the add-page box.** `ProfileBox` takes the microphone through `DictationStrip`
  elsewhere; the add page has never loaded it. Easy to add later; kept out so stage 1 stays one
  file's worth of behaviour.

## For Greg

1. **The "Your question" walk.** Wanted? If yes, the one decision it needs from you: may a search
   made from your purpose stay private on a public article — i.e. may we add a `private` flag to
   saved searches and leave those out of the public page (an edit to `src/public/dto.ts`, a
   defence)? The alternative is a separate private artefact for the walk, which is more code and no
   more private. Either way it is the adapter Opus sketched: a switch *Whole paper · Your question*
   above the depth control, the hits walked in paper order after a confidence gate, each stop's cue
   the hit's one-line reason.

## Tests

- `tests/add-page-purpose.test.tsx` (or beside `tests/auto-modes.test.tsx`): untouched empty box →
  navigates as today; a typed box → no navigation on `done`, *Save and open* PATCHes **before** any
  `/api/jobs` POST, then navigates; a failed PATCH → stays, queues nothing; *Open without it* →
  queues and navigates without a PATCH; the existing-article completion path takes the same rule.
  Each watched red.
- The add page, table-driven (F8): each of the three completion producers × untouched, typed
  (Save and open), typed then save fails, typed then *Open without it*, touched-but-empty on a
  re-add (no PATCH at all), and StrictMode (one queue, one navigation); the PATCH lands before any
  `/api/jobs` POST; both buttons disabled while saving. Retry after a failed import, if F3 is real.
- Trajectory: the line for a set purpose; the box for none only when a route is ready; the press
  awaits the save and then calls `ensure` exactly once (a deferred PATCH → zero job POSTs until it
  resolves); disabled while a job runs; nothing for a visitor; nothing when `purposeFailed`.
- A browser check in a Sonnet subagent on the local dev server: import an article, type a reason,
  see *Ready*, press *Save and open*, confirm the purpose on Metadata and the Trajectory line.

## Progress

- 2026-09-30: consulted Opus and GPT Sol on the design
  ([prompt](260930e-ask-why-design-consult-prompt.md), [Sol's answer](260930e-ask-why-design-consult-sol.md); Opus's
  answer summarised above). Plan written.
- 2026-09-30: GPT Sol plan review ([prompt](260930e-ask-why-plan-review-prompt.md),
  [answer](260930e-ask-why-plan-review-sol.md); exit 0, file fresh). Verdict *revise before build*. Taken:
  F1 (P0 — never send an empty draft), F2 (a state machine for completion), F3 (to be confirmed
  red-first), F4, F5, F6 (no box in the empty state; `ensure` after the awaited save), F7 (claim
  narrowed, no new machinery), F8 (the test matrix). Sol also said the simplest v1 is stage 1 plus a
  read-only line; the one-press box is kept, but only where no automatic run can race it.
- 2026-09-30: stage 1 built (uncommitted, for review). `src/web/purpose.ts` (`savePurpose`,
  `usePurpose`); Metadata's box saves through it. AddPage: the three producers now only feed one
  derived `completion`; one effect decides; `running | ready | saving | opened` with a `claimed`
  ref. **F3 was real** — watched red: a retried import that succeeded never opened. Fixed as the
  plan said: `retry` answers `Job | null`, `JobCard` takes `onRetried`, AddPage follows it (seven
  test fakes changed from `async () => {}` to `async () => null`). Tests:
  `tests/add-page-purpose.test.tsx`, 30 cases, table-driven over the three producers; each guard
  also checked by mutating it out. Differs from the plan in three small ways: the tick box stays
  visible through *ready*/*saving*, because it is read at the press and the reader should see what
  they are choosing; the box has `maxLength` 600 rather than a counter that can go over, since an
  over-long draft would only fail after the import; and the Metadata page's local function is now
  `commitPurpose`, to leave the name `savePurpose` to the shared one.
- 2026-09-30: stage 2 built (uncommitted, for review). `PurposeLine` in
  `src/web/TrajectoryPurpose.tsx`, mounted by `TrajectoryPanel` over a ready route for the owner
  only; it reads `usePurpose(owner.slug)` itself, so no new prop crosses `TrajectoryAccess`.
  Tests: `tests/trajectory-purpose-line.test.tsx`, 12 cases; seven watched red before the
  component existed, and the five "draws nothing" cases (loading, read failed, `purposeFailed`,
  empty state, visitor) each checked by mutating its guard out, bar the visitor's, which the type
  of `owner` enforces. Differs from the plan in two small ways: under the stale or profile-changed
  banner the *box* is not drawn (the banner already offers *Plan it again*; two asks for one job),
  though a set purpose's line is; and **Edit** carries the view state (`carriedSearch`), as the
  dock's and masthead's Metadata links do, so its href has `?mode=trajectory`.
- 2026-09-30: stages 1 and 2 committed (`2313b333`, `fd03e37e`).
- 2026-09-30: GPT Sol code review, write-capable ([prompt](260930e-ask-why-code-review-prompt.md),
  [answer](260930e-ask-why-code-review-sol.md); exit 0, file fresh): three findings, all fixed by the
  reviewer red-first — C1 (P1) a purpose draft or a late save could follow the add page to a new
  `/add/` address; C2 (P2) a double press in Trajectory could PATCH twice; C3 (P1) Trajectory's
  saved purpose could show on the next article. Its trace confirmed the save → profile resolution →
  `profileHash` mismatch → unforced re-plan path. Committed as `966badb5`. A read-only round 2 on
  those fixes alone ([prompt](260930e-ask-why-code-review-2-prompt.md),
  [answer](260930e-ask-why-code-review-2-sol.md); exit 0, fresh): no findings, approve.
- 2026-09-30: browser check (Sonnet, Playwright, own dev server, commit `966badb5`): a typed
  purpose held the add page at *Ready*, *Save and open* opened the article and Metadata showed the
  sentence; an empty box opened straight away as before; in Trajectory the box, the press, a
  trajectory-only job running to done, and the *Reading for* line with a working Edit, with no
  horizontal overflow at 390px. It left test purposes on two local articles (`todo`,
  `pow-spya-fvrt2e`).
