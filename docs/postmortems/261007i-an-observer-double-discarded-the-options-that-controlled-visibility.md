# An observer double discarded the options that controlled visibility

Up: [Postmortems](../project/postmortems.md)

Caught in review of `143fdb199bc6e995045ab8d02943c92b1907d87e`, which introduced
`watchReveals`. Production exposure was not checked. The
[review](../plans/261007h-f4b-f5c-code-review-sol.md) records the red-first
regression and the final checks. A subagent independently confirmed the cause.

The observer used a bottom root margin of `-8%`, assuming a small vertical
inset. [The platform resolves percentages against width](https://www.w3.org/TR/intersection-observer/#intersectionobserver-rootmargin),
including for vertical margins. At 4000×240 it removed 320px from the
240px-high trigger area. An armed section could remain hidden throughout
scrolling. The fake observer ignored constructor options and always allowed
tests to fire an intersection manually.

The class is **a platform double that discards configuration governing whether
callbacks can happen**. Checking the callback proved what it did after an
intersection, without checking whether one was possible.

The fix uses the whole viewport, without a negative root margin. The 600ms
transition still reveals a section as it enters. This also lets a short final
section reveal when it can reach only the bottom of the viewport.

Countermeasures, ranked by cost against value:

1. **Capture observer options and check an adversarial viewport.** Added;
   the 4000×240 regression failed against the old margin before the fix.
2. **An actual browser scroll check** would verify the platform independently
   of the double. Browser review could not complete in this sandbox.
3. **A general geometry simulator or resize-aware inset controller** was
   rejected. Removing the unnecessary inset is simpler and avoids both the
   unit assumption and future resizing problems.
