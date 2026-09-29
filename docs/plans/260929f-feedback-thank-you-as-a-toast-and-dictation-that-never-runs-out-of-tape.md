# Feedback's thank-you as a toast, and dictation that never runs out of tape

Two feedback reports from Greg (admin, so trusted input — [feedback-reports.md](../project/feedback-reports.md)),
both about the Feedback dialog, built together because they touch the same dialog and ship together.

**Status:** plan reviewed by GPT Sol (verdict *rework*), revised — 2026-09-29. Part A built. **Part B as built is § Part B, revised after review** below; the section before it is the draft that review took apart, kept for the reasoning.

## The two reports

**SPIDERYARN-READING2-58** (`spya-srek7a`), Greg verbatim:

> Remove "It is filed" from the post-Feedback message.
>
> And in fact, that post-Feedback message should be a toast in the corner that disappears after a
> few seconds, rather than a blocking modal.

**SPIDERYARN-READING2-5B** (`spya-a0ep9m`), Greg verbatim:

> Argh, I just got this error when recording a long message in the Feedback:
>
> "That was as much as we can transcribe at once. The rest wasn't recorded. [mic-full]"
>
> Is there any way we can avoid or fix or mitigate or work around this? I mean, at the very least,
> e.g. could you stop it and immediately restart it and append?

`git log origin/dev` on 2026-09-29 showed nothing already done on either.

## Part A — the thank-you becomes a toast

**Today:** a successful send swaps the dialog's form for a panel (`stage.kind === "sent"` in
[`FeedbackDialog.tsx`](../../src/web/FeedbackDialog.tsx)) holding one of three `THANKS` sentences and
a Close button. The dialog stays modal until the reader closes it; the form is emptied on close
(the `thanksSeen` effect).

**After:** a successful send **closes the dialog at once** and shows the same thank-you as a small
toast in the bottom corner of the page, which goes away by itself after about five seconds.

- The three sentences lose "It is filed" and nothing else:
  - problem: *"Sorry to hear you have been having a problem — thank you for telling us. We will look
    into it."*
  - suggestion: *"Thank you for the suggestion — we really appreciate it."*
  - none: *"Thank you for the feedback — we really appreciate it."*
- **There is no toast component in the app today** (grepped `toast`/`sonner` across `src/`: the
  only hit is a comment in `PublicChrome.tsx` saying a banner is *not* a toast). So this adds one
  small one, `src/web/Toast.tsx`, rather than a library: one message, `role="status"` with
  `aria-live="polite"` so a screen reader announces it without stealing focus, a close button,
  about five seconds, the timer paused while the pointer is over it or focus is inside it so it
  cannot vanish mid-read, and no animation under `prefers-reduced-motion`. Not a queue, not a
  provider, not a portal library — one caller exists. The simpler option passed over is a
  third-party toast library (`sonner`); one message from one caller does not earn a dependency.
- **It renders outside the `<dialog>`**, because the dialog is closing: anything inside a closed
  `<dialog>` is not painted. `FeedbackHost` (in [`FeedbackButton.tsx`](../../src/web/FeedbackButton.tsx))
  stays mounted for the page's life, so the toast's state lives there or in `FeedbackDialog`'s
  returned fragment — whichever keeps the dialog's own stage machine simplest. The builder decides.
- **The form's emptying keeps its current rule.** `discard(body !== stage.sentBody)` — empty the
  form unless the reader edited after pressing Send — now runs when the send succeeds and the
  dialog closes, instead of when the reader closes the thank-you panel. The `sent` stage and its
  panel go; whatever of `thanksSeen` is then dead goes too.
- Styling from the existing tokens ([design-css-overview.md](../project/design-css-overview.md));
  bottom-right on a wide window, full-width-minus-gutter at the bottom on a phone, clear of the
  Feedback button itself.

**Done looks like:** send → dialog gone in the same frame → toast in the corner → gone after ~5 s;
tests for the toast's timer, pause and close, and for the dialog closing on success and not on
failure; `docs/project/feedback.md` updated.

## Part B — a long dictation is cut into pieces, not cut off

### What the limit really is

It is **ours**, not the transcription provider's. [`mic-recording.ts`](../../src/web/mic-recording.ts)
stops the recorder at **2.1 MB of audio** (`MAX_BYTES`) or **five minutes** (`MAX_MS`), whichever
comes first. The bytes bite first in Chrome: at its measured ~14 KB/s, about **2½ minutes**. The
reason is Vercel, which refuses any request body over 4.5 MB before our code runs, and the audio
travels base64-encoded in one JSON `POST /api/transcribe` (`MAX_AUDIO_BASE64` = 3 MB in
[`dictation-limits.ts`](../../src/dictation-limits.ts)). When the cap fires, `useDictation` ends the
dictation with `[mic-full]`, and what was said up to the cap *is* transcribed. What is lost is
everything the reader said after it. Greg's "The rest wasn't recorded" was literally true.

