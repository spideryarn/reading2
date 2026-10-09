You are reviewing a PLAN (read-only) in the Spideryarn repo, before any code is written.

Plan: docs/plans/261009e-high-powered-chat-cut-off-at-its-ceiling.md — read it first, then check its claims against the code:
- src/converse.ts (search `max_tokens: kind === "candidates"`, `truncated`, CHAT_TIMEOUT_MS)
- src/store/pg-chat.ts (`toMessage`, `messageRow`, `finish`), src/db/schema.ts (chatMessages), src/types.ts (`ChatMessage.truncated`)
- src/routes.ts (~3870-3890, the chat `finished` patch), src/web/ChatPanel.tsx (~2459), src/web/guide-acts.ts:100
- src/explain.ts (~495-525), src/dig-deeper.ts (DIG_ANSWER_TOKENS), src/ai-call.ts (CHAT_REASONING, wireEffort), src/high-power-model.ts
- the eval evidence: evals/results/digest-2026-10-09/*/chat-q*/A-opus.json
- tests/chat-truncated-stored.test.ts (already written, currently red as intended)

Answer, concisely, with file:line evidence:
1. Is the diagnosis right? In particular: is `truncated` really lost between the route and the store, and are there other paths (retry, reconnect/recover endpoint, export, sweep, guide) that build or read a chat message and would also need to carry it?
2. Is keying the ceiling on the model (isHighPowerModel) right versus keying on `power`? Can a high-powered turn ever run on a non-high-power model or vice versa (explicit model override, Explore/Recall kinds, candidates)?
3. Is 9,000 for high-power chat sensible against the 120s turn deadline and the stall clock? Is 4,000 for explain on Opus safe against EXPLAIN_TIMEOUT_MS and COMMENT_ANSWER_LEASE_MS? Anything that sizes something from these ceilings (cache keys, cost estimates, tests pinning 4000/1500)?
4. Is the round-trip class guard (Required<ChatMessage> through messageRow→toMessage) sound, and does it miss `finish`'s patch enumeration? Suggest the cheapest way to also guard `finish`.
5. Anything in the sibling table wrong or missing?
6. Anything simpler that would do as well.

Number your findings F1, F2… with severity (blocker / should / nit). End with a one-line verdict: APPROVE, APPROVE WITH CHANGES, or REJECT.
