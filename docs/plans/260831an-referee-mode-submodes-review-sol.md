Verdict: do not call the safeguard layer done yet. Candidates’ source rule does not govern the screen, Claims’ adequacy rule has an explicit bypass, and Claims does not run in the deployed Postgres configuration.

## Findings, worst first

1. **Critical — Candidates can show names that failed rule 1**

The validator governs only the fenced JSON at [referee-candidates.ts:192](/home/greg/code/spideryarn2/src/referee-candidates.ts:192). The panel removes that fence, then renders the remaining prose—including every rejected name—at [CandidatesPanel.tsx:435](/home/greg/code/spideryarn2/src/web/CandidatesPanel.tsx:435).

Concrete failure: the real run with six names and zero annotations displays all six in the transcript, beside an empty validated shortlist. “No name without a source” is therefore false at the screen boundary.

The test titled “a name reaches the screen only with a source” cannot detect this: its rejected candidate appears only inside the hidden fence; the prose says merely “Some people worth asking” at [referee-candidates-panel.test.tsx:153](/home/greg/code/spideryarn2/tests/referee-candidates-panel.test.tsx:153). This is the clearest third theatrical test.

Before done, make the validated shortlist the only candidate-naming surface. Either suppress candidate-bearing assistant prose or structure the response so prose contains search/fit discussion but names exist only in validated rows.

2. **Critical — Claims’ linkage-not-adequacy rule is openly evadable**

The validator deliberately scans only `reasoning`, not the claim headline, at [referee-claims.ts:391](/home/greg/code/spideryarn2/src/referee-claims.ts:391). The test confirms this adequacy verdict survives unchanged:

> “The 40% claim is not supported by the results”

[referee-claims-accounting.test.ts:345](/home/greg/code/spideryarn2/tests/referee-claims-accounting.test.ts:345)

That is not a hard rule with an edge case; it is a direct bypass in the most prominent sentence.

The frames are also easily paraphrased around:

- “The results report 11.5%, while the abstract promises 40%.”
- “Only SST-2 is examined.”
- “No transfer experiment appears in the paper.”
- “The result and the headline concern different quantities.”

Those communicate adequacy without matching the current patterns at [referee-claims.ts:396](/home/greg/code/spideryarn2/src/referee-claims.ts:396).

If this must genuinely be hard, arbitrary model-authored linkage prose cannot reach the screen. My v1 would:

- Fall back to the paper’s validated claim quote when the claim headline is unsafe.
- Keep showing validated passages but omit model reasoning, or constrain it to a closed relationship type rendered by the app.
- Treat the present frames as defence-in-depth, not the enforcing boundary.

Sharing the frames with the eval is good for regression testing: the independently labelled expected booleans will still fail if the code changes incorrectly. It is weak as semantic evaluation, however. A production miss is necessarily also an eval miss because both ask the same frames. The 6/6 and 10/10 are in-sample results from lines used to shape the detector, not evidence that paraphrases cannot pass. Add held-out, manually labelled adversarial sentences—especially claim headlines.

3. **High — Candidates proves that a URL appeared, not that it supports the person**

`citedUrls` accumulates every citation across the thread at [referee-candidates.ts:382](/home/greg/code/spideryarn2/src/referee-candidates.ts:382), and `readSources` accepts any exact URL from that pool at [referee-candidates.ts:320](/home/greg/code/spideryarn2/src/referee-candidates.ts:320).

Concrete failures:

- A hallucinated person can be paired with an unrelated real URL from an earlier search and pass.
- Because `latestShortlist` constructs the citation pool from the whole thread before inspecting older messages, a later citation can retroactively validate an earlier shortlist at [CandidatesPanel.tsx:268](/home/greg/code/spideryarn2/src/web/CandidatesPanel.tsx:268).

A referee reads the link as evidence for the named person, which the validator has not established.

I would use app-owned search-result IDs: store URL, title and snippet; require candidates to reference those IDs; scope permitted results to those available at or before that answer; and verify the person’s normalized name appears in the returned title/snippet or fetched page.

