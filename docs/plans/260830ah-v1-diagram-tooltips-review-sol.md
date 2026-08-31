Verdict: **CHANGES REQUESTED.** A1’s data-loss path is fixed, but the redundant paid request remains. A2 is only partially fixed. Part B contains misleading copy and two keyboard gaps.

## Findings

1. **P2 — A ready picture still issues another potentially billable POST on every return.**

   Both effects preserve ready state but continue into the request: [useProjection.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useProjection.ts:124), [useSimilar.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useSimilar.ts:102). The server caches only in process; its own documentation says a cold process is normal on Vercel and re-embeds the article for about $0.002: [similar.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/similar.ts:32).

   The catch correctly prevents data loss, but repeatedly toggling can repeatedly spend. If freshness is needed, key it to an article revision/hash; toggling alone is not meaningful invalidation.

2. **P2 — `startedId ?? seenId` makes A2 fail after this mount has ever started a job.**

   Once `startedId` is set, later observed jobs are ignored forever: [useStepJob.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useStepJob.ts:189). Concrete failures:

   - A locally started job succeeds; a later external redraw fails. `seenId` records the redraw, but `stopped` checks the old successful job and reports nothing.
   - A local job fails; a later external job succeeds. After its spinner disappears, the old failure reappears.

   The new test covers only a fresh mount with `startedId === null`. Track the latest relevant job, while retaining the just-started ID until the first poll can see it. Sketch’s persistent failure also needs either dismissal or clearing when a newer run supersedes it.

3. **P2 — Several cards make claims their sources contradict.**

   - Lanes says sideways measures centrality and marginality: [DiagramPanel.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/DiagramPanel.tsx:1017). It actually uses the paragraph’s first principal-component coordinate: [scatter.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/scatter.ts:556).
   - The lane legend says ubiquitous words “drop out”: [DiagramPanel.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/DiagramPanel.tsx:1094). When every score is zero, the algorithm deliberately falls back to raw frequency and may show exactly such a word: [scatter.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/scatter.ts:927).
   - Sketch promises that down-page “is still reading order” and every box jumps or opens: [DiagramPanel.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/DiagramPanel.tsx:177). Acceptance permits flow as low as `0.3` and requires only half the overview nodes to carry block links: [sketch-scene.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sketch-scene.ts:1261).

   The eight-lane cap, tf-idf basis, shared Drift/Trail response, and 760-unit canvas are accurate.

4. **P2 — Lane hover cards remain unreachable by keyboard.**

   Each trigger is a plain, non-focusable `<li>`: [DiagramPanel.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/DiagramPanel.tsx:1098). `Tooltip`’s keyboard route is `useFocus`, so those cards cannot open from the keyboard. This matters because the card contains two terms absent from the clipped chip.

5. **P2, pre-existing on a touched surface — Sketch’s scene radiogroup is unusable from the keyboard.**

   Only the selected scene has `tabIndex={0}`; the rest have `-1`, but there is no arrow-key handler: [SketchView.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/SketchView.tsx:460). A keyboard user cannot select another scene. The comment’s “one tab stop and arrows” claim is false.

## Confirmed fine

- A1’s slug guard is correct. A ready answer for another slug cannot pass it, and aborted older effects cannot commit.
- Keeping a failed hidden revalidation silent is correct while valid data remains.
- Retry remains available for initial/error states where no usable answer exists.
- Widening `failed` to external jobs is conceptually right because all consumers already display external progress; the ID precedence is the defect.
- The corrected embedding-sharing and memo comments are accurate.
- `aria-disabled` is genuinely inert: `canStep` and `stepTo` use the same `stepTarget` condition, including an empty ladder.
- Keeping the disabled arrow focusable and making the readout focusable are defensible for explanation access.
- `Choice` wrap-around, scoped lookup, and `currentTarget` are correct. Tooltip cloning does not change `currentTarget`.
- Multiple `TooltipGroup` providers and conditional children are fine.

The CSS still says retry padding makes it “hittable on a touch device,” contradicting the corrected component comment: [styles.css](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:7029).

The tooltip test is weak: `text.length > 80` plus a document-global tooltip query can accept the wrong verbose card, and it does not cover lanes or any Sketch controls.

Validation: 127 focused tests passed; the web TypeScript project passed. Full typecheck remains red on unrelated shared-tree errors. Browser verification was unavailable because the browser runtime could not initialize. No files were edited.

