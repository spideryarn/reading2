---
reports: spya-a5gzb9
ending: shipped
comment: Shipped. Since 2026-10-08 a failed import's Report this also carries the address, file name and error, and every import is kept on record so we can debug it later.
---
# Past imports say where, when, and have a Report this; "Why are you reading this?" says whether it saved, and asks again on first open

Two of Greg's suggestions from the Feedback dialog, filed 2026-10-01 10:35 and 10:41 UTC on build
`4de26073`. Admin, proved by `scripts/feedback-reporter.ts` (exit 0 on each). Sentry
SPIDERYARN-READING2-8A and -8C. Overseer queue item `qi-vjrbdnsg`.

`spya-a5gzb9` (8A), from the signed-in home page:

> In logged-in homepage, add more metadata for past imports.
>
> e.g. see screenshot of failed imports. There's not enough information there to be useful (e.g.
> hyperlink to source/original/uploaded, datetime stamp and human-readable `X ago`, quick button to
> generate a pre-populated Feedback `problem` report with lots of details, etc.

`spya-hbqezu` (8C), from the add page:

> When importing, I can see it now shows "Why are you reading this?" - great! But it doesn't have a
> UI indication of when/whether it has saved it or not.
>
> Also, if they don't fill this in (e.g. because they didn't notice it), pop up an input box asking
> why they're reading it when the article loads for the first time.

The screenshot 8A mentions was not attached to the row; the work went from the page itself.

**Ending: Shipped**, both, on `dev` in `32a4e5076` and `d5a274aee` (and the wording fix after the
browser check, in the commit that carries this note). The plan, with both GPT Sol reviews, is
[261001s](../plans/261001s-imports-detail-on-home-and-why-reading-saved-state-and-first-open-prompt.md).
Not deployed: the Overseer deploys.

- **8A.** Every import card (home page and add page) now has a line under its title: the source
  address as a link, or an upload's filename, then the date and time it was added and *3 hours
  ago*. A **failed** import has a **Report this** button, which opens Feedback as a *Problem* with
  the job id, the article's slug, the failed step, the failure kind and the times already filled in.
- **8C, first half.** Under the add page's box: *Not saved yet — kept here until the import
  finishes*, then *Not saved yet — Save and open stores it*, then a spinner and *Saving…*; *Not
  saved — the import didn't finish…* over a failed one; a refusal in the same line. The sentence
  cannot be stored before the article exists, so the line says where it is rather than pretending
  to autosave.
- **8C, second half.** When the add page opens the article by itself because the box was never
  touched, the article asks *Why are you reading this?* once, in a small dialog that saves as you
  type. *Not now* or Escape closes it; it does not come back. Not for *Open without it* (you saw
  the box and declined), not for older articles, not for bulk imports.

**Left for Greg**, on its line in [awaiting-approval.md](awaiting-approval.md):

- The pre-filled report carries **ids, step names and times only — not the source URL, the
  filename or the error sentence**. Putting those in would bend the Feedback rule that a report
  holds only what the reader typed, a closed value, or a fact they are told we take
  ([feedback.md § The one rule](../project/feedback.md)) — and a pasted URL can carry a private
  token, as 8C's own address did. The catch: *Dismiss* deletes the job record, so a report filed and
  then dismissed names a job we can no longer look up.
- **A link to the uploaded original** is not built: there is no route that hands a reader back the
  bytes they uploaded, and adding one is a new read path onto Storage with its own security check.
  The filename shows as text.

**The question for Greg is now a file**, `docs/user-feedback/questions/q-a7kffw.md`, moved there from
`awaiting-approval.md` on 2026-10-07. He sees it in the Feedback dialog and replies there
([feedback-reports.md § Asking Greg a question](../project/feedback-reports.md#asking-greg-a-question-and-acting-on-his-answer)).

**Answered 2026-10-08** (reply `spya-f9c9pe` to q-a7kffw): yes to the address, file name and error
sentence, and a database record of every import so that a developer can debug a production
failure afterwards. Both shipped on `dev` in
[261008i](../plans/261008i-a-failed-import-report-carries-the-address-and-a-record-of-every-import.md):
the pre-fill carries the three, `/privacy` says so, and `import_records` keeps one row per import
that ended, read with `scripts/import-records.ts`. (Dismiss had already stopped deleting the job on
2026-10-02, so the catch above was gone before this.) The link to an uploaded original stays as
built: Greg did not answer that half.
