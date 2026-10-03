# Review request: plan 261002j (live voice chat cleanup)

You are reviewing a PLAN, read-only, before anything is built. Repo: Spideryarn (TypeScript, React, a
reading app). Read:

- `docs/plans/261002j-live-voice-chat-cleanup.md` — the plan under review (Greg's report is quoted in it).
- `docs/project/live-conversation.md` — the feature as it is today, including the three orderings and the lifecycle table.
- `src/live.ts` (server session config, prompt), `src/web/live/useLiveConversation.ts`, `src/web/live/LiveStatus.tsx`, `src/web/live/LiveButton.tsx`, `src/web/live/exchanges.ts`, `src/web/ChatPanel.tsx` (around lines 1150-1230 and 2180-2300).
- OpenAI's own docs, downloaded 2026-10-02, in `logs/f4eq-openai-docs/` — `f4-live*.md` (GPT-Live guides), `f4-gpt-live-1.md`, `f4-realtime-models.md` (realtime prompting guide incl. reasoning effort), `f4-gpt-realtime-2.1.md`, `f4-voice-agents.md`.

Questions, in order of importance:

1. **The central call.** The plan does NOT switch to `gpt-live-1` now; it ships the UI/prompt/effort work on `gpt-realtime-2.1`, spikes GPT-Live with a measured script, and decides the migration on the numbers. Greg's report asks for the newest model "first things first". Is deferring right, or is the migration small enough / important enough to do now? Is the plan's reading of the GPT-Live API correct (16k instruction cap, no turn ids, delegation, billing)? Anything in the docs that makes it easier or harder than the plan says?
2. **Stage 1b, the words in one place.** Rendering unsaved live lines inside the thread, removing each exchange's lines as its saved rows arrive. What breaks? Duplicates, flicker, scroll "stick" logic, ordering when transcription arrives after the answer (ordering rule 1), interrupted answers, `hasUnsavedLines`, a 409 reload mid-session.
3. **Stage 1c, the meter during connecting.** The track is created disabled until seeding finishes (ordering rule 2). Can `useAudioLevel` read a disabled track (a disabled track produces silence)? If not, what is the right way to show input level before the track is enabled without a second capture (the doc forbids a second capture) and without sending audio early?
4. **Stage 1a.** Where does `reasoning.effort` go in a realtime session object for client_secrets? Any risk in "low" for this use (a reading companion that must cite passages via `show_passage`)? Is the prompt change sound?
5. **Stage 1d.** Removing "Continue typing" and "Use dictation": anything in the lifecycle (the closing/reconnect teardown, the comment in LiveStatus about joining a reconnect's teardown) that depended on those buttons?
6. Anything missing, wrong, or over-built. Simpler options.

Be concrete: file:line, the failure scenario, the fix. Rank by severity (P0/P1/P2). Do not edit any files.
