# The twelve probe tasks

Each is a task adjacent to one that recently landed, so the code it should reuse now exists. The
"key" column is what the answer-key writer reads; the probe never sees it.

| Id | Task | Key |
|---|---|---|
| P01 | On the shelf (/read), show each article's "added" date as relative time ("3 days ago"), with the exact date on hover. | 260930i-changelog-release-dates-as-relative-time.md |
| P02 | Add a new paid AI call: a one-sentence "why this matters" line generated once per article and shown on the article's metadata page. | 260930f-article-cost-on-the-metadata-page.md, 260930i-simple-summaries-eli15-sub-mode.md |
| P03 | Send the reader an email when their PDF import finishes. | 260930i-email-admin-on-sign-up-and-plan-upgrade.md, 261001b-sign-up-mail-retried-when-a-send-fails.md |
| P04 | The Citations band's header row overflows horizontally on a 375px-wide phone; fix it. | 261001e-masthead-facts-line-overflows-a-phone.md, 260930h-tweets-band-fits-ipad-and-copy-buttons-become-icons.md |
| P05 | Add a tooltip, including its keyboard shortcut, to the Quotes mode's copy button. | 260930h-trajectory-info-button-on-the-controls-row-and-shortcut-keys-in-tooltips.md |
| P06 | Add a new mode to the band, "Questions", behind the experimental-features switch. | 261001d-command-bar-lists-sub-modes.md, 261001d-annotations-mode-marginalia-in-a-right-hand-column.md |
| P07 | Make the FAQ mode generate automatically after an article is imported, like the main modes already do. | 260930c-auto-generate-the-main-modes-after-import.md |
| P08 | Add a per-reader setting "preferred summary depth", stored in the database and editable on /profile. | 260930f-high-powered-ai-per-article.md, 260930j-quiz-questions-shaped-by-the-readers-reading-goal.md |
| P09 | Change the quiz prompt so its questions avoid the article's worked examples, and show that the change is an improvement. | 261001c-quiz-adapts-heavily-to-the-reader-profile-and-reading-goal.md, 261001h-plain-words-summaries-keep-the-piece-s-contrasting-terms.md |
| P10 | Show a loading spinner while the Glossary mode's list is loading. | 260930j-shelf-topics-loading-spinner.md |
| P11 | Let a signed-out visitor to a public article see the Ideas mode's stored list. | 260929c-a-visitor-sees-every-stored-mode-on-a-public-article.md, 261001b-public-article-visitors-see-debate-threads-relevance-citation-entry-and-cross-references.md |
| P12 | A reader reports, through the Feedback button, that search returns nothing on one particular article. Investigate and fix it. | feedback-reports.md, debugging.md, recent search-reliability plans and postmortems |
