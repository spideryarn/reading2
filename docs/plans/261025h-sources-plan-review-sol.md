I would not approve the plan as written. The product direction matches Greg’s answer, but the implementation plan has several P1 contract failures. I found no P0s.

## Findings

### F1 — P1 — Changing the parser default breaks old addresses

The claim that every old address keeps working without translation is false.

Evidence: the plan changes the owner default to `where` at `docs/plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md:125-130`. Today, absence of `sources=` explicitly means Bibliography (`src/web/params.ts:1477-1490,1522-1527`). Legacy Citations and Peer review URLs are translated to bare `?mode=sources` (`src/web/router.ts:1475-1503`). Those URLs—and bare Sources bookmarks—would silently change meaning.

Suggested plan change: keep Bibliography as the URL-parser default, but have new Sources entry points write `sources=where` explicitly. Test bare Sources, legacy Citations/Peer review, pasted links, Back/Forward, and last-view restoration.

### F2 — P1 — Tool URLs leave the radiogroup with no selected chip

Evidence: the plan keeps raw `reception|claims|not-cited|investigate` values while rendering only three chips (`plan:86-90,123-132`). `SourcesViews` currently uses the raw view for `useRevealChosen`, `aria-checked`, and the `.on` class (`src/web/modes/sources/SourcesMode.tsx:497-545`). None of the three buttons would be checked on a tool URL.

Suggested plan change: define one exhaustive `chipView(rawView)` mapping all four tools to `where`, and use it everywhere the visible selection matters. Split `SourcesAddressView`, `SOURCES_PRIMARY_VIEWS`, and tool views rather than making one vocabulary mean URLs, chips, and command rows. Test exactly one checked radio for every legal URL value.

### F3 — P1 — Visitor Where has no data source for its promised lists

Evidence: the plan says three chips are for every reader, but gives visitors Where only when Reception or Claims exists (`plan:32-38,125-130`). The visitor band deliberately mounts no owner hook, job, or search (`src/web/modes/sources/SourcesMode.tsx:322-330`; `src/web/visitor.ts:320-346`). `PublicReception` contains no citer list (`src/public-types.ts:889-924`), and a claims-only public article need not have Bibliography either.

Suggested plan change: either keep Where owner-only in this iteration, or add a sanitized public projection of cached citer rows and a separate `VisitorWhereItSitsPanel` that performs no fetch. Gate the chip on the data actually projected. Test bibliography-only, reception-only, claims-only, and mixed public payloads.

### F4 — P1 — `activationForSources("where") = null` can leave Before permanently empty

Evidence: the plan promises a Bibliography-derived Before list but arms nothing on Where (`plan:43-49,115-130`). The mode contract says opening an unmade artefact mode or sub-mode starts it (`docs/project/mode.md:136-154`). Bibliography is not guaranteed to have run: Rebuild, Start again, minimal papers, re-adds, and disabled automatic modes are exceptions (`docs/project/ingest-queue.md:625-647`). Today Bibliography explicitly arms its job (`src/web/activation.ts:609-629`).

Suggested plan change: make Where arm Bibliography and mount its hook while Where is visible. The alternative is to document an explicit activation-contract exception and a durable missing-Bibliography state, but that is less useful and more complicated.

### F5 — P1 — Reception is not retired by removing its chip

Evidence: Reception activation is shared by chips, command-bar rows, and mode re-entry (`src/web/activation.ts:587-635,720-773`; `src/web/Dock.tsx:393-400,2061-2072`). Reception also has its own initial Search and stale-rerun buttons (`src/web/ReceptionAndClaimsPanel.tsx:1406-1433,1564-1574,1591-1611`) and remains a Metadata/command rerun step (`src/rerun-steps.ts:107-131`; `src/web/CommandBar.tsx:744-752`).

