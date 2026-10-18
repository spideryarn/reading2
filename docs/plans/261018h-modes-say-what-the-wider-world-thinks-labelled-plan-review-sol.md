The plan needs revision before implementation. The central idea is sound, but the proposed shared wording conflicts with Recall’s and Tutorial’s turn shapes, and the eval would not reliably catch that regression.

## Findings

**F1 — P1 — The shared ordering rule directly conflicts with Recall, Tutorial, and Quiz.**

Evidence: the plan requires the reply to say the reader “has read it right” before anything else, then put the outside note after the mode’s own job ([plan:71](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/docs/plans/261018h-modes-say-what-the-wider-world-thinks-labelled.md:71)). Recall forbids opening with a judgement of the reader ([converse.ts:918](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/src/converse.ts:918)) and requires its nudge question to be the last sentence before the hint ([converse.ts:1067](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/src/converse.ts:1067)). Tutorial likewise requires its one task last ([converse.ts:1193](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/src/converse.ts:1193)). Quiz explicitly forbids opening with a judgement of the answer ([quiz-mark.ts:236](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/src/quiz-mark.ts:236)).

A compliant model cannot put an outside sentence “after the mode’s own job” in Recall or Tutorial without putting prose after the required closing question. It also must not say “you read it right.”

Concrete fix: share only the provenance and certainty rules. Give each prompt its own sequencing:

- Recall: article-based response → outside note → nudge → hidden hint.
- Tutorial: response/teaching → outside note → task last.
- Quiz: article claim first → outside note; never a judgement of the reader.
- Chat: answer first → outside note where material.

Also place an explicit rule inside Recall’s ranked entitlement section: outside knowledge can never change whether the reader represented the piece correctly.

**F2 — P1 — The trigger for unsolicited outside commentary is too broad to prevent tangents.**

Evidence: “disputed, out of date, oversimplified or wrong” and “bears on what they are taking” ([plan:58](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/docs/plans/261018h-modes-say-what-the-wider-world-thinks-labelled.md:58)) describes a large fraction of claims in argumentative writing. The proposed “disputed” positive case treats “the argument fails at its first hurdle” as requiring an outside note ([plan:118](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/docs/plans/261018h-modes-say-what-the-wider-world-thinks-labelled.md:118)); the same reasoning can label almost every philosophical conclusion “contested.” That competes with Recall’s one-correction/one-nudge contract and Tutorial’s one-idea turn.

Concrete fix: make the materiality test operational. Raise something unasked only when:

1. a concrete, checkable fact is materially wrong or outdated; or
2. a well-established consensus or substantial live dispute would materially change whether the reader should believe, use, or carry away a central claim.

Explicitly exclude merely having opponents, adding nuance or background, and searching to discover whether an objection exists. Search may verify a discrepancy already identified; it should not hunt for one.

**F3 — P1 — The eval can pass while breaking the modes’ primary contracts.**

Evidence: its cheap screens only count outside markers, mixed block IDs, and Quiz grade words ([plan:127](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/docs/plans/261018h-modes-say-what-the-wider-world-thinks-labelled.md:127)). They do not check Recall’s exact one question mark, question-last rule, hint shape, or 120-word limit, despite an existing checked instrument for those properties ([learn-recall-checks.ts:75](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/evals/learn-recall-checks.ts:75)). Nor do they check Tutorial’s one task and 140-word ceiling. The Learn documentation says its existing Recall eval runs after every prompt change ([learn-mode.md:129](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/docs/project/learn-mode.md:129)); Tutorial already has a five-turn eval designed around length and links ([learn-mode.md:264](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/docs/project/learn-mode.md:264)).

The Chat positive case is also not a test of the new behavior: “how old is it?” already invokes Chat’s existing instruction to search unless genuinely sure ([converse.ts:668](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/src/converse.ts:668)).

Concrete fix:

- Run `evals/learn-recall.ts`, `evals/learn-tutorial.ts`, and the Quiz marking half before and after.
- Reuse `checkReply` for Recall.
- Add per-mode positive, tempting-negative, and reader-wrong cases.
- For Chat, ask an article-internal question that does not itself request external verification, so unsolicited correction is the measured delta.
- Add a judge question asking whether either reply damaged the mode’s primary job, brevity, or turn shape.

**F4 — P1 — Unprompted search widens an outbound privacy risk without carrying Explore’s query rule across.**

Evidence: the plan removes Recall’s explicit prohibition on unprompted search and enables it in Recall and Tutorial ([plan:81](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/docs/plans/261018h-modes-say-what-the-wider-world-thinks-labelled.md:81)). Explore already says never to put the reader’s words into a web search or address ([converse.ts:1590](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/src/converse.ts:1590)). The security documentation explains why a read/search address is itself an outbound channel, not a neutral action ([security.md:958](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/docs/project/security.md:958)). Recall commonly contains dictated, potentially personal material.

