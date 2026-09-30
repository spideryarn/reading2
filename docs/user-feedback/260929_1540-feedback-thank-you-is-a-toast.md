---
reports: spya-srek7a
ending: shipped
---
# The Feedback thank-you is a toast

SPIDERYARN-READING2-58 (`spya-srek7a`), from Greg (admin), filed from the Feedback dialog. The time
in the file name is when this session picked the report up. The report text came in the brief,
because this session had no Sentry access.

> Remove "It is filed" from the post-Feedback message.
>
> And in fact, that post-Feedback message should be a toast in the corner that disappears after a
> few seconds, rather than a blocking modal.

**Ending: Shipped.** It is on `dev` and not deployed. Resolve 58; the next feedback sweep does the
Sentry status write.

What we did:

- A successful send now closes the dialog at once.
- The thank-you appears as a small toast in the bottom corner and goes away by itself after five
  seconds. It stays up while the pointer is over it, and it has a close button.
- The three thank-you sentences no longer say "It is filed".
- There was no toast in the app, so this adds a small one (`src/web/Toast.tsx`) and no new library.
- Anything typed after pressing Send is still kept for the next report.

Plan: [260929f](../plans/260929f-feedback-thank-you-as-a-toast-and-dictation-that-never-runs-out-of-tape.md)
§ Part A.