Suggested plan change: decide whether generation is genuinely retired. If yes, make `activationForSources("reception")` return null, remove its empty/stale run controls, and remove Reception from Metadata and command reruns while preserving stored-row reading. If forced reruns remain, narrow the claim to “the chip is retired.”

### F6 — P1 — Moving the dossier leaves its destinations and chat provenance behind

Evidence: marginalia opens a dossier finding at `sources=investigate` (`src/web/reader/Reader.tsx:1902-1920`); finding focus belongs only to Investigate (`src/web/item-focus.ts:195-220`; `SourcesMode.tsx:232-247`); and dossier chat uses the same `reception` lens origin as Investigate questions (`src/web/SituateDossier.tsx:251-264`; `Reader.tsx:1138-1151`). That origin is labelled and routed back to Sources › Investigate (`src/web/thread-source.ts:61-77,155-168,303-314`; `Reader.tsx:1977-1993`). The job’s destination also names Investigate (`src/web/step-names.ts:92-94`).

Suggested plan change: move finding focus and marginalia destinations to Where, update the step destination, and give dossier findings a distinct origin whose label and Back action target Where. Test both “Open in Sources” and Ask-in-chat return navigation.

### F7 — P1 — Promotion requires more than removing the switch gate

Evidence: the plan says `SituateDossier` remains unchanged (`plan:123-132`), but it visibly labels itself Experimental (`src/web/SituateDossier.tsx:150-159`). Investigate’s explanatory copy says the same (`src/web/InvestigatePanel.tsx:375-381`). The privacy page calls it an experimental feature in Investigate (`src/web/PrivacyPage.tsx:504-517`), pinned verbatim in `tests/privacy-page.test.ts:214-222`; the experimental registry says its hook is absent with the switch off (`docs/project/experimental-features.md:519-526`).

The same privacy change must also update OpenAlex’s timing: the current promise says OpenAlex is contacted when Reception is opened (`PrivacyPage.tsx:475-483`; `tests/privacy-page.test.ts:322-356`), not when Sources/Where opens.

Suggested plan change: add an explicit promotion checklist: remove the gate and badge; rewrite Investigate copy; remove the experimental registry entry; update Sources, `/privacy`, `LAST_UPDATED`, and pinned tests; change the OpenAlex timing disclosure in the same commit that first enables the automatic citer fetch; and test an owner with the switch off.

### F8 — P1 — The code-written Reception query still needs S3 validation

Evidence: the plan says no S3 defence is needed because the query is code-built from metadata (`plan:76-78`). But title and author metadata originate in the stranger’s article. The trial explicitly records that address stripping exists to stop a page steering a search (`docs/investigations/261025a-sources-trial-situate-reception-cited-by-on-six-articles.md:170-174`). The security map treats article content as untrusted (`docs/project/security-map.md:9-20`), and `validateQueries` removes addresses before anything leaves (`src/situate.ts:283-345`).

Suggested plan change: reserve one planner slot for this query and run the code-built query through the same normalization, length, control-character, address, and duplicate checks. Add a hostile title containing a URL, email, `site:`, control characters, and an overlong string.

### F9 — P1 — Twin-record counts are knowingly inexact, and the dossier still assumes one target

Evidence: the plan proposes summing counts minus overlap in the returned pages (`plan:58-62`). That cannot account for overlap outside the fetched page. The current identity and cache shapes hold one target (`src/citation-index.ts:459-487,590-632`; `src/store/pg-citation-index.ts:35-58,74-145`), and `situateCiters` fetches abstracts for exactly one confirmed target (`src/situate-citers.ts:81-110`). Thus the free list can be “fixed” while the dossier still misses the second record.

The existing spike already uses OpenAlex’s union filter, `cites:W1|W2`, which returns one union count and list (`scripts/spikes/261025a-topic-citers.py:36-54`).

Suggested plan change: represent a confirmed work as one or more OpenAlex IDs and use one OR query for both the count and rows. Carry that identity through `confirmedWorkOf`, `citersOf`, `situateCiters`, and cache provenance. Avoid displaying an approximate sum as an exact count.

