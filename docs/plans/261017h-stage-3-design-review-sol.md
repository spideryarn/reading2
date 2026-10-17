No P0 findings. I found six P1s and four P2s.

Normal publication coverage is sound: import auto-mode, Metadata/“Find them again,” command/API, MCP, and CLI Bibliography jobs all converge on pipeline publication. A `citation-blurbs` successor cannot trigger itself, and ordinary duplicate queueing is deduplicated. The exceptions are G3 and G7.

## Findings

**G1 — P1 — The proposed artefact cannot reproduce its step stamp.**  
[design:35](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-stage-3-design-citation-blurbs.md:35), [design:69](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-stage-3-design-citation-blurbs.md:69), [artifacts.ts:1072](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/store/artifacts.ts:1072), [artifacts-pg.ts:787](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/store/artifacts-pg.ts:787)

The artefact is specified with root fields `version` and `model`, but no `sourceHash`. The shared stamp reader recognises `sourceHash`, `version`/`promptVersion`, and `generator`; it never reads `model`. The Postgres run row checks the artefact but cannot fill its missing fields.

Concrete failure: a completely successful run records neither its expected `inputHash` nor model, so every later unforced job considers it stale and runs it again.

Use the established root shape—`sourceHash`, `version`, `generator`—or explicitly design and test a new parser. Add an actual run-twice test, not only a unit test of the step.

**G2 — P1 — The promised transient retry cannot work through the whole-artefact freshness check.**  
[design:53](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-stage-3-design-citation-blurbs.md:53), [design:81](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-stage-3-design-citation-blurbs.md:81), [pipeline.ts:1173](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/pipeline.ts:1173), [jobs.ts:1425](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/jobs.ts:1425)

The design omits transient entries but writes the same current root stamp. `stepIsDone` sees a present artefact with a matching stamp and skips before per-entry reuse/retry runs.

Concrete failure: 30 works succeed and 10 hit a cooldown. The next unforced run skips the whole step, leaving those 10 absent forever. Separately, `repeated-index`, `too-long`, and quote-check failures are stored as terminal even though they are failures of one model answer, not facts about the work.

Design an explicit retry boundary. For example: retry failed checks once within the run; keep retryable state with attempts/`retryAfter`; and make a later job—not the same claim—see the artefact as retryable. Test two real jobs, including a partial first result, to prove it neither skips forever nor spins forever.

**G3 — P1 — Deduplication can absorb the successor into a job that cannot publish over the new Bibliography.**  
[design:45](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-stage-3-design-citation-blurbs.md:45), [pg-successor.ts:43](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/store/pg-successor.ts:43), [pg-successor.ts:237](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/store/pg-successor.ts:237)

`enqueueSuccessorIn` can return `boundToOlderBase`: an identical active successor already owns a draft based on the preceding revision and can never publish over the just-published one.

Concrete failure: blurbs for Bibliography A are requeued with a draft; Bibliography B then publishes. B’s successor collapses onto A’s job, A later fails the lineage check, and no job exists for B.

Scope this successor to the publishing Bibliography job/revision, or enqueue a scoped replacement on `boundToOlderBase`. Add that outcome to the publication result/logging and test it explicitly; “queues exactly one” does not cover it.

**G4 — P1 — The quote check is not a faithfulness or prompt-injection boundary.**  
[design:126](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-stage-3-design-citation-blurbs.md:126), [design:132](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-stage-3-design-citation-blurbs.md:132), [investigation:137](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/investigations/261017c-citation-blurbs-cost-and-quality.md:137), [spike:475](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/evals/citation-blurbs-spike.ts:475)

The spike’s quote check rejected 0 of 75 abstract blurbs. It admits a supported quotation beside an unsupported second sentence, and admitted the inverted Searle account. Four normalised words can also be a generic phrase from another item. Random indices do not stop injection because every index is visible in the prompt; a hostile abstract can request valid output for all of them.

Concrete failure: one abstract instructs the model to write a claim for another visible index and supplies a common phrase from that work as its quote. The structure and quote checks both pass.

Cheap additions worth taking:

- Require one support quote per sentence, 6–30 words as the prompt already says.
- Prefer one sentence unless two separately supported sentences add real value.
- Run a separate cheap entailment/refusal pass over each sentence and its own evidence; the generation cost is low enough that doubling it should remain under the cost gate, but remeasure.
- Add adversarial abstracts and the Searle inversion to the production eval.
- Keep the OpenAlex book/book-chapter refusal, but do not treat it as a general inversion defence.

**G5 — P1 — The visitor path described in the design cannot receive the separate artefact.**  
[design:159](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-stage-3-design-citation-blurbs.md:159), [public-reader.ts:329](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/store/public-reader.ts:329), [public-reader.ts:1011](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/store/public-reader.ts:1011), [dto.ts:1284](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/public/dto.ts:1284)

