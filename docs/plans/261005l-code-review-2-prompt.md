# Code review, round 2 (narrow): the prompt rule added after your round-1 fixes

Read-only. Change no file.

In round 1 (`docs/plans/261005l-code-review-sol.md`) you fixed CR-1 to CR-5. Commit `2fcbaf873`
holds your fixes **and three sentences of mine that you have not seen**, all inside
`EXPLORE_SYSTEM` § TESTING THE PIECE in `src/converse.ts`:

1. In ABSENCE IS A NARROW CLAIM: "…or that the author never answers it".
2. A new bullet, A MISSING SOURCE IS CHECKED BEFORE IT IS CLAIMED: the text the model is given does
   not show the article's links, so before saying the piece gives no source, link or citation it
   calls `article_citations`; if it still cannot tell, it says it could not see a source, never
   that there is none.
3. At the end of WHEN THEY ASK, ANSWER: "A problem you gave way on is not brought back later as if
   it still stood."

Why: in the eval's after arm (`evals/results/remember-explore.261005l-after-agents-1.md` and
`-after-agents-2.md`, reader `critic`, turns 1 and 4) two replies said the piece "never names that
source or links it" about a figure whose word "estimate" is a link in the article
(`tests/fixtures/data-root/data/openai-huggingface/blocks.json`, block `spya-ms8rup`); and a blind
read found replies conceding an objection in turn 2 and listing it again in turn 4.

Check only this:

- Is rule 2 true of the system? Does the article text `buildConverseMessages` sends for kind
  `explore` really omit links, and is `article_citations` offered to `explore`
  (`toolsFor` in `src/chat-tools.ts`) and able to answer "is there a link for this claim in this
  block"? If the tool only lists works from a citations artefact that may not exist for an
  article, what should the rule say instead?
- Does any of the three contradict another section of the prompt (the tool's own description says
  "Do NOT use it for a question the article itself answers"; `NO_UNRUN_TOOL_CLAIMS`; the length
  rule)?
- Is your own CR-1/CR-2 wording intact around them?

Severity scale as in round 1 (P0–P3, by consequence), IDs continuing from `CR-6`, each
**established** or **reasoned**, with what you would write instead. End with
`VERDICT: ship` / `VERDICT: ship with changes` / `VERDICT: do not ship`.
