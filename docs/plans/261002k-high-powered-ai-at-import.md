# High-powered AI at import

Report `spya-s2rsxy` (Greg, 2026-09-30), the half that
[260930k](260930k-high-power-for-readers-and-cost-only-for-admins.md) left out. Overseer queue item
`qi-qjtbt9je`. Parent doc: [high-powered-ai.md](../project/high-powered-ai.md).

> We also need to provide a way for the user to specify this in the UI. I think the two obvious
> places would be during the import process as a flag they can flip while it's importing, perhaps up
> to the point where it starts doing the structure. I don't know, or keep it simple and find a
> natural place in the UI to include it.
>
> — Greg, 2026-09-30

## What exists

- The switch on `/metadata`: `PUT /api/article/:slug/high-power {on}`, owner-scoped, charged once per
  article (200 points private, 100 public), never refunded, must fit whole (`[pay-high-power]`),
  administrator exempt — [billing.md § High-powered AI counts double](../project/billing.md).
- The job runner reads the article's `high_power_since` **as each step starts** (`readStepPower`,
  `src/jobs.ts`), so a switch flipped mid-job moves every step still to come.
- The article row exists from the moment the job is **claimed** (the claim opens the draft:
  `openOrBeginJobDraft` → `lockOrCreateArticle`), with the column null, and the `PUT` addresses the
  row by `ownedSlug` — it needs no publication. So the existing switch already works on an article
  that is mid-import; nothing has offered it there.
