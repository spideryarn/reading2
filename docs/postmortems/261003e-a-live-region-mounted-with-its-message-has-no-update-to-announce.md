# A live region mounted with its message has no update to announce

Caught in the code review of [261003k](../plans/261003k-referee-mode-puts-the-actions-first-and-the-notices-behind-one-button.md),
2026-10-03, before landing. Root cause independently checked in a read-only subagent.

## Cause and class

Commit `2da53b7e28d8adf2e3ea360d2d9eea30661a5af7` moved the source scan inside the
conditionally rendered Notices box in `RefereeFrame`
([RefereeMode.tsx](../../src/web/modes/referee/RefereeMode.tsx)). Loading renders no box;
findings open it and mount `SourceScanNotice`, including its already-populated polite live region.
Before this change, that region existed during loading and its contents changed when the result arrived.

The class is **mounting an announcer with its announcement**: a visual disclosure can appear
correctly while removing the update that assistive technology observes. A polite live region needs
to exist before its content changes; initial content is not a reliable announcement.
[MDN's live-region guidance](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions)
describes this prerequisite and the variation between browser and screen-reader combinations.

The original tests measured visible opening, text and order. They proved those things but did not
measure the announcer's lifetime. The existing `aria-live` attribute still looked correct in code.

## Fix and evidence

Keep a visually hidden polite status mounted in the frame's top row. It starts empty while the
scan loads and reports findings using the same `sourceScanOpens` predicate as Notices. Its words
say there is text to inspect, without treating a labelled or visible finding as proof of an attack.
The visible box keeps its existing conditional rendering and height cap.

`tests/referee-notices.test.tsx` now captures the empty region during loading, delivers findings,
and verifies that the same node gains the notification. It failed on the initial lookup before
the fix and passed afterwards. Muting the notification also fails the test. This proves the DOM
prerequisite, not actual speech; assistive-technology verification remains separate.

## Countermeasures, ranked by ease against value

1. **Test the announcer before and after an asynchronous result**, including node identity.
   Cheap and done here; it catches a conditional wrapper above an otherwise unchanged live region.
2. **Verify asynchronous notices with a screen reader.** More costly and valuable for actual speech;
   a visual browser pass cannot provide that evidence.
3. **Keep every collapsed disclosure's content mounted.** Rejected as a general fix: it couples
   visual disclosure state to every child's lifetime. A persistent status gives the announcement
   its own lifetime with one small element.

Up: [postmortems.md](../project/postmortems.md)
