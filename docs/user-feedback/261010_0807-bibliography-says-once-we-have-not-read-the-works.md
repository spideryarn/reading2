---
reports: spya-rbp55k
ending: shipped
comment: The line is said once above the list now. A chat's summary shows wherever Ask in chat has an item to put it on; Summary's paragraph and Quotes, Timeline and FAQ are still queued.
---
# Bibliography says once that we have not read the works

Report `spya-rbp55k` (#547, SPIDERYARN-READING2-GW), Greg (admin, provenance proved by
`feedback-reporter.ts`), 2026-10-10 08:07 UTC, a suggestion filed from Sources › Bibliography on
`lawrence-kuhn-2024-a-landscape-of-consciousness-spya-hs82mz`, build `29220e7d`:

> In bibliography mode, it warms "we have not read this work, just the piece that cites it" over
> and over and over again. It doesn't really add much. Since we've got rid of the vacuous summary
> phrase, so maybe we can get rid of that warming as well.
>
> I think in a previous feedback report, I'd requested that if I click Ask in Chat and get a nice
> response, that that should auto-generate a short summary that shows up in the citation entry, and
> that that should be true for anywhere where we offer Ask in Chat.

**Shipped**, to `dev`; plan [261011c](../plans/261011c-bibliography-says-we-have-not-read-the-works-once.md).

- **The line is said once**, above the list: *Unless a row says otherwise, we have read none of
  these works, only the article that cites them.* A row, or a citation's hover card, says something
  about reading only when it differs: a page found for it, a search extract read, the paper read.
- **The chat's summary in the entry** was built by the earlier report's work
  ([261010s](../plans/261010s-ask-in-chat-resumes-its-thread-and-becomes-an-icon.md),
  `a350ae8eb`), ten hours after this report was filed, and is in production: Glossary,
  Bibliography, Ideas and Claims show the chat's gist in the button's place. GPT Sol found two
  places it had not reached, built here: Reception's *Your angles*, and a comment that started a
  chat.
- **Still queued**: Summary's paragraph button stores nothing to find its chat by (`qi-vj7p4sbh`,
  which this report answers yes to), and Quotes, Timeline and FAQ have no Ask in chat yet
  (`qi-bd6h2fnd`). Both need a migration on the same database checks, so they land one at a time.

Checks: red-first tests for the row, the band's one line, the hover card, the angle's gist and the
comment's gist; GPT Sol's plan and code reviews; a browser pass on the box, and the Help page's
Bibliography screenshot retaken.
