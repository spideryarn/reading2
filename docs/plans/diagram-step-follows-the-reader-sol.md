The diagnosis is right for the reported ordinary case: the panel used a section-granular `atRow`, while Drift/Trail stepped through drawn dots. I found no independent stale memo in that path: `layout` and `here` both depend on the supplied row. But the plan is not ready as written.

The shared tree acquired an in-progress implementation while I was reviewing it; the line references below reflect that current tree. I made no changes.

## Ranked findings

1. High — rapid presses still need a real row chain

A scroll listener will measure intermediate rows during the glide. That is desirable for the moving mark, but wrong as the origin of another press.

Using `glideTarget() !== null` only as a switch to a stored target is almost enough, but there is a final-frame race: `glide()` performs its last `scrollTo` and immediately clears `aiming` ([scroll.ts:467](/home/greg/code/spideryarn2/src/web/scroll.ts:467)). The final scroll measurement and React commit may happen afterwards. A click in that gap sees `glideTarget() === null` and an intermediate `readerRow`. The current in-progress `stepFrom` has exactly that gap ([DiagramPanel.tsx:794](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:794)).

Use the same principle as key navigation:

- While chaining, step from the last target row, never the measured animation row.
- Keep the chain slightly beyond the animation, as `CHAIN_MS` already does ([keynav.ts:66](/home/greg/code/spideryarn2/src/web/keynav.ts:66), [keynav.ts:382](/home/greg/code/spideryarn2/src/web/keynav.ts:382)).
- When no chain is active, measure at press time or read a synchronously maintained ref, rather than trusting state that may be one rAF behind.
- Continue updating visual state during the glide.

Do not copy `positionToWrite`’s “ignore the whole glide” policy. That hook is protecting the URL and deliberately avoids layout reads in flight ([App.tsx:970](/home/greg/code/spideryarn2/src/web/App.tsx:970)); the diagram should visually follow the physical reading line. `glideTarget()` is useful as an in-flight boolean, not as a row.

2. High — a scroll-only measurement becomes stale after reflow

The plan installs and initially runs a scroll listener, but does not invalidate the measurement when the article reflows without scrolling ([plan:47](/home/greg/code/spideryarn2/docs/plans/diagram-step-follows-the-reader.md:47)). Window resizing, column changes, spine changes, and prose rewrapping can put another row under the reading line at the same `scrollY`.

`useReadingPosition` explicitly handles this: its effect depends on `layoutKey` and calls `measure()` immediately because “a column toggle reflows every row without the reader scrolling” ([App.tsx:993](/home/greg/code/spideryarn2/src/web/App.tsx:993)). The proposed hook needs the same invalidation, or a resize/layout observer.

I would still keep this measurement local rather than lift state into `useReadingPosition`. Lifting it would make the whole `Reader` rerender at every paragraph crossing, while a second passive, rAF-throttled listener rerenders only `DiagramPanel`. Also, the URL listener intentionally skips rect reads during glides, while the picture should not. Two listeners here are acceptable; one listener is not automatically one coherent policy.

3. High — apparatus rows need a separate “display row”

The scatters deliberately show no current position in the apparatus. `bodyRowOf` asks the block itself and returns `null` for a note, including a note stranded in the middle of the article ([scatter.ts:322](/home/greg/code/spideryarn2/src/web/scatter.ts:322)). Drift and Trail both honor that ([scatter.ts:540](/home/greg/code/spideryarn2/src/web/scatter.ts:540), [scatter.ts:681](/home/greg/code/spideryarn2/src/web/scatter.ts:681)).

But `DiagramPanel` computes `here` directly with `nodeAt(layout.nodes, readerRow)` ([DiagramPanel.tsx:683](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:683)). Because dot ranges tile gaps, a mid-article note can resolve to the preceding dot. That can:

- mark a dot as current;
- brighten Trail’s chain through `chainNearness`;
- show that dot’s card as “you are here”;
- report the preceding body rung as `N / M`.

That contradicts the apparatus rule even though the ladder itself excludes notes.

Keep two values:

- raw measured row, for deciding where Previous/Next should move from;
- body-only row, for `followsReader`, `here`, Trail highlighting, and the readout.

Outside the body, the honest readout is probably `—` rather than pretending the reader is still at the previous paragraph.

4. Medium — “body block” is not literally “paragraph”

The proposed ladder walks every `isBody` block. But `isBody` means only “not supplement” ([block-policy.ts:75](/home/greg/code/spideryarn2/src/block-policy.ts:75)). Blocks also include headings, code, media, captions, quotes, and other content ([types.ts:27](/home/greg/code/spideryarn2/src/types.ts:27)). A representative fixture has body headings and an image alongside prose paragraphs ([toc-structure-request-parity.test.ts:91](/home/greg/code/spideryarn2/tests/hierarchy-structure-request-parity.test.ts:91)).

So make the design call explicit:

