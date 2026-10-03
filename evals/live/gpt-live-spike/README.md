# GPT-Live spike (2026-10-03)

The throwaway that proved GPT-Live's tool loop can be relayed by the browser alone, with no
server sideband. What it found is Stage 0 of
[261003a](../../../docs/plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md).

```
npx tsx evals/live/gpt-live-spike/spike-server.ts     # 127.0.0.1:5398, needs OPENAI_API_KEY; spends money
npx tsx evals/live/gpt-live-spike/spike-drive.ts --name=typed --audio=tone --ask="What does the article say about the lighthouse?" --seconds=25
npx tsx evals/live/gpt-live-spike/spike-summary.ts typed full
```

The `spike-out-*.json` files are raw data-channel traces from real sessions: `typed` and `spoken`
with no allowlist, `allow` with the production-shaped allowlist, and `allowmin`, the run where the
loop completed and no output transcript arrived. They are the reference for the event shapes.
The driver hardcodes the macOS Chrome path; the spoken run needs a WAV made with `say`.
