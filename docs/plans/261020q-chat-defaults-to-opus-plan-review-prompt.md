Review the plan docs/plans/261020q-chat-defaults-to-opus.md in this repo (read-only). Greg asked: "Default to Opus 5.5 for Chats".

Check it against the code: src/models.ts (ALWAYS_HIGH_POWER, powerFor, resolveModel, modelFor), src/converse.ts (jobFor, defaultModel, chatCeiling, every place the chat model or power is resolved, including any tool calls a chat turn makes — src/chat-tools.ts reads the article's power for tools that call a model), src/routes.ts (the chat route that calls converse, and modelsInUse for /api/models), src/ai-call.ts (wireEffort), and cost tracking (docs/project/cost-tracking.md).

Questions: Is adding "chat" to ALWAYS_HIGH_POWER plus powerFor in converse.defaultModel the right and complete change? Is there any other path where a chat turn's model is chosen without defaultModel (e.g. a caller passing `model` explicitly, live conversation, the guide's greeting, gist, digests, chat tools)? Should chat tools that call a model follow? Does anything compare model with the article power and now disagree (freshness, stamps, ChatThreadAbout, cost rows)? Is the cost section honest? Is excluding Candidates right?

Write numbered findings with severity and file:line evidence, then a one-line verdict: APPROVE, APPROVE WITH CHANGES, or REJECT.
