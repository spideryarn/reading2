# Code review: the stage 0 preview script (261003f)

One new script, to be run by Greg against the **production** database. Review it and **fix what
you find inside these files**; report anything wider for me to decide. Do not build anything else.

Files in scope:

- `evals/shelf-topic-clusters/preview-shelf.ts` (new)
- `evals/shelf-topic-clusters/run.ts` (one change: `induce` is now exported)
- `package.json` (one new script, `shelf-topics:preview`)

Context: `docs/plans/261003f-shelf-topics-named-by-a-model-as-concepts-not-phrases.md` § Stage 0 and
question 1; `docs/project/database.md` on reading production; `scripts/shelf-terms-report.ts` is the
precedent; `src/store/pg-shelf-terms.ts` § `shelfRevisionsQuery` and `src/shelf-topics.ts` are what
the script's "today" list has to agree with.

**It has never run on a real shelf.** The session that wrote it was refused every read of real
data. What was run: typecheck, and both owner paths against the local database for an owner that
does not exist. So please read the half after the queries with particular care.

Check:

1. **It cannot write.** Every query inside one `begin read only` ... `rollback` on its own
   connection; no `SET` that outlives the transaction on the pooler; nothing reaches `getDb()` or a
   pool by import side effect (look at what `run.ts`, `ai-spend.ts`, `choose.ts`, `extract.ts`,
   `case.ts` do at import); the model call's spend is not recorded to the database being read
   (`collectSpend` with no sink), and nothing else in the gateway path writes.
2. **TLS**: `sslDecisionFor(url).ssl` is what `pg.Client` needs for the remote, and a refusal
   surfaces rather than falling back to an unverified connection.
3. **Nothing sensitive is printed or logged**: no password in the `Target:` line, no titles unless
   `--members`, and nothing from the gateway's logging.
4. **The queries match the route's shelf**: same articles as `shelfRevisionsQuery` (owner, slug not
   starting `_`, a current revision with a tree and blocks, archived handling, order). Column and
   table names against `src/db/schema.ts`. The `auth.users` lookup, and what happens when the role
   may not read it (an error inside the transaction).
5. **"Today" agrees with the route**: stored candidates at `EXTRACTOR_VERSION`, stored scores
   applied as `shelfTopics` applies them (including its validity check and its fallback to the
   program's list), skipped articles excluded.
6. **The proposed list**: the `ShelfCase` handed to `induce`, the cap at 150, the title the reader
   sees, gist or abstract.
7. **The output**: the side-by-side table, the counts, the coverage line, behaviour on an empty
   shelf, on a failed model call, on a shelf below eight works.
8. The two commands in the plan's question 1: would they work as written?

Report findings numbered, most serious first, each P0/P1/P2, saying what you changed. End with one
line: safe for Greg to run against production?
