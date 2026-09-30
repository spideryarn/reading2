# The shelf's top-left had none of the fun logo animations

**[SPIDERYARN-READING2-6D](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-6D)** · from an
admin (Greg), on `/` signed in · kind: problem. The time in the file name is when this session picked
the report up, not Sentry's First Seen, which this session could not read (no Sentry sign-in on this
account).

> We don't seem to get the fun logo animations for the logo in the top left of the logged in
> homepage.

**Ending: Shipped** — on `dev`, not deployed. Resolve 6D; the next feedback sweep does the Sentry
status write.

Why: only the little spider animated. The big "Spideryarn" heading beside it was plain text, so
pointing at the word did nothing, and the spider alone could play only six of the thirteen
animations (the other seven move the letters). This was not missing from the deploy. The day before,
[the animated wordmark went onto more pages](260929_0429-animated-wordmark-on-more-pages.md), and
this heading was left out on purpose. The letter animations moved by a fixed number of pixels tuned
for the small wordmark, and on a 30px heading they looked like half a gesture.

What we did:

- **The spider and the heading are now one animated wordmark.** Point at either, or tap either on a
  phone, and any of the thirteen can play.
- **The letter animations now scale with the size of the word**, so they look the same on the big
  heading as on the small wordmark. The small wordmark in the corner and in the article's bottom bar
  moves exactly as before. The footer and the top bar of the signed-out pages have slightly bigger
  words, so theirs are now a little larger too, in proportion.
- The heading looks the same at rest. One of the animations (Dawn) briefly turns it orange, as it
  already did in the footer.

Plan: [260930a](../plans/260930a-cmd-k-on-metadata-page-and-full-wordmark-animations-on-the-shelf.md)
§ 6D.
