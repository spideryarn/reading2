I found no P0s. I would reshape the plan: keep the new stored pipeline step, put its dossier inside Investigate rather than adding a seventh sub-mode, and omit the automatic dive pass from v1.

## Findings

### S1 — P1 — The source check proves that a source exists, not that it supports the note

The proposed checker accepts a finding when its article quote exists and its source ID names any returned result. The spike’s “37/37 checked” therefore says nothing about whether those sources support the notes. It also proposes `quote-in-block.ts`, whose comparison folds whitespace and can accept an empty quote; existing artefact checks instead impose minimum lengths and store the exact matched characters.

This is especially unsafe for `citation`: a later review saying an old theory was reversed does not prove that the cited original was misrepresented.

Evidence: [plan:125](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md:125), [spike:219](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/scripts/spikes/261024b-situate-spike.ts:219), [research:56](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/research/261024a-situating-a-paper-in-the-literature-how-researchers-read-and-check.md:56), [Reception’s stronger check:500](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/reception.ts:500), [quote-in-block:76](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/quote-in-block.ts:76).

Recommended change: every finding should supply a substantive `sourceQuote` for each supporting source. Locate it in the exact returned extract or OpenAlex abstract, enforce a word/character floor, and store the matched source characters. Show that excerpt one action away in the UI. Permit `citation` only when the cited work’s own abstract or full text was read—using the Bibliography evidence machinery where possible. Otherwise classify the finding as `since` or `challenged`.

### S2 — P1 — “Half the searches succeeded” does not prevent an evidence-free run

The spike returns `[]` both when a request fails and when it answers without annotations. It never checks OpenRouter’s reported web-search count. Thus the proposed threshold cannot currently distinguish “the search ran and found nothing” from “no search ran.” Even eight operationally successful but empty searches could send no evidence to the reader call.

The existing search subagent already makes this distinction.

Evidence: [plan:105](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md:105), [spike:126](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/scripts/spikes/261024b-situate-spike.ts:126), [web-search-subagent:280](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/web-search-subagent.ts:280).

Recommended change: record separately for each query:

- whether the provider proved that a web search ran;
- whether it returned accepted annotations;
- whether the request failed.

Require meaningful coverage across query categories, not merely eight arbitrary successes. If searches demonstrably ran but found no pages, store an honest empty result without invoking the reader. If too many searches did not run, fail. The panel should disclose partial coverage.

### S3 — P1 — The “no tools” safety claim is defeated by automatically executing `diveQuery`

The evidence-reading call has no tools, but its output contains `diveQuery`, which the server then executes automatically. Functionally, that is a delayed search tool controlled by a model that just read hostile search extracts and the confidential article.

The planner has the same issue earlier: the spike wraps the article in XML-like tags but does not fence it as untrusted data, and its model-generated queries are immediately sent outside.

Evidence: [plan:97](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md:97), [plan:118](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md:118), [spike planner:93](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/scripts/spikes/261024b-situate-spike.ts:93), [security.md:959](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/project/security.md:959).

Recommended change: fence the planner’s article, bibliography, and profile inputs explicitly. Validate query count, length, characters, emails, URLs, and shape before execution. Do not automatically execute a free-form query produced after reading web extracts; preferably remove dive in v1. If retained, derive the dive query in code from checked article/source titles or plan it before any web evidence is introduced. Add a hostile-article and hostile-extract eval.

### S4 — P1 — The disclosure is incomplete and the current privacy page would become false

The planner uses the reader’s profile and purpose to write queries, but the proposed button says only that searches made from the piece’s text go to a search engine. Profile-derived words can therefore be transmitted without being disclosed.

The published privacy page also currently says that cited-work web search is never sent article text, while this feature sends many body-derived queries. The plan does not include updating that page, its date, or its tests.

Evidence: [plan:97](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md:97), [plan:142](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md:142), [PrivacyPage:479](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/web/PrivacyPage.tsx:479), [privacy.md:825](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/project/privacy.md:825).

Recommended change: do not give the query planner the reader profile; use it only after evidence gathering to rank or phrase findings. Say plainly that multiple queries derived from article passages go through OpenRouter to Exa, and that title/DOI goes to OpenAlex. Update `PrivacyPage.tsx`, `privacy.md`, `LAST_UPDATED`, and privacy tests. Strip email addresses as Related Work already does.

The explicit owner press is the right interaction, but the disclosure line alone is not enough while the public privacy promise contradicts it.

### S5 — P1 — The rate policy does not yet cover the actual job and retry paths

A `RatePolicy` needs `concurrency` and `leaseMs`; the plan gives neither. More importantly, a limiter “at the route that starts it” can miss generic `/api/jobs`, command-bar/Metadata forced runs, and `/api/jobs/:id/retry`. If the token is released after enqueue, it does not bound the expensive work at all.

Jobs may also receive three lease windows. An uncheckpointed expensive step can therefore be bought repeatedly unless it is marked `oncePerJob`.

