You are reviewing a plan before it is built, in the Spideryarn repo (this working tree). Read-only.

Plan: docs/plans/261011w-does-the-cited-work-say-that-at-the-citing-sentence.md

Read the plan, then the code it relies on, and check its claims against the code:
- src/paper-evidence.ts (readPaperEvidence, paperAddress, selectChunks, confirmIdentity)
- src/citation-investigate.ts (readCitedPaper and how the investigate press built PaperEvidenceInput: which url, which matchedPageUrl, which why/passages)
- src/chat-tools.ts (CHAT_TOOLS, toolsFor, runTool, readWebPage, readCitations, untrusted, ToolContext, describeCall), and whoever builds ToolContext (grep for runTool callers)
- src/bibliography.ts / loadBibliography and the CitedWork type in src/types.ts (url, linkFrom, lookup, why, citedAt, mentions)
- src/web/ProseHoverCard.tsx (CiteCard, `here`), src/web/reader/Reader.tsx (askPassageInChat, askCitedWorkInChat, handToChat), src/web/chat-handoff.ts (askAboutBlock, fencedQuote)
- docs/project/security-map.md and docs/project/security.md § Chat tools, docs/project/chat-tools.md, docs/project/chat-from-a-mode.md, docs/project/bibliography.md

Tell me:
1. Is anything in the plan wrong about the code? (e.g. can an anchor carry a quote that is the mark's words; does converse render the anchor; does the card know the citing block; which PaperEvidenceInput fields to fill from a CitedWork, and what to pass as matchedPageUrl — is passing a linkFrom "article" or "web" row url as matchedPageUrl safe given confirmIdentity?)
2. Security: the cited PDF is a stranger's text going into the chat model, and the model chooses the `work` and `claim` arguments. Any SSRF, exfiltration (claim text steering a fetch?), or prompt-injection shape the plan misses? Is the fence enough, compared with read_web_page?
3. Is there a simpler design that delivers the same value? Or a missing piece without which this is a silent no-op (e.g. chat never calls the tool; the stored list absent for most articles)?
4. Cost/latency/caps: is 2,000 words right; Live/guide exclusion right; registry lookup rate.
5. Anything in the UI half that conflicts with "one chat per item", the card's existing buttons, touch, or the anchored-chat path.

Give numbered findings, each with severity (high/medium/low), the evidence (file:line), and the fix. End with a one-line verdict: BUILD AS IS / BUILD WITH CHANGES / RETHINK.