I would not move permanently to `plugins: [{id:"web"}]`: OpenRouter now documents that plugin as deprecated and recommends the server tool. The server tool supports 0–N searches, selectable engines and `max_total_results`; the plugin always searches once. [OpenRouter server-tool documentation](https://openrouter.ai/docs/guides/features/server-tools/web-search), [plugin overview](https://openrouter.ai/docs/guides/features/plugins/overview).

First, probe `openrouter:web_search` with `engine: "exa"` and inspect the raw wire response. If it does not expose every returned result independently of prose attribution, use the deprecated plugin temporarily or introduce an application-owned search seam. The present prompt-dependent evidence supply is not defensible as a hard safeguard.

Also, the current server-tool parameters use `max_uses`, which the current documentation does not list; it documents `max_total_results` instead at [converse.ts:214](/home/greg/code/spideryarn2/src/converse.ts:214). I would not count the eight-search budget as enforced until a wire-level test proves it.

4. **High — Claims is unavailable in the deployed store**

Under `SPIDERYARN_STORE=postgres`, every Claims operation deliberately returns 501 at [store/index.ts:262](/home/greg/code/spideryarn2/src/store/index.ts:262).

Concrete failure: in the deployed application, “Pull the paper’s claims” cannot load, start or persist a run. “All four sub-modes are built” is true only for the filesystem configuration.

Move Claims into the intended pipeline artifact before calling the mode done, or describe Claims explicitly as local-only.

5. **High — caps silently omit valid results and create positional priority**

Claims sorts into document order, then deletes everything after claim 20 at [referee-claims.ts:865](/home/greg/code/spideryarn2/src/referee-claims.ts:865). Passage 9 onward is similarly removed at [referee-claims.ts:947](/home/greg/code/spideryarn2/src/referee-claims.ts:947). The counts reach the outcome and server log, but the route stores only claims and model at [routes.ts:3326](/home/greg/code/spideryarn2/src/routes.ts:3326).

Concrete failure: a referee sees an apparently complete list in which early claims were systematically preferred over later ones. That is a fourth ranking signal—visibility itself—even though the comparator cannot see passage counts.

Candidates has the same silent truncation: it stops after 40 accepted rows without counting later ones at [referee-candidates.ts:221](/home/greg/code/spideryarn2/src/referee-candidates.ts:221). Its cap test asserts only length 40 at [referee-candidates.test.ts:262](/home/greg/code/spideryarn2/tests/referee-candidates.test.ts:262).

Surface `claimsOmitted`, per-claim `passagesOmitted`, and `candidatesOmitted`. Otherwise these are exactly the “success while doing less than claimed” shape.

Even below the cap, passage-list height is an implicit ranking: a dense row looks better supported than a thin row. The copy denies that inference, but the visual still makes it. Uniform collapsed claim rows with passages revealed on demand would reduce it.

6. **Medium — `unaccountedSentences` is mechanically true but rendered too accusatorily and can become noise**

Three mismatches matter:

- The heading is “Not accounted for,” before the caveat, at [referee-claims.ts:293](/home/greg/code/spideryarn2/src/referee-claims.ts:293).
- The rows are called “Sentences,” but the splitter deliberately creates comma- and semicolon-delimited clauses at [referee-claims.ts:549](/home/greg/code/spideryarn2/src/referee-claims.ts:549).
- “No claim is anchored in it” reads like lack of coverage, but the implementation means only that no claim quote *begins* there at [referee-claims.ts:625](/home/greg/code/spideryarn2/src/referee-claims.ts:625). A row may explicitly describe that clause while its quote starts earlier.

There is no cap. One long abstract block can generate dozens of background/setup clauses. That is enough noise for the referee to stop reading the section.

I would narrow it to the failure it was introduced for: other units inside the returned claim-quote spans that contain no claim start. Group them by source passage, cap or collapse the groups, and rename the section to something neutral such as “Other text inside these quoted passages.” That still catches swallowed neighbouring claims without indicting every sentence in the same block.

7. **Low — placement is substantively sound, but the tie-break test is theatrical**

The six placement conditions are met in the production call path:

- The sentence uses stored valence, resolved criterion text and absence of body.
- It makes no claim about the referee’s reason.
- Model-produced placements are rejected.
- Placement-only comments are excluded from model input.
- Omitted counts are surfaced.
- Actual input arrives in document order and stable strength sorting preserves that order for ties.

The weak point is the test at [referee-mirror.test.ts:777](/home/greg/code/spideryarn2/tests/referee-mirror.test.ts:777). It supplies four placements under a six-item cap, so no tie affects selection, and its input is already in the expected order. It would pass if boundary tie-breaking were broken.

Use at least eight placements, with equal absolute values straddling the sixth slot. Better still, carry an explicit document position into `mintPlacements` and compare it directly rather than relying on the caller’s ordering plus stable sort at [referee-mirror.ts:747](/home/greg/code/spideryarn2/src/referee-mirror.ts:747).

I found no other falsehood in the minted sentence itself.

One evidence limitation: `ba6ff2a` is not present in this checkout; the Claims eval history here contains `99d8e78` followed by `12e7eab`, so I reviewed the current eval and those reachable revisions. I also could not execute the focused suites because this review sandbox prevents Vitest from creating its `/tmp` transform directories; all six suites stopped before importing tests.