---
reports: spya-f4eq7p
ending: shipped
---
# Live voice chat: a calmer screen, shorter answers, and GPT-Live measured

Report `spya-f4eq7p` (suggestion), from Greg (admin, trusted input), 2026-09-29 17:45 UTC, on
`/read/pnas-202123432-spya-rekvg9?mode=chat&thread=spya-wpsbyc`. Overseer queue item `qi-tbfjt92y`.

> The live chat in a conversation, you know, the real-time dialogue, somehow it's a bit janky. First
> things first, can you make sure that you're using the latest OpenAI thing for it? I think they
> released something recently. So there was GPT Real-time 2.1, and now there's GPT Live, that I
> assume is more recent and better in some ways. So let's try and make sure we're using that.
> Secondly, can you, I guess probably we want to be in instant mode. I don't know if there is a way
> for it to do something clever with tool use in the background or for it to adaptively decide how
> much it needs to think. If possible, we would do that. And then maybe in the prompt, if there is
> one, tell it to avoid too much, like, verbal niceties. So yeah, you know, great for it to explain.
> I mean, maybe we want its output to be somewhat compact unless the user asks for detail, just
> because it's a conversation. I want it to be kind of a bit more quick back and forth. And then
> also have a look at the user interface with the screenshot. It's super confusing. Like, I start, I
> click the live button, and then nothing seemed to be happening for a minute, and I couldn't tell
> if it was connecting or if it was listening to me or recording. So maybe at the very least I want
> some kind of input volume level to show that it's taking stuff in. And then if there's a problem,
> I want it to be clear that there's a problem. And then, like, it was sort of showing the words
> streaming in, but in one place, but then they'd show up in the chat in another place. I mean,
> could those not be the same place so that my eye doesn't have to jump around and it's less
> confusing? And there was a button to sort of switch from live to voice dictation. I don't think we
> need that. Like, let's try and make it be a bit cleaner. And there was stuff around headphones and
> others. I mean, maybe you could hide that in an advanced section. In other words, how can we just
> streamline this live chat experience and, like, both make it more robust and make it more
> intuitive?

**Ending: Shipped** on `dev` — everything except the model switch, which was measured and deferred
with its own queue entry (`qi-hq3fv9pw`, needs Greg). Plan:
[261002j](../plans/261002j-live-voice-chat-cleanup.md).

## What was done

- **The newest model: measured, not adopted yet.** `gpt-live-1` exists and our key reaches it, but
  it is a different architecture (a voice front end that hands thinking to a backend model). It
  was about a quarter of the cost per turn and quick on follow-ups, but a real answer about the
  article came about two seconds *later*, usually behind "Checking." —
  [261002r](../investigations/261002r-gpt-live-spike.md). Queued as `qi-hq3fv9pw` with the four
  conditions that would change the answer.
- **Instant mode:** low reasoning effort on `gpt-realtime-2.1`, and a prompt that answers at once
  and thinks only when the question needs it. Honest result: no faster — the model's own thinking
  was never the delay — but no worse at finding the right passage.
- **Terser:** one or two sentences, no pleasantries, no repeating the question, no sign-off offers.
- **Says what it is doing:** one state pill, named connecting steps, the input level meter from the
  moment the microphone opens, and a red Error with its sentence and **Try again**.
- **Words in one place:** the live words now appear in the chat thread itself and turn into the
  saved turns in place.
- **Cleaner:** no dictation or "continue typing" buttons in the live panel; microphone, noise
  reduction (Auto/Headphones/Laptop) and Reconnect are under a closed **Advanced**.

## What the measurement found, for whoever comes next

The real delay is two things, neither fixed here: the model calls `show_passage` before its first
word (~1.2 s, and telling it not to changed nothing), and the turn detector (`semantic_vad`) waits
up to several seconds after a hesitant question. Making the detector more eager would reverse a
deliberate choice not to cut a thinking reader off, so it is Greg's call; it belongs beside
`qi-8k6vjbzz` (street noise ending turns).
