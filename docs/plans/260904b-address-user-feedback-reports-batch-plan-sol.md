The plan should not be built unchanged. The `KIND_UI` overlap is not a real dependency; the expensive dependencies are glossary persistence, Illustrated steering provenance, and a second paid-provider seam.

1. **Blocker: Stage 6 contradicts the glossary’s storage contract and can publish private reader state.**

   The schema explicitly says the glossary is a wholesale JSON document, and that the moment a reader edits it, it must become a table and entry IDs become a durable contract ([schema.ts:691](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/db/schema.ts:691)). The plan instead proposes appending a reader-created entry to that JSONB document ([plan:102](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/docs/plans/260904b-address-user-feedback-reports-batch.md:102)).

   That creates two late-discovery failures:

   - A later “Find more terms” regeneration can overwrite or merge away the reader’s entry because generated entries are recomputed wholesale.
   - Public reading fetches that whole glossary JSONB ([public-reader.ts:252](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/store/public-reader.ts:252)). Only `lookup` is deliberately removed from the public DTO ([public-types.ts:228](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/public-types.ts:228)); an appended entry itself would be published with an already-shared article.

   Do instead: for the beta, ship only “find this term in the piece” plus a Chat handoff on failure. Defer persistent addition. If persistence is required now, make it a separate stage with an additive `reader_glossary_entries` table keyed by owner/article/revision and merge it only into the owner response.

   The new endpoint must, server-side:

   - authenticate and assert article ownership;
   - accept only a trimmed, NFC-normalised, bounded term—about the existing 80-character vocabulary limit—and reject controls/extra fields;
   - resolve the occurrence itself using the shared matcher; never accept a client block ID, offset, definition, aliases, provenance, or owner;
   - store a real current block ID plus a verified literal quote/surface form;
   - guard the revision read/write race;
   - mint the ID server-side and deduplicate concurrent/double-click requests;
   - filter model URLs as the existing lookup does ([term-lookup.ts:181](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/term-lookup.ts:181));
   - keep the entry private in the public projection and keep prose/terms out of logs.

2. **Blocker: Illustrated steering is not a “three-line mic” change; its durable input path is missing.**

   The generic job API currently ignores legacy `guidance` intentionally ([routes.ts:4451](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/routes.ts:4451)). `Job` no longer carries guidance, while it carries and freezes the profile specifically so restarts and deduplication cannot change an artefact’s inputs ([types.ts:2276](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/types.ts:2276)). `sameWork` also explicitly removed guidance ([jobs.ts:2997](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/jobs.ts:2997)).

   Meanwhile, Illustrated freshness is computed solely from the Sketch and fixed model settings ([illustrated.ts:197](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/illustrated.ts:197)); the pipeline stamp can currently reconstruct that from a slug ([pipeline.ts:3271](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/pipeline.ts:3271)).

   Passing transient UI text into one enqueue would therefore break:

   - retry after process restart;
   - job deduplication;
   - freshness computation;
   - the requirement that `npm run illustrated` remains runnable from a slug.

   Do instead: split Stage 5. Run the Nano evaluation first. Either defer the steering box, or explicitly design an article-scoped stored Illustrated instruction that the CLI can read, freeze it onto the job at enqueue, include it in `sameWork`, and fingerprint the exact frozen value. That likely entails a migration and privacy/public-projection decision.

