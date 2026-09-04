# More modes on a shared link

**Started 2026-09-04.** A shared link carries the text, the tree, the arc, the glossary, the ideas,
the quotes and the tweet thread. Greg asked for the rest of it:

> When an article is shared as Public-readable, also include Tweets, Timeline, Diagrams, Search,
> Comments, Chat (if possible without too much complexity), and update docs, tests, and Metadata UI
>
> — Greg, 2026-09-04

And, mid-plan, the rule that decides every trade-off below:

> If any of those answers add substantial complexity, defer the complex version and do the simpler
> version for now
>
> — Greg, 2026-09-04

The feature's plan is [260827ai-public-read-only-access.md](260827ai-public-read-only-access.md) and
the audit is [260902j](260902j-public-read-only-access-audit-and-improvements.md). Neither is
restated here. Read § *What we are deliberately not doing* in the first before proposing anything.

## References

- [security-map.md § the unauthenticated namespace](../project/security-map.md) — the closed room,
  the tripwire, and the allowlist's two failure directions.
- [`src/public/dto.ts`](../../src/public/dto.ts) — the `opt()` idiom and every key a stranger gets.
- [`src/web/visitor.ts`](../../src/web/visitor.ts) — `POLICY`, the total record that decides this.
- [`src/web/shared-inventory.ts`](../../src/web/shared-inventory.ts) — what the owner is shown
  before they publish, and the three buckets.
- [experimental-features.md](../project/experimental-features.md) — why a visitor's bar is shorter.

## What Greg decided, 2026-09-04

Four questions went to him with the cost and complexity of each attached.

| Question | Decided |
|---|---|
| Chat, which costs 1–4 model calls a message and has no rate limit anywhere | **Publish the owner's existing chat messages read-only.** Nobody but the owner adds a message, and the page says so |
| Search, whose words matcher is free and whose meaning matcher is a model call | **Only the owner creates a search. Everyone else sees the ones already created** |
| Comments, which have no per-comment visibility column | **A visitor sees them all** — and the docs and the owner's notice change to say so |
| Timeline and Diagram are behind the experimental switch, so a visitor gets no button | **Accept URL-only for now** |
| The live privacy page promises *"Your notes, your comments and your conversations are not shared"*, and this publishes them on articles already shared | **No consent flag.** *"There are no users yet. Do what's simplest"* — Greg, 2026-09-04 |
| A stored chat answer can quote the owner's **other private articles**, because chat's tools search the whole shelf | **Do comments and searches now, defer chat** |

The shape those four share is the shape of the whole job: **a visitor reads what the owner already
made, and creates nothing.** No public write, no public spend — the two invariants
[260827ai](260827ai-public-read-only-access.md) put in writing — hold unchanged. What changes is how
much of the owner's own work leaves with the link, which is a privacy decision rather than a
security one, and it is Greg's, made above.

## The retroactive exposure, and the fact the decision rests on

**Shipping this publishes the comments and the saved searches of articles that are already public**,
without anybody pressing anything. An owner who shared a piece last week agreed to an inventory that
said *Comments and notes* were never shared, and
[PrivacyPage.tsx:283](../../src/web/PrivacyPage.tsx) still promises in as many words: *"Your notes,
your comments and your conversations are not shared."*

GPT Sol's review blocked on this and proposed the careful version — an additive
`articles.public_reader_work boolean NOT NULL DEFAULT false`, a second tick-box in the sharing
dialog, and both predicates on every public reader-work query, so that no existing article changes
behaviour. It put the same question to Greg that this plan had left open. His answer, 2026-09-04:

> There are no users yet. Do what's simplest

So there is **no consent flag**, and the change applies to every public article at once.

**Write down what that rests on, because it is a fact about today rather than a judgement about the
exposure.** It is right because there is one account holder and the articles are his; it is not
right because publishing somebody's private notes without asking is acceptable. The moment there is
a second account, the question is live again and the answer above does not cover it. What survives
either way, and is cheap, is that **the dialog and the privacy page must state plainly what a shared
link now carries** — which is worth doing properly with an audience of one, because it is the thing
the next person will read. That is not deferred; it is in stage 3.

