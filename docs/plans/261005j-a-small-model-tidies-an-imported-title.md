# A small model tidies an imported title; the rule is the fallback

Up: [plans.md](../project/plans.md) · Follows
[261005g](261005g-tidy-an-imported-title-and-keep-the-original.md), which built the rule and put two
questions to Greg · Evidence:
[261005b](../investigations/261005b-title-tidying-rule-against-a-small-model.md)

**Status:** built, 2026-10-05, in the `title-model` worktree; code review in progress. Uncommitted. Not deployed.

> yes, a small model (e.g. GPT Luna or DeepSeek). ideally piggybacking on an existing call we're
> already doing as part of the import process
>
> — Greg, 2026-10-05, answering `[Q-title-model]`

> no, just articles going forwards
>
> — Greg, 2026-10-05, answering `[Q-title-backfill]`

## What we are building

When an article is imported, one cheap model call tidies its title: capitals, a site's name stuck
on the end, stray spacing. Code checks the answer changed nothing else. If the call fails, is slow,
or the answer does not pass the check, the title is tidied by today's rule
([`src/title-tidy.ts`](../../src/title-tidy.ts)) exactly as it is now. The original title is kept in
`title_original` as today, and "Use that title" on the Metadata page is unchanged. Articles already
imported are not touched.

What the rule gets wrong and the model gets right, from the measurement:

| as it arrived | the rule | the model |
|---|---|---|
| `THE FUTURE OF NASA AFTER THE SPACE SHUTTLE` | The Future of Nasa After… | The Future of NASA After… |
| `THE MCDONALD PAPERS: LETTERS FROM O'BRIEN TO MACARTHUR` | The Mcdonald Papers: … Macarthur | The McDonald Papers: … MacArthur |
| `AN FMRI STUDY OF WORKING MEMORY IN ADHD` | An Fmri Study … in Adhd | An fMRI Study … in ADHD |
| `EL ORDEN DEL TIEMPO` | El Orden Del Tiempo | El orden del tiempo |
| `LIFE OF PI` | (left in capitals) | Life of Pi |
| `Thinking, Fast and Slow – Wikipedia` (the page declares "Wikipedia") | (left) | Thinking, Fast and Slow |
| `Microsoft Word - The Economics of Attention.doc` | (left) | The Economics of Attention |

## Where the call goes: its own, inside extract. No one existing call covers every import

Greg asked for a piggyback first. The title is first written in three places, and it has to be
tidied **there**, before it is stored: `title` is in the fingerprint of every generated mode
(`articleFingerprint`, src/source-hash.ts), so a title that changed after extract would mark them
stale. The import-time model calls that see a title before it is stored:

| call | which imports | why it does not carry the tidy |
|---|---|---|
| a web page's `extract` | every web page, the commonest import | It makes no model call at all. |
| `pdf-frontmatter`, the PDF's transcription and its authors pass | a PDF read in full | PDFs only. The front-matter answer is block ids, which is what stops it inventing a title; a tidied title would be a new free-text field on it, checked separately. |
| `paper-metadata` (DeepSeek) | a paper added in a batch, PDF or web page | Its prompt says "exactly as printed" and its title is scored on that; a second, tidied field beside it would be possible. |
| `structure` (Sonnet) | every full import | Runs after the title is stored. A long piece is structured in slices, and when slicing fails the tree is built with no model. |
| `reading-difficulty` (DeepSeek; session `reading-time-difficulty`, not landed) | every full import | Runs at the end of `blocks`, after extract. Agreed with that session, 2026-10-05: two jobs. |

So a web page needs a new call whatever we do. Riding on `pdf-frontmatter` for a PDF and
`paper-metadata` for a batch as well would be three prompts, three answer shapes and three checks
for one job, and would change two extraction contracts that are measured as they stand. **One new
job, `title-tidy`, called at all three places**, is the smaller design. This is the trade-off to
name: every import makes one more paid call and waits for it. Measured: about 1 second at the
median, 0.007 cents.

## The design

**One module, [`src/title-tidy-model.ts`](../../src/title-tidy-model.ts)**, shaped like
`src/paper-metadata.ts`:

- `TITLE_TIDY_SYSTEM`, a strict schema `{ "title": string }`, and `titleTidyRequest`.
- **What the model is sent: the title, the site's name and the declared language, as one JSON
  object. No body text.** A light tidy does not need it (the model knows `NASA` and `McDonald`),
  and it means no article text goes anywhere new. All three fields are the page's, so all three are
  named as data, and a JSON string cannot pass for a line of ours.
- **`isLightEdit(original, answer, siteName)`** is the check, because a prompt is a request and not
  a guarantee. The answer must be the original with at most:
  1. a part taken off the front or the end, which must be one of: **the site's name the page
     declared**, attached at a separator (` - `, `|`, `–`, `—`, `»`, `·`); a bracketed identifier or
     `Microsoft Word - ` at the front; a file extension at the end; a footnote mark after a word of
     three letters at the end;
  2. spacing tidied;
  3. capitals changed, **only if what is kept has no lower-case letter in it**.

  Every other character must be the same, in order, with the same word breaks. So a title in mixed
  case is never recased by anybody; `L²` cannot become `L2`; a subtitle cannot be cut at its colon;
  and what is kept after a cut must be more than `Home`. **With no site's name declared, nothing
  comes off at a dash.** The first version left that judgement to the model, and in the
  measurement it took off an author's name and a sutta's Pali title. The cost: `The Dhammapada |
  Project Gutenberg`, from a page that declared no site's name, keeps its suffix.
