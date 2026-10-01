# 261001l — "About you" saves itself and says so; the microphone warning stops crying wolf

Two of Greg's own reports from the Feedback dialog, both small, both in the profile-box/dictation
corner of the client. Note: `docs/user-feedback/260929_1517-autosave-about-you-and-mic-fallback.md`.

## 1. `spya-czbj9r` — the "About you" box

Greg, 2026-09-30:

> In the "Profile / About You", make it clearer when it has saved (e.g. show some loading spinner and
> then green-checkmark or similar. And if I try and close the page before it has saved, either warn
> the user, or auto-save. Maybe auto-save any time it has been idle for a few seconds?
>
> Perhaps this could be a reusable text-input-box auto-save component that we could reuse in other
> places (e.g. Article/Metadata/Why are you reading), etc?

### What is there now

`ProfileBox` is already the one box shared by `/profile` ("About you") and Metadata ("Why you're
reading this one"). It commits on blur and ⌘↵. Each page draws its own status line underneath —
`/profile` says *Saving…* in plain text and then *Saved when you click away, or with ⌘↵.*, which is
the same sentence before and after a save, so nothing ever says *saved*. Metadata has no saving state
at all. `useProfile` flushes on `visibilitychange`/`pagehide`; Metadata does neither.

### What changes

**The reusable piece is `ProfileBox` itself**, because it is already the shared box. It gains one
prop, `save: SaveState`, a discriminated union the page computes:

```
loading | clean | dirty | saving | saved | error(message)
```

and from that it does three things, so neither page has to:

1. **Draws the status line** — a spinner and *Saving…*; a green tick and *Saved*; *Not saved —
   reason* in the warning colour; *Unsaved changes* while dirty; *Saves as you type.* when clean and
   nothing has been saved this visit. `aria-live="polite"`. The two pages' hand-written lines go.
2. **Saves after 2 s idle** — a timer reset on every change of `value` while `dirty`, which calls
   `onCommit`. Blur and ⌘↵ still commit immediately. Not while dictation is running (the box is
   read-only then and `useDictationField` commits when the words land).
3. **Warns before leaving** — `beforeunload` with `preventDefault` while `dirty` or `saving`, and an
   ordinary `onCommit` on `visibilitychange → hidden` (which is what fires on iOS). `useProfile`'s
   own `pagehide` keepalive flush stays: it is the last-chance shot, and its de-dupe already copes.

**This reverses a written rule**, and the reversal is Greg's: `useProfile.ts` and `Metadata.tsx` both
say *"there is no debounce anywhere in this client"*, on the grounds that a timer makes a save that
can be in flight when the tab closes and a box saved three times mid-sentence. The first is now
covered by the warning; the second is the price of what he asked for, and 2 s of idle is a pause,
not mid-word. Those comments get rewritten with his words, not deleted.

**The bug autosave would otherwise introduce.** Both save paths write the server's normalised
answer back into the draft when the response lands. With blur-only saving, typing during the
round-trip was rare; with a 2 s idle save it is the normal case (pause, save starts, resume typing),
and the response would overwrite the words typed in the meantime. So the write-back becomes
conditional: `setDraft(d => d === sent ? stored : d)`. `useProfile` already guards *older* responses
with a generation counter; this guards against the *draft* having moved. Metadata's `commitPurpose`
gets the same, plus a generation guard and a `saving` flag it does not have.

*Saved* is shown from a successful response until the next edit (then *Unsaved changes*).

**Passed over:** a new standalone `<AutosaveTextarea>` used everywhere a textarea appears. The other
textareas (chat, comments, feedback) are send-on-submit, not saved state, so there is nowhere else
for it to go yet; the reusable unit is the box that already exists. The add page's "Why are you
reading this?" box saves with the article, not on its own, so it is left alone.

## 2. `spya-k3q9mc` — *"The microphone you chose isn't available. Using another one."*

Greg, 2026-09-29, in the Feedback dialog on an iPhone with AirPods, just after accepting the
permission prompt:

> The microphone you chose isn't available. Using another one. … Weirdly, it did actually seem to
> work. So the text got added, but it gave me this error message. I get the sense that usually
> there's a post-processing step where an LLM of some kind tidies things up. That didn't seem to run

### Did the clean-up run?

**Yes.** Production `ai_calls`, read-only: all five of his dictations in the five minutes before the
report (15:12–15:17 UTC) are `purpose = dictation`, `openai/gpt-transcribe`, `outcome = ok`, 0.7–2.7
s. On iPhone Safari there is no live recogniser, so the text that appeared in the box can only have
come from that call. There is no separate LLM rewrite after it — the "tidy" is the transcriber with
the box's vocabulary, then a deletion-only filter for ums ([dictation.md § The ums come
out](../project/dictation.md)). Nothing to fix there; the note says so.

