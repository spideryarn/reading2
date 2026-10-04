# Post-import modes, decided on the server for every import path

Status: plan, under review. Parent: [plans.md](../project/plans.md). Follows
[260930c](260930c-auto-generate-the-main-modes-after-import.md), whose Deferred 2 this is.

> We should automatically run Glossary mode generation as part of every import process
>
> But ideally running Summary and Glossary mode and any other modes that happen as part of the import
> process shouldn't block the page load, in other words, what I really mean is that the import
> process runs the minimum required, the article loads, and when it loads it automatically kicks off
> Summary/Glossary/etc - in other words they're really part of an immediate-post-import process
>
> — Greg, 2026-10-04

## What production says (read-only, 2026-10-04)

Every query ran inside `BEGIN READ ONLY` through `.env.prod`. Two owners have articles.

- **On the main account, add-page imports do get Glossary.** The three since 3 October each had a
  `glossary` job created within a second of the import finishing, done within about a minute.
- **One import got nothing**: `bitterlesson-spya-vtd3b8`, 12:14 UTC today, on the second account.
  The import finished at 12:15:14, the article opened at 12:15:16, and the request log for that
  minute holds exactly one `POST /api/jobs` after it (the `arc` the reading view asks for) and no
  refusals. The page never asked for the modes. The server cannot say whether that browser had the
  box unticked or the import did not finish on the add page; both are the same gap, a choice that
  lives in one browser's storage and a page that does the queueing. 46 seconds later the same URL
  was imported on the main account and got every mode.
- One older import on the main account (a Rovelli PDF, 1 October, never opened) has no mode jobs.
- Seen in passing: the automatic Glossary on *The Bitter Lesson* found 2 terms; *find more* was then
  pressed twice (3 new, then none). Not this plan's, but it may be part of why Glossary felt absent.

## What exists

The add page queues one job per main mode when the import's job is `done`, if a `localStorage` box
is ticked ([`src/web/auto-modes.ts`](../../src/web/auto-modes.ts)); `read-this.ts` does the same for
*Read this*. Paths that queue nothing today: *add to Spideryarn* on a link's hover card, Retry
pressed on the shelf's job card, an import that finishes after its add page has gone, and a browser
whose stored choice is off or that the reader has not used before on that account.

## Stage 1: the server queues them at the import's publication

**The rule.** When a job's publication is an article's **first full publication** — the article
served nothing before and is not a minimal paper, or this publication is the one that turns a
minimal paper full (*Read this*) — and the owner has not opted out, the publication queues the
main-mode jobs, in the transaction that published, with `enqueueSuccessorIn`
([`src/store/pg-successor.ts`](../../src/store/pg-successor.ts)). That is how the `labels` job and a
reset's regenerations are already queued, and it is in `publishRevisionIn` for the reason they are.

