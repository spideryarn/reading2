# Review the code that was built from the two-pass dictation plan

You reviewed the **plan** for this earlier today and returned nine findings, verdict "not ready to
build". This is the review of what was actually built. Weight this one higher than the plan review:
a plan-stage review cannot find a handler that resolves twice, an effect that leaks, or a guard
placed one line too late.

Read-only. Do not edit files. Rank findings by how much damage they would do, and mark each
must-fix / should-fix / note.

## What to read

- `docs/plans/dictation-two-pass.md` — the plan, now updated, with a section at the bottom saying
  what your review changed and the one thing that was deliberately not taken.
- `docs/plans/dictation-two-pass-review-sol.md` — your own nine findings, for reference.
- `docs/project/dictation.md` — the new project doc.
- The scoped diff of everything that changed is at
  `/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/a979ab22-7413-4b0b-9700-f43b3f4bcfde/scratchpad/dictation.diff`
  — read that first for the shape, then read the real files in the repo, which are authoritative.

The files:
- `src/transcribe.ts` (new) — the server half: vocabulary assembly, the OpenRouter call.
- `src/dictation-limits.ts` (new) — sizes and containers, shared by browser and server.
- `src/routes.ts` — `POST /api/transcribe`, `readBody(req, limit)`, `MAX_AUDIO_BODY_BYTES`.
- `src/models.ts` — `DICTATION_MODEL`.
- `src/web/useDictation.ts` — heavily rewritten. The hook.
- `src/web/useDictationField.ts` (new) — caret, span, readOnly.
- `src/web/DictationStrip.tsx` (new) — button and strip, extracted from ProfileBox.
- `src/web/mic-lock.ts` (new) — one microphone per page.
- `src/web/dictation-upload.ts` (new) — the client half of the route.
- `src/web/mic-recording.ts` — caps changed, `onCapped` added.
- `src/web/ProfileBox.tsx`, `ChatPanel.tsx`, `CommentDialog.tsx` — the three consumers.
- `tests/transcribe.test.ts` (new), `tests/dictation-phases.test.ts`,
  `tests/dictation-recording.test.ts`, `tests/profile-mic-button.test.tsx`,
  `tests/mic-recording.test.ts`.

## What I most want you to attack

1. **Did your nine findings actually get fixed, or did they get a comment?** Check each against the
   code rather than against the plan's claims. In particular: is the probe→abort ordering in
   `probeTrackOverload` genuinely safe, and does `mic-lock.ts` close the gap it claims to?

2. **`useDictation.ts`'s `finish`.** It is the busiest function here and it now owns the ending, the
   recorder drain, the microphone release, the upload and the callbacks. Trace every path through
   it. Can `free()` be called twice, or never? Can `done()` fire twice? Can `ended.current?.()` fire
   before a transcript lands, or twice, or never? Is `newest.current` the right guard everywhere it
   is used? What happens on: unmount mid-upload; a second press mid-upload; `chooseDevice` mid-
   upload; the recorder cap firing during the stop; a track `ended` event during transcription.

3. **The microphone lock.** Three claims racing. A claims, B claims (A asked to stop), C claims
   before A's `released` resolves. Does anyone end up waiting forever, or does anyone open a track
   while another is live? Is `holder = claim` before the await right? What happens if a holder's
   `released` never resolves because its `finish` took a path that skips `free()`?

4. **`useDictationField`.** The span content check, the caret, the refocus. Can the span offsets be
   stale in a way the content check does not catch (e.g. identical text elsewhere in the box)? Does
   `live.current = value` on every render defeat the ref's purpose in any case? Is `toggle`'s
   `requestAnimationFrame` refocus right when the reader deliberately clicked elsewhere?

5. **The route.** `readBody(req, MAX_AUDIO_BODY_BYTES)`, the base64 regex, `res.on("close")`.
   Anything that can get past validation, or any failure whose copy is wrong per
   `docs/project/copy.md`. Note that this route does NOT use `src/messages.ts` copy — say whether it
   should.

6. **Things I did not do.** I did not add dictation-specific copy to `src/messages.ts`; I did not
   map 429 through `providerHttpFailure`; I did not add a client-side timeout (relying on the
   server's 90s). Say whether each is a real gap.

7. **Anything the tests assert that is not actually true**, and anything important with no test.

Please also flag any place where a comment claims something the code does not do — this codebase
puts a lot of reasoning in comments and a comment that has drifted is worse than none.