### Why the warning fires

It shows when a remembered microphone (`spya.dictation.deviceId` in `localStorage`, written only by
the picker) is asked for with `deviceId: { exact }`, that request fails with
`OverconstrainedError`/`NotFoundError`, and the plain `{ audio: true }` retry succeeds
(`beginCapture` in `useDictation.ts`). So the code did what it says. The word *false* is in what it
assumes: that a stored id that no longer resolves means the device has gone. ~~Safari does not keep
`deviceId`s stable across visits when permission is asked per visit~~ — **struck after Sol's
review**: that was this plan's first guess and is not established (§ What GPT Sol's plan review
changed, 4). What is established is only that the stored id stopped resolving while dictation went
on working. Not reproducible on the box; the fix below is right whichever way the id went stale.

### What changes

- **Remember the device's label beside its id.** Written whenever an `exact` request succeeds
  (from `track.label`), so it is the browser's own name for what was actually opened.
- **When the exact request fails and the fallback opens a track whose label is the remembered
  one, it is the same microphone**: count it as honoured, no warning, and store the new id so the
  next press goes straight to it.
- **A preference stored before labels were kept** (id only) cannot be checked that way. On its
  first failure it is forgotten rather than warned about forever — the reader picks again if they
  care. This is the one place a preference is now dropped; the unplugged-headset case with a label
  keeps it, as before.
- **When it really is a different device, the warning names both** if the browser named them:
  *"Your chosen microphone (Jabra Evolve) isn't connected, so this is using AirPods Pro."* Falls back
  to today's sentence when labels are missing.

**Passed over:** re-resolving by label through `enumerateDevices` and reopening the matching
device. Correct in more cases (fallback lands on device A, remembered label is device B which is
present under a new id), but it is a second `getUserMedia` on WebKit, which supports one microphone
source at a time, and the cheap check already covers the iPhone case, where the system routes to one
input anyway.

## What GPT Sol's plan review changed

[261001l-autosave-mic-plan-review-sol.md](261001l-autosave-mic-plan-review-sol.md). All five taken.

1. **P1, overlapping saves.** A generation guard drops a late *response* but cannot stop an older
   PATCH being *applied* after a newer one, after the box said Saved. Now one save at a time per
   box, with the newest text queued behind it.
2. **P2, "Saving…" about the wrong text.** `saving` is now true only while the box holds exactly
   the text in flight; typing on makes it `dirty`.
3. **P2, dictation.** `onTranscript` and `onEnd → onCommit` run in one tick, so a commit reading
   React state saved the pre-transcript text (nothing at all on Safari). `setDraft` now writes a ref
   first. Autosave also waits while `transcribing`, not only while `armed`.
4. **P1, the microphone diagnosis was too sure.** Per the spec ids should persist, and WebKit's
   rotation bug is marked fixed; an AirPods route change, or WebKit choosing the iPhone mic for
   `{audio:true}`, fits as well. So the doc now says only that *the stored id stopped resolving*,
   and a name is not taken as identity on its own: the remembered name must belong to exactly one
   enumerated input, and that input's id must be the opened track's. Otherwise it warns — saying
   "couldn't use", not "isn't connected". The id-only legacy preference warns once, then goes.
5. **P2, Metadata had no last-chance save.** The save moved into a shared hook,
   [`useAutosavedText`](../../src/web/useAutosavedText.ts), which both boxes use: ordinary save on
   `visibilitychange → hidden`, `keepalive` on `pagehide`. `beforeunload` is attached only while
   something is pending.

So the reusable piece turned out to be two pieces: `ProfileBox` (the box, the timer, the warning,
the status line) and `useAutosavedText` (the save). `useProfile` is now a load plus that hook.

## Tests

- `tests/profile-box-autosave.test.tsx` (jsdom, fake timers): commits after 2 s idle and not before;
  resets on each keystroke; does not commit when clean; status line per `SaveState`; `beforeunload`
  is cancelled when dirty and not when clean.
- A test that a save response does not overwrite text typed during the round-trip (useProfile).
- `beginCapture` / `mic-devices` tests: stale id + same label ⇒ honoured and id updated; stale id +
  different label ⇒ not honoured, both labels available; legacy id-only ⇒ forgotten. Red first.
- Browser: `/profile` at 1280 and 390 via Playwright — type, watch Saving → Saved; reload with
  unsaved text → the dialog. Mic: not reproducible without an iPhone.
