# A URL guard checked its spelling instead of the consumer's meaning

Up: [postmortems.md](../project/postmortems.md)

Code review of [261006b](../plans/261006b-earlier-link-carries-the-paragraph.md) found four failing
boundary cases in the Earlier tab's page link. Production impact was not established. Two path
spellings bypassed the stay-put guard; two malformed labels passed the client validator.
Root-cause investigation was delegated to a review subagent on 2026-10-06.

## A representation was checked against a weaker contract than its consumer required

`isSitePath` checked whether a label could leave the origin. The new link builder also required
that the label contain neither a query nor a fragment before appending `?at=`. It accepted
`/read/x?mode=search` and `/read/x#spya-tgnssb`, so the appended text was not an `at` query parameter.
The real server never emits either label; this was a gap in the client's defensive boundary.

The stay-put guard compared literal path text. The router instead treats a trailing slash and
percent-encoded slug characters as equivalent article identities. `/read/why-trees-spya-k3m9qt/`
and `/read/%77hy-trees-spya-k3m9qt` both triggered `navigate` despite naming the current reading
page at the same `at`. The router's startup rewrites do not remove these spellings.

`2357dddd325078cb88d61e54541009bf93f8a2e5` introduced the path validator.
`d00983da54590b62ec31c58b3eb9850225cc9d26` reused it for query composition and introduced the literal
path comparison. The shared class is checking spelling instead of the next consumer's meaning.

## Why the existing checks passed

The tests challenged origin and control-character hazards and canonical current-page spellings.
They did not challenge the query/fragment boundary or the alternate spellings accepted by the
router. The added tests failed with rendered malformed labels and one unexpected `navigate` call
per alternate spelling: **4 failed, 137 passed** before the fixes.

## The lasting fix and the checks worth keeping

The validator now refuses literal `?` and `#`. The current-page comparison uses `parseRoute` and
`readHref`, requiring the article reading view. It reuses the router's identity rules rather than
adding another slug decoder.

Ranked by ease against value:

1. **Four boundary regressions:** added and observed red before the fixes. Cheap and direct.
2. **Challenge alternate representations whenever text equality controls navigation:** a small
   set of router-supported aliases can expose a shared mistaken assumption.
3. **Replace URL handling throughout the router:** rejected; broader machinery adds risk without
   improving these two boundaries.

The address's debounced reading position remains a separate, reasoned finding in the plan. These
fixes address path identity and path syntax; they do not claim to make the address instantaneous.
