# A dictation that fails in the browser now says so to Sentry

Two admin reports, one area ([dictation.md](../project/dictation.md)):

- **spya-m2pyfq** (#551, `SPIDERYARN-READING2-H0`, problem), 2026-10-11 01:09 UTC. Greg:

  > I was on the microphone input button. I think it was in a chat, but I'm not sure. And there was
  > some kind of error so the microphone input didn't work. It was about three hours ago. See if you
  > can find that error in Sentry, in the logs or anywhere like that. If you can't, let's improve the
  > logging and Sentry error monitoring around microphone input. And if you can, try and fix it.

- **spya-x6qjbn** (#566, `SPIDERYARN-READING2-HF`, suggestion), 2026-10-11 01:50 UTC. Greg:

  > When I use the voice dictation button, for example in the feedback reports like this one, it
  > seems to have two stages. It seems to have a kind of quick stage and then to have an LLM
  > afterwards tidy things up. I don't know if that's right, but if it is, can we make a minimal tweak
  > to that LLM prompt to ask it to add paragraph breaks where appropriate?

## What the search found

**The error never reached the server, and nothing in the browser reports one.**

- Vercel runtime logs, production, 2026-10-10 12:00 → 2026-10-11 01:10 UTC, searched for
  `transcribe`: one `POST /api/transcribe` at 17:36 (200, 64 s, `m4a`), then **nothing until
  00:56**. No `error` or `warning` line from any path in 20:00–00:30. So in the window Greg names
  (about 21:00–23:00) no recording was ever uploaded: the dictation failed **before** the upload,
  in the browser. Every dictation that did arrive that day was `m4a`, which is what Safari records
  (an iPhone, most likely).
- The feedback sweep found no Sentry issue for it, and that is not chance:
  **`useDictation.ts` and its neighbours never call Sentry.** Every failure there is a sentence put
  on screen with `setError` and nothing else. The only automatic reporting in the browser is
  `window.onerror`, and a caught failure never reaches it.
- Which sentence Greg saw cannot be recovered. That gap is what this plan is about.

**One likely candidate, and a real bug whatever Greg actually hit.** `beginCapture` turns *every*
`getUserMedia` refusal into `{ kind: "failed" }` and throws the browser's reason away, so the
reader is told *"The microphone could not be started. Press it again, or type instead.
[mic-no-start]"* whether they refused permission (`NotAllowedError`), have no microphone at all
(`NotFoundError`), or another app holds it (`NotReadableError`). On an iPhone, a refused or
dismissed permission prompt — which WebKit shows again after ten minutes idle
([dictation.md § failure 10](../project/dictation.md#the-ways-it-fails)) — gets the same advice to
"press it again" that cannot work.

## What we are doing

1. **Report every dictation failure to Sentry**, from one place.
   - `useDictation` takes a required `report(failure)` option, beside `transcribe`, for the same
     reason `transcribe` is a parameter: the hook is shared with the fleet dashboard and must not
     import the product's Sentry ([transcriber.ts](../../src/web/transcriber.ts)). **Required, not
     optional**, so a box that forgets to wire it fails to compile rather than going quiet.
     `useDictationField` passes it through, and every product box passes
     a reporter from a new `src/web/dictation-report.ts`. The fleet passes a no-op.
   - The hook calls it from **one effect on `error`**, not at each of the ~25 `setError` sites, so
     a failure branch added later is reported without anyone remembering to.
   - Skipped: the codes that are not failures (`[mic-recovered]`, `[mic-cut-off]`, `[mic-moved]`,
     `[mic-moved-held]` — a recording offered back, or words held rather than misplaced).
   - **What reaches Sentry is the code, never the sentence.** `sanitise` withholds messages whose
     code `src/messages.ts` does not know, and the `mic-` family lives outside that file on purpose,
     so the reporter builds its own `Error` named `DictationFailure` with `neverAuthored: true`,
     tags it `dictation_code` (extracted by a regex whose character class is `[a-z0-9-]`, so
     nothing a reader said can ride along), and fingerprints on the code so each code is one issue.
     Further tags: `dictation_place` (the context's `kind` from a closed set, never a slug),
     `mic_error` (the `DOMException` name from `getUserMedia`, from a closed allow-list, else
     `other`), `mic_step` (which request failed), `mic_live` (whether the recogniser was running).
     `captureClientFailure` gains an optional `fingerprint`; `safeEvent` already passes
     `fingerprint` through. Nothing in `monitoring-scrub.ts` changes.
   - Level stays `error`: a refused permission is the reader's choice, but an issue per code with a
     count is exactly what would have answered #551, and the sweep reads issues, not levels.
2. **Keep the browser's reason** in `beginCapture`'s failed outcome
   (`{ kind: "failed"; errorName; step }`), and use it for two sentences:
   - `NotAllowedError` / `SecurityError` → the existing `[mic-blocked]` sentence (*"Your browser
     blocked the microphone. Allow it for this site and try again."*), exported from
     `dictation-errors.ts` so it is one constant, not a second copy.
   - `NotFoundError` with no fallback left → the existing `[mic-none]` sentence.
   - Everything else stays `[mic-no-start]`.
   One code, one sentence holds: both are reused verbatim, and `tests/dictation-codes.test.ts`
   checks it.
3. **#566 is a question for Greg, not a build.** There is no LLM tidy-up step. The "two stages"
   are the browser's live words (Chromium only, thrown away) and then `openai/gpt-transcribe`, whose
   request has no prompt. Measured today with a synthesised 42-second clip of three separate points
   with two-second pauses between them (`scratchpad` probe, not committed): the transcript comes back as
   **one paragraph** baseline; with a paragraph instruction as `prompt` top-level, under
   `provider.options.openai`, **and sent to OpenAI directly** — so the model ignores the instruction,
   not just OpenRouter. `verbose_json` (segment timings, which a deterministic splitter could use)
   is refused: *"The selected model does not support response_format "verbose_json""*. So the only
   route to paragraph breaks is a new second model pass — added latency on a call a reader waits on,
   a cost, and a model allowed to touch the words — which is a product trade-off. Written up as a
   question file with a guarded design (the pass may only insert line breaks, checked by comparing
   the text with whitespace collapsed, else the original is kept).

## What GPT Sol's plan review changed

[The review](261011i-dictation-failures-reach-sentry-plan-review-sol.md) said REVISE. Taken:

- **F1: no effect on `error`.** It sees rendered state, so a sentence identical to the one already
  showing, or one set just before an unmount, was never reported. The state setter is now
  `showError`, and `setError` is a synchronous wrapper that shows **and** reports. Every call is an
  occurrence, so there is no dedup to get wrong.
- **F2: not the `[mic-blocked]` sentence.** `NotAllowedError` is also a device-wide or browser-wide
  denial, a permissions policy, or a WebKit failure with permission granted, and `SecurityError` is
  media disabled on the document, so "Allow it for this site" can be wrong blame. A new code,
  `[mic-refused]`, names both places: *"This page wasn't allowed to use the microphone. Check the
  microphone permission for this site in your browser, and in your device's privacy settings, then
  try again."*
- **F3: the last request's reason, and a test of the chain.** Chosen device gone
  (`OverconstrainedError`), then the default refused (`NotAllowedError`), reports the refusal. A
  stream with no audio track reports `no-track`.
- **F4: an end-to-end test through `sanitise` and `safeEvent`.**
- **F5: more to diagnose with.** `dictation_surface` (which box, a closed union: each box passes
  `dictationReporter("chat")` and so on), `mic_chosen` (whether a chosen microphone opened), and
  `browser_engine` / `browser_mobile` from a closed set, since the scrubber drops the user agent.
- **F6: `[mic-full]` is not a failure.** Added to the codes not reported.

**Not taken: F7**, a "still opening" report when a permission prompt is never answered and
`getUserMedia` never settles. No sentence is shown, so there is nothing for the reader to report
either. It needs a timer and its own sentence, and is written down in
[dictation.md § Every failure reaches Sentry](../project/dictation.md#every-failure-reaches-sentry)
rather than built.

**Considered and left: the diagnostics ring buffer** (`recordLog`), which goes out with a bug report
when *Send extra diagnostics* is ticked. It would put the failure beside the report itself, but it
means a new entry kind in `log-buffer.ts`'s allowlist. Sentry is enough to answer the next report of
this shape.

## The simpler option passed over

Calling `captureClientFailure` at the `[mic-no-start]` site only. It would answer this one report
and leave the other twenty-odd branches as silent as this one was; the next "some kind of error"
report would be in the same place.

## Tests

- The reporter: tags and fingerprint from a sentence; informational codes skipped; a
  sentence with no code reports `dictation_code: "none"`; nothing of the sentence beyond the code
  in the captured error. (Red first.)
- `beginCapture` error mapping: `NotAllowedError` → blocked sentence; `NotFoundError` → none;
  `NotReadableError` → no-start; the report carries `mic_error`. Through the existing
  `useDictation` test harness.
- `npm run typecheck` proves every box passes `report`.
