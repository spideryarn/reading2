# Extra diagnostics carry the source file

**SPIDERYARN-READING2-32** · Greg (admin, so trusted — `scripts/feedback-reporter.ts` exit 0) ·
suggestion · 2026-09-12 08:06Z · iPad, production, on `entropy-24-00930-spya-bmvfyb`

> Send up more diagnostic information including attaching source file when the user chooses Send
> extra diagnostics to help with debugging. Change the Feedback dialog message re extra diagnostics
> accordingly.

**Ending: shipped** — on `dev`, 2026-09-13. Not deployed; production is Greg's.

With *Send extra diagnostics* ticked, on a page of one of the reporter's own articles, the Sentry
copy of a report now carries the file the article was made from (up to 10 MiB) and `article.json`
(the page's article payload plus a pick of its metadata — never the reader's profile, purpose or
upload filename), with `source_file` and `article_json` tags saying what happened to each. The
dialog's tick-box sentence and `/privacy` say so, and `/privacy` no longer promises that a report
never carries article text. Nothing new leaves the browser.
[260913a](../plans/260913a-send-the-source-file-and-the-article-with-extra-diagnostics.md).
