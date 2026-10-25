# Code review: 261025k items 1 and 3

You are reviewing, and fixing, two committed changes in this worktree. **You may edit files**, but
stay inside these two changes: fix what is wrong in them, narrowly and red-first (a failing test
before the fix where there is a bug). Report, do not fix, anything wider you notice. Do not commit,
and run no git command that changes state.

**The candidate**: commits `019479ab4` (item 1, one email frame) and `c8c25e588` (item 3, Sketch's
label face and measure as one constant), on top of `d350b895d`. Diff:
`git diff d350b895d c8c25e588`. Changed paths: `git diff --name-only d350b895d c8c25e588`. Start
with src/email-frame.ts, src/store/pg-voucher-emails.ts, tests/email-frame.test.ts,
src/sketch-scene.ts, evals/sketch/svg.ts, src/web/SketchView.tsx, tests/sketch-label-face.test.ts;
that list does not limit scope. The plan is docs/plans/261025k-fonts-and-css-code-quality.md
§ 1 and § 3, and its plan review is …-plan-review-sol.md beside it.

**What must hold**

- Item 1: every email renders byte for byte as before (gift emails from `giftMessage`, the two
  templates unchanged), and tests/email-frame.test.ts fails when any part of the frame drifts in a
  template or in the TypeScript. Look for a part of the frame the test does not actually pin (it
  checks prefix and suffix — is anything between them shared but unchecked, e.g. the heading row,
  the button row wrapper, the "after" row?), and for a way the test could pass vacuously.
- Item 3: nothing renders differently (`CHAR_W` is still exactly 0.53 for "ui"; the browser
  `<svg>` gets `voice-ui`, which must compute to the same font it inherited before, in the band
  and in fullscreen); the measurement test cannot pass vacuously (e.g. a font that failed to
  register silently falls back to a default face — does napi canvas do that, and would the test
  notice?); the exporter's new stack is right; the import of `src/web/voice.ts` from a server module
  is acceptable here (check how other server modules do it and whether any lint/boundary test
  forbids it). Docs (fonts.md point 4, email.md) say what the code does.

Run: `npx vitest run tests/email-frame.test.ts tests/auth-email-templates.test.ts
tests/sketch-label-face.test.ts tests/sketch-scene.test.ts tests/sketch-paint.test.ts
tests/voices-css.test.ts` and `npm run typecheck`. Tests needing Postgres
(billing-voucher-emails) you cannot run: say so rather than counting them.

**Severity**: P0 production breakage or data loss; P1 a stated property does not hold (renders
differently, a test that cannot fail); P2 a real smaller defect or clearly simpler route; P3 nit.
Every finding gets an ID (C1, C2…), severity, file:line evidence, and either "fixed: <what, and
the red→green>" or "reported".

My suspicions, last: the `voice-ui` class on the `<svg>` in fullscreen (outside `.mode-band`);
napi's silent fallback; `FONT_STACK_BY_VOICE` duplicating tokens.css (the test checks equality —
is a duplicate checked by a test the right trade over deriving it?).
