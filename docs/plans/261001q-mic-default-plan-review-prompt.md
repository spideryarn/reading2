Review the plan docs/plans/261001q-mic-follows-the-system-default-and-says-which.md (read-only; do not edit files).

Context: Greg reported dictation returning [mic-silent] on his Mac when the system input is his webcam mic, while other apps hear it. Read src/web/mic-devices.ts, src/web/DictationStrip.tsx, src/web/useDictation.ts (beginCapture, around lines 2130-2230, and the device-verdict code around 1500-1570), src/web/live/useLiveConversation.ts (around 1800), and docs/project/dictation.md.

Questions:
1. Is the diagnosis (a stale remembered exact-id pick from our own picker) sound given the code? Is there any other path in our code that could open a non-default device with nothing remembered?
2. Should we ask for { deviceId: { ideal: "default" } } rather than { audio: true }? What do you know about Chrome's per-profile / per-site preferred microphone (including the device chooser in recent Chrome permission prompts) and whether it overrides the OS default for { audio: true }? Is ideal:"default" safe on Safari/iOS and Firefox?
3. Should we reset remembered picks once? Weigh this against the plan's reasoning.
4. Anything the plan misses: accessibility of the always-visible label, narrow windows, the live-conversation surface, the fallback paths that use { audio: true } literally.

Check the conclusions too, not just the reasoning. Give findings ranked P0/P1/P2 with concrete fixes.
