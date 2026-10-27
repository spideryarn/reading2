## Findings

1. **P0 — `in-a-drawing` can still store the same wrong icon through the locator.**

   The refusal is made locatable ([collect-pdf-figures.ts:294](/var/tmp/spideryarn-worktrees/fbm40r6t-lecun-figure-12/src/collect-pdf-figures.ts:294)), but every locator answer first passes through `judgeLocatedBox`; a successful single-picture verdict stores that bitmap immediately, without consulting vector ink ([collect-pdf-figures.ts:996](/var/tmp/spideryarn-worktrees/fbm40r6t-lecun-figure-12/src/collect-pdf-figures.ts:996)). `judgeLocatedBox` checks only image paints and can accept a tight box around the Earth icon ([pdf-figure-locate.ts:180](/var/tmp/spideryarn-worktrees/fbm40r6t-lecun-figure-12/src/pdf-figure-locate.ts:180)). The composite route runs only after that judge refuses.

   Thus a model that returns the icon rather than the diagram recreates the original unacceptable wrong-picture result. The oracle replay cannot expose this because its boxes deliberately surround the whole drawing.

   **Suggestion:** carry the held failure reason into `locatedRoute`. For `in-a-drawing`, never accept `judgeLocatedBox`’s bitmap choice; require `judgeLocatedRegion` and a rendered region. Add a regression where the scripted locator boxes only the icon and assert that it remains missing, never stored.

2. **P0 — the PDF recovery policy must be bumped; re-extraction alone does not make this change current.**

   The plan says not to bump `ASSETS_VERSION` and claims the article will change when re-extracted ([plan:128](/var/tmp/spideryarn-worktrees/fbm40r6t-lecun-figure-12/docs/plans/261027e-a-picture-inside-a-drawing-is-not-the-figure.md:128)). But this is exactly what `PDF_FIGURE_RECOVERY_POLICY` exists for: it must change whenever the PDF half decides differently for the same markers ([collect-assets.ts:515](/var/tmp/spideryarn-worktrees/fbm40r6t-lecun-figure-12/src/collect-assets.ts:515)). The policy is currently `/7` and is part of `assetsInputHash` ([collect-assets.ts:643](/var/tmp/spideryarn-worktrees/fbm40r6t-lecun-figure-12/src/collect-assets.ts:643)).

   Re-extracting the same PDF with the same captions produces the same stable refs, so the old manifest can still report current—including the three wrong Earth pictures.

   **Suggestion:** keep `ASSETS_VERSION` unchanged, but bump `PDF_FIGURE_RECOVERY_POLICY` to `pdf-figures/8`, update its pinned test and history, then rerunning assets or re-importing will actually exercise the new rules.

3. **P1 — the per-picture 25% rule reopens the cross-page duplicate hole.**

   The new check records an identity only when one picture alone covers 25% of the crop ([collect-pdf-figures.ts:1153](/var/tmp/spideryarn-worktrees/fbm40r6t-lecun-figure-12/src/collect-pdf-figures.ts:1153)). Therefore a repeated six-photo grid has no picture identities at all. Exact rendered-raster identity is insufficient when two model boxes differ slightly—the reason the 261001q review added contained-picture identities in the first place. A caption beside each repeated region proves local association; it does not prove the two regions are different figures on different pages.

   **Suggestion:** retain every substantially contained picture with its covered crop area, then conflict regions when the **aggregate union area of identities shared by both regions** exceeds a threshold in both crops. Two shared 2–3% icons remain harmless; six shared 17% photos collectively cover nearly the whole crop and still trigger the duplicate defence. Add a repeated-grid test with slightly shifted crop boxes so exact render hashes differ.

4. **P1 — failing the layout read open chooses the unacceptable side of the product bar.**

   A missing layout or paint box currently preserves the bitmap pairing ([collect-pdf-figures.ts:1202](/var/tmp/spideryarn-worktrees/fbm40r6t-lecun-figure-12/src/collect-pdf-figures.ts:1202)). That can preserve precisely the wrong icon the new rule exists to remove. The drawn-route analogy in the plan is not equivalent: when its layout read fails, it leaves a `no-raster` refusal standing; it does not leave an already accepted, potentially wrong picture standing.

   **Suggestion:** fail closed with a distinct reason such as `layout-unreadable`. It may be locatable only if the located route retries the layout and is forced through the composite judge; otherwise leave the figure visibly missing. Under the stated bar, missing is preferable to a plausible wrong picture.