There is also a limit behind ours that raising ours would hit next: a speech-to-text model's output
is bounded per request (OpenAI's transcribers cap output at a couple of thousand tokens, roughly ten
minutes of talk). So "just upload bigger files" — for instance straight to Supabase Storage,
bypassing Vercel — would move the wall, not remove it. Cutting the recording up is the fix that
removes it.

### The fix: segments, transcribed while the reader is still talking

Greg's own suggestion — stop, restart immediately, append — done so that the reader never sees it:

```
  press                                                              stop
    │                                                                  │
    ▼                                                                  ▼
  [ segment 1 ~≤2 min ][ segment 2 ~≤2 min ][ segment 3 (the tail)    ]
          │ closes              │ closes                  │ closes at stop
          ▼                     ▼                         ▼
     POST /api/transcribe  POST /api/transcribe     POST /api/transcribe
     (while still talking) (while still talking)          │
          │                     │                         │
          └──────── await all, in order ──────────────────┘
                                │
              text1 + " " + text2 + " " + text3  →  onTranscript, once
```

1. **The tape rotates.** Inside `recordTrack`, once a segment is long enough, a **new**
   `MediaRecorder` is started on the same track and only then is the old one stopped, so there is no
   gap in the audio (at worst a few milliseconds of overlap). Each segment is its own recorder and so
   its own complete, playable file — MP4 and WebM files cannot be concatenated byte-wise, which is
   why this is several recorders rather than one recorder's chunks sliced up. A rotation reuses the
   container that already worked (the attempt ladder is not re-walked).
2. **Where the cut falls.** A seam in the middle of a word garbles that word in both halves. So from
   a *soft* length (about 60 s) the tape rotates at the first moment the level meter says the reader
   is quiet (the hook already has the level: `useAudioLevel`), and at a *hard* length (about 120 s,
   or 80% of `MAX_BYTES`, whichever first) it rotates regardless. The byte bound stays, as the safety
   that keeps any one segment inside Vercel's limit whatever the encoder does; so each request is
   unchanged in size from today's worst case. A hidden tab stops `requestAnimationFrame`, the level
   falls to zero and reads as quiet — which just means rotating at the soft length, which is fine.
   The rotation decision is a small pure function so it can be tested without a recorder.
3. **Each finished segment is sent at once**, while the reader carries on talking, with the same
   `where` snapshot and the session's one `AbortController` — so an unmount, a second press or a
   device change aborts all of them exactly as it aborts one today. The wait after pressing stop is
   then only the last segment's, which is shorter than today's worst case, not longer.
4. **At stop**, the last segment closes; the hook awaits every segment's result **in order** and
   joins the texts with a space. `onTranscript` is still called **once**, with the whole thing, so
   [`useDictationField`](../../src/web/useDictationField.ts)'s one-span replace is unchanged and the
   live words on Chromium are replaced by the whole transcript exactly as now.
5. **All or nothing on failure, the same as today.** If any segment fails, no transcript is
   delivered, the error is shown, and the recordings are kept. Retry re-sends **only the failed
   segments** and keeps the texts that already came back. Delivering the parts that worked with a
   hole in the middle was considered and rejected: on Chromium it would replace the live words that
   cover the hole, losing them.
6. **The minimum-length rule is for the dictation, not the segment.** `MIN_MS` (2 s) exists so a
   double-press is not offered as evidence. Applied per segment it would throw away a one-second tail
   after a rotation — the reader's last words. So the tail is kept whenever an earlier segment exists.
7. **Earlier segments are never thrown away because the tail went wrong** (a recorder error, a
   flush that timed out). What was transcribed is delivered.
8. **A ceiling on the whole dictation stays, but far higher: 20 minutes.** It stops a microphone
   left on in a forgotten tab from recording and paying for an hour. Hitting it still ends the
   dictation, keeps everything, and says so under the same code with a new sentence:
   *"Dictation stops after 20 minutes. Everything up to here has been kept. [mic-full]"*
   (`tests/dictation-codes.test.ts` holds one sentence per code; the old sentence goes.)

### What it costs

**No new spending and no new provider.** Transcription is paid per second of audio, and the seconds
are the same whether they go up in one request or five. The ceiling rising from ~2½ to 20 minutes
means a single dictation *can* cost more, in proportion to how long the reader talked, which is the
normal per-use cost. No new route, no server change: each segment is an ordinary
`POST /api/transcribe` inside today's size limit.

