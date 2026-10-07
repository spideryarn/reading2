# Flattening destroys the context a later filter needs

Up: [postmortems.md](../project/postmortems.md) ·
[stage plan](../plans/261006f-chat-mark-latest-line-without-references-or-markdown.md)

The code review on 2026-10-06 found two defects in `answerOpening`: literal words disappeared after
markdown flattening, and deeply nested markdown returned source syntax instead of plain words.
Both were present in the reviewed branch commit; this review did not establish deployment or
reader impact. The full answer was unaffected, but its preview could be false or absent.

## The evidence and introducing commit

`git log -S 'function words'`, `git blame`, and the commit message identify
`41734f252f13616264801c85083bc33aa322949e` as the introduction. It added the shared preview helper
to replace a raw first-line cut in thread summaries and collapsed chat cards.

These inputs reproduced the defects in that commit:

| Input | Actual preview | Expected preview |
|---|---|---|
| `[See spya-k3m9qt](https://example.com/source)` | `See` | `See spya-k3m9qt` |
| `[spya-](https://example.com/source)k3m9qt is literal.` | `is literal.` | `spya-k3m9qt is literal.` |
| ``Use `spya-k3m9qt` as a key.`` | `Use as a key.` | `Use spya-k3m9qt as a key.` |
| Thirteen `> ` prefixes followed by `**Deep** answer [spya-k3m9qt].` | `> **Deep** answer.` | `Deep answer.` |

## Flattening destroys the context a later filter needs

`words` first reduced the AST to a string. `withoutBlockIds` then interpreted every id-shaped run
in that string as prose to remove. At that boundary, link labels and code were indistinguishable
from citation-bearing prose, and joining adjacent nodes could create an id that never occurred in
either node. The URL protection inside `withoutBlockIds` could not recover the discarded markdown
link surrounding its label.

The moved `withoutBlockIds` implementation was unchanged from `src/live.ts`; the defect came from
applying it to a new representation. The sibling contract already exists in
[`citable.ts`](../../src/citable.ts) and `Cited.tsx`'s `drawPhrase`: labels, code and other literal
contexts do not become citation-bearing text.

## A safety fallback can undo the transformation it protects

The depth cap prevented recursive stack overflow by returning a source slice after depth twelve.
That preserved characters but abandoned the preview's plain-words transformation. The cap copied
the renderer's fallback policy even though the preview had a different output contract.

## Why the existing checks stayed green

The existing URL test covered an id inside a bare address, which still survived. Separate tests
covered links and code without id-shaped literal content; none combined the structural and
citation rules. The deep-nesting test asserted only that the result contained `deep`, so raw
markdown satisfied it. Typechecking cannot distinguish citation prose from literal words once
both have become strings.

## The correction

Remove citations from ordinary text leaves before joining their words, with protected context for
link labels and literal code, image alt text and raw HTML. Preserve whitespace at leaf boundaries;
trim and tidy the completed line once. Keep Live's existing `withoutBlockIds` behavior unchanged.
Walk the tree with an explicit stack so depth cannot switch the preview back to raw source. These
changes address both defects without a new markdown parser or a patch for particular labels.

## What would have caught the classes, ranked by ease against value

1. **Combine transformation rules in regression cases.** Test id-shaped labels and code, an id
   assembled across adjacent nodes, and nested formatted prose. These small cases distinguish
   literal preservation from citation removal; run them red against the stage before fixing it.
2. **Assert the promised output at a safety boundary.** Require the nested result to equal its
   plain words, rather than merely containing them. This is a cheap strengthening of an existing
   test and detects the fallback's contract change.
3. **A general AST provenance framework or a second parser** — rejected. The parser already
   supplies the needed node kinds, and an iterative local walk retains them without new machinery.
   Raising the depth cap is also rejected: it postpones the same wrong output and reopens the
   stack-overflow risk.
