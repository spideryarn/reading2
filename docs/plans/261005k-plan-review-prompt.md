Review this plan before it is built. Read-only: do not edit files.

Candidate: a live pre-commit plan on base f2c539eee. Untracked files:
docs/plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md
docs/plans/261005k-plan-review-prompt.md

The code it would change or build on (start here; this does not limit scope):
- The bar and its model: src/command-pick.ts, src/command-pick-call.ts, src/web/CommandBar.tsx
  (`suggestedRows`, `quickSearchRow`, `ask`, `activate`), src/web/command-proposal.ts
  (`CommandExecutor`), src/web/command-runners.ts, src/web/command-match.ts (`pickKey`),
  src/command-pick-catalogue.generated.json, src/routes.ts (`pickCommandForSentence`,
  `resolveProfileParts`), src/ai-call.ts, src/cost-categories.ts, src/spend-declarations.ts.
- The profile: src/profile.ts (`renderProfile`, `PROFILE_RULES`), docs/project/reader-profile.md
  (§ "Where it goes in the prompt", "Not tool arguments").
- Chat origins: src/types.ts (`ThreadOrigin`, `sameOrigin`), src/thread-origin.ts, src/db/schema.ts
  (`chat_threads`, the origin CHECKs), src/routes.ts (`parseOrigin`, `streamChat`),
  src/web/reader/Reader.tsx (`handToChat`, `checkClaimInChat`), src/web/chat-handoff.ts
  (`askToCheckClaim`, `fencedQuote`), src/web/useChatAnchors.ts (`threadForOrigin`),
  src/web/DebatePanel.tsx, drizzle/20261005181010_chat_thread_origin.sql.
- Privacy: src/web/PrivacyPage.tsx, docs/project/privacy.md, tests/privacy-page.test.ts.
Background: docs/plans/261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md,
docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md,
docs/plans/261005i-the-command-bar-opens-quick-search-and-the-search-panel-box-gets-a-clear-cross.md,
docs/plans/261003o-debate-reception-and-claims-sub-modes-and-a-tidier-panel.md,
docs/project/chat-llm-help-commands-vision.md, docs/project/debate.md, docs/project/chat-tools.md,
docs/user-feedback/261003_1010-fewer-modes-part-3-why-you-are-reading-feeds-the-bar.md.

Do an independent pass first: read the code, do not take the plan's word, and look for what would
make this go wrong for a reader, leak something the privacy page does not admit, or leave the
codebase worse. Say whether each factual claim in "What is there today" is accurate.

Then say for each of these whether it holds:

1. The lens as a chat (design A). Is the reasoning for a chat over a steered Debate run right, given
   Greg's words quoted in the plan? Does the second `ThreadOrigin` shape fit what 261005i built:
   every place that narrows an origin (server, client, the way-back, Chat's list, the 409 rule,
   retry and edit paths), and is a new `origin_lens` column with a replaced CHECK the right storage,
   or is there a better one? Anything in how drizzle generates CHECK changes that will bite?
2. Does `handToChat` with a lens origin work when Debate is behind the Experimental switch, when
   Chat's band is already open with a draft, and on a phone? What does the reader lose?
3. Design B's wire: a separate endpoint and model call rather than widening the pick. Right? Is
   `gpt-5.6-luna` through `openRouterJson` the right existing machinery? Anything about cost
   tracking, spend declarations, the route-contract test, or abuse (a signed-in owner pressing
   repeatedly; the pick has no rate limit by decision) that the plan misses?
4. Privacy. The plan sends the rendered profile to a model that has not had it, and lets words
   derived from it reach quick search (jev-1.13) and, after a Send, chat's web search. Is the plan's
   account of why this does not break `PROFILE_RULES` / reader-profile.md accurate, and is the
   proposed privacy-page wording true and complete? Any other page, doc or test that states the
   interface model sees only the sentence and the command list?
5. The rows. Reusing the bar's existing mode command for a suggested mode: does a press then arm a
   generating mode exactly as the ordinary row does, with its price label? Reusing `quickSearchRow`:
   any assumption (`typedOnly`, the suggestion signature, row invalidation when the draft changes)
   that breaks when the rows come from a model answer with an empty draft?
6. "Several proposals confirmed together" is deferred to a question for Greg. Is that the right
   call, or is there a small honest version of "together" worth building now?
7. Is anything passed over that should be built, or planned that should not be? Is the stage order
   right, and is each stage safe to land alone?

Severity scale, by consequence: P0 data loss, security, wrong charging, service unusable; P1
user-visible wrong behaviour or an authoritative contract violated; P2 design or maintainability
risk with no wrong behaviour today; P3 prose or comment defect. Give every finding an ID (F1, F2 …),
a severity, whether you established it (ran or traced it) or reasoned to it, and file:line.

The numbered questions are my own suspicions and worth less than what you find yourself.

End with one line: `VERDICT: build as planned` / `VERDICT: build with changes` / `VERDICT: do not build`.
