# An alternate identifier does not inherit the primary identifier's provenance

The feedback reporter accepted either a Sentry-carried `spya-` id or a human-facing report number.
When either lookup found no row, it emitted the same warning that Sentry held an event the server
did not write and instructed an agent to treat it as attempted abuse. A mistyped conversational
number such as `#999` therefore became a security signal. Review of commit `16963ad41` caught it;
nothing reached a reader.

## What happened

`parseReportRef` preserved whether the reference was a string id or a number, but `run` handed both
empty results to `judge`, whose missing-row branch was written for a claimed server-generated id.
The renderer then spent that provenance claim for both inputs. The database result was the same;
the meaning of absence was not.

The root cause was **provenance erased at a shared lookup result**: two identifiers reached the same
row, but only one was evidence attached to a Sentry event. Commit
`16963ad41c0b503d0919d5ac9a235ec459f3e4d7` introduced the numeric lookup and reused the older
missing-id classification without carrying that distinction through the decision.

## Why nothing went red

Tests covered a missing `spya-` id and correctly expected the abuse warning. They also covered
successful numeric lookup and pre-migration inability to tell. There was no empty numeric lookup,
so the shared branch looked like reuse rather than an assertion that the two absences meant the
same thing.

## What would have caught it, ranked by ease against value

1. **Test absence for every accepted identifier kind** — done. The numeric case now goes red if it
   mentions forgery or the nefarious-report path.
2. **Keep provenance in the verdict** — done. `missing-number` is distinct from a missing claimed
   server id and tells the agent to check the number.
3. **Use separate command-line options and lookup pipelines for ids and numbers** — rejected. It
   would make the distinction conspicuous but duplicate most of a small command and make ordinary
   use worse without improving the final classification.
4. **Treat every missing reference as harmless** — rejected. That would discard the useful signal
   when a Sentry event claims a server-generated id that production never held.

## The long-term fix

The applied fix is also the right design at this scale: retain the identifier kind through the
verdict and give each kind its own absence semantics. Any future alternate key must add both its
successful-lookup test and its missing-lookup test before sharing this path.

## The thing I would tell myself

I saw two keys for one row and assumed they had one trust meaning. Whenever a security conclusion
depends on where a value came from, I must carry that origin past the shared database operation.
