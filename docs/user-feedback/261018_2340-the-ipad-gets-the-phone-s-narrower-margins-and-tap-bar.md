---
reports: spya-eebnxu
ending: shipped
comment: Shipped: the iPad and every screen with no mouse get the phone's narrow margins and tap-for-icons bar, about three more characters a line in portrait with Marginalia on. The phone is unchanged; two further steps are queued for you.
---

# The iPad gets the phone's narrower margins and its tap bar

Report `spya-eebnxu` (#609, suggestion, admin), Sentry SPIDERYARN-READING2-K0, queue item
`qi-yksnyp7w`. Sent from an iPad in portrait, from
`https://www.spideryarn.com/read/rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug?at=spya-g83jsr&margin=1`.

> In a previous message, I said that it would be great to reduce the right-hand margin to make as
> much use of the horizontal real estate of the screen, especially, you know, on a narrow phone like
> a portrait iPhone. And we moved the few icons when you select a paragraph, like the permalink and
> the context and whatever, to the top right of the paragraph, so that we didn't need to keep that
> right-hand vertical gutter space all the time. Okay, great. I still feel like we could be making
> more use of the horizontal real estate. In other words, I think we could be shrinking the
> horizontal margins, especially on the right-hand side, and maybe even a tiny bit on the left-hand
> side to move it closer to the spine. And I think it depends on how much screen real estate we
> have, but if we really don't have much, even on a portrait iPad when I've got marginalia mode on,
> I think I might want a bit more right-hand margin for the text than conceivably even some
> left-hand margin, I'm not sure, so that I get just a few more characters on each line.
>
> — Greg, 2026-10-18

**Ending: shipped**, on `dev`. The follow-up to
[261017_2353](261017_2353-phone-gutter-icons-come-up-above-the-paragraph.md), and it answers that
note's deferred question (`qi-a2h4xwxw`, should the iPad get the same?) with a yes.

- On any screen with no mouse, the iPad included, the right margin is the phone's narrow strip
  (35px down to 20px) and the left one edges towards the spine (22px down to 10px). A tap on a
  paragraph brings its icons up in the bar above it.
- On an iPad in portrait with Marginalia on, a line goes from about 486px to 511px, roughly three
  more characters. Where the line is already at its full 65-character measure (an iPad in
  landscape, a 12.9" iPad), it stays there and the saved room becomes whitespace.
- A computer with a mouse is unchanged, and so is the phone.

Plan, Sol's two reviews and the screenshots:
[261019d](../plans/261019d-touch-screens-get-the-gutter-bar-and-narrower-prose-margins-ipad-included.md).

**Deferred, queued as `qi-ew86g4tc` (needs Greg):** more line on the phone, whose words already
take 89% of its width, by moving the bookmark and chat marks out of their 20px strip; and, on a
portrait iPad, giving the prose some of the Marginalia column at the cost of narrower notes.