- The ingest's steps are `fetch, extract, blocks, structure, …` (`DEFAULT_INGEST_STEPS`). For a web
  page the first three make no capable-tier call and **`structure` is the first that does** — Greg's
  "up to the point where it starts doing the structure" is exactly the window in which the switch
  moves everything. **A PDF is the exception** (Sol's plan review, P1-2): its `extract` reads the
  front matter with `pdf-frontmatter`, a capable-tier task, so for a PDF the window closes when
  `extract` starts.
- `/add/<url>` already has a tick box drawn for the whole import (*Generate the main modes*,
  `offerAutoModes`), and the modes it queues on completion would run on Opus too once the article
  is switched.

## What v1 does

**A second tick box on the add page, *High-powered AI*, off by default and never remembered, that
calls the existing switch.** No server change, no new price, no new billing shape.

1. Drawn in the same interval as *Generate the main modes* (`showAutoModes || deciding`, which
   includes the purpose question after the import finishes), under it, with the
   same short price sentence the Metadata switch uses (articles, never money; the administrator's
   "no charge").
2. **Ticking it records the intent; the page sends `PUT {on: true}` as soon as it knows the job's
   slug** (`job.slug`, never one derived from the URL or filename). Ticked while the URL is still
   being posted, or while a PDF is still uploading, it waits, and says *"Will switch on when the
   import starts."* **A 404 while the job is still queued or running means "the row is not there
   yet", not a refusal** — a job reports `running` before its claim opens the draft that creates the
   row (Sol's P1-1) — so it is retried a second later until the job ends. After the job ends, a 404
   is a real answer.
2a. **The main modes wait for the switch** (Sol's P1-3). The completion queues them without
   awaiting anything, so a mode job could claim and read the standard model before the `PUT`
   lands. The page now settles the intent first — sending it against the completion's slug if it
   was still waiting, which also covers the `{article}` completion that never had a job — and
   queues the modes after; the navigation itself does not wait.
3. **The box shows the server's last answer once one exists**, as `HighPowerSwitch` does: a refusal
   (`[pay-high-power]`, or the minimal-paper refusal) unticks it with the reason beside it, and the
   import carries on with the standard model. A lost connection says *couldn't confirm*, not *off*.
4. **Unticking before the `PUT` has gone cancels the intent, free.** After it has gone it sends
   `{on: false}`, exactly as on Metadata (nothing back, switching on again free) — the copy already
   says so.
5. **Late is honest, not forbidden.** Exactly when the runner read the column cannot be known from
   the polled job (it reads power before it marks the step running — Sol's P2-4), so the copy is
   cautious: if, when the switch answered, any step beyond `fetch` and `blocks` had started, the line
   under the box says *some earlier work may have used the standard model* and *Run it again* on
   Metadata redoes it. Later steps, and the main modes queued at the end, use Opus.
   Not refusing it is deliberate: the main modes queued after the import are most of the model
   calls, and they still benefit.
6. Not remembered between imports. A sticky default would double the price of every later import
   without the reader looking at the box again; *Generate the main modes* may be remembered because
   it costs nothing from the allowance.

### Copy that changes

`/pricing`'s answer and `/help`'s two mentions say the switch is on the Metadata page; they become
"when you add it, or later on its Metadata page". `/features`' line names no place and stays.
high-powered-ai.md § *What it costs a reader*'s last paragraph ("Switching on happens only on
`/metadata` … An import-time flag is the named next step") is rewritten to describe this.
ingest-queue.md § The add page gets one sentence.

## Simpler options passed over, and the larger one deferred

- **Only Metadata, as now** — the status quo; the reader pays twice the Sonnet run for nothing they
  keep, or reads a Sonnet first pass. The report asks for import.
- **A tick box on the shelf's Add form, carried in the URL** (`/add/<url>?power=high`). Rejected: a
  link that doubles a charge on arrival is a link a stranger can send. The add page already opens
  before any job exists, so the window is the same without it.
- **Deferred: the charge riding the job** (a `jobs` column, admission at `POST /api/jobs` for both
  charges, the switch made server-side at `structure`). It would survive a closed tab and charge
  only an import that got past `fetch`. It is a new billing shape — Greg's call, and not needed
  for the 80%.

## Known limits, named

- **A tab closed before the job is claimed sends nothing.** The box is a page's intent, like
  *Generate the main modes*, and `KEEP_A_TAB_OPEN` already asks for the tab. The article imports on
  the standard model and Metadata still has the switch.
- **An import that fails after the switch keeps the charge** on its article row, under the
  existing never-refunded rule; a *Retry* of that job does not charge it again (one charge per
  article, the row survives a failed job). Dismissing the failed card only hides the job; the
  article row and its charge stay (Sol's P2-5). This is the existing price applied earlier, not a new one; the deferred job-riding design
  is the fix if it turns out to matter.
- **A race at the boundary**: a box ticked during `blocks` may land just after `structure` reads
  the column. Item 5's cautious line covers it; exact detection would need a server-side marker.

## Plan review

GPT Sol, read-only: [261002k-high-powered-ai-at-import-plan-review-sol.md](261002k-high-powered-ai-at-import-plan-review-sol.md).
Verdict *revise before build, no P0*. All five findings checked against the code and taken: P1-1
(`running` before the row, so a 404 is retried while the job lives), P1-2 (PDF front matter is
capable-tier), P1-3 (modes wait for the switch; the `{article}` completion), P2-4 (cautious late
copy), P2-5 (dismiss does not delete). It confirmed no new billing or authorisation path: the
`PUT` is owner-scoped, minimal papers are refused before charging, the administrator takes the
uncharged path, and the charge is once per article.

## Stages

1. The tick box: a framework-free controller (`src/web/add-high-power.ts`, its state a
   discriminated union, the `PUT` injected so a test can drive every answer) and a small
   component that draws it; wired into
   `AddPage.tsx`. Copy changes in `/pricing` and `/help`. Docs.
2. Browser check on the box (desktop and phone width): tick before the job runs, tick while running,
   a refusal.
3. GPT Sol code review, gates, push, feedback note.

## Code review

GPT Sol, workspace-write: [261002k-high-powered-ai-at-import-code-review-sol.md](261002k-high-powered-ai-at-import-code-review-sol.md)
(the diff it read is beside it). Verdict *approve after review fixes, no P0*; it fixed four in place,
each read and kept:

- **P1 — Retry lost the tick.** A job that failed before its claim answers the `PUT` with a final
  `404`; the job card's *Retry* then makes a new live job, and the intent now goes back to waiting
  for it (`retryOnNextAlive`).
- **P1 — a refused switch-off drew off.** A refused `{on: false}` now keeps the box ticked (the last
  confirmed state was on) and can be tried again; the state carries `on` and `attempted`.
- **P2 — copy overclaimed.** "this import uses it" became "later work in this import uses it", and
  `/help` no longer says *the whole import*.
- **P2 — tests.** The page test now uses a job slug different from the URL's, and covers
  StrictMode and a new address.
