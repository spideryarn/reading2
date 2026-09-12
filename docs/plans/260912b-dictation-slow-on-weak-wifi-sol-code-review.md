No established P0 or P1; I would not refuse the candidate. The implementation itself preserves the recorder and spend-ledger contracts.

### Findings

**F1 — P2, established — the new production log contract has no effective test**

The three new fields and their privacy boundary are untested. The nearby “repeats nothing … to the log” test spies on `console.log`/`console.error`, but this server logger writes through Pino directly to file descriptor 1—and is silent under Vitest. The project’s own logging guide explicitly identifies this as a false-green test shape.

(a) Either mutation still leaves `tests/transcribe.test.ts` green:

- Delete `format`, `audioSeconds`, and `kbps` from the success log.
- More sharply, change `format,` to `format: audio,`. That would put the recording in production logs, while the existing console-spy test captures nothing.

Run:

```bash
npx vitest run tests/transcribe.test.ts
```

(b) Add a focused success-log test using `tests/helpers/log-capture.ts`, with `LOG_LEVEL=info` set through `vi.hoisted` before imports. Assert positively that the captured `dictation transcribed` line exists, then assert:

- valid duration: exact `format`, `audioSeconds`, and calculated `kbps`;
- missing duration: both fields explicitly `null`;
- the line contains neither an audio sentinel, transcript sentinel, nor vocabulary sentinel.

Repair the existing console-spy privacy test using the same capture helper.

**F2 — P3, established — `dictation.md` retains the plan review’s rejected “at any size” claim**

The plan correctly says two calls per file showed no visible size penalty but cannot establish independence. The project doc still says the transcriber took about two seconds “at any size”.

(a) The disagreement is visible with:

```bash
sed -n '432,441p' docs/project/dictation.md
sed -n '98,115p' docs/plans/260912b-dictation-slow-on-weak-wifi.md
```

(b) Replace “against ~2 s to transcribe at any size” with approximately:

> against 1.6–2.7 s to transcribe in this run; two calls per file showed no visible size penalty but were too few to establish independence from size

### The stated suspicions

- `supportedAttempts`’ default evaluation is harmless here. `takesAacBitrate()` is pure and safe without `navigator`; `pickMimeType` has no production call site. `recordTrack` is the caller where evaluating it is required.
- Base64 padding overstates size by at most two bytes. At the server’s 2,000-character floor that is at most about 0.13%, and much less for a real recording. Whole-second duration rounding dominates: it can noticeably skew a two-second clip, but cannot bridge the fourfold 48-versus-192 kbps distinction. Use a longer iPad acceptance clip for a cleaner number.
- An unrecognised iOS in-app browser receives no hint, which is precisely pre-`705553da` behaviour. Android WebView is Chromium/Blink and likewise correctly receives no hint.

Checks run read-only:

- `tests/mic-recording.test.ts`: 36/36
- `tests/ai-call.test.ts`: 50/50
- `tests/transcribe.test.ts`: 46/46
- `tests/fleet-imports.test.ts`: 14/14
- `git diff --check`: clean

I changed no files; the pre-existing modified review-prompt file remains untouched.