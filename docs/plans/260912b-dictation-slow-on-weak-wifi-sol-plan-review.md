No established P0 or P1, so I would not refuse the plan. I would add the F1 acceptance gate before calling Stage 2 successful.

### Findings

**F1 — P1, reasoned — the proposed AAC encoding has no quality evidence**

(a) Every AAC row was unsupported; all accuracy results came from Opus ([spike script](/home/greg/code/spideryarn2/.claude/worktrees/fb39-dictation-slow-on-weak-wifi/scripts/spike-dictation-latency.ts:66), [plan](/home/greg/code/spideryarn2/.claude/worktrees/fb39-dictation-slow-on-weak-wifi/docs/plans/260912b-dictation-slow-on-weak-wifi.md:116)). A real iPad could accept 48 kbps AAC and produce the desired 6 KB/s while making noisy or stereo speech less intelligible. The proposed production check would report “~48, success” even if transcripts regressed.

(b) Add this Stage 2 acceptance criterion:

> On the reporting iPad, record the same reference passage as default AAC and 48 kbps AAC. Verify that the hinted recording is non-empty, playable, approximately four times smaller, produces no recorder fallback, and does not worsen WER or hard-term recovery. The bitrate log alone does not establish transcription quality.

**F2 — P2, established — the spike establishes leverage, not the cause of Greg’s incident**

(a) `weak-wifi` is explicitly a guessed 1 Mbps, fixed-throughput profile without packet loss ([script](/home/greg/code/spideryarn2/.claude/worktrees/fb39-dictation-slow-on-weak-wifi/scripts/spike-dictation-latency.ts:84)). At 5 Mbps, the measured 1,323,101-byte request takes about 2.1 seconds plus latency—comparable to the 1.6–2.7-second transcriber, not five times larger. Nothing measured Greg’s actual uplink or iPad base64 time, yet both the plan and feedback note say unconditionally “It is the upload” ([feedback note](/home/greg/code/spideryarn2/.claude/worktrees/fb39-dictation-slow-on-weak-wifi/docs/user-feedback/260912_0818-dictation-slow-on-weak-wifi.md:15)).

(b) Replace the headline conclusion with:

> On a modeled 1 Mbps uplink, upload dominates: 10.8 seconds against 1.6–2.7 seconds for transcription. We did not measure Greg’s actual link, so this establishes that request size is the strongest available lever, not that upload caused that particular incident.

For an established incident diagnosis, measure base64 time, total fetch time, and the server’s returned `ms` on the reporting iPad.

**F3 — P2, reasoned — telemetry can fail silently**

(a) `usage.seconds` was previously observed for this model, but it remains an external response field. The plan names red-first tests only for `mic-recording.ts`; it does not specify parsing or missing-field behavior for `ai-call.ts` and `transcribe.ts` ([plan](/home/greg/code/spideryarn2/.claude/worktrees/fb39-dictation-slow-on-weak-wifi/docs/plans/260912b-dictation-slow-on-weak-wifi.md:183)). If OpenRouter omits it or changes its shape, transcription still works but the promised `kbps` evidence disappears—the silent-success class this telemetry is meant to prevent.

(b) Add:

```ts
const seconds =
  typeof usage.seconds === "number" &&
  Number.isFinite(usage.seconds) &&
  usage.seconds > 0
    ? usage.seconds
    : null;
```

Always log `audioSeconds` and `kbps`, using `null` when unavailable, and warn/count successful replies missing valid seconds. Add red-first cases for present, absent, string, zero, and malformed usage in `tests/ai-call.test.ts` and `tests/transcribe.test.ts`.

**F4 — P3, established — transcription “independence” is overstated**

(a) There are only two calls per file, while observed provider variation spans about 1.06 seconds. That can hide a smaller decoding cost. The data show no visible penalty for the 192 kbps file in this run; they do not establish independence from file size.

(b) Replace lines 105–107 with:

> Across two calls per file, no file-size penalty was visible: the 192 kbps file took 2.00 and 2.05 seconds, within the run’s overall 1.59–2.65-second range. This run is too small to establish that transcription time is independent of file size.

Make the same qualification in the deferred section.

**F5 — P3, established — Stage 3 saves one quarter, not one third**

(a) Raw took 8.10 seconds versus 10.80 seconds. Base64 adds one third relative to raw, but removing it saves `2.70 / 10.80 = 25%` of the current upload ([plan](/home/greg/code/spideryarn2/.claude/worktrees/fb39-dictation-slow-on-weak-wifi/docs/plans/260912b-dictation-slow-on-weak-wifi.md:164)).

(b) Replace “A third off every upload” with:

> About a quarter off the current JSON upload—8.10 seconds rather than 10.80—because base64 makes the raw payload one third larger.

**F6 — P3, established — the committed candidate manifest is inaccurate**

(a) `origin/dev...HEAD` changes five paths, not the listed four: it also commits `docs/plans/260912b-dictation-slow-on-weak-wifi-sol-plan-prompt.md`. That file still contains “I will record the second SHA here.” The second commit is `de555fcf`.

(b) Either remove that prompt from the candidate or list it and replace the self-SHA placeholder with wording that does not require a commit to contain its own hash.

### The three stated suspicions

- `usage.seconds`: prior repo evidence records `{seconds, cost}` for 3- and 22-second inputs, so presence for the current endpoint/model is supported. F3 is about validation and future absence, not claiming it is currently absent.
- Firefox, Android WebView, and Samsung Internet retain today’s no-hint behavior under the exact Apple-vendor allowlist. I found no concrete false-positive engine.
- The file-size/latency claim is indeed too strong; that is F4.

I changed no files. I checked the committed JSON arithmetically; it reproduces 192.6 kbps, 10.799 seconds JSON versus 8.096 seconds raw, and the 25% raw-body saving. I did not run a test because the shared working tree acquired uncommitted Stage 2/mutation edits during the review, so a test would not have exercised the two-commit candidate.