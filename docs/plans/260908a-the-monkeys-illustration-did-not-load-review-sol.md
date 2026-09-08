I would not sign this off as written. The reported incident is fixed, but the plan overlooks a cheap defence for the remaining failure class and contains several material inaccuracies.

1. The deferred fallback presents a false choice. [The plan considers only stripping every `<source>` eagerly](/home/greg/code/spideryarn2/.claude/worktrees/feedback-2b-monkeys-figure/docs/plans/260908a-the-monkeys-illustration-did-not-load.md:241), which would indeed penalise healthy images. The browser can instead react only when an injected `<img>` fires `error`:

   - If it is inside `<picture>`, remove the sibling `<source>` elements and let resource selection rerun against the `<img>`’s PNG `srcset`.
   - If that also fails, remove `srcset`/`sizes` and retry the base `src`.
   - Record the fallback stage so it cannot loop and survives a prose rerender.

   This costs healthy images nothing and directly repairs the reported class. If the brief requires building something, this is what I would build.

   It also covers a missed third remainder: we can hold a stored copy yet fail to deliver it. `imageSources` absorbs individual failures, after which the second draw rebuilds from the original publisher markup ([rehost.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-2b-monkeys-figure/src/web/rehost.ts:559), [imageSources](/home/greg/code/spideryarn2/.claude/worktrees/feedback-2b-monkeys-figure/src/web/rehost.ts:857)). That restores the poisoned `<source>` and produces the same blank figure. Therefore “when we do hold a copy … we are immune” is false.

2. The diagnosis is now established, not merely plausible, because the controlled Chrome reproduction observes the AVIF as `currentSrc`, `naturalWidth: 0`, then the working PNG after removing `<source>` ([plan](/home/greg/code/spideryarn2/.claude/worktrees/feedback-2b-monkeys-figure/docs/plans/260908a-the-monkeys-illustration-did-not-load.md:97)). That rules out CSS, extraction, and a broken PNG. The browser also does not fall through to later picture candidates after the selected resource fails; the HTML resource-selection model supports that conclusion.

   The mechanism is described at the wrong layer, however. `X-Content-Type-Options: nosniff` does not generically block image destinations in the Fetch Standard; its standard blocking check covers script and style. Chrome’s cross-origin ORB implementation separately blocks an opaque `text/plain` response carrying `nosniff`, before the image decoder receives usable bytes. So replace “Chrome refuses to decode” and “the decode was refused” with “Chrome’s ORB blocks the cross-origin response.” See the [Fetch Standard](https://fetch.spec.whatwg.org/#should-response-to-request-be-blocked-due-to-nosniff?) and [Chromium’s ORB implementation](https://chromium.googlesource.com/chromium/src/+/138.0.7204.49/services/network/orb/orb_impl.cc).

3. “Ship no fix for this exact article” is defensible. At `84521f3b`, `rehostImages` genuinely handled only PDF figures. `c0fb04a4` contains `5f79493b`, and its `swapImages` removes `srcset`, `sizes`, and sibling sources ([current implementation](/home/greg/code/spideryarn2/.claude/worktrees/feedback-2b-monkeys-figure/src/web/rehost.ts:445)). The later three successful asset requests are strong production evidence that this article traversed that path. The current regression test also passes: 43/43 tests in `tests/rehost.test.ts`.

   Thus “the incident was already cured by a later deployment” is not a dodge. “There is nothing useful left to build” is too strong because of finding 1.

4. The resolution remainder is correctly identified and reasonably deferred. The current selector really is only `img[src]` ([assets.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-2b-monkeys-figure/src/assets.ts:311)), and the lightbox deliberately avoids upscaling ([lightbox.css](/home/greg/code/spideryarn2/.claude/worktrees/feedback-2b-monkeys-figure/src/web/styles/lightbox.css:147)). The reported 311 px includes the image’s horizontal padding; it is consistent with 300 px of image content rather than contradictory evidence of upscaling.

   But “teach `sniffImage` AVIF and WebP” is not a complete option. Those URLs are never selected or fetched: `imageSourceOf` reads only the fallback `img[src]` ([assets.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-2b-monkeys-figure/src/assets.ts:360)). AVIF support also requires responsive-candidate selection, manifest/hash semantics, `AssetExt`, bucket MIME configuration, and delivery tests. Merely adding magic bytes to `sniffImage` changes nothing for this article.

5. Concrete corrections:

   - “The fix had landed 38 minutes before the report” is false. It was committed 38 minutes after the old build was cut, roughly 15 hours before the report, and deployed only after the report ([plan](/home/greg/code/spideryarn2/.claude/worktrees/feedback-2b-monkeys-figure/docs/plans/260908a-the-monkeys-illustration-did-not-load.md:119)).
   - “Reached production later the same day” is ambiguous or wrong relative to the September 6 commit; say “later on September 7, after the report.”
   - The new real fixture did not replace the synthetic fixture; the diff retains both. [“Instead of”](/home/greg/code/spideryarn2/.claude/worktrees/feedback-2b-monkeys-figure/docs/plans/260908a-the-monkeys-illustration-did-not-load.md:154) should be “alongside.”
   - `budget` and `out-of-time` are reasons on a `status: "failed"` entry, not alternatives to `failed`.
   - The reproduction directly establishes that the monkeys figure was blank. “All three figures were blank” remains an inference unless each was exercised or its selected response was checked.
   - The test/docs/note are currently modified or untracked, so “What shipped here” is premature; only the earlier code fix has shipped.

My disposition: close the original incident as fixed, but revise the plan and either build the error-driven fallback or explicitly defer that better option—not only the eager stripping straw man.