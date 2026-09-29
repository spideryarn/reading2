# Dictation that survives a closed tab

SPIDERYARN-READING2-5M (`spya-bukkzu`), from Greg (admin, verified by account id), filed from the
Feedback dialog. Follows 5B, which shipped the tape rotation earlier today
([260929f](260929f-feedback-thank-you-as-a-toast-and-dictation-that-never-runs-out-of-tape.md)).

> I often find myself really saying a lot into these feedback boxes, talking for a few minutes, and
> I would be really sad if at the end of a few minutes of really rich thought, the contents got lost
> because, I don't know, there was a bug or the internet connection dropped or something like that.
> [...] don't go to great lengths, but, you know, if there's an easy, simple, clean way to make
> things robust, so maybe you store the audio or you just upload the audio if the transcript failed
> or something. [...] or maybe say, look, it failed but nothing's been lost. Try again when you have
> an internet connection. That's always a bit dodgy because the browser may just kind of throw away
> the tab. [...] try and make this voice input machinery pretty reusable across all the other places
> where we're doing it so that they all benefit from this.
>
> — Greg, 2026-09-29

## Where a dictation can be lost today

| When | What happens today | Lost? |
|---|---|---|
| Upload fails (offline, 5xx, timeout) | audio kept **in memory**, Try again + Save offered | no — unless the tab goes |
| Tab closed, reloaded, crashed, or discarded by the browser while recording | the tape is in memory only | **yes, all of it** |
| The same, after a failed upload, before Try again worked | same | **yes** |
| Box unmounted mid-dictation (navigating away from an article's chat) | tape cancelled on purpose | **yes** |
| Transcript landed in the box, tab closes before the box is sent | the box's own business | yes (text) — see § Not in this |

The first row is already handled (260905, 260929f). **Every real loss is the tab going away**, which
is exactly the case Greg calls dodgy. So the one change is: **keep the recording on this device until
its words are safely in the box**, and offer it back the next time that box is on screen.

## The design

```
 press ──▶ recorder chunk (every 1s) ──▶ IndexedDB  (this device only)
                                             │
 transcript lands in the box ─────────────▶ forget
 reader presses Discard ──────────────────▶ forget
 empty answer / too short / device change ▶ forget
 tab dies, upload fails, box unmounts ────▶ stays ──▶ next time that box mounts:
                                                      "A recording from earlier wasn't transcribed.
                                                       Nothing was lost. [mic-recovered]"
                                                       [Try again] [Save] [x]
```

1. **One seam, in the contract file.** `transcriber.ts` gains a `DictationKeeper<C>` interface —
   types only, no imports — and `useDictation` / `useDictationField` take an optional `keep`. The hook
   never learns where things are kept, exactly as it never learnt where things are transcribed. The
   fleet dashboard passes nothing and is unchanged, so `tests/fleet-imports.test.ts` stays as it is.
2. **The product's keeper, `src/web/dictation-keep.ts`,** on `idb` (already a dependency, as
   `offline-store.ts` uses it). One database, two stores: `tapes` (id, user, box, where, startedAt,
   broken) and `chunks` (tape, part, seq, blob, mimeType, at). Every write is best-effort and
   swallowed — a keeper that fails must never touch the dictation it is keeping.
3. **Written chunk by chunk,** from a new `onChunk` event on the tape (`mic-recording.ts`, the moment
   a chunk is accepted). So a tab that dies mid-sentence loses at most the last second. A part's
   chunks, concatenated in order, are the same bytes the in-memory part would have held — the
   in-memory Blob is built exactly that way.
4. **Which box.** Each caller names its box: `keepDictation("feedback")`, `keepDictation(`chat:${slug}`)`,
   and so on for all six. The recording is offered back only in the box it was made in, and is
   transcribed against the `where` snapshotted when it was recorded, not the box's current one.
5. **Which account.** Rows carry the signed-in reader's id (`lastKnownUser()` from the offline store)
   and are only offered back to that id. No id, no keeping.
6. **Which tab.** Two tabs both mount the Feedback dialog. A tape being recorded — or held after a
   failure — in tab A must not be offered by tab B. **Web Locks**: the page holding a tape holds the
   lock `spideryarn-dictation:<id>`; a recovery takes it with `ifAvailable`, so only a tape nobody
   holds can be recovered, and only by one page. The browser releases a dead tab's locks. No Web
   Locks (pre-2022 browsers) means no keeping, rather than a guess.
7. **Recovery** runs when a box with a keeper mounts: the oldest unheld tape for this box and reader
   is claimed and becomes the hook's existing `recording` + `retryable`, so the **existing** Try
   again / Save / Discard row is the whole UI. Try again uses the existing `retry`, which inserts at
   the caret and calls `onEnd`. A tape that broke in-session is recovered save-only, as it was
   in-session.
8. **Forgotten when** its words are in the box (first try or retry), the reader discards it, the
   answer was empty (`[mic-silent]` still shows the audio for this page, but there is nothing to
   recover), the tape left nothing (too short), or the reader changed microphone mid-dictation.
   **Released, not forgotten,** when the page stops holding it: a second press in the same box, or
   an unmount. It then comes back next time. **Aged out** after seven days, swept at startup
   (revised after review).
9. **The words say so.** The row under a failed dictation says the audio is kept on this device even
   if the page closes, when a keeper is holding it — Greg's "it failed but nothing's been lost".