**A second session is changing the same dialog.** `spideryarn2-73` owns `SHARING_ON`,
`SHARING_CONFIRM_TITLE`, `sharingConfirmBody` and `SHARING_CANNOT_UNRING` in
[`src/messages.ts`](../../src/messages.ts) for its own widening — a public listing page — and this
plan owns `ALWAYS_SHARED` and `NEVER_SHARED` in the same file. Two widenings of one promise, and if
they are written independently the dialog ends up with two voices. Agreed split, 2026-09-04:
whoever lands second reads the other's text first.

## The one architectural call

Comments, chat and saved searches are **reader state**, not artefacts: unbounded in number, and
nobody has measured what they weigh. The artefacts already on the wire are bounded and small.

**Decision: one payload, as today.** The new collections ride
`GET /api/public/article/:slug` beside the glossary and the quotes, as ordinary keys of
`PublicArticle`.

*The simpler option was not the one we passed over — it is the one we took*, and what we passed over
is a public route per collection, fetched when the reader opens that mode. That would bound the
payload and let a visitor who never opens chat avoid downloading it. It is rejected for now because
it reintroduces exactly what slice 1b deleted: a second request that can fail on its own, and with
it the four-state `PublicArtefactRead<T>` and the `availability-unknown` gap that
[`src/web/visitor.ts`](../../src/web/visitor.ts) spends a page explaining the deletion of. One
payload keeps *an artefact that exists is a key that is present* true of the new collections too.

**GPT Sol dissented, and the dissent is worth keeping.** Its recommendation was one lazy endpoint —
`GET /api/public/article/:slug/reader-work`, returning three **required arrays** — on the grounds
that collections are not generated artefacts, so an empty array means *there are none* and needs
none of the four-state machinery; that a per-collection route costs nothing on an ordinary article
load; and that `HEAD /api/public/article/:slug` performs the full read and serialisation too, so
bots and link unfurlers pay for the extra queries as well. Every one of those is true.

It stays one payload because chat — much the largest of the three — is deferred, which takes most of
the weight out of the objection, and because Greg's instruction was to do the simplest thing. **If
the measurement below comes back large, Sol's endpoint is the answer and this paragraph is the
design already written.**

**What that owes:** a measurement. [260902j § Cluster G](260902j-public-read-only-access-audit-and-improvements.md)
already owns the 4.5 MB Vercel response cap as an unvalidated risk on the owner's route as much as
this one. This plan adds rows to the same payload, so it must record the measured size of a real
article with comments, chat and searches on it, and say plainly whether that moves the cap from
theoretical to near. If it does, the per-collection route is the follow-up and this section is why.

## Where each of the seven stands before we start

Measured against the code on 2026-09-04, not assumed.

| | State today | What it needs |
|---|---|---|
| **Tweets** | **Already shared.** `PublicArtefacts.tweets` crosses in the payload and `VisitorTweetsPage` ([`PublicPages.tsx:301`](../../src/web/PublicPages.tsx)) renders it at `/read/:slug/tweets` | Nothing to build. Verify end to end and say so — this row exists because it was on the list |
| **Timeline** | Owners-only by decision, not by cost. `GET /api/timeline/:slug` is a plain read of `article_revisions.timeline`; the only paid step is generating it | The nine-step artefact pattern, plus a `VisitorTimelineBand` |
| **Diagram** | Owners-only, and it is the one judgement call in `POLICY`. The default *force* picture is free; `useSimilar`, `useProjection` and `useSketchCaption` all fetch, and `force` is the default, so merely opening `?mode=diagram` POSTs for embeddings | Mount the band for a visitor with the three fetching hooks disabled, pin `kind` to `force`, and drop the paid chips |
| **Search — words** | Owners-only, though `findLiteral` ([`search-hits.ts:312`](../../src/web/search-hits.ts)) runs in the browser over blocks the visitor already holds, saves nothing and costs nothing | A visitor band that mounts the words matcher and none of `useSearch` |
| **Search — saved runs** | Owners-only. `search_runs` is a real Postgres table ([`schema.ts:3091`](../../src/db/schema.ts)) | A projection, and a read-only list |
| **Comments** | Withheld, with `COMMENTS_GAP` saying so, and the sharing card promises it | A projection, a read-only list, **and the promise changed** |
| **Chat** | Owners-only. **Deferred on 2026-09-04** — a transcript can quote the owner's other private articles | Its own plan |

