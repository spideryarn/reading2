---
id: q-sa4yuq
report: spya-n8cuqq
status: answered
asked: 2026-10-06
title: Should Feedback take a full fifteen minutes of speech?
refs: SPIDERYARN-READING2-E8 · qi-8qvg5gwv · docs/plans/261007b-dictation-says-when-it-is-about-to-stop-and-runs-fifteen-minutes.md § Questions for Greg · docs/user-feedback/261006_2202-dictation-cut-off-at-five-minutes-with-no-sign.md
---
Background. Your report about dictation cutting off at five minutes has shipped: you can now dictate for fifteen minutes, and it warns you before it stops. This is the half that was left for you.

The Feedback box takes 12,000 characters, which is about thirteen minutes of speaking without a pause. If you go past it, nothing is lost: the words stay in the box, a line says how far over you are, and Send is off until you trim. A test of fifteen minutes of speech with no pauses at all came to 15,108 characters, so that is the case that still does not fit.

It was not simply raised, because 12,072 characters is the most the database will store in one report, and the code says that limit is what stops a whole pasted article being sent on to Sentry, the outside service that keeps a copy of each report. Loosening a limit on what can leave for an outside service is yours to decide.

A. Leave it at 12,000. Covers thirteen minutes non-stop and any ordinary fifteen. Costs nothing. Gives up: a very long, fast report has to be trimmed or sent in two.

B. Raise both limits to 20,000. Covers fifteen minutes at 200 words a minute. About two hours with review, because the admin feedback page then has to load reports by size rather than by count. Gives up: a 20,000-character paste, about a short article, can go to Sentry in one report.

C. Raise it only for a dictated report. Not recommended: the server cannot tell dictated text from pasted text, so it would be a limit the browser keeps and a script ignores.

What would decide it: if you expect to dictate long reports without pausing, B. If thirteen minutes non-stop is already more than you would say in one go, A.

Recommended: B. You file most of the reports, you dictate them, and what reaches Sentry is your own words in your own account.

## Greg's answer, 2026-10-07 (relayed by the Overseer)

> yes

To option B. Built and on dev (aaab52aa7), plan docs/plans/261007j-feedback-takes-twenty-thousand-characters-and-admin-feedback-pages-by-size.md, queue item qi-8qvg5gwv. Marked answered by the feedback sweep, since the session that built it left this file open.
