# 261020q — Chat defaults to Opus 5.5

Status: built. Report: spya-ht4hf4 (#652, SPIDERYARN-READING2-MH), an admin suggestion.

> Default to Opus 5.5 for Chats
>
> — Greg, 2026-10-19

## What this is

Every chat on an article runs on Claude Opus 5.5, whatever the article's High-powered AI switch
says. Until now a chat used Sonnet 5.5 unless the article's owner had switched High-powered AI on.

"Chat" here is the `chat` job in [`src/models.ts`](../../src/models.ts): every thread kind that
bills as `chat` — the ordinary chat, Learn, the tutorial, Explore and the guide (`jobFor` in
[`src/converse.ts`](../../src/converse.ts)). **Not** Candidates, the editor's referee conversation:
it has its own job (`referee-candidates`), a 12,000-token ceiling and a separate cost line, and
it stays on the article's setting. Not the Help page's *Ask about Spideryarn* either, which is
`help-chat` on the quick tier and never sees an article.

**Only the answer call moves.** The calls a chat turn makes beside it keep their own jobs, models
and cost rows (GPT Sol, plan review F2): the chat tools that call a model run at the article's power
(`ToolContext.power`, [`src/chat-tools.ts`](../../src/chat-tools.ts)); the gist written after each
answer is `chat-gist` on DeepSeek; live conversation is on fixed OpenAI models; the guide's greeting
is not a model call.

## The change

1. Add `"chat"` to `ALWAYS_HIGH_POWER` in `src/models.ts`, beside `simple` and
   `referee-hidden-check`, with Greg's words as the reason.
2. `defaultModel` in `src/converse.ts` resolves through `powerFor(job, power)`, because membership
   alone does nothing at a call site (the comment on `ALWAYS_HIGH_POWER` says so, and
   `tests/referee-hidden-check.test.ts` pins it).
3. Everything else follows from the model actually sent, which is already how it was built for
   the switch: the 6,000-token ceiling (`chatCeiling`), `effort: "high"` (`wireEffort`), the message
   stamp the thread's *i* shows, the cost row, and `/api/models` on `/profile` (which reads
   `powerFor` already).
4. A test that a chat turn on a **standard-power** article sends Opus, and that Candidates on the
   same article still sends Sonnet — written first, seen red (`tests/converse-ceiling.test.ts`).
   `tests/chat-effort.test.ts` reached the standard model's `default` effort through a
   standard-power chat; it now names the standard model to get there (Sol F1).
5. Copy: `/features` says plain-words summaries and chat are on Opus already; the High-powered AI
   doc says chat is now outside the switch.

`SPIDERYARN_CHAT_MODEL` still wins, as every per-task override does (`resolveModel`).

## Simpler option passed over

Changing the capable tier to Opus, or `TASK_TIER.chat` to a new tier. The first moves every
pipeline stage (twice the price of every import); the second invents a tier for one job when the
"Opus for every article" mechanism already exists and already feeds `/api/models`.

## Cost

Opus 5.5's token prices are twice Sonnet 5.5's, and on Opus chat also sends `effort: "high"` and
may use up to 6,000 output tokens rather than 4,000. So the chat-job portion of a turn costs roughly
twice as much, a little more where the higher ceiling is used; a turn that also calls a tool does
not double in total.

From production since the model sweep (2026-10-09 to 2026-10-20, `npm run cost:analyse -- --prod
--since 2026-10-09`): chat was 114 calls, $10.32 of $57.19 product spend (18%). Sonnet 81 calls,
$7.28, mean 9.0¢ a call; Opus 33 calls, $3.04, mean 9.2¢ a call; median across both 4.0¢, p95 30¢.
The two means are near-equal only because they are different conversations on different articles,
not because Opus is as cheap; the list price is what predicts a like-for-like turn. Moving the
Sonnet share to Opus at twice the price would have added about $7.3 over those eleven days —
chat ≈ $17.6 instead of $10.3, total spend up ≈ 13%.

Readers are not charged for chat (billing counts articles added), so this is our cost, not theirs.
The switch's price is unchanged; it now moves one fewer thing.

## Risks

- **Latency.** Opus is slower to first token than Sonnet; the turn deadline already allows for the
  6,000 ceiling (`deadlineFor(6_000)` is 79 s of 120 s — plan 261009h).
- **Existing threads** switch model mid-conversation on their next turn; that already happens when
  an owner flips the switch, and only the prompt cache's first hit is lost.

## Reviews

- Plan: GPT Sol, APPROVE WITH CHANGES — [prompt](261020q-chat-defaults-to-opus-plan-review-prompt.md),
  [answer](261020q-chat-defaults-to-opus-plan-review-sol.md). F1 (`chat-effort` test), F2 (say only
  the answer call moves) and F3 (`ConverseRequest.power`'s comment) applied.
- Code: GPT Sol, SHIP WITH FIXES APPLIED — [prompt](261020q-chat-defaults-to-opus-code-review-prompt.md),
  [answer](261020q-chat-defaults-to-opus-code-review-sol.md). It fixed `converse-stop`'s effort
  expectation and the Help page *Waiting and cost* (and its corpus), and added an `/api/models`
  contract test and an `ALWAYS_HIGH_POWER` sweep in `high-power-models`.
