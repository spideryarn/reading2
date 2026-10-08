---
id: q-a7kffw
report: spya-a5gzb9
status: answered
asked: 2026-10-01
title: May a failed import's report carry the address, file name and error?
refs: SPIDERYARN-READING2-8A · qi-m8683pz7 · docs/plans/261001s-imports-detail-on-home-and-why-reading-saved-state-and-first-open-prompt.md § review item 6 · docs/plans/261008j-a-failed-import-report-carries-the-address-and-a-record-of-every-import.md · docs/user-feedback/261001_1035-past-imports-say-more-and-why-you-are-reading-says-if-saved.md
acted: spya-f9c9pe
---
Background. Your report about imports shipped: a failed import now has a Report this button, which opens Feedback as a Problem with some details already filled in. This is the follow-up that was left for you.

Today the filled-in report carries ids, step names and times only. It leaves out the source address, the file name and the error sentence. Putting those in would bend the rule Feedback keeps: a report holds only what the reader typed, a value from a fixed list we wrote, or a fact the reader is told, on the page, that we take. A pasted address can also carry a private token, as one of your own did. What leaving them out costs: pressing Dismiss on a failed import deletes its record, so a report that was filed and then dismissed names an import we can no longer look up.

Question 1. May the filled-in report also carry the source address, the file name and the error sentence?

A. No, keep it as built: ids, step names and times only. The rule stays as it is. Gives up: a report on an import that was then dismissed leads nowhere.

B. Yes, carry all three. The report then says what went wrong by itself. Costs: a change to a stated privacy rule and to what the privacy page promises, and an address with a private token in it would be stored in the report.

Question 2. Should an import of an uploaded file link back to the original file?

A. No, as built: the file name shows as text.

B. Yes. Costs: nothing today hands a reader back the file they uploaded, so this is a new way to read stored files, for the owner only, with its own security check.

No recommendation was made on either: both were written up for you to decide.

## Greg's answer, 2026-10-08 (in the Feedback dialog, reply `spya-f9c9pe`)

> yes, it's fine for the filled-in report to carry information about the metadata that you suggest, whether it's the source address, file name, error sentence, that's definitely fine.
>
> I mean, maybe we should even actually have a database table or something. I mean, more generally, it feels like we should be storing all of the imports, and if they're successful, maybe there's very little to store other than that it happened when it happened and whatever. But for a failed import, we definitely want to be storing information, I'd have thought. Now, it could go to Sentry, but maybe it makes more sense to put it in the database and then it can link to a bunch of other stuff. So, in other words, let's just make sure that we are making it possible for the dev agent to access, find, debug whatever it needs to solve problems from production after the fact.

Settled. Question 1 is B: Report this on a failed import now carries the source address, the file name and the error sentence, and /privacy says so. The table he suggests is built: every import that ends is recorded in import_records, kept after its job is trimmed, deleted with the article, and readable by a developer with scripts/import-records.ts. Question 2 was not answered and stays as built (the file name shows as text, with no link back to the file). Plan 261008j.
