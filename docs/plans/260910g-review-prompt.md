# Review: dictation asks for the microphone twice on an iPhone (260910g)

You are reviewing, and fixing inside, one small stage in the repo at your working directory (a git
worktree). The revision under review is commit `5a28c915`; see it with `git show 5a28c915`. Read
`docs/plans/260910g-dictation-asks-for-the-microphone-twice-on-iphone.md` first: it is the plan,
the diagnosis and the evidence. Then read the code change in `src/web/useDictation.ts`
(`probeIsSafe`, `probeTrackOverload`, `beginCapture`) and the tests in
`tests/dictation-phases.test.ts` and `tests/dictation-recording.test.ts`.

## The claim you are checking

A reader on an iPhone home-screen web app was asked for microphone permission twice on the first
dictation press of a page load. The diagnosis is that the capability probe
(`r.start(NOT_A_TRACK)` then `r.abort()`) starts a WebKit SpeechRecognition. On WebKit that puts up
the per-site microphone prompt, which the abort does not dismiss, and then `getUserMedia` prompts
again. The fix is to run the probe only when `"userAgentData" in navigator` (Chromium), and to
treat every other engine as having no `start(track)` overload, so no live words there. Desktop
Chrome/Edge must behave exactly as before.

**The conclusion I would least like to be wrong about:** that this gate leaves the Chromium desktop
path byte-for-byte unchanged in behaviour, and that no other code path on WebKit still starts a
recogniser (for example `onsoundstart` wiring, the recogniser-death path, a restart in `onend`, or
anything else that calls `r.start`) or otherwise produces a second permission request per press.
Trace every `r.start(` / `.start(` on a recogniser in `src/web/useDictation.ts` and say what guards
each one.

Also check:

1. Is `"userAgentData" in navigator` a sound Chromium signal for this purpose? Is there a Chromium
   context where it is absent (an insecure context, a WebView, an enterprise policy) and that
   matters, given that the absent case only loses live words?
2. The test changes: do the new tests actually fail against the pre-fix code? (Run
   `git stash`-free: e.g. temporarily edit `probeIsSafe` to `return true`, run
   `npx vitest run tests/dictation-phases.test.ts`, then restore it.) Do the fixture changes
   (`chromiumEngine`, the fresh Safari subclass in `useSafari`, the `userAgentData` in
   `dictation-recording.test.ts`) leak between tests or files in a way that could make a test pass
   for the wrong reason?
3. The plan's claims about WebKit are from source reading by subagents, not a device. If any claim
   in the plan or the postmortem (`docs/postmortems/260910e-a-cancelled-request-still-asks-the-reader.md`)
   overstates what was verified, say so.
4. Anything in `docs/project/dictation.md`'s new paragraph, or the code comments, that is false.

## Rules

- You may edit files to fix what you find **inside this stage**: narrowly, red-first where it is a
  code fix (a test that fails before your fix). Report, do not fix, anything wider.
- Never run `git stash`, `git reset`, `git checkout -- …`, `git restore`, `git clean`, or any
  branch-switching command. Do not commit. Undo your own experiments by editing the text back.
- You can run `npx vitest run tests/dictation-phases.test.ts tests/dictation-recording.test.ts`
  (jsdom, no network needed) and `npm run typecheck`.

## Output

Findings with IDs (R1, R2, …), each with a severity from this fixed scale: **P0** ships a broken or
harmful behaviour; **P1** a real defect or a false claim that will mislead; **P2** worth fixing,
not blocking; **P3** nit. For each: file:line, what is wrong, the evidence (a command and its
output where you ran one), and whether you fixed it (and how) or are only reporting it. End with a
one-line verdict: ship / ship after fixes / do not ship.
