Verdict: **BLOCK**.

## Blocker

Summary mode still treats the apparatus as ordinary argument structure.

[`buildSummaryTree`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/tree.ts:559) descends into supplement leaves. [`SummaryPanel`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/SummaryPanel.tsx:662) then numbers Notes, and renders “No summary for this section” for it and its leaves.

Reproduced with a valid depth-4 tree plus six notes:

```text
Notes: number "3"
children: "3.1" … "3.6"
titles: empty
gists: absent
```

At depth “sections”, all six phantom note rows render. Even at the default depth, Notes appears as numbered part 3 with a missing-summary warning.

Keep one unnumbered, dimmed Notes row; do not descend into it or report a missing summary.

## Continuation fix

`item.continuation && !item.supplement` is correct.

- `navigableItems` has already replaced any mapped descendant with the supplement root, so testing only the root would be equivalent.
- A row collision is impossible for a valid tree: column cells tile rows, `startRow` is their cumulative span, and supplements occupy disjoint contiguous trailing ranges.

The tests now exercise the real seam and the previously broken topology. As a small addition, assert strictly increasing unique starts and include a deep Notes-plus-References case.

## Other checks

- Spine: sound; one terminal supplement band, no descendants.
- Focused tests: 78/78 passed.
- No further finding beyond the summary path.