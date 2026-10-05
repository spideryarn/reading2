---
reports: spya-tqk7au
ending: shipped
---
# Feedback / Earlier: make the page a link, and show only my own reports

`spya-tqk7au`, a suggestion from Greg (admin, as the Overseer relayed it), filed 2026-10-05 20:38
UTC from `2608-13566v1-spya-yurten`. Sentry event `351b92ab44de4dddbb76d7ba0103d8d3`. This session
has no Sentry sign-in and did not write the Sentry status; the next feedback sweep does.

> In Feedback / Earlier:
> - It now shows the url where the suggestion was made. Make it a link.
> - And it should only show suggestions made by the current user, not by other people.

**Ending: Shipped.** It is on `dev` and not deployed.

What we did, in
[261005m](../plans/261005m-earlier-tab-links-the-page-and-marginalia-tips-say-what-to-press.md):

- **The page is a link.** It opens that page in the same tab. It goes to the page, not to the
  paragraph or mode the report was filed in; whether to carry the paragraph too is a question put to
  Greg in the session's debrief.
- **It already showed only the current reader's reports, and nothing was built for that line.**
  Checked first, as a possible privacy bug. The list's query is filtered on the signed-in account,
  with no admin exception, and `tests/feedback-store.test.ts` files reports as two readers and
  checks each lists only their own. GPT Sol looked for a way round it and found none. What Greg saw
  that looked like somebody else's is not known: this session did not read the production table.
  That is also put to him in the debrief.
