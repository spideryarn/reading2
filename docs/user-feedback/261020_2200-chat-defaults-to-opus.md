---
reports: spya-ht4hf4
ending: shipped
comment: On dev. Every chat on an article now answers on Claude Opus 5.5, whatever the article's High-powered AI switch says. Candidates and the tools a chat calls still follow the switch.
---
# Chat defaults to Opus 5.5

Report `spya-ht4hf4` (#652, SPIDERYARN-READING2-MH), a suggestion from Greg
(`feedback-reporter.ts` exit 0, no addenda when re-read before this note). Overseer queue item
`qi-x37a5hn5`, session `fbht4hf4-chat-defaults-to-opus`.

> Default to Opus 5.5 for Chats

**Shipped.** `chat` joins `simple` and `referee-hidden-check` in `ALWAYS_HIGH_POWER`
(`src/models.ts`), and `defaultModel` in `src/converse.ts` now resolves through `powerFor`. Every
thread kind that bills as `chat` answers on Opus 5.5 on every article: chat, Learn, the tutorial,
Explore and the guide. The 6,000-token ceiling, `effort: "high"`, the model shown in a message's
*i*, the cost row and `/profile`'s model list all follow the model actually sent, so they moved with
it. `SPIDERYARN_CHAT_MODEL` still overrides it.

These do not move: Candidates, the editor's referee conversation, which is its own job; the tools a
chat calls that call a model themselves (still the article's setting); the gist after each answer
(DeepSeek); live conversation (OpenAI); and the Help page's chatbot (Luna).

**What it does to per-chat cost.** Opus 5.5 costs twice Sonnet 5.5 per token, and on Opus a chat
also thinks at `high` with up to 6,000 output tokens rather than 4,000. So the answer call in a
chat turn costs roughly **twice as much**, a little more when the bigger ceiling is used. The tool
calls inside a turn don't change. Readers pay nothing extra: chat is not charged against their
allowance, so this is our cost. In production from 2026-10-09 to 2026-10-20, chat was $10.32 of
$57.19 (18%), over 114 calls: a median of 4¢ a call, p95 30¢. $7.28 of it was on Sonnet. At Opus
prices that would have been about $14.6, so chat comes to about $17.6 for those eleven days and
total spend goes up about 13%.

Copy updated on `/features` and in Help (*Waiting and cost*), which had implied the switch moved
chat. Plan, cost working and both GPT Sol reviews:
[261020q](../plans/261020q-chat-defaults-to-opus.md).
