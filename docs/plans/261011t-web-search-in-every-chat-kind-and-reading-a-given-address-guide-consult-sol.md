B is the right direction, but it needs one extra constraint: after recovering the search evidence, force an immediate prose-only round. This is an afternoon-sized fix, not a week.

## Why it fails

This is a protocol-boundary bug, not mainly a prompting bug:

- OpenRouter’s search runs entirely inside one provider response ([official documentation](https://openrouter.ai/docs/guides/features/server-tools/web-search)).
- The default engine exposes annotations only when the model attributes sources in prose; the repo has already measured that Exa emits URL, title, and excerpt annotations at search time ([converse.ts](/var/tmp/spideryarn-worktrees/fbdrbkvc-web-search-all-chats/src/converse.ts:278)).
- When the guide emits only offer calls, `converse` replays empty assistant content plus those local calls and results, losing the provider’s private search context ([converse.ts](/var/tmp/spideryarn-worktrees/fbdrbkvc-web-search-all-chats/src/converse.ts:3506)).
- `ENDS_THE_TURN` is behaving correctly: it refuses to treat next steps as terminal unless that round also wrote prose ([converse.ts](/var/tmp/spideryarn-worktrees/fbdrbkvc-web-search-all-chats/src/converse.ts:3645)).

The failed prompt experiment is enough evidence that Sonnet’s ordering cannot be made an invariant through wording.

## Recommended design: targeted B+

For Guide only:

1. Use `engine: "exa"` with a small `max_total_results`, probably five.
2. Collect each round’s excerpts with the existing `collectSearchEvidence`; it already validates URLs, cleans titles, deduplicates, and caps excerpts ([openrouter-stream.ts](/var/tmp/spideryarn-worktrees/fbdrbkvc-web-search-all-chats/src/openrouter-stream.ts:508)).
3. Detect the exact near-success shape:

   - Guide
   - search count greater than zero
   - nonempty Exa evidence
   - no prose
   - normal `wants-tools` finish
   - last call is accepted `offer_next_steps`
   - every local call settled

   This is effectively the existing successful termination predicate, minus prose, plus proof that useful search evidence exists.

4. Let the offer calls finish—the buttons/cards are now already prepared.
5. Append a bounded, app-authored message containing the evidence under `untrusted("web search results", …)`, followed by: the offers are handled; write the answer now from this evidence.
6. Run the next round using the Guide’s existing terminal configuration: its tools declared, `tool_choice: "none"`, and no web search. OpenRouter documents `"none"` as disabling tool calls ([tool-calling documentation](https://openrouter.ai/docs/guides/features/tool-calling)).

Do not append the evidence to the assistant’s tool-call message. That would falsely represent third-party extracts as words the assistant previously wrote. Put it after all tool results as an app-authored/user message, matching the final-round nudge pattern already used in `converse`.

Before implementation, run one exact wire probe: Exa search followed by a local offer call and zero prose. B depends on annotations still arriving in that combined case. If they do not, stop; do not build a larger mechanism on the earlier, slightly different Exa probe.

## Options

- **A — prompts only, defer Guide:** Safe fallback, and preferable to shipping the current misleading behaviour. But it does not satisfy “all typed chat modes.” Use it only if the Exa wire probe fails.
- **B as originally stated:** Necessary but incomplete. Preserving evidence alone still permits another offer-first round. Add the forced prose-only recovery round.
- **C — delay offer tools on every Guide turn:** Architecturally clean separation, but every Guide answer would require another full request, including turns that never search. It also needs new orchestration to continue after a first-round prose answer. That begins to look week-sized.
- **D — detect and nudge:** Cannot recover evidence already discarded. Repeating the search spends more and remains probabilistic.
- **E — tool ordering:** `parallel_tool_calls: false` limits concurrent function calls; it does not impose “server search, then prose, then local function.” `tool_choice: "none"` blocks search too, while forcing search requires knowing beforehand that search is needed. There is no useful ordering setting here.
- **A local search tool:** Conceptually clean—the result would naturally survive as a tool message—but it duplicates provider/search integration and cost accounting. That is the week-sized version; Exa annotations make it unnecessary for now.

## Cost and risks

Engineering: roughly half a day for the probe, implementation, fixture test, and six-to-twelve live repetitions.

Runtime:

- Explicit Exa adds separately metered search cost plus the tokens needed to replay its excerpts; OpenRouter’s docs describe those as additional to model tokens.
- The recovery path uses a second model request, but the current failure already spends three or four rounds and sometimes repeats searches. It should usually reduce total spend and latency.
- Add a total evidence cap—around 12–16k characters—not merely the existing 8k-per-page cap.

Security:

- Fence URL, title, and excerpt together with the existing untrusted-content mechanism ([untrusted-fence.ts](/var/tmp/spideryarn-worktrees/fbdrbkvc-web-search-all-chats/src/untrusted-fence.ts:22)).
- Keep excerpts ephemeral; do not add them to stored citations or chat history.
- The synthesis round has tool use disabled, so an injected result cannot initiate an app action.

Caching:

- Changing Guide’s stable search definition to Exa invalidates that Guide cache prefix once.
- Evidence is added after the article breakpoint, so it does not itself invalidate the reusable prefix.
- The prose-only round may miss the message cache because of `tool_choice`; measure it, but accepting one miss on this recovery path is better than returning a false refusal.

One unrelated worktree note: the source has restored the Guide’s final `tool_choice: "none"` shape, but the uncommitted test still expects web search on that round ([guide-next-steps-tool.test.ts](/var/tmp/spideryarn-worktrees/fbdrbkvc-web-search-all-chats/tests/guide-next-steps-tool.test.ts:377)).

**Recommendation: implement Guide-only Exa evidence handoff plus an immediate `tool_choice: "none"` answer round for the exact searched-with-no-prose/settled-offers case; do not ship Guide search in its current form.**