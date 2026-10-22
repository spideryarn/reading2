# Summary's thread is written only when pressed

Report `spya-jex764` (#671), filed by Greg on 2026-10-21 from Summary, Fuller, on
`rovelli-order-of-time-…-spya-r26sug`. Admin, so trusted input.

> I think we generate the brief and fuller summaries by default because they're main modes. That's
> great. I don't think we need to generate the thread submode by default. I think we should generate
> that if someone presses on it, not until then.
>
> — Greg, 2026-10-21

Up: [summaries.md](../project/summaries.md) · [tweets.md](../project/tweets.md) ·
[ingest-queue.md § The add page](../project/ingest-queue.md#the-add-page)

## What is true today (checked 2026-10-22)

- **One list decides what is made up front**: `AUTO_MODE_STEPS` in
  [`src/auto-mode-steps.ts`](../../src/auto-mode-steps.ts) — `tweets`, `glossary`, `quotes`, `ideas`,
  `simple`, `skim`, `bibliography`, `crossrefs`. `tweets` is Summary's thread; `simple` is Brief and
  Fuller's plain-words levels.
- **Every eager path reads that list and nothing else**: an import's first full publication
  (`queueMainModesIn` → `autoModeJobs()`, [`src/store/pg-main-modes.ts`](../../src/store/pg-main-modes.ts),
  called from [`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts)) and, since 261021j, every
  way of making a gift (`enqueueMainModesIn`, the same file). The add page's tick-box line is derived
  from the browser's copy (`DELEGATED_MODE_STEPS.summary` in
  [`src/web/auto-modes.ts`](../../src/web/auto-modes.ts)), which a test holds equal to the server's.
- **The thread already writes itself on press.** Opening Summary's Thread view on your own article
  starts the `tweets` job if none is stored (`useAutoRunOnArrival` in
  [`src/web/useTweets.ts`](../../src/web/useTweets.ts), Greg's 2026-09-12 rule). So nothing needs
  building on the client: taking `tweets` off the list is the whole change.
- **Not eager, left alone**:
  - the Guide's `prepare` step (`submode:summary:thread` in
    [`src/preparable-modes.ts`](../../src/preparable-modes.ts)) runs only when the Guide names the
    thread for this reader — a press made on the reader's behalf, by Greg's 2026-10-20 design;
  - *Start again* with regenerate remakes only the extras the article already has;
  - `rerun tweets` is a press.

## The change

1. Drop `"tweets"` from `AUTO_MODE_STEPS` and from `DELEGATED_MODE_STEPS.summary` (which becomes
   `["simple"]`), with the comments that said both were queued.
2. Tests that pin the list follow it: `tests/auto-modes.test.tsx`, `tests/gift-prep.test.ts` (whose
   scoped-replacement case uses `tweets` as its example job; it moves to `glossary`), and
   `tests/publication-queues-the-main-modes.test.ts`, `tests/publication-of-an-awaiting-tree.test.ts` and `tests/open-before-structure-queue.test.ts` (each a deliberate second copy of the list). Plus an explicit
   `expect(AUTO_MODE_STEPS).not.toContain("tweets")` with Greg's words, so putting it back is a
   decision rather than a drift — the same guard `relations` has.
3. Docs: [tweets.md](../project/tweets.md), [summaries.md](../project/summaries.md),
   [ingest-queue.md](../project/ingest-queue.md) say the thread is not made on import or for a gift.
   The tick-box text names Summary still (its lengths are still made), so it needs no change.

## What it gives up

- **A stranger reading a public article** sees "nobody has built one" under Thread unless the owner
  or Guide prepared it, where before it was usually there. A visitor cannot start one. A gift's
  recipient is the owner, so presses and gets one. Accepted: it is exactly what Greg asked for.
- **Saves** one model call per import and per gift: ≈ $0.13 on Sonnet, ≈ $0.20 on Opus (261021j's
  table).

## Plan review (GPT Sol, 2026-10-22) and what was taken

[Prompt](261022b-summary-thread-plan-review-prompt.md) · [answer](261022b-summary-thread-plan-review-sol.md).
Verdict *reject*, on two findings, both declined as a reading of the request, not of the code:

- **"Thread still writes on arrival"** (a pasted link, Back) — true, and kept. That is Greg's
  explicit 2026-09-12 rule ([tweets.md](../project/tweets.md)), and his report is about what is made
  *by default* beside Brief and Fuller, not about how opening the view behaves. Arriving at your own
  thread is asking for it. Reversing that rule would be a second decision he did not make.
- **The Guide's automatic *prepare*** — kept. Greg designed it on 2026-10-20: the Guide presses only
  when it is confident this reader wants that mode, and offers a button otherwise. That is a
  judgement about one reader, not a default for every article.

Both are named in the report's note, so Greg can overrule either. Taken: Sol's confirmation that the
two list removals cover every eager path (import, open-early, gifts, MCP; reset only remakes an
existing thread), and the docs it found — prompt-caching.md's import-burst pair and the Help page.
The other docs it listed describe on-arrival writing, which is unchanged.

## Simpler option passed over

None simpler: this is one list entry. The heavier alternative — a per-reader setting for which
sub-modes are eager — was not asked for.
