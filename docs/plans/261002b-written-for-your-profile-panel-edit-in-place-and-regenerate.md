# "Written for your profile": one panel in every personalised mode, edited in place, with Regenerate

Report: [SPIDERYARN-READING2-7S](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-7S)
(`spya-nq6hnu`), Overseer queue item `qi-wht47dea`. Owner entry point:
[reader-profile.md](../project/reader-profile.md).

> I like the "This was written for your profile" icon & panel in the top-right of the Summary mode.
>
> Make that a reusable component that shows up in any modes where the output is personalised.
>
> And if possible, allow them to edit the text inline (rather than having to click out to separate
> pages.
>
> I suppose if they do edit or if the profile has changed since the mode generated, then it should
> show a handy "Regenerate" button in that mode's "This was written for your profile" panel.
>
> — Greg, 2026-10-01, on `/read/what-if-we-had-bigger-brains-imagining-minds-beyond-ours?mode=summary`

## Where things stand

- **The reusable component already exists.** `<WrittenForYou>` ([WrittenForYou.tsx](../../src/web/WrittenForYou.tsx))
  is the badge, and it opens `<ProfilePanel>` ([ProfilePanel.tsx](../../src/web/ProfilePanel.tsx)).
  It is in Summary, Glossary, Quotes, Ideas and Tweets. So the first ask is mostly *coverage*.
- **The panel is read-only on purpose.** On 2026-08-30 the plan's editable draft was dropped after
  GPT Sol found two ways a popover loses text: dictation's unmount *aborts* (so dismissing mid-dictation
  throws the words away), and save-on-blur never fires when an outside press unmounts the textarea.
  Greg chose read-only knowing that ([reader-profile.md § And the third thing](../project/reader-profile.md)).
  **His report now asks for editing, so this plan reverses that** — and has to close both holes rather
  than reopen them.
- Since then, the two boxes gained a shared autosave: `ProfileBox` + `useAutosavedText` (one save at a
  time, idle save after 2s, flush on hide, `keepalive` on `pagehide`), and `PurposePrompt` already puts
  that pair inside a dialog with a *Done* latch that closes only once the save has landed. That is the
  pattern to reuse.
- **The neighbour (261001m, shared output for everyone) was deferred by Greg on 2026-10-01**:
  everything stays personalised for the owner. So "which modes count as personalised" does not wait
  on it; it is simply "the modes whose output is written from the profile".

## Which modes are personalised (inventory, 2026-10-02)

| Mode | Profile in prompt | `profileChanged` on the GET | Badge today | Plan |
|---|---|---|---|---|
| Summary (plain words) | yes | yes | yes | add Regenerate |
| Glossary | yes | yes | yes | add Regenerate |
| Quotes | yes | yes | yes | badge edits; **Regenerate deferred** (its forced run appends) |
| Ideas | yes | yes | yes | add Regenerate |
| Tweets | yes | yes | yes | add Regenerate |
| Sketch | yes | yes | no (a caveat line) | **add badge** + Regenerate |
| Skim | yes | yes (stricter rule) | no (its own banner) | **deferred** (it has its own purpose editor) |
| Illustrated | inherits the Sketch's | yes | no | deferred |
| Quiz | yes | **no** | no | deferred |
| Chat, explanations, link cards | yes, per turn | no artefact stamp | no | deferred |
| FAQ, Timeline, Debate, Citations, Cross-refs | no | no | no | not personalised |

## What gets built

Revised after GPT Sol's plan review
([261002b-…-plan-review-sol.md](261002b-written-for-your-profile-panel-plan-review-sol.md)): four
P1s, all checked against the code and all real. What each changed is marked **(Sol)**.

### Stage 1 — the panel edits in place

`ProfilePanel`'s two read-only boxes become two `ProfileBox`es, each on its own `useAutosavedText`:

