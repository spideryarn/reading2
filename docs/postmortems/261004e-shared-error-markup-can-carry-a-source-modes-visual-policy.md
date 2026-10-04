# Shared error markup can carry a source mode's visual policy

The sweep cluster 5 stage 1 review caught a visual regression in Sketch and Illustrated: the new
shared read-failure sentence used Glossary's `--highlight-ink`, although Diagram intentionally says
failures in `--ink-faint`. No production incident was established. Review finding F15, P2, was
repaired with one rule scoped to the Diagram band.

## The class: sharing markup silently shares the source mode's presentation policy

`64e947f0e` extracted FAQ's sentence and retry into [ReadError](../../src/web/ReadError.tsx), then
used it across the modes. Its paragraph keeps `className="gloss-error"`, whose existing colour is
`--highlight-ink`. The component's contract describes shared markup and exposes a wrapper class
for gutters, but the reused paragraph also brings a colour policy. Diagram's consumers did not
override it.

The intended quieter colour is explicit beside `.sk-failed` in
[diagram-sketch.css](../../src/web/styles/diagram-sketch.css), introduced in `6ec9e0ad34`, and
Illustrated's `.ill-failed` uses the same token. Read and job failures consequently acquired
different emphasis in the same band. This is a policy migration hidden inside a markup extraction,
rather than an intentional design change.

## Why the initial check agreed with the defect

The mode matrix checks the sentence, retry behaviour and retained artefacts; it says nothing about
colour. An initial review test compared jsdom computed colours and was green on the broken code.
A positive control exposed that the comparison was satisfied by default values, so it was
discarded rather than accepted as evidence.

The replacement uses the existing stylesheet guards in
[diagram-css.test.ts](../../tests/diagram-css.test.ts). *Diagram's read failures keep the quiet
colour of its job failures* was red before the fix: expected `var(--ink-faint)`, received
`undefined` for the missing scoped rule. It also asserts the existing Sketch and Illustrated failure
tokens and the shared component's paragraph class, keeping the comparison tied to the actual seam.
The final core run passed four files and 117 tests, including this guard; the broader review run
passed 31 files and 972 tests, with typechecking clean.

## What would have caught it, ranked by ease against value

1. **Compare the destination's declared token with its existing sibling failures** — one small
   stylesheet guard, added and seen red before the repair. It catches the policy difference without
   depending on jsdom resolving custom properties.
2. **Inspect destination CSS when extracting shared markup** — cheap: a class is more than a
   selector name. Check which decisions it carries into every new consumer.
3. **A scoped destination override** — the shipped repair, preserving Diagram's colour for both
   picture modes while the shared component remains markup only.
4. **Add colour variants to the component or a new styling abstraction** — rejected for this
   repair. One established band policy needs one local rule, and extra props would move that policy
   away from the stylesheet that owns it.

## The fix that is right for the long term

Keep shared structure and mode presentation separable. Here the appropriate boundary is the
existing `.mode-band.diag`: its scoped read-error rule supplies `--ink-faint`. A new generic error
theme system adds no value for this single established exception. Computed-colour tests need a
positive control before being trusted; equal fallback values cannot prove the CSS policy held.

Up: [Postmortems](../project/postmortems.md).