### F10 — P1 — The editions rule classifies unrelated same-author books as reprints

Evidence: the plan treats a same-author book or chapter with a nonmatching title as an edition (`plan:63-67`). Greg chose grouping translations and reprints, not grouping any book-shaped work by the same authors (`docs/user-feedback/questions/q-vg2b69.md:16-19,37-39`). Current self-identification requires an identifier or matching title plus author/year evidence (`src/related-work.ts:604-619`).

Suggested plan change: require title-version evidence, an identifier relationship, or another explicit reprint signal. Put ambiguous same-author books in the ordinary related-work list, or under a neutral label such as “Other works by these authors,” never “Other editions of this piece.”

### F11 — P1 — The eval can select unsupported prose as the winner

Evidence: the planned automatic score relies on `checkFindings` and kept/dropped counts (`plan:145-149`). That checker proves article and source quotations exist, not that the source entails the model’s note (`src/situate.ts:881-949`). In the previous real run, all findings passed while two notes named unsupported additional works and two temporal kinds were wrong (`docs/investigations/261024b-situate-spike-searches-into-one-read-cost-and-quality.md:94-116`).

Suggested plan change: score each finding for source entailment, correct kind/date, directness, and novelty, showing the judge the article passage and full relevant source extract. Treat materially unsupported prose as a veto metric. Score dossier coverage separately; kept/dropped counts are diagnostics, not quality.

### F12 — P1 — Predict introduces reader data without a persistence decision

Evidence: the experiment asks the reader to write a guess (`plan:156-158`). The product principle is that anything typed or chosen is retained rather than silently discarded (`docs/project/vision.md:121-125`). The plan names no storage, export, deletion, privacy, or public-projection behavior.

Suggested plan change: either make this a no-input “pause, predict mentally, then reveal” interaction, or specify persistence, export, deletion, and visibility. The no-input version gets most of the learning value with almost no implementation surface.

### F13 — P1 — Hostile referee crosses the Sources/Referee boundary and is not literature-grounded

Evidence: it asks a model to invent expert objections from the article (`plan:161-163`). Sources is contractually outward-facing—what others wrote—while Referee owns what must be judged; Sources never points back (`docs/project/referee-mode.md:326-343`). “Anchored to a passage” also needs the explicit house `{blockId, quote}` contract and code re-find (`docs/project/block-ids.md:5-7`; `src/types.ts:8472-8486`).

Suggested plan change: drop it or move it to Referee. A Sources-compatible version would show the strongest counterarguments already present in stored dossier sources. If retained anywhere, specify block-ID validation, storage/export/deletion, model provenance, an exact allowance and global fuse.

### F14 — P2 — The cost ladder understates the current rollout

Evidence: the plan says approximately $0.10–0.40 (`plan:43-54`), while the six-article trial measured $0.26–0.48, mean $0.33 (`docs/investigations/261025a-sources-trial-situate-reception-cited-by-on-six-articles.md:108-121`). The current allowance was sized from $0.36–0.52 and also has a 100-runs/day global fuse (`src/situate.ts:181-198`). Stage 3 exposes the press to every owner while Stage 4 runs in parallel.

This is not incorrect charging: reruns do not consume reader slots and subscriptions are fixed (`docs/project/billing.md:581-591`). It is an operational-spend and rollout issue.

Suggested plan change: state the measured range, global cap, and free/lapsed-owner exposure. Either run the eval before broad promotion or explicitly accept the current Sonnet cost before doing so.

### F15 — P2 — The automatic keyword threshold is based on too little evidence

Evidence: the rule was tried on four pieces. It improved the two classics, lost the best two results on the 196-citer paper, misses synonyms and papers without abstracts, and no dossier finding used a citer abstract (`docs/investigations/261025a-sources-trial-situate-reception-cited-by-on-six-articles.md:150-169`). “About a thousand” is therefore a plausible heuristic, not a validated boundary.

