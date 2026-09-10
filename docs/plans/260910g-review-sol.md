I found two substantive issues and one test-evidence wording issue; all are fixed in the working tree. No commit was made.

### Findings

**R1 — P1 — `src/web/useDictation.ts:1581`: property presence was not a sound Chromium gate**

`"userAgentData" in navigator` is not Chromium-exclusive. WebKit implemented the API in 2025; its normal brand is `AppleWebKit`, and WebKit can expose it through an internal setting or site-specific quirk. [WebKit implementation](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/NavigatorUAData.cpp), [quirk table](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/QuirkTable.cpp).

That meant a future-enabled or configured Safari could enter the dangerous probe path and restore the extra permission request.

Fixed at [useDictation.ts:1581](/home/greg/code/spideryarn2/.claude/worktrees/fb2r-mic-permission-twice-ios/src/web/useDictation.ts:1581): `probeIsSafe()` now requires a `Chromium` entry in `userAgentData.brands`. Microsoft specifically recommends that check for Chromium-engine detection, and Edge’s normal brand list includes it. [Microsoft Edge guidance](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/user-agent-guidance).

Red-first evidence:

```text
npx vitest run tests/dictation-phases.test.ts \
  -t "does not mistake WebKit's userAgentData implementation for Chromium"

Before fix: 1 failed, 42 skipped
expected [], received [null]

After fix: 1 passed, 42 skipped
```

The regression test at [dictation-phases.test.ts:620](/home/greg/code/spideryarn2/.claude/worktrees/fb2r-mic-permission-twice-ios/tests/dictation-phases.test.ts:620) models WebKit’s actual `AppleWebKit` brand.

**R2 — P1 — documentation and comments presented a source-derived explanation as device-observed fact**

The original plan, postmortem, project documentation, and code comments stated definitively that abort does not dismiss the visible prompt and that the two requests necessarily produce two prompts.

The WebKit source establishes that:

- `SpeechRecognition.start()` reaches its permission machinery.
- `abort()` removes the recognition request.
- There is no visible source path cancelling permission UI already requested.
- The later `getUserMedia` is a separate request.

It does not establish how Safari’s closed-source UI displays, merges, or queues those requests. Greg observed two prompts, but this specific causal match has not been reproduced on an iPhone. [SpeechRecognition.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/speech/SpeechRecognition.cpp), [permission manager](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/SpeechRecognitionPermissionManager.cpp), [recognition server](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/SpeechRecognitionServer.cpp).

Fixed in:

- [plan:16](/home/greg/code/spideryarn2/.claude/worktrees/fb2r-mic-permission-twice-ios/docs/plans/260910g-dictation-asks-for-the-microphone-twice-on-iphone.md:16)
- [postmortem:3](/home/greg/code/spideryarn2/.claude/worktrees/fb2r-mic-permission-twice-ios/docs/postmortems/260910e-a-cancelled-request-still-asks-the-reader.md:3)
- [dictation.md:271](/home/greg/code/spideryarn2/.claude/worktrees/fb2r-mic-permission-twice-ios/docs/project/dictation.md:271)
- [useDictation.ts:1499](/home/greg/code/spideryarn2/.claude/worktrees/fb2r-mic-permission-twice-ios/src/web/useDictation.ts:1499)

I also corrected “No iPhone has run dictation” to “No iPhone has run the fix”; Greg’s report is itself an iPhone dictation observation.

**R3 — P2 — `tests/dictation-phases.test.ts:579`: the test claimed to verify prompt count**

The jsdom fake observes calls to `SpeechRecognition.start()` and `getUserMedia`; it cannot observe Safari permission dialogs. The original test title and commentary said it proved Safari asks once per press.

Fixed at [dictation-phases.test.ts:579](/home/greg/code/spideryarn2/.claude/worktrees/fb2r-mic-permission-twice-ios/tests/dictation-phases.test.ts:579): it now claims only what it measures—one owned capture per press and no recognizer start—and explicitly says permission UI needs device verification.

The requested pre-fix experiment did demonstrate that the tests genuinely detect the unwanted API path:

```text
probeIsSafe() temporarily changed to return true
npx vitest run tests/dictation-phases.test.ts

1 file failed
3 failed, 39 passed
Safari cases received [null] or [track] instead of []
```

The experiment was reversed by editing, without stash/reset/restore.

### Recognizer-start trace

There are exactly three recognizer starts:

- [useDictation.ts:1515](/home/greg/code/spideryarn2/.claude/worktrees/fb2r-mic-permission-twice-ios/src/web/useDictation.ts:1515): capability probe. Guarded by the `Chromium` brand check and constructor-keyed cache. WebKit returns `false` before this call.
- [useDictation.ts:1680](/home/greg/code/spideryarn2/.claude/worktrees/fb2r-mic-permission-twice-ios/src/web/useDictation.ts:1680): initial live recognition. Reached only when the probe returned `true`, an owned track was obtained, the request is still wanted, and both recognizer and track exist. It always passes that track.
- [useDictation.ts:1083](/home/greg/code/spideryarn2/.claude/worktrees/fb2r-mic-permission-twice-ios/src/web/useDictation.ts:1083): `onend` restart. Guarded against a finished/stale/stopped session, `liveGaveUp`, and a missing or ended owned track. It also always passes the track. It is unreachable on WebKit because WebKit never receives the initial start.

`onaudiostart` and `onsoundstart` only update UI/tape state. `onerror` sets `liveGaveUp` and prevents restart. The calls named `start()` at lines 1199 and 1236 invoke the hook’s capture callback, not `SpeechRecognition.start()`.

There is a second `getUserMedia` invocation only when a remembered exact device fails with `OverconstrainedError` or `NotFoundError`; constraint/device selection precedes the permission-request step, so this is not the reported two-permission path. [Media Capture specification](https://www.w3.org/TR/mediacapture-streams/#dom-mediadevices-getusermedia).

### Chromium and fixture conclusions

Normal secure-context desktop Chrome/Edge behavior remains unchanged after the gate: both expose the `Chromium` brand, execute the same probe, and continue through the same `start(track)` path. Insecure contexts may lack UA data, but they also cannot use `getUserMedia`. The enterprise switch disabling UA Client Hints ended with Chrome 93, before the track overload. An unusual embedder or UA override can omit the brand; its only regression is loss of live words, while recording and final transcription remain.

The fixtures do not leak in a way that creates false passes:

- Every `dictation-phases` `beforeEach` overwrites the engine state.
- `useSafari()` installs a fresh subclass, defeating the constructor-keyed WeakMap cache.
- `dictation-recording` overwrites `userAgentData` in every `beforeEach`.
- Vitest explicitly has per-file `isolate: true` at [vitest.config.ts:169](/home/greg/code/spideryarn2/.claude/worktrees/fb2r-mic-permission-twice-ios/vitest.config.ts:169).

Final checks:

```text
Scoped Vitest: 2 files passed, 65 tests passed
Four underlying tsc projects: exit 0
Biome: no errors; 2 pre-existing complexity infos
git diff --check: passed
```

`npm run typecheck` itself could not open tsx’s local IPC socket in this sandbox (`listen EPERM ... /tmp/tsx-1000/99.pipe`), so I ran its four underlying `tsc --noEmit` commands directly; all passed.

Verdict: ship after fixes.