---
reports: spya-jwepsa
ending: shipped
---
# A shared link looks like something when it is pasted

From Greg (admin; the Overseer relayed the report's production row), filed 2026-10-04 17:09 UTC
from `/changelog`. Sentry event `8b7d1a257636420c9bcf27768dea8801`.

> If I share a Spideryarn link (e.g. on X/Twitter, WhatsApp, Facebook, etc etc), make sure it looks nice. Probably the article title and/or authors first in the title, then `- Spideryarn`. Probably a 1-sentence summary of the article (as per the Metadata page for the description.
>
> Should we also mention "powered by Spideryarn, for deep & efficient reading", or something like that?
>
> Use Sonnet for web research on best practices for this kind of thing. Use your judgment.

**Shipped**, on `dev`. The title and the one-sentence summary were already on a shared article's
card. What was added: a picture (our logo, the name and *AI-assisted reading*), the authors after
the title, a card in the head of every other page, and LinkedIn's, WhatsApp's, Telegram's,
Discord's and Slack's preview robots let in beside Facebook's and X's. The plan is
[261005f](../plans/261005f-link-previews-and-seo-for-shared-links.md) and the research is
[261005b](../research/261005b-link-previews-and-seo-for-republished-articles.md).

The name stays in `og:site_name` and is not repeated after the title on the card, because
WhatsApp's own guidance is a title "without any branding"; the tab still ends ` · Spideryarn`.

Three questions went to Greg with the debrief, none of them blocking: the "powered by" line
(Q-tagline), the article's own picture on the card (Q-lead-image), and letting the preview robots
in to pages other than shared articles and the homepage (Q-cards-for-other-pages).

**Greg answered all three on 2026-10-05**, and two were built the same day. The "powered by" line
stays off the card's text (*"use your judgment"*; the recommendation stood). The article's own first
picture is on its card when we hold a copy of it, and our logo otherwise (*"hmmm, not sure. go with
the lead image for now"*); one switch, `LEAD_IMAGE_ON_CARDS`, turns it back off. And the preview
robots are let in to our other pages (*"yes, allow them"*), each of which now has a card that names
it.

Not yet checked: a real pasted link, which only a deploy can show.