10. **Privacy.** `/privacy` says what the browser keeps; it gains the unfinished recording and the
    week. The button's promise (what goes to OpenRouter and OpenAI, and not our servers) is
    unchanged and still true.

## Decisions taken, and the simpler options passed over

- **Deleted on a deliberate Sign out, not on a lapsed session** (revised after review; it first
  said "not deleted on sign-out"). A spurious sign-out — a failed token refresh — must not be the
  silent loss this exists to stop; pressing Sign out on a shared machine should leave nothing.
- **Passed over: keep only after a failure.** Simpler, but it misses the tab dying *during* a
  three-minute monologue, which is the case Greg named.
- **Passed over: upload the audio to our storage when transcription fails.** Needs the network that
  just failed, adds a server path and changes the privacy promise ("we don't save it on our
  servers"). The device is the one place that is always there.
- **Passed over: a heartbeat instead of Web Locks.** A timestamp every few seconds and "stale after
  N" is guesswork with two knobs; locks are exact and the browser releases them for us.
- **Passed over: auto-retry when the connection comes back.** Cheap, but it puts words into a box
  at a moment the reader did not choose. Try again is one press.

## Not in this (deferred, named)

- **The Feedback box's typed or transcribed text is not kept across a reload.** Once the words land
  in the box, the keeper forgets the audio, and the draft lives in React state. Keeping the Feedback
  draft in `localStorage` is the natural next step and is small, but the dialog's draft lifecycle has
  a history of its own bugs (`discard` in `FeedbackDialog.tsx`), so it is its own change.
- **An offer outside the box.** A recording kept for the Feedback dialog is offered when the dialog
  next opens, not announced on the page.
- **Live words on Chromium.** A recovered tape has no session, so the rough live words from the
  dead tab are gone with it; the transcript arrives fresh at the caret.

## Revised after GPT Sol's plan review

Sol's review (2026-09-29, read-only) found two P0s, four P1s and a P2. What changed:

- **P0-1, a crashed tab's chunks are not promised to be a playable file.** True of the spec. Kept the
  per-chunk design, but a tape records `complete()` once every recorder finished, and one recovered
  without it is offered under **`[mic-cut-off]`** ("the last few seconds may be missing"), never
  "nothing was lost". Missing chunks (a write that failed) count as incomplete too. **Measured**
  rather than assumed: a spike in Chrome 151 (`decodeAudioData` on the first 3, the first 5, and all
  chunks without `stop()`) decoded every WebM and fragmented MP4 cut, losing under a second. Safari
  is unmeasured. Sol's alternative — shorter parts, persisting only closed ones — trades a seam
  (~70 ms, 260929f) every 20 seconds for a guarantee the measurement suggests we do not need.
- **P0-2, forgetting audio whose words never landed.** `onTranscript` may now return `false` (the
  field's span proof refused them), and then the copy is released, not forgotten. The other half —
  the words are in the box, then the tab dies before Send — is the Feedback draft, and stays
  deferred below; it is the same exposure typed text has.
- **P1-3, box keys.** The full table: `feedback`, `chat:<slug>`, `comment:<id>`,
  `annotate:<block>:<start>`, `quiz:<slug>:<question>`, `profile:<field>`. Feedback stays one box
  for the site, knowingly: a recording is then filed with the URL of the page Feedback was reopened
  on, which is better than never being offered because the reader did not go back to that page.
- **P1-4, Feedback is mounted while shut.** It passes a keeper only while open, so a background
  tab never claims a recording nobody can see. The recovery effect has a cancellation flag, so
  StrictMode's second mount releases a late claim instead of showing it.
- **P1-5, "nothing was lost" when the keeper silently failed.** `KeptTape.intact()`; the row says
  the audio is kept on this device only when every write landed.
- **P1-6, privacy.** Explicit **Sign out** now deletes that reader's tapes (even one this page
  holds); a lapsed session does not. The week is enforced by a sweep at startup, so the promise is
  "the first visit after a week", and `/privacy` says exactly that.
- **P2-7, simpler v1 (closed parts only).** Considered and not taken: it misses the tab dying during
  a three-minute monologue, the case Greg named.

## Stages

1. **Keeper + hook seam + all six boxes + copy + tests.** One stage; it is small.
   Tests: `onChunk` in `tests/mic-recording.test.ts`; the hook with a fake in-memory keeper in
   `tests/dictation-recording.test.ts` (kept while recording, forgotten on success, released on
   unmount, recovered and retried on remount, not forgotten on upload failure); the IDB keeper with
   `fake-indexeddb` and a fake `navigator.locks` (partition by user and box, held tapes skipped, age
   out).
2. Docs: `dictation.md` section, `privacy.md` + `/privacy` sentence, note in `docs/user-feedback/`.

## Status

- [x] Plan reviewed by GPT Sol (above)
- [x] Stage 1 built: keeper, hook seam, six boxes, sign-out, startup sweep, copy. Tests:
  `tests/dictation-keep.test.ts` (14) and `tests/dictation-keep-hook.test.tsx` (15), each checked
  by mutation — nine mutations of the code, all killed.
- [x] Stage 2: dictation.md § A closed tab, privacy.md, `/privacy`, the note.
- [ ] Sol code review
- [ ] Landed on dev
