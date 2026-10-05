One finding.

- **CR-6 — P1, established.** The new missing-source rule names the wrong tool. `buildConverseMessages` does omit markup: `articleWithIds` renders only each block’s `id` and `text`, so Explore sees “estimate” but neither its `href` nor destination ([converse.ts](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/src/converse.ts:1981), [article-prompt.ts](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/src/article-prompt.ts:142)). Explore is offered both tools through `CHAT_TOOLS_WITH_NOTES` ([chat-tools.ts](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/src/chat-tools.ts:516)).

  But `article_citations` reads an optional, previously generated citations artefact. Its absence is ordinary and explicitly cannot establish that the article has no citation ([chat-tools.ts](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/src/chat-tools.ts:1868)). This fixture has no citations artefact.

  `article_links` is the tool that parses the current blocks’ HTML and can filter by block ID ([chat-tools.ts](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/src/chat-tools.ts:1391)). A direct check for `spya-ms8rup` returned:

  > `[spya-ms8rup] “estimate” → https://abstatisticalconsulting.substack.com/p/brief-notes-on-the-openaihugging`

  Consequently, the rule as written does not prevent the exact false criticism that motivated it. It also conflicts in scope with `article_citations`’ description, which reserves that tool for questions about cited works and says not to use it for questions the article answers ([chat-tools.ts](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/src/chat-tools.ts:434)).

  I would replace it with:

  > **A MISSING SOURCE IS CHECKED BEFORE IT IS CLAIMED.** The article text you were given does not show its links. Before saying that a figure or claim has no linked source, call `article_links` with the claim’s block id. If it shows no link, keep the conclusion narrow: say that you could not see a source for that claim, never that the article has none. Use `article_citations` only when you need details of a cited work; a missing or unreadable citations list is not evidence that the article gives no source.

  `article_links`’ description should also name this verification case, because its present “only when the reader refers to a link” wording is narrower than the proposed rule.

The other two additions are sound. “The author never answers it” correctly narrows absence claims, and the concession rule is compatible with following the reader’s latest message. Neither conflicts with `NO_UNRUN_TOOL_CLAIMS` or the length rule.

CR-1 and CR-2 remain intact: strongest-answer-first, separate cited article claim from uncited model reasoning, follow the latest message, and requested comparisons remain prose ([converse.ts](/var/tmp/spideryarn-worktrees/fbmvmpks-remember-becomes-learn/src/converse.ts:1397)).

No files changed.

VERDICT: do not ship