### The saved recording and the Retry, with several segments

`UseDictation.recording` becomes a list (`recordings`), one entry per kept segment, and
[`DictationStrip.tsx`](../../src/web/DictationStrip.tsx) shows one Save button per part (*"Save part 2
(2:00)"*), or the unchanged single button when there is one. The fleet dashboard's chrome
does not render `recording` (grepped `tools/fleet`), so this touches the strip only. Retry's existing
gates are unchanged: offered only when every failure is retryable and the recogniser confirmed
nothing.

### Where it applies

Every dictation box, because the change is inside `mic-recording.ts` and `useDictation.ts`, which
all six boxes and the fleet dashboard share. Nothing at a call site changes.

### What is not in this

- Tidying the seam in the text (a capital letter mid-sentence where segment 2 begins). The
  transcription request has no prompt to carry the previous segment's last words into.
- Auto-stopping on long silence.
- Uploading audio anywhere but `/api/transcribe`.

## Stages

1. **A — the toast.** `Toast.tsx`, `FeedbackDialog.tsx`/`FeedbackButton.tsx`, CSS, tests,
   `feedback.md`. Independent of B's files.
2. **B — segments.** `mic-recording.ts`, `useDictation.ts`, `DictationStrip.tsx`,
   `dictation-limits.ts` if needed, tests (`mic-recording.test.ts`, `dictation-phases.test.ts`,
   `dictation-codes.test.ts`), `dictation.md` § The sizes rewritten.

Each: Opus builds, GPT Sol code-reviews (write-capable), gates (`npm test`, `npm run typecheck`,
lint on touched files), a browser check in a Sonnet subagent, a commit. Then the two notes in
`docs/user-feedback/`, push to `dev`.

## Part B, revised after review

GPT Sol's plan review (2026-09-29, verdict *rework*, ten findings R1–R10) is accepted except where
noted. What changed:

- **Hard rotation only (R8).** No pause-seeking. `useAudioLevel.quiet` means ten seconds of nothing
  and was never a boundary detector; and the hidden-tab claim above was false — `useAudioLevel`
  deliberately does *not* read a hidden tab as quiet (R6). Measure seam damage first; a dedicated
  voice-activity boundary is a later change only if the measurement asks for it.
- **The rotation decision is made in `ondataavailable`, not by a timer.** Every chunk (one a second)
  asks: is this segment past 120 s, or past 80% of `MAX_BYTES`? That is event-driven, so it runs
  whenever the recorder hands over data, including after a throttled background tab wakes (R6). A
  single chunk that would by itself push a segment past `MAX_BYTES` (a long suspension on WebKit) is
  a **capture failure**, said as such — never "everything was kept" over a discarded chunk. v1's
  guarantee is for a foreground tab.
- **No promise of zero gap (R2).** Start the new recorder, then stop the old; measure the seam in a
  spike **before** building on it: Chromium and Playwright's WebKit, with the track driven by Web
  Audio (the box has no microphone). Every part must decode on its own; repeated rotations, not just
  one. Physical iOS Safari cannot be run from here and is named as unverified. If WebKit will not
  overlap two recorders, fall back to stop-then-start and document the measured gap.
- **Strict all-or-nothing (R3).** Delete point 7 above. `onTranscript` is called once, after every
  segment has succeeded. Any capture or transcription failure publishes no transcript: Chromium's
  live words stay, the audio parts are offered to save, and results that did come back stay cached
  for a retry.
- **The whole-dictation ceiling stays at five minutes (R7).** Twenty minutes of speech is ~18,000
  characters, into boxes that take 600 to 4,000; five minutes is about what the Feedback box's
  4,000 holds. The fix Greg needs is that Chrome's **2½-minute** byte cutoff goes, which segments do
  on their own. `[mic-full]` keeps its code and gets a sentence that is true now: the dictation
  stopped at the limit and what was said up to it is being transcribed. A per-box ceiling sized
  from each destination's own limit is the later refinement.
- **One logical recording (R9).** `UseDictation.recording` becomes a `DictationRecording` with an
  ordered `parts` array, not a bare list; per-part upload state lives in the session. The strip
  shows one Save per part, or today's single button when there is one part.

### The spike

Run 2026-09-29 on the Hetzner box, before building on it. Playwright 1.62.1 drove a page whose
track came from Web Audio (an oscillator sweeping 200 Hz upward at 50 Hz/s into a
`MediaStreamDestination` — the box has no microphone), recorded with the product's own container
ladder, rotated every 3 s, four rotations (five parts), and decoded each part on its own with
`decodeAudioData`. The sweep makes the audio's own time recoverable: the frequency at a part's last
sound and the next part's first sound says how much was lost at the seam. Two orders were tried:
**start the new recorder, then stop the old** (what the plan asks for), and stop-then-start.

| browser | container | parts decoded alone | seam loss, per seam | sum of parts vs wall clock |
|---|---|---|---|---|
| Chrome 152.0.7977.75 (system, headless) | `audio/webm;codecs=opus` | 5 of 5, both orders | 5–65 ms (overlap); 6–68 ms (stop-then-start) | −0.12 s over 15 s |
| Chromium 151.0.7922.34 (Playwright) | `audio/webm;codecs=opus` | 5 of 5, both orders | 6–55 ms (overlap); 8–71 ms (stop-then-start) | −0.07 to −0.13 s over 15 s |
| WebKit (Playwright, build 2336) | — | **not run**: `MediaRecorder` does not exist in this build | — | — |

What it says:

- **Every part is a complete file.** Each of the ten Chromium runs' parts decoded on its own.
- **Overlap buys nothing measurable in Chromium, and costs nothing.** Starting the new recorder
  first did not make the two parts share any audio: the new part begins about when it was started,
  and the old part's last ~60 ms (one Opus packet's worth, judging by decoded lengths of 2.94 s
  against 3.00 s) is simply not in its file. The loss is the old recorder's final packet, not a
  gap between recorders, which is why both orders measure the same. **Up to ~70 ms per seam**, one
  seam every two minutes — at worst part of a syllable. Nothing was built to hide it (R8: measure
  first); if real speech shows garbled words at seams, that is the evidence for a boundary detector.
