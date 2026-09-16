# Every footer links to the publicly readable shelf

**SPIDERYARN-READING2-3V** · suggestion · from Greg (an admin, so trusted input) · standing on
`https://www.spideryarn.com/`, build `d358f773` · 2026-09-12 11:04Z

> Add a link in all the footers to the publicly readable shelf alongside, you know, feedback and
> pricing etc

**Ending: shipped** — on `dev`, not deployed.

There is one footer, and that was most of the answer: `SiteFooter.tsx`'s `LINKS` array is the whole
row on every page that carries it, so "all the footers" is one entry. The sweep that established
it is in the plan, and GPT Sol re-ran it independently — including the server head composer, the
static shell and the absence of any email template — and agreed.

The link is **Shared articles → `/read/public`**, placed after *Features* so the two product
destinations sit together before commerce and policy. Its label is the constant the page's own
`<h1>` already used, renamed from its heading-specific name to `PUBLIC_SHELF_LABEL`, and the command
bar now reads it too — it had been calling the same page *Public shelf*, which came from an internal
doc name, and one page with two navigation names was about to become visible.

Three things that were already wrong turned up because the change made somebody read them:
`PublicLibraryPage.tsx` claimed its top bar "already carries every link the row would" (it never
did), `SiteBits.tsx` bracketed the nav's list and the footer's as one decision, and
`tests/site-footer.test.tsx` had no assertion that Pricing drops its own link — the one entry in the
row that could have linked to the page under the reader's feet with nothing to catch it.

Fable arbitrated the label; GPT Sol reviewed the plan and the code. Deliberately not done: no
`SiteNav` entry (the top bar is measured tight at 320px), no footer on `/read/public` itself — Greg's
`/read/*` exclusion is untouched — and two literals of "Shared articles" left alone in the browser
tab and one Back link, named in `messages.ts` so the next person does not have to find them.
[260916a-add-a-link-to-the-public-shelf-in-the-site-footer.md](../plans/260916a-add-a-link-to-the-public-shelf-in-the-site-footer.md).