- **About you** saves with the same `saveProfile` / `leaveProfile` `useProfile` uses (exported from
  `useProfile.ts`, not copied — it also forgets the link cards' summaries).
- **Why you're reading this one** saves with `savePurpose` / the `leavingFetch` PATCH, exactly as
  Metadata and `PurposePrompt` do.
- Seeded once from the open-time `GET /api/reader?slug=` it already makes. A failed read, or
  `purposeFailed`, shows that half as unreadable — never an empty box the reader could save over the
  sentence we failed to read. **And an offline copy counts as a failed read (Sol):** `apiFetch`
  answers a failed GET with the cached body as a `200` marked `x-spideryarn-offline: copy`; edited, it
  would overwrite newer text on reconnect. Offline, the panel shows the copy read-only and says so.
- **The two `Edit →` links go (Sol).** Each was a way out of the panel that skipped the save, and the
  editing they led to is now here. `/profile` stays reachable from the Command bar.

**Where words could be lost, and what closes each:**

1. **Dismissing with words unsaved.** Outside press and Escape do not close the panel while either box
   is pending (dirty, saving, refused) or a save is in flight: they commit both and the panel closes
   when both are clean — `PurposePrompt`'s *Done* latch. A refused save keeps it open with the server's
   reason in the box's status line. A *Done* button does the same explicitly.
2. **Dismissing mid-dictation.** `ProfileBox` gains an optional `onBusyChange(busy)` (microphone armed,
   or transcript on its way). While busy the panel does not dismiss.
3. **The panel unmounting under the reader (Sol)** — switching mode from the dock, changing article:
   the band unmounts whatever the popover thinks. `useAutosavedText` flushes on `visibilitychange` and
   `pagehide` but not on unmount, so it gains one more: **on unmount with text pending, it fires
   `leave`** (the `keepalive` PATCH it already uses for `pagehide`). That also fixes the same gap on
   the metadata page. A *dictation* in progress when the band unmounts is still aborted — the
   behaviour every `ProfileBox` has today, with the device recording kept for recovery
   (`keepDictation`); it is named here rather than closed.

The *badge* stays a label. The panel it opens now holds the controls Greg asked for, which is an
explicit exception to 2026-08-30's rule ("a label must not offer to regenerate the text it
describes"), recorded in the docstring with his words.

### Stage 2 — Regenerate in the panel

`WrittenForYou` takes an optional `regenerate: { run(): void; busy: boolean; refresh(): void }`.

- **Shown only when the server says the profile changed** (`changed`, i.e. `profileChanged` from the
  mode's own read) **(Sol)**. Not on "a save happened here": an edit reverted, or whitespace the server
  trims, would offer a paid call for text that is still current — and for an append-capable step,
  append. After a save from the panel settles, the panel calls `refresh()` — the mode re-reads, and
  the server's hash comparison decides. No client-side hashing.
- **Disabled while either box is pending or in flight, or a dictation is busy**, so a regenerate cannot
  start before the new profile has landed and then be stamped as current.
- Pressing it calls the mode's existing forced re-run and closes the panel; the mode's own progress row
  shows the job. No new endpoint or spend path.

Wired into, with the verb each uses and why it replaces:

| Mode | Call | Why it replaces rather than appends |
|---|---|---|
| Summary | `useSimple.regenerate` | the step always replaces |
| Ideas | `useIdeas.regenerate` | always replaces |
| Tweets | `useTweets.regenerate` | always replaces |
| Glossary | `useGlossary.more` | forcing appends only when the profile hash **matches** (`existingFor`, src/glossary.ts); Regenerate is shown only when it does not, so this rewrites |
| Sketch | `useSketch.regenerate` | always replaces; badge added, its duplicate *"drawn for a reader profile you have since changed"* caveat removed, and its *"no paid redraw beside the picture"* comment updated to name Greg's request **(Sol)** |

Each owner hook exposes `refresh` (its read already has one). Visitors get none of it — every badge is
already owner-only.

### Tests, red first

- `profile-panel.test.tsx` (jsdom): both boxes seeded; typing then blur PATCHes the right endpoint;
  outside press while dirty does not close until the save resolves; a refused save keeps it open; busy
  dictation blocks dismissal; an offline copy is read-only; Regenerate absent when unchanged, present
  when `changed`, disabled while a save is in flight, calls `run` and closes; a settled save calls
  `refresh`.
- `useAutosavedText`: unmount with pending text fires `leave`; with nothing pending, does not.
- Glossary wiring: the panel's Regenerate posts a **forced** glossary job.
- The popover's real reachability is a **browser** check (jsdom cannot see `pointer-events`), desktop
  and 390px, in Summary and one other mode.

## Simpler options passed over

- **Keep it read-only and just add Regenerate.** Smallest, but Greg asked for inline editing by name.
- **Edit with no microphone in the panel** — would remove hazard 2 outright. Passed over because the
  microphone is how Greg writes these on an iPad, and the `onBusyChange` guard is a few lines.
- **Auto-regenerate after an edit.** A paid call nobody pressed; the button is the decision.

## Deferred, named

- **Quotes' Regenerate (Sol).** Its forced run appends to a current list, and appends across a profile
  change while keeping the first pass's stamp (src/quotes.ts § existingFor), so pressing it would
  lengthen the list and leave the badge saying *changed*. It needs a replace intent in the job
  contract. Quotes keeps the badge and the in-place editing.
- **Skim (Sol).** It already has its own editor for the same purpose sentence (`PurposeLine`) and a
  stricter staleness rule with its own banner; a second editor beside the first could overwrite it.
- **Quiz** — personalised, but its GET carries no `profileChanged` (a server change), and regenerating
  it throws away the reader's answers; that trade-off is Greg's.
- **Illustrated** — inherits the Sketch's profile; regenerating means a new painting at image prices.
- **Chat, explanations, link cards** — no stored provenance yet (reader-profile.md § What is still open).
- **Other badges on the page after an in-panel save** keep their old `changed` until their mode
  re-reads (switching mode does).
- **Dictation aborted by an unmount**, as above.
- **Sol's larger alternative** — one owner-level editor mounted outside the mode switch — closes the
  unmount hole fully but has to carry each mode's regenerate across a mode change; heavier than the
  unmount flush for what remains.
