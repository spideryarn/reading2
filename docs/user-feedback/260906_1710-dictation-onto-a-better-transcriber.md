---
reports: spya-rznv3m
ending: shipped
---
# Dictation is slow and wrong: move it to a better transcriber

`spya-rznv3m`, 2026-09-06 17:10Z, from Greg (admin). It never got a note, so the Earlier tab showed it
as not shipped. The words below were read from its row in production on 2026-10-01.

> The current voice-dictation is really crap and slow. Switch to a different one (probably from
> OpenAI) that also accepts vocabulary as input. Optimise for correctness, then latency, then
> cost-efficiency.

**Ending: Shipped**, 2026-09-07, and deployed since.

Dictation moved off a chat model onto `openai/gpt-transcribe`, through OpenRouter's transcription
endpoint, and the article's vocabulary is passed to it. It landed on `dev` at `5149b922`:
[260907c](../plans/260907c-dictation-onto-an-openai-transcriber.md). The privacy wording that move
needed is in [awaiting-approval.md](awaiting-approval.md). A later report about slowness on weak
Wi-Fi is [260912_0818](260912_0818-dictation-slow-on-weak-wifi.md).