Visitors do not call `loadBibliography`; their article query selects the revision columns directly and passes them to `publicArticle`. Changing `src/store/pg.ts` and `publicCitedWork` therefore affects only owners unless the public projection also selects and attaches `citation_blurbs`.

Concrete failure: the owner sees every blurb, while a shared article silently shows none, despite the design and tests claiming otherwise.

Add `src/store/public-reader.ts` and `src/public-types.ts` to 3c, attach against the unmodified stored Bibliography inside the DTO boundary, and test the real public query as well as the pure DTO.

**G6 — P1 — The design overclaims that its unpublished-work privacy leak is closed.**  
[design:165](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-stage-3-design-citation-blurbs.md:165), [design:170](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-stage-3-design-citation-blurbs.md:170), [privacy.md:675](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/project/privacy.md:675)

A lexical skip for “unpublished / in preparation / under review…” cannot establish publication. Confidential references routinely have ordinary titles without those phrases.

Concrete failure: a private referee manuscript cites its authors’ unpublished “A Unified Account of X.” The row has no identifier and no status phrase, so Crossref receives its title and author surname automatically.

For v1, either disable title search for private uploads, require an article-supplied public identifier/address, or make this an explicit accepted privacy risk rather than claiming code closes it. Exact-identifier lookups do not create this new ambiguity.

**G7 — P2 — Import, MCP, and CLI coverage means “queued,” not “made.”**  
[design:48](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-stage-3-design-citation-blurbs.md:48), [pg-successor.ts:105](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/store/pg-successor.ts:105), [jobs.ts:2228](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/jobs.ts:2228), [stage.ts:212](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/scripts/stage.ts:212), [mcp/tools.ts:497](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/mcp/tools.ts:497)

Successors are not server-driven in production. The CLI drives only its parent job, and MCP’s status tool only reads.

Concrete failure: MCP or CLI makes a Bibliography and exits; no owner opens Spideryarn afterward. The blurb job remains queued indefinitely, and public visitors cannot drive it.

This is acceptable only as a stated product limitation. Say “queued whenever Bibliography publishes; runs when the owner next has the app open,” and test queueing separately from execution. Otherwise it requires a server-side driver.

**G8 — P2 — Identity matching handles changed titles, but lacks a safety-version escape hatch.**  
[design:38](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-stage-3-design-citation-blurbs.md:38), [design:85](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-stage-3-design-citation-blurbs.md:85), [bibliography.ts:1564](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/bibliography.ts:1564), [citation-lookup.ts:155](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/citation-lookup.ts:155)

Including title, authors, year, URL, and link provenance means a reused entry ID or changed title does not itself misattach a blurb. That part is sound.

The unsafe part is ignoring every validation/prompt version at attachment. If version 1 is later found to permit inversions or injection, bumping the guard leaves all version-1 blurbs visible—including publicly—until somebody forces a rerun.

Add a dedicated `validationVersion` to the attachment fingerprint. Harmless wording/model changes may retain old blurbs; safety-boundary changes must be able to detach them. Existing citation lookups already include their version in the read-time context hash.

**G9 — P2 — Dynamic negative registry answers are cached as permanent facts.**  
[design:71](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-stage-3-design-citation-blurbs.md:71), [bibliographic.ts:144](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/bibliographic.ts:144)

`not-found`, `no-abstract`, `not-identified`, and `conflict` can change, but the stored `no-evidence` entry has no expiry. This bypasses the existing seven-day miss and 180-day found-record freshness policies.

Concrete failure: Crossref adds an abstract next week; “Find them again” publishes the same citation identity, and the blurb step reuses its permanent `no-abstract` result without asking Crossref.

Keep structural negatives terminal (`label-only`, explicitly unpublished, no usable identity), but give registry negatives a `checkedAt`/TTL. Likewise, treat persistent 401 configuration failure differently from a quota-resetting 403/429 circuit breaker.

**G10 — P2 — Two parts of the strict Crossref rule remain underspecified.**  
[design:110](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-stage-3-design-citation-blurbs.md:110), [spike:209](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/evals/citation-blurbs-spike.ts:209)

“Book-type record” needs an explicit Crossref type allowlist, and “first author agrees” must compare only Crossref’s first author—not any surname in its author list, as the spike did.

Concrete failure: a book’s author appears second on a same-titled review or chapter; an `authors.some(...)` implementation accepts it, despite the intended first-author rule.

Enumerate accepted book types, state whether `book-chapter` is always refused, and add tests for second-author-only agreement and every accepted/rejected type.

## Simpler high-value version

Automatically handle exact DOI/arXiv identities only, with DataCite/Crossref and OpenAlex-by-DOI; allow title search only for public articles or on an owner’s explicit press. The investigation estimates this still covers roughly 54–56% of the reported paper and about 76% of the coding paper, while removing the riskiest identity and private-title flow. A one-sentence blurb plus a separate cheap support check would also make the runtime boundary much easier to defend.

proceed with changes