---
reports: spya-vzrjju
ending: shipped
---

# The "back to ⟨section⟩" chip goes after thirty seconds

Greg (admin), #598, suggestion, 2026-10-17, on
`rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug`, Sentry SPIDERYARN-READING2-JM:

> I really like how if I click on something that takes me to a different part of the article, like
> a footnote or whatever, there's a little back to X sort of UI widget so I can go back to where I
> was. That's great. But after a while, if I haven't clicked it, probably I'm never gonna. And so
> maybe we could have, I don't know, 30 second timeout on it, and after that it just disappears,
> because otherwise I have to dismiss it explicitly, and it's just like a slight distraction.

**Shipped** (on `dev`). The chip fades and goes 30 seconds after it appears, exactly as if its ×
had been pressed, so the browser's Back still works. A mouse resting on it or keyboard focus in it
holds it, and a new jump restarts the clock. The phone-only "back to ⟨mode⟩" pill is left as it
was, since the mode is hidden behind it. Plan:
[261018e](../plans/261018e-a-tap-on-a-cross-reference-shows-its-card-first-and-the-way-back-chip-goes-after-thirty-seconds.md),
batched with spya-yk33ke ([its note](261017_2304-a-tap-on-a-cross-reference-shows-its-card-first.md)).