5. **P1 — the rule detects only connected vector augmentation, not the wider “picture is the whole figure” failure.**

   `drawingAround` follows only path boxes within six points of the picture or another joined path ([pdf-figure-region.ts:649](/var/tmp/spideryarn-worktrees/fbm40r6t-lecun-figure-12/src/pdf-figure-region.ts:649)). Consequences:

   - A bitmap panel beside disconnected vector panels remains a false negative and may still be stored as the whole multi-panel figure.
   - A raster heatmap with a separately drawn colour bar remains a false negative when the gap exceeds six points.
   - A connected callout arrow normally causes the correct refusal—the raw photo would omit part of the figure—but a long thin incidental rule can enlarge the bounding box past 3×.
   - A figure frame near a caption separator can chain into it. `withoutFurniture` removes wide rules only in the outer page margins ([pdf-figure-region.ts:890](/var/tmp/spideryarn-worktrees/fbm40r6t-lecun-figure-12/src/pdf-figure-region.ts:890)), not an interior caption rule.
   - Text labels do not participate unless connected through vector ink.

   **Suggestion:** describe this narrowly as a connected-drawing detector, and add the layouts above as explicit tests. Given that a wrong bitmap panel is forbidden, I would also add a conservative refusal for a small bitmap accompanied by substantial disconnected vector ink in the caption-adjacent figure band, leaving the locator to resolve ownership.

   The calibration should use the exact shipping helper. The supplied script touches each new path against the growing union box and excludes paths over 50% of the page ([measure.ts:25](/tmp/claude-1000/-home-greg-code-spideryarn2/1ae3039e-5b97-43ea-ab29-64ab10903cc8/scratchpad/measure.ts:25)); the implementation chains individual paths and excludes only those over 75%. I reran the exact helper for LeCun and confirmed 17.05, 28.21 and 30.71, so the target works, but the corpus-wide false-positive claim should be rerun with that same helper.

6. **P1 — the new batch layout read can turn unrelated valid bitmaps into `out-of-time`.**

   All paired pages are layout-read before any paired bitmap is stored ([collect-pdf-figures.ts:507](/var/tmp/spideryarn-worktrees/fbm40r6t-lecun-figure-12/src/collect-pdf-figures.ts:507)). This contradicts the immediately following invariant that bitmap outputs are recorded before new layout/render work so slow work cannot erase them ([collect-pdf-figures.ts:525](/var/tmp/spideryarn-worktrees/fbm40r6t-lecun-figure-12/src/collect-pdf-figures.ts:525)). If the shared deadline fires during this read, the collector returns before storing any pairing and finalises them all unfinished.

   **Suggestion:** judge and settle paired pages incrementally, so a later slow/broken page cannot erase already checked figures. Add a deadline regression with two paired pages where the second layout read stalls and the first remains stored.

7. **P2 — raising the cap to 16 is reasonable, but its accounting and documentation are incomplete.**

   I agree with the increase: `MAX_LOCATE_LOOKS = 24` still accommodates 16 calls, and the ceiling test imports the constant rather than pinning 8. The 180-second clock also remains a hard bound.

   However, captioned and uncaptioned allowances add, so a mixed document can now attempt 16 + 40 calls, not merely 16 ([collect-pdf-figures.ts:275](/var/tmp/spideryarn-worktrees/fbm40r6t-lecun-figure-12/src/collect-pdf-figures.ts:275)). The measured Rovelli run took 76 seconds for 28 calls ([investigation:23](/var/tmp/spideryarn-worktrees/fbm40r6t-lecun-figure-12/docs/investigations/261019a-uncaptioned-pdf-figures-located-on-rovelli.md:23)), while this paper’s six calls took 22 seconds, so “16 calls is at most 40 seconds” is too definite. The clock makes this safe, but later uncaptioned figures may be truncated.

   Update the stale “eight” promise in [ai-gateway.md:946](/var/tmp/spideryarn-worktrees/fbm40r6t-lecun-figure-12/docs/project/ai-gateway.md:946), and record the new rule and cap in `article-images.md`. The linked postmortem at plan line 14 also does not currently exist.

## What I agree with

The diagnosis of all seven failures is convincing. Computing `taken` only after the new refusal is correct. The 3× threshold has excellent separation on the measured connected cases, and the exact helper reproduces LeCun’s three ratios. I also agree with increasing the locator cap to 16. I do not agree with fail-open layout handling or with the per-picture 25% duplicate criterion as currently proposed.