You are reviewing a plan, read-only. Do not edit any file.

The plan: docs/plans/261024z-dictation-asks-for-the-microphone-inside-the-press.md — read it in full.

Context: a reader (the product owner, on an iPad home-screen web app) reports that every press of
the dictation button in chat asks for microphone permission again, while the Feedback dialog seemed
to remember it. The plan argues from production timings plus WebKit source that our getUserMedia is
not counted as gesture-privileged (it runs after awaits: src/web/mic-lock.ts claimMicrophone, and
enumerateDevices in src/web/mic-devices.ts), so iPadOS re-prompts after 1 minute idle instead of 10,
and proposes issuing getUserMedia synchronously inside the click on non-Chromium browsers when safe.

Read the code it touches: src/web/useDictation.ts (start(), the async IIFE after setDeviceId(preferred),
beginCapture, probeIsSafe, finish), src/web/mic-lock.ts, src/web/mic-devices.ts, and the prior plans
docs/plans/261008d-dictation-button-holds-still-and-why-the-iphone-asks-again.md (Part 1 and Stage 2)
and docs/plans/260910g-dictation-asks-for-the-microphone-twice-on-iphone.md. The fixture is
tests/dictation-phases.test.ts.

Please answer:
1. Is the diagnosis sound? Is there a better-supported explanation for "chat prompts every time,
   feedback did not" given the table in the plan? Anything in WebKit you know about gesture
   propagation across await / enumerateDevices in shipping iOS/iPadOS 18-26 that settles it?
2. Is the early-request design correct and safe: ownership of the early stream on every bail-out
   path, interaction with the mic lock (claimMicrophone's previous.stop()), the stale-claim guard,
   chooseDevice restarting a session, the probe cache, Firefox, a pending Live ticket in ChatPanel?
3. Is the remembered device listing correct (when stored, when dropped, staleness risks), and is
   there a simpler way to decide the constraint synchronously?
4. Anything simpler that achieves the same, or anything missing from the tests.

Write findings as a numbered list, most severe first, each with file:line evidence and a concrete
suggested change. Say plainly if you think the plan should not be built.