The global fuse permits roughly $144–$220/day using the spike’s actual base costs, before dive and retries. Existing comparable fuses explain their accepted dollar loss and are nearer $20–$50/day.

Evidence: [plan:135](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md:135), [RatePolicy contract:3476](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/store/contracts.ts:3476), [job repetition:369](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/jobs.ts:369), [generic retry route:14282](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/routes.ts:14282), [claim-check fuse:2148](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/reception.ts:2148).

Recommended change: take and hold the allowance inside the pipeline step, after ownership checks and immediately before paid work, so every enqueue and retry entrance passes it. Mark `situate` `oncePerJob`. Set a one-owner concurrency and a lease covering the whole bounded step. Treat explicit Retry as a new allowance. Reduce the initial global fuse to an explicitly stated maximum daily loss—about 90 worst-case runs for a $50 fuse would match existing practice better.

### S6 — P1 — `citation-index.ts` does not provide the abstracts the plan says it will reuse

The existing citation-index request deliberately omits abstracts. Its public `Citer` type says explicitly that Spideryarn has not read what the citing paper says. The spike obtained abstracts through a separate direct OpenAlex request, bypassing the production parser/cache shape.

Adding abstracts to the shared citer list would also increase an already large response and widen stored/public data unnecessarily.

Evidence: [plan:108](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md:108), [citation-index fields:189](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/citation-index.ts:189), [Citer contract:8074](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/types.ts:8074), [spike’s separate fetch:141](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/scripts/spikes/261024b-situate-spike.ts:141).

Recommended change: plan a private Situate-specific citer-evidence function that reuses citation-index’s target identity confirmation, service limiter, bounded text parser, and generated links, but requests at most 40 abstracts. Do not silently widen the shared/public `Citer` DTO or cache.

### S7 — P1 — The proposed Marginalia display violates both density rules

The plan allows two open Literature notes on one block. Marginalia’s contract says other modes’ items begin shut and are grouped into one line per kind per block. The open exception belongs to the relations call’s own sparse notes, capped at one per passage—not to externally sourced mode items.

Evidence: [plan:82](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md:82), [plan:165](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md:165), [marginalia.md:343](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/project/marginalia.md:343), [notes.ts:80](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/web/marginalia/notes.ts:80).

Recommended change: represent Literature as a grouped kind with one shut line per block; opening it reveals one or two findings. The strongest finding may supply the shut-line text. Keep the total cap, but enforce the per-kind/per-block contract.

### S8 — P1 — The planned Ask-in-chat behavior knowingly breaks the mode-origin contract

The plan says a finding’s chat returns to Investigate rather than the finding in Situate. The authoritative mode contract requires the item and chat to lead back to each other, reuse the existing chat, and show its gist.

The proposed “stable id” is also not backed by an ID-preservation strategy. If reruns mint fresh IDs, an eventual proper origin will break.

Evidence: [plan:131](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md:131), [plan:154](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md:154), [mode.md:339](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/project/mode.md:339), [chat-from-a-mode.md:72](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/project/chat-from-a-mode.md:72).

Recommended change: either implement a real finding origin now, including focus, resume, gist, and way back, or omit Ask in chat from findings in v1. Preserve IDs across reruns by matching a checked canonical identity, rather than merely minting an ID field.

### S9 — P1 — The stored-artefact contract is incomplete and internally inconsistent

The plan says `sourceHash` and profile hash are stored, but its stated stored object contains neither. It also omits `generator`, so a model-generation change cannot produce the standard `outdated` verdict. Profile-derived work needs the profile-carrier handling, while an owner-only artefact must be deliberately excluded from public projections and the sharing dialog.

The prompt plan also does not explicitly include the mandatory strict schemas, `plainWords`, and `paperwork` rules.

Evidence: [plan:93](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md:93), [plan:131](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md:131), [mode.md:537](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/project/mode.md:537), [mode.md:553](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/project/mode.md:553), [Sources Claims precedent:284](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/sources-claims.ts:284).

Recommended change: make the stored shape explicitly include `slug`, `version`, `generator`, `sourceHash`, `profileHash`, `generatedAt`, `elapsedMs`, and provenance/loss counters. Define separate `stale`, `outdated`, and `profileChanged` behavior. Use strict JSON schemas for all model calls, plus `plainWords` and `paperwork`.

For revision handling, explicitly set `REVISION_CARRY_POLICY.situate = "carry"`: that preserves the paid artefact across re-extraction while its `sourceHash` marks it stale. Keep it out of `PUBLIC_PROJECTIONS`, Sources’ visitor `POLICY`, and the public DTO; add it to the owner-only profile-carrying exception if it retains `profileHash`.

### S10 — P1 — The `literature` command alias already belongs to Sources

Bare `literature` currently aliases the top-level Sources mode and is tested to put that row first. Giving it to Situate either fails the collision test or silently changes where an established command opens. `situate` itself is the label and should not also be an alias.

Evidence: [plan:160](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md:160), [current catalogue:245](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/command-pick-catalogue.generated.json:245), [alias-order test:150](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/tests/command-match-mode-aliases.test.ts:150).

