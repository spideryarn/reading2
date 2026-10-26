# Sketch's labels in the AI font

Greg answered [q-ugekcv](../user-feedback/questions/q-ugekcv.md) on 2026-10-25:

> Stick with the rules. If it's AI generated, then it should use the AI font.
>
> — Greg, 2026-10-25 (reply spya-k94hya)

That is option B. The groundwork is
[261025k § 3](261025k-fonts-and-css-code-quality.md#3-sketchs-labels-measured-in-the-face-they-are-drawn-in):
the face Sketch's SVG labels are drawn in and the width they are wrapped at are one constant,
`SKETCH_LABEL_VOICE` in `src/sketch-scene.ts`, and
[`tests/sketch-label-face.test.ts`](../../tests/sketch-label-face.test.ts) already holds the `ai`
entry of `CHAR_W_BY_VOICE` (0.60) to Quattro's measured width.

## Do

- Flip `SKETCH_LABEL_VOICE` from `"ui"` to `"ai"`. That one word moves the `<svg>`'s `voiceClass`
  (so voices.css draws node, edge and region labels in iA Writer Quattro), the offline exporter's
  font stack, and `CHAR_W` for both the painter and the server's `nodeFits`, which scores the
  labels that overflow (logged, not sent back: the model is called once). Server and browser still
  agree, because they read the same constant.
- **The prompt's line length comes from the same measure** (Sol's plan review, P2). It said "a box
  200 wide holds about 31 characters", written by hand and already stale for Geist (29); at 0.60 it
  is 26. It is now `charsThatFit(200, "sm")`, and `tests/sketch-label-face.test.ts` holds the prompt
  to it (seen red with 31). `SKETCH_SYSTEM` is exported for that test.
- **`SKETCH_VERSION` to `sketch/6`**, because the prompt changed. That marks the stored sketches
  not current in the stages list, and redraws none of them: Sketch runs only when a reader presses
  Draw or Regenerate, and no cascade sweeps it in (src/pipeline.ts, the on-demand steps).
- Correct the comments that say "still ui" (`sketch-scene.ts`, `voices.css`), and the docs:
  [fonts.md](../project/fonts.md) (§ point 4, and § Not yet in a voice), the 261025k plan, and the
  question file (reply quoted, `acted:`, `status: answered`).
- No test pins `"ui"` as the drawn voice; the face test and the zoom test read the constant. Any
  test whose fixture wraps differently at 0.60 is updated to the new boundary, not loosened.

## Not doing

- **Option C, redrawing the 170 stored sketches.** Not chosen. Nothing in production is touched.
  Old pictures will show more labels cut short with "…" (49 → 174 of 4,636, measured 2026-10-25)
  until a reader redraws them; each shape's card still shows its full text. New sketches adapt,
  because the prompt states the line length at the new width.
- **Simpler option passed over: a CSS-only switch** (put the svg in `voice-ai` and leave `CHAR_W`
  at 0.53). Fewer lines, but labels would spill out of their shapes, and the server would score fit
  in a face nobody draws. That drift is what 261025k § 3 made impossible.

## Reviews

- Plan: [261026c-…-plan-review-sol.md](261026c-sketch-labels-in-the-ai-font-plan-review-sol.md).
  P2 (the prompt's 31) is fixed above; P3 (the overflow count is not feedback) is corrected here, in
  `sketch-scene.ts`, in 261025k and in the question's settled note.
- Code: [261026c-…-code-review-sol.md](261026c-sketch-labels-in-the-ai-font-code-review-sol.md).
  One P2, fixed by Sol: every test read the constant, so reverting it to `"ui"` passed; a test now
  pins `"ai"`. Its audit of the version bump found no path that redraws a stored sketch, and
  Illustrated still paints from an older-version Sketch.

## Checks

`npm test`, `npm run typecheck`; a Sol plan review before building and a Sol code review before
pushing.
