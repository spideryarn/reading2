# Re-read The Order of Time from its PDF, in production

Greg's answer to [q-qbfjje](../user-feedback/questions/q-qbfjje.md), reply `spya-j4zg9m`,
2026-10-23:

> Please reread it for me.

He chose option A, with an agent doing the Refresh from source rather than him. This is the one
production write it authorises: re-reading his article
`rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug` from the PDF we hold. Report
`spya-rg5kk6` and addendum `spya-zdp62y`; the fixes it relies on are
[261022h](261022h-a-line-at-the-top-of-a-chunk-is-not-lost-at-the-seam.md) (deployed 2026-10-23
00:54) and [261023b](261023b-endnotes-typed-as-references-are-kept-as-notes.md) (deployed in
db758ed8). The same re-read serves `qi-vq9rwkyy`, the check on the book's uncaptioned figures.

## What runs

There is no supported command that runs a whole job against production. `scripts/stage.ts`
runs one step, and refuses `fetch`. The shelf's button is a signed-in `POST /api/jobs`, and no
agent can sign in as Greg on production. So a one-off driver, kept in the session scratchpad and
deleted afterwards (database.md § Delete such a script), does exactly what the route does:

- **The job**: `enqueue({ slug, force: ["extract"], pump: false })`. This is what
  `src/web/ShelfEntry.tsx` sends for an article with no web address. `cascadeForce` then
  forces `blocks`, `structure` and `assets`, and `fetch` skips on the stored source. No quota
  slot, as for any bare-slug request (`src/routes.ts`, `POST /api/jobs`). No profile: the
  route resolves one, but no default step reads it.
- **The driver**: `advanceJob` in a loop, as `stage.ts § drive` does. Afterwards it drives the
  successors that publication queued, and only those whose steps are all `labels` or `matter`.
  Greg's browser would otherwise drive them the next time he opens Spideryarn.
- **The code** is the worktree at `origin/dev` 601608636. Its `src/` is identical to deployed
  db758ed8 (`git diff db758ed89 HEAD -- src` touches only two changelog JSON files), so the
  job runs production's code.
- **The environment** is `.env.prod`, read with `readEnvProd`. Every value is assigned after
  `src/env.ts` is imported, so it beats `.env.local`, and every `.env.local` name is put in
  `SPIDERYARN_ENV_PINNED`, so `loadEnvLocal()` adds nothing. The driver refuses to start unless
  the database host is the production pooler, `environmentOwnerId()` is Greg's id, and the
  article row is his. Its dry run printed exactly that, plus `Live jobs: []`, at 12:36 UTC.

## What it will cost, and what it reuses

Read-only, production, 2026-10-23:

- **Reused: nothing from the chunk transcriptions.** 261023b measured that today's code mints 0
  of the 36 stored `pdf-chunk` keys (the reader id and prompt both changed since 4 October). So
  all 36 chunks are read again, plus any re-asks from the quality and seam checks.
- **Cost of the transcription: about nothing.** The 4 October read was 69 `openai/gpt-5.6-luna`
  calls, ledgered at $0.0000, plus $0.0048 of front-matter calls. This week's 135
  `gpt-6-luna` extract calls across production are also ledgered at $0.
- **The paid parts**: `structure`, about $0.25 last time; the labels successor, about $0.45
  (17 calls); and `matter`, if it is queued. So under a dollar, as the question said.
- **Not queued**: the main modes. A refresh is neither an import's first publication nor a
  stand-in replacement (`firstFullPublicationOfAnImport`, `src/store/pg-revisions.ts`), so Arc,
  Glossary and the rest are not regenerated. They stay, marked stale by their source hash.
- **Greg's own data**: 7 comments and reading time on 319 blocks. Block ids carry over
  (`beginDraftIn`, `assertIdsCarried`), and a comment whose block is dropped is kept by design
  (schema.ts rule 1). A baseline of the current revision's blocks, the comments' block ids and
  the reading-time block ids is saved before the run, so nothing is judged by eye.

Stop and ask, in a new question file, if the driver's output shows a cost materially over a
dollar, or if any comment's or reading-time block is missing from the new revision.

## Verified afterwards, read-only

1. The new revision is current, and its `extract_method` is today's reader.
2. The p.43 line, "realized that it was impossible to do so exactly.", directly after
   `spya-ucb0pc`'s "…and the moment at which Einstein".
3. The p.95 passage, "It is the law announced by Clausius (ΔS ≥ 0) and deciphered by
   Boltzmann…".
4. Notes 21 to 93 are present as notes, and the five notes reading only "53" to "57" are gone.
5. No body text is lost against the baseline. Every block's text in the old revision is
   matched in the new one, with differences listed and read.
6. Every comment's and every reading-time block id exists in the new revision.
7. `qi-vq9rwkyy`: the uncaptioned figures, e.g. the cones after "Those of Leonidas are shown
   below" (`spya-k6tf3t`), against the about 25 of 28 measured in
   [261019a](../investigations/261019a-uncaptioned-pdf-figures-located-on-rovelli.md).

Anything found broken there is a bug for future PDFs, fixed on `dev` as any other.

## Plan review, and what changed

