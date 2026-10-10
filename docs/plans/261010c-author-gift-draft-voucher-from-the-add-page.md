# The author gift: a draft voucher from the add page

**Status as of 2026-10-10: built, all four stages, on `dev`, not deployed.** It needs a deploy for
two additive migrations (`author_gifts`, and an index on `ai_calls.run_id`). § What landed says what
differs from the plan. Where § Revision 3 below and an earlier section disagree, revision 3 wins. Queue
item `qi-ghpdsqvv`, authorised by Greg 2026-10-09, dispatched by the Overseer. The idea and Greg's
words are [marketing-author-gifts.md § A tool to make this cheap](../project/marketing-author-gifts.md) (commit 712d3ad3e).
Review round 1: [261010c-plan-review-sol.md](261010c-plan-review-sol.md) (REJECT, 12 findings; how
each was answered is § Review log).

## What Greg asked for

> For admins in the add page when the article is being imported, perhaps we could add a button or
> something that says this is potentially going to be for marketing to the author, and then that
> would automatically switch on the higher capability AI processing and make a private link and
> perhaps do a web search to try and figure out who the author is and see if we can find an email
> address for them.
>
> And if so, can we create a draft gift voucher? … So it would create a gift voucher that's ready
> and populated but hasn't been sent. … And so then it would be easy for me to then say, okay,
> great, I'm gonna click send on the gift voucher. Perhaps draft a separate email from myself.
> There's already a private link populated in the gift voucher.
>
> — Greg, 2026-10-09

And later the same day, through the Overseer:

> It may be useful to add a comments field in the database gift voucher table that either I
> (perhaps via MCP) or the agent can add stuff to, such as like, oh, by the way, I found this email
> address at this URL, and this is what I found about the person, and here's a suggested message
> you might want to use, or some details, and this is why I picked this particular paper. Blah blah
> blah.
>
> — Greg, 2026-10-09

**Nothing is ever emailed automatically.** A draft is saved; Greg reads the article by its private
link, checks the address and the notes, and presses *Send* himself.

## What it is, in one paragraph

