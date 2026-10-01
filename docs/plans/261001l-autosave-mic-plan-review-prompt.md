Review the plan docs/plans/261001l-autosave-about-you-and-honest-mic-fallback.md (read-only review; do not edit files).

Read the code it touches first: src/web/ProfileBox.tsx, src/web/ProfilePage.tsx (the About you section), src/web/useProfile.ts, src/web/Metadata.tsx (purposeDraft / commitPurpose and the "Why you're reading this one" ProfileBox), src/web/useDictationField.ts, src/web/useDictation.ts (beginCapture, start, chooseDevice, deviceUnavailable), src/web/mic-devices.ts, src/web/DictationStrip.tsx (the prof-mic-warn line and the picker).

Questions:
1. Is the diagnosis of the false microphone warning right? In particular, is it true that Safari/WebKit (iOS) rotates getUserMedia deviceIds across visits when mic permission is not persisted, and is there any other plausible cause (e.g. iOS AirPods route change making the exact id fail) the plan should handle? Is "same label on the fallback track => same device" safe, and is forgetting an id-only legacy preference acceptable?
2. Autosave design: SaveState union in ProfileBox, 2s idle timer, beforeunload while dirty/saving, visibilitychange->hidden commit. Any race with dictation (useDictationField commits, readOnly), with useProfile's generation/inFlight de-dupe, or with the conditional draft write-back? Any case where the status says Saved when the server does not have the text (silent success)?
3. Anything simpler that gets the same result, or anything missing?
Answer with numbered findings, each with severity (P0-P3), the file/line it concerns, and a concrete fix. Keep it concise.
