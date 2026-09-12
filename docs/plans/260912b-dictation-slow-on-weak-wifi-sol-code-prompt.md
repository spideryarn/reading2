# Review: stage 2 of the iPad-dictation-on-weak-Wi-Fi fix — a bitrate hint on WebKit's AAC, and a log line that says whether it took

Repo: /home/greg/code/spideryarn2/.claude/worktrees/fb39-dictation-slow-on-weak-wifi, branch
`worktree-fb39-dictation-slow-on-weak-wifi`. TypeScript + ESM, React client under `src/web/`, a Node
server, `tsx` to run scripts, vitest.

## The candidate

Committed: `705553da` (stage 2) and the commit directly after it (the plan review's follow-up, which
also changes the log line in `src/transcribe.ts` so `audioSeconds`/`kbps` are `null` rather than
absent) — together exactly `git log 705553da^..HEAD`, on top of `de555fcf` and `5512a127` (the
measurement and the plan, already plan-reviewed — see
`docs/plans/260912b-dictation-slow-on-weak-wifi-sol-plan-review.md`).
  git diff 705553da^..HEAD -- src tests
  code paths: src/web/mic-recording.ts, src/ai-call.ts, src/transcribe.ts,
              tests/mic-recording.test.ts, tests/ai-call.test.ts
  doc paths:  docs/project/dictation.md, docs/plans/260912b-dictation-slow-on-weak-wifi*.md,
              docs/user-feedback/260912_0818-dictation-slow-on-weak-wifi.md

Start with: `src/web/mic-recording.ts` (`ATTEMPTS`, `WEBKIT_AAC_BPS`, `supportedAttempts`,
`takesAacBitrate`, and `recordTrack`, which calls `supportedAttempts()`), then `src/ai-call.ts`
(`openRouterTranscription`, `TranscriptionCall`) and the log line at the foot of `transcribeWith` in
`src/transcribe.ts`. The call sites matter as much as the functions: `recordTrack` is reached from
`src/web/useDictation.ts`, which the fleet dashboard (`tools/fleet/`) reuses —
`tests/fleet-imports.test.ts` pins the list of `src/` files it reaches. This is where to begin, not
the limit of what is in scope.

## What it is meant to do

- **On WebKit only** (recognised by `navigator.vendor === "Apple Computer, Inc."` — Safari, and every
  browser on iOS/iPadOS), the AAC-in-MP4 recorder attempt carries `audioBitsPerSecond: 48_000`, so an
  iPad records at ~6 KB/s instead of WebKit's default 192 kbps (~24 KB/s). Everywhere else nothing
  changes. The predicate is positive on purpose: a hint reaching Chromium's AAC encoder throws
  `EncodingError`, the fallback ladder then starts the next recorder ~380 ms late and loses the
  reader's first word — so an unrecognised engine must get *no* hint (today's behaviour).
- `openRouterTranscription` returns `seconds` from OpenRouter's `usage.seconds` (null unless a
  positive finite number), and the `dictation transcribed` log line carries `format`,
  `audioSeconds` and `kbps` so a production log search can say whether an iPad honoured the hint.
  Nothing a caller wrote may reach that log line; no transcript text may.

Invariants: the recorder's evidence contract (never hand over an empty, partial or errored file),
the size chain in `src/dictation-limits.ts`, the spend ledger's behaviour in `openRouterTranscription`
(the meter, `unpriceZero`, the abort handling), and logging rules in `docs/project/logging.md`.
Out of scope: the raw-body upload (a later stage), and Opus/WebM-first (a product question for Greg).

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside this stage — each finding red-first, with the test
that reproduces it — and leave everything wider as a finding for me to decide. Do not commit. List
every file you changed at the end.

You can run one test file at a time (`npx vitest run tests/<one>.test.ts`) and a script
(`node --import tsx <script>`). You have no network, not even loopback, so anything needing Postgres,
Chrome or OpenRouter will skip or fail. I have run those: `npm run typecheck` exit 0; the six
dictation test files (mic-recording, ai-call, transcribe, request-spend, dictation-recording,
dictation-phases) 205/205 green; a real dictation through `scripts/spike-dictation-browser.ts` logged
`"format":"m4a","audioSeconds":9,"kbps":127` for an 8.8-second clip; the full `npm test` result is in
the plan doc once it lands.

## Attack it

Independently, before you read my questions below. The claim to break: **"on every engine except
WebKit the recorder behaves exactly as it did before 705553da, and on WebKit the only difference is
the hint."** Then: **"the new log fields cannot carry anything a caller controls, and `kbps` means
what its comment says."**

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) the input or mutation I can run that shows it
  - (b) the smallest change that closes it
A finding with no (a) goes last.

Severity: P0 data loss, exploitable security, incorrect charging, or the service broadly unusable ·
P1 user-visible wrong behaviour, or an authoritative contract violated · P2 design or maintainability
risk with no wrong behaviour today · P3 prose.

Refuse only on an established P0 or P1, and name what established it.

## Previous findings

The plan review's findings, and what happened to each, are in the plan doc's review section. Treat
any change made for them as unreviewed code.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- `supportedAttempts` evaluates `takesAacBitrate()` as a default parameter on every call, including
  `pickMimeType`'s — is there any caller for which that is wrong or surprising?
- `kbps` uses the base64 length × 3/4, ignoring padding, and a provider duration that looks rounded
  to whole seconds. Is the resulting error ever large enough to mislead the 48-vs-192 reading?
- Could an Android WebView or an in-app browser on iOS report a vendor string other than Apple's while
  using WebKit's encoder — and is "no hint" then merely today's behaviour, as claimed?