- *First full publication of an import* is, off the job row the fence has just locked: not a reset,
  **and** either the job reserved the article's name (`reserves_name`, true for a new URL, an upload
  and a retry of either) while the article served nothing and is not minimal, **or**
  `upgradedFromMinimal` (*Read this*). So it leaves out Rebuild, Start again (which has its own
  `regenerate` list), a minimal paper, a mode job's publication, a job-less `publishRevision`, and
  the test fixture loader, whose synthetic job reserves no name (Sol F1: `opts.job` alone would
  have let it in and left seven undriven jobs blocking the next test's exclusive steps). A job that
  adopted its slug from another live job and happens to publish first reserves no name and queues
  nothing; rare, and it fails towards a Generate button. An import run from the CLI counts: it is an
  import, and its jobs wait for the owner's browser like any queued job.
- **Which jobs**: exactly today's requests — one job per step, and Skim's as
  `["quotes", "ideas", "skim"]`. The list moves to a shared leaf, `src/auto-mode-steps.ts`, that
  both sides import. It is written out there rather than derived, because the derivation reads
  `modeStep` in `src/web/activation.ts`, which imports the browser's job engine.
  `tests/auto-modes.test.tsx` already derives the list from the mode catalogue and now asserts the
  written list equals it, so a mode moved in or out of the experimental switch fails a test.
- **Order**: stamped after the labels job, one microsecond apart, single-step jobs first and Skim
  last. *After the labels job* means after the row that actually holds it: when the labels successor
  collapses onto a job already queued, that holder's `created_at` came from an app server's clock
  and can be later than this transaction's `now()`, so the modes are stamped from the later of the
  two (`enqueueSuccessorIn` gains `notBefore: jobId`; Sol F5). Skim's job carries Quotes and Ideas,
  so its correctness does not depend on the order among the modes.
- **Profile**: each job gets the reader's profile as it stands at publication — "about you" and the
  article's purpose if one is already saved — rendered by `renderProfile`, read inside the
  transaction. See § The purpose box for what this gives up.
- **Work key**: unscoped, so an identical unforced request with the same rendered profile joins the
  queued job while it is active, rather than adding a second. Two exceptions, both carried from
  260930c (Sol F4): the Skim panel posts a narrower request once Quotes or Ideas exist, a second row
  whose Skim step then skips as current; and a request posted after the purpose changed has a
  different profile, so it is a second job, and for Ideas (whose freshness includes the profile) a
  second paid run. An older client still open across the deploy posts identical requests and
  collapses, unless it saved a purpose first.
- **It is one transaction with the publication**, as the labels successor is. A successor insert
  that throws rolls back the pointer, the earlier successors and the charge together.
- **Queued is not run.** Nothing on the server drives a queued job; the owner's browser does, from
  any page. With every tab closed the modes wait, as `labels` does today.
- **Cost accounting**: unchanged. A successor reserves nothing (as a mode press reserves nothing
  today) and every model call it makes is written to `ai_calls` against its job and step.

**The opt-out moves to the reader's row.** `reader_profiles.auto_modes_off_at timestamptz null`: null
is on, a timestamp is when it was switched off (the shape `experimental_since` has, inverted because
the default is on). One additive migration. `GET /api/reader` returns `autoModes: boolean`,
`PATCH /api/reader { autoModes }` writes it. The publication reads it in its transaction.

**The add page** keeps the tick box, same words, now reading and writing that setting: a PATCH on
each change, so it can still be changed right up to the moment the import finishes. A browser whose
old `localStorage` choice is `off` hands it over when the signed-in app starts (not only on the add
page, since a hover-card add never visits it), and forgets the key only once the server has answered
(Sol F3). **What this cannot cover:** a tab still running the old client across the deploy, with the
box off, sends nothing, and the server then queues the modes for its next import. The server cannot
see a browser's storage. Accepted: two accounts exist, and the cost is one article's modes. `openArticle` no longer queues anything; `read-this.ts` stops watching and queueing.
`queueAutoModes`, `readAutoModes` and `writeAutoModes` are deleted.

**High-powered AI: what is guaranteed, and what no longer is** (Sol F2). Each step reads the
article's power as it starts (`readStepPower`), and no mode starts until the `labels` job ahead of
it has ended. So a switch **committed** before the first mode step starts is respected, and the add
page sends it as soon as the article row exists, which is long before publication. What is given
up: the page used to hold the modes until the switch request *answered*, however long that took. A
request still unanswered when `labels` ends now loses, and those modes run on the standard model.
That needs a request hung for the length of `structure` plus `labels`. A server-side hold for a
pending intent would mean a route to mark a running job, which is the machinery this plan passed
over; the weaker guarantee is stated here and in high-powered-ai.md instead. `settle` stays, so a
tick in the last second is still sent at completion.

### What changes for the reader, said plainly

- Re-adding a URL already on the shelf no longer tops up modes the article lacks: nothing is
  published, so nothing is queued. Opening Summary generates it, and the others are a press.
- The choice follows the account, not the browser.

### The purpose box (a product question, [Q-purpose-first-modes])

Since 260930e the add page holds the modes while a reader who has typed *why they are reading* is
asked **Save and open** or **Open without it**, so every mode is written for that purpose. With the
server queueing at publication, a purpose saved after the import finishes reaches none of the first
modes; it still reaches chat, Skim-for-intent and anything regenerated. One of seven production
imports since 30 September has a purpose.

Built in this plan: the simple version above. The alternatives, for Greg:

1. **Leave it** (built). The first modes are written from "about you" alone unless the purpose was
   saved before the import ended.
2. **Save the purpose as it is typed**, once the article row exists, so it is usually in before
   publication. Changes the box from a decision to autosave; a reader still typing when the import
   ends still misses.
3. **Resolve the profile when a queued automatic job is first claimed** rather than when it is
   queued. With 2, the window becomes the length of `labels`. More machinery in the job runner.

### The simpler option passed over

A per-job flag sent with `POST /api/jobs`. It freezes the choice at the start, an upload's POST is
sent by `uploadEngine` and a reload cannot change it, and Retry would have to copy it. A setting on
the reader is one read at publication and needs no route to change a running job.

### Tests (red first)

- `tests/publication-queues-the-main-modes.test.ts`, real Postgres, in the pattern of
  `publication-enqueues-the-labels-successor.test.ts`: a first full publication under a job queues
  exactly the listed jobs, after the labels successor, each free (no `ingest_event_id`, no
  `reserves_name`), with the reader's profile; the opted-out reader gets none; a second publication
  (Rebuild), a reset, a mode job's publication, a minimal paper and a job-less publication get none;
  *Read this* gets them; a retried import and the administrator's import get them; the fixture
  loader's job gets none; a throw on a later mode successor rolls back the pointer, the earlier
  successors and the settlement; a labels holder stamped later than the publication still sorts
  before every mode; a mode queued behind `labels` reads a power switched on while `labels` ran; a
  reader's own identical press joins the queued job.
- Route: `PATCH /api/reader { autoModes }` round-trips and stamps the time.
- `tests/auto-modes.test.tsx`: the shared list equals the derived one; the box reads and writes the
  setting; completion posts no mode job; the one-time `localStorage` hand-over.
- `tests/add-page-purpose.test.tsx`, `tests/minimal-paper-ui.test.tsx`: rewritten to what is now true.
- Mutation at the end: drop the opt-out check, drop the first-publication condition, and see red.
- Browser, in a Sonnet subagent, desktop and 390px: add a URL with the box ticked and unticked;
  *add to Spideryarn* from a hover card; close the add page mid-import and come back.

## Stage 2: open before the rest of the pipeline — a plan for Greg, not built ([Q-open-early])

What the reading view truly needs is the blocks. Today's blocking steps, from production's job rows:

| Step | Web page | arXiv / PDF |
|---|---|---|
| fetch, extract, blocks | 2 to 8 s | up to 100 s (`extract` reads a PDF by model) |
| structure | 12 to 26 s | 55 s |
| assets | under 1 s | 92 s (figures recovered) |

So opening after `blocks` would save about 12 to 26 s on a web page and about 150 s of 250 s on the
arXiv paper. It means publishing an article with blocks and no tree, `structure` and `assets` as
successors, and the spine, Structure, Summary, the shelf card, the public page and export each
handling *no tree yet*. `structure` and `assets` are exclusive steps that rewrite what the modes
read, so the modes must still wait for both. That is many surfaces and a publication contract
(`tree` required) changed, which is why 260930c deferred it. A smaller cut worth pricing first:
move only `assets` behind the publication, as `labels` was moved on 2026-09-06.

## Cost

Production medians per article since 30 September, standard model, 4 to 12 articles per step:

| Step | Median | Max |
|---|---|---|
| simple (Summary's levels) | $0.153 | $0.349 |
| ideas | $0.136 | $0.216 |
| glossary | $0.078 | $0.119 |
| quotes | $0.052 | $0.118 |
| tweets (Summary's thread) | $0.051 | $0.167 |
| crossrefs | $0.033 | $0.160 |
| skim | $0.021 | $0.046 |
| **Total** | **≈ $0.52** | **≈ $1.18** |

On High-powered AI the one article measured cost about 2 to 4 times that per step. The import itself
(extract, structure, labels, arc, relations) is about $0.20 for a web page and $0.45 for a PDF.

**Today**: about $0.52 per import that finishes on an add page with the box ticked, and nothing for
any other import. **After**: about $0.52 for every full import by a reader who has not opted out,
whichever way it started and whether or not they open those modes. Per article nothing changes; the
total rises by the imports that were missed.

## Review record

**GPT Sol on the plan** (commit b29a4c166, read-only, exit 0, answer file fresh):
[plan-review-sol](261004h-post-import-modes-decided-on-the-server-for-every-import-path-plan-review-sol.md).
Verdict *build with changes*. F1 (the fixture loader's job met the trigger), F3 (the opt-out
hand-over), F4 (work-key wording) and F5 (a labels holder stamped later) are taken as written above.
F2 (waiting behind labels is not awaiting the switch) is taken as the stated weaker guarantee, which
Sol offered as the alternative to a mechanism. Its two closing notes, the wider rollback and that
queued is not run, are in § Stage 1.