Recommended change: remove bare `literature` and `situate` from the aliases. Keep phrases such as `literature context`, `field context`, and `what has changed since`, then run both mode/sub-mode alias tests and the argument collision matrix.

### S11 — P1 — The optional dive can discard a valid, paid first pass

The five phases form one step and apparently publish only at the end. A timeout or provider failure during dive therefore loses the checked first-pass findings and may cause a job-window retry to rebuy the work. The second model is also handed the whole list and allowed to return a “revised list,” so it can alter or drop findings that were not selected for diving.

This contradicts the rule that paid useful output is kept. Reception already keeps verified rows when its optional synthesis fails.

Evidence: [plan:93](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md:93), [plan:118](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md:118), [mode.md:564](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/project/mode.md:564), [Reception precedent:1984](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/reception.ts:1984).

Recommended change: remove automated dive from v1 and let Ask in Chat provide the open-ended continuation. If dive remains, bank the checked first pass before it, store an explicit dive failure state, and let code merge replacements only for the selected stable finding IDs. Non-dived findings must bypass the revision model unchanged.

### S12 — P2 — A seventh sub-mode is not required to get the non-chat value

The plan presents “findings inside Investigate” as equivalent to suggested chat questions. That is a false choice. Investigate can contain the stored overview, grouped findings, search disclosure, and one search button above its existing questions; Marginalia remains the distinctive reading-view improvement.

That preserves the new artefact and new pipeline step while avoiding new URL state, visitor fallback, activation cases, alias ownership, a seventh chip, and the already-wrong chat origin.

Evidence: [plan:61](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md:61), [plan’s passed-over option:194](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md:194), [Investigate’s remit:1](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/web/InvestigatePanel.tsx:1).

Recommended change: keep `situate` as a new owner-only step/artifact, but make it the hands-free dossier at the top of Sources › Investigate. A Literature stamp opens Investigate focused on the finding. This is still decisively more than “just a chat” and better matches Greg’s direction toward fewer sub-modes.

### S13 — P2 — The second cache breakpoint and dive reuse are asserted, not measured

The spike used one breakpoint, after the article. The investigation explicitly says the dive pass was not measured. Cache reuse requires the complete request prefix—including provider, system, tools, schema, effort, article, and original evidence—to be byte-identical.

A second request would normally hit the longest matching evidence prefix, which already includes the article; “reuses both cached prefixes” should not imply two additive cache reads.

Evidence: [spike:202](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/scripts/spikes/261024b-situate-spike.ts:202), [investigation:77](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/investigations/261024b-situate-spike-searches-into-one-read-cost-and-quality.md:77), [prompt-caching.md:46](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/project/prompt-caching.md:46).

Recommended change: call the claim provisional. Put all varying dive material after the evidence marker, test the serialized prefix byte-for-byte, and verify non-zero cached-input tokens on a paid production-shaped run before claiming the dive “costs a fraction.”

### S14 — P2 — The Sonnet decision and quoted ordinary cost exceed the evidence

Only one Haiku run was made, on one article. Its failures were judged by the article-quote checker, while source support—the harder quality question—was not evaluated. “37 of 37 kept” is therefore mechanical anchoring evidence, not evidence that Sonnet’s literature claims were right.

The plan’s `$0.25` ordinary estimate is also below both ordinary spike runs, which cost `$0.362` and `$0.375`; dive remains unmeasured.

Evidence: [investigation:34](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/investigations/261024b-situate-spike-searches-into-one-read-cost-and-quality.md:34), [investigation:63](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/investigations/261024b-situate-spike-searches-into-one-read-cost-and-quality.md:63), [plan:135](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md:135).

Recommended change: Sonnet is a reasonable conservative v1 default, but describe it as provisional rather than settled. After strengthening source checks, run repeated paired comparisons across all three articles and score support, temporal classification, usefulness, and validation losses. Quote the measured base as roughly `$0.36–$0.52`, with dive unknown.

## Contracts that otherwise hold

The use of stable block IDs rather than offsets is right, provided matched article characters are stored. Re-extraction need not lose Situate: the exhaustive revision policy will force an explicit decision, and `carry` plus `sourceHash` is the established answer. Owner-only access, an explicit press, no visitor chip, and `visitorSourcesView` falling back to Bibliography are also the right boundaries—provided Situate remains absent from public projections and Sources’ visitor artefact policy.

## Verdict

**Reshape.** The new `situate` pipeline step and stored artefact are justified; trying to fold sixteen searches into Reception or avoid storage would weaken the feature. But the fun v1 should be one hands-free dossier inside Investigate, plus grouped shut Literature marginalia, without the automated dive. Before building, strengthen the evidence contract to source quotations, correct search-success accounting, close the model-output-to-search boundary, update privacy, and put allowance enforcement inside the job with `oncePerJob`. The seventh chip adds contracts and contradicts the longer-term direction without adding the value Greg actually asked for.