# Adding an access path does not replace the old one

Stage 1 private-link code review caught two incorrect access claims before this work was approved. The candidate's owner masthead said “Only you can read this” with a private link on, and its link confirmation promised no listing even when the article was already public. There is no evidence here of an access-control bypass or of these candidate changes reaching production.

## The class: independent access paths described as exclusive states

`e095fad5c` added a second access path while leaving `Article.visibility` unchanged. The existing masthead still derived an exclusivity claim from that one field. `01446fe4b` introduced the browser control and its unqualified listing and preview promises; it displayed the existing-public warning only after creation. Both mistakes treat one access control as a complete description of who can read an article.

The sibling is the shelf: both renderers recognised public sharing but omitted an active private link. Public listing and page metadata correctly continued to follow public visibility, which made the new confirmation's promise false for a public article.

## What the checks missed

Existing masthead tests supplied only visibility, so they preserved the old binary assumption. Private-link card tests checked the warning after creation but did not require it before confirmation. Page copy tests accepted the unqualified sentences. The server predicate and token-isolation checks answered different questions and could not catch these claims.

Red-first review tests reproduced the missing link badge, the masthead's false exclusivity claim, the missing state callback, and the public article's misleading confirmation. The corrected UI tests passed. Owner article/shelf boolean assertions were added to `share-link-pg.test.ts`; they need a database and were not run in this review sandbox.

## The fix

Owner article and shelf DTOs now carry `privateLinkOn`, a boolean derived from the paired token timestamp. They never carry the token. The masthead and both shelf renderers read that fact; unknown link state cannot claim exclusivity. The control reports changes to the mounted owner's article view, so its masthead updates without a reload.

Confirmation warns about public access before creation. Listing and preview promises apply explicitly to an article shared only by private link. This preserves the existing independent controls and fixes the actual claims; replacing them with one combined visibility enum would misrepresent the valid public-plus-link state.

## Countermeasures, ranked by effort against value

1. **Test claims against the access combinations they describe.** Done: private with link off/on/unknown, public while confirming a link, and live owner-state reporting. This costs a few focused cases and catches both manifestations.
2. **Keep credential-free access facts on the owner projection.** Done: the server supplies the boolean and the cache validates its type. Inferring it from visibility repeats the defective assumption.
3. **Replace all sharing controls with one combined state machine.** Rejected: it adds coordination while the two independent permissions remain valid. A new credential-bearing client payload is also rejected; the marks need a fact, not the key.

Up: [Postmortems](../project/postmortems.md). Feature context: [private-link plan](../plans/261005e-share-an-article-with-some-people-a-private-link-first.md).
