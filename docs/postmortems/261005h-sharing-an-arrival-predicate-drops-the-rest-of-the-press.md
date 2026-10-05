# Sharing an arrival predicate drops the rest of the press

Owned by [postmortems.md](../project/postmortems.md).

Commit `11ae9db7f` gave the command bar a Search opener. It restored a hidden rail
but omitted the mode herald that the Dock's Search opener showed. The regression
in `tests/mode-herald-wiring.test.tsx` opened Search through the actual command row
and failed with `expected '' to contain 'Search'` before the fix.

The root-cause review ran in the `arrival_root_cause` subagent. The class is
**partial duplication of an activation callback**: extracting its rail predicate
looked like reusing the arrival, while its other visible consequence stayed in
the composition root. The stage tests supplied a fake opener, so neither their
green result nor the rail predicate's unit test could detect the omission.

The fix shares the Search opener between the command row and the Dock's Search
arrival. It shows the band, announces the press, and applies the rail rule.
Ordinary prose-card openers keep their existing behavior. The regression now
passes; it also presses Back and checks the previous mode, matcher and rail.

The durable countermeasure is to exercise a new control through Reader, rather
than only asserting that it calls an injected opener. The added tests also cover
the existing Dock quick-search opener and the Search mode button's closing press.
This protects this Search seam; it is not an audit of every Reader opener.

Review findings and validation: [261005i, F6–F7](../plans/261005i-the-command-bar-opens-quick-search-and-the-search-panel-box-gets-a-clear-cross.md#review-ledger).
