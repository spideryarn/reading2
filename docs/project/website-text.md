# Website text

The words on the pages that are **about Spideryarn** rather than about an article: the landing page,
the privacy policy, and the one address a reader writes to. Part of
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

## The privacy policy

It has a doc of its own: **[privacy.md](privacy.md)** — the four decisions Greg
made, what a cross-family review changed, what is still open, and what is pinned
by a test rather than by somebody remembering. The page is
[`/privacy`](../../src/web/PrivacyPage.tsx).

Here because it is site text as well: it renders **signed out**, and the landing
page's footer links to it. That is the point of it rather than a detail — the
person who most wants to know what we do with an article is the one deciding
whether to hand us one.

## The landing page

[`LandingPage.tsx`](../../src/web/LandingPage.tsx) — the pitch, the screenshots, the prominent
**Alpha** sign, and the sign-in controls on the page rather than behind a link. Its own header
carries the decisions; the one worth repeating here is that **a claim on it is checked against the
code, never against a doc about the code** — it said "six diagrams" for a day, having been written
from a doc, when there were four.
