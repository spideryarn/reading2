Read-only consult; do not edit files. I want a design recommendation, with reasoning.

Historical snapshot: this prompt describes the temporarily built guide-search version. It was
backed out after this consult; the final implementation and reason are in the plan's
"The guide, tried and backed out" section.

Context: plan docs/plans/261011t-web-search-in-every-chat-kind-and-reading-a-given-address.md
(and your review of it, ...-plan-review-sol.md). Stage 1 is built in this worktree (uncommitted):
`webSearchTool` in src/converse.ts now returns OpenRouter's server web search for the guide too;
GUIDE_SYSTEM got a YOUR TOOLS paragraph saying when to search, plus CLAIM_ORIGINS and WEB_LINKS;
`roundTools` keeps the guide's last round as `{ tools: toolsFor("guide"), tool_choice: "none" }`.

The problem, measured against the real model (anthropic/claude-sonnet-5.5 via OpenRouter, reasoning
on), question "What has happened with this idea since this was written?" on a guide turn:

  round 1: content 0 chars, server_tool_use.web_search_requests=1, then a call to offer_next_steps
  round 2: content 0 chars, a call to offer_to_save (refused: already saved)
  round 3: content 0 chars, web_search_requests=1, offer_next_steps again
  round 4 (tool_choice none, no search declared): 700 chars beginning "I haven't looked this up, so
  I can't tell you reliably what has happened since…" / "I have no web search in this chat"

Reproduced in most of ~12 tries; the eval (evals/chat-web-reach.ts --kind guide, results in
evals/results/chat-web-reach-guide-after-*.json) also had one turn fail with ai-tool-loop (4 rounds,
one call each, no prose — before I restored the guide's tool_choice:none last round). A sentence
added to GUIDE_SYSTEM ("What a search finds is yours only in the answer where you ran it: write
your reply from it in that same answer, and only then call offer_next_steps. Search first, then
write, then offer the steps, never the steps first.") did not help (3 of 6 still ended "I haven't
searched").

Mechanism as I understand it: the provider search runs inside one response; its results are not
returned to us as messages (default engine: no url_citation annotations unless the model attributes
in prose — see the comment above `webSearchTool`). When that response ends in a tool call with no
prose, `converse` builds the next round's history from the assistant tool_calls message (content "")
and our tool results, so the search results are gone. Chat avoids this in practice because it writes
prose in the same round it searches; the guide is told to end every answer with a call to
offer_next_steps (`ENDS_THE_TURN`, `settles`, src/converse.ts ~3590) and, when it searches, it calls
that tool first and writes nothing.

Options I see — critique these and add any better one:
 A. Ship without guide search (Recall/Tutorial prompt change only), queue guide search with this
    finding. Greg asked for "all of the chat modes".
 B. Guide gets Exa engine (annotations arrive at search time with url/title/extract), and `converse`
    carries a round's annotations forward into the next round's history (e.g. as text appended to
    the assistant tool_calls message, fenced as untrusted) so a later round sees what was found.
    Would also help Chat. Cost/complexity? Security (fence)? Cache?
 C. Withhold the guide's offer tools (offer_to_save, offer_next_steps) on round 1 when... (we cannot
    know beforehand whether it will search) — or always offer them only from round 2, costing a
    round per turn.
 D. Detect "round searched (usage) + no prose + only offer calls" and re-prompt with a nudge — still
    loses results and repeats searches.
 E. Something about tool_choice / parallel tool calls / the order the provider applies.

Look at src/converse.ts (`converse` loop, `roundTools`, `ENDS_THE_TURN`, how the assistant message
for a tool round is built, collectCitations), src/chat-tools.ts (OFFER_NEXT_STEPS_TOOL,
OFFER_TO_SAVE_TOOL), src/openrouter-stream.ts. Recommend one, say what it costs, and whether it is an
afternoon or a week. If it is a week, say so plainly: the brief's rule is "simplest version first".
End with a one-line recommendation.
