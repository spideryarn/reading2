F1 (P1 blocking) — The match accepts wrong works. The proposed rule is exact title plus any one author, including an initial-only given-name match ([article-registry.ts:125](/var/tmp/spideryarn-worktrees/fbvh0z7s-cited-by-openalex/src/article-registry.ts:125)). That was reasonable corroboration for a DOI already printed by the article; it is not strict enough to discover an identifier from a broad title search. Two works can have the same title and one author in common, especially editions, conference versions, recurring reports, and an author reusing a title. The plan then resolves ambiguity by year and citation count, but citation count is not identity evidence, and year merely affecting rank still allows a candidate decades away ([plan:48](/var/tmp/spideryarn-worktrees/fbvh0z7s-cited-by-openalex/docs/plans/261011q-cited-by-finds-a-paper-with-no-doi-by-title-and-author-at-openalex.md:48)).

Fix: define a stronger title-search-only predicate. Keep whole-title equality, then require either a close year, a matching external identifier/location, or multiple full author-name matches. An initial-plus-surname alone should not suffice without another discriminator. If multiple candidates remain plausible, return no match rather than choosing the most cited. Add red tests for the same title and author in different years, one shared co-author, initial-only collisions, and two passing candidates where the more-cited one is wrong. Attention can survive a bad year because all eight authors agree; the rule need not make year an unconditional veto.

F2 (P1 blocking) — The DOI hop is neither required nor an independent check, and the plan’s own example demonstrates why it is dangerous. Greg chose “ask OpenAlex by title and author,” not “adopt the DOI OpenAlex returns” ([question:17](/var/tmp/spideryarn-worktrees/fbvh0z7s-cited-by-openalex/docs/user-feedback/questions/q-hbg65m.md:17)). OpenAlex’s `W…` id is all the `cites:` request needs. Skipping candidates without a DOI therefore creates unnecessary false negatives ([plan:45](/var/tmp/spideryarn-worktrees/fbvh0z7s-cited-by-openalex/docs/plans/261011q-cited-by-finds-a-paper-with-no-doi-by-title-and-author-at-openalex.md:45)).