- **AAC is unverified.** Neither headless Chrome on Linux offered `audio/mp4;codecs=mp4a.40.2`
  (Chrome's AAC recorder uses the platform's encoder, which Linux does not have), so every number
  above is WebM/Opus. The Mac and Windows path, which records AAC, is reasoned rather than measured.
- **WebKit is unverified**, and so is physical iOS Safari: the Playwright WebKit build on Linux has
  no `MediaRecorder` at all, so whether WebKit will run two recorders on one track, and what its
  seam costs, could not be observed from here. The code starts the new recorder first on every
  engine. If WebKit refuses to construct or start a second one, the old part simply keeps
  recording (each later chunk tries again) — and at WebKit's ~6 KB/s the five-minute ceiling
  arrives before the per-part byte bound, so that dictation would be one part, as before this
  change. If it starts one and then errors, that is a capture failure, `[mic-broken]` — loud, not
  silent. An iPad dictation over two minutes is the check.

The script is not kept in the repo; it was a throwaway in the session's scratchpad
(`segB-spike.mjs`).

### Cancellation — who aborts the in-flight segment uploads (R4)

The session's `AbortController` is created when the session is, before any segment can upload.

| event | segment uploads | publishes? |
|---|---|---|
| reader presses Stop | kept; tail added; all awaited | yes, if all succeed |
| cap hit (`[mic-full]`) | same as Stop | yes, if all succeed |
| another box claims the microphone (mic-lock) | same as Stop — that is today's "stop properly, keeping its words" | yes |
| a new press in the **same** box supersedes it | aborted | never |
| device change mid-dictation | aborted (the session is abandoned and restarted) | never |
| unmount | aborted | never |
| retry | its own controller and generation, as today; re-sends only failed parts | yes, if all succeed |

The superseding abort moves out of the recogniser-only branch, so Safari and Firefox get it too.
Every settlement and the final publication are guarded by `mounted && newest.current === s`; a
stale session never calls `onTranscript` or `onEnd`. Tested on both the recogniser and the
no-recogniser paths.

### What each ending is (R5)

| situation | outcome |
|---|---|
| whole dictation under 2 s | nothing uploaded, `[mic-empty]` as today |
| earlier part(s), then a tail under 2 s with bytes in it | the tail is kept and uploaded |
| a tail with zero bytes | absent — not evidence of silence; the earlier parts stand |
| every part transcribed, all empty, no live words | `[mic-silent]`, audio offered |
| an upload failed | its error; Retry (failed parts only) if every failure is retryable and no live words |
| a recorder or flush failed on some part | capture error; no transcript; earlier parts offered to save; not retryable, since that part has no complete file |

`mic-recording.ts`'s `stop()` changes contract accordingly: `MIN_MS` is applied to the dictation's
total, not to each part.

## Reviews

- **Plan review, GPT Sol, 2026-09-29** — *rework*; R1–R10 above. R1 (P0, the toast must compare the
  box *now* with the body *that was sent*, or it erases words typed after Send) was already how the
  Part A builder had done it (`bodyRef.current !== body`).
