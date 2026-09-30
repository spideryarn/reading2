## Findings

### R-1 — P0 — A matching result title does not establish that the extract is from the cited paper

The proposed P-2 carry-over is incomplete. `namesTitle` is a deliberately loose anchor matcher: it accepts 60% of significant title words and only half of the result title’s words. For example, “Scaling Laws for Neural Language Models” can match “Scaling Laws for Neural Machine Translation.” Publisher, aggregator, review, and discussion pages can also title themselves with the paper’s title.

OpenRouter documents that Exa’s selected excerpts are returned to the model and surfaced through `url_citation.content`; the code preserves the first 8,000 characters. That is adequate to prove a displayed quote occurs in the search result’s returned extract. It does not authenticate the page as the paper or make the extract “from the paper.” [OpenRouter’s web-search documentation](https://openrouter.ai/docs/guides/features/server-tools/web-search) also describes Exa content as query-selected page highlights, potentially from several disjoint parts of the page.

Evidence: [plan:84](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/docs/plans/260929g-check-a-cited-paper-supports-the-claim.md:84>), [plan:93](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/docs/plans/260929g-check-a-cited-paper-supports-the-claim.md:93>), [citations.ts:612](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/citations.ts:612>), [citations.ts:618](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/citations.ts:618>), [openrouter-stream.ts:486](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/openrouter-stream.ts:486>).

Recommended fix: for this re-scoped version, never call it “the paper’s extract” or label a quote “from the paper.” Say:

> We saw a search extract for a result whose title resembles this work. We did not verify or read the paper itself.

Label quotations “from the search result extract” and the verdict “AI reading of that extract.” If paper-level attribution is required, restore a stronger identity check: DOI/arXiv agreement where available, otherwise a substantially stricter title match plus author/year evidence. Do not reuse `namesTitle` as document identity.

### R-2 — P1 — The proposed UI has states the storage model cannot represent

The plan promises “looked up, but no page was clearly this paper,” yet says a no-match stores nothing. After reload, no-match is indistinguishable from never attempted. It also omits an existing fourth state: a title-matching result whose annotation has no `content`. `SearchEvidence.excerpt` is explicitly optional, while the table requires a URL for every row.

Evidence: [plan:58](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/docs/plans/260929g-check-a-cited-paper-supports-the-claim.md:58>), [plan:110](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/docs/plans/260929g-check-a-cited-paper-supports-the-claim.md:110>), [types.ts:2490](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/types.ts:2490>), [citation-find.ts:468](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/citation-find.ts:468>), [schema.ts:3639](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/db/schema.ts:3639>).

Recommended fix: define a discriminated state explicitly:

- never attempted;
- no matching result;
- matching result, but no extract;
- matching result with an assessed extract.

Either persist no-match attempts with an outcome and timestamp, or describe them as transient UI notices and remove the promise that the row and hover card retain that state. Never turn “no extract supplied” into `not-in-extract`.

### R-3 — P1 — Linked-row finds currently have nowhere to attach, and the existing response carries the found URL as the row URL

`attachFinds` entirely ignores a stored find when `linkFrom !== "search"`. `CitedWork.found` is documented as present only when the row has been upgraded to `web`, and the client patches only rows still marked `search`. Conversely, after a successful lookup the current route response unconditionally returns the found URL as `work.url` with `linkFrom: "web"`.

Therefore merely removing the route’s linked-row refusal either produces no visible assessment or invites the searched URL to replace the article’s link when the client is modified to accept the result.

Evidence: [plan:100](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/docs/plans/260929g-check-a-cited-paper-supports-the-claim.md:100>), [citation-find.ts:418](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/citation-find.ts:418>), [citation-find.ts:470](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/citation-find.ts:470>), [citations.ts:663](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/citations.ts:663>), [types.ts:3752](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/types.ts:3752>), [useCitations.ts:249](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/web/useCitations.ts:249>).

Recommended fix: add a separate private `lookup` or `assessment` field that can attach to every owner row. Keep link selection independent:

- `search` row: the found URL may still upgrade the displayed link;
- DOI/arXiv/article row: preserve its original `url` and `linkFrom`, attaching only the lookup evidence;
- POST response: return the assessment separately, or return a server-reloaded work whose original link is already preserved.

Add server and client regression tests covering a linked row, a late response after regeneration, and the found URL never becoming the displayed link.

### R-4 — P1 — Hashing only `why` and one passage does not satisfy carried-over P-8

The call’s result depends on more than those two strings: work title/authors/year, the bibliography entry used to disambiguate search, the chosen result URL/title/extract, prompt/schema version, matcher policy, and model. IDs can survive regeneration by DOI, arXiv ID, or article URL even when descriptive metadata changes.

The established cache precedent separately fingerprints destination evidence, reader context, prompt version, and model.

Evidence: [plan:97](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/docs/plans/260929g-check-a-cited-paper-supports-the-claim.md:97>), [citations.ts:854](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/citations.ts:854>), [citations.ts:1049](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/citations.ts:1049>), [link-summary.ts:831](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/link-summary.ts:831>).

Recommended fix: store two values:

- a recomputable context fingerprint over the exact capped strings sent—title, authors, year, reference entry, `why`, citing passage—plus assessment prompt/schema version, matcher version, and model;
- an evidence hash over the selected annotation’s URL, title, and exact capped excerpt.

Attach an assessment only when the current context fingerprint matches. Keep the evidence hash as provenance and for reproduction.

### R-5 — P1 — “Everything shown is checked by code” still overstates what is established

Code can establish the URL came from the call, the title passed a matcher, and a quote occurs in an excerpt. It cannot establish that the quote entails `paperDoes` or the support verdict. A hostile or misleading search result can supply a genuine quote while steering the model’s characterization.

The risk is sharper in this one-call design because the model consumes search content inside OpenRouter before application code sees it; it cannot first be fenced with `untrusted()`. Debate mode documents this as residual risk, not a solved one. The proposed richer parser also lacks maximum lengths and a precise runtime union.

Evidence: [plan:74](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/docs/plans/260929g-check-a-cited-paper-supports-the-claim.md:74>), [plan:84](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/docs/plans/260929g-check-a-cited-paper-supports-the-claim.md:84>), [debate.ts:78](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/debate.ts:78>), [debate.ts:91](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/debate.ts:91>), [citation-find.ts:255](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/citation-find.ts:255>).

Recommended fix:

- Narrow the claim to “every displayed quotation and source association is checked by code.”
- Keep every characterization explicitly labelled as AI interpretation.
- Parse an exact discriminated union with clean finish, exact verdicts, paired `paperDoes`/quote fields, and maximum lengths for prose and quotes.
- Add an adversarial search-extract fixture.
- State the residual injection risk using Debate’s existing wording.

### R-6 — P2 — “Already in export” is only half true

The bundle exporter serializes the whole database row and would include additive columns automatically. The other exporter manually enumerates the current fields and would silently omit every new judgement field. The public DTO does already exclude owner finds by construction, but the new private attachment field should remain explicitly absent from that projection.

Evidence: [plan:108](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/docs/plans/260929g-check-a-cited-paper-supports-the-claim.md:108>), [export.ts:796](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/store/export.ts:796>), [export-bundle.ts:522](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/store/export-bundle.ts:522>), [public-types.ts:480](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/public-types.ts:480>), [dto.ts:521](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/public/dto.ts:521>).

Recommended fix: name both export projections and their tests in Stage 1. Add an explicit public-boundary test proving assessment text, quotes, lookup status, and the searched URL remain owner-only.

### R-7 — P2 — The one-call design preserves the broad limits, but its URL quality and expected cost need a before/after check

The hard controls remain the same: one admitted request, five returned results, a 60-second deadline, and the existing rate bucket. But `max_total_results` is not a search-count or spend cap. The current 400-token answer ceiling was sized for one URL, while the new answer contains two prose fields and two quotes. The citing-passage cap is also unspecified.

A longer, multi-objective prompt may cause more searches or a worse URL choice; the planned “several real runs” would not detect regression without the old prompt as a control.

Evidence: [citation-find.ts:93](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/citation-find.ts:93>), [citation-find.ts:97](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/citation-find.ts:97>), [citation-find.ts:152](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/citation-find.ts:152>), [ai-gateway.md:368](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/docs/project/ai-gateway.md:368>), [plan:81](</home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/docs/plans/260929g-check-a-cited-paper-supports-the-claim.md:81>).

Recommended fix: specify caps for the citing paragraph, `paperDoes`, and both quotes; resize the answer ceiling; and set the search tool’s `max_characters` so the model-side evidence budget aligns with the 8,000-character verifier cap. A/B the old and new prompts on the same citations, recording URL/no-match agreement, title-check outcome, search count, token usage, finish reason, latency, and cost.

### R-8 — P2 — A smaller first stage gets most of the trust benefit

The highest-value part of the request is provenance: preventing the existing article-derived `why` from reading as though it came from the cited work. That requires no schema or prompt change.

Recommended fix: make Stage 1 UI-only:

- relabel `why` as “what this article uses it for”;
- say “we have not read the cited paper”;
- after existing Find it, say only that a matching-titled web result was found, not that the paper was read.

Then add extract assessment only after the identity wording, state model, linked-row contract, and A/B run are settled. This is the simplest coherent version and remains useful even if the judgement stage is deferred.

**Overall verdict: build with changes.** The re-scope is directionally right, and `url_citation.content` is suitable for verifying quotations against returned search evidence. The P0 identity/attribution wording must change before building; linked-row attachment, outcome states, and staleness also need to be made explicit. No files were changed.