# Code review: 261008d stage 2 (write-capable; fix what you find inside the stage)

Repo: Spideryarn, this worktree. Read the plan
`docs/plans/261008d-dictation-button-holds-still-and-why-the-iphone-asks-again.md`, especially
"Stage 2: a remembered microphone that no longer resolves spent the gesture". You reviewed stage 1
already (`docs/plans/261008d-dictation-button-holds-still-code-review-sol.md`).

Review two commits:

1. **9f9b10ae5** (`git show 9f9b10ae5`): `chosenInputListed` in `src/web/mic-devices.ts` and the
   `ask` variable in `src/web/useDictation.ts § beginCapture`. The claim: on WebKit a click buys
   one gesture-privileged microphone request (`MediaDevices::computeUserGesturePriviledge`), an
   `exact` request for an unmatched id is rejected before any prompt but spends it, so our
   system-default fallback was unprivileged and fell under the iPhone's 1-minute re-prompt rule.
   Check: is the WebKit reasoning right (read the source if you can reach it)? Are all paths
   correct — ids visible and listed, visible and missing, hidden (blank ids before a grant), no
   `enumerateDevices`, enumerate throwing, stop during each await (the page-wide mic claim; see
   `stillWanted`), the named-default route on Chromium (`defaultInputListed`), `honoured` and
   what the hook does with it after (the "Couldn't use" warning, `judgeFallback`'s same-device
   adoption)? Does Chromium behave identically to before where it matters (Chromium lists real ids
   after a grant; does the new pre-check change which device Chrome opens in any case)? Is an extra
   `enumerateDevices` per press with a remembered device acceptable? Were the three updated tests in
   `tests/dictation-phases.test.ts` changed honestly (intent kept, not weakened)?
2. **5c24a1fee**, the parts you did not write: `.dictation-line` on every strip line and its rules
   in `src/web/styles/mode-band.css` (composer basis 100%, Learn order 6), the comment follow-up's
   `flex-wrap: wrap` and `.cmt-followup .dictation-line` in `src/web/styles/annotations.css`, and
   the two new tests in `tests/voice-row.test.tsx`. Does wrapping `.cmt-followup` change its idle
   row in any way (it must not wrap the input, the microphone and "Ask in chat" apart)? Any other
   container that renders `DictationStrip` (Feedback, annotate, quiz, command bar, profile,
   Illustrated) where `.dictation-line` lines now behave differently or still sit in a row beside
   the microphone?

Fix red-first anything wrong. Gates: `npx vitest run tests/dictation-recording.test.ts
tests/dictation-phases.test.ts tests/voice-row.test.tsx tests/dictation-strip-holds-still.test.tsx
tests/live-session-flow.test.tsx` and `npm run typecheck`. Do not commit. Answer as a list of
findings (severity, file:line, what, what you changed and the test that went red first), then a
one-line verdict.
