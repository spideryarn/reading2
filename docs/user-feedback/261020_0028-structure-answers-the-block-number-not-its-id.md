---
reports: spya-mxdf6r
ending: shipped
comment: The JSON was already schema-checked; the model miscopied block ids. Structure now gives each block's number instead, right 20 of 20 times on Adrian's article. Thirteen other steps copy ids too: queued, to measure each.
---
# Structure answers the block's number, not its id

`spya-mxdf6r` (#661, suggestion, SPIDERYARN-READING2-MT), from Greg. He is an admin:
`feedback-reporter.ts --report-id spya-mxdf6r` found an administrator's row in production; the
Sentry event itself was not matched. Filed 2026-10-20 00:28 UTC from
`https://www.spideryarn.com/changelog#release-176`, build 275a685d. Queue item `qi-9tqs9hpz`.
Addenda: none.

> In a recent feedback report, I talked about how Adrian had a problem loading the structure for the
> article he uploaded. He's another user, so you can probably find the article. It was about
> sentience in animals. And I just saw in a recent changelog that you'd done something to make it
> more robust to AI errors. I'm just wondering, can't we define the schema, you know, for the JSON or
> whatever, or make sure it's valid JSON? I guess I'm just looking for a clean way to deal with this
> rather than a hacky way. Search the web for best practices.

**Ending: shipped**, on `dev`, not deployed. Plan, evidence and the four GPT Sol reviews:
[261020aa](../plans/261020aa-structure-answers-the-block-number-not-its-id.md).

## What we found

- **The JSON was already valid by construction.** Structure has sent a strict JSON schema since
  2026-10-02. What failed was one value inside it. The prompt shows each block as
  `[582] spya-xcf0dz …`; the model copied the id as `spya-582xcf0dz`, and that block does not exist.
  The earlier fix (261019l) decoded the slip after the fact.
- **Making the schema check the id's shape is not enough.** We tried it: a regex on the id stops the
  splice, but then the model often writes a *real but wrong* id instead. Measured on Adrian's
  article, read from production read-only:
  - Part VI started at its heading in 3 of 10 answers under the old schema;
  - in 9 of 20 with the id's regex;
  - in **20 of 20 when asked for the number**.

## What we did

- Each section's start is now the block's number (`582`), typed as an integer in the schema. Code
  maps it to the block. There is no id left to mangle, so 261019l's decoder is gone.
- A blind quality panel (Sol and Opus judging eight articles) found no loss. It is also slightly
  cheaper and faster.
- **Queued, not built:**
  - `qi-pdsk59zs`: thirteen other steps (Ideas, Timeline, FAQ, Tweets, Matter and others) also copy
    ids. Each would be its own measured prompt change, and none has been seen failing this way.
  - `qi-snsehjva`: a stale "use only block ids" line in the Structure prompt, and the
    section-deepening call.
