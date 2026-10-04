# `footnote-digits/` — glued footnote and citation numbers, across production

The scripts behind
[261004d](../../docs/investigations/261004d-glued-footnote-and-citation-digits-census-across-production-articles.md).
They read production and write nothing there. The data they produce is real articles and a reader's
annotations: **keep it outside the repo and delete it afterwards.**

The exception is `source-notes-absence.ts`: an offline, synthetic probe GPT Sol wrote in its code
review. It uses no credentials. It shows a real source note leaving `hasNotes` false, and asserts
what follows from that today: a footnote's number does **not** pair a work with entry 2 of a
ten-entry list (`citesMostOfListGlued`), and still does with a one-entry list. Run:

```sh
node --import tsx evals/footnote-digits/source-notes-absence.ts
```

The [postmortem](../../docs/postmortems/261004m-local-evidence-cannot-prove-an-article-wide-classification.md)
names the class.

```
export FD_DATA=/some/dir/outside/the/repo

# 1. one read-only snapshot of production (a single repeatable-read, read-only transaction, rolled back)
node evals/footnote-digits/prod-read.mjs evals/footnote-digits/snapshot.sql $FD_DATA/fd-snapshot.json
node evals/footnote-digits/prod-read.mjs evals/footnote-digits/chunks.sql   $FD_DATA/fd-chunks.json

# 2. the loose detector: every glued 1-3 digit number, and whether it is already a link
node evals/footnote-digits/census.mjs            # writes $FD_DATA/fd-candidates.json

# 3. what today's renderer does with production's cached PDF transcriptions (no model call)
npx tsx evals/footnote-digits/measure.ts cached
```

`measure.ts` needs `fd-labelled.json`, which is `fd-candidates.json` with a `label` on each row
(`footnote`, `citation`, `affiliation`, `refvolume`, `other`, or `linked`). The labels came from
readers, not from code: three subagents read every candidate and a fourth read a sample blind.
That step is not scripted, on purpose — a script that re-applies a pattern cannot measure one.

`fetch-sources.mjs <slug-fragment>…` downloads stored PDFs from production's bucket (a `GET`) into
`$FD_DATA`, for a local import. `measure.ts fresh` compares local imports (`fd-imp-<name>.json`,
each `{ extractedHtml }`) against production's blocks.

**`prod-read.mjs` reads `.env.prod` from the primary checkout** (`SPIDERYARN_PRIMARY`, default
`/home/greg/code/spideryarn2`) and prints only the host. Never a bare `SET` on that connection
([database.md](../../docs/project/database.md)).

What `measure.ts` reports per article: blocks kept and lost (by handing production's full block
rows to `splitIntoBlocks` as the baseline, which is what stage 3 does), notes shown and linked,
and how many of the reader's anchored things sit on a block that goes — comments, passage chats,
reading time, and the block ids named inside saved chats, searches and referee runs.
