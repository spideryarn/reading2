---
reports: spya-k49y3q
ending: shipped
comment: Shipped on phones: the column is gone, and a tap brings the icons up in a bar above the paragraph. Still queued for you to decide: whether the iPad should get the same.
---

# On a phone, the paragraph's icons come up above it

Report `spya-k49y3q` (#600, suggestion, admin), Sentry SPIDERYARN-READING2-JP, queue item
`qi-zcxnha83`. Sent from
`https://www.spideryarn.com/read/rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug?structure=expanded&at=spya-zmpdet&learn=quiz&term=spya-yx3qja`.

> I would love to make just a tiny bit more horizontal space for the text in portrait mode on a
> phone, or more generally. So I think we could edge the text slightly closer to the left towards
> the spine. And then on the right-hand side, we leave space for the gutter for the icons for sort
> of permalink and question and chat and bookmark. I understand why we're doing that, but most of
> the time we're not using that space and it's just a waste. So I'm wondering is maybe we could
> find a different way to reveal them. We only reveal them on click—oh, sorry, tap, a touch on the
> paragraph anyway on a mobile or touch device. So I wonder if we could put them above or below
> instead of to the side. I don't know. Take screenshots. Perhaps consider the best practices. It
> works pretty well, and I'm reluctant to make it worse. But yeah, it does seem like a waste that
> there's a bit of space to the right of every single paragraph on a portrait mobile phone where
> that horizontal real estate is really precious that we're not using most of the time, and that we
> only need it when there's an explicit action. So it feels like there might be somewhere else or
> something else we can do on an explicit touch to reveal those icons. Take screenshots. Use your
> judgment.
>
> — Greg, 2026-10-17

**Ending: shipped**, on `dev`. This applies on a narrow touch screen: a phone, or an iPad in a
narrow split view.

- The 35px column on the right of every paragraph is now a 1.25rem strip, and the text sits
  nearer the spine. A line is ≈347px wide on a 390px phone, against ≈325px before.
- At rest the strip shows only state: a bookmark mark or a blue chat mark, still one tap to open,
  and the reading-time hairline.
- A tap on a paragraph brings its icons up in a small horizontal bar above its top-right corner,
  where touch reading apps put the actions for a selected passage.
- The cost: while a paragraph is selected, the bar can cover the last word or two of the line above.

Plan, Sol's two reviews and the before-and-after screenshots:
[261018g](../plans/261018g-phone-portrait-gutter-icons-above-the-paragraph.md).

**Deferred, queued as `qi-a2h4xwxw` (needs Greg):** "or more generally". Should the iPad, and every
touch screen, get the same bar instead of the column?