Concrete fix: put the same privacy rule into every search-capable variant: never copy the reader’s answer, profile, notes, or personal case into a query; search for the article’s claim in neutral words. Add an adversarial eval case containing memorable private wording.

**F5 — P2 — The control and blind-judging design is incomplete.**

Evidence: the plan says “before twice” and “after once,” but does not define the two comparisons, record a prompt hash, or say how results are compared with control variance ([plan:127](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/docs/plans/261018h-modes-say-what-the-wider-world-thinks-labelled.md:127)). The house method requires a source hash, separate immutable arms, the tested `blindCoin`, balance checks, and explicit comparison with the before-vs-before split ([prompting-guide.md:201](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/docs/project/prompting-guide.md:201)).

Also, a judge shown only answer pairs cannot reliably decide whether an unlinked memory claim is true; that risks using another model’s matching prior as ground truth.

Concrete fix: specify `before-1 vs before-2` and `before vs after` pair sets, hash or commit-stamp every run, use `blindCoin`, verify each key’s balance, and report change-arm effects against the control. Give the judge a fixed, arm-neutral evidence sheet for factual cases; require links for searchable cases.

**F6 — P2 — The plan overlooks UI provenance that already exists.**

Evidence: the plan says the scheme is words rather than UI ([plan:92](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/docs/plans/261018h-modes-say-what-the-wider-world-thinks-labelled.md:92)), but conversational answers already render searched citations under a visible “From the web” heading ([ChatPanel.tsx:2903](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/src/web/ChatPanel.tsx:2903), [ChatPanel.tsx:2996](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/src/web/ChatPanel.tsx:2996)), while article IDs become passage chips. Quiz deliberately renders no model-authored links because its prompt does not govern them ([QuizPanel.tsx:1635](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/src/web/QuizPanel.tsx:1635)).

The three origins are distinguishable without a new schema: block chip, linked claim plus “From the web,” and an explicit “from my memory, unchecked” sentence. But the plan should test the rendered result, not claim there is no UI involved.

Concrete fix: document the existing UI as part of the scheme and add a small rendering/browser check for Chat, Recall, and Tutorial. No new badge is needed yet.

**F7 — P2 — Explain is not covered by merely being “open to the world.”**

Evidence: Explain distinguishes what the author means from outside background ([explain.ts:189](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/src/explain.ts:189)) and labels outside knowledge ([explain.ts:260](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/src/explain.ts:260)), but nothing tells it to flag a selected claim that the article gets wrong or materially oversimplifies. That is exactly a claim the reader is dealing with now.

Concrete fix: either include Explain with a tailored local rule and eval—its output forbids block IDs, so it cannot consume the proposed helper unchanged—or explicitly defer it with a queue item and rationale. Live is reasonably deferred because spoken provenance needs different wording; Glossary should remain out because `senseHere` and `background` are already separate labelled fields ([glossary.md:602](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/docs/project/glossary.md:602)).

**F8 — P2 — “Chat can check it” should not be generated inside every Quiz mark.**

Evidence: the plan requires this whenever Quiz cannot search ([plan:67](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/docs/plans/261018h-modes-say-what-the-wider-world-thinks-labelled.md:67)), while also promising Quiz only one added sentence ([plan:85](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/docs/plans/261018h-modes-say-what-the-wider-world-thinks-labelled.md:85)). Quiz already has a dedicated “Discuss this in chat” action that transfers the question, answer, and mark ([quiz.md:331](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/docs/project/quiz.md:331)). Generated advertising consumes scarce mark space and does not itself verify the claim.

Concrete fix: in Quiz, say only that the outside point is remembered and unchecked. Let the existing action be the route to verification.

## Checked details

- The Antikythera example is valid: the fixture really says “around 2,000 BCE” ([blocks.json:644](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/tests/fixtures/data-root/data/noema-mythology-of-conscious-ai/blocks.json:644)), while the National Archaeological Museum dates the mechanism to roughly 150–100 BCE. [National Archaeological Museum](https://antikythera-mechanism.namuseum.gr/en/epigraphist/)
- No prompt-version bump appears necessary: these are live interaction prompts, not stored generated artefacts.
- No `plainWords` or paperwork-coverage exemption should change: the existing calling files already comply, and `src/wider-world.ts` would not call a model.
- The plan should nevertheless add the new eval to `evals/README.md` and write the required investigation of its results; that requirement is explicit at [evals/README.md:3](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/evals/README.md:3).
- Pinning only the shared section’s name is insufficient. Tests should pin the correct variant and its ordering relative to Recall’s nudge, Tutorial’s task, Quiz’s article-first rule, and Chat’s existing `CLAIM_ORIGINS`.

REVISE