Suggested plan change: initially show unfiltered citers, or present “Most cited” and “About this topic” as honestly labelled alternatives. If automatic filtering remains, treat the threshold as an experiment and cache the work keyword separately from the citer result.

### F16 — P2 — The planner comparison does not test retrieval quality

Evidence: Stage 4 buys one fixed evidence set but scores planners only on the queries they write (`plan:136-147`). Plausible-looking queries can still miss the most valuable result—the current planner missed *Rock is Strong* (`docs/investigations/261025a-sources-trial-situate-reception-cited-by-on-six-articles.md:90-96,184-193`).

Suggested plan change: run both planners’ validated queries in a matched time window, measure unique relevant evidence and known-target recall, then give each evidence set to the same reader model. Keep the fixed-evidence A/B comparison separately to isolate reader quality.

### F17 — P2 — The reader arms and adoption seam are not controlled

Evidence: C and D add a triage model, so they do not isolate Haiku’s ability to read. D has no full-evidence Opus baseline. The measured cost bottleneck is evidence length, while shorter clipping remains untested (`docs/investigations/261024b-situate-spike-searches-into-one-read-cost-and-quality.md:41-43,77-78`). Haiku also becomes 2.5–5× dearer than Luna above 100k tokens and tokenizes this text more heavily (`docs/investigations/261009a-haiku-5-5-and-an-opus-digest-for-cheaper-models.md:108-129`).

“Adopt in `models.ts` / `situate.ts`” is insufficient: both phases currently share one capable-tier power and one generator stamp (`src/models.ts:1294-1314,1461-1466`; `src/situate.ts:1084-1100,1132-1249`), while freshness compares a single generator to `CAPABLE_MODEL` (`src/situate.ts:234-237`). Stage 4 also claims to score checks introduced in parallel Stage 1.

Suggested plan change: make the eval depend on Stage 1’s committed checker and pin its commit/prompt. Add a deterministic-compression arm first: shorter extracts, fewer results, exact deduplication, or a fixed evidence-token cap. Run D only if triage proves useful. Define repetitions, cold-cost accounting, non-inferiority and critical-error thresholds, and explicit per-phase model/provenance work before adopting a mixed pipeline.

### F18 — P2 — Lineage overclaims chronology and mostly redraws Stage 2

Evidence: its inputs prove only “the piece cites this” and “this later work cites the piece” (`plan:159-160`). They do not prove intellectual lineage or influence. The investigation explicitly calls keyword filtering a route into debate rather than evidence of importance or relationship (`docs/investigations/261025a-sources-trial-situate-reception-cited-by-on-six-articles.md:163-169`).

Suggested plan change: rename it “Before and after” or “Citation timeline” and label the actual edge types. Drop it if the screenshot is merely the two lists resorted.

## Simpler plan I would approve

1. Fix identity and finding checks first: OpenAlex union queries for twins, strict edition evidence, `situate/2`.
2. Build owner-only Where initially. Preserve Bibliography as the parser default; new Sources presses write `sources=where`; Where arms Bibliography.
3. Use unfiltered citers first, with topic filtering labelled or experimental.
4. Move the dossier only after updating every focus, origin, privacy, experimental, activation, and Reception-rerun seam.
5. Run the eval after the checker lands. Compare Sonnet/Haiku on identical evidence, compare planners end-to-end, and try deterministic evidence reduction before model triage.
6. Ship two free experiments: Predict as a mental reveal, and “Read the evidence first”—show the article passage and checked source quotation with the AI note hidden, let the reader classify the relationship mentally, then reveal the model’s interpretation.

That last experiment is stronger than Hostile referee: it costs nothing, stays grounded in literature, and makes the reader perform the central intellectual step rather than outsourcing it.

No files were changed; tests were not run because this was a read-only plan review.