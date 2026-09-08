## Findings

1. High, high confidence — the Search-over-quote rendering defect was documented, not fixed

A search wash still adds `padding-bottom: 2px` ([annotations.css:203](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/styles/annotations.css:203)), while the quote’s bottom stroke follows that padded box ([annotations.css:294](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/styles/annotations.css:294)). The lower rule therefore steps by 2px across a partial overlap.

The implementation honestly relabels the design specimen to admit this ([DesignPage.tsx:1292](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/DesignPage.tsx:1292)), but my plan-review request was: fix it or get Greg’s explicit acceptance. I found no such acceptance. The concurrent browser note now in the working tree measures the defect at exactly 2px, which confirms rather than closes the finding. Firefox and Safari remain untested for the `box-decoration-break: slice` interaction ([annotations.css:272](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/styles/annotations.css:272)).

I would either make the stroke independent of the wash’s padded inline box, or treat the screenshot as a product decision and record Greg’s acceptance explicitly.

2. Medium, high confidence — an always-mounted read is not an always-fresh read

The opening GET runs once in `useQuotesRead` ([useQuotes.ts:225](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/useQuotes.ts:225)). All later automatic revalidation belongs to the conditionally mounted band: its mount `reload` ([useQuotes.ts:257](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/useQuotes.ts:257)) and its job-completion `refresh` ([useQuotes.ts:268](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/useQuotes.ts:268)). `useJobs` only announces completions observed after that subscriber mounted ([useJobs.ts:220](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/useJobs.ts:220)).

Consequences:

- First generation starts, the reader leaves Quotes, and the job finishes: Plain continues showing no marks until Quotes is reopened.
- Another tab generates quotes while this tab remains in Plain: this tab never receives them.
- A CLI writes quotes while Quotes is already open: there is no job record, so even the mounted band does not notice; `useStepJob` explicitly excludes CLI runs ([useStepJob.ts:249](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/useStepJob.ts:249)).
- Reopening Quotes does catch up, because the mount `reload` is correct. The panel and prose then update together.

Thus I found no panel/prose disagreement: both consistently share the same read, even when it is stale. The missed contract is that a newly generated list can fail to arrive at all.

I would give `useQuotesRead` an invalidation path independent of the band’s activation/job machinery—ideally a completion-only event that does not count toward job-engine idle cadence, broadcast across tabs, with focus revalidation covering direct CLI writes.

3. Medium, high confidence — the tests do not protect the hook composition strongly enough

The code has the right composition, but the lifecycle tests still mostly pose it:

- `modes-that-start-themselves` supplies a permanently settled fake read ([modes-that-start-themselves.test.tsx:315](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/tests/modes-that-start-themselves.test.tsx:315)). It proves the band owns activation, but does not test an outstanding `useQuotesRead`, duplicate opening GETs, or the real read surviving band unmount.
- `artefact-read-race` mounts both halves in the same component ([artefact-read-race.test.tsx:264](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/tests/artefact-read-race.test.tsx:264)). It correctly protects trailing `refresh`, but cannot protect the split lifetime.
- There is no behavioral test for mount revalidation finding an externally written list, nor for the stale-while-band-closed sequence above.
- The hidden-selection rule is held only by a source regex ([glossary-band-wiring.test.ts:188](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/tests/glossary-band-wiring.test.ts:188)), despite the plan promising a behavioral test.
- `agree()` checks only whether a block contains some `mark.hit` ([the-marks…test.tsx:627](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/tests/the-marks-in-the-prose-belong-to-the-mode-showing.test.tsx:627)), not `data-quote`. Its dedicated quote block makes it meaningful, but it still would accept the wrong kind of hit.
- The whole-app session covers Plain, Ideas, Timeline, Search and Referee ([the-marks…test.tsx:694](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/tests/the-marks-in-the-prose-belong-to-the-mode-showing.test.tsx:694)); it does not cover Glossary or Quotes, despite the plan naming both. Consequently, the selected-quote ring and the precise “leave Quotes, marks survive” sequence have no behavioral replacement.
- `quotes-marked-in-every-mode.test.ts` strongly holds the pure `proseFound` contract and identity ([quotes-marked-in-every-mode.test.ts:94](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/tests/quotes-marked-in-every-mode.test.ts:94)), but its negative projection checks demonstrate what the helpers return, not what `Reader` actually passes them.
- The source-shaped checks currently match executable code, not comments. However, `/quotes,\n/` ([glossary-band-wiring.test.ts:349](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/tests/glossary-band-wiring.test.ts:349)) is under-scoped: any unrelated `quotes,` in `Reader` would satisfy it.

One test also overclaims its fixture: the “real search hit” omits `kind: "hit"` ([block-selection-by-tap.test.tsx:283](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/tests/block-selection-by-tap.test.tsx:283)); `annotateHtml` defaults an absent kind to `cmt` ([annotate.ts:385](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/annotate.ts:385)). Therefore that test does not exercise either search-only selector.

4. Low, high confidence — a quote nested inside source-authored `<mark>` remains a touch dead zone

For generated annotations, the selector truth table is correct:

| Element | Block selected? |
|---|---:|
| `mark:not(.hit)` | no |
| `.hit.cmt`, `.hit.chat`, `.hit.term` | no |
| `.hit[data-wash]` | no |
| `.hit:not([data-quote])` | no |
| quote-only `.hit[data-quote]` | yes |
| quote inside `a[href]` | no |