**The experimental switch is why Timeline and Diagram are less visible than they sound.** A
signed-out reader is `experimental: false` by decision, so neither draws a button in their bar; a
shared `?mode=timeline` URL works, and the visitor's metadata page lists the artefact. Greg accepted
that on 2026-09-04. [experimental-features.md](../project/experimental-features.md) § *Hidden means
hidden from the controls, not unreachable* is the rule it rests on.

## What every stage owes, whatever it publishes

Written once here rather than repeated seven times. A stage is not finished until all of these are
true of the thing it added.

1. **The projection names every key.** `src/public/dto.ts`, constructed field by field, `opt()` for
   optionals and never a conditional spread — [security-map.md § the allowlist has two failure
   directions](../project/security-map.md) says why the spread form compiles a typo clean.
2. **The reader selects the columns.** `PUBLIC_PROJECTIONS` in
   [`src/store/public-reader.ts`](../../src/store/public-reader.ts). **This is the one silent
   failure in the whole path**: forget it and the value arrives `null`, the artefact reads as never
   built, and nothing anywhere goes red. Every stage that adds a column adds a test that would fail
   if the column were dropped from the `select`.
3. **`shareableArtefacts` grows a key**, [`src/store/pg.ts`](../../src/store/pg.ts) — a total
   `Record<keyof PublicArtefacts, …>`, so this one fails to compile rather than silently.
4. **The visitor renders from data, never from a hook.** A second component, as
   `VisitorGlossaryBand` is, because React forbids a conditional hook —
   [`reader-capability.ts`](../../src/web/reader-capability.ts) is the argument in full.
5. **Not one request leaves an anonymous page.** `tests/public-network-trace.test.tsx` already pins
   the count at zero; each stage extends it rather than trusting it.
6. **The owner's inventory tells the truth in the same commit.**
   [`shared-inventory.ts`](../../src/web/shared-inventory.ts) sweeps `MODES` automatically, so a
   mode-shaped thing needs nothing — but comments, chat and searches are the rows that are *prose*,
   in `ALWAYS_SHARED` / `NEVER_SHARED` ([`src/messages.ts`](../../src/messages.ts)), and moving a
   row between those buckets is the whole of the privacy change. It lands with the exposure, not
   after it.
7. **The visitor is told they may read and not write**, in the panel itself, without naming the
   owner — no `ownerId` crosses and none should start.
8. **The files Sol named that a plan like this forgets**, each because it holds a claim that would
   otherwise go stale silently: `tests/public-imports.test.ts` (the table tripwire and the reason it
   was widened), `tests/public-reads.test.ts` (the generated SQL — predicates and selected columns),
   `tests/public-visibility-pg.test.ts` (a real database, private and public, wrong owner, subtype
   filtering), `tests/public-dto.test.ts` (**required** nested fixtures and exact key paths, not
   all-false against all-true), `tests/public-network-trace.test.tsx` (deep links, and that no
   visitor panel mounts an owner hook), `tests/shared-inventory.test.ts`,
   `tests/privacy-page.test.ts`, `tests/access-sharing.test.tsx`.
9. **The docs it touches, in the same commit.** [privacy.md](../project/privacy.md) is the one that
   must not lag: it is the page that tells a reader what we do with their data.

