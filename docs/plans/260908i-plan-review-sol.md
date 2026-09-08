The core architecture is sound, but I would not build the plan unchanged. Two reader-visible interactions are missed, and the proposed tests do not adequately protect the hook split.

## Findings

1. High — Search-over-quote is already known to render incorrectly, and this change makes it reachable

The plan says simultaneous marks are already legible because “search fills, quotes outline” ([plan:180](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/docs/plans/260908i-quotes-marked-in-the-prose-in-every-mode.md:180>)). The design specimen says otherwise: where a search overlaps part of a quote, the search’s `padding-bottom: 2px` makes the quote’s lower rule visibly step down and back up ([DesignPage.tsx:1292](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/DesignPage.tsx:1292>)). The underlying padding is at [annotations.css:203](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/styles/annotations.css:203>).

The same stylesheet also records that wrapped quote/search overlap is only checked in Chrome; Firefox and Safari are untested, specifically because quote marks override `box-decoration-break: clone` with `slice` ([annotations.css:272](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/styles/annotations.css:272>)). Both comments currently dismiss the defects as unreachable because only one mode’s hits are present. This plan removes that premise.

The proposed real-article browser pass may contain no overlapping quote/search passage and therefore prove nothing.

What I would do: make a deterministic partial-overlap specimen an acceptance gate for Stage 2, then either fix the 2px discontinuity or explicitly get Greg’s acceptance of it. Also test a wrapped overlap; Firefox/Safari should be checked if available rather than leaving the newly reachable path under a Chrome-only observation.

2. Medium — Ambient quote marks change touch behavior even though they have no click handler

The fourth checked statement is literally true—there is no handler that opens a quote hit—but its conclusion is false.

`TableView` excludes every `mark` from the tap that selects a paragraph ([TableView.tsx:337](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/TableView.tsx:337>), [TableView.tsx:385](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/TableView.tsx:385>)). The cell only selects the row when that predicate passes ([TableView.tsx:1572](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/TableView.tsx:1572>)). Meanwhile, the delegated mouse-up handler acts only on selections, comments and chats—not quote hits ([TableView.tsx:1428](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/TableView.tsx:1428>)).

Consequently, tapping an ambient quote in Plain produces no quote action and also fails to select the paragraph/reveal its touch gutter. Up to 32 fairly large regions can become dead zones for that interaction.

What I would do: decide this explicitly and add a touch test. My default would be to treat a quote-only hit as ordinary prose for block selection, while retaining the exclusions when that same element also carries an interactive term, comment, chat or link.

3. Medium — The split is right, but its most important lifecycle properties are not in the test plan

The final plan correctly hoists only `useQuotesRead`, not the full hook. But the current Quotes tests do not model that composition:

- `tests/modes-that-start-themselves.test.tsx` mounts the whole `useQuotes` inside its temporary band ([lines 218–224](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/tests/modes-that-start-themselves.test.tsx:218>)). After the split, simply changing that to call both halves in the same temporary component would miss the whole distinction: the read must remain mounted while the activation owner dies with the band.
- `tests/artefact-read-race.test.tsx` similarly mounts the current monolithic hook ([lines 264–266](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/tests/artefact-read-race.test.tsx:264>)).
- `tests/quote-marks.test.ts` is a pure resolver/threshold test ([lines 67–78](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/tests/quote-marks.test.ts:67>)); it cannot prove read ownership or activation lifetime.
- `tests/glossary-band-wiring.test.ts` largely asserts source text and the old `derived` call ([lines 279–309](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/tests/glossary-band-wiring.test.ts:279>)).

The split must also preserve the band’s mount revalidation. The glossary explicitly calls `read.reload()` when its band opens so it notices an artefact generated in another tab while closed ([useGlossary.ts:429](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/useGlossary.ts:429>)). The plan says “exactly as” the glossary split, but does not name or test this requirement. Moving only the existing opening effect ([useQuotes.ts:165](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/useQuotes.ts:165>)) into `useQuotesRead` would leave a permanently mounted read that never revalidates on reopening Quotes.

What I would add:

- Article open with no press: opening quotes GET, zero job POSTs.
- Quotes press after the read says `none`: exactly one POST.
- Hold the read, press Quotes, leave the band, then settle it: zero POSTs.
- Re-enter through Back/pasted state: zero POSTs.
- Press Quotes again: exactly one POST.
- Opening the band while the opening GET is pending does not duplicate it.
- Opening later picks up quotes written elsewhere while the band was closed.

4. Medium — Existing whole-app and visitor tests can stay green while the feature is wrong

