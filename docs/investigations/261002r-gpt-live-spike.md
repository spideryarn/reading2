# GPT-Live spike: should live conversation move from `gpt-realtime-2.1` to `gpt-live-1`?

Up: [investigations.md](../project/investigations.md) · Plan: [261002j](../plans/261002j-live-voice-chat-cleanup.md)
(Stage 0) · Feature: [live-conversation.md](../project/live-conversation.md)

## The answer

**Not now. Revisit when four conditions hold (below).** `gpt-live-1` is three things Greg asked
for. In a dense conversation it costs about a quarter as much per turn. It answers chat-style
follow-ups in about 1.3 seconds instead of 6.6. And it says *something* within about 1.3 seconds, every time.
But on the question this product exists for, "what does the article say about X?", the real answer
arrives about two seconds **later** than today. That answer is a delegated round trip to a backend
that holds the article. In 32 of 36 turns it was preceded by filler ("Checking.", "Let me check
that part.", "[hum]"), the verbal padding Greg asked us to remove. It also missed one correction in
six. And moving to it rewrites the three most failure-prone parts of the live code.

> First things first, can you make sure that you're using the latest OpenAI thing for it? … probably
> we want to be in instant mode. I don't know if there is a way for it to do something clever with
> tool use in the background … tell it to avoid too much, like, verbal niceties … I want it to be
> kind of a bit more quick back and forth.
>
> — Greg, 2026-09-29 (report `spya-f4eq7p`)

**Low reasoning effort (B) is safe to ship, and it buys no speed.** Against the default (A) it
found the right passage just as often (24/24 against 24/24), handled corrections as well (6/6
against 6/6) and gave answers of the same length. The model's own time was the same: 1.81 s
against 1.80 s from the end of the turn to its first audio.

**Most of today's delay is not the model at all, and it can be fixed without migrating.** Two
things cause it. Each is measured below.

1. **It points before it speaks.** The Realtime model calls `show_passage` *before* its first word
   in 89% of turns (64/72), and that costs about 1.2 seconds: 1.85 s from end-of-turn to audio when
   it points first, against 0.6–0.7 s when it just talks. **Telling it to speak first does not
   change this** ([B′, below](#b-speak-then-point-measured-2026-10-03)): it still pointed first in
   13 of 15 turns.
2. **The end-of-turn detector waits.** This is `semantic_vad` at `eagerness: auto`. It waited a
   median 0.8 s after a crisp question, 2.9 s after "What's the point of the schizophrenia gene
   example?", and **4.6 s** after "Hmm. So is that a good thing or a bad thing?". That is why the
   simplest question we asked was the slowest one today.

### The numbers

Measured 2026-10-02/03 on the Hetzner box over WebSocket. The command is
`npx tsx evals/live/gpt-live-spike.mts --configs=A,B,C,Cin --reps=3`, and the GPT-Live arms were
re-run with the final measure (below) as `--configs=C,Cin`. Reproduce the tables with
`node evals/live/results/261002r-gpt-live-spike/analyse.mjs`. Times are in milliseconds from the end
of the spoken question to the first **audible** audio. Each cell is median / 90th percentile /
worst.

| | A: realtime-2.1, default effort | B: realtime-2.1, `low` | C: gpt-live-1 + gpt-6-luna backend |
| --- | --- | --- | --- |
| Follow-up, no lookup (n=6): first substantive audio | 6,585 / 7,510 / 7,510 | 6,641 / 7,471 / 7,471 | **1,302** / 9,306 / 9,306 |
| Article question (n=24): first audio of any kind | 3,160 / 6,924 / 32,810 | 2,971 / 6,273 / 6,823 | **1,359** / 1,645 / 1,932 |
| Article question (n=24): first **substantive** audio | 3,160 / 6,924 / 32,810 | **2,971** / 6,273 / 6,823 | 5,205 / 6,215 / 7,635 |
| Correction mid-answer (n=6): substantive audio after the correction ends | 5,709 / 6,724 / 6,724 | 5,864 / 6,438 / 6,438 | 4,571 / 8,509 / 8,509 |
| `show_passage` called on an article question | 24/24 | 24/24 | 24/24 (by the backend) |
| …and pointing at the right passage | 24/24 | 24/24 | 24/24 |
| Answer actually followed the correction | 6/6 | 6/6 | **5/6** |
| Turns with a filler utterance before the answer | 0/36 | 0/36 | **32/36** |
| Spoken answer length, median words | 48 | 48 | **28** |
| Cost per turn, short article (~9k tokens) | $0.067 | $0.057 | $0.018 |
| Cost per turn, long article (~27k tokens) | $0.105 | $0.119 | $0.021 |
| Cost per minute of these sessions | $0.28 | $0.31 | **$0.05** |
| Session start (mint + connect → ready) | 1.5–1.9 s | 1.5–1.9 s | 1.2–1.6 s (WebSocket; WebRTC not measured) |

**Cin** is C with the short article also in the voice model's instructions. It answered follow-ups
in 1.2 s (3/3, none delegated) and article questions in 4.5 s (3/3 delegated, all pointed right).
Having the article in the voice prompt does not stop it delegating when there is a passage to show.

Total spend: **$9.43**, excluding text-to-speech. That is the pilots $1.48, the main run $7.13 and
the GPT-Live re-run $0.82.

## What was measured, and how

- **Arms.** A is `liveSession()` from `src/live.ts` with its `reasoning` field deleted, which is
  production before 2026-10-02. B is the same with `reasoning: { effort: "low" }`. Both used the
  **new** `LIVE_SYSTEM` (the working-tree version with WHEN TO THINK and the no-niceties lines,
  sha256 prefix `9d3cf0535008`, recorded in `main-meta.json`), so A and B differ only in effort. C
  is `gpt-live-1` with Responses delegation to `gpt-6-luna` at low effort. Its backend
  instructions hold the whole article with block ids plus `SHOW_PASSAGE_TOOL`, answered by the
  script the way the browser would answer it. Its voice instructions are the spoken rules on
  OpenAI's GPT-Live template (`voiceInstructions` in the script). Without a profile, and without
  the vocabulary `keywords`.
- **Articles.** These came from the local store. The short one is Ioannidis, *Why Most Published
  Research Findings Are False* (`article-spya-uzf7vk`, about 9k tokens). The long one is Gwern, *The
  Scaling Hypothesis* (`scaling-hypothesis`, about 27k tokens). There is no PNAS paper in the local
  database. The production one (`pnas-202123432`) was not copied down. Ioannidis stood in as the
  scientific paper.
- **Scenarios**, three repetitions each, per arm and article:
  1. A follow-up after a seeded exchange ("Hmm. So is that a good thing or a bad thing?").
  2. An article question that needs a passage.
  3. A question corrected while the first answer was in progress. The correction was injected at
     the first audio for Realtime, and at `session.delegation.created` for GPT-Live.
  4. Three questions in one session.
- **Speech.** The questions were spoken by `gpt-4o-mini-tts`, cached, so every arm heard identical
  audio. They were streamed in real time in 100 ms chunks, with silence between questions. A
  synthetic voice is cleaner than a person in a room.
- **What "substantive" means.** For Realtime it is the first audio of the first response whose
  transcript is not filler. Here that is always the first audio, because it never padded. For
  GPT-Live the output audio is a continuous stream with silence in it, so "first audio" means the
  first chunk above a peak of 300. **The answer cannot start before the backend has one.** So
  substantive is the first non-filler speech that begins after the last delegation's text started
  arriving. Its time is when its audio arrived. The transcript leads the audio by a median 0.5 s,
  and those audio times are the ones in the table. The first GPT-Live run measured from the
  transcript, and it let a filler that ran on into the answer ("I'll check how he's using that term
  right there. He means…") count as the answer. Those numbers were too good by up to 3 s, and that
  run's C latencies are not used.
- **Correctness** was judged by reading every answer against the article. All three arms gave
  correct, grounded answers on every turn except the one C turn that ignored the correction. C's
  answers are shorter and sometimes thinner. On "why are hot fields less reliable" it said that
  "the first positive result can get attention, but end up being sharply contradicted". That is
  right, but it lost the many-teams-chasing-the-same-question mechanism that A and B both gave. A
  pointer counts as right if any id it names sits in the section that answers the question. For the
  GPT-3-cost question the abstract and the cost footnote also count. The first scoring range missed
  both, and every arm that pointed there was correct.

## What surprised us

- **GPT-Live speaks almost at once, and what it says is usually filler.** It said something within
  about 1.4 s of every article question, but 32 of 36 turns began with "Checking.", "Let me check
  that part.", "Mm. [lip smack] The", or a pair of them ("Right. Let me check that." … "Oh, sure.").
  The voice prompt asked for "a few words at most, or nothing". Its output transcript also carries
  non-speech tokens in brackets (`[hum]`, `[lip smack]`) that a display would have to filter.
- **The backend round trip is about 3.5 s, and pointing takes half of it.** Median times after the
  end of the question:

  | step | ms |
  | --- | --- |
  | delegation created | 793 |
  | `show_passage` call complete | 1,857 |
  | our function output sent, continuation requested | 2,033 |
  | backend answer text starts | 2,769 |
  | backend response complete | 3,552 |
  | voice speaks the answer | about 5,200 (a median 2.1 s after the text starts) |

  The `show_passage` → continuation leg is a second Responses call. Answering first and pointing
  second, or using client delegation and taking the pointer out of the text ourselves, might save
  1–2 s. Neither was tried.
- **GPT-Live sometimes delegates a follow-up it could answer.** On the long article it sent "is that
  a good thing?" to the backend in 2 of the 3 re-run turns (1 of 3 in the first run), and those
  took 6.1 s and 9.3 s. On the short article it never did.
- **It sometimes delegates before the reader has finished.** In all three long-article corrections
  of the re-run, the first delegation was created about 0.56 s *before* the question had ended.
- **It missed a correction once.** In C, short article, run 3, the correction ("Sorry, no, I meant
  the example about nutrients and tumours") produced no second delegation. The answer mixed the two
  examples: "out of thousands of nutrients, one will barely clear the threshold just by chance". The
  sample is in `events/C-short-s3-r3.jsonl`.
- **Both APIs stalled once, for about 25 seconds.** For Realtime it was A, long article, the
  three-turn run: after our `show_passage` output, the continuation response took 20 s to be
  created (`events/A-long-s4-r1.jsonl`). For GPT-Live it was Cin, short article, run 3: its session
  timeline froze for about 26 s of wall time, and it answered 32.8 s late
  (`events/main-Cin-short-s1-r3-stall.jsonl`). That is one turn in 72 for Realtime and one in 84
  for GPT-Live. One GPT-Live connection also dropped after its turn, before `session.closed`, so
  its final usage is unconfirmed. That happened once in the 60 GPT-Live sessions of the two full
  runs.
- **Timeline is not wall time.** In the stall the session timeline barely moved while 26 s passed.
  A GPT-Live meter or caption grouping keyed on `start_ms` alone would see no delay at all.
- **The backend costs almost nothing.** It used 1.39M input tokens over 36 turns, 97% of them
  cached, and cost $0.02 in total. Reasoning tokens were 0 at `low`. Context use peaked at 3% of
  the voice window, 8% with the article inline.

## The 16k instruction cap

The short article (about 9k by `estimateTokens`) fits in the voice instructions. The long one does
not: `session.start` returns `invalid_request_error` / `invalid_value`, *"Instructions must not
exceed 16384 tokens."* So for long papers the article has to live in the backend, and every
question about it becomes a delegation. The backend's own instructions took the 27k-token article
without complaint.

## What a migration would have to rebuild

- **Exchanges and their ordering** ([live-conversation.md § The three orderings](../project/live-conversation.md)).
  `exchanges.ts` orders and files turns by item and response ids. GPT-Live transcripts have neither.
  They are about 200 ms fragments with `start_ms`/`end_ms`, user and assistant interleaved
  (full duplex), filler and answer in the same stream, and no event that ends a turn. The spike got
  usable turns by splitting at gaps of 600 ms or more on the timeline, plus the delegation boundary.
  For storage that would need its own design and its own tests, including "a filler is not the
  reply".
- **Seeding.** History goes in `session.start`'s `input` (≤128 messages, 8,192 tokens) rather
  than `conversation.item.create` acked per item. It worked: the seeded follow-up was answered
  in 1.2 s without a delegation. The seed barrier becomes "wait for `session.started`", which is
  simpler, but the 8k cap is new and `liveSeedItems` would need to respect it.
- **The meter.** There is no `response.done` and no token usage for the voice. It is
  `session.usage.updated` seconds, final in `session.closed`, plus backend tokens from nested
  `response.completed` events inside `response.event`. Our `realtime_sessions` and
  `acceptRealtimeUsage` path is token-shaped throughout.
- **Tools.** `show_passage` survives as a backend function, called 24/24 and right 24/24, but the
  browser no longer sees it as its own data-channel call. It arrives as a nested
  `response.output_item.done`, and the app must send `response.item.create` plus `response.create`
  to continue. The other eight chat tools would move the same way (not exercised; none was called
  in any arm).
- **The browser handshake. NOT MEASURED.** GPT-Live's WebRTC flow sends the browser's SDP offer to
  *our* server, which creates the session and returns the answer. Today the browser posts SDP
  directly to OpenAI with an ephemeral token. That is a new route, a new failure surface and
  different timing. Everything above is WebSocket from Node. A WebRTC session also bills 15 s at
  creation, credited against duration once it runs.

## The product change

Today the voice model has the article in its head and answers from it. With GPT-Live, every question
about the article (most of them) becomes a delegation. The reader hears "Checking." and then,
about four seconds later, a shorter answer written by a different, smaller model and paraphrased by
the voice. Conversational turns get much faster. Article turns get slower and gain a filler line.
For a reading companion that is the wrong way round, unless the backend round trip can be brought
under today's ~3 s.

## Cost per minute, both ways

- **GPT-Live** costs $0.05 per minute **the session is open**, silence included, plus about $0.0005
  of backend per delegation. Measured: $0.051 per minute.
- **Realtime** costs per token, and nothing while nobody speaks. In these turn-dense test sessions
  that was $0.28–0.31 per minute. Per turn it was $0.06–0.12, and the first turn of a session pays
  for reading the article uncached. The per-turn figure is the comparable one. Each extra turn in
  the same session added about $0.03–0.04.
- **A reader reads between questions.** A 20-minute session with five questions costs about $1.00
  on GPT-Live, or about $0.25 on Realtime (one article read plus five turns). GPT-Live is only
  cheaper while the conversation is dense, unless the app closes idle sessions and re-opens them,
  as OpenAI's own guide suggests. That costs a reconnect (about 1.2–1.6 s here) and a re-seed.

## Recommendation

**Later, with conditions.** Re-run this spike when all four hold:

1. **Article answers arrive no slower than today.** The backend's median from end-of-question to
   substantive audio has to be at most about 3 s. Try answer-then-point, `service_tier: "priority"`
   and client delegation.
2. **Filler can be prompted down.** Most turns must have no "Checking." line.
3. **An idle-close design** for reading pauses, so the per-minute bill tracks talk, not open tabs.
4. **A WebRTC probe** through our own server, to settle the handshake and its startup time.

**Now, on `gpt-realtime-2.1`:** keep `low` effort (B), which is safe. Of the two levers this
spike found:

- "Start speaking, then point" as a prompt instruction **does not work** (B′, below). The model
  ignores it. What is left is structural: drop `show_passage` from the tool list and have the client
  find the passage some other way, or accept the 1.2 s.
- A more eager end-of-turn detector is worth 1–4 s. It would be a reversal of the deliberate
  choice to never cut a thinking reader off, so it is Greg's call, and it belongs with
  `qi-8k6vjbzz` (street noise ending turns). Not measured.

## B′: speak, then point (measured 2026-10-03)

**The question.** Can a prompt make the Realtime model start talking before it calls
`show_passage`, and so save the ~1.2 s that pointing first costs?

**What was tested.** B (low effort, the current `LIVE_SYSTEM`) against B′: the same session with two
edits to a **copy** of the prompt made inside the eval (`POINT_AFTER_EDITS` in
`evals/live/gpt-live-spike.mts`; `src/live.ts` untouched). The script refuses to run if either edit
fails to match, and the instructions B′ sent were 131 characters longer than B's, so the edits
reached the model. In WHEN TO THINK, the last bullet

> - Before a tool that makes them wait, a few words so the silence is not mysterious ("let me look
>   that up"). Never before show_passage, which is instant — just point and talk.

became

> - Before a tool that makes them wait, a few words so the silence is not mysterious ("let me look
>   that up").
> - show_passage is instant and needs no announcement. Start your answer first, then call
>   show_passage while or after you speak — never make the reader wait in silence for the pointer.

And in NEVER SAY A BLOCK ID OUT LOUD, which put the call before the words,

> When you want the reader to look at a passage, CALL show_passage WITH THE IDS and say in words
> where to look

became

> When you want the reader to look at a passage, say in words where to look and CALL show_passage
> WITH THE IDS as you speak

**Method.** The short article, scenarios 1 (follow-up), 2 (article question) and 4 (three
questions), three repetitions, B and B′ interleaved in the same run so both met the same network
and the same end-of-turn detector. Plus B′ once on the long article, scenarios 2 and 4. Command:
`npx tsx evals/live/gpt-live-spike.mts --configs=B,Bp --reps=3 --articles=short --scenarios=1,2,4`.
Tables: `node evals/live/results/261002r-gpt-live-spike/analyse-bprime.mjs`; the model-time split
is `vad-split.mjs` with `Bp` added to its filter.

**Result: no effect.**

| | B | B′ |
| --- | --- | --- |
| Turns where `show_passage` came before the first word | 12/15 | **13/15** |
| Model time, end of turn → first audio, median (worst) | 1.59 s (2.37 s) | 1.80 s (2.25 s) |
| First audio after the question, article questions, median / worst (n=12) | 4.26 s / 6.83 s | 5.95 s / 6.82 s |
| First audio, follow-up, median / worst (n=3) | 6.49 s / 6.61 s | 6.58 s / 6.66 s |
| `show_passage` called, article questions | 12/12 | 12/12 |
| …pointing at the right passage | 12/12 | 12/12 |
| `show_passage` on the follow-up | 3/3 | 3/3 |
| Answer length, article questions, median words | 57 | 47 |
| Turns with a separate spoken preamble ("Let's look at what he recommends…") | 3/12 | 2/12 |

B′ on the long article: 4/4 pointed, 4/4 right, first audio 3.2 s median, model time 2.2 s.

The difference in the "first audio" row is noise from the end-of-turn detector, not the prompt. In
this run it waited about 4.5 s after the first question of **both** arms (median 4,451 ms for B′,
4,455 ms for B), where the main run had waited 0.9 s on the same audio. The detector varies by
that much between runs, so the model-time row is the one to read, and it did not move.

**Answers did not get worse.** Read side by side, B′'s answers are as accurate and as well pointed
as B's, and slightly shorter. Both arms still often run past the prompt's "one or two sentences"
(medians of 47–57 words), and both still sometimes open with an announcement before the answer
("Let me pull together his main fixes…"), which the new no-niceties lines forbid. That is worth
its own look, but it is not what B′ changes.

Spend: $2.09 ($0.80 B, $1.29 B′), excluding text-to-speech. The spike's total is now **$11.52**.

## Files

- Script: [`evals/live/gpt-live-spike.mts`](../../evals/live/gpt-live-spike.mts)
  (`--probe` checks the instruction cap).
- Results: [`evals/live/results/261002r-gpt-live-spike/`](../../evals/live/results/261002r-gpt-live-spike/).
  That holds `main-sessions.jsonl` (A, B, and the superseded first C run),
  `c-rerun-sessions.jsonl` (C and Cin, the measure used here), the run metadata, samples of the raw
  event logs, `analyse.mjs` (the tables) and `vad-split.mjs` (the Realtime end-of-turn split; it
  needs the full event logs, which are gitignored and live on the box in the primary checkout's
  `logs/f4sp-spike/`, with the OpenAI guides read for this in `logs/f4eq-openai-docs/`). The B′ follow-up is
  `bprime-short-sessions.jsonl`, `bprime-long-sessions.jsonl` and `analyse-bprime.mjs`.
