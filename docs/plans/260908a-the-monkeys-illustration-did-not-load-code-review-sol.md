I would not sign this off yet. The normal delivery-failure path is wired correctly, but `unverified` stops one step too early.

1. The retained `img[srcset]` is unverified too. [`swapImages`](/home/greg/code/spideryarn2/.claude/worktrees/feedback-2b-monkeys-figure/src/web/rehost.ts:485) removes `<source>` but preserves the `<img>`’s `srcset`. The assets stage fetched and sniffed only `img[src]`; it knows nothing about those responsive candidates. With width descriptors, the browser ignores `src` and selects from `srcset`, and a failed candidate does not fall back to `src`. That is the same failure class as the poisoned `<source>`, one level down. The [HTML source-set algorithm](https://html.spec.whatwg.org/multipage/images.html#updating-the-source-set) confirms this; the standard explicitly notes that `src` is ignored when `srcset` uses `w` descriptors.

So this fixes Asterisk’s known markup because its PNG candidates apparently work, but it does not justify the general claim that the working `img[src]` becomes reachable. A publisher can have a valid stored `src` and a broken, blocked, expired, or mislabelled `srcset`; this implementation would still produce a blank box.

The smallest reliable `unverified` meaning is: preserve only the publisher’s verified `src`, and remove `<source>`, `srcset`, and `sizes`. That sacrifices responsive resolution on this rare failure path, but it reaches the one URL the pipeline actually fetched and sniffed. Otherwise, the state-driven error cascade should be built now.

2. The broader trade is not simply “more bytes instead of a blank.” `unverified` fires whenever our delivery fails, not when the browser proves the publisher’s `<source>` is broken. During an asset-route outage, it will remove perfectly healthy AVIF/WebP sources across affected articles, potentially replacing working, efficient images with much larger PNG candidates—or with broken candidates. That can be worse than the previous behavior because the previous image was not necessarily blank.

I agree with rejecting imperative mutation of React-owned DOM. That reasoning is sound. An `error` handler should drive article state rather than permanently edit a live element. Deferring that larger mechanism is reasonable, but it does not make retained `srcset` safe.

Everything else on the routine paths looks correct:

- `WAITING` on the first draw is still right. It applies only to the stored/on-page intersection and removes every publisher candidate before rendering, preserving the privacy guarantee.
- `&amp;` keying is consistent because discovery and rewriting both use `imageSourceOf`.
- Duplicate URLs collapse into the same map entry and one fetch; all occurrences receive the same result.
- Mixed PDF figures and web images work: `fillFigures` and `swapImages` both run, and the inserted `blob:` image is not considered rehostable.
- Owner and visitor behavior converge after the fetcher/path selection, so `unverified` is shared correctly.
- A bare `<img>` on delivery failure remains the same block object because `dropSources` returns false. A `<picture>` changes only when a source was actually removed.
- Removing void `<source>` elements and editing attributes preserves rendered text.
- `waiting` and `ours` still share the leak-closing removals, while source removal itself is factored through one helper.

There are two path/test gaps:

- An unexpected rejection from the second-draw chain still reaches [`resolveAccess`’s catch](/home/greg/code/spideryarn2/.claude/worktrees/feedback-2b-monkeys-figure/src/web/article/access.ts:374), which restores `clean` verbatim—including a poisoned `<source>`. Ordinary HTTP, network, abort, and deadline failures are absorbed and reach `unverified`, so this is exceptional rather than the normal delivery path, but “every path” is not presently true.
- The `wanted.images.has(url)` guard is correct but untested in the dangerous mixed case. If that guard were removed, an article containing one stored image and one failed/unmanifested `<picture>` would strip the latter’s sources on the second draw. The existing failed/unknown tests contain no wanted image, so `rehostImages` returns early and never exercises that callback.

The two new tests are not theatre. If by “the `<source>` guard” you mean the `dropSources` calls, both go red without it. The first real-markup test overlaps the synthetic test logically, but supplies valuable regression evidence. The second uniquely exercises the failed-delivery branch. However, it does not assert the promised preservation of `sizes` or the exact `srcset`, and it positively enshrines the unsafe retained-`srcset` behavior. I would replace that expectation with a test proving the known-good bare `src` is the only remaining candidate. I would also add the mixed stored/unhosted-picture test above.

Finally, several statements now contradict the code:

- [`ImagePlacement` still says `null` is the third answer and there are two non-null cases](/home/greg/code/spideryarn2/.claude/worktrees/feedback-2b-monkeys-figure/src/web/rehost.ts:355).
- [`rehostImages` says a failed image is left “exactly as it was”](/home/greg/code/spideryarn2/.claude/worktrees/feedback-2b-monkeys-figure/src/web/rehost.ts:577).
- [`imageSources` says an absent result leaves the element as the publisher wrote it](/home/greg/code/spideryarn2/.claude/worktrees/feedback-2b-monkeys-figure/src/web/rehost.ts:886).
- [The plan says `src/web/rehost.ts` was not edited](/home/greg/code/spideryarn2/.claude/worktrees/feedback-2b-monkeys-figure/docs/plans/260908a-the-monkeys-illustration-did-not-load.md:212).

I did not run tests or typechecking, as requested. The live scoped diff exactly matches `code-diff.txt`.