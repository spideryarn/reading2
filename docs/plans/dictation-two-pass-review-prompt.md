# Review this plan before it is built

You are reviewing a plan for the Spideryarn repo (an AI-assisted reading app, TypeScript + ESM,
React client, Node server on Vercel, OpenRouter as the model gateway). Read-only review: do not
edit files. Be concrete and rank findings by how much damage they would do.

## The plan

Read `docs/plans/dictation-two-pass.md` in full. That is the thing under review.

## Context you will need

- `src/web/useDictation.ts` — the hook as it exists today. Its header comments carry the
  reasoning from three previous rounds of review (yours), including the `NOT_A_TRACK` probe, the
  per-session object, and why the AudioContext is never suspended.
- `src/web/mic-recording.ts` — the MediaRecorder tape, its container fallback, and its caps.
- `src/web/ProfileBox.tsx` — the only consumer today; the microphone UI lives inside it.
- `src/web/mic-devices.ts`, `src/web/useAudioLevel.ts`, `src/web/dictation-errors.ts`.
- `src/routes.ts` — the API. Note `readBody` and `MAX_BODY_BYTES = 64 * 1024`, the auth gate,
  and the single `finally` that logs every request.
- `src/models.ts` — where model ids live, the two tiers, `NON_TASK_MODELS`, `MODEL_ENV_VAR`,
  and the long warning about the Anthropic provider pin.
- `src/pdf-read.ts` — the closest existing example of a non-Anthropic OpenRouter call carrying
  a large base64 payload.
- `src/web/ChatPanel.tsx` (the composer textarea, ~line 1429) and `src/web/CommentDialog.tsx`
  (the follow-up `<input>`, ~line 265) — the two boxes the plan proposes to wire up.
- `docs/reusable/silent-success.md` — the failure pattern this codebase cares most about.
- `docs/project/reader-profile.md` — the doc that currently states the privacy position the
  plan reverses.

## What I most want you to attack

1. **The one-capture claim.** The plan drops Safari's own recogniser so that we own the track
   everywhere. Is there a case where two captures still end up open — a failed
   `getUserMedia`, a device change mid-session, the `NOT_A_TRACK` probe itself? The probe
   currently *starts the recogniser* on browsers without the overload; under the new design that
   is exactly what must not happen. Does the plan's ordering actually prevent it, and if the
   plan is vague there, say what the correct order is.
2. **The span replacement.** `readOnly` during the gap is supposed to make the race impossible.
   Enumerate what can still change the box's value in those two seconds — React state from
   elsewhere, a draft restore, an unmount, a second press of the microphone, an autosave on
   blur. What happens if the reader presses the microphone again while a transcription is in
   flight?
3. **The route.** `{ audio: base64, format, context }` as JSON against a 64KB `MAX_BODY_BYTES`
   that must be raised for this one path. Where should that limit live so it cannot be raised
   for everything by accident? What validation does `format` need? What is the right failure
   when the audio is over the cap, and does it match `docs/project/copy.md`'s rules?
4. **Using a chat model as a transcriber.** The plan's mitigation for "the model answers the
   question instead of transcribing it" is a system prompt. Is that enough, and what should the
   server do with a response that is plainly not a transcript? Consider a reader dictating into
   the chat box, where the words genuinely are a question.
5. **The measurements.** The benchmark used synthetic `say` speech, one sample, three runs. The
   plan claims 0.0% WER for gemini-3.1-flash-lite with a vocabulary prompt. What conclusion does
   that evidence actually support, and which sentence in the plan overstates it?
6. **Anything the plan does not mention at all** that this design needs — abort on unmount,
   retries, the loading state on a slow network, what happens on a 429, iOS specifics.

Please also flag anywhere the plan contradicts the reasoning already written into
`useDictation.ts`'s header, since that reasoning was hard-won and the plan may be discarding a
fix without knowing it.

Number your findings and say for each whether it is a must-fix before building, a should-fix,
or a note.
