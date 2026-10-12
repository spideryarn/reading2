You are reviewing a plan before it is built, in the Spideryarn repo (this worktree). Read-only: do not edit files.

Read:
- docs/plans/261012g-web-search-through-a-subagent-for-chat-and-the-guide.md (the plan)
- docs/investigations/261012b-web-search-subagent-spikes.md and evals/web-search-subagent-spike.ts and evals/results/web-search-subagent-spike-2026-10-12T15-24-46.json (the spike evidence)
- docs/plans/261011t-web-search-in-every-chat-kind-and-reading-a-given-address.md and its -guide-consult-sol.md (your earlier design and why guide search was backed out)
- src/converse.ts (webSearchTool, roundTools, ENDS_THE_TURN, the round loop), src/chat-tools.ts (toolsFor, GUIDE_TOOLS, GUIDE_TYPED_TOOLS, runTool, readWebPage, untrusted), src/dig-deeper.ts (digSearchRequest, searchFirst), src/openrouter-stream.ts (collectSearchEvidence), src/ai-call.ts / src/models.ts (job registration)
- docs/project/security-map.md and docs/project/chat-tools.md (the defences; each conversation kind's tool list is one)

Questions, answer each:
1. Is the subagent tool (search_web, a quick-tier forced Exa search returning validated link+sentence lines as a tool message) the right design over your in-loop recovery round, given the spike? Anything in the converse loop that would still lose or mishandle a local tool's result when the guide calls search_web and offer_next_steps in the same round with no prose?
2. Page-reading for the guide. Greg's words: "Perhaps the web search tool that we create has an option for web search to run in a subagent (which hands back links/summary) for the caller-agent to retrieve if it chooses to?" Is giving the typed guide read_web_page PLAINLY within those words, or is it a defence edit he has not plainly authorised? Give a yes/no and the reason. (An unattended run does not edit a defence beyond what Greg plainly said.)
3. Security of the result: the summary is a cheap model's paraphrase of stranger pages, fenced untrusted. Query exfiltration (the guide's context holds the article and the reader's profile; an injected article could steer a query to Exa). Is the plan's treatment enough, and is there anything specific to adding search to the guide that Chat's existing exposure does not already cover?
4. Stage 2's criterion for switching Chat, and stage 3 being a question to Greg rather than a build: agree or not?
5. Anything wrong, missing or over-built. Concrete file/line references.

Write findings numbered, each with severity (blocker / should-fix / nit), and finish with a one-line verdict: SOUND / SOUND WITH FIXES / RETHINK.
