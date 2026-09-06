# Realtime chat browser evidence

Baseline: 2026-09-06, worktree base `28096583`, local Postgres at `127.0.0.1:54362`, Vite at `127.0.0.1:5273`. Driven in Chrome through the browser skill by the browser subagent. Signed into the existing local dev-admin account using the normal form; no production data changed.

## Before repair

- The Chat Live control has an accessible label but no tooltip or accessible description.
- New local conversation `spya-ydh8rj`: pressing Live stays on a disabled “Starting a live conversation” for over 60 seconds. There is no cancel, transcript, local input level, or visible error. The page reports its placement assumption as Laptop because it cannot name the device.
- Server correlation: `POST /api/chat/noema-mythology-of-conscious-ai/spya-ydh8rj/live` returned HTTP 200 at `2026-09-06T09:16:30.677Z`, duration 1366ms. Token issuance completed; browser capture/connection did not. No microphone permission prompt is reachable through the page automation surface. Reload ended the stuck attempt.
- Supplemental check at `/preview/preview-live.html?slug=noema-mythology-of-conscious-ai`, backed by the repo's loopback spike server: “Connect silently” reached `live`. A typed article question requesting a passage produced 57 assistant transcript deltas, two `response.output_audio.done`, two `output_audio_buffer.started`, two `response.done`, one `show_passage` call and one visible passage pointer. No provider error.

The preview uses the actual session builder and WebRTC hook with a synthetic silent track. It establishes connection, generated output, transcripts and tools. It does **not** establish real microphone capture, speaker audibility, or Chat persistence; the preview has no chat controller. Its detached audio element cannot be inspected through DOM queries.

## After repair

2026-09-06, same local Chrome session and server. The composer preview uses the actual `Composer` and stylesheet with deterministic fake live states; observations here are UI evidence, not acoustic evidence.

- `/preview/preview-composer.html`: all 24 cases (eight states at 320, 400 and 680 CSS px) had `scrollWidth === clientWidth` at their declared width. The app colour token was present and the composer computed to `display: flex`, so this measured the real stylesheet. Screenshots of the 320px transcript and quiet/blocked-output cases showed readable text, meter bars, microphone name, selectors, and recovery controls inside the panel.
- The Live tooltip appeared after actual pointer hover and after keyboard focus from Dictate. Its text explains two-way speech, interruption, OpenAI audio transmission, and returning to this same conversation by typing, dictation or resuming.
- Transcript defaults checked. Unchecking and rechecking the 320px streaming case removed and restored both speaker-labelled lines, including the unfinished answer indicator. Listening, Speaking, Thinking, and Finishing states rendered distinctly. Quiet input displayed a microphone-check notice; blocked output displayed Enable sound; the failure case displayed Retry live, Continue typing, and Use dictation. Those preview handlers are deliberately inert.
- Actual app, new local chat: pressing Live displayed Starting live conversation, an enabled Cancel control, transcript, and typing/dictation alternatives. Cancel returned to idle. A typed draft survived unchanged and remained editable.
- Starting again with microphone permission unresolved reached a visible failure by the 21.6-second observation: “The live session did not finish starting. Check microphone permission, then try again or carry on typing.” Retry live, Continue typing, and Use dictation were visible. Continue typing focused the textarea, preserved the draft, and left Dictate enabled.
- The browser caught an integration gap in the empty Chat list: only New conversation appeared, without Live. After the implementation fix and source freeze, the same empty list exposed its composer and Live control. Typing a draft there then pressing Live created and opened local thread `spya-fz9uss`, displayed Starting/Cancel, and transferred the draft unchanged into the thread composer. Cancel restored the enabled Live button and left the draft editable. No reload interrupted this final rerun.

Two intermediate reruns were excluded: Vite full reloads at 09:35:29 and 09:36:48 UTC, followed by its server connection loss/restart at 09:37:13–17, interrupted a provider tool turn and a list-to-thread draft handoff respectively. These observations are neither successful checks nor product failures. The root was integrating source and remote changes at those times; final reruns waited for a source/server freeze.

### Final provider run after source freeze

The final silent-track session connected at approximately 09:42:40 UTC. One typed prompt requested two `search_article_words` calls and passage pointing before an explanation. The actual provider completed both searches (2 passages in 367ms; 4 passages in 468ms), then two `show_passage` calls (`spya-hj5y6s`, `spya-pbcr03`), then a coherent answer relating biological naturalism to simulation versus instantiation. An unfinished answer was visible during generation and became a completed transcript on the next observation.

- Final event totals: 95 `response.output_audio_transcript.delta`, 2 `response.output_audio_transcript.done`, 2 `response.output_audio.done`, 2 each `output_audio_buffer.started` and `.stopped`, 4 `response.function_call_arguments.done`, 5 `response.created` and 5 `response.done`.
- Exactly one reader transcript paragraph matched the typed prompt. There was no extra empty reader line; an intermediate browser run had exposed that problem before the final runtime fix.
- No provider error event occurred. The only current-session console error was the preview's declared unmetered-session warning; older HMR `createRoot` warnings predated the final reload/session.
- Hang up visibly passed through `closing` to `idle`, leaving the transcript readable and Connect silently enabled. No server restart or source reload interrupted this run.

This is real provider, WebRTC, multi-tool continuation, streamed transcript, and generated-audio evidence using synthetic silent input. It does not verify physical microphone sound, speaker audibility, or persisted Chat voice turns. Actual Chat creation, cancellation, bounded failure, draft transfer and typing recovery were verified separately above; persistence and resumed-history seams are covered by the recorded automated tests.