## Stages

Each stage is a commit, typechecks, and ends with a GPT Sol review of the built code
([codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md)). Ordered cheapest-first so the
artefact pattern is exercised on the small case before the awkward ones.

### The type change the middle stages need, which is smaller than it looked

This plan's first draft added a `VisitorPolicy` member `owners-work` and a `VisitorGap` member
`none-yet`, so that a visitor could be told *the reader who added this has not left any comments*.
GPT Sol talked us out of both, and the argument is right:

> `owners-work` and `none-yet` are the wrong abstraction. "No saved items yet" is content inside an
> accessible panel, not something preventing access.

An empty comments list is an **empty panel**, not a boundary. `VisitorGap` exists to answer *what
stands between this visitor and this mode*, and once comments and searches are shared, nothing does.
So:

- `POLICY.comments`-shaped modes become **`{ kind: "available" }`** — `search` and, when it lands,
  `chat`. The panel draws its own empty state, exactly as it does for an owner with no comments.
- **No new union members at all**, which is one fewer moving part than the draft had.
- **`readers-own` goes**, because `COMMENTS_GAP` is its only producer and stage 3 removes it. That
  is this file's own rule about a union member with no cause, applied to itself — the same deletion
  `not-yet-public` and `availability-unknown` got in slice 1b.

Sol argued for *keeping* `readers-own`, on the grounds that it is the exactly right sentence for a
public article whose owner has not opted into sharing reader work. That is true, and it is
conditional on the consent flag it also recommended — which Greg declined. With no flag there is no
such state, so the member has no producer and goes. **If a consent flag ever arrives, bring
`readers-own` back with it**; this paragraph is the note saying so.

`chat` keeps `{ kind: "owners-only" }` unchanged, because chat is deferred.

### Stage 0 — Tweets: verify, do not build

Tweets already cross. The stage exists because they were on the list, and because *"already done"*
believed without a check is exactly the shape [silent-success.md](../reusable/silent-success.md)
warns about. Confirm through the real DTO and a real request that a signed-out reader gets the
thread at `/read/:slug/tweets`, record the evidence here, and move on. If it works, this stage is
two lines in the Progress log and no code.

### Stage 1 — Timeline

The nine-step artefact path, on the smallest case, so the pattern is exercised before the awkward
stages use it. `article_revisions.timeline` is one `jsonb` column and reading it costs nothing.

- `PublicArtefacts` gains `timeline`; `shareableArtefacts` fails to compile until it does too.
- `PublicTimeline` in `public-types.ts`, `publicTimeline()` in `dto.ts`, field by field.
- The column in `PUBLIC_PROJECTIONS`, **with a test that goes red if it is dropped** — this is the
  silent one.
- `NOUN.timeline`, which puts it on the visitor's metadata page for free, and
  `POLICY.timeline: { kind: "artefact", key: "timeline" }`.
- `VisitorTimelineBand` in `App.tsx`, beside `VisitorQuotesBand`, reading the payload and mounting
  no hook. The comment at `App.tsx:3105` that says there is deliberately no such band is deleted
  in the same commit — a stale comment claiming a gap is closed is worse than none.

**No button for a signed-out reader**, by Greg's decision above; `?mode=timeline` and the metadata
page are how they reach it.

### Stage 2 — Diagram: the free picture, and only that

The band is never mounted for a visitor today, so this is a gating job rather than a data job. No
DTO, no column, no payload change.

- Mount `DiagramBand` for everyone at `App.tsx:3068`, threading `isOwner` down into `DiagramPanel`.
- **Disable all three fetching hooks for a visitor** — `useSimilar` (`DiagramPanel.tsx:722`),
  `useProjection` (`:747`) and `useSketchCaption` (`:759`). The third is the one an audit of the
  first two would miss: it is an unconditional GET with no `enabled` argument at all.
