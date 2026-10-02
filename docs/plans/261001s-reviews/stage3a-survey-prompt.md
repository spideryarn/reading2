# Survey: 261001s stage 3a (read-only)

Read-only. Another builder is editing Structure (`src/hierarchy*.ts`, evals) in this tree at the
same time; ignore those files' churn and treat Structure as "in progress, stage 2".

Read `docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md` § Stage 3a and 3b, and
`src/messages-structured-output.ts` (the Messages adapter and validator from stage 1).

Produce, as your whole answer, **a Markdown matrix of every model call in `src/` that expects JSON
back** — `parseJsonAnswer` / `parseJsonFrom` callers that parse a model answer (exclude stored-data
parsers: src/shelf.ts, src/chat.ts, src/comments.ts, src/searches.ts, src/glossary-lookups.ts and
any like them — list the exclusions in one line), the chat-wire `response_format` users, and any
other `JSON.parse` of model text (search for it). One row per call site, columns:

| file:line | stage / mode | wire (Messages / chat) | model + effort | streams to reader / partial parse? | cache group (`sharesArticleCache`) | shape (recursive? max depth) | tools/plugins | refusal & max_tokens checked before parse? | prefill? | eval that measures it | verdict |

Verdict is one of: **fits** (with the one-line reason and any schema difficulty, e.g. a union, an
open map, >24 optional fields), **fits after X** (name X), **does not fit** (why), or **already
strict**. Use the plan's expected misfits as hypotheses to confirm or reject, with evidence.

Then, below the table:
1. A proposed migration order for stage 3b, observed failures first (Ideas, Sketch, Quotes), then
   by cache group, then chat-wire — with the cache-group change (`sharesArticleCache` gaining
   schema identity) placed where it must go.
2. Any call where a schema would change reader-visible behaviour (streaming, a prose preamble the
   UI shows), and how to keep it.
3. Anything surprising.

Cite file:line for every claim. Be exhaustive rather than brief; this matrix goes into the plan.