- `tidyTitleByModel` makes the call and throws on anything unusable. `modelTitleTidier()` returns
  the `TitleTidier` a seam calls: the model's answer, or `tidiedTitle` (the rule) on any failure.
  It throws only when the step itself was cancelled. It logs which of the two answered, never the
  title.
- A title with no letter or digit, or one over 500 characters, is not sent.

**The job.** `title-tidy`, on `deepseek/deepseek-v4.1-flash` (`TITLE_TIDY_MODEL`), `effort: none`,
with a copy of `paper-metadata`'s route: Fireworks, DeepInfra or Together, zero-retention only
(Greg's choice for that job, 2026-10-01). DeepSeek over Luna because the answers were as good, it is
faster (1.0 s against 1.7 s) and it is already on a zero-retention route. An 8-second deadline, then
the rule.

**The three seams.**

- `runExtract` (src/extract.ts) and `runPdfExtract` (src/pdf-read.ts) take an optional
  `titleTidier`. Absent, they use the rule alone, so every existing test and eval keeps running with
  no network. The pipeline's `extract` step passes the model's.
- The `metadata` step (src/pipeline.ts) awaits the tidier on the title `paperMeta` would use and
  hands the result in; `paperMeta` stays pure.
- `titleTidiers` in src/pipeline.ts holds the one the steps use, so a test can spy on it, as
  `metadataReaders` does. `stepTitleTidier` wraps it for one run of a step: it binds the step's
  cancellation signal, and it **keeps the title the last revision tidied when the same title
  arrives again**, with no call. Only a title that was changed is held. One stored as it came is
  asked about again, so an article imported before any tidying is still tidied when it is next
  extracted, as 261005g promised.

**Not changed:** `title_original`, the store, the export, the Metadata page, the `<h1>` block (still
the author's capitals), the extracted page's `<title>`.

**Also touched:** `/privacy`'s sentence about what DeepSeek reads; `content-extraction.md`'s
section on the tidy; the old plan's status.

## Trade-offs, named

1. **One more call on every import, and import waits for it** (median 1 s, up to 8 s, then the
   rule). The simpler option passed over: call the model only when code thinks the title needs it
   (all capitals, or a separator in it). It would skip about three imports in four, and it would
   miss the titles code cannot spot, which is the reason for a model. Easy to add later if the
   second matters.
2. **A title the model left alone can change on a later extraction.** The model disagreed with
   itself on a few titles in a hundred between runs. A title it changed is held steady (above); one
   it left alone is asked about again, and if the answer differs the generated modes go stale.
   Holding those too would need a record that the model had looked, which is a column.
3. **No column for "tidied by".** The `ai_calls` row has the job, the model and the time, and the
   log line says model or rule.
4. **What the model may take off is wider than the rule's.** The declared site's name,
   `Microsoft Word - `, a file extension. The 261005g plan left these out as medium risk; the check
   and the kept original are what make them acceptable now.

## Measured

[261005b](../investigations/261005b-title-tidying-rule-against-a-small-model.md): 112 titles (the 50
distinct titles in production, and 62 real works in the forms they are commonly published in), the
rule, DeepSeek twice, Luna twice on the first prompt, and a blind read of every title where the
rule and the model differ. On production's titles the two agree on all 50. On the others a blind
judge preferred the model in 25 of 26, the rule in none. The check refused 10 of 224 answers, and
each of those titles got the rule's answer.

## What the plan review changed

GPT Sol ([prompt](261005j-a-small-model-tidies-an-imported-title-plan-review-prompt.md),
[answer](261005j-a-small-model-tidies-an-imported-title-plan-review-sol.md)) kept the direction and
found the check too weak. Taken: the check was "the answer's letters and digits are a run of the
original's, and a third of them", which passed `The Order of Time` cut to `The Order`, `L²` as
`L2` and a dropped year; it is now the three permitted changes above (F1, F2). All three
page-controlled fields go as one JSON object, where the site's name and language had been bare
lines (F3). The prompt removes a site's name before it judges capitals, and keeps `A*` (F4). The
web page's tidy is bound to the step's cancellation, and a cancelled step stops (F5). A title is
held across a re-extraction from the stored pair, which needed no new column (F6). The piggyback
table says what is true: no one call covers every import, and two of them could have carried a
second field (F7). The measurement says its rule had no body to read, separates a failed call from
a changed answer, and gained the cases the review listed (F9). Not taken: `DIE STRASSE` to
`Die Straße` fails the check and stays as it came, which is the conservative side (F2).

## What the code review changed

GPT Sol, write-capable ([prompt](261005j-a-small-model-tidies-an-imported-title-code-review-prompt.md),
[answer](261005j-a-small-model-tidies-an-imported-title-code-review-sol.md)). It fixed, inside the
change: the check took "the part cut contains the site's name" as leave to cut the whole part, so
`A Title — The Nature of Time` lost its subtitle on a site called Nature; the part must now be
exactly the site's name
([postmortem](../postmortems/261005i-substring-evidence-does-not-authorize-removing-a-segment.md)).
Cuts are found on the original's own characters, so `İ` and Greek sigma are handled. A step
cancelled before or during the call stops instead of answering. The held title is compared through
`plainTitle`, as the store wrote it. One more test file that runs the real `extract` step got its
spy. Left for a decision: `plainTitle` decodes one more layer of a deeply encoded title on every
write, which is older than this change.

## Stages

1. Tests first, red: the check, the parser, the request's bytes and route, the fallback on a
   refusal, a timeout and an over-reaching answer, each seam using the tidier it is handed, the
   pipeline handing the model's in.
2. Build. `npm test`, `npm run typecheck`.
3. GPT Sol code review, write-capable. Docs. Push to `dev`.
