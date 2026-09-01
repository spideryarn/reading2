# Devil's advocate review: reader-authored modes

> **Provenance.** GPT-5.6 Sol, high effort, 2026-08-31, reviewing
> [260831am-reader-authored-modes-generative-ui-fable-ideas.md](260831am-reader-authored-modes-generative-ui-fable-ideas.md)
> at Greg's request — *"GPT Sol (as a devil's advocate, emphasising simplicity, looking for
> problems)"*. It read the real code; its three central objections were each checked afterwards and
> hold. The conclusions are in
> [260831am-reader-authored-modes-generative-ui.md](260831am-reader-authored-modes-generative-ui.md).

## Verdict

Do not build an extensibility platform yet. The document has found a useful smaller idea—reusable, article-anchored “lenses”—and inflated it into a mode system, a component framework, a sandbox, a gallery, an eval platform, and a promotion pipeline. Most of that should not be built.

### 1. Is the premise sound?

Not as stated.

“I built three modes, therefore readers should build modes” confuses three questions:

1. Do readers have recurring questions the built-ins do not answer?
2. Can Greg add a polished mode cheaply?
3. Should arbitrary readers become software authors?

Only the first follows from the observation.

Spideryarn already has the cheap answer. Meaning Search accepts a reader-written criterion, returns anchored passages, saves the run, paints the prose and spine, streams results, and supports several searches at once. “Show every claim the author hedges” is already a semantic search. The implementation deliberately turns both literal and model searches into the same `Found[]` downstream ([search.md](../../docs/project/search.md), line 81). Chat can run the same matcher.

That captures perhaps 80% of the reader-authored-mode demand. It lacks custom fields and custom presentation, but those are exactly the expensive 20%.

The other real lesson is that Greg should be able to add a mode without rebuilding lifecycle, owner/visitor access, staleness, regeneration, marks, deep links, and empty states each time. That argues for a few narrower shared helpers. It does not argue for one universal runtime API.

Cheapest answer:

- Treat saved semantic searches as “lenses.”
- Add mode requests to Feedback.
- Use real requests to decide which lenses deserve hand-built modes.
- Extract shared code only after two shipped modes need the same behavior.

With roughly one user, the correct mode-authoring community is Greg plus the agents. Feature request → ordinary reviewed implementation is not merely a promotion path; it is currently the whole appropriate system.

### 2. The ModeDef DSL deletes what made the modes good

The document is right that all three modes produce lists with anchors. It is wrong that this makes them “three rows in a table.”

Ideas is not the proposed flat `{statement, stance, evidence, at}` record.

- The real distinction is `assumed | introduced`, not `assumed | introduced | contested`.
- An occurrence means different things by provenance. For introduced ideas it is where the article states the idea. For assumed ideas it is where the prose would stop making sense without it.
- Assumed ideas require both `whyYouNeedIt` and occurrence-level reasoning. A valid block id only proves that the passage exists; it does not prove the article assumes the idea. The panel carefully labels that as the model’s hypothesis ([ideas.md](../../docs/project/ideas.md), line 105).
- One idea has several occurrences, each with its own reasoning. ModeDef offers flat scalar fields.
- The analogy has explicit model provenance and a different visual treatment.
- Selection, deep links, highlighting, and previous/next navigation operate over the surviving resolved occurrences, not merely the stored ones.
- Reader profile changes what “assumed” means, so it participates in freshness.

Those are the feature. A grouped list with title, badge, and quote is only its silhouette.

Quotes conflicts even more directly with the proposed schema:

- The model deliberately does not return a block id. It returns words; the server finds their location. Giving the model both `quote` and `blockref` would restore a failure the real mode excludes.
- The stored quote is sliced from the article, not copied from the model ([quotes.ts](../../src/quotes.ts), line 392).
- The locator skips occurrences in blockquotes or wholly quoted inline speech. Verification proves that words appear in an article; it cannot prove who wrote them.
- Length limits, overlapping-span deduplication, article order, and drop counts are enforced.
- Ranking has two independent judgments combined by `max`, four orders, missing-score semantics, and a slider whose stops are the scores that actually exist.
- The reason is a separate accessible, touch-pinnable tooltip. The model’s commentary stays out of the scannable list.
- The reader is told when suggestions were discarded because they were not verbatim or were in another voice.

