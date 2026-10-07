---
reports: spya-h7skj5, spya-e9t58e
ending: shipped
---
# The permalink, and sharing, while an article is still importing

Two reports from Greg, filed from the signed-in home page two minutes apart: `spya-h7skj5` at
2026-10-05 20:29 UTC (Sentry event `72e4668517c1424d983c9cc710364e9d`) and `spya-e9t58e` at 20:31
UTC (Sentry event `da7a961fea2d44588c351d87924cd990`). The words are as the Overseer relayed them,
marked as an admin's with Sentry confirmed. This session did not run `feedback-reporter.ts` itself.

`spya-h7skj5`:

> While I'm importing a paper, I don't know what the permalink will be, so I have to wait for it to be finished to be able to bookmark or send it to someone. Is there a way we could at least include a permalink icon for what the link will be eventually?

`spya-e9t58e`:

> While I'm importing an article, make it possible for me to mark it as public/shared as it's importing

**Ending: Shipped**, both, on `dev`. The next feedback sweep does the Sentry status write.

What was built, in the browser only
([261005l](../plans/261005l-permalink-and-share-while-an-article-is-importing.md)):

- **A link button on an import's card**, on the add page and in the shelf's list, which copies the
  address the article will have.
- **That address works for its owner straight away**: opened before the import has finished, it
  shows the import's progress and then the article, where it used to say *Not shared*.
- **A *Make it public* box on the add page**, with the same confirmation as the Metadata page. The
  article becomes readable by others when the import finishes.

Put to Greg as questions, and answered on 2026-10-06. Built as the plan's stage 2, also on `dev`:

- **One *Sharing* section on the add page, closed until opened**, with *Create a private link*
  beside *Make it public*.
- **A visitor who opens a shared article before its import has finished** is told it is still
  being added, and the page opens it when it is ready.
- The import's card now appears as soon as the import is accepted. It used to take about eight
  seconds, longer than some imports.

Declined: a small server read so that a second tab shows the public box as it really is.

Both stages were checked in a browser at desktop, iPad and phone widths on 2026-10-06; the plan
says what was seen and what was not.
