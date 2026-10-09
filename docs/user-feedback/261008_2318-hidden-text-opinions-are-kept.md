---
reports: spya-gqq38u
ending: shipped
comment: Saved now: the opinions are kept with the article and dated, and come back on reload. The rule is in database.md, and the plan lists what else we still throw away (Mirror is the one worth doing next).
---
# Hidden text's Opus opinions are kept

Report `spya-gqq38u`, from Greg (an admin, proven by `scripts/feedback-reporter.ts` exit 0), filed
2026-10-08 23:18 UTC.

> I'm looking at a recent release, and it has something about the hidden text, maybe for the referee
> mode. Okay, great. It sends it, I think, to Opus for Opus to say where the hidden text looks
> suspicious. Okay, great. But then it said something like, The opinions are never saved. Why not?
> Any time we run AI processing or do valuable work, we should save it, unless there's a really good
> reason, like it's going to introduce enormous complexity or we're completely sure it's ephemeral
> or not going to be valuable. And we should make a minimal update to a doc, perhaps the database or
> mode doc, that sort of says, like, you know, we should be saving stuff that we've generated with AI
> that cost us money or time or effort.

**Ending: shipped**, on `dev`. Plan: [261009a](../plans/261009a-save-hidden-text-opinions.md).

- **Why it was not saved:** it copied Mirror's precedent. Mirror's reason was that the answer is a
  prompt to reread your own comments rather than something to keep. That reason never applied
  here.
- **Now** the last finished answer is kept per article (`referee_hidden_checks`, an additive
  migration), with when it was asked. A reload shows the same lines, and the summary says *Asked on
  8 October 2026.* A failed retry leaves the last answer in place, and leaving mid-call no longer
  wastes it: the call finishes and its answer is waiting. The answer is owner-only, like the rest of
  Referee, and it goes out in the export.
- **The rule** is in [database.md § AI output we paid for is kept](../project/database.md#ai-output-we-paid-for-is-kept),
  in Greg's words, with a pointer from [mode.md](../project/mode.md) § Its cost.
- **The sweep** for other paid output we throw away is in the plan's table. Nothing was trivial to
  fix. **Mirror** is the one real candidate, with no privacy reason against it. It needs a
  fingerprint of the comments and criteria it read, which makes it moderate work. The rest (Help
  answers, command suggestions, the quiz's difficulty word, dictation) are promises in
  [privacy.md](../project/privacy.md), or are ephemeral.
- GPT Sol reviewed the plan (ten findings, all taken) and the code.
