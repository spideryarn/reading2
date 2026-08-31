Verdict: do not build the plan as written. “Referee” is a sound product direction, but the proposed v1 is not yet human-first, and several reuse claims are false at the code boundary.

## Findings, most serious first

1. **Critical — the confidentiality notice arrives after the breach**

The plan promises a notice “before anything runs,” but only inside Referee mode ([plan line 139](/home/greg/code/spideryarn2/docs/plans/260831an-referee-mode-for-peer-reviewers.md:139)). By then ingestion has already run model-facing extraction for PDFs and generated the hierarchy and gists ([architecture line 113](/home/greg/code/spideryarn2/docs/project/architecture.md:113)); the default ingest includes those stages ([pipeline line 217](/home/greg/code/spideryarn2/src/pipeline.ts:217)). All model calls go through OpenRouter ([architecture line 286](/home/greg/code/spideryarn2/docs/project/architecture.md:286)).

The research says uploading the manuscript is itself the violation, independently of what the AI produces ([research index line 25](/home/greg/code/spideryarn2/docs/research/260831e-helping-peer-reviewers/README.md:25)). A checkbox shown later cannot repair that.

Do instead: put the disclosure and attestation before URL/file ingestion and describe the honest audience: public preprints, open-review papers, and drafts shared with consent. Referee mode should not imply that acknowledging a notice makes prohibited use permissible.

2. **Critical — Claims is the strongest cognitive-surrender feature, not the safest**

Claims automatically decides:

- what the paper’s claims are;
- which passages count as support;
- whether nothing supports a claim;
- which claims are “thinnest.”

Those are judgments. A zero-result row may mean unsupported, but it may equally mean the extractor missed a table, figure, supplement, qualification, or differently worded evidence. Counting passages is especially indefensible: one decisive result can support more than five repetitive mentions. Yet the plan calls the empty row “a finding made of structure rather than judgement” ([plan line 89](/home/greg/code/spideryarn2/docs/plans/260831an-referee-mode-for-peer-reviewers.md:89)).

This is the sub-mode most likely to replace reading. In practice, a tired referee will open Claims first, inspect the top “thin” rows, read only the passages the model selected, and treat unlisted claims and unmarked prose as clean. It is the “Pre-Highlighted Problems” failure from the idea list, presented as a table rather than a red wash.

Do instead: replace Claims in v1 with **Anchored Notebook** from idea #1. Make the reviewer’s notes and claim selections the agenda. A later Promise-vs-Delivery pass may retrieve candidate passages only after the reviewer has committed their own list. If Claims remains, show claims in document order, say “the model did not find a passage,” never “none,” and remove thinness ranking.

3. **High — Mirror does not have the input it claims to read, and the ICLR evidence is overstated**

The app has anchored passage notes, not a referee report. Every comment necessarily has `blockId`, `quote`, and `start` ([Comment type line 1777](/home/greg/code/spideryarn2/src/types.ts:1777)); its prose is optional ([comments line 23](/home/greg/code/spideryarn2/docs/project/comments.md:23)). Therefore “this comment is not anchored to anything” is impossible under the current model. A pile of passage notes also cannot establish that the eventual review covers a criterion.