`mark.hit:not([data-quote])` is redundant for current annotator output: any hit without a quote tier gets `data-wash` ([annotate.ts:431](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/annotate.ts:431)). If the two selectors disagree, exclusion still wins because `closest` receives an OR-list.

Simple `:not()` support is fine in target browsers and jsdom; the targeted tests passed.

The remaining edge is nesting. Source-authored `<mark>` is not forbidden, although its reserved classes are stripped ([sanitize-policy.ts:568](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/sanitize-policy.ts:568)). `annotateHtml` can then create a quote-only `<mark>` around a text node inside it ([annotate.ts:384](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/annotate.ts:384)). The inner quote does not match the exclusion list, but its author-mark ancestor matches `mark:not(.hit)`, so `closest(...)` rejects the tap ([TableView.tsx:362](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/TableView.tsx:362), [TableView.tsx:413](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/TableView.tsx:413)).

I would decide from the nearest generated annotation mark, while separately checking interactive ancestors such as links and controls.

5. Low, high confidence — several comments and canonical docs now state the old architecture

Examples:

- `QuotesPanel` still says the band resolves and publishes marks ([QuotesPanel.tsx:42](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/QuotesPanel.tsx:42)).
- The panel says the prose reaches `markedQuotes` “from the band” ([QuotesPanel.tsx:526](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/QuotesPanel.tsx:526)).
- `quotes.md` says `useQuotesMode` calls `markedQuotes` and calls the marks washes ([quotes.md:323](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/docs/project/quotes.md:323)).
- It says `Reader` holds `quoteOpenKey` and the band publishes it in a layout effect ([quotes.md:341](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/docs/project/quotes.md:341)).
- Most seriously, it still says quote and Search marks can never coexist ([quotes.md:406](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/docs/project/quotes.md:406)).
- `passage-mode-cleanup` still describes six producers and a Quotes `derived` arm ([passage-mode-cleanup.test.tsx:3](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/tests/passage-mode-cleanup.test.tsx:3)), while retaining unused quote ids, fixtures and API response ([passage-mode-cleanup.test.tsx:131](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/tests/passage-mode-cleanup.test.tsx:131), [passage-mode-cleanup.test.tsx:240](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/tests/passage-mode-cleanup.test.tsx:240)).

## Checks that held

- The hook split itself is correct. Band mount uses joining `reload`; job completion uses trailing `refresh`.
- Reopening Quotes after regeneration catches up, and panel/prose cannot disagree because they share one `QuotesRead`.
- Article changes are safe: the article subtree is keyed by slug ([ArticlePage.tsx:176](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/article/ArticlePage.tsx:176)).
- Visitors and signed-in non-owners do not mount the private hook. Their quotes come synchronously from the public payload ([ArticlePage.tsx:517](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/article/ArticlePage.tsx:517)). The public network test strongly verifies the one public GET and no POST ([public-network-trace.test.tsx:1114](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/tests/public-network-trace.test.tsx:1114)).
- `useQuoteMarks` memo dependencies are correct. The fresh containing object does not matter: `all` is the nested quote-array identity, or stable `NO_QUOTES` ([useQuoteMarks.ts:55](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/reader/useQuoteMarks.ts:55), [useQuoteMarks.ts:75](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/reader/useQuoteMarks.ts:75)). Scroll and unrelated keystrokes do not re-resolve quotes.
- The returned slot is stable across unrelated renders ([useQuoteMarks.ts:146](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/reader/useQuoteMarks.ts:146)).
- On a Search keystroke, quote resolution still does not rerun. The real marginal work is: allocate the genuine merge, miss the `Found[]` WeakMap cache, scan active hits plus up to 32 quotes, then re-annotate up to 32 distinct quote-bearing blocks. `TableView` walks every block anyway and retains the previous React `__html` object when output is unchanged ([TableView.tsx:1055](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/TableView.tsx:1055), [TableView.tsx:1116](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/TableView.tsx:1116)). So this is bounded parse/serialization work, not 32 DOM rewrites. It was not measured on a 32-quote fixture.
- The hidden-selection guard is sufficient while loading: an empty list cannot be prioritised, so it does not clear prematurely ([useQuoteMarks.ts:105](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/reader/useQuoteMarks.ts:105)). A visitor has the payload on the first render. The effect cannot loop: after `quote=null`, `hiddenSelection` becomes false.
- `proseFound` holds its identity contract at its sole production call site. Quotes mode passes the exact same array, including while loading, so it cannot double ([passages.ts:209](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/reader/passages.ts:209)).
- The four-consumer split is correct: only `buildHitMarks` receives `proseMarked`; bar, hues and rail retain `passages` ([Reader.tsx:893](/home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/reader/Reader.tsx:893)).

## Previous six findings

1. Overlap defect: not addressed; acknowledged and measured.
2. Touch dead zones: substantially addressed; nested source `<mark>` remains.
3. Hook split/lifetimes: implementation correct for mount reload and trailing refresh; requested composition tests incomplete, and always-fresh ambient data remains unsolved.
4. Whole-app/visitor coverage: visitor fully addressed; whole-app partially addressed; Glossary, Quotes/ring and the exact survival sequence remain absent.
5. Unsafe key deduplication: fully addressed—none was added.
6. Always-mounted hidden-selection behavior: explicitly implemented and correctly guarded, but not behaviorally tested.

Targeted tests passed: 8 files, 138 tests. The equivalent TypeScript check passed all 1,737 source files. The full `npm test` could not start because local Postgres was unavailable, so I cannot report the whole suite green. I made no changes.