More seriously, the plan calls `10.65215/2q58a426` the DOI of the right Attention work, while arXiv itself identifies that paper as `10.48550/arXiv.1706.03762` ([arXiv’s record](https://doi.org/10.48550/ARXIV.1706.03762)). Asking OpenAlex for the returned DOI and applying the same title-and-author test simply repeats OpenAlex’s metadata; it does not validate the DOI independently.

Fix: once a candidate passes the stronger check, fetch citers directly with its validated OpenAlex `W` id. Do not require, adopt, display, or use its DOI as proof. Let a DOI-less OpenAlex record work. Cache citation lists under an explicitly validated OpenAlex-id key for this path.

F3 (P1 blocking) — The global cache key can hand one paper another paper’s match. It hashes title words and author-name words but omits year ([plan:66](/var/tmp/spideryarn-worktrees/fbvh0z7s-cited-by-openalex/docs/plans/261011q-cited-by-finds-a-paper-with-no-doi-by-title-and-author-at-openalex.md:66)), even though year is used to choose between passing candidates. Two papers by the same author(s), with the same title in different years, therefore share a row. The second article receives the first DOI, and the downstream check also ignores year, so it accepts the wrong citation list.

The key also loses structured-author boundaries and contains no matching-policy version, so semantically different inputs or a later stricter matcher can inherit an old `found` or `none`.

Fix: the simpler safe v1 is no title-match cache. If caching is necessary, prefer a revision/article-scoped row with a cascading foreign key. If it must remain global, its canonical input must include field boundaries, structured authors, year and any URL/identifier evidence, plus a policy version; missing discriminators must fail closed. Store enough matched evidence to revalidate every cache hit.

F4 (P2 should fix) — The proposed OpenAlex URL uses legacy and partly wrong syntax. `filter=title.search:` still works but is deprecated; current OpenAlex documentation says to use `search.title`, and parameters use snake case, so `per_page`, not `per-page`. Title search is stemmed, removes stop words, ANDs unquoted words, and ranks partly by citation count; therefore the first ten are not an exhaustive set of exact titles. [OpenAlex search documentation](https://help.openalex.org/api/searching/), [API quick reference](https://help.openalex.org/api/llm-quick-reference/).

Fix: construct the URL with `URL`/`URLSearchParams`, use a bounded `search.title.exact` value and `per_page`, and test the complete URL with commas, pipes, ampersands, Unicode, spaces, and an overlong title. Decide explicitly whether the default core corpus or `corpus=all` is intended. Either inspect enough results or ensure reader copy never claims the first ten prove OpenAlex has no matching paper.

The cost argument also assumes the keyed $1 daily budget, but the current request sends no API key. OpenAlex documents a ten-times-smaller no-key budget. Either add a key to the design or assess cache necessity against the actual anonymous budget.

F5 (P2 should fix) — The stale-state behavior is unspecified. A cached title match can yield a DOI that the DOI path later reports as `not-indexed` or `unconfirmed`; the title row remains `found`, so every opening repeats the contradictory failure until it expires. A title/author/year change leaves the old ownerless row indefinitely, and a cached `none` cannot be reconsidered for seven days after OpenAlex corrects its data.

Fix: using the OpenAlex id directly removes the DOI contradiction. Otherwise specify a state transition: invalidate a cached match immediately when its target fails confirmation, search again while excluding that candidate, and never serve it as stale. Add tests for changed article identity, changed OpenAlex metadata, cached match followed by missing/unconfirmed DOI, and negative-cache expiry.

F6 (P2 should fix) — Both proposed reader sentences overclaim.

- “Since it has no DOI of its own” is false: Spideryarn merely did not have one.
- “OpenAlex has no paper whose title and an author both match it” is not established by a capped, core-corpus search that also discards DOI-less candidates.
- Saying the match method does not make a wrong match visible; the reader sees neither the matched record nor the evidence ([plan:78](/var/tmp/spideryarn-worktrees/fbvh0z7s-cited-by-openalex/docs/plans/261011q-cited-by-finds-a-paper-with-no-doi-by-title-and-author-at-openalex.md:78)).

Fix the copy along these lines:

- Found: “We did not have a DOI for this piece, so we matched it to an OpenAlex record using its title, authors and publication details.” Link “Check the match” to the validated OpenAlex record and show its year/authors.
- None: “We did not have a DOI, and the title search did not find an OpenAlex record we could confidently match, so we cannot list citing papers.”

Google Scholar remains the next action.

F7 (P2 should fix) — The privacy account is internally inconsistent. The shown query sends only title words; article author names are compared locally against authors OpenAlex returns. The claim that OpenAlex receives title and author names is therefore false ([plan:90](/var/tmp/spideryarn-worktrees/fbvh0z7s-cited-by-openalex/docs/plans/261011q-cited-by-finds-a-paper-with-no-doi-by-title-and-author-at-openalex.md:90)). A title is also article text; the honest distinction is “title, not body text.”

The proposed hash is not anonymous: titles and author names come from a guessable public dictionary, so the hash can be recomputed. An ownerless row also survives “Delete permanently,” which currently promises to erase the article ([PrivacyPage.tsx:715](/var/tmp/spideryarn-worktrees/fbvh0z7s-cited-by-openalex/src/web/PrivacyPage.tsx:715)). Fresh for seven days is not retention; the row persists after it becomes stale.

Fix: disclose only the actual transfer—title words and contact address, not author names or body text. Avoid the global hash through no cache or revision-scoped cascading storage. If retained, document its retention and deletion semantics instead of calling it anonymous. Security’s existing fixed-host fetch and text-only rendering remain appropriate, but the plan should pin URL encoding, query-length bounds, `plainRegistryText`, identifier checks, and the no-title/no-author logging rule.

F8 (P2 should fix) — The surface and test inventory is incomplete. At minimum:

- `CITERS_ABOUT` still tells readers that OpenAlex receives only the DOI ([messages.ts:5804](/var/tmp/spideryarn-worktrees/fbvh0z7s-cited-by-openalex/src/messages.ts:5804)).
- `useCiters` says this costs nothing ([useCiters.ts:5](/var/tmp/spideryarn-worktrees/fbvh0z7s-cited-by-openalex/src/web/useCiters.ts:5)).
- The route says at most two outside requests and “no money” ([routes.ts:11928](/var/tmp/spideryarn-worktrees/fbvh0z7s-cited-by-openalex/src/routes.ts:11928)).
- `asCitersResult` must validate `via`, not merely cast the object ([useCiters.ts:59](/var/tmp/spideryarn-worktrees/fbvh0z7s-cited-by-openalex/src/web/useCiters.ts:59)).
- Add parser tests for malformed ids, DOIs, years, counts, authors and oversized strings; a too-short title should ask nothing; `via` must survive cache and stale paths; and privacy/info-copy tests must pin the title-search disclosure.

VERDICT: RETHINK