- If “paragraph” is the product’s established name for every body row, retain it but document that convention.
- If it means prose paragraphs, `isBody` is too broad and the ladder needs a narrower definition.
- Otherwise call the unit “passage” or “block.”

The diagnosis should also say that dots can be missing for reasons besides `MIN_WORDS`: non-embeddable blocks and the embedding cap are also skipped ([article-vectors.ts:211](/home/greg/code/spideryarn2/src/article-vectors.ts:211)). The larger diagnosis—dots are not all reading rows—remains correct.

5. Medium — the readout copy becomes false under the proposed ladder

I agree that `N / M` should count the ladder the buttons actually traverse. That makes the number operationally honest.

But the retained hover card currently says the denominator is what “the picture draws” and that the unit is read from “what is actually drawn” ([DiagramPanel.tsx:1580](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:1580)). Under the proposal, the whole point is that many counted paragraphs are not drawn as dots. The comments and project doc repeat the same old rule ([diagram.md:803](/home/greg/code/spideryarn2/docs/project/diagram.md:803), [diagram.md:847](/home/greg/code/spideryarn2/docs/project/diagram.md:847)).

The copy should say that the readout counts the article positions the controls step through, while the status strip separately reports how many received dots.

Previous remains directionally correct, but the “music-player” wording needs care. `measureRow()` returns only a row index ([keynav.ts:209](/home/greg/code/spideryarn2/src/web/keynav.ts:209)). With one rung per body row, it cannot tell whether the reader is halfway down a tall paragraph; from a body paragraph, ↑ therefore goes to the previous rung. The “first go to the top of the current item” rule only operates when the current row lies between ladder starts—for example, with a section ladder or on an excluded row.

6. Medium — the inner panel scroll has no feedback loop, but it follows the dot rather than Drift’s exact line

There is no loop: scrolling `.diag-scroll` does not alter the article row measurement, and the effect only runs when its React dependency changes. The hover guard also prevents the panel moving under a pointer ([DiagramPanel.tsx:835](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:835)).

However, `here` does not change on every unembedded paragraph; several rows can resolve to the same dot. The effect keys only on `here` and centers that dot ([DiagramPanel.tsx:856](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:856)). On Drift, `nowY` can move continuously through a long dotless range while `here` stays unchanged. The exact line could therefore leave the internal viewport.

For Drift, the follow target should be `layout.nowY`; for Trail and Force, the node identified by `here` is appropriate. This matters only on unusually long omitted runs, but it is a real place where the visible mark can fail to follow.

7. Medium — the proposed tests do not cover the risky part

The pure ladder tests are worthwhile, but they do not prove the fix that prompted the plan. The repository already has DOM tests that mount `DiagramPanel` ([diagram-panel-hover.test.tsx:747](/home/greg/code/spideryarn2/tests/diagram-panel-hover.test.tsx:747)), so “the DOM half has no test” is too quick.

At minimum, add regressions for:

- a scroll event changing the marked row without changing `atRow`;
- two rapid button presses during a glide producing two successive targets;
- a non-scroll reflow causing a fresh measurement;
- a mid-article apparatus row producing no mark/readout.

The current pure `paragraphStops` coverage ([diagram.test.ts:300](/home/greg/code/spideryarn2/tests/diagram.test.ts:300)) cannot catch any of those wiring failures.

## Ladder decision

I would switch Drift and Trail to the article’s reading units, not its dots.

The big buttons are for walking the text; dot-level navigation already exists through the picture itself. A control labelled “Next paragraph” that skips a visible paragraph is a broken promise. Trail occasionally moving only the prose is the acceptable cost, provided the middle count changes and its copy explains what is being counted. Drift still gives immediate visual feedback through `nowY`.

## Tooltip removal and `aria-disabled`

Keep `aria-disabled`. Focus stability is a sound independent reason: a focused Next button should not disappear from keyboard focus when the last move makes it unavailable. The click path is genuinely inert because `stepTo` and `canStep` use the same `stepTarget` condition.

There is no newly dead `Tooltip` or `ControlTip` import; both remain used elsewhere in the panel. `STEP_HOW` was specific to the removed cards and was correctly deleted.

There are stale explanations:

- The CSS still says the unavailable button needs `aria-disabled` so its hover card remains reachable ([styles.css:7099](/home/greg/code/spideryarn2/src/web/styles.css:7099)).
- The historical project-doc paragraph still presents that removed card as the justification ([diagram.md:300](/home/greg/code/spideryarn2/docs/project/diagram.md:300)).

The current DOM test has already been adjusted to assert that the two buttons have no cards or `title`, while the middle readout retains its card ([diagram-panel-hover.test.tsx:747](/home/greg/code/spideryarn2/tests/diagram-panel-hover.test.tsx:747)).

So: good diagnosis and the right ladder choice, but I would not approve the plan until the glide chain, reflow invalidation, apparatus semantics, readout wording, and integration tests are specified.