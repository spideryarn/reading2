1. **P3 — fixed: probe observation was stated as a protocol guarantee.** Metadata arrived on the usage chunk in both streamed probes, but that does not guarantee ordering. I clarified [the plan](/home/greg/code/spideryarn2/.claude/worktrees/exa-upstream-label/docs/plans/261001g-exa-upstream-label.md:54) and comments, and added tests proving that earlier metadata survives later provider frames and that the last metadata block wins. The implementation was already correct.

2. **P3 — fixed: `ai-gateway.md` overclaimed failure-path recording.** Non-2xx bodies are discarded before `sawRoute`, so failed calls retain `upstream = null` even if metadata is present. [The documentation now limits the claim to successful responses](/home/greg/code/spideryarn2/.claude/worktrees/exa-upstream-label/docs/project/ai-gateway.md:470). I did not change the established failure-body path.

Audit conclusions:

- No production chat caller bypasses `prepare`/`send`. Direct chat-completion calls elsewhere are probes/spikes or test controls. Messages remains a separate wire.
- The header reaches every chat route, including non-Exa/OpenAI-model jobs that were not individually probed. This is supported by OpenRouter’s endpoint contract, which describes it as a response-metadata opt-in and demonstrates it with an OpenAI model. [OpenRouter chat API](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request)
- The raw probe is not a controlled header/no-header cache test: it has no identical control or warm repeat. It does show unchanged pins, endpoint pricing and cache writes. OpenRouter documents cache routing around model, account, conversation and provider order, not this metadata header. [OpenRouter prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)
- One meter represents one HTTP request. Application retries/tool rounds construct new meters; within one response, metadata ordering is now explicitly tested.
- The SQL predicate is correct. `upstream = 'OpenAI' AND requested_model LIKE 'anthropic/%'` describes an impossible real route, so adding job or wire filters would only make it less complete. The affected-caller list is exhaustive.
- The wider limitation remains explicit: default-engine/legacy-plugin Exa calls rely on metadata, and Messages would require its own probe if it gains an Exa caller.

Checks:

- Targeted tests plus doc links: **71 passed**; `tests/ai-call.test.ts` alone: **57 passed**.
- Typecheck: all **2,523** source files passed via `node --import tsx scripts/typecheck.ts`.
- The exact `npm run typecheck` wrapper could not open its sandbox-blocked `tsx` IPC socket.
- Full `npm test` could not start its database lane because local socket access is blocked.
- Lint found only the existing cognitive-complexity advisory in `sseChunks`.

**Verdict: APPROVE.** No P0–P2 findings and no unresolved correctness finding. The review fixes remain uncommitted because the sandbox makes the linked worktree’s Git metadata read-only; the unrelated untracked review-prompt file was untouched.