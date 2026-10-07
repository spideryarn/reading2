# Trusting a boundary check that does not cover its consumer

Review of `766624567` caught three defects in Hidden text's Opus check before landing.
There is no known reader impact. Each boundary had a check, but that check covered less
than the consumer needed: nested result fields, invisible Unicode, or the trusted text
beside the model's reason.

Up: [Postmortems](../project/postmortems.md).

## What failed, and why the checks agreed

- **Client result validation stopped at the container.**
  [The hook](../../src/web/useHiddenCheck.ts) accepted a judgments array without checking
  its members. A null member could crash the panel; an unknown verdict with matching
  inputs counted as harmless. The existing malformed-result test changed the array
  into a string, so it never exercised the fields the panel actually read.
- **A Unicode category stood in for a rendering property.**
  [The reason renderer](../../src/web/SourceScanNotice.tsx) handled format characters,
  but invisible default-ignorable characters also occur in other categories: variation
  selectors, combining grapheme joiners and blank fillers escaped it. Control characters
  escaped it too. Every existing invisible-character example already matched the regex.
- **The clipping boundary included trusted and untrusted text together.**
  [The stylesheet](../../src/web/styles/referee.css) clipped the paragraph containing
  both verdict and reason. That protected neighboring rows, while leaving the verdict
  inside the reason's permitted painting area. The existing test inspected overflow on
  that shared paragraph and therefore confirmed the same mistaken boundary.

All three were introduced by `766624567`. The class is **a boundary check that does not
cover its consumer**: proving something about a container, character category or ancestor
box is taken as proof about everything inside it.

## Fix and evidence

The review fixes validate the complete client result shape before accepting completion,
print `Default_Ignorable_Code_Point` and `Cc` characters as code points, and give the
reason its own clipped flex box, separate from the application-written verdict.

Red-first reproduction added eight malformed-result cases to
[the hook tests](../../tests/hidden-check-stream.test.tsx), plus eight Unicode cases and
one computed-style containment case to
[the panel tests](../../tests/hidden-check-panel.test.tsx). These 17 cases failed against
the original code and passed after the fixes. The computed-style test proves independent
clipping declarations; it does **not** prove pixel overpaint in a browser.

The long-term fix is the same boundary design: validate what the next consumer reads,
use Unicode properties corresponding to the intended behavior, and contain untrusted ink
independently of trusted words. Existing Mirror validation and shared parser omissions
remain report-only because they are outside this commit's scope.

## Safeguards, ranked by ease against value

1. **Exercise nested malformed fields and Unicode categories outside the original examples.**
   Cheap, implemented here, and catches assumptions hidden by otherwise valid containers.
2. **Check containment on the untrusted element itself.** The computed-style regression is
   cheap and implemented; a browser rendering case would add evidence about actual glyph ink.
3. **Review each boundary from its consumer backwards.** Compare every field read and every
   trusted sibling with what the guard actually guarantees; costs no new infrastructure.
4. **A broad validation or sanitization framework was rejected.** It would expand this small
   review into unrelated contracts without proving the particular rendering boundary.

The lesson is to make the adversarial case cross the exact boundary that was trusted.
Checks over a nearby abstraction can agree while the consumer remains exposed.
