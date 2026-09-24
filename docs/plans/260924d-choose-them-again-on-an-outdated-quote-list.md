# Choose them again on an outdated quote list

SPIDERYARN-READING2-3C, decided on Greg's delegated authority, 2026-09-24. Owner doc:
[quotes.md § Find more appends](../project/quotes.md#find-more-appends-only-a-stale-or-outdated-list-is-replaced).
Feedback note: [260912_0823](../user-feedback/260912_0823-quotes-long-enough-to-stand-on-their-own.md).

## What and why

`quotes/6` (2026-09-12) chooses passages long enough to stand on their own — but only on a list of
its own. A list chosen by an older prompt is *outdated* (its banner: *"These include lines chosen by
an earlier version of the prompt"*), and **Find more cannot repair it**: the old spans win every
overlap (`dedupeOverlaps` with `takenSpans`), so the longer version of an old short quote is dropped.
GPT Sol said so on 260912e (finding 1), and it went to Greg; the decision taken now is to offer the
rewrite.

Greg on 2026-09-11 — *"Remove the 'Choose them again' button, and add a 'Find more' button"* — was
about a list the current prompt chose, where appending is the honest action. The button survived on
the **stale** banner because a moved article is a state where appending cannot help. An **outdated**
list is the other such state. So:

**An outdated list gets the stale banner's shape exactly: the banner carries *Choose them again*,
the foot and its Find more are not drawn, and a forced run on it replaces rather than appends.**

## The one mechanism, reused

There is no flag on the stale path to reuse: a forced run sends `{ force: ["quotes"] }` and the
**stage** decides from the previous list's state (`existingFor`). So the change is to that decision,
not to the request:

| previous list | a forced run, before | after |
|---|---|---|
| none | own list | own list |
| same article, current prompt | appends | appends |
| same article, **older prompt** | appends, keeps older stamp | **replaces**, stamped current, **ids inherited by exact words** |
| article moved | replaces, fresh ids | replaces, fresh ids |

`existingFor` refuses an outdated list through one predicate, `isOutdated(quotes)`, which the read
path's `outdated` (src/store/pg.ts) also calls — so within one build the banner the reader sees and
the branch the stage takes cannot disagree. Across a deploy they can: see F1 below. **Older, not
different** — a newer or unparseable version counts as current, so a rollback never rewrites a newer
list with an older prompt (F3).

**Client:** the outdated banner calls the same `rerun("Choose them again", true)` as the stale one
(`regenerate()`, the reader's profile, like every list of its own since 2026-09-13), and the foot's
guard becomes `!stale && !outdated`. Find more would be a lie on an outdated list after this — it
would replace — so it goes rather than being relabelled.

## Ids on a same-article rewrite: inherit by exact words

This is the day quotes.md foresaw: *"`idsByText` … stays in `buildQuotes`, tested, for the day a
same-article rewrite returns."* `generateQuotes` passes `inherit: idsByText(onDisk)` on this branch
and nowhere else.

Why inheriting is right here and wrong on a stale list: the article has not moved, so an old quote's
words are still in the piece at the same block. If `quotes/6` chooses **exactly** those words again
(after `normaliseQuote` — case, curly quotes, dashes, whitespace, edge punctuation), a reader's
`?quote=` bookmark naming them still means those words, and keeping the id keeps the link alive.

Why only exact: `quotes/6` mostly chooses *longer* passages, so most old quotes will not match and
will get fresh ids — their links go dead, and a dead `?quote=` opens the list with nothing selected
(`selected` finds nothing; `openKey` null), which is the graceful fallback. Handing the old id to a
longer passage that *contains* the old words was considered and not done: it would send a bookmark
on one sentence to a paragraph the reader did not choose, and "contains" admits several candidates
where exact admits one. `inheritIds`' `used` set already stops one old id going to two new quotes.
The key is **block id plus normalised words** (F2): the same sentence in two blocks keeps its id only
in the block it was bookmarked in. Two occurrences inside one block are not told apart.

## The simpler and the larger options passed over

- **Keep Find more on an outdated list and add *Choose them again* beside it** (both buttons). That
  needs the request to say which it wants — a new field through `POST /api/jobs`, the queued
  payload, `work_key` and `generateQuotes` — because both are forced runs on the same list. It is a
  second mechanism beside the state-decided one, for the privilege of appending to a list that
  appending cannot fix. Not taken; named here because it is Greg's 260911a choice that loses ground:
  **an outdated list can no longer be extended in place**, only rewritten. Every list written before
  `quotes/6` is outdated today, so this reaches every existing list. 260911a's plan review turned the
  replace action down for exactly that reason on the day `quotes/4` shipped; what has changed is that
  `quotes/6` changes *what a quote is* (length), which appending provably cannot deliver.
- **Do nothing** — the old lists keep their short quotes until the reader deletes the article. The
  report is that they are not self-sufficient.

## Stages

1. Server, red first — tests/quotes-find-more-stage.test.ts: a forced run on an outdated,
   same-article list replaces (no `ALREADY ON THE LIST`, stamped `PROMPT_VERSION`, `passes: 1`) and
   an exactly-rechosen quote keeps its id; a current list still appends. Then `isOutdated`,
   `existingFor`, the `inherit` pass, pg.ts using `isOutdated`.
2. Client, red first — tests/quotes-find-more-panel.test.tsx: the outdated banner has *Choose them
   again*, no Find more; a current list has Find more, no *Choose them again*.
3. Docs: quotes.md (the section, the table, *What is still open*), the comments in src/quotes.ts and
   the panel, the feedback note.

## Done means

Both tests seen red then green; mutating `existingFor` back reds the server test; typecheck exit 0;
the quotes test files green; Sol plan and code reviews ledgered below.

## GPT Sol's plan review, and what was done with it

`gpt-5.6-sol`, high, `--sandbox review`, 2026-09-24 —
[answer](260924d-choose-them-again-on-an-outdated-quote-list-plan-review-sol.md). Changes requested;
an independent review (it read the tree; it did not self-review). It agreed hiding Find more on an
outdated list is justified.

| # | finding | what we did |
|---|---|---|
| F1 | P1 — the verb is not in the job: `work_key` and the queued payload carry only `force`, so a deploy that bumps `PROMPT_VERSION` between a Find more click and its execution turns an append into a replace (and the reverse in a rolling deploy). Carry the intended operation plus a baseline precondition through `POST /api/jobs`. | **Overruled.** The state-decided mechanism already has this exposure for a *stale* list — an article re-extracted between the click and the run turns a Find more into a replace today — and the brief was to reuse that mechanism rather than add a second. The window is a prompt bump landing while a quotes job is queued (seconds; bumps are roughly weekly), and what it yields is the list the new prompt would choose, the one the banner would have offered next. A request field through routes, the queue, `work_key` and the stage is the second mechanism the plan passed over; if Greg wants the guarantee, that is the shape. |
| F2 | P1 — text-only inheritance can move a bookmark to the same words in another block, since `locate` takes the first occurrence. | **Taken.** `idsByText` keys by block id plus normalised words; red-first test in tests/quotes.test.ts (the second-occurrence quote no longer lends its id to the first). |
| F3 | P1 (reasoned) — version inequality treats a *newer* list as outdated in a rollback, and would rewrite it with the older prompt. | **Taken.** `isOutdated` is directional on `quotes/<n>`; newer or unparseable is current. Red-first test in tests/quotes-find-more.test.ts. |

## What landed

As planned, plus F2 and F3. Server: `existingFor` refuses an outdated list via `isOutdated`
(directional), `generateQuotes` passes `inherit: idsByText(onDisk)` only on a same-article rewrite,
and `idsByText` keys by block id plus words; the read path in src/store/pg.ts asks `isOutdated`.
Client: the outdated banner carries *Choose them again* (the stale banner's `rerun`), and the foot is
not drawn on an outdated list. Red first: the outdated-replace and longer-passage stage tests, the
outdated-banner panel test, the second-occurrence test and the newer-version test were each seen red
before their fix; putting `inherit: null` back reds the id-keep test, and dropping the `sourceHash`
guard on `inherit` reds the stale fresh-ids test.

## GPT Sol's code review

`gpt-5.6-sol`, high, `--sandbox workspace-write`, 2026-09-24 —
[answer](260924d-choose-them-again-on-an-outdated-quote-list-code-review-sol.md). Accepted; no P0 or
P1. It fixed three test gaps itself, each shown by a mutation the old tests let through; its diff
was read and the gates re-run green.

| # | finding | what we did |
|---|---|---|
| F4 | P2 — the "one old id to two quotes" test never reached `inheritIds`' `used` guard (identical suggestions were deduplicated first). | Sol fixed: two NFKC-equivalent, non-overlapping passages. |
| F5 | P2 — "unparseable version counts as current" untested. | Sol fixed: `quotes/3-extra` test. |
| F6 | P2 — stale-and-outdated together untested; inheritance keyed on outdatedness alone would pass. | Sol fixed: the stale fresh-ids test now uses an outdated stale list. |
| F7 | P3 — the `Quotes` comment in src/types.ts still said only a stale list is replaced. | Fixed by me. |
