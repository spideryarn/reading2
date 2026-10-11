You are reviewing a plan before it is built. Read-only: do not edit any file.

The plan: docs/plans/261011t-web-search-in-every-chat-kind-and-reading-a-given-address.md

Read it, then check it against the code it names:
- src/converse.ts — `webSearchTool`, `roundTools`, `SYSTEM` (Chat), `LEARN_SYSTEM` (Recall),
  `TUTORIAL_SYSTEM`, `EXPLORE_SYSTEM`, `GUIDE_SYSTEM`, `WEB_LINKS`, `CLAIM_ORIGINS`, `UNTRUSTED_RESULTS`.
- src/chat-tools.ts — `toolsFor`, `GUIDE_TOOLS`, `read_web_page`'s definition, `runTool`.
- src/live.ts — what Live takes from these.
- docs/project/chat-tools.md, docs/project/security-map.md § Where the defences physically live,
  docs/plans/261007j-the-guide-a-conversation-about-how-to-read-this.md (the F1 this reverses),
  docs/project/cost-tracking.md, evals/chat-web-reach.ts.
- tests/guide-kind.test.ts, tests/guide-route.test.ts.

Questions I most want answered:
1. Is the reading of "what is there today" right? In particular: does every Learn kind really reach
   `converse` with web search and `read_web_page` offered, or is there a path (route, client flag,
   `useTools`, Live) that withholds them which I missed? If one exists, the plan's diagnosis is wrong.
2. Giving the guide web search: what breaks? Prompt-cache prefix, the guide's `offer_next_steps`
   turn-ending logic (`ENDS_THE_TURN`, `settles`), Live's use of the guide kind, `roundTools`'
   removed branch, anything that assumes guide rounds have no server tool.
3. Security: does the guide having web search (with `offer_to_save` and `offer_next_steps` on the
   same turn) open anything the existing posture does not already accept for Chat? Is editing
   `read_web_page`'s description string fairly described as not editing a listed defence?
4. Recall/Tutorial prompt change: is keeping "Do NOT search to check the article against the world
   unless asked" alongside the new reason coherent, or will the model read them as contradictory?
5. The eval design in stage 2: will it actually measure the change? Anything about running
   `converse` with kind learn/tutorial/guide outside a route that would make the numbers lie
   (e.g. a kind-specific input the route supplies and the eval would not)?
6. Anything simpler that gets the same result.

Write your findings as a numbered list, each with severity (high/medium/low), the file and line you
checked, and what you would change. End with a one-line verdict: BUILD AS IS, BUILD WITH CHANGES,
or RETHINK.