A generic `number` field, `meter` slot, and `order.by` cannot reproduce that without adding quote-specific operators until the DSL contains QuotesPanel in encoded form.

Timeline breaks the claim completely:

- The model is never trusted to produce the displayed date. It copies temporal words; an 839-line deterministic parser reads dates from the article ([timeline-time.ts](../../src/timeline-time.ts), line 651).
- Dates are intervals with open bounds, extent, publication-year filling, and article-owned source spans.
- There are four distinct states: dated, temporal words that cannot be resolved, genuinely untimed, and rejected.
- The model’s narrative order is retained. Greg explicitly rejected sorting by date. The proposed axis is therefore not the shipped design.
- Labels are checked for uncited dates.
- Predictions, hypotheticals, and narrated events have different semantics.
- Date contradictions are counted without silently changing the order.
- Fewer than three events withdraws the “chronology” claim. An honestly empty timeline offers no retry.

Calling this a `timepoint` field “with real parse semantics” hides nearly the whole implementation behind four words.

Does the loss matter? For an informal reader-created lens, no: an anchored list of “possible hedges” can be useful while remaining modest. For replacing Ideas, Quotes, or Timeline, yes. Their special handling is what makes their confident-looking output honest.

### 3. The generality trap

The honest cost is a major rewrite with little reader value.

The seven core stage/parser/panel files for these three modes total 6,648 lines. Their directly related tests add more than 5,000 lines. That does not mean every line is irreducible. It does show that the proposed “approximately 200-line schema” is pricing only the nouns and ignoring the behavior.

A real `ModeContext` migration would touch:

- Global selection and mark state in App.
- URL parameters and deep-link restoration.
- Owner versus visitor projections and cost gates.
- Per-mode job lifecycle and regeneration.
- Stale, outdated, profile-changed, and built-but-empty states.
- Prompt stamps, models, effort, caching, and source fingerprints.
- Public DTO allowlists.
- Touch, keyboard, accessibility, scrolling, and narrow-band layout.
- Mode-specific storage and id inheritance.

What gets worse is not merely code elegance. Readers lose exact empty-state behavior, useful controls disappear because they do not fit generic slots, provenance becomes a badge, and specialised interactions become a collection of exceptions.

“The built-ins become the API’s test suite” is mostly a rationalisation. It proves that an API designed around ten known consumers can accommodate those consumers after enough bending. It does not prove that the API is safe, stable, understandable, or sufficient for unknown authors.

There is a real smaller benefit: built-ins should share narrow seams such as anchored-occurrence validation, block navigation, job progress, staleness banners, and mark resolution. They already do some of this. Keep extracting those seams. Do not make the core product consume its own speculative plugin API.

### 4. Security, cost, and operations

Prompt injection is not a v1 blocker if the output is a capped, server-validated list with no tools. The article is already hostile model input. A reader’s instruction is simply a more direct hostile input. Keep fixed instructions in the system message; put the lens instruction in a delimited user message. Never interpolate it into the system prompt. Cap its length, rows, output tokens, retries, and per-row text.

The wallet problem becomes real with the first non-Greg reader, not at some distant scale. The app has accounting but explicitly has no spend limit ([ai-gateway.md](../../docs/project/ai-gateway.md), line 292). Do not publish gallery modes that strangers can run until calls have owner attribution, reservation-based quotas, and a clear rule about who pays.

Sandboxed generated code is a blocker for tier (c) at any user count. Typechecking and linting are not a sandbox. An iframe or worker requires compilation, CSP and origin decisions, message validation, CPU and memory limits, call quotas, versioning, crash handling, and a defence against message floods. If code can only ask the host to render kit components, it is an imperative DSL with a much larger attack surface. Do not build it.