3. **Major: direct Google image generation is a new owned paid seam, not merely “a second declared exception.”**

   The existing image call is deliberately inside the gateway so there is one key, one meter, and one `finally` that records failures as spend ([ai-call.ts:1276](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/ai-call.ts:1276)). It also validates decoded bytes, signatures, dimensions, and provider claims ([ai-call.ts:1439](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/ai-call.ts:1439)). The gateway’s actual rule is “owned seams or the realtime acceptance endpoint” ([ai-gateway.md:717](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/docs/project/ai-gateway.md:717)), and `ProviderAccount` has no Google arm ([ai-spend.ts:264](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/ai-spend.ts:264)).

   A raw production Google fetch would bypass that lifecycle and any OpenRouter account cap. It also falsifies the privacy page’s statements that OpenRouter carries every AI call but live voice, and Google is used only for sign-in ([PrivacyPage.tsx:212](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/web/PrivacyPage.tsx:212)).

   Do instead:

   - Keep the Nano spike in `evals/`, declared and metered there.
   - Prefer Nano through OpenRouter if available and adequate.
   - If direct Google wins, build a Google image seam with provider-account typing, pricing provenance, meter/finally behavior, timeout/abort, safe errors, output validation, credential fingerprinting, ledger tests, environment/health inventory, and privacy-page updates.

   On the product claim itself: Fable’s universal “image models cannot render words” was overgeneralised from one model; the plan is right to retest. But a positive spelling sample proves lettering ability, not sentence truth or placement. Keep the checked HTML legend and, for v1, allow only short titles supplied verbatim. Sentences need an OCR/exact-text acceptance gate or a deterministic HTML/SVG overlay.

4. **Major: the Diagram billing concern is real, but “every reader” and “owner only” are both imprecise.**

   Current behavior is:

   - A signed-out/shared visitor can open Diagram, but `DiagramAccess` pins them to free Force, disables the fetching hooks, and removes the picker ([diagram.md:1920](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/docs/project/diagram.md:1920), [DiagramPanel.tsx:541](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/web/DiagramPanel.tsx:541)).
   - The picker is owner-only in code ([DiagramPanel.tsx:1436](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/web/DiagramPanel.tsx:1436)). Here “owner” means the authenticated owner of that article, not Greg/admin.
   - A URL, mount, or Back navigation cannot auto-buy Sketch: only a chip gesture arms the expensive auto-run ([DiagramPanel.tsx:1504](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/web/DiagramPanel.tsx:1504)).
   - Experimental status is only control visibility; the server does not enforce it ([experimental-features.md:37](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/docs/project/experimental-features.md:37), [experimental-features.md:155](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/docs/project/experimental-features.md:155)).

   What prevents an article owner running up a bill? No cumulative mechanism in this repo. Pipeline re-runs explicitly consume no billing slot ([billing.md:568](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/docs/project/billing.md:568)); the global concurrency limit of three only slows spend, and the docs explicitly say there is no spend cap ([jobs.ts:366](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/jobs.ts:366)). The only broader safety net mentioned is the provider-account cap outside the repo.

   So the assumption is currently true only as “article owner only.” Stage 4 changes discoverability, not authority. Rewrite it as:

   > Every article owner may explicitly start unlimited paid Sketch reruns; shared visitors remain Force-only; entering Diagram or following a URL buys nothing; there is no in-repo per-owner or cumulative spend cap.

   Then Greg can accept that consciously or require a daily paid-attempt cap. The simplest safe UI is to enter the default Sketch view cheaply and require the existing explicit price-labelled Draw action.

   Also update the stale security map: it still says Diagram is unconditionally owner-only and all pictures POST ([security-map.md:134](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/docs/project/security-map.md:134)), contradicting the current visitor code.

5. **The riskiest single reader-visible change is -10, external-link reveal-then-open.**

   This exact touch machinery previously failed on every real touch device while 24 synthetic-event tests stayed green, because `pointerup` generates the leave events that closed the card ([touch.md:85](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/docs/project/touch.md:85)). That is unusually strong evidence that tests alone will miss this class again.

   There is also an unresolved product collision: 13% of article links contain glossary terms, and the existing composed-card rule gives the term priority; its second tap opens Glossary, not the link ([links.md:52](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/docs/project/links.md:52), [ProseHoverCard.tsx:227](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/web/ProseHoverCard.tsx:227)). “Second tap opens the tab” silently reverses that rule unless the plan decides the combined case.

   Do instead: make -10/-14 their own stage and require a real iPad browser pass. Pin first tap, second-same-link tap, second-different-link tap, scroll cancellation, term-inside-link, footnotes, keyboard activation, modified clicks, and exactly-one new tab with `noopener/noreferrer`. Keep -Z out of this stage; it shares no touch machinery.