On the add page an administrator sees one more control, **For the author…**. Confirming it (with
the private link's rights tick-box) ticks the existing **High-powered AI** box at once — its
controller already sends the switch as early as it can, and never charges the administrator. When
the import finishes, the page sends `POST /api/admin/author-gifts { slug, rightsConfirmed: true }`
and waits for its quick answer before navigating. The server makes the private link if there is
none, saves an **author gift** — a draft of a gift voucher, in a table of its own — and answers
`202`; then, after the response, it runs **one web-search lookup** for the author and an address
and writes what it found into the draft's empty fields and its **notes**. The draft is listed on
`/admin/vouchers` under *Author gifts*, with the notes, where each field came from, and what the
lookup cost. **Send** turns it into an ordinary gift voucher through the existing `createVoucher`,
which queues the gift email exactly as *Create* does today.

```
add page (admin)                     server                                /admin/vouchers
────────────────                     ──────                                ───────────────
[For the author…] ─confirm─► ticks High-powered AI ─PUT /high-power─► Opus from here on
        │
   import finishes
        └─POST /api/admin/author-gifts─► 1. private link (keepExisting)
          (awaited, ~1 s)                2. author_gifts row (one per article, ever)
                                         3. author_lookups row, pending
                                       ◄─ 202
                                         after the response:
                                         4. lookup: web search ─► finish the lookup row
                                         5. fill the gift's empty fields + notes ─────► Author gifts
                                                                                      [Send] ─► createVoucher
                                                                                               (gift email queued)
```

## The parts that already exist, reused rather than copied

| Step | The existing piece |
|---|---|
| High-powered AI | the add page's tick box and its controller, `src/web/add-high-power.ts`; the administrator's switch is `highPowerStore.switchOnForAdmin`, uncharged ([high-powered-ai.md](../project/high-powered-ai.md)) |
| Private link | `pgShareLinkStore` create with `keepExisting: true` under the store's row lock (plan 261007o) — never a second key over one Greg may already have copied |
| The voucher itself | `createVoucher` (`src/store/pg-vouchers.ts`) with a browser-style stable id: a replay of the same id and body queues nothing, a different body is a conflict; the starter is resolved and its link read when the email is queued (plan 261007j) |
| Web search | the chat wire's `openrouter:web_search` with Exa, as `src/citation-find.ts` uses it, and `collectSearchEvidence` (`extracts: "all"`) for what each result actually said |
| Admin-only | the `/api/admin` namespace gate in `src/routes.ts`: a 403 for anybody not in `ADMIN_USER_IDS`, before dispatch |
| Cost | the gateway's ledger; the lookup runs in a collector of its own, so its `run_id` names exactly its calls |

## Decisions

### D1. A draft is not a voucher: the `author_gifts` table

**`billing_vouchers` does not change.** A draft lives in a new table and becomes a voucher only when
Greg presses *Send*, through the existing create. The claim, the entitlement sum, the gift-audience
sum, PATCH, the email queue and its retry never see a draft, because there is no draft in their
table — so "nothing is emailed automatically" holds by construction rather than by a clause in
each of six queries (Sol's F4, F5, F11).

`spideryarn.author_gifts`, one row per article, **for good** (Sol's F3):

| column | |
|---|---|
| `id` uuid pk | |
| `article_id` uuid not null **unique** → `articles` (cascade) | the gift's identity: a second press, or a replay after *Send*, finds this row |
| `voucher_id` uuid not null unique, default random | minted with the row; the id the voucher gets on *Send*, so a repeated *Send* is `createVoucher`'s replay |
| `created_by` uuid not null, `created_at`, `updated_at` | |
| `email` text null | normalised (`lower(btrim())`, `'%_@_%'`), the voucher table's check |
| `recipient_name` text null, `recipient_note` text null, `articles` int not null default 20 (1–1000) | what the voucher will carry |
| `notes` text null, `notes_updated_at` timestamptz null | **Greg's comments field** (D6) |
| `email_lookup_id`, `name_lookup_id` uuid null → `author_lookups` (set null) | which lookup supplied the current address and name; cleared when Greg edits that field (Sol's F7) |
| `send_started_at` timestamptz null | *Send* was pressed; from here the row is frozen (D3) |
| `discarded_at` timestamptz null | discarded, and when; restoring clears it |

Checks: `send_started_at is null or email is not null`; `send_started_at is null or discarded_at is
null`. A **status** is derived, never stored: *discarded*, *draft*, *sending* (send started, no
voucher with `voucher_id` yet) or *sent* (that voucher exists) — the list reads it with a left join
on `billing_vouchers.id = voucher_id`.

**Why not `billing_vouchers.issued_at`** (revision 1): it put drafts in the table every billing
path reads, and the review found four paths that would have treated one as live — the claim, the
gift-audience sum that writes another email's numbers, both email reservations — plus a
send-versus-edit race. Each needed its own clause, and the next path written would need one too.
The cost of the separate table is one small editor for a draft's fields, which the page needed
anyway for the notes and the provenance.

**The migration is additive**: two new tables, nothing altered.

### D2. One author gift per article, ever

A press on an article that already has a gift returns that gift (and, if it is still a draft, may
run a new lookup — D4). There is no second campaign for one article; if Greg ever wants one, it is
a separate, explicit action later. Restoring a discarded gift is clearing `discarded_at` on the
same row, so it cannot collide with another.

### D3. Send: freeze, then create

`POST /api/admin/author-gifts/:id/send`:

1. `UPDATE author_gifts SET send_started_at = now() WHERE id = $1 AND send_started_at IS NULL AND
   discarded_at IS NULL AND email IS NOT NULL RETURNING *` — the snapshot is frozen here. PATCH
   refuses any row with `send_started_at` set, under its own conditional `UPDATE`, so an edit and
   a send cannot interleave (Sol's F1). No match: if the row is already frozen, carry on from its
   stored values (a replay, or a send that died part-way); otherwise 409 in plain words (*no
   address yet*, *discarded*).
2. `createVoucher({ id: voucher_id, email, articles, note: "Author gift: <title>", recipientNote,
   recipientName, starterSlug: <the article's slug> }, adminId)` — every field from the frozen
   row. `replayed` and `created` are both success; the route sends the email after the response as
   the voucher route does.
3. `starter-refused` (the article is no longer linkable — its link turned off since): clear
   `send_started_at` so Greg can fix it and press again; 409 in the voucher route's own words.
   `conflict` cannot happen (the id is the gift's own and the body is frozen); if it does, 500 and
   the row stays frozen.

So *Send* is idempotent and resumable: whatever dies between 1 and 2, pressing *Send* again
finishes it, and `createVoucher`'s replay guarantees one email.

### D4. The lookup: one call, after the response, checked against what the search returned

A new task, **`author-lookup`**, chat wire, capable tier (Sonnet), **standard power always** —
it is not one of the article's modes and the article's High-powered AI does not move it.
`openrouter:web_search` with Exa, `max_total_results: 10`, `max_results: 5`. The prompt allows up
to three searches; a searching prompt is a cost control, not a bound (D7).

**Concurrency** (Sol's F2): in one short transaction the route locks the gift row, refuses (409) if
a lookup started under five minutes ago is unfinished, marks an older unfinished one
`failed / stale`, and inserts the new pending row. Only then does it answer `202`. A gift that is
no longer a draft refuses a lookup (409).

**Where it runs**: `afterResponse`, inside a **collector of its own** (`collectSpend` with
`costStore.record` as its sink and the article's slug as attribution), because the request's
collector is closed by then. Its `run_id` is stored on the lookup row.

What it is given, all inside `untrusted(…)` fences (src/untrusted-fence.ts): the title, the byline
and authors (`article_revisions.authors`), the source URL and its host, and the first and last
1,500 characters of the text (bios sit at either end). The system prompt says that the article
**and every search result** are data, not instructions.

What it answers, JSON only:

```json
{ "author": { "name": "…", "sourceUrl": "…" } | null,
  "email": { "address": "…", "sourceUrl": "…" } | null,
  "contactUrl": "…" | null,
  "aboutAuthor": "two or three plain sentences: who they are, from the results",
  "suggestedMessage": "a short note Greg might send, in his voice, plain",
  "whyThisPiece": "one sentence on why this piece suits Spideryarn" }
```

**What the server keeps, and what it refuses** — because a model that types an address from memory
looks exactly like one that found it:

- A `sourceUrl` or `contactUrl` counts only if it is one of the search results' URLs or the
  article's own source URL. Otherwise it is dropped.
- **An address fills the draft only when it is *seen*** (Sol's F9): the server extracts every
  syntactically valid address token from the named result's extracts (or the article's text),
  normalises each with `normaliseEmail`, checks `looksLikeEmail`, and requires **exact equality**
  with the model's normalised address — so `ann@example.com` is not "seen" inside
  `joann@example.com`. Anything else is kept as **`suggested_email`**, shown as *suggested, not
  seen in any result*, and never written into the draft. (An obfuscated `jane at example dot com`
  lands here; Greg can copy it.)
- A name fills `recipient_name` only when its source URL survived the first rule and it is one line
  of at most 80 characters (the voucher rule).
- **The lookup fills only empty fields** and records itself as their source (`email_lookup_id`,
  `name_lookup_id`). A later lookup never overwrites what an earlier one or Greg wrote; what it found
  differently is shown on its own run as *found, not applied* (Sol's F7).
- Its prose (`aboutAuthor`, `suggestedMessage`, `whyThisPiece`) and the sources are written into the
  gift's **notes** (D6).

### D5. `author_lookups`: one row per run, and its cost

| column | |
|---|---|
| `id` uuid, `author_gift_id` → `author_gifts` (cascade) | |
| `created_at` (= started), `finished_at` | |
| `outcome` | null while pending; then `'address' \| 'author' \| 'nothing' \| 'failed'` |
| `failure` | a reason (a status code, an error name, `stale`), never the provider's prose |
| `author_name`, `author_source_url`, `email`, `email_source_url`, `suggested_email`, `contact_url` | what it found, after D4's rules |
| `searches` | how many searches the provider says ran (Sol's F10) |
| `run_id` uuid | the lookup's own collector; **the key into `ai_calls`** |
| `model` | |

Checks: `(finished_at is null) = (outcome is null)`; `failure is null or outcome = 'failed'`.
Columns over JSON ([sql.md](../project/sql.md)).

**Cost has one home, the ledger** (Sol's F6). Every call the lookup makes — retries and a failed but
priced attempt included — carries the lookup's `run_id`, so `GET /api/admin/author-gifts` sums
`ai_calls.cost` by `run_id` for each run, with the count of unpriced rows beside it (*cost not
fully known*). The same rows land on the article's *What it cost* and on `/admin/costs` under the
job `author-lookup`, with a category in `src/cost-categories.ts`. Admin-only, so
`tests/no-ai-cost-for-readers.test.ts` is unaffected.

### D6. The notes: Greg's comments field

`author_gifts.notes`, free text up to 20,000 characters, and `notes_updated_at`. **Admin-only**:
never in the voucher email, never in anything the recipient or any reader sees — the voucher's
private `note` gets only *Author gift: <title>*, and the notes stay on the gift row, which is
listed with its voucher after *Send* (one home for them, not a copy).

- **The lookup appends** a dated block: where the address was seen (the URL), what it found about
  the author, a suggested message, why this piece — and, when it found nothing, that it found
  nothing and what it searched for. It appends rather than replaces, so Greg's own words survive a
  second lookup.
- **Greg edits it** on `/admin/vouchers` (the draft editor), and by MCP (below).
- It is a column on the gift, not on `billing_vouchers`: Greg's words were "the gift voucher table",
  and for an author gift the gift row *is* the voucher until it is sent and its record afterwards. A
  voucher made by hand already has its private `note`.

**MCP.** [mcp.md](../project/mcp.md) says adding a tool is a row in `TOOLS` that calls an existing
route, and the admin voucher tools are already there. So two rows: `list_author_gifts` (the drafts,
their notes, their lookups, no key) and `update_author_gift` (`notes`, and the draft's fields).
Neither reaches the outside world, so neither asks. *Send* is **not** an MCP tool in this plan —
sending mail from an agent would need the macOS dialog and its test, and Greg asked for notes there,
not sending. A named follow-up.

### D7. When nothing is found, and what the lookup can and cannot do

**Nothing found**: the gift is still saved, with the private link and the starter, and no address.
Its row says what happened in plain words — *No address found*, with the author's name and a contact
page if those were found, or *The lookup found nothing* / *failed* / *did not finish* — with **Look
up again**, and the notes say what was searched. *Send* is disabled until Greg types an address.
A failed lookup never fails the request: the link and the gift are already made.

**What the model can do** (Sol's F10, stated honestly): it chooses up to three web searches — each
an outbound request and a cost — from a prompt that contains a stranger's article, and it reads
pages anyone can write. The fences and the system prompt's sentence are a mitigation, not a
boundary ([security.md](../project/security.md)). The residual risk is accepted on these grounds,
and recorded rather than hidden: it runs only when the administrator presses, for one article at a
time; OpenRouter's `max_total_results` caps results; `searches` is recorded on every run and a run
that exceeds three is flagged on the page; and the only thing its answer can change is the empty
fields and the notes of a draft that nothing sends until Greg presses *Send* after reading them. A
planted address reaches, at worst, a draft Greg reads beside the URL it came from.

### D8. Admin-only, on the server

Every new route is under `/api/admin/`, so the namespace gate refuses everybody else with a 403
before dispatch; the vouchers suite's admin sweep gets a case per route. Inside, the article must be
**the administrator's own** (400 otherwise) and **published** (409 *not imported yet*: the lookup
needs the title and text, and the voucher needs a published starter). The add page draws the
control only for `isAdmin(user.id)`, which is presentation, not the defence.

| Route | Does |
|---|---|
| `POST /api/admin/author-gifts` | `{ slug, rightsConfirmed: true }` (unknown keys 400) → link, gift, pending lookup, `202 { id, status, lookup: "started" \| "refused-running" \| "not-draft" }`; the lookup after the response |
| `GET /api/admin/author-gifts` | every gift, newest first: fields, notes, derived status, the voucher's id when sent, each lookup with its cost — `private, no-store` |
| `PATCH /api/admin/author-gifts/:id` | any of `{ email, recipientName, recipientNote, articles, notes, discarded }`, the voucher's validation rules; 409 once *Send* has started; an edit to `email` or `recipientName` clears its lookup provenance |
| `POST /api/admin/author-gifts/:id/send` | D3 → `201`/`200` with the voucher id |

### D9. The add page

`For the author…` sits under the High-powered AI box, admin only. Its confirmation says in four
lines what will happen and carries the private link's rights tick-box. Confirmed, it ticks
High-powered AI through that box's controller (so the early send, the 404 retries and the line under
the box are unchanged) and arms the intent; *Undo* disarms it until the import finishes.

At completion, beside `highPower.settle(slug)` in `AddPage.tsx`, the page **awaits** the author-gift
request — it answers in about a second, because the lookup runs after the response — and then
navigates as it does today. A refusal or a lost answer is shown as one line on the add page with a
link to `/admin/vouchers` and does not stop the navigation for long (Sol's F12: the request is
caught, and token acquisition is inside the awaited call). A tab closed before completion sends
nothing; the fallback covers it.

### D10. The fallback on `/admin/vouchers`

**Draft a gift for an author**: the existing starter picker (the administrator's articles) and a
button that sends the same `POST /api/admin/author-gifts`. It covers a closed tab, an article
imported before this feature, and *Look up again*. It does not switch High-powered AI on — for an
imported article that would change nothing already written; the row says whether it is on.

## The simpler option passed over

**No add-page control at all**: Greg ticks the existing High-powered AI box when he imports, and
later on `/admin/vouchers` picks the article and presses *Draft a gift for an author*. That is D10
alone, and it removes the add page's armed intent and the request at completion. It was passed over
because Greg asked for the add page by name, and the add page is the moment he decides an article
is for its author; keeping it costs one control and one awaited request, and D10 is built anyway.

**Also passed over: running the lookup synchronously inside the request** (revision 1). It holds the
add page for half a minute or leaves a request racing a navigation; after the response, with its
own collector, is no more code.

**And: a pipeline step at publication.** Robust to a closed tab, but a new job type in the import
for an admin-only marketing tool, and a stage boundary crossed.

## Security

- **Untrusted parties**: the article's author (fenced into the prompt) and every page the search
  returns. What limits them is D4's seen-address rule and D7: nothing is sent until the
  administrator presses *Send*.
- **Acts on a model's output**: only by filling a draft's empty fields and appending to its notes.
- **Not touched**: `billing_vouchers` and every query on it, the namespace gate, the share-link
  store's lock, the billing lock order, the email queue. No defence in
  [security-map.md § Where the defences physically live](../project/security-map.md) changes.
- **The private link's key** is never in the gift row, the lookup, the notes or the list; the
  voucher email reads it at queue time as today.

## Stages

1. **Data, store and routes, no AI** — migration and schema (`author_gifts`, `author_lookups`),
   `src/store/pg-author-gifts.ts` (create-or-find, list with derived status and lookup cost, PATCH
   with the freeze rule, send per D3, the lookup's begin/finish transactions), the wire types
   (`src/admin-author-gifts.ts`, import-free like `admin-vouchers.ts`), the four routes. Tests
   first: a second press and a replay after Send find the same gift; Send queues exactly one gift
   email and a repeat none; Send refuses no address / discarded; a frozen row refuses PATCH; a
   starter that cannot be linked unfreezes; two concurrent presses start one lookup; a non-admin
   gets 403 on each route.
2. **The lookup** — the task and job in `src/models.ts`, the cost category, `src/author-lookup.ts`
   (prompt, request, parse, the URL and seen-address rules, the notes block: pure and unit-tested
   with a fake call and fake annotations), wired into the route's after-response work in its own
   collector. Tests: the seen-address cases (`joann`/`ann`, obfuscated, address only in the
   article, URL not in results), fill-only-empty with provenance, a failed call finishes the row
   `failed` with its run id, the cost read sums every row with that run id.
3. **The UI and MCP** — `/admin/vouchers`: *Author gifts* above the voucher table (status, fields
   with their sources, notes, lookups with cost and *found, not applied*, *Look up again*, Edit,
   Send, Discard/Restore), *Draft a gift for an author*; the add page control; the two MCP rows.
   Component tests; a browser check in a Sonnet subagent.
4. **Docs** — billing.md § Gift vouchers (author gifts become vouchers on Send), admin.md
   § `/admin/vouchers` (the routes, the section), marketing-author-gifts.md (built), mcp.md (two tools),
   cost-tracking/ai-gateway if they enumerate tasks.

Each stage ends with a GPT Sol code review (write-capable), the gates, and a commit.

## Revision 3: round 2's eight findings, all adopted

Round 2 ([261010c-plan-review-2-sol.md](261010c-plan-review-2-sol.md), REJECT) closed F3–F5 and
F8–F12 and found the following. Each fix is adopted as Sol wrote it; discovery is now closed (two
rounds), and the code review checks the fixes.

- **R2-F1 — Send schedules the email on a replay too.** After `created` *or* `replayed`, the send
  route reads the voucher's queued gift delivery and schedules `sendQueuedVoucherEmail`; its atomic
  reservation makes a duplicate schedule harmless. Covers a process that died after `createVoucher`
  committed and before `afterResponse` was registered.
- **R2-F2 — `POST /api/admin/author-gifts` is *ensure*, nothing more.** An existing gift answers
  `200 { id, status }` and touches neither the link nor the lookup — so a late replay cannot turn a
  link Greg turned off back on, nor buy another search. Only a **new** gift makes the link, the row
  and its first pending lookup, and answers `202`. *Look up again* is its own route,
  **`POST /api/admin/author-gifts/:id/lookups`** (`202`, or `409` while one runs or once the gift is
  not a draft). D10's button uses *ensure*; the row's *Look up again* uses the new route.
- **R2-F3 — the freeze is an attempt token.** `send_started_at` is joined by `send_attempt uuid`;
  the unfreeze after `starter-refused` is `WHERE send_attempt = $attempt AND NOT EXISTS (a voucher
  with voucher_id)`, so a slow refusal cannot unfreeze a newer attempt.
- **R2-F4 — every field `createVoucher` compares is frozen.** The voucher's private note is the
  constant `Author gift` (the title is shown from the gift row instead), `createdBy` is the gift's
  `created_by` whoever presses *Send*, and `starter_slug` is stored on the gift when it is made. A
  title or slug change, or another administrator retrying, is then still a replay.
- **R2-F5 — the lookup claims, then finishes under compare-and-swap.** The after-response task first
  claims its exact row (`UPDATE … SET run_id = $run WHERE id = $id AND outcome IS NULL AND run_id IS
  NULL`) before spending; no row, no call. Finish locks the gift then the lookup (begin's order),
  updates only `WHERE outcome IS NULL`, and applies fields, provenance and notes only while
  `send_started_at` and `discarded_at` are null. A stale loser writes nothing; a result that lost to
  *Send* or *Discard* is kept on its run as *found, not applied*.
- **R2-F6 — `run_id` is null until claimed**, and is set inside the fresh collector, from that
  collector's own id, before the first provider request. Attribution is explicit:
  `{ scopeKind: "request", ownerId, articleSlug }`, sink `costStore.record`. At run time this is not
  nested — the request's collector has already returned when after-response work drains — so the
  request's report sees none of these calls, and a test says so.
- **R2-F7 — notes outlive *Send*.** The freeze covers only the fields the voucher carries; a
  notes-only PATCH is allowed on a sent gift. The automatic block is appended under the gift lock and
  cut to fit the 20,000-character limit (with a line saying it was cut), so a full notes field never
  leaves a lookup pending. The two MCP tools also go into `ADMIN_ONLY` in `src/mcp/tools.ts`.
- **R2-F8 — one async exit on the add page.** `202` means a new gift and lookup, `200` an existing
  gift. Both of the page's exits (the automatic one and the reader's) go through one async,
  reader-bound, single-flight transition that sends the author-gift request when armed and rechecks
  the completion and source after the await. On failure the page stays, says what happened with a
  link to `/admin/vouchers`, and offers **Open the article anyway**.

The route table in D8, amended:

| Route | Does |
|---|---|
| `POST /api/admin/author-gifts` | ensure: new → link, gift, pending lookup, `202`; existing → `200`, nothing touched |
| `POST /api/admin/author-gifts/:id/lookups` | a new lookup on a draft: `202`, or `409` |
| `GET /api/admin/author-gifts` | as D8 |
| `PATCH /api/admin/author-gifts/:id` | as D8, but only `notes` once *Send* has started |
| `POST /api/admin/author-gifts/:id/send` | D3 with R2-F1, F3, F4 |

## What landed

- **Stage 1–2, the server**: `author_gifts` and `author_lookups`
  (`drizzle/20261009220519_author_gifts.sql`), `src/store/pg-author-gifts.ts`, the five routes,
  `src/author-lookup.ts` (the call and the seen-address rules) and `src/author-lookup-start.ts`
  (the after-response run in its own collector). The address rules moved to an import-free
  `src/email-address.ts`. Code review 1 ([261010c-code-review-1-sol.md](261010c-code-review-1-sol.md),
  APPROVE WITH CHANGES) fixed a stale Send attempt that could still create a voucher
  (`createVoucher` gained an optional, transaction-local `beforeCreate` check) and added the
  `ai_calls.run_id` index, which I moved into its own migration
  (`drizzle/20261009232510_ai_calls_run_index.sql`) because Sol put it in the already-applied one.
  **Deploy note**: that index is a plain `CREATE INDEX` on `ai_calls`, which holds writes to the
  ledger while it builds — seconds at the ledger's current size.
- **Stage 3, the UI and MCP**: `src/web/add-author-gift.ts` and `AddAuthorGift.tsx` (the add page),
  `AdminAuthorGifts.tsx` and `useAdminAuthorGifts.ts` (the section), `admin-vouchers-parts.tsx`
  (the starter picker both forms share), and `list_author_gifts` / `update_author_gift` in
  `src/mcp/tools.ts`. Code review 2 ([261010c-code-review-2-sol.md](261010c-code-review-2-sol.md),
  APPROVE WITH CHANGES) fixed six, and reported C7: a notes save replaced the field with no
  precondition. Fixed afterwards: a replace carries the `notesUpdatedAt` it saw and gets 409 if
  the notes moved, and `appendNotes` adds without one (what MCP agents are told to use).
- **Stage 4, docs**: [admin.md § Author gifts](../project/admin.md#author-gifts-a-draft-voucher-for-an-articles-author)
  is the home; billing.md, mcp.md, ingest-queue.md and high-powered-ai.md point at it.
- **Browser check** (Sonnet, Playwright, this worktree's own server, two real lookups at $0.039 and
  $0.048): the section, polling, provenance, notes, Send disabled without an address, Discard and
  Restore, the add page's confirmation, arming, the 202 at completion and the navigation, a
  non-admin seeing neither control nor route, and 390 px without horizontal scroll all worked.
  Shots: [the lookup done](261010c-shot-3-lookup-done.png), [Send's confirmation](261010c-shot-5-send-confirm.png),
  [the add page's confirmation](261010c-shot-10-add-confirm.png), [phone width](261010c-shot-7-phone-author-gifts.png).

**Differs from the plan, or not done:**

- **D10's line saying whether High-powered AI is on** for the article is not shown; the list does
  not carry it. Small, and not a defect.
- **For a public article no private link is made** — its starter is its public address. The plan
  said "make a private link" without the public case.
- **Send runs as the gift's creator** (`runAsOwner(created_by)`) so the starter resolves through that
  owner's reads whoever presses it (R2-F4). With one administrator this changes nothing.
- **The add page shows the control for a moment** before it learns the article is already on the
  shelf, then hides it with the rest of the sharing controls. A flicker, not a write.
- **Sending from MCP** is a named follow-up (it would need the macOS approval dialog and its test).
- **Send's confirmation says "This sends a real email"**, which is true in production; locally the
  email row says *not sent (not production)*.

## Review log

Round 1 (GPT Sol, REJECT) and what each finding became:

| | Finding | Answer |
|---|---|---|
| F1 | Send races an edit | D3: freeze with a conditional `UPDATE` first; PATCH refuses a frozen row |
| F2 | lookup check-then-insert race | D4: lock, check, insert pending in one transaction |
| F3 | replay after Send makes a second draft | D1/D2: one gift per article for good; `voucher_id` stable |
| F4 | draft inflates the gift-audience sum | D1: drafts are not in `billing_vouchers` |
| F5 | no sending-side guard for drafts | D1: same — there is no draft row to reserve |
| F6 | `generation_id` misses retries and failures | D4/D5: a collector of its own, `run_id` |
| F7 | latest lookup shown as the source of older fields | D1/D4: per-field provenance, *found, not applied* |
| F8 | migration order would not backfill | moot: nothing is altered |
| F9 | substring email check | D4: exact normalised token equality |
| F10 | the model's searches understated | D7: stated, counted, flagged; residual risk accepted |
| F11 | separate draft table is simpler | adopted |
| F12 | fire-and-forget | D9: the page awaits a quick `202`; the lookup is after the response |

## Log

- 2026-10-09: plan written; Sol round 1 REJECT; revision 2 adopts F11 and answers the rest. Greg's
  notes field added (through the Overseer). Sol round 2 REJECT with eight findings; revision 3
  adopts all eight. Discovery closed; building.
- 2026-10-10: stages 1–4 built by Opus subagents in parallel; two GPT Sol code reviews (both
  APPROVE WITH CHANGES, eight fixes by the reviewer, one reported and fixed after); browser-checked.
