Verdict: **CHANGES REQUESTED.** The spinner and retry paths mostly work, but three substantive issues remain.

## Findings

1. **P2 — Returning to a ready mode silently re-fetches and can discard the saved picture.**

   In both hooks, the ready-state guard only prevents painting `loading`; execution continues into the POST:

   - [useProjection.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useProjection.ts:118)
   - [useSimilar.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useSimilar.ts:102)

   Force → Drift → Force therefore sends another similarity request. Drift → Force → Drift sends another projection request. If that hidden refresh fails, the catch replaces the ready data with `NONE`/`IDLE`, removing dotted lines or blanking the scatter. That directly contradicts the comments promising to preserve an answer already paid for.

   The tests cover error → retry, but not ready → disable → re-enable. They should assert no second request and that a failure cannot replace ready data.

2. **P2 — A Sketch redraw failure disappears as though it succeeded.**

   [useStepJob.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useStepJob.ts:141) exposes only queued/running jobs. Its failure state only follows a job started by this hook, but a ready Sketch cannot start a redraw here. Consequently, when a CLI/shelf/other-tab redraw changes from running to error:

   - `view.job` becomes `null`;
   - [the busy line](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/SketchView.tsx:499) disappears;
   - the old picture remains;
   - no failure is reported.

   After a two-minute, $0.20 operation, that reads as silent completion. The new test covers only the steady running state, not running → error. Track a job once this surface has observed it and retain its terminal error long enough to report it.

3. **P2, pre-existing — Force and Projection do not share embeddings, despite repeated claims that they do.**

   [useProjection.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useProjection.ts:14) and [DiagramPanel.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/DiagramPanel.tsx:505) say Force pays for the vectors and Projection then pays only for arithmetic. In fact:

   - [similar.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/similar.ts:294) calls `embedAll` itself.
   - [article-vectors.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/article-vectors.ts:17) explicitly records that only Projection uses the shared cache.

   A cold Force → Drift transition therefore embeds the article twice. This is already documented as debt, but the client comments currently state the opposite as fact.

## The rest is fine

- Error → retry genuinely re-fetches. The unused dependency token is intentional.
- Cleanup aborts the superseded request, and both success and failure paths check the signal before committing state. I found no stale-response winner.
- A retry button is not available while `enabled` is false or while the hook is ready, so those cases do not create a dead visible button.
- The memoised return objects and `useSimilar`’s not-mine branch are correct. The comment claiming this prevents `Waiting` rerendering on scroll is inaccurate because `Waiting` is not memoised, but that causes no functional regression.
- Keeping the button inside `role="status"` is defensible. Its contextual `aria-label` remains useful even though the Force and Projection failures cannot appear together.
- Sketch’s queued wording is correct. A stop-less indicator is defensible for work initiated elsewhere; offering Stop here could cancel another surface’s action. The same `body` is rendered in either the band or dialog, never both.
- The optional-chaining assertions do not falsely pass: each nullable parent is asserted first, while the “spinner stopped” assertion receives `undefined` and fails if the strip itself disappears.
- The Sketch fixture’s `done: true` response is artificial but does not invalidate the assertion: the polled jobs list is the UI’s source, and `done` merely prevents the driver loop.
- Minor browser nit: the standalone Projection retry target calculates to roughly 23.5px high at a 16px root, and the inline Force target is smaller. The “hittable on touch” comment overstates what the padding achieves.

Validation: client and test TypeScript projects pass. The root TypeScript project has unrelated errors in `evals/toc-structure/floor-combined.mts`. Focused Vitest and live-browser execution could not initialize because this review sandbox denies their temporary writes, so visual conclusions are from DOM/CSS inspection rather than a running browser. No files were edited.

