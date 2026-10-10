---
reports: spya-mutgym, spya-zz4z4c
ending: shipped
comment: Every "older version of the article" notice now has an × that holds until that thing is made again. Quiz's is left: there no answer can be marked, and the notice is the only thing saying why.
---

# The "older version of the article" notices can be dismissed

Report #524, `spya-mutgym`, Greg, 2026-10-09 22:59 UTC: a suggestion filed from Sources
(`mode=peer-review`) on the Attention paper (`arxiv-1706-03762-spya-wyt7j0`). Admin provenance proved
by `feedback-reporter.ts` (exit 0). Queue item `qi-hxqzh4mm`. No Sentry sign-in in this session.

> I'm seeing this "This describes an older version of the article." in a mode.
>
> Look for all of those and in each case make sure there is a way for me to dismiss them if I don't
> want to rerun it.

**And a repeat**: report #529, `spya-zz4z4c` (SPIDERYARN-READING2-G9, queue item `qi-by7mhe2c`), Greg,
from Sources › Reception, about *"The article has changed since this search ran, so some of these
may be answering something the piece no longer says."* That is the same notice in other words (a
grep for "older version" misses it). It was already in scope as the Debate Reception row of the
plan's table, and it gets the same ×.

**Shipped** as [261010a](../plans/261010a-dismiss-older-version-notices.md). Fifteen notices across
fourteen modes, plus the specimen on `/design`, share one × (`src/web/StaleNotice.tsx`). A dismissal
holds until that artefact is made again, and is stored per article and mode in
`stale_notice_dismissals`. **Quiz is the deliberate exception**: its stale questions cannot be
answered, and the banner is the only explanation of the disabled box. The plan's § After GPT Sol's
plan review gives the reasons.
