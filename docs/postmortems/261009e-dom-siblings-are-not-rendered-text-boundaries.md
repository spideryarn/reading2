# DOM siblings are not rendered text boundaries

Up: [postmortems.md](../project/postmortems.md)

Found and fixed in code review of
[261009e](../plans/261009e-latex-undefined-macros-leave-the-page.md), before the change reached
`origin/dev` or a reader.

## What happened

`removeUndefinedMacro` removed LaTeXML's visible `\name` report and then used the marker's immediate
DOM siblings to repair the text left behind. The flat fixtures passed, but equivalent inline markup
did not:

```html
<em>alpha<span class="ltx_ERROR undefined">\conference</span></em><strong>beta</strong>
```

became `alphabeta`. A nested `\sep` produced `alpha ; beta`, and a citation command preceded by
TeX-source whitespace produced `structure ;` or `scattering .`. The latter two malformed shapes
were already present in the ten-page before/after survey, but its comparison had no assertion for
punctuation spacing.

## A visible-text rewrite used DOM topology as text topology

`previousSibling` and `nextSibling` answer where a node sits inside one parent. A rendered sentence
can cross any number of inline parents and siblings, so the previous or next visible character can
sit outside that parent. All three defects came from treating those two boundaries as the same:

- the word-join check could not see through the marker's inline ancestor;
- `\sep` trimmed only an immediate text sibling and was emitted even without a phrase on each side;
- citation-key removal correctly left sentence punctuation, but did not remove the source whitespace
  that the now-absent citation had followed, including whitespace inside an adjacent inline element.

This class has a sibling in `visibleInstructions` in `src/injection-scan.ts`, which gathers text per
block because one visible sentence may be split across several text nodes.

## Which commit introduced it

`043eeb32b` (*261009e: a TeX macro LaTeXML could not expand leaves the page*) introduced the three
immediate-sibling decisions. `2008fce2d` narrowed argument deletion after plan review, but did not
introduce this boundary mistake.

## Why nothing went red

The original tests and the live examples used flat markup: each marker sat directly between text
nodes, none was first or last in a block, and the citation fixture had no source space before its
marker. The tests therefore shared the implementation's DOM-shape assumption. The survey checked
that macro names and keys disappeared, but not that the surviving punctuation attached correctly.

## The fix that is right for the long term

The shipped fix uses one rendered-edge helper for all three decisions. It walks out of and into
text-bearing inline elements, but stops at a block boundary; it never flattens `textContent`, so
authored markup, ids and link targets stay intact. Ordinary reports insert a space only when the
surviving edge characters would join words, `\sep` becomes punctuation only with phrases on both
sides, and citation removal trims the rendered edge when punctuation becomes adjacent.

Three independent ancestor-climbing patches would have fixed the examples while preserving the
class, so that option was rejected.

## What would have caught it, ranked by ease against value

1. **Keep the three red-first tests added in review.** They cover both inline-edge directions,
   nested and block-edge separators, and punctuation after source whitespace. Done.
2. **For a visible-text rewrite, test markup-equivalent variants.** Flat text, a wrapper on either
   side, wrappers on both sides, and first or last in the block are a small, readable matrix.
3. **Use one rendered-edge helper rather than local sibling checks.** Done here; it makes the text
   boundary a named operation instead of an assumption each rewrite can make differently.
4. Property-generate arbitrary inline-wrapper splits if these rewrites multiply — rejected for now.
   The explicit cases cover the known axes and explain failures better.
5. A larger live corpus or a browser suite as the primary guard — rejected. JSDOM reproduces the
   DOM boundary exactly, while another corpus can miss the same structural equivalent again.

## The thing I would tell myself

I knew the operation was about words a reader sees, but I tested the exact producer serialization
instead of the equivalent DOM shapes the browser can use for the same sentence. Whenever the claim
is about adjacent visible characters, sibling nodes are evidence only for the flat case.
