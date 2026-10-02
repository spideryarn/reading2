---
reports: spya-ger3a3
ending: shipped
---
# A banner on every public-readable article: its source, the takedown offer, no training

Report `spya-ger3a3`, a suggestion, from Greg (admin), 2026-09-29, dispatched by the Overseer on
2026-10-02 as queue item qi-452ev4kp, on
`https://www.spideryarn.com/read/nihms-536461-spya-nr87dn?thread=spya-h34030&deep=2`:

> For anything public readable, let's make sure there's a banner at the top that says, that
> highlights the URL where it came from. And ideally, I think we've already got something else
> that's trying to figure out what is the canonical URL, even for uploaded PDFs or HTML, so that
> wherever possible, we are providing a link back with, you know, SEO juice pointing to the
> canonical source, and that the banner should explicitly say two things. It should say, if you're
> the, you know, IP owner and you don't want this to be public readable, that email, I don't know,
> hello at spideryarn.com and we'll take it down. And secondly, if you provide evidence, and
> secondly, that we explicitly use models that don't train on your content, and then point them to
> the privacy page.

**Ending: Shipped**, on `dev`. Plan
[261002g](../plans/261002g-a-banner-on-every-public-readable-article.md).

The visitor's box under the masthead now gives the source, the takedown offer (the mailbox, plus a
link to /privacy's section on what taking down means) and the no-training promise, with /privacy's
hedge. For a shared upload, the source is the found guess from 260929g, which visitors now receive.
Three choices Greg should know about:
- **No "provide evidence".** /privacy promises we act without proof.
- **Not the canonical tag.** Every public page is `noindex`, so a canonical carries no SEO weight
  here, and a guessed address should not become a machine-readable claim.
- **Visitors only.** The owner of a shared article does not see the banner.
