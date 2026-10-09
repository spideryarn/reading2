# A public copy offered at import

Up: [plans.md](../project/plans.md) · the area is [ingest-queue.md](../project/ingest-queue.md),
with [public-shelf.md](../project/public-shelf.md) and [billing.md](../project/billing.md)

**Status: built, 2026-10-09.** On dev; not deployed.

Report `spya-ahvk74` (an admin's; `feedback-reporter.ts` exit 0):

> We should notice during the import process if a user tries to add an article that we already
> have as public, and ask them if they'd rather use the public one for free or have their own
> version which will use up one of their allotted slots.
>
> — Greg, 2026-10-09

## What happens today

`POST /api/jobs { url }` asks one question before it reserves a slot: *is this address already on
this reader's own shelf?* (`slugForUrlKey`, [find-article.ts](../../src/store/find-article.ts)). If
so it answers `200 { article, repeat: true }`, free
([261007k](261007k-repeat-paste-is-free-and-says-so.md)). If not, it reserves a slot and imports.
Nothing asks whether **somebody else** has already made the same address public, so a reader pays a
slot (and we pay the models) for an article anybody can already read at `/read/<slug>`.

## The change

### Server: one more question, asked after the first and before the slot

In the same place as the repeat check, a plain add (`url`, no `steps`, no `force`) that is not on
the reader's own shelf asks: **is there a public article with this `urlKey`?** If so, and the
request did not say `ownCopy: true`, the route answers

```
200 { publicCopy: { slug, title } }
```

with nothing reserved and no job. The reader then chooses. Choosing their own copy re-posts
`{ url, ownCopy: true }`, which skips the public question and is the ordinary paid add.

`ownCopy` is a boolean, accepted only beside `url` (`parseJobRequest` refuses it beside `slug`,
`uploadId`, `steps` or `force`), so it cannot change what any other request does.

**Which public articles count is not a new rule.** Citations already answers *"is this work an
article here, public or yours?"* with an ownerless read whose whole defence is its `where`
([pg-cited-in-spideryarn.ts](../../src/store/pg-cited-in-spideryarn.ts) § `citedCandidatesQuery`):
public and not archived, openable (a tree and at least one block, so the link never opens a 404), a
stranger's title only as extracted (never their rename), and a stranger's address only as
`publicSourceUrl` passes it (never `requested_url`, never an upload's guessed source, never
`asked_url`). The add reuses that read through the existing `citedCandidates` export and keeps the
candidates that are not the reader's own, matching `urlKey(candidate url) === urlKey(asked url)`.
That puts no new predicate in front of a stranger's row and edits nothing in it. The read is
unbounded and loads one short row per eligible article, the same cost Citations pays on every load;
both name the stored `url_key` column as the next step when that stops being cheap.

What the asker learns is that a public, openable article exists at this address, its slug and its
extracted title. No owner is named. **That is a lookup, not a listing**, and it reaches further back
than `/read/public`, which is capped at 200 (GPT Sol's plan review, P2-1): a signed-in reader who
knows an address can find an older public article the listing no longer shows. Citations already
answers the same question for the same reader, uncapped and by more than the address (a DOI, an
arXiv id, a title), so this adds no new class of exposure; it is written down here so nobody has to
rediscover it. Every article it can find is one its owner made public, which since 260904b means
*discoverable*, not only *reachable by link*.

**arXiv, every version.** `urlKey` is versionless for arXiv since
[261009d](261009d-every-version-of-an-arxiv-paper-is-one-article.md), so a paste of `…v2` finds a
public `…v1`. The offer says it is the public copy of *this paper*; a reader who wants v2 exactly
takes their own copy. Hugging Face and alphaXiv pages about an arXiv paper, and the other paper
sources, match the same way because they share the key.

**Misses are safe.** A public paper imported from a DOI link whose stored `final_url` is the arXiv
abstract is found by the arXiv link but not by the DOI link, because `asked_url` is the owner's and
is not read. A miss costs what it costs today: the reader pays for their own copy. That is the
asymmetry [ingest-queue.md § Two URLs, one article](../project/ingest-queue.md#the-rule-it-is-written-to-which-is-an-asymmetry)
is written to.

**Order of the questions**: the reader's own shelf first (free, and *theirs*, so it beats a public
one), then the public one, then the slot. Both lookups are reads outside the billing lock and reserve
nothing, for the reason 261007k gives.

### Add page: the choice

`/add/<address>` gets a third kind of answer beside a job and a repeat. It stops, as a repeat does,
and draws:

```
  ┌──────────────────────────────────────────────────────────────────┐
  │ “The Title” is already public on Spideryarn.                     │
  │ Anyone can read it there, with everything already made for it,   │
  │ for free. Your own copy is yours to search, chat with and make   │
  │ new modes for, and uses one article from your allowance.         │
  │                                                                  │
  │ [ Read the public copy (free) ]   [ Add my own copy ]            │
  └──────────────────────────────────────────────────────────────────┘
```

- **Read the public copy** is a link to `readHref(slug)`, the public reading view.
- **Add my own copy** re-posts with `ownCopy: true` (the posting effect's guard key gains it, the
  way Retry bumps `attempt`), and the page carries on as an ordinary import.
- Over the choice the page offers no import boxes (auto-modes, High-powered, purpose, the sharing
  row) and no *"text has been sent to a third-party model provider"* line, as for a repeat: nothing
  has been imported yet. A purpose already typed stays in the session draft (`purposeFor`), so it
  is back in its box after *Add my own copy*.
- A 402 after *Add my own copy* is the ordinary one, drawn by `QuotaNotice` as today. A reader at
  their ceiling is offered the free read before they meet it, which is the point.

### The two places that already send a reader to `/add/<address>` for a copy on purpose

**The *Add a private copy to your shelf* line on a public article** (`PrivateCopy`,
[PublicChrome.tsx](../../src/web/PublicChrome.tsx), plan 261007m) links to `/add/<address>`. With
nothing else changed, a reader who presses it would be asked whether they would rather read the
public copy they have just left. So the link records the intent before it navigates: a module-level
one-shot (`markOwnCopy(address)` in a small client module, taken once by the add page for the same
address), so that add posts `ownCopy: true` at once. The query string and fragment of an `/add/`
address belong to the pasted URL ([router.ts](../../src/web/router.ts) § `addUrlFrom`), so the
intent cannot ride there. A reader who opens the link in a new tab loses the one-shot and is shown
the choice, which is a redundant question and not a wrong one.

**The prose hover card's *add to Spideryarn*** ([ProseHoverCard.tsx](../../src/web/ProseHoverCard.tsx))
posts the same `{ url }`. A `publicCopy` answer becomes a fifth `Asked` kind, `public`, drawn as
*"already public here"* with **read it here (free)** (a link to the public copy) and **add my own
copy** (re-posts with `ownCopy`). `useJobs.add` answers `Job | AlreadyAnArticle | PublicCopyFound |
null`, so the compiler finds every caller.

### MCP

`import_article` gains an optional `own_copy: boolean`. Without it, a public match answers
`{ publicCopy: { slug, title }, link }` and spends nothing; the description says so and says to call
again with `own_copy: true` for the reader's own copy, which uses one of their articles. An agent
acting for the reader gets the same choice the page gives.

### Not in this change

- **Uploads.** A file has no address to match. Matching an upload to a public article by its DOI or
  bytes is a separate piece of work.
- **Copying the public article's artefacts into the reader's copy** instead of importing it again.
  The own copy is an ordinary import, as `PrivateCopy`'s already is.

## The product question, for Greg

**Can reading the public copy carry the reader's own notes?** Today a signed-in reader on somebody
else's public article is treated exactly as a signed-out visitor: read-only, no comments, no chat
([261006k](261006k-signed-in-reader-ai-on-someone-else-s-public-article.md)). So *read it free*
means *read it without your own notes*. Letting them annotate it would be the third kind of request
261006k describes (signed in, not the owner) and would touch the security map's defences, so it is
not built here. Asked as a question file; the recommendation is to ship the offer as described and
decide notes on a public copy separately.

## Tests, red first

1. Route (`tests/billing-admission.test.ts` or a sibling): another owner's public, openable article
   at `HOST/pub`; the reader at their ceiling posts `{ url: HOST/pub }` → `200 { publicCopy }`,
   ledger unchanged, no job. `{ url, ownCopy: true }` → reserves (402 at the ceiling, 202 below).
   The reader's own article at the same address wins (`repeat`). A stranger's **private**, archived
   or unopenable article at the address is not offered (202). An arXiv `…v2` paste finds a public
   `…v1`. `ownCopy` beside `slug` is a 400.
2. Add page: a `publicCopy` answer draws the choice and no boxes; *Add my own copy* posts
   `ownCopy: true`; the one-shot from `PrivateCopy` posts `ownCopy: true` first time.
3. Hover card: `describeAdd` / the `Asked` kind for a `publicCopy` answer.
4. MCP: `import_article` passes `ownCopy` and adds the link on a `publicCopy` answer.

## The simpler option passed over

**Only the add page, with the private-copy link and the hover card left alone.** Fewer parts. Passed
over because both would then be wrong rather than merely plain: the hover card would sit on *Adding*
for ever over an answer it does not know (261007k found the same bug for the repeat), and the
private-copy link would ask a reader who just chose their own copy whether they would rather not.

**Telling the reader in the add box before they submit**, by asking as they type: a lookup per
keystroke, and the add page starts its POST as it opens, so there is no "before" on that path.

No defence in [security-map.md](../project/security-map.md) is edited: the ownerless read is
Citations', reused unchanged.

## What the plan review changed

GPT Sol, read-only ([findings](261009j-public-copy-plan-review-sol.md)): ready with changes, no P1;
billing judged sound (`ownCopy` still goes through `withIngestSlot`, and the own-shelf check stays
first).

1. *A new discovery surface beyond the capped listing* — true, and accepted for the reason above;
   written into § The change rather than restricted.
2. *The one-shot mark is set by a ⌘-click too*, because `Link` calls `onClick` before deciding the
   click is its own, so a stale mark could skip a later paste's offer. The mark is now set only on a
   plain left click, and lasts a minute. Sol's alternative, a separate `/add-own/` route, was passed
   over: it is a new route through `addUrlFrom`, the visit guards and the reader-change fences, for a
   case whose failure is one redundant question.
3. *The public slug must not reach `Completion`*, or High-powered, sharing and the purpose would
   write to somebody else's article. It never does: the answer is its own state (`publicAnswer`),
   and a test asserts no PATCH, PUT or purpose read for the public slug, and that a High-powered tick
   made before the answer is sent to the reader's own import instead.
4. *A failed lookup*: the read throws before any reservation, so a failure is a refused add with
   nothing spent, as any other store error on this route. Not turned into a miss, which could charge
   a reader when a free copy exists.
5. *Deterministic choice among several public copies*: slug order, title falling back to the slug.
6. *Parser and docs*: `ownCopy` must be `true` and only beside a `url`; stripped before `enqueue`.
   billing.md, ingest-queue.md, links.md, mcp.md and public-readable-sharing.md now say so.
