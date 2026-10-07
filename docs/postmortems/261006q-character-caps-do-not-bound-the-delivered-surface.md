# Character caps do not bound the delivered surface

Review of fleet preview candidate `7dd717b35` found a pointer-inert tooltip that could grow beyond
the window. This review changed only the worktree; it did not change the live dashboard. The stage
and its constraints are in [261006l § Stage 2](../plans/261006l-borrow-the-reading-app-s-machinery-for-the-fleet-dashboard.md#stage-2-a-preview-card-on-each-session-in-the-left-column).

## The class: measuring only the fields the implementation chose to bound

`SessionPreview.tsx` limited description and prompt to 600 characters and menus to six entries.
Heading, status reason, repository/worktree, directory and individual option labels bypassed the
limiter. The wire parsers accept arbitrarily long strings. The delivered tooltip had a maximum
width, but no maximum height; Floating UI's placement does not make an oversized surface fit.
Even bounding every string would not bound their combined height under wrapping and font changes.

All these paths were introduced by `7dd717b35`. The bounds test used long description and prompt,
but short values for every other field, reproducing the implementation's assumption. Five new
parsed-wire cases failed because `UNREACHABLE-TAIL` remained in the output; a sixth failed because
the complete surface had no bounded body. The sibling failure is
[261003f](261003f-bounding-an-intermediate-representation-while-emitting-a-larger-serialized-response.md).

## The fix and the checks

Every displayed variable text field now uses the limiter. The complete body's height is capped
against the viewport, and measured overflow gets a notice outside that body. Observing both body
and content catches font/wrapping changes even when the body's height is already capped. Pushed
rows also trigger remeasurement. The notice has reserved space and cannot clip itself or cause the
overflow it reports. The surface remains text and contains no controls.

`tests/fleet-session-preview.test.tsx` retains the original tests and adds the six red-first cases,
plus guards for the captured menu's coverage, no reads on hover/focus, and current pushed data in
an open preview. The latter two were calibrated with temporary mutations: the original nine tests
passed with a swallowed `fetch`, and passed with a cached old row under a live heading. The new
guards failed on the actual fetch call and old prompt respectively. Both mutations were removed.

## Countermeasures, ranked by cost and value

1. **Lengthen every rendered field independently in parsed-wire fixtures.** Cheap; implemented.
   Do not select fields according to which ones the code already caps.
2. **Bound the delivered surface and expose measured overflow.** Implemented with a viewport cap
   and a notice outside the clipped content. A character budget is not a layout budget.
3. **Check geometry in a short real-browser viewport with maximal fields.** More expensive;
   the separately running browser review should check this new limit as well as placement and touch.
4. **Rejected: more character caps as the sole fix, or relying on flip/shift.** Neither handles
   combined height. A scrollable preview was also rejected: its pointer-inert surface and lack of
   focusable contents would make the scroll affordance unreachable.

Up: [Postmortems](../project/postmortems.md)