The ICLR experiment is relevant but not evidence for Mirror’s exact proposed shape. It ran after reviewers submitted complete, structured reviews and targeted three categories: vagueness, overlooked paper content, and unprofessional remarks. It used five model calls plus reliability gates after finding one model insufficient. The planned Mirror substitutes an unanchored check and a coverage audit, neither tested there, and omits professionalism. The causal evidence is that feedback increased revision and engagement; “27% revised” is not “they liked it.” The blinded quality comparison was also on a selected subset of revised reviews, not the full randomized population. See the [primary ICLR study](https://arxiv.org/html/2504.09737).

Do instead: build the Anchored Notebook first, including major/minor/question/private tags. Then make Mirror narrowly match the evidence: specificity, possible misunderstanding with an exact paper quotation, and professionalism. Require abstention and reliability checks. Keep coverage as a separate, explicitly unvalidated experiment.

4. **High — the plan drops two safeguards its own research calls mandatory**

First, identity bias: the research says referee-facing model calls must strip author and institution signals ([research line 56](/home/greg/code/spideryarn2/docs/research/260831e-helping-peer-reviewers/README.md:56)). Current prompt rendering explicitly includes byline, publication, and URL ([article-prompt line 79](/home/greg/code/spideryarn2/src/article-prompt.ts:79)). The plan says nothing about masking these for evaluative calls.

Second, prompt injection: idea #19 calls a deterministic source-level Injection Alarm a non-negotiable prerequisite ([ideas line 202](/home/greg/code/spideryarn2/docs/research/260831e-helping-peer-reviewers/ideas-fable.md:202)). The plan replaces it with a criterion that asks the potentially compromised model to locate instructions ([plan line 73](/home/greg/code/spideryarn2/docs/plans/260831an-referee-mode-for-peer-reviewers.md:73)). That is detection after exposure, by the component being attacked.

Do instead: give Referee calls an identity-stripped article renderer and add a pre-model, source-level hidden-text scan. Keep the prompt instruction that manuscript text is untrusted, but do not call that a defence.

5. **High — Criteria’s “ranking, not scoring” argument contradicts its own design**

A −100 to +100 valence is an absolute 201-point score. Printing an ordinal beside that number does not turn it into ranking. Worse, questions such as “are the controls adequate?” ask the model to evaluate scientific adequacy and then paint the answer into the prose before the referee has formed their view ([plan line 54](/home/greg/code/spideryarn2/docs/plans/260831an-referee-mode-for-peer-reviewers.md:54)).

Criteria is also mostly Search with a hat. Search already saves runs, assigns colours, orders results, reruns them, and marks the prose. The genuinely new parts are presets, web lookup, and valence; the first is a thin template layer, while the latter two carry nearly all the risk.

Do instead: make v1 Criteria a preset-and-organisation layer over the existing Search implementation. No valence. A result should mean “this passage bears on your criterion,” not “this passage is good or bad.” If Criteria grows separate routes, stores, and rendering machinery, the duplication is fatal; if it remains a thin Search view, it is defensible.

6. **High — `search_runs` does not already have the required shape**

`search_runs` stores a criterion string, generic hits, and an optional colour; it has no criterion kind, positive/negative poles, web-search preference, citations, or valence ([schema line 1943](/home/greg/code/spideryarn2/src/db/schema.ts:1943)). `SearchHit` contains only 0–100 confidence ([types line 2331](/home/greg/code/spideryarn2/src/types.ts:2331)), and validation clamps negative numbers to zero ([search line 327](/home/greg/code/spideryarn2/src/search.ts:327)).

Technically, a new `valence` property could sit inside the existing JSONB without a SQL migration. That does not solve persistence: a saved run still cannot say whether it is single or diverging, what its endpoints mean, or whether rerunning it should enable web search. Encoding those facts in the criterion string would be an architectural regression.

Do instead: define a discriminated saved-run shape and plan the migration explicitly—probably a typed `config` JSONB or dedicated columns. Keep match confidence and evaluative valence separate; never overload one field.

7. **High — the stripe proposal breaks the renderer’s information contract**

The current renderer has exactly two hit channels:

- wash strength carries confidence;
- categorical stripes carry search identity.

That split is stated directly in CSS ([styles line 1981](/home/greg/code/spideryarn2/src/web/styles.css:1981)). `Mark` can carry only strength and a categorical slot ([annotate line 135](/home/greg/code/spideryarn2/src/web/annotate.ts:135)), and overlapping marks keep all identity slots while collapsing strength to the strongest ([annotate line 323](/home/greg/code/spideryarn2/src/web/annotate.ts:323)).

Repurposing the stripe as valence discards provenance. Two negative criteria over the same phrase collapse visually into “red”; the reader cannot tell which criterion made which judgment. “The panel row tells them apart” does not help while reading the prose. The renderer’s own documentation says a new kind needing per-mark styling is precisely where “one union entry and one `if`” stops being cheap ([annotate line 72](/home/greg/code/spideryarn2/src/web/annotate.ts:72)).

Do instead: preserve categorical stripes for criterion identity. If valence survives product review, show it separately in the result row and gutter, with text and an accessible name.

8. **High — red↔green is explicitly the palette this repo says not to use**

The colour-scale documentation already settles this: red–green is “the single worst pair available,” while `--div-*` blue↔red is the default colour-blind-safe diverging scale ([colour-scales line 347](/home/greg/code/spideryarn2/docs/project/colour-scales.md:347)).

Use `--div-0` through `--div-8`, with negative/bad at the red end and positive/good at the blue end. Keep zero fixed at the dark midpoint. Every result must also print its direction—such as “counts against” / “counts for,” plus the signed value or rank—and include it in the `aria-label`. Colour cannot be the only carrier.

9. **Medium — Claims fits the on-demand pipeline pattern, but Stage 3 conceals most of the implementation**

The architectural choice is sound: Claims is article-derived, reusable, and expensive, so an on-demand pipeline artefact is appropriate.

It is not merely “Ideas plus a second column.” A new stage requires at least:

- `StepName` and `STEP_ORDER` ([types line 1848](/home/greg/code/spideryarn2/src/types.ts:1848), [pipeline line 145](/home/greg/code/spideryarn2/src/pipeline.ts:145));
- exclusion from `DEFAULT_INGEST_STEPS`;
- an `ArtifactKind`, `ArtifactMap`, validation and both storage maps ([artifacts line 74](/home/greg/code/spideryarn2/src/store/artifacts.ts:74));
- an `article_revisions` column;
- a migration widening the database step constraint ([schema line 1388](/home/greg/code/spideryarn2/src/db/schema.ts:1388));
- model task/tier/wire/renderer declarations;
- GET artefact and POST-job client handling;
- freshness, stable IDs and carry-forward policy.

Do instead: retain the pipeline decision but turn this into its own technical stage with the migration and exhaustive maps named. As written, Stage 3 is not buildable enough to review.

10. **Medium — per-call OpenRouter web search is possible, but not “just a flag” in Search**

Yes: OpenRouter’s server tool can be enabled on any compatible call; it is not restricted to chat routes. `explain()` does so by adding `tools: [{type: "openrouter:web_search"}]` ([explain line 508](/home/greg/code/spideryarn2/src/explain.ts:508)).

But Search currently deliberately supplies no tools ([search line 600](/home/greg/code/spideryarn2/src/search.ts:600)), has shorter web-incompatible timeout/stall limits, returns no citations or search count, and its strict streamed JSON path ignores annotation metadata. A literature check without source links is uncheckable and violates the plan’s own provenance rule.

Do instead: treat literature lookup as a distinct result shape carrying citations, search count, cost and date. Reuse Explain’s citation collector and longer clocks. Test cancellation and persistence during the silent tool-search interval.

11. **Medium — the cut list is partly wrong**

- **Candidate reviewers:** the cut is correct. It serves editors, requires a scholarly identity graph and serious conflict-of-interest handling, and cannot responsibly be “Stage 6.” The safer future feature is idea #32, Reviewer-Fit Brief, which describes needed expertise without naming people.
- **Number Hound:** wrong cut. It is more checkable, more distinctive from existing Search, and better supported by deployed tool precedent than Claims. It is my preferred replacement if the mode needs a model-facing third surface.
- **Rank Before Reveal:** wrong to defer if Claims or valence ranking ships. It is a required sequencing safeguard, not optional polish.
- **Injection Alarm:** wrongly omitted from the appendix and the stages despite being labelled prerequisite in the research.
- **Basic JSON/CSV export:** probably belongs in v1 even if a general Export mode comes later. It involves no AI and gives the reviewer’s notes somewhere useful to go; it is not a report-drafting feature.
- **Sealed Second Opinion, cited-paper ingestion, report drafting and referee summaries:** correctly cut.

12. **Medium — `?referee=` is fine; the accessibility rationale is not**

A URL parameter is appropriate because the sub-mode materially changes the visible surface, and Diagram establishes that precedent ([params line 809](/home/greg/code/spideryarn2/src/web/params.ts:809)). It should specify its default, invalid-value fallback and history policy.

The plan’s claim that Diagram establishes “plain buttons, not an ARIA radiogroup” is inaccurate. Diagram still uses `role="radiogroup"` and `role="radio"` while making each button a tab stop and deliberately withholding arrow-key selection ([DiagramPanel line 1331](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:1331)). Referee should follow whichever current convention the project chooses, with a test that article arrows remain untouched. Do not cite Diagram as precedent for markup it does not use.

## What breaks first, and what staging lacks

The first deterministic code failure is valence crossing the Search boundary: if it reuses `confidence`, every negative value is clamped to zero; if it adds a new field, the existing panel and marks ignore it. The first operational failure is web-enabled criteria hitting Search’s shorter clocks or finishing without persisted citations. The first product failure is reviewers treating Claims’ empty rows as established unsupported claims.

Before Stage 1, the plan needs:

- a pre-ingest confidentiality gate and public/consented-document scope;
- an identity-stripped prompt renderer and injection test corpus;
- a human-first prototype tested with real reviewers before schema work;
- an explicit data-model/migration stage;
- evals measuring false “not found” claims, abstention, grounding and valence-unit failures;
- cancellation, retry, parallel-tab, freshness, cost and web-citation tests;
- colour-vision simulation, narrow-screen, keyboard and screen-reader passes;
- docs updated during each stage, not deferred to Stage 5.

The existing “tests green after each stage” and cross-family reviews are sound.

**If I could make only one change:** move the confidentiality decision to ingestion, before any manuscript bytes reach OpenRouter, and limit Referee mode explicitly to public or consented documents. Without that, the mode’s first act is to warn about something the application has already done.