# Sluggish mode switching on a really long article

**[SPIDERYARN-READING2-1M](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1M)** · reported
2026-09-05 07:41 UTC · kind: problem · *shipped*

## What the reader said

> The interface feels kind of sluggish when clicking around, changing modes and stuff like that for a
> really long article.

Filed from
`/read/lawrence-kuhn-2024-a-landscape-of-consciousness-spya-hs82mz?at=spya-vpsn59&mode=hierarchy&cols=1,2,3`
— hierarchy mode, three gist columns, on a 152,000-word article.

## What we did

**Reproduced it first, and it was worse than "sluggish".** On a 2,046-block copy of that same
article, a Hierarchy switch cost **4.7 seconds** from click to painted frame, against 203ms on a
186-block article — eleven times the blocks for twenty-three times the time, so the cost was
quadratic in article length. Nothing on
[performance.md](../project/performance.md) described a click before this: four previous rounds of
performance work were all about scrolling.

**Two native DOM calls were 52.8% of all script.** Finding the DOM row for every section ran one
whole-document `querySelector` scan *per section*, and the spine re-read `document.fonts.ready` on
every mode switch. Both are now one cheap operation —
[`rows.ts`](../../src/web/rows.ts) and [`fonts.ts`](../../src/web/fonts.ts).

**Hierarchy −39%, Summary −33%, Outline −63%**; main-thread busy over the window fell 82% → 66.5%.
Plain did not move.

**It is faster, not fast.** A Hierarchy switch on that article still costs about 2.8 seconds, and
what remains is forced synchronous layout — three separate passes measuring the whole article on
every switch. Sharing one measurement pass between them is the safe next step and is written up but
**not built**, because the tempting version of it caches row offsets and a stale cache points the
reader at the wrong section.

The measurements, the method, the ranked remainder and the two ways the harness measured the wrong
thing first are in
[the plan](../plans/260905d-mode-switching-is-sluggish-on-a-very-long-article.md) and in
[performance.md § Clicking](../project/performance.md).
