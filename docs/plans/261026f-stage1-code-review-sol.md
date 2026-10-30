# 261026f Stage 1 code review — GPT Sol

S1-F1 — **P1** — The *since* request is not the inclusive `Y-1` through current-year window that
the gate divides by. [`src/citation-fulltext.ts:230`](../../src/citation-fulltext.ts) asks only
`publication_year:>Y-2`, so future-dated OpenAlex records enter both the rate and the returned list,
while `isCommonPhrase` divides the count by `now - Y + 2` years. This can make an ordinary phrase
look more like a citation and can show work outside decision 3's stated window. Changed the
production request to the bounded range `Y-1`–`now` and strengthened the exact-filter test.

S1-F2 — **P1** — A nonzero OpenAlex result can be reported as `none` merely because the first page
has no displayable rows. [`src/citation-fulltext.ts:239-240`](../../src/citation-fulltext.ts) filters
the parsed page and returns `none` whenever `citers.length === 0`, including when all returned rows
were malformed, or when the first 25 are own records but `meta.count` says more records exist. That
contradicts `PossibleCiters`' contract (`none` means no such work) and discards the only useful fact,
the count and OpenAlex link. Changed `none` to mean a zero count or the fully observed case where
every result is the piece's own record; other nonzero pages remain `found`, with their dropped count.
The two regression tests were observed failing before the implementation changed.

S1-F3 — **P2** — An invalid repeated `with` value evades the promised 400. [`src/routes.ts:13077-13078`](../../src/routes.ts)
uses `URLSearchParams.get`, so `?with=possible&with=anything` is accepted even though the route says
any other `with` is a 400. Changed the route to validate all `with` values before doing the owner
read or any OpenAlex work. The same pre-existing issue exists for repeated `about`, but that is outside this
stage's change and I will not widen the fix.

S1-F4 — **P2** — The new route branch has no route-level test. The unit tests exercise
`possibleCitersOf`, but none proves the 400, the attachment only to `no-doi`/`no-match`, unchanged
answers for the other six `CitersResult` kinds, or that the authenticated owner route has no public
twin. The existing end-to-end route suite is [`tests/citation-index-pg.test.ts`](../../tests/citation-index-pg.test.ts),
which is outside the files Greg put in scope. I will not edit it; this remains for the stage owner to
decide. I did verify from the route table that `/api/citers/:slug` is authenticated, owner-scoped,
has no `viewAs: "read"`, and has no `/api/public/` counterpart, so `possible` cannot reach a visitor
through this change.

S1-F5 — **P2** — The disclosure and several contracts overstate OpenAlex's result as text that
“contains the exact title.” Evidence in the plan itself says `fulltext.search` stems words, removes
stop words, and also searches titles and abstracts; the intended reader wording is “matched a search
for this piece's title.” The inaccurate claim appears at [`src/citation-fulltext.ts:2-3`](../../src/citation-fulltext.ts),
[`src/types.ts:8232-8234`](../../src/types.ts), [`src/routes.ts:13059-13061`](../../src/routes.ts),
[`src/web/PrivacyPage.tsx:481-483`](../../src/web/PrivacyPage.tsx), and
[`docs/project/privacy.md:776-786`](../project/privacy.md). Corrected those in-scope statements and
the privacy assertion without changing the disclosure's substance.

S1-F6 — **P2** — The measurement script no longer proves all of the investigation's “as shipped”
claims. [`scripts/spikes/261026a-cited-by-full-text.ts:131-137`](../../scripts/spikes/261026a-cited-by-full-text.ts)
still defines an own record as the title with up to two extra words, the F5 rule that wrongly removes
`Response to <title>` and `Comment on <title>` from the `precision` sample. Its `shown` path imports
the production helpers, but [`scripts/spikes/261026a-cited-by-full-text.ts:223-230`](../../scripts/spikes/261026a-cited-by-full-text.ts)
still constructs the unbounded `publication_year:>Y-2` count and list directly, so it does not use
S1-F1's corrected window. The production code and its tests are correct; the script and investigation
are outside this review's editable files. The stage owner should decide whether to correct and rerun
them before continuing to cite the 94% and 82% figures as measurements of the shipped rule.

## Requested boundary checks with no finding

- An upload or an article without an HTTP(S) address returns before a full-text request or its logger
  is constructed. `loadArticleIdentity` now carries `raw_filename` through as `filename`, and the
  existing `importedFromAPublicAddress` check is the one used. The older Cited-by title lookup still
  may send an upload's title first when it has a byline; that pre-existing behaviour is expressly
  disclosed in the plan and privacy doc rather than silently treated as part of this search.
- Of the article's data, the full-text request carries only the sanitised phrase and, when there is a
  usable year, the two year ranges. Authors, byline, URL, filename and prose do not enter the URL or
  headers. The hostile-title test checks the decoded `filter` exactly; quotes, commas, pipes, colons
  and Boolean-looking words cannot add another filter.
- The gate now uses the plan's nine-year `before` window, bounded `since` window, floor of three,
  strict 5% comparison, and current-year divisor. The own-record comparison removes only an exact
  token match with an optional leading article; the reply, comment and revisit controls stay.
- The full-text log path carries only fixed labels, outcome, timings and counts. Fetch failures and
  thrown messages containing the request address are both covered by a negative log assertion.
- `possible` is attached only to `no-doi` and `no-match`. Every other `CitersResult` is sent
  unchanged. The endpoint remains in the authenticated route table, uses the owner-scoped identity
  read, is not view-as allowlisted, and has no public counterpart.
- The no-IPC typecheck completed with `exactOptionalPropertyTypes` and
  `noUncheckedIndexedAccess`; no type hole was found in the widened unions or optional fields.

## Checks

- `npx vitest run tests/citation-fulltext.test.ts tests/privacy-page.test.ts tests/citation-index.test.ts`
  — **passed**, 3 files and 134 tests.
- `npm run typecheck` — **the wrapper did not reach TypeScript in this sandbox**: the `tsx` CLI
  failed while opening its IPC socket with `listen EPERM /tmp/tsx-1000/14.pipe`.
- `node --import tsx scripts/typecheck.ts` — **passed**, running the same project-discovery and
  coverage script without the forbidden IPC server: 5 projects; all 4,039 TypeScript source files
  covered.
- `npx biome lint` on the nine in-scope TypeScript/TSX files — exited **0**. It reported eight
  existing complexity advisories in `src/routes.ts` and `src/store/pg.ts`, all outside the changed
  functions.
- `npx vitest run tests/doc-links.test.ts` — **passed**, 18 tests.
