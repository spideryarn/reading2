---
reports: spya-wu83xh
ending: shipped
comment: Shipped: a skim-for box (your purpose, edited in Skim), a map line per pass, shorter stops. Visitors seeing the map is q-t5xjqn; per-stop linking lines and a Skim-only focus are queued.
---
# Skim: More beats Gist, a map for each pass, shorter stops, and a skim-for box

`spya-wu83xh` (#565, `SPIDERYARN-READING2-HE`), an admin report from Greg (`feedback-reporter.ts`
exit 0, no addenda), filed 2026-10-11 01:49 UTC from `/`, build `2c38ec32`. Worked together with his
answer B to [q-vzd2xt](questions/q-vzd2xt.md) (reply `spya-sfm0g4`), Overseer queue item
`qi-g8pdgfgg`. This session had no Sentry sign-in and did not write the Sentry status; the next
feedback sweep does.

> I wonder if we could provide a way for the user to specify how they want to skim in skim mode. I
> think it, or alternatively, maybe it should be generated based on the reading goals. I think it
> perhaps already is, I'm not sure. And if the reading goals have changed, maybe it offers to
> regenerate with a way to dismiss that. Maybe it already does that. But even beyond that, I
> wondered if we provide an optional input box so that you could say what it is that you're trying
> to skim for. In that way, it wouldn't be so different from the search box. Let's experiment with
> that. If you don't think it'll add too much complexity, if it will add a lot of complexity, then
> push back. One more idea for improving the skim mode. Can we, beyond just providing lots of
> quotes, can we somehow situate them? So maybe we include guidance or brief kind of introductory or
> summary or linking statements, because right now. It feels a bit disorienting and disjointed. And
> one final thing, there was one example of a quote that was like an entire large paragraph long. I
> mean, maybe that's necessary, but I think we should have a bias towards the quotes not being too
> enormous.
>
> — Greg, 2026-10-11

**Ending: Shipped**, on `dev` and not deployed (`skim/13`). Plan
[261011r](../plans/261011r-skim-more-always-longer-than-gist-a-pass-intro-shorter-quotes-skim-for-box.md),
measured in [261011b](../investigations/261011b-skim-more-beats-gist-intros-and-short-stops.md).

- **What you wondered might exist did.** The route is planned for your reading goals (profile and
  the article's purpose), and a changed goal brings up the *planned before your profile changed*
  banner, with *Plan it again* and an ×.
- **The skim-for box.** *Edit* on *Reading for: …* now opens the box in Skim, filled with your
  sentence, asked as *What are you skimming for?*; *Plan the route for this* re-plans around it. It
  is the article's purpose (the same sentence as in Metadata), so other modes use it too, and the
  box says so. A Skim-only focus, separate from the purpose and closer to a search, would have
  needed its own storage and a rule for which route wins; that is the complexity you said to push
  back on, so it is queued (`qi-f9qsrnkz`) for if the shared box feels wrong.
- **Situating the quotes.** Each pass now opens with one or two AI sentences mapping the walk —
  e.g. *"Starts with the meaning gap, then the Django test of transfer and its results, and ends on
  matching evaluation to purpose."* Rated blind: 37 of 48 clearly orient, none gives a finding away.
  A linking line on every stop was passed over (a stop can be reached from anywhere, and each line
  beside a quote is another chance to give its finding away); queued as `qi-ky8x85rs`. For now only
  the owner sees the map: showing it to visitors means editing the visitor allowlist, a security
  defence, so that is your call in [q-t5xjqn](questions/q-t5xjqn.md).
- **Shorter stops.** Quotes over 60 words are marked long in the prompt, and Gist may take one,
  More two, only when no shorter quote carries the idea. Gist's median quote went from 50 words to
  about 40 and the long stops in Gist and More roughly halved, with Gist covering as many key ideas
  as before. A first wording with a 90-word bar moved nothing. Quotes itself is unchanged.
- **More always longer than Gist** (q-vzd2xt, B), by More and Most growing: a short More gets a
  stop carried in rather than Gist losing one. Every route of eight or more quotes measured grew
  strictly, and no Gist stop was moved.
- **Routes planned before this** keep their shape and have no map until planned again from
  Metadata.
