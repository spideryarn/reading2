# Navigation tests replaced the destination's lifecycle

Review of `6f357c3e5` found that “Skip to modes” did nothing during the dock's
one-second entrance delay. The candidate was under review; this review found no
evidence of the defect reaching production. Root-cause analysis was delegated
to a separate agent. Findings and verification are in the
[F5b/F6 review](../plans/261007h-f5b-f6-code-review-sol.md).

The skip link called `focus()` on a radio inheriting `visibility: hidden` from
the dock. That call leaves focus where it was. The tests supplied manually
drawn, always-visible radios, replacing exactly the lifecycle constraint that
made the destination unavailable. The implementation comment accepted a second
press without a corresponding product decision. Plan 261007c accepted passive
Tab traversal skipping the hidden dock; F5b promised an explicit jump.

The class is **a navigation test replaces the destination's lifecycle with an
always-ready fixture**. The link and its tests arrived in `6f357c3e5`; the
preexisting entrance in `6c788fd51` supplied the interaction trigger.

The fix finishes the entrance for the dock and its install hint before moving
focus. A marker on that dock mount keeps a later blur from restarting the
delay. The link also has a real fragment destination, and print hides it.

Ranked countermeasures:

1. **Exercise an unavailable destination and assert the resulting focus.**
   Added here, using the real stylesheet for visibility and modelling only
   jsdom's missing refusal to focus hidden elements. It failed before the fix;
   removing the readiness handling makes it fail again.
2. **Use the actual destination in a browser during its entrance.** This is
   the strongest verification of CSS focusability, animation timing and native
   fragment navigation. This sandbox prevents Chrome from launching; this
   review does not claim that check passed.
3. **Rejected: replicate the whole dock in a larger mock.** More duplicated
   markup would still substitute the test's readiness model for the browser's.

The long-term boundary is a real native skip destination owned by the dock,
plus an explicit activation path that makes it available. This narrow review
assigns the first radio's fragment id from `SkipToModes`; editing `Dock.tsx`
was outside the review scope and that file had another builder's changes.