The principal whole-app test currently declares that all prose marks belong only to the open mode ([the-marks…test.tsx:1](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/tests/the-marks-in-the-prose-belong-to-the-mode-showing.test.tsx:1>)) and explicitly expects Plain to have no marks ([lines 686–689](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/tests/the-marks-in-the-prose-belong-to-the-mode-showing.test.tsx:686>)). That contract must become:

> prose marks = ambient quotes ∪ active mode marks; ring, paragraph bar and spine rail = active mode only.

Its fixture should contain an actual quote and check this across Plain, Search, Glossary and at least one other passage-producing mode.

The public network test is strong enough to catch an accidental private `/api/quotes/:slug` request: it requires exactly one public request on load ([public-network-trace.test.tsx:954](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/tests/public-network-trace.test.tsx:954>)) and sweeps every mode ([lines 1002–1018](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/tests/public-network-trace.test.tsx:1002>)). But its public fixture deliberately contains no quotes ([lines 364–373](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/tests/public-network-trace.test.tsx:364>)), and its own mode table admits that the present-quotes renderer is untested ([lines 872–876](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/tests/public-network-trace.test.tsx:872>)). It can therefore pass while visitor ambient marks are absent.

Add a public-quote variant that asserts `mark[data-quote]` in Plain while retaining the exact network trace.

Also rehome or delete the Quotes arm in `passage-mode-cleanup.test.tsx`; it explicitly tests that leaving Quotes clears its marks ([lines 676–709](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/tests/passage-mode-cleanup.test.tsx:676>)), which becomes the opposite of the product contract.

5. Low — Deduplicating the merged arrays by `Found.key` is not a valid contract

`Found.key` is documented as unique only “within one result set” ([search-hits.ts:76](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/search-hits.ts:76>)). Quote keys are `${quoteId}:${blockId}:0` ([search-hits.ts:738](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/search-hits.ts:738>)); search and other producer keys use structurally similar strings ([search-hits.ts:964](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/search-hits.ts:964>)). Nothing in the type guarantees cross-producer uniqueness.

A collision is unlikely, but deduplication would turn it into silent data loss or ring the wrong kind of mark. It is unnecessary: `active === quotes` already handles Quotes mode.

What I would do: omit deduplication. If it is desired as defence, namespace keys by producer before relying on them across independently generated sets.

6. Low — “Behaviour unchanged at the end of Stage 1” is not accurate

Moving hidden-selection handling into an always-mounted reader changes URL behavior before Stage 2. Today, the effect exists only while Quotes mode is mounted and deliberately refuses to let a dormant `?bar=` clear a selection in a list nobody is viewing ([QuotesMode.tsx:155](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/modes/quotes/QuotesMode.tsx:155>)). The plan intentionally reverses that scope ([plan:145](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/docs/plans/260908i-quotes-marked-in-the-prose-in-every-mode.md:145>)).

That may be the right final behavior, but Stage 1 is not behavior-preserving: in `?mode=plain&rank=prioritised&bar=…&quote=…`, the quote parameter can now be cleared after the universal read settles. Make that an explicit decision and test it rather than calling the stage unchanged.

## The full-hook hoist verdict

Hoisting the complete current `useQuotes(slug)` would not be safe.

An always-mounted `useAutoRun` does not claim anything merely because the article opened: it sees no nonce and returns ([useAutoRun.ts:137](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/useAutoRun.ts:137>)). A real Quotes press would still trigger it once, and synchronous token consumption plus `beginAutoAttempt` prevent duplicate automatic runs ([useAutoRun.ts:155](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/useAutoRun.ts:155>)).

The failure is timing. The hook’s owner lives for the hook mount ([useAutoRun.ts:118](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/useAutoRun.ts:118>)). If that mount lives in `OwnedReader`, it can claim a press while the quotes GET is loading, survive the reader leaving Quotes, and spend the token when the GET later settles. That violates the activation contract that a press belongs to the band on screen and is deliberately dropped when that band disappears ([activation.ts:71](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/activation.ts:71>), [activation.ts:89](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/activation.ts:89>)).

It would also leave a permanent `useJobs` subscriber: `useQuotes` calls `useStepJob` ([useQuotes.ts:169](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/useQuotes.ts:169>)), which subscribes through `useJobs` ([useStepJob.ts:334](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/useStepJob.ts:334>)). Once the signed-in session has started the engine, any subscriber keeps its eight-second idle cadence ([jobEngine.ts:38](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/jobEngine.ts:38>), [jobEngine.ts:402](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/jobEngine.ts:402>)).

The current plan’s corrected split avoids both failures: only `useQuotesRead` lives in `OwnedReader`; `useStepJob` and `useAutoRun` remain in `QuotesBand`. That is the right design.

