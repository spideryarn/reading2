# Filter explanations turn missing article details into evidence of exclusion

K3 review on 2026-10-07 reproduced false explanations for hidden shelf passages. With Include
archived on, the text search can return an unread, tagged archived article while its shelf listing
is loading or has failed. The page then called that article already opened, or outside the chosen
tag. Reader impact was not measured in this review; the reproduction used a mocked network.

## Missing metadata was treated as positive exclusion evidence

`passagesIn` in `src/web/Library.tsx` is correctly derived from the available shelf scope. But a
slug absent from its allowed set does not establish why it is absent: missing archive details and
a known filter failure are different states. `Passages` inferred the latter from both.

The archive-specific defect began in `08255d712`, which added archived passage search on
2026-09-30 while retaining the unconditional opened-article explanation. `3aad96ec5` extended the
same inference to topics and tags. The new filter tests supplied only a complete active shelf;
the browser measurements likewise did not exercise unavailable archive details.

## The fix and its evidence

Keep the specified scope filtering. While the archive listing is unavailable, report only that
the counted passages found are not shown; do not infer their reading history or tag membership.
The archive loading/failure line already explains the missing listing nearby. This also handles
mixed omissions, where some known articles really fail the filters.

Four added cases in `tests/shelf-passages-obey-the-filters.test.tsx` failed on the original
explanations, then passed with the neutral copy. Additional cases exercise loaded archive
combinations and topic loading/failure.

## Countermeasures, ranked

1. Exercise each independently loaded input in both its missing and failed states. Added here;
   cheap, and catches conclusions that require metadata the renderer does not hold.
2. Keep explanatory copy tied to the evidence available to its branch. The unavailable flag makes
   that distinction explicit in this renderer.
3. Move passage filtering to the server. Rejected here: it changes the stipulated contract and
   the capped-search behaviour, and is unnecessary to make the explanation true.

Up: [postmortems.md](../project/postmortems.md). Work: [K3](../plans/261007a-ui-sweep-k3-shelf-filter-and-false-copy.md).
