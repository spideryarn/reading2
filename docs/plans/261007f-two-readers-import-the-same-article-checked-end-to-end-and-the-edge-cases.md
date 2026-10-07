# Two readers import the same article: checked end to end, and the edge cases

Up: [plans.md](../project/plans.md)

**Status as of 2026-10-07: built, stages 1 to 3.** Evidence: `tests/two-readers-one-article-pg.test.ts`
(12 cases) and `tests/two-readers-one-article-billing-pg.test.ts` (9 cases) pass against Postgres,
with the mutations in § Progress watched going red. **No bug was found in the two-readers behaviour
itself.** Two things were fixed beside it (E8, E10) and one gap is left open and queued (§ Progress).
The edge-case table below describes the code as it was found; § Progress says what changed.

Report `spya-rvbmss` (SPIDERYARN-READING2-E4), from Greg; Overseer queue item `qi-z93rkwjm`.
Session `fbrvbmss-same-article-two-importers`.

## Goal

Greg, 2026-10-06, verbatim:

> I was trying to think what should happen if two people try and import the same article. Well, I
> feel like that seems straightforward enough. They should both have their own copy with their own AI
> processing. Okay, what if one of them imports a public article? Well, I think that's also fine. One
> of them has a public article and one of them has their own copy with their own processing. What
> about if they both get made public? Well, maybe then we have two versions of the same article
> public. I mean, it seems sort of wasteful and weird, but I couldn't see a better way of dealing
> with things because the two public articles might have slightly different AI processing, especially
> if, you know, one or both of these has had a profile. I mean, if you can see a better cleaner way
> forward, then let's discuss it. Otherwise, I just want to make sure that this will all function
> correctly. and consider other related edge cases too.

So three things:

1. **Make sure it works**, with tests that would go red if it stopped working.
2. **Consider the related edge cases**, and fix the ones that are bugs.
3. **If there is a cleaner design, bring it to him** rather than build it
   ([§ Questions for Greg](#questions-for-greg)).

## What the code does today

A read-only map of the whole path was made on 2026-10-07 (one Explore subagent, every claim with a
file and line; the load-bearing ones re-checked by hand). **The code already does what Greg
describes.** In short:

- **Each reader gets their own row.** An article is a row in `articles` with an `owner_id`. The
  slug (the name in `/read/<slug>`) is unique across everybody, and it is the article's name plus a
  random six-letter id (`why-trees-spya-k3m9qt`, `slugWithShortId` in `src/ingest.ts`), so two
  readers who paste one address get two different slugs. Neither can take, see or write to the
  other's.
- **"Do you already have this?" only ever looks at your own shelf.** `slugForUrlKey` and
  `slugForShortId` (`src/store/find-article.ts`) filter by `ownedByReader()`; the queue's
  one-import-per-address rule (`jobs_active_source`) has the owner in its key; bulk import's
  duplicate check (`src/minimal-paper.ts`) names the owner.
- **Personalised output is not shared across owners.** Mode output, checkpoints, conversations and
  link summaries are attached to an owned article or revision, or keyed by owner, so one reader's
  profile cannot leak into another's copy.
- **What is shared has no owner and nothing of a reader in it**: the fetched source file and the
  article's images, stored once under their hash (`raw_sources`, the `sources` bucket), and public
  facts about outside pages (`link_previews`, the bibliographic registry tables). Nothing deletes
  the stored bytes, so deleting one reader's article cannot break the other's pictures.
  (Wording corrected by GPT Sol's F2: the first draft said "nothing is cached across owners".)
- **Making it public is a column on your own row** (`articles.visibility`, set by
  `PUT /api/article/:slug/visibility`). No rule stops a second reader publishing the same article.
  The public address is the same `/read/<slug>`, and slugs differ, so the two public copies cannot
  collide. The public shelf (`publicLibraryQuery`, `src/store/public-library.ts`) lists both; it
  does not merge them.
- **Everything a reader does** (comments, chat, searches, tags, reading time, quiz attempts) hangs
  off the article's row id, reached through an owner-filtered lookup.

Production, read-only, 2026-10-07 (`begin read only`, rolled back): 62 articles, 3 accounts, 16
public. **One** address is already held by two different accounts. **No** address is public twice.
So the first case is real today and the "two public versions" case has not happened yet.

### What is not covered

The behaviour above rests on a test of each layer separately, plus a static sweep that every lookup
names an owner (`tests/owner-isolation.test.ts`). **Nothing runs the whole thing with two
accounts**: no test takes one address through the queue for two owners and checks for two articles;
none has both copies public; none deletes one and checks the other still serves.

### The edge cases found

| | Edge case | What happens today | In this plan |
|---|---|---|---|
| E1 | Two readers, one address | two articles, two slugs | test it (stage 1) |
| E2 | One public, one private | independent | test it |
| E3 | Both public | both listed, both open, nothing tells them apart | test it; Q1 |
| E4 | One reader deletes, archives or unshares | the other's copy and its images are untouched | test it |
| E5 | Two readers upload the same file | two articles, one stored file | test it |
| E6 | Reader B opens A's public copy while holding their own | B sees A's as a visitor, at A's address; B's is at B's | test it |
| E7 | Citations: "already in Spideryarn" can link B to A's public copy *in preference to B's own*, when A's matched by DOI and B's only by title | deliberate (`TIER`, `src/cited-in-spideryarn.ts`; pinned by a test) | Q2 |
| E8 | B pastes A's public Spideryarn link into Add, hoping for their own copy | not checked for; we would fetch our own page | refuse it with a plain sentence (stage 2) |
| E9 | Three comments in the code say the opposite of what it does | misleads the next person checking this | fix (stage 2) |
| E10 | A new article's random id equals an existing one's (any owner) | the import fails with a raw database error before any step runs, and Retry reuses the same name so fails again; a fresh paste works. 8 in 100 million per import today, but it grows with the square of the library: an even chance of a first one by about 33,000 articles | fix (stage 2) |
| E11 | Ten articles from before 2026-08-31 have a slug with no random id | a new import always carries an id, so cannot equal one | test it |
| E12 | One reader's burst of imports slows another's; the public shelf's 200-card cap is shared | known, in `ingest-queue.md` and `public-shelf.md` | none |
| E13 | Both paste at the same instant; one fails and retries | owner is in the one-import-per-address key, the name reservation is global | test it (Sol F5) |
| E14 | Both bulk-import the same PDF (the cheap "minimal" import), then one presses *Read this* | duplicate check and upgrade both name the owner | test it (Sol F6) |
| E15 | Both make a private share link; one revokes or deletes | a link is a column on the owner's own row | test it, with the image route (Sol F8) |
| E16 | Charging: A shares (half price), B does not; A unshares or deletes | usage is counted per owner | test it (Sol F7) |
| E17 | One browser signs in as A then as B | already covered: the offline copy is kept per reader, `tests/api-fetch-offline.test.ts` | none |

## Principles and decisions

- **Greg's design stands.** Each reader has their own copy; both may be public. Nothing here
  changes it.
- **The simpler option passed over: write nothing but a note saying "it works".** Rejected because
  the report asks to "make sure", and a claim with no test that could go red is the thing
  [silent-success.md](../reusable/silent-success.md) warns about. The tests are the deliverable.
- **Tests go through the real stores against Postgres**, not mocks of them, and each is checked by
  breaking the code it guards and watching it go red.
- **No model call, no network.** Imports in the test are driven with stored fixtures the way the
  existing queue tests do it.
- **Plan review:** [the prompt](261007f-two-readers-plan-review-prompt.md) and
  [GPT Sol's answer](261007f-two-readers-plan-review-sol.md). One round; the revisions are its own
  replacement wording, so no second round was run.
- **No schema change, no prompt change, no defence edited.** If stage 2's probe (E8) shows a fix
  would touch the URL allowlist in `normaliseUrl`, which is a defence listed in
  [security-map.md](../project/security-map.md), it is written up for Greg and not built.

## Stages

### Stage 1: one test file that runs the whole thing with two accounts

- [x] New `tests/two-readers-one-article-pg.test.ts`, in the Postgres lane, registered the way
      [testing.md § What a brand-new test file owes the two registries](../project/testing.md#what-a-brand-new-test-file-owes-the-two-registries)
      says. Two seeded accounts, A and B, fixture ids minted randomly.
  - **Each queued job is driven to publication through the production coordinator**
    (`advanceJobWith`, `claimSession`, publication) with fake pipeline steps and an in-memory blob
    store, the pattern in `tests/open-before-structure-queue.test.ts`. **Not** with
    `loadArticleIntoPg` or `scratchArticleInPg`, which make a synthetic job of their own, so a
    test could enqueue two jobs, publish two unrelated fixtures and pass (Sol F3). It starts at
    `enqueue`, so it is a queue-to-publication test; the charging cases below go through the
    route's admission or make real reservations.
  - A second file, `tests/two-readers-one-article-billing-pg.test.ts`, holds E14, E15 and E16, so
    two builders can work without sharing a file.
  - [x] **E1** both enqueue the same address through `enqueue` (`src/jobs.ts`): two jobs, two
        different slugs, each owned by its asker; publish both; `slugForUrlKey` as A returns A's
        slug and as B returns B's; a third paste by A adopts A's and never B's.
  - [x] **E1, AI is separate**: write the same checkpoint namespace and key for both article ids
        with different marker values; each read through its own article returns its own marker.
        Separately, B cannot resolve A's article id through an owner lookup. (Not "write A, read
        through B's slug": the store's own request check rejects that before it asks Postgres, so
        it would pass for the wrong reason. Sol F4.)
  - [x] **E13** A and B `Promise.all`-enqueue the same address: two active jobs, two slugs. A's
        fails and is retried: the retry keeps A's name and never touches B's. One forced case of
        two requests wanting the same full slug, to exercise `jobs_reserved_slug`, which random
        ids otherwise never reach.
  - [x] **E2** A makes theirs public. The public route serves A's slug; B's slug is 404 to a
        visitor and to A; B still reads their own. The public shelf lists exactly one.
  - [x] **E3** B makes theirs public too. The publish succeeds; the public shelf lists both, with
        different slugs; each public address returns its own article (told apart by a marker in
        each one's content).
  - [x] **E6** B, signed in, asking for A's slug through the owner's route gets 404, and through
        the public route gets A's; B's own slug still answers as owner.
  - [x] **E4** A unshares: A's leaves the shelf, B's stays. A deletes: B's article, its blocks and
        its image manifest still serve, and the shared `raw_sources` row is still there.
  - [x] **E5** both upload the same bytes: two articles, one `raw_sources` row, each claim owned by
        its uploader.
  - [x] **E11** a legacy row whose slug is a bare name owned by A; B imports an address that
        derives the same name; B gets a different slug and A's row is untouched.
  - [x] **Per-reader data**: a comment and a tag B adds on B's slug land on B's article id only.
- [x] `tests/two-readers-one-article-billing-pg.test.ts`:
  - [x] **E16** each has one ingest event of their own; sharing A's changes only A's full and
        half-price counts; deleting A's freezes only A's price; an `ai_calls` row for each job
        carries the right owner and article id.
  - [x] **E14** both minimally import the same PDF bytes: two minimal articles, two charges. A's
        *Read this* supersedes only A's. B stays minimal and can upgrade later.
  - [x] **E15** both create a private link: A's key opens only A's, B's only B's, even though
        both image manifests name the same hash. A revokes, then deletes: B's key and B's image
        response still work.
- [x] Mutation check, recorded in this doc: for at least three of the above, break the guard
      (drop `ownedByReader()` from `slugForUrlKey`; remove the owner from the delete; make the
      public resolver ignore the slug's owner by returning the first public row) and see the right
      case go red.
- [x] `npm run typecheck`, the new file, `tests/owner-isolation.test.ts`, `tests/find-article.test.ts`.
- [x] If a case fails, that is a bug: postmortem, fix red-first, and say so here.

### Stage 2: the small fixes and the probe

- [x] **E9** correct the three stale comments: `src/store/pg-revisions.ts` ("what it does NOT do
      is let two readers keep the same URL, which is still an open question"),
      `src/store/pg-jobs.ts` ("A slug is unique per owner, not across them"), `src/pipeline.ts`
      ("two owners racing for one free slug … known gap"). Each to say what is true now, checked
      against the code it sits on.
- [x] **E8** refuse a Spideryarn `/read/<slug>` address pasted into Add, always, in the
      `POST /api/jobs` handler (`src/routes.ts`) after `parseJobRequest` and before a slot is
      reserved. Changed from "probe, then decide" by Sol F10: whether today's page happens to
      extract to junk or to nothing is not a policy, and importing our own reading page can never
      be what the reader meant. A product rule on the address (our public host, path `/read/…`),
      **not** in `normaliseUrl` and not the sanitiser's `ownOrigins()`, both of which are
      defences and stay untouched. The sentence the reader gets: *"That link is an article
      already in Spideryarn. Open it to read it, or paste the article's original address to add
      your own copy."* Red-first route test; check in a browser that the Add page shows the
      sentence. The probe still runs once, to record what happened before.
  - Retreat, decided now: if the Add page cannot show a route's 4xx sentence without new UI,
    keep the refusal and the sentence in the response, and record the UI gap as a queue entry.
- [x] **E10** stop a new slug's random id equalling one an article already has. The first draft
      of this plan wrote it down as accepted. GPT Sol graded that P1 (F1) and asked for an atomic
      reservation; Opus arbitrated on 2026-10-07 and I have taken its answer:
  - a boolean leaf `src/store/short-id-is-taken.ts`, sibling of `slugIsTaken`, registered with
    the guard in `tests/owner-isolation.test.ts` (extend the guard if a `short_id` lookup does not
    trip it);
  - one helper that mints a slug and mints again if its id is taken (three tries), used at the
    three places `src/jobs.ts` mints (`freeSlug`, the upload branch, the re-mint on a name
    conflict);
  - in `lockOrCreateArticle`, a unique violation on the `short_id` constraint becomes a
    `PublishRefused` with a plain "paste it again" sentence, not a raw error;
  - tests: taken-then-free uses the second id (red first); never taken makes exactly one lookup;
    against Postgres, an article holding id X and a draft opened for `other-base-X` gets the plain
    refusal.
  - **What is left open, on purpose:** two imports in flight that mint the same id at the same
    moment (about 1 in 100 million per import, and it does not grow with the library). It fails
    before any model is paid, and a fresh paste fixes it. Closing it needs a unique index on the
    queue and a migration. **Sol still asks for that; overruled because** Opus, reading the code,
    found no paid work is at risk (the article row is created when the job's draft opens, before
    any step), the uniqueness contract itself is never broken (the database refuses the
    duplicate), and the remaining window is flat. One paragraph in `ingest-queue.md` says so.

### Stage 3: write it down

- [x] One section, **"Two readers, one article"**, in [library.md](../project/library.md) (the
      shelf's doc), as the single home for the facts in § What the code does today, citing the
      test file as what keeps them true. `public-shelf.md`, `billing.md` and `ingest-queue.md` get
      a line pointing at it where they touch the subject, not a second copy.
- [x] The note in `docs/user-feedback/`, `feedback-endings.ts`, the line in
      `awaiting-approval.md` for the questions below, and a queue entry for them.
- [x] Full suite once, typecheck, doc-links, GPT Sol code review, push to `dev`.

## Questions for Greg

None of these blocks the work above. Each is "is there a cleaner way", which he asked to discuss.

Two questions, and one pointer to a question already waiting.

### Q1. Two public copies of one article look identical on the public shelf

**Background.** The public shelf is `/read/public`, the page a stranger sees. Each card shows a
title, a date and a few words. A card says nothing about who shared it or how it was processed. If
two readers both share the same article, a visitor sees the same title twice and cannot tell which
to open. This has not happened yet in production (0 cases among 16 public articles).

- **A. Leave it (recommended for now).** Two cards. Costs nothing. Weird only when it happens, and
  it has not.
- **B. Show one card per article.** The shelf groups cards by the article's source address and
  shows the earliest-shared one; the others stay reachable by their own links. A visitor sees a
  tidy shelf. It costs a rule for "same article" (addresses differ for one paper: publisher page,
  arXiv, a PDF), and somebody's shared copy silently not appearing, which they may mind.

  ```
  today (A)                         one card (B)
  ┌──────────────┐ ┌──────────────┐  ┌──────────────┐
  │ Why trees    │ │ Why trees    │  │ Why trees    │
  │ 3 Oct        │ │ 5 Oct        │  │ 3 Oct        │
  └──────────────┘ └──────────────┘  └──────────────┘
  ```

- **C. Two cards, but say what differs.** Each card gains a small line such as "written for a
  reader in neuroscience" when the sharer had a profile. That reveals something about the sharer,
  which is a privacy promise to change, so it is the costliest of the three.

- **D. One card that opens to its versions.** The card says "2 public versions" and opens to
  list them; nobody's copy is hidden and nothing about a sharer is shown. Grouped only when we
  are sure it is the same work (a DOI or arXiv id agrees); anything less sure stays as two cards.
  The cleanest of the four to look at, and the most to build (a grouped card is a new kind of
  card on three surfaces). Added from GPT Sol's review.

**What would decide it:** whether you expect many readers to share the same well-known papers. If
so, D (or B) becomes worth building. Until it happens once, A.

### Q2. In Citations, a stranger's public copy can be offered ahead of your own

**Background.** In Citations mode, a cited work that is already in Spideryarn gets a link to it. We
look in your shelf and on the public shelf. When both have it, the surest match wins (a DOI or
arXiv id beats a title), and **between equally sure matches your own copy wins**. So the one case
where the link goes to a stranger's version is: your copy could only be matched by title (an
upload with no identifier found, say) and theirs matched by DOI.

- **A. Leave it (recommended).** A title match is occasionally the wrong paper and a DOI match
  never is, so the rule sends you to a certainly-right article over a probably-right one. My first
  draft recommended "your own always wins"; GPT Sol pointed out that would let a wrong title match
  beat an exact one, and it is right.
- **B. Show both** when this happens: "On your shelf (matched by title)" and "On the public shelf".
  Honest, and a second link on a row that is already busy.

**What would decide it:** only whether you have been sent to somebody else's copy and minded.

### Q3. Reader B wants the article that A already made public

**Background.** Today B has two choices: read A's public copy as a visitor (free, no AI of their
own), or paste the original address and get a full import of their own (one slot). Nothing joins
the two. This is the same ground as the question already waiting in
[261006k § Questions for Greg](261006k-signed-in-reader-ai-on-someone-else-s-public-article.md#questions-for-greg),
whose option B is an "Add a private copy to your shelf" button on a public article. Stage 2's probe
(E8) adds one fact to it: what happens when B pastes A's Spideryarn link itself.

No new option here. Answering 261006k answers this. From this plan on, pasting A's Spideryarn link
is refused with a sentence that says what to do instead (E8).

## Progress

- 2026-10-07: prior-work check (nothing on this report; nearest are
  [260929_1442](../user-feedback/260929_1442-public-articles-versus-personalisation.md), declined,
  and 261006k, awaiting Greg; `qi-yxr67qkz`, the free repeat paste, is same-owner and separate).
  Map made, production counted, plan written.
- 2026-10-07, plan review: GPT Sol, verdict revise, ten findings, all taken (F1 as arbitrated by
  Opus, see stage 2).
- 2026-10-07, stage 1: both test files written by two Opus builders and green. **Every case passed
  on its first run**, so what makes them evidence is the mutations, each made in `src`, watched red,
  and edited back by hand:

  | Guard removed | Went red |
  |---|---|
  | the owner filter in `articleUrls` (`src/store/find-article.ts`) | E1: "B was told somebody else's article is the one they already have" |
  | all three `ownedSlug` in `destroy` (`src/store/pg-shelf.ts`) | E4: B's delete of A's article succeeded |
  | `publicSlug` matching on visibility alone | E2: "a visitor was served something at B's private address" |
  | the owner clause in `usageSql` (`src/store/pg-billing.ts`) | E16 and E14: counts doubled |
  | the key clause in `src/store/link-shared-slug.ts` | E15: A's key opened B's |
  | `ownedSlug` in `currentShareLinkQuery` | E15: B read A's link |
  | the owner clause in `duplicateOnShelfSql` (`src/minimal-paper.ts`) | E14: B was handed A's slug as a duplicate |
  | `ownedSlug` in `articleIdFor` (`src/store/ai-calls-pg.ts`) | E16: B's call landed on A's article |

  Unscoping only the final `delete from articles` statement stayed green: the two owner-scoped
  reads in front of it already answer 404, so that clause is a second lock, not the only one.
  Not mutation-checked: that B's key and picture survive A's delete (E15's last case), and the
  price freeze on delete other than through the usage mutation.
- What the builders found false in this plan or its briefs, so nobody inherits it:
  - `tests/asset-route.test.ts` has no in-memory blob store; it points `blobStore()` at a temp
    directory. And mocking `blobStore()` alone does **not** keep an upload off Storage:
    `storeRawSource`'s default parameter, `uploadGrants()` and `postgresBlobStore()` reach the
    bucket too. Both new files mock all of them, and the main file has a tripwire that fails if
    any network request is made.
  - `articles` has no address column; "same address" is the same `final_url` on both revisions.
  - A minimal (bulk) paper cannot be link-shared, so E15 and E16 use seeded published copies
    rather than E14's imports.
  - Sol F7's "the admin view reports both accounts separately" is not tested.
  - Deleting an article is refused while any job on it is live, and publication queues follow-on
    jobs, so a reader who deletes seconds after an import is told to wait. Existing behaviour; E4
    cancels those jobs first.
- 2026-10-07, stage 2:
  - **E9** the three comments now say what is true. The one in `src/store/pg-jobs.ts` turned out
    to hide a real reason: `jobs.slug` is plain text with no key to the article, so the owner
    filter there is doing work.
  - **E8** built as planned: `isOwnReadingPage` (`src/own-reading-page.ts`), checked in
    `POST /api/jobs` before a slot. The sentence is `OWN_READING_PAGE` in `src/messages.ts`,
    registered as one Retry cannot help, so the Add page shows it with no *Try again* under it:
    *"That link is an article already in Spideryarn, and adding the link again will be refused the
    same way. Open the link to read it, or paste the article's original address to add your own
    copy."* (Reworded from the plan's draft because the message registry requires a sentence with
    no Retry to say that retrying comes back the same.) The probe: `/read/public` on production is
    the app shell, a default head and an empty `<div id="root">`, so there was never prose to
    import. Not caught, on purpose: a short link that redirects to one of our pages, and preview
    hosts.
  - **E10** built as arbitrated: `shortIdIsTaken`, `mintSlug` at all three mint sites, the guard in
    `tests/owner-isolation.test.ts` extended to notice a bare `short_id` lookup, and the plain
    refusal in `lockOrCreateArticle`. Constraint: `articles_short_id_unique`.
  - **A gap found while doing E10, left open and queued.** A refusal thrown while a claim opens its
    draft ends no job. The reader sees an import "running" for about 38 minutes (a 760-second
    lease, then two requeues), then *"This stopped part-way through"*, with a Retry that repeats
    it. The plain sentence reaches only the log and the advance's 409. This was already true of the
    older "slug already belongs to another reader" refusal. After E10 the only ways to reach it
    are two imports minting one id at the same moment, or a slug with no id. Fixing it means
    ending the job when the open fails permanently, which is new machinery in the open-session
    path, so it has its own queue entry and a paragraph in
    [ingest-queue.md](../project/ingest-queue.md#a-new-id-is-checked-against-every-article-and-when-two-imports-mint-the-same-id-at-once).
    Pinned as it is by `tests/short-id-collision.test.ts`.
  - Seen and not touched: above any refused paste the Add page still prints "The article's text
    has been sent to a third-party model provider for processing", which is false when the paste
    was refused before anything was fetched. Existing behaviour for every refused POST; queued.
- 2026-10-07, stage 3: [library.md § Two readers, one article](../project/library.md#two-readers-one-article)
  is the home for the facts; `public-shelf.md` and `ingest-queue.md` point at it.

## Appendix: the map

The subagent's findings worth keeping, beyond § What the code does today:

- Unique keys **without** the owner in them: `articles.slug`, `articles.short_id`,
  `articles.share_token`, `jobs_reserved_slug`, `raw_sources` (hash, kind), `link_previews`
  (publisher metadata, not model output), and the bibliographic registry tables (public data).
- Unique keys **with** it: `jobs_active_work`, `jobs_active_source`, `link_summaries`,
  `shelf_topic_*`, `reader_profiles`, uploads' duplicate index.
- If two slugs ever did collide across owners, `lockOrCreateArticle`
  (`src/store/pg-revisions.ts`) refuses with "already belongs to another reader" and never adopts.
- `BlobStore.remove` has no caller in `src/`.
- `findArticle` in the browser (`src/web/article/access.ts`) asks the owner's route first and the
  public route on a 404; never the reverse.
- The "Include public" section of the shelf drops your own shared articles by slug
  (`ShelfPublicSection.tsx`), so A's public copy of something B also holds shows once in B's list
  and once in the public section. That is E3 from B's side, and Q1 covers it.