## Memo and consumer verdicts

Computing `{found, openKey}` directly during `Reader`’s render preserves the `derived` arm’s atomicity. A React commit contains both values from the same render; a suspended or abandoned render commits neither, and StrictMode cannot commit half a memo. When the bar hides a selection, `selected` is already derived as `null` in that render before the passive URL-clearing effect runs ([QuotesMode.tsx:182](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/modes/quotes/QuotesMode.tsx:182>)). I see no route to “new ring, old quote set” inside Reader.

Removing `derived` is safe for production callers: Quotes is its only caller ([passage-lifecycle.ts:55](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/passage-lifecycle.ts:55>)). Its documentation and the two tests named above must be rewritten.

The four-consumer table is correct, and I found no fifth `passages` consumer in `Reader`:

- `buildHitMarks` should receive active passages plus quotes.
- `blockStrength`, `blockHues`, and `blockMatches` must retain only active passages ([Reader.tsx:880](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/reader/Reader.tsx:880>)).
- `blockStrength` would indeed make null-confidence quotes full-strength ([search-hits.ts:1297](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/search-hits.ts:1297>)).
- `blockMatches` and `blockHues` feed the spine and paragraph bars, not prose annotation ([search-hits.ts:1384](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/search-hits.ts:1384>), [Reader.tsx:1820](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/reader/Reader.tsx:1820>)).

Keyboard article navigation is tree-based ([Reader.tsx:909](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/reader/Reader.tsx:909>)); quote and search result navigation uses each panel’s own list; `?at=` tracks blocks and scrolling; page titles depend on mode; exports serialize stored artefacts. None consumes the merged prose list.

## Identity and cost

The proposed identity rules are sufficient once the unsafe key deduplication is removed:

- return either non-empty side unchanged;
- return `active` when `active === quotes`;
- memoise genuine two-sided merges.

If identity stability were lost, marks would remain correct, but `baseMarks` would miss its WeakMap cache ([search-hits.ts:1200](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/search-hits.ts:1200>)). During search typing, a genuine active-result change necessarily allocates a new merge. That causes quote-bearing blocks to be re-annotated because their hit arrays are new ([TableView.tsx:1048](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/TableView.tsx:1048>)). React should not rewrite their DOM when the generated HTML is identical—the previous `{__html}` object is retained ([TableView.tsx:1089](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/TableView.tsx:1089>)). So the marginal cost is parsing/re-serialising at most the quote-bearing blocks on each keystroke, not DOM churn. With the 32-quote cap it is plausibly acceptable, but worth measuring on the dense fixture.

## Visitor and product verdicts

The visitor shape is safe. `PublicQuotes` contains the public quote data but omits pipeline provenance ([public-types.ts:346](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/public-types.ts:346>)); the projection is field-by-field ([public/dto.ts:361](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/public/dto.ts:361>)). Because the private read is mounted in `OwnedReader`, not shared `Reader`, visitors make no new request ([ArticlePage.tsx:379](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/article/ArticlePage.tsx:379>)). The test gap is rendering, not leakage.

I would ship v1 without an off-switch. “Always show” is the explicit request, and a new switch would weaken it. But the risk is real: `document` returns all quotes ([QuotesPanel.tsx:420](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/QuotesPanel.tsx:420>)), and the feature doc admits nobody has evaluated a 32-quote list ([quotes.md:563](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/docs/project/quotes.md:563>)). Replace the “real article” acceptance check with, or add, a deliberately dense 32-quote fixture. If readers later need relief, the smallest honest control is to make the existing rank/bar density control reachable from the text view, not invent a second independent visibility setting.

## The six checked statements

1. `useAutoRun` requires a pressed token: true. The final split correctly keeps its mount lifetime in the band. A full-hook hoist would still be unsafe for delayed spending.
2. A subscriber cannot wake an unstarted engine but does determine idle cadence after session start: true. The corrected read/job split is necessary.
3. No Reader mode is code-split: true; its mode imports are static ([Reader.tsx:29](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/reader/Reader.tsx:29>)).
4. No handler opens `mark.hit`: literally true. “Therefore no gesture change” is false because of touch block-selection suppression.
5. The hover card ignores plain hits: true; its selector is terms and links only ([ProseHoverCard.tsx:282](</home/greg/code/spideryarn2/.claude/worktrees/quotes-always-marked/src/web/ProseHoverCard.tsx:282>)).
6. `rankQuotes("document")` returns the full list untouched: true.

So the conclusion of that section is mostly right, but incomplete at exactly the two newly reachable boundaries: combined Search rendering and touch selection.