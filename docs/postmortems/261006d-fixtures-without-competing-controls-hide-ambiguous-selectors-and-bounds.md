# Fixtures without competing controls hide ambiguous selectors and bounds

Review of `064ba45c7` found two test and prose weaknesses. No reader-facing behaviour defect was
established: the absent-term handoff still works, and clipping a very long glossary name keeps its
question sendable. Both weaknesses came from fixtures that omitted a boundary their claims depended
on. Root cause was checked independently by a read-only subagent during the 2026-10-06 review.

The absent-term test selected the first whole-page button whose text was `Ask in chat`. That
selector originated in `e0fb40a776`; `064ba45c7` added an entry button with the same label. The test
fixture had no entries, so it could not reveal the collision. Adding an open entry and asserting
the match was unique failed with two matches. The refusal currently appears first in the DOM,
which explains why the original test still passed.

The new helper's comment and documentation promised the whole glossary name, however long. It
actually uses `fencedQuote`, which bounds escaped text and shows a visible ellipsis. The new
long-name tests stopped just above the separate origin snapshot cap, before reaching that second
bound. A test of the documented promise with a 2,200-character name failed. The inaccurate promise
was introduced in `064ba45c7`; the underlying clipping remains useful because Chat limits a question
to 4,000 characters.

The class is **an incomplete fixture concealing an assumed identity or bound**. A selector and its
fixture agreed that a label was unique; a prose claim and its fixture agreed that passing one length
limit proved arbitrary-length preservation. Neither fixture exercised the competing case.

The narrow fixes scope the absent-term selector to `.gloss-ask-failed`, render both buttons, assert
a unique match and assert that Send carries no entry origin. The prose now points to the bounded
quote helper; tests cover very long names, escaping that crosses the bound and a supplementary
character at the cut. Runtime clipping is preserved.

Countermeasures, ranked by ease against value:

1. **Render competing controls and cross every relevant bound in the affected tests.** Done here;
   these fixtures make the hidden assumptions visible without a new harness.
2. **Scope selectors to the surface whose action is under test.** Done here. Shared reader-facing
   wording should not become unique test identity.
3. **Add a global rule forbidding repeated button labels.** Rejected: both buttons correctly say
   `Ask in chat`; the test must identify their surfaces, rather than dictate product wording.

The long-term fix is the same as the narrow one: test the boundary independently of its convenient
fixture, and describe the shared helper's actual contract rather than generalising from one sample.

Up: [postmortems.md](../project/postmortems.md)