Per-reader KV is not a security blocker with one user. It is still a bad v1 primitive. It creates an untyped second database inside Postgres, plus size limits, races, cleanup, quotas, migrations, and privacy questions.

Cross-reader cache reuse is wrong by default. The existing checkpoint design deliberately scopes reuse to an article because a cache hit itself can disclose information ([schema.ts](../../src/db/schema.ts), line 2140). A lens cache must include article identity, owner, article revision, definition version, fixed prompt version, model, profile, and relevant settings. Cross-owner reuse can be considered later for explicitly public articles. “One popular mode × article costs one call ever” should be deleted.

### 5. What v1 should actually be

First, run the experiment with no implementation:

- Use Meaning Search for ten candidate lenses across ten to twenty varied articles.
- Include hedges, unsupported claims, counterarguments, methodological weaknesses, definitions, and cited evidence.
- Record which prompts recur, which need fields rather than passages, and which fail because they need interaction rather than extraction.

That is zero files, zero LOC, and one or two days of actual use. It teaches more than building a schema against imagined demand.

If a product change is wanted, make v1 an experimental “Lens presets” section inside Search:

- Four to six named, hard-coded criteria.
- The existing custom criterion box remains the user-authored route.
- Runs use the existing search endpoint, `SearchRun` storage, streaming, validation, marks, spine lanes, and result panel.
- Add “Suggest a lens” to Feedback. A person triages it.

Including the shared experimental-switch state that the project docs require before the first real gate, this is roughly 6–9 files, 250–450 LOC, and two to three days with tests and docs. Without that gate, it is closer to 3–5 files, 100–250 LOC, and one to two days.

V1 must not add ModeDef, GenericModePanel, a composer model call, new storage, built-in migration, sharing, a gallery, code execution, KV state, mode composition, library scope, automatic article-proposed modes, or automatic PRs.

### 6. Long-term recommendation

Do not build user-extensible modes yet. Improve Search’s framing and use Feedback to collect mode requests.

If repeated use later proves that people want persistent extraction lenses, build a narrow `LensDef`, not a universal `ModeDef`: name, prompt, anchored row shape, perhaps grouping, and nothing interactive. Keep it private at first. Render it through a modest anchored-list component. Leave Ideas, Quotes, Timeline, Glossary, and Summary hand-built.

That architecture differs from v1 at the product layer, but it can reuse the same anchored-search machinery. Tier (e)—a requested lens becoming an ordinary reviewed feature—is sensible. Tiers (c) and (d) should remain rejected unless real users repeatedly demand interactions that a lens cannot express.

### 7. What the document missed

The largest omission is mode proliferation. There are already twelve mode values in [modes.ts](../../src/modes.ts), line 23. An unlimited number of tabs is not empowerment; it is a navigation and product-coherence problem.

Other missing issues are:

- A fixture row tests whether one row still parses. It does not test whether a prompt generalises across genres. The real fixture is a corpus of articles with expected omissions and failure cases.
- Mode definitions need migrations and support. An immutable old definition still has to run against new schemas, prompts, models, blocks, and public projections.
- The authoring loop is being evaluated on the article where the request arose. That strongly rewards overfitting.
- `scope: section | block | tree-node` changes call counts by orders of magnitude and introduces merging, duplication, partial failure, and ordering problems.
- Gallery metrics require users, telemetry, retention definitions, and privacy decisions. With roughly one user they are fiction, and “kept after a week” drifts uncomfortably close to the engagement mechanics the product rejects.
- A mode is editorial policy, not just data plus layout. Its careful words about uncertainty, provenance, emptiness, retrying, and what a click means are part of the mode.

The dreaming pass found a good idea: a reader-authored question can become a persistent, anchored lens. Keep that idea. Reject the platform wrapped around it.