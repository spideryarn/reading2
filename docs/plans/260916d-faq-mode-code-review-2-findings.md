# FAQ mode stage 2 — GPT Sol code-review findings

Review of commit `0e947eb4` against `docs/plans/260916d-faq-mode.md`,
`docs/project/new-mode.md`, and the stage-1 contract in `301101e6`.

## Findings

### D1 — P1 — a failed FAQ read is a dead end in the band

**Evidence:** `src/web/FaqPanel.tsx:133` draws only the error sentence, while the `UseFaq` contract in
`src/web/useFaq.ts:32-64` exposes no read-only retry. `useAutoRun` can repeat a failed opening read
once when a Dock press is still armed, but a direct `?mode=faq` arrival has no activation to do that,
and a second failed read after a press reaches the same inert state.

**Consequence:** a transient GET failure leaves the reader with no in-product way to recover. The
only apparent action is a page reload or leaving the mode, neither of which the band explains; this
is the failed-read dead end the state review was meant to catch.

**Fix:** expose a read-only retry from `useFaq`, and draw a labelled *Try again* control beside the
error. Preserve an already loaded list while retrying a failed post-job revalidation; do not POST or
arm a model run from this control.

### D2 — P1 — FAQ questions skip a heading level

**Evidence:** the article title is the page's `h1` (`src/web/Masthead.tsx:161-171`), FAQ deliberately
has no `band-head` or hidden mode heading (`src/web/FaqPanel.tsx:113-131`), but every top-level FAQ
question is an `h3` (`src/web/FaqPanel.tsx:187-203`). The band's `aria-label` names a complementary
landmark; it does not introduce an `h2` into the document heading hierarchy.

**Consequence:** heading navigation announces top-level questions as third-level sections beneath
no second-level heading. A sighted reader sees the intended flat question list, while a reader
navigating by headings is given a hierarchy that is not present.

**Fix:** render each top-level question as `h2`, keeping its visual class unchanged, and pin that
semantic level in the panel test.

### D3 — P3 — the mode card repeats copy already pinned under the list

**Evidence:** `src/mode-catalog.ts:465-479` puts both *no answer is written* and the checked-words /
model-pairing qualification in `how`; `src/web/FaqPanel.tsx:47-52,124-129` repeats that qualification
in the band's foot. `docs/project/new-mode.md:147-150` explicitly says the card's second sentence
must not restate what is already on screen.

**Consequence:** on the reading-view surface, opening the card spends attention to repeat the band's
own disclosure instead of telling the reader something new. The extra-long `how` is also harder to
scan in the command/button cards.

**Fix:** keep the stored-model-pass fact, then use the second sentence for the non-obvious ordering
rule: questions follow the earliest answering passage, not claimed popularity. Keep the stronger
checked-words/model-reading disclosure at the point of use in the band foot.

### D4 — P2 — the panel test does not protect which button is forced

**Evidence:** `tests/faq-panel.test.tsx:178-204` checks that the empty, failed-job, stale and outdated
controls are present, but never presses one or observes `ensure` versus `regenerate`. The distinction
at `src/web/FaqPanel.tsx:92-110` is a billing/work-key invariant: the empty control must use the same
unforced request as auto-run, while stale/outdated must force replacement.

**Consequence:** changing the empty-state button to `regenerate`, or a stale button to `ensure`,
leaves the whole panel suite green. That permits a duplicate paid run in the first case and a
no-op instead of replacement in the second.

**Fix:** add button-action assertions with separate `ensure` and `regenerate` spies. Confirm the hole
with a temporary mutation before strengthening the test.

## Reviewed and not findings

- When both `stale` and `outdated` are true, showing the stale banner alone is deliberate: one forced
  rerun repairs both, stale is the warning that can invalidate the passage jump, and the sibling
  artefact panels make the same choice to avoid stacking warnings.
- `droppedCount` combines nested question and passage omissions, but its wording says exactly that:
  *questions or passages*. The line is a quiet disclosure that validation shortened the model's
  answer, consistent with other generated-list modes; it does not claim a count of unique questions.
- FAQ remains owner-only: the visitor branch resolves to `VisitorBand`, does not mount `FaqBand`, and
  therefore cannot issue `GET /api/faq/:slug` or start a job.
- The FAQ selectors are feature-specific (`.faq-*`) and the only borrowed selectors are applied by
  FAQ markup intentionally; no candidate rule broadens a shared selector outside the band.