- **Pin `kind` to `force`** for a visitor rather than only hiding the chips, because `?diagram=trail`
  is ordinary query state and a pasted link walks straight past a filtered chip row. Degrade the
  same way an unknown kind already degrades.
- Drop the paid chips from the row, including the two `armActivation` ones.

`force` draws without embeddings already: `similar.pairs` is a shared empty array while the hook is
idle, and `buildGraph` takes it as an argument. So a visitor gets the real picture, minus the dotted
semantic layer, and nothing is bought. `POLICY.diagram` becomes `{ kind: "available" }` and the long
comment explaining why it was not becomes the record of when it stopped being true.

### Stage 3 — Comments, read-only, and the promise that changes

**This is the privacy stage**, and its copy lands in the same commit as its exposure.

**A dedicated public query, never the owner's reader.** The first draft proposed reusing
`listFor(articleId)` in [`pg-comments.ts`](../../src/store/pg-comments.ts), and Sol blocked it:
that method is an unrestricted `.select()` that maps the operational columns, and — the part that
matters more — *"obtain an article ID, then read a child table by ID"* is the precise escape hatch
[`tests/public-imports.test.ts`](../../tests/public-imports.test.ts) exists to close. That test
keeps `comments`, `chat_messages` and `search_runs` **out of the public graph's table allowlist**,
and it does so because somebody demonstrated the hole with six lines before writing it. So the
public read:

- lives in [`public-reader.ts`](../../src/store/public-reader.ts), selects named columns, joins
  `articles`, and **repeats the `publicSlug` predicate in its own `where`** — a naked `articleId` is
  not authority;
- and the tripwire test is **amended deliberately**, with the reason written down, rather than
  quietly widened.

**Two row filters, both found by Sol, both of which this plan would have shipped without:**

- **`criterion_id IS NULL`.** A comment with a criterion is [Referee](../project/referee-mode.md)
  work — a peer reviewer's placement of a passage on a scale. Dropping `criterionId` and `valence`
  from the DTO does *not* make the body non-referee; the row has to go.
- **Completed rows only.** A `status` of `pending` or `error` published without its `error`, its
  retry and its polling is a permanently blank item a visitor cannot act on or understand.

**What crosses:** `id`, `blockId`, `quote`, `start`, `body`, `answer`, `citations`, `createdAt`.
**What does not:** `articleId`, `ownerId`, `error`, `attemptId`, `leaseExpiresAt`, `model`,
`searches`, `criterionId`, `valence`, `threadId`, `updatedAt`, `status`. `citations` is rebuilt
`{ url, title? }` field by field and every URL goes through the public URL policy — `isWebUrl` is a
scheme check and is not enough.

**The client.** `Questions` in `Dock.tsx:1778` is already a data-in component; it stops being gated
on `own`. `CommentDialog` gains the `access: { kind: "owner" | "visitor" }` union — with
`owner?: never`, which `QuotesAccess` shows is load-bearing rather than tidy — and the visitor arm
renders the quote, body, answer and citations and none of the textarea, follow-up form,
deepen/retry/delete footer or `PlaceOnCriterion`.

**The copy.** `NEVER_SHARED`'s `comments` row moves to `ALWAYS_SHARED`, reworded, and
[PrivacyPage.tsx](../../src/web/PrivacyPage.tsx) stops promising what is no longer true.
`tests/shared-inventory.test.ts` and `tests/privacy-page.test.ts` are what hold the words to the
wire. **Only comments is a prose row** — an earlier draft of this plan said chat and searches were
too, and that was wrong: both are modes, so `shared-inventory.ts` sweeps them automatically.

### Stage 4 — Saved searches, read-only

- `publicSearches` over `search_runs`: `id`, `criterion`, `hits`, `colour`, `createdAt`. **Not**
  `articleId`, `ownerId`, `model`, `error`, `attemptId`, `attemptStartedAt`.
