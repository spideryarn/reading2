# A reference keeps its DOM identity after its passage changes

Up: [postmortems.md](../project/postmortems.md) · Change:
[261002e](../plans/261002e-summary-sentences-point-at-their-passage.md).

Caught in code review; no reader incident established. Commit `28f99cdf1` keyed
Summary's new sentence links by position within a paragraph keyed by its text.
A rewrite retaining the words but changing a sentence's passage reused the
anchor. The open rich card still showed the old passage while clicking the
sentence went to the new one.

## The class: node identity outlives the reference it represents

`BlockLinkCard` captures content on hover or focus. It refreshes when the
article index changes and dismisses when its anchor detaches. Rewriting a
summary changes neither the article index nor an anchor keyed only by position.
Updating the anchor's attribute and handler silently changed its meaning beneath
the captured preview and accessible description.

The root cause was checked independently in the review's `schema_root_cause`
subagent. The shared card behavior is unchanged; this new caller needs to give
each reference an identity that includes its target.

## Why nothing went red

The panel tests checked initial rendering, clicking and keyboard previews.
They never kept the article index and paragraph wording stable while changing
a sentence's target. The shared card's existing detach handling was correct,
but these keys never caused a detach.

## Fix and evidence

The working-tree fix keys each sentence by position, passage id and sentence
text. Text also matters because the card subtracts a section title already
present in its anchor's words. Replacing the anchor dismisses its captured card
through existing machinery; it also removes focus, as changing the paragraph's
words already does.

The new `tests/simple-panel.test.tsx` regression opened a keyboard preview,
rewrote only its target with a stable article index, and waited beyond the
normal 80 ms closing animation. It failed on the candidate with the old passage
still showing, then passed after the key fix. It also checks reopening the
correct preview and clicking to the new passage.

## Countermeasures, ranked by ease against value

1. **Exercise an open reference across replacement** — implemented; this tests
   the interaction between caller identity and shared cached UI.
2. **Key dynamic references by their meaning as well as their position** — cheap,
   especially where another component retains the DOM node as an anchor.
3. **Observe attribute mutations in every shared card** — rejected here. That
   broadens behavior across all modes when this new caller can use the existing
   dismissal contract instead.

The local identity change is the long-term fix for this caller. I would check
what survives a rerender whenever a shared overlay retains an element that a
new component can repurpose.
