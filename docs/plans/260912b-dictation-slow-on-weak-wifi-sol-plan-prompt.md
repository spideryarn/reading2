# Review: a plan to make iPad dictation faster on weak Wi-Fi, and the measurement behind it

Repo: /home/greg/code/spideryarn2/.claude/worktrees/fb39-dictation-slow-on-weak-wifi, branch
`worktree-fb39-dictation-slow-on-weak-wifi`. TypeScript + ESM, React client under `src/web/`, a Node
server, `tsx` to run scripts, vitest.

## The candidate

Committed: `5512a127` (the measurement) and `de555fcf`, which revises the plan and adds this prompt
— together, exactly `git log --oneline 5512a127^..de555fcf` (two commits, five paths).
  git diff origin/dev...HEAD --stat
  changed paths: docs/plans/260912b-dictation-slow-on-weak-wifi.md,
                 docs/user-feedback/260912_0818-dictation-slow-on-weak-wifi.md,
                 evals/dictation/results-latency.json, scripts/spike-dictation-latency.ts

Start with: the plan (`docs/plans/260912b-dictation-slow-on-weak-wifi.md`), then the spike script and
its results. Then the code the plan proposes to change: `src/web/mic-recording.ts` (the `ATTEMPTS`
ladder and its header), `src/web/useDictation.ts` (`probeIsSafe`, around line 1581, and the stop →
upload path around line 755), `src/web/dictation-upload.ts`, `src/transcribe.ts`,
`src/ai-call.ts` (`openRouterTranscription`, `TranscriptionCall`), `src/routes.ts`
(`transcribeDictation`, `readBody`). This is where to begin, not the limit of what is in scope.

Background worth reading: `docs/project/dictation.md`,
`docs/plans/260907c-dictation-onto-an-openai-transcriber.md`.

## What it is meant to do

An admin reported dictation is slow on an iPad on weak Wi-Fi and asked for measurement before a fix.
The plan's claims:

1. The upload, not the transcriber, dominates on a weak link (measured: 10.8 s vs ~2 s for 41 s of
   speech at an iPad's size).
2. An iPad records at 192 kbps because the app sends no `audioBitsPerSecond` on AAC — read from
   WebKit's source (`LargeAudioBitRate = 192000`, `computeBitRates`' `value_or`), not measured.
3. Stage 2: put `audioBitsPerSecond: 48_000` on the AAC attempt **on WebKit only**, recognised
   positively by `navigator.vendor === "Apple Computer, Inc."` (a new predicate in
   `mic-recording.ts`, deliberately *not* a reuse of `useDictation`'s `probeIsSafe`, whose failure
   direction is the opposite one — the plan says why); and log the achieved rate server-side from
   OpenRouter's `usage.seconds`.
4. Stage 3 (optional): send the recording as a raw request body instead of base64 in JSON.
5. The simpler option passed over — Opus/WebM first everywhere — is framed as Greg's product call
   because it changes the container of the failure-only saved file.

Invariants that must not break: the recorder's evidence contract (never offer an empty/partial file),
the ~380 ms fallback restart must never be triggered on a browser that would otherwise have worked
(it loses the first word), the 2.1 MB / 3 MB / Vercel 4.5 MB size chain in `src/dictation-limits.ts`,
and the fleet dashboard's reuse of `useDictation`/`mic-recording.ts` (`tests/fleet-imports.test.ts`
pins the list of `src/` files the fleet reaches).

## What you can and cannot run, and what you may change

The tree is read-only. /tmp and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`). You have no
network, not even loopback — so you cannot re-run the spike (it needs Chrome, a local sink and
OpenRouter). Its full output is committed as `evals/dictation/results-latency.json`; the console
transcript is in the plan.

## Attack it

Independently, before you read my questions below. The claim to break: **"a 48 kbps hint on AAC,
off Chromium only, makes an iPad's upload ~4× smaller without changing anything on Chrome, and
production will be able to tell whether it worked."**

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) the concrete scenario the plan does not handle, or the authoritative contract it contradicts
  - (b) the smallest change that closes it — exact replacement wording or a code sketch
A finding with no (a) goes last.

Severity: P0 data loss, exploitable security, incorrect charging, or the service broadly unusable ·
P1 user-visible wrong behaviour, or an authoritative contract violated · P2 design or maintainability
risk with no wrong behaviour today · P3 prose.

Refuse only on an established P0 or P1, and name what established it.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- Is `usage.seconds` from OpenRouter really the audio's duration, and is it present on this endpoint
  for this model? (The 260907c plan saw `usage: {seconds, cost}`.)
- Does any non-Chromium engine that reaches the AAC attempt throw on a hint the way Chromium does —
  Firefox on macOS, an Android WebView, Samsung Internet (Chromium, but does it send the brand)?
- Is "the transcriber's time is independent of file size" overreaching from two runs per row?

Do not change any file.