GPT Sol, **DO NOT RUN** on the first driver
([plan-review-sol](261023c-re-read-plan-review-sol.md)). Both blockers were real, and every
finding was taken:

- **F1 (blocker)**: the driver skipped the shelf's gate. It now refuses unless the article has
  no web address and `sourceReusable` holds (a raw source, and a completed `fetch` run on the
  current revision), read just before the enqueue.
- **F2 (blocker)**: successors were picked from every queued job, in id order. Now it takes only
  jobs that did not exist before the enqueue, each a single `matter` or `labels` step, in claim
  order (`created_at, id`), and fails on any other new job and on any successor not `done`.
- **F3**: the route's rendered profile is now on the request, so a Refresh pressed in a browser
  meanwhile joins this job instead of starting a second one.
- **F4**: live jobs now block the run instead of only being printed. The terminal status is
  `error`, not `failed`.
- **F5**: it runs under `env -i` (only `HOME`, `PATH` and `NODE_ENV=production`), refuses any
  inherited effort, concurrency or model override, and checks the storage host as well as the
  database host.
- **F6, and the cost estimate above was wrong**: the Luna calls are BYOK, so their cost is in
  `byok_upstream_nanos`, not credits. The 4 October extract was $0.2515, so the estimate is about
  $0.95 rather than $0.70. High-powered AI is off on this article. The driver checks spend after
  every advance, across credits, BYOK and computed cost, and stops at $2.
- **F7, F8, F10**: verification is fuller (below). Greg's reading position is also kept in his
  browser's `localStorage`, which cannot be read from here. That is checked only through the
  report's own `?at=` blocks.

Re-check on the revised driver: **RUN WITH CHANGES**
([recheck-sol](261023c-re-read-recheck-sol.md)). Computed cost was added to the ceiling, the
ceiling now also applies to the final total, and an unexpected job fails whatever its status.
Both were applied before the run. The reviews name `261023c-refresh-prod-driver.ts.txt` and
`…-wrapper.sh.txt`. Those were review copies, **deliberately not committed and deleted after
the run** (database.md § Delete such a script): a script that reads `.env.prod` and queues a
paid production job is not something to leave where a subagent will find it. Everything it did
is described above.

## What happened

Run 2026-10-23, 12:52 to 12:59 UTC. Refresh job `spya-gvbd67`: `fetch` skipped (stored source),
then `extract`, `blocks` ("1123 blocks, 289 new ids (834 kept)"), `structure` (24 sections) and
`assets` (30 figures recovered). Successors `spya-bn27un` (`matter`, 1 stretch folded) and
`spya-gkv9z8` (`labels`, 938 paragraphs), both `done`. No other job was queued. The revision chain
runs d8c04869 → 746ceaf0 → 1a671f0e → ad453985, now current, on `openai/gpt-6-luna/pdf-v5`.
**$0.84 over 111 calls, none unpriced.**

Verified read-only:

- **Restored**: the p.43 line, the p.95 passage, and notes 21–93 (footnote blocks 75 → 143, with
  notes 23, 47 and 79 found by their text). The five "53"–"57" notes are gone.
- **Nothing lost against the PDF**: words of the PDF in runs of 8 or more not found in the book went
  from 3,490 to 347. What remains is the copyright page, the advert and formula fragments.
- **Greg's rows**: 7 comments and 319 reading-time rows are identical by full-row hash, and all
  1,046 old ids remain in `block_identities`.
- **Figures** (`qi-vq9rwkyy`, done): 30 of 40 shown, the Leonidas cones (p.33) among them. 8
  uncaptioned ones are refused safely, and 2 on p.57 are ambiguous, because the reading made two body
  paragraphs into their captions.

**The miss: block ids.** The question promised that ids are kept, and this plan repeated it. Sol's
F8 said partial loss was possible, and I took that as something to verify afterwards rather than
measure before. 212 of the old 1,046 ids are not in the new revision. That leaves **5 of Greg's 7
bookmarks** (all whole-paragraph, with no quote or note text) and **85 of 319 reading-time places**
pointing at ids no longer current. This is the matcher behaving as block-ids.md documents (same tag
and the same words, or nothing), on a reading that differed more than a re-read of the same model
would. Paragraphs gained lines (p.43's did, which was the point), joined or split at page seams, and
24 identical texts changed tag (`h1`→`h2`, `p`→`blockquote`). Of the 85, 64 have one clear
successor, 10 were split in two, and 11 have none (mostly the old note stubs).

Repointing them is a write to Greg's rows, which this authorisation did not cover. So it is asked:
[q-xns4gt](../user-feedback/questions/q-xns4gt.md). The general rule is queued as a proposal,
`qi-gw4kwnea`. **For next time**: before re-reading a PDF that a reader has anchored things to,
say plainly that ids may not survive. block-ids.md has measured that a model re-read re-mints
some. Count what is anchored, so the person deciding knows what is at stake.

## The simpler option passed over

- **Ask Greg to press Refresh himself.** That is option A as written. He asked for it to be done
  for him.
- **Make this a committed command** (`stage.ts refresh --prod`). A committed command that writes
  to production in one line is a standing risk, and this is the first time it has been needed.
  Not built. If it is needed again, that is the time to decide.
