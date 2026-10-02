---
reports: spya-nkjpte
ending: shipped
---
# Metadata search finds *regenerate*, and far more besides

Report `spya-nkjpte`, a suggestion, from Greg (admin), 2026-10-02, relayed by the Overseer with no
Sentry mirror, on `https://www.spideryarn.com/read/bf03197835-spya-qfwsw2/metadata?…`:

> Add lots more keyword-aliases for Metadata page search to make it more flexible/forgiving (e.g. I
> tried searching for "regenerate" to find ways to regenerate the AI processing, and nothing
> matched).
>
> And update docs so that any time we update the Metadata page, we keep that search and ToC
> up-to-date.

**Ending: Shipped**, on `dev`. Plan
[261002c](../plans/261002c-metadata-search-aliases-and-keeping-its-search-current.md).

**What we found.** The search box in the left margin already found *AI processing* for
*regenerate*, both on `dev` and in the build live at the time. The ⌘K command bar did not: on the
same page it said *No command matches*. Many other phrasings also missed: *reprocess*, *start
again*, *reset*, *opus*, *high powered*, *update*. We can't tell which of these you met.

What changed:

- **The margin box knows many more words.** Every section has more, and AI processing has the most:
  every row it can re-run by name (*glossary*, *quiz*, *thread*…), the High-powered AI switch, and
  *start over*, *reset*, *fix*, *update* and the rest.
- **It is more forgiving.** A word that matches nothing on the page (*please*) is set aside rather
  than emptying the list, so *regenerate my glossary please* works. Two words that each mean
  something must still agree, so a second word still narrows the list.
- **⌘K → *regenerate*, *rerun*, *cost*, *export*, *delete* … now offers *Metadata***, the page with
  those controls.
- **It can't quietly fall behind.** A section with no search words is now a compile error. The
  phrasings above are checked against the real page in a test. The Metadata row in
  [web-client.md](../project/web-client.md) gives the rule in your words. The contents list (ToC)
  needs nothing, because it is built from the page's sections.

**Not done, named in the plan:** ⌘K *on* the Metadata page still does not jump to a section. Its
Metadata row is the page you are already on. If that is the box you used, that is the next piece.
