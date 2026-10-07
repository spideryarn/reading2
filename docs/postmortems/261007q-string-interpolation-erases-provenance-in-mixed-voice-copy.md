# String interpolation erases provenance in mixed voice copy

Caught during the stage 2 review of [261007j](../plans/261007j-gift-voucher-starter-article-by-private-link.md), introduced by `90d414d4c`. No production incident was observed. A read-only subagent investigated the root cause; the reviewer reproduced and fixed the defect.

## The class: presentation strings lose the boundary between voices

`EmailSketch` called `giftEmailStarterLine(title)` and rendered the result as one string in a UI paragraph. Fixed app copy and borrowed title became indistinguishable to the renderer. The original title needed the author font, a renamed shelf title the reader font. [fonts.md](../project/fonts.md) requires that distinction on every surface.

The original sketch test asserted text and order; the table's test asserted the author class on a different component. Neither could fail on the sketch's missing provenance. Two new cases, original and renamed titles, failed with `expected undefined to be 'The Bitter Lesson'` on the absent voice span.

There is a second provenance boundary: the shelf deliberately chooses the owner's rename, while the stranger's email deliberately loads the revision's own title. `LibraryEntry` does not contain both. The client now visibly tells an owner who renamed the article that the email uses its original title. Exact preview parity would need a wider server payload/read change, not a guessed title.

## Lasting fix and countermeasures, ranked

1. **Assert the voice on the borrowed words, not merely the sentence text.** Done red-first in `tests/admin-vouchers-page.test.tsx`, for both title provenances. The existing sentence/order assertion still passes.
2. **Keep provenance until rendering.** Done: the sketch receives the shelf entry and reuses `EntryTitle`. A separator in the shared email sentence supplies the surrounding fixed text, so only the title is voiced and the email copy remains one source. A renamed title also gets a visible preview caveat, tested red-first.
3. **Put the whole sentence in the author's font.** Rejected: it would misvoice both fixed copy and renamed titles. Fetching an additional title just to make this approximate sketch exact was also passed over; the explicit caveat meets this stage without extending the server contract.

Related: [a formatter erases trust when it mixes checked facts with article text](261005h-a-formatter-erases-trust-when-it-mixes-checked-facts-with-article-text.md). The transferable lesson is to preserve provenance through formatting, rather than reconstruct it from a completed string.
