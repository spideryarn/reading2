# Website text

The words on the pages that are **about Spideryarn** rather than about an article: the landing page,
the features page, the privacy policy, the footer row that joins them, and the one address a reader
writes to. Part of
[reading-view-overview.md](reading-view-overview.md).

Its sibling is [copy.md](copy.md), and the split between them is worth stating once: **copy.md is
what a reader is told when something goes wrong**, in the middle of doing something. This is what a
reader is told when they come looking — a stranger deciding whether to sign in, or somebody who
wants to know what we do with their data. Different reader, different register, different rules.

## The contact address

> The contact address to use anywhere in the site is `hello@spideryarn.com`.
>
> — Greg, 2026-09-02

**One address, spelled in one place**: `CONTACT_EMAIL` in [`src/site-text.ts`](../../src/site-text.ts).
Support, privacy requests, "delete my account" and anything else all land in the same inbox, because
the person reading them is the same person and a `privacy@` alias would imply a department that does
not exist.

Anything that needs it imports it. That includes the browser —
`site-text.js` is on the shared-import allowlist in `tests/client-imports.test.ts`, which it
qualifies for by importing nothing at all. The alternative is a second copy of the address that
survives a domain move, which is exactly the trap
[CLAUDE.md § One source of truth](../../CLAUDE.md) describes.

## The footer

> Add a link in the footer to the Privacy and Features pages on all non-logged-in-pages, and also
> for some of the logged-in pages where it makes sense to do so (e.g. on `/`, but NOT on any
> `/read/*` pages). We'll probably also add a Terms of Service etc later.
>
> — Greg, 2026-09-03

One component, [`SiteFooter.tsx`](../../src/web/SiteFooter.tsx), and its header carries the rest:
the list of links, which pages mount it, and why `/read/*` cannot have one. **A Terms page is one
entry in its `LINKS` array**, which is the whole reason it is a component — it had been written by
hand on the landing and features pages, and those two copies already disagreed about which links
they carried.

**It nearly became two components on the day it became one.** The marketing redesign
([marketing-pages.md](marketing-pages.md)) extracted its own `SiteFooter` into `SiteBits.tsx` in
another worktree the same afternoon, and the two met at a merge. Greg's call, 2026-09-03, was one
component: the general one absorbed the other, and `variant="marketing"` is what carries the
redesign's taller spacing on `/` and `/features`. The provenance sentence stayed with those two
pages as child text, because it is a promise about *them* rather than a fact about the site.

The link for the page you are already on drops itself, decided from `useRoute()` — except on the
two pages `App.tsx` uses as fallbacks, which have to say which page they are, and which is a trap
worth reading the header for. `tests/site-footer.test.tsx` pins the dropping, the contact address,
**and the inventory**: which files mount it, how many times each, and which two declare themselves.
The inventory is there because every other test in the file is satisfied by a component nothing
renders.

## The privacy policy

It has a doc of its own: **[privacy.md](privacy.md)** — the four decisions Greg
made, what a cross-family review changed, what is still open, and what is pinned
by a test rather than by somebody remembering. The page is
[`/privacy`](../../src/web/PrivacyPage.tsx).

Here because it is site text as well: it renders **signed out**, and the footer
row above links to it from every page that has one. That is the point of it
rather than a detail — the person who most wants to know what we do with an
article is the one deciding whether to hand us one.

## The landing page

[`LandingPage.tsx`](../../src/web/LandingPage.tsx) — the pitch, four screenshots, the **Beta** badge
and the honest strip, and the sign-in controls on the page rather than behind a link. Its own header
carries the decisions; the one worth repeating here is that **a claim on it is checked against the
code, never against a doc about the code** — it said "six diagrams" for a day, having been written
from a doc, when there were four.

**Redesigned 2026-09-03**, at Greg's asking and in the posture he chose — the hero, the pictures and
the visual language are [marketing-pages.md](marketing-pages.md)'s subject, and the plan is
[260903g](../plans/260903g-redesign-the-signed-out-marketing-pages.md). Two things about it belong
here because they are about the *text*: the sign-in panel moved to the foot of the page, with a
`Sign in` link in the top bar jumping to it, so the 2026-08-27 rule that the buttons are on the page
survives; and the copy was **reordered and cut, never rewritten** — the dog-eared-book sentence came
up to sit under the hero, "And deliberately not" came out from between the principles and the
prices, and two sentences that appeared twice each now appear once.

**Rewritten 2026-09-03 in Greg's words.** The words come from an interview
([260902k-spideryarn-reading-interview-guide.md](../research/260902k-spideryarn-reading-interview-guide.md))
and from his dated quotes in the feature docs, and every sentence in the file carries a comment
saying which — or `[tissue]`, for the few connecting lines an agent wrote. The rule and the reason
are in [positioning.md § Whose words](positioning.md#whose-words).

**Beta copy, honest strip.** The copy reads as if the product is in beta and paid, which is what
Greg asked for on 2026-09-02 (*"we should write the copy as if we're in Beta and taking
payments"*), while sign-up is still an invite list and Stripe is still being built. So one strip,
`BetaStrip` in the file, says sign-up opens shortly and offers a `mailto:` to the contact address.
**Delete the component the day sign-up opens**; nothing else on the page knows about it.

## The features page

[`FeaturesPage.tsx`](../../src/web/FeaturesPage.tsx) at `/features`, since 2026-09-03: every mode
with a screenshot and a sentence of intent, then the plans. Reachable signed out, like the privacy
policy and for the same reason. The three plans are rendered by its `Plans` component on both
pages, and **the numbers there are copy, not configuration** — the source of truth is the
`billing_tiers` table ([billing.md](billing.md)), and a quota changed there has to be changed here
by hand. The screenshots, their sizes and how they were made are in
[`src/web/shots.ts`](../../src/web/shots.ts), which `tests/landing-assets.test.ts` checks against
the bytes on disk — and what makes one of them *good*, which is a separate question the site had
been getting wrong, is [marketing-pages.md](marketing-pages.md).

Regrouped the same day: it was fourteen full-width screenshots stacked vertically, and each group
now leads with one or two landscape shots and follows with three portraits across or plain tiles.

The plan for both pages, with the simpler options passed over, is
[260902k-website-copy-homepage-and-features.md](../plans/260902k-website-copy-homepage-and-features.md).