- **`sourceHash` does not cross.** If freshness matters to a visitor it crosses as a derived
  `stale: boolean`, not as the hash — the same shape the artefacts already use.
- **Completed runs only**, for the reason the comments stage gives.
- `hits` is rebuilt field by field: `blockId`, `quote`, `confidence`, `reasoning`, optional `start`.
  No URL, no model, no cost in it — checked against `SearchHit` — but it is rebuilt anyway, because
  that is what stops the next field it grows from crossing by default.
- **`criterion` is the reader's own writing**, and it is the one field here that is disclosure
  rather than article prose. Named as such so nobody has to rediscover it.
- `Saved`'s row has retry, recolour, reuse and delete woven into it with no seam; those come out
  behind the `access` union. `Results` needs nothing.
- **No composer, and no words matcher either.** Greg's rule was the simpler version, and the free
  literal matcher means shipping `Box` and the `?find=` query-state wiring for a feature nobody
  asked for by name. *A small follow-up if it is wanted, and this is the reason it was not in v1.*

### Deferred — Chat

Greg deferred it on 2026-09-04, and the reason is not the two tables or the subtype filtering.

**A stored chat answer can quote the owner's other private articles.** Chat's tools include
`search_library` and `read_library_passage` across the whole shelf
([chat-tools.md](../project/chat-tools.md)), so publishing a transcript can publish sentences drawn
from articles that were never shared — and no column-level allowlist catches that, because the
disclosure is in the prose of the answer.

Two more things its own plan must handle, both from Sol and both verified here:

- **`chat_threads.kind` is `'chat' | 'remember' | 'candidates'`** ([`schema.ts:2806`](../../src/db/schema.ts)).
  A query that does not filter `kind = 'chat'` in SQL publishes Remember transcripts and Referee
  candidate machinery whatever the visitor UI chooses to draw.
- **`tools` must not cross wholesale.** A `ToolRun`'s `label` and `detail` can name a private
  article's title or slug. `passages` should cross if the answer does — omitting them turns a
  grounded answer into an apparently uncited assertion — projected to `blockIds` and `why`, with
  every block id validated.

`POLICY.chat` stays `owners-only`, which is already true and now has a reason written beside it.

### Stage 5 — The sweep

Docs, and the two things a stage cannot check about itself.

- **Docs**, each in the section that owns the fact: [privacy.md](../project/privacy.md) first,
  then [comments.md](../project/comments.md), [chat-tools.md](../project/chat-tools.md),
  [search.md](../project/search.md), [timeline.md](../project/timeline.md),
  [diagram.md](../project/diagram.md), [security-map.md](../project/security-map.md),
  [new-mode.md](../project/new-mode.md) — whose checklist grows the public row — and the Progress
  log of [260827ai](260827ai-public-read-only-access.md).
- **The payload measurement** the architectural call above owes: a real article with comments, chat
  and searches on it, measured through the real route, against the 4.5 MB cap.
- **A browser pass in a Sonnet subagent**, signed out, on a real shared article: every new mode, the
  metadata page, and a network trace proving nothing was requested and nothing was bought.

## What we are deliberately not doing

- **Not a public route per collection.** One payload, for the reason above — and the measurement is
  what would overturn it.
- **Not the words matcher for visitors in v1.** Stage 5 says why.
- **Not a per-comment visibility column.** Greg chose all-or-nothing; a column is a bigger feature
  and this plan is not it.
- **Not chat**, and § Deferred says why in full.
- **Not a consent flag.** Sol's recommendation; Greg declined it, and § The retroactive exposure
  records both the decision and the one fact it depends on.
- **Not reusing an owner store's reader for a public read.** A naked `articleId` is not authority.
- **Not any public write, and not any public spend.** Unchanged, and every stage extends the test
  that pins it at zero requests.
- **Not showing a visitor the experimental modes in the bar.** Deferred by decision, 2026-09-04.
- **Not naming the owner** anywhere in the new copy. No `ownerId` crosses today and none starts.