6. **The dictation memo is partly right, but its diagnosis and certainty are wrong.**

   “We do not use Whisper” is correct: production uses `google/gemini-3.1-flash-lite` ([models.ts:321](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/models.ts:321)). Vocabulary is clearly high leverage.

   But “a model swap won’t fix it” exceeds the evidence. The shipped benchmark still measured 1.8–2.5% WER and 90–92% hard-term recall ([260903i:30](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/docs/plans/260903i-which-model-transcribes-dictation.md:30)); the perfect result was only 78 terms across seven adequately supplied synthetic clips ([260903i:172](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/docs/plans/260903i-which-model-transcribes-dictation.md:172)).

   More importantly, the actual code makes “vocabulary stopped assembling” a poor first hypothesis: `Spideryarn` is first in `SITE_TERMS`, every recipe begins with the infallible site source, and Feedback passes an article/profile context ([vocabulary-sources.ts:320](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/vocabulary-sources.ts:320), [FeedbackDialog.tsx:444](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/web/FeedbackDialog.tsx:444)). The in-flight diagnosis has already updated the dictation doc to say the whole chain was intact and the observed miss was model residue ([dictation.md:313](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/docs/project/dictation.md:313)).

   Do instead: answer -15 with “current evidence does not justify a swap,” not “a swap cannot help.” Use the report’s `build_commit` and actual audio/log evidence. A vocabulary-length warning is insufficient: a non-empty vocabulary can still omit site terms. Log safe source counts or a `siteTermsIncluded` boolean, never the words themselves.

7. **The “term must occur in the piece” claim is useful as a v1 constraint, but false as a definition of the existing glossary.**

   Existing behavior deliberately stores unmatched entries because an empty `blocks` list is a quality signal ([glossary.md:253](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/docs/project/glossary.md:253)). A canonical name also need not occur literally if an alias does. Only `senseHere` is article-only; `background` intentionally comes from model knowledge ([glossary.md:430](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/docs/project/glossary.md:430)).

   Requiring a verified occurrence is still the correct persistence rule because underline, navigation, and explanation need a real stable anchor. State that narrower reason.

   The proposed “nearest proper nouns” does not provide typo tolerance: the shared matcher only handles case, plural, and possessive variants ([glossary.md:258](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/docs/project/glossary.md:258)), while the requested term may be a lowercase concept. For the simpler v1, accept those existing normalisations and hand unmatched input to Chat. Defer “Did you mean…” until there is an actual candidate/ranking rule.

8. **The six-stage grouping should be loosened; file overlap is not dependency.**

   I would change it as follows:

   - Keep Stage 1, but treat -11 as diagnosis before change.
   - Let -S, -X, and -V finish as three independent commits/checkpoints. The unknown PDF should not hold two unrelated repaired bugs hostage.
   - Split -Z from Stage 3. It is pure layout; -10/-14 share the delicate prose-card touch state machine.
   - Run the Nano evaluation before committing to production provider work.
   - Diagram gating can land before or after that evaluation once the explicit spend assumption is accepted. Sharing `KIND_UI` is only sequential edit convenience, not a dependency.
   - Split Illustrated into evaluation, provider/fingerprint/input architecture, then UI.
   - Keep persistent glossary addition last—or defer it and ship search/Chat only.

   The hierarchy-default call itself is fine: automatic L1/L2, L1 when only one fits, and exact `?cols=` preservation belong in `fitView`. The corresponding current tests express precisely that contract ([layout.test.ts:64](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/tests/layout.test.ts:64)).

9. **The remaining small calls are sound.**

   - -16’s conditional guidance is appropriately small.
   - -14 and -V correctly require the actual specimen before styling/fixing.
   - -S’s verify-production-and-rerun posture is right.
   - Keeping the checked HTML legend under Illustrated is right.

Test grounding: `tests/doc-links.test.ts` passed all 14 tests. The normal Vitest invocation could not create this worktree’s read-only `.vite-temp`, so I reran the same file with an otherwise equivalent temporary config using `/tmp` for the cache. I also attempted `public-network-trace.test.tsx`; the minimal temporary config first lacked the repo’s `@` alias and, after adding it, did not complete within 30 seconds, so I have not counted that run as evidence.