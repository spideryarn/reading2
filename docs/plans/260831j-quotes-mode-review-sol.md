Verdict: **not ready to build**. The mode is worthwhile and not redundant, but the plan’s central safety claim is currently false in two independent ways.

## 1. Blocker — “found in the article” does not mean “written by the author”

What breaks: the verifier proves only that words occur in a body block. It cannot prove authorship.

Concrete case: *Meditations on Moloch* contains an eligible body block quoting Allen Ginsberg: “What sphinx of cement and aluminum…” ([blocks.json](/Users/greg/Dropbox/dev/experim/spideryarn2/data/meditations-on-moloch/blocks.json:45)). It is exactly the sort of striking passage the model will select. [`isBodyEvidence`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/block-policy.ts:126) includes that block, and `findQuote` verifies it perfectly. The UI would then present Ginsberg’s words as the article author’s.

The prompt’s ban on other people’s words is not a safety property.

Do instead:

- If the promise remains “the author’s own words,” deterministically exclude `kind: "quote"`/`blockquote` blocks and any other extracted quoted-source spans.
- Inline quotations still cannot be solved reliably from plain block text. Either add provenance during extraction, or weaken the product claim to “verbatim passages from the article” and preserve attribution where known.
- Add the Ginsberg block as a regression case.
- Explicitly put Quotes under the automatic-stage body policy and add it to [`block-policy-prompts.test.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/block-policy-prompts.test.ts:1), so footnotes and bibliography are excluded both from the prompt and the match search.

## 2. Blocker — `findQuote` accepts altered text, and the plan stores the altered version

The second pass deliberately deletes whitespace ([quote-match.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/quote-match.ts:165)). That gives this real result:

- Article: “the mathematical marriage of convenience starts to **fall apart**, and there is less reason…” ([blocks.json](/Users/greg/Dropbox/dev/experim/spideryarn2/data/noema-mythology-of-conscious-ai/blocks.json:525))
- Model: “the mathematical marriage of convenience starts to **fall a part**, and there is less reason…”
- Pass one: false.
- Pass two: true.

I mechanically verified that result. The proposed object then retains the model’s string, so the reader sees words the author did not write.

Searching every block slightly increases wrong-location risk for duplicate reduced strings, but with the minimum quote length it is not the main problem. The main problem is using a browser-forgiving equivalence relation as a server-side claim of verbatim identity.

Do instead:

- Treat model text only as a locator.
- Once matched, store and display `block.text.slice(span.start, span.end)`, never the model string.
- Prefer the whitespace-preserving pass for server validation. Keep the whitespace-free pass for matching against rendered browser text, where block/HTML whitespace genuinely changes.
- Do not broaden folding merely to reduce drops. Common unhandled rewrites—`…` versus `...`, ligatures, composed accents, guillemets—should fail safely.
- Block IDs would reduce the search space but would not make the model copy bytes correctly. Canonical slicing solves the actual problem without sacrificing the text-renderer cache compatibility.

Dropping unfound candidates remains correct; invented text must never be surfaced as a quote. But a log-only counter is too invisible. Persist a validation summary and show a quiet message such as “3 suggestions were discarded because their wording could not be verified.” Add a test seen failing where `unfound > 0`, including the all-unfound case.

## 3. High — the default contradicts Greg, and the `max` slider inherits false promises

Greg said “By default, display them in order.” The plan nevertheless makes `prioritised` default ([260831j-quotes-mode.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260831j-quotes-mode.md:225)). Glossary’s later override is not permission to override this explicit decision.

Make `document` the default. Prioritised should be an expressly selected sub-mode.

The `0.70` default is not defensible without real score distributions. For example:

```text
(.90,.42) (.90,.88) (.85,.90) (.90,.10) (.70,.70)
max: .90      .90      .90      .90      .70
```

At `0.70`, everything is promoted. At the right endpoint, four quotes remain promoted—not “exactly one,” contrary to the plan’s claim ([260831j-quotes-mode.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260831j-quotes-mode.md:241)). `max` makes top ties particularly likely because either score can create one.

Do instead:

- Evaluate several real articles and record distinct priorities plus `countAbove` across the track before choosing `0.70`.
- Make slider stops correspond to sorted distinct observed scores, with an explicit “all” position. Equal scores should remain tied honestly.
- Change the right-end promise to “all top-scored quotes.”

The missing-score rule is sound: a maximum over known scores is conservatively no greater than the full maximum. Showing both scores is also honest; either could be the winning reason.

## 4. High — the cache saving is only theoretical, and several silent seams are missing

The requests are cache-compatible: model, `medium` effort, `text` renderer, adaptive thinking, article-first system block and bytes agree. `max_tokens` does not spoil that.

But [`cacheArticle`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:355) is enabled only when a later compatible stage exists **in the same job**. Reader actions request `steps: ["glossary"]` and `steps: ["quotes"]` separately. Opening one mode and then the other therefore creates no cache write for the second to read. The plan’s “reader who opens both” saving is false.

Call it “cache-compatible,” not a real saving. If cross-job caching is desired, change the caching policy deliberately and measure whether hits repay the 1.25× write premium.

Other missing seams:

- **Offline:** [`CACHEABLE`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/lib/api.ts:511) lacks `/api/quotes/`. Open Quotes online, disconnect, and reopen it: the article can load offline while Quotes fails. Add the endpoint explicitly.
- **Silent store coverage:** the manual inventories omit `quotes.json`: [`ARTEFACTS`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-roundtrip.test.ts:59), [`OWNED`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/artefact-copy.test.ts:69), the artefact manifest, and [`GATE_FIXTURES`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/deploy-checks.ts:600). With no Quotes fixture, several will remain green silently. Add a synthetic Quotes artefact and independent round-trip/copy assertions; add a deploy sentinel once a committed fixture exists.
- **Sanitiser:** annotation uses app-owned `hit`, `data-hit` and `data-hues`, but the sanitiser strips only `cmt`, `chat`, `term`, `zoomable` and `zoom-btn` ([sanitize-policy.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sanitize-policy.ts:533)). A publisher can supply markup that looks like an app-selected quote/search hit. Reserve and strip those names, bump the sanitiser version, and test them.
- **Labels:** no Quotes-specific change appears necessary.

## 5. Medium — the tooltip reasoning is overstated, and touch is the real accessibility gap

Moving the reason into a tooltip does not improve its linguistic register. It only lowers its visual weight. The prompt ban is what prevents “This page uses the quote to…” boilerplate. Calling the tooltip “stronger” is a rationalisation of a valid UI preference.

The plan is wrong that there is no keyboard route: a quote row implemented as a button is tabbable, and [`Tooltip.tsx`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Tooltip.tsx:169) opens on focus with tooltip semantics. Keyboard and screen-reader access should be tested, not declared absent.

Touch is the actual hole: an uncontrolled hover tooltip has no durable tap-to-open route.

Keep Greg’s tooltip decision, but use a separate “Why?”/info button beside the quote button. Hover or focus opens it transiently; tap or click pins it. Do not nest one button inside the other.

## Decisions I would keep

- Replace rather than append. Sixteen is an editorial cap, not automatically a pagination bug. Evaluate long essays, but append would dilute curation and require a large exclusion protocol.
- Conservative `idsByText` inheritance. A sentence returned with another clause is a different selection and should receive a new ID. Reword the promise: links survive only while the same normalised quote remains selected.
- Quotes is not redundant with Summary or Search. It preserves the author’s texture and provides routes back into the prose; that is squarely aligned with the product vision.

No files were changed.

