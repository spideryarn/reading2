# Topic pills on the public shelf: automatic and billed to the site, with a button for big rebuilds

Up: [plans.md](../project/plans.md) · the page is [public-shelf.md](../project/public-shelf.md) · the
pills are [shelf-terms.md](../project/shelf-terms.md) · the cost is investigation
[261008a](../investigations/261008a-public-shelf-topic-rethink-cost.md)

**Status: built 2026-10-09, after Greg chose option A of `q-p5h2a7` in the Overseer's terminal:**

> q-p5h2a7 A
>
> — Greg, 2026-10-09

What was built, and where it differs from this plan, is [§ As built](#as-built-2026-10-09) at the
end. Queue item `qi-4far27sc`. It follows plan
[261004j § Part 2](261004j-shelf-topic-pills-more-inclusive-and-public-shelf-pills-awaiting-greg.md#part-2-pills-on-the-public-shelf-spya-mdp0em-not-built-a-question-for-greg),
which asked the first question.

## What Greg asked

> Show the topic-pills on the page for filtering public/shared articles as well.
>
> — Greg, 2026-10-04, report `spya-mdp0em`

Asked which page and how, he answered:

> I had meant the public shelf for that's available to non-logged-in users, showing the publicly
> shared articles. Okay, how about this? Perhaps we could add some kind of interface, probably on
> that page, only visible, only shown, only usable by admin users like me, and that I can click a
> regenerate topic pills. In other words, it doesn't happen every single time a new article is
> added. It's manual. I don't know if this is a good solution. It feels kind of crappy. The
> alternative would be we do it every time a new article is added and bill it to a special account
> like, I don't know, admin or whatever that's, in a sense, no particular user. It's the site. That
> would also work. I think I'm worried that it will end up being more than half a cent. If it was
> only half a cent and you were confident about that to regenerate, then maybe I'd say that would be
> the way to go, and it would run automatically when new public pages are added. I guess use your
> judgment.
>
> — Greg, 2026-10-08, reply `spya-hbtqvc` to `q-deh67j`

## The cost, measured

Investigation [261008a](../investigations/261008a-public-shelf-topic-rethink-cost.md), on the
shipped code with no reader profile. The saved result does not record per-call attempt numbers:

| | cost per run |
|---|---|
| filing one newly shared article into the existing tree (what most shares cost) | 0.007–0.011¢ |
| a full re-think of today's public shelf (6 articles), 3 runs | 0.030–0.040¢ |
| a full re-think at 8 articles, 2 runs | 0.029–0.034¢ |
| a full re-think at 20, 2 runs | 0.088–0.097¢ |
| a full re-think at 45, 2 runs | 0.48¢ and 0.52¢ |
| a full re-think at 96, 1 run | 1.44¢ |
| at the 150-article cap | not measured; an estimated 2–3¢ |

A full re-think is not run on every share. As on every reader's shelf, it is due only when the
shelf has grown or shrunk by a quarter (and at least five works), or when the prompt or model
changes; every share in between is one filing call.

## The decision: automatic up to 20 public articles, a button on /admin beyond

**Greg's bar is per regeneration**: *"if it was only half a cent and you were confident about that
to regenerate"*. Measured, that holds comfortably for **filing into the 20-article tree** and for a
**full re-think up to 20 public articles**: about 0.1¢, so about 0.2¢ if its one call had to be made
twice. Filing one article remains one bounded call at larger sizes, so the plan treats it as staying
under the bar; that part is an inference, not a larger-shelf measurement. The bar does not hold
reliably at 45, where one of the two runs was already over it. So:

- **Automatic, billed to a site account**: filing each newly shared article, at any size; and a full
  re-think when one is due, **while the public shelf has 20 articles or fewer**.
- **Past 20, a full re-think is a button on `/admin`**, the page only administrators can open. New
  shares are still filed automatically; only the occasional rebuild waits for a press, and /admin
  says when one is due. `/read/public` itself stays the same for everyone.
- **20 is a measured cut-off, not a guess**, and it can be raised later by measuring at 30, 35 and
  40, including a run with a retried call.

Today the public shelf has 6 articles, so for a good while this is simply automatic.

**The simpler option passed over: the button alone**, with nothing spent automatically. Greg called
it "kind of crappy", and it leaves a newly shared article out of every pill until someone presses
it. Filing costs about a hundredth of a cent and is what keeps the pills current, so it is the part
worth automating.

**Also passed over: fully automatic at any size.** It is what Greg would have liked if the numbers
had allowed it. By 45 articles a rebuild is at the half-cent line: one measured run was just under
and one just over. Offered to Greg as an option rather than built in.

## The design

```
  an owner shares, un-shares,              that request, after its answer is sent and before
  archives or deletes a public article ──► it returns, as the SITE account:
                                             ├─ nothing due                     → no spend
                                             ├─ a new public article            → file it    ≈ 0.01¢
                                             ├─ due, and ≤ 20 public articles   → re-think   ≤ 0.1¢
                                             └─ due, and > 20                   → nothing; /admin
                                                                                  says "rebuild due"

  an administrator presses Rebuild on /admin ──► re-think, as the SITE account, at any size

  a stranger opens /read/public  ──► GET /api/public/library, as now: one request, anonymous,
                                     the same signed in or out. The answer carries the stored
                                     topics and each card's topic keys. Nothing is spent.
```

1. **A site account.** It owns no articles and cannot sign in. It has to be a real `auth.users`
   row, because `ai_calls`, `shelf_topic_sets` and `rate_limit_events` all have a foreign key to
   one (`src/db/schema.ts`), and keeping those keys is better than weakening them. So **production
   gets one new auth account**, created once by a script: a production write, and Greg's to approve.
   How it is kept from signing in is designed, not assumed: no password, no identities, an address
   nobody can receive mail at, banned through the Auth admin API, and the script reads it back to
   check. It is left out of the reader counts on `/admin` and labelled *the site* on
   `/admin/costs`. Its id lives in a small constants module that public code can import without
   importing `src/owner.ts`.
2. **The tree is stored where every reader's is**: one `shelf_topic_sets` row whose `owner_id` is
   the site account. No migration. The same claim, back-off and allowance (12 an hour, 40 a day),
   on the site's bucket.
3. **Its unit is a listed card, not an exact-copy work.** A reader's tree groups exact copies of one
   text by a hash that reader's phrase pass fills in, and the site account cannot fill hashes in
   other people's articles. Two readers sharing one article are already two cards on this page
   ([public-shelf.md](../project/public-shelf.md)), so each card is its own work. The coordinator
   (`shelfTopicSet`) gets public deps that say so, rather than a fill step that could never finish.
   The eight-article minimum counts cards.
4. **One closed query feeds both the page and the tree.** The input is the listing itself
   (`publicLibraryQuery`: public, readable, not archived, its caps), with the article id added on
   the server and never put on the wire. There is no second ownerless read of `articles`, so there
   is no second copy of the listing's conditions to keep in step. No reader profile goes in.
5. **When it runs.** After a visibility change, an archive or restore, or a delete of a public
   article. The handler sends its answer, then awaits the refresh before returning, as the shelf
   topics route already does, so the spend is recorded inside the request. The refresh runs inside
   `runAsOwner(SITE_OWNER_ID, …)`, for the stored row and the allowance, **and**
   `withSpendAttribution({ ownerId: SITE_OWNER_ID, articleSlug: null }, …)`, for the ledger. Without
   the second, the route's own spend scope would record the call against the sharing reader and
   their article. An article shared while it was still being read reaches the listing later without
   another of those requests. It has no pills until the next trigger, and is never shown under a
   wrong one.
6. **What a stranger receives, and when it is withheld.** `GET /api/public/library` gains the topic
   labels (key, label, breadth, parent) and, per card, the keys of its topics. **If any article the
   tree was built from or filed into is no longer listed, no topics are sent at all** until the tree
   is rebuilt. Cutting just that article's memberships is not enough: a label may have been worded
   from its title, and un-sharing must take effect on the next request, as it does now. Under 20
   articles the un-share request itself rebuilds, so a stranger rarely sees the gap. Below eight
   listed cards, no topics either. The card's pinned columns stay; the topics are a separate field.
7. **The page** draws the same row of pills as a reader's shelf, and narrows the cards the same way.
   Still one request, and still no call into the auth module. The pill row's presentational part is
   shared; nothing owner-scoped comes into the page's import graph.
8. **[privacy.md](../project/privacy.md)** gets one clause: shared articles' titles and summaries go
   to OpenAI to name the public shelf's topics. They already go there for their owner's own pills.

**What becomes newly possible, named.** A hostile owner's shared title can already put its own words
on its own public card. With this it can also steer the labels strangers see on the public shelf,
and which other owners' articles sit under them. The bounds are those every reader's tree has: no
tools on the call, a strict schema, articles and topics named only by ids the prompt showed, and a
label of at most 40 characters drawn as text. Un-sharing the article withdraws every label until the
rebuild.

**What it can cost under abuse.** The allowance counts runs, not money. Under the cut-off a run is
at most about 0.2¢ with a retry, so 40 a day is at most about 8¢ a day. After that the public pills
stop updating until the next day. The /admin button is pressed by an administrator, so it is not an
abuse path.

## The listed defences it edits, and the ones it must leave alone

From [security-map.md](../project/security-map.md), each with its test changed in the same commit:

| defence | the change |
|---|---|
| `src/store/public-library.ts`, the one ownerless listing | the article id selected on the server, for the tree's input and for withholding; stripped before the wire |
| `src/public-library-types.ts`, the wire | `topics` added to `PublicLibrary`, and a topic-key list to each card |
| `tests/owner-isolation.test.ts` § ownerless enumeration | the listing's pinned projection gains the server-only id, plus a test that it never reaches the response |
| `tests/public-imports.test.ts`, the public import graph | `shelf_topic_sets` added to the tables the public graph may read, read-only and for the site row only; still no model, gateway, rate limiter or owner-context module |
| `src/web/PublicLibraryPage.tsx` | the pill row |
| the request's billing | spend recorded against an account other than the signed-in one, for the first time |

Left alone, and run during the build to show it: the page's one-request inventory
(`tests/public-shelf-page.test.tsx`), the anonymous-region guard, and the public dispatcher's
`no-store`.

## Tests (when built)

- Red first: a public shelf of eight articles with a stored site tree. `GET /api/public/library`
  carries no topics today (watched failing), and carries them after.
- An article un-shared, archived or deleted after the tree was built: no topics at all on the wire
  until the rebuild, and the article's id never on the wire.
- A private article is never in the tree's input (run against private, public and
  public-but-unreadable rows).
- A share files the new article. The stored row, the allowance row and the `ai_calls` row all belong
  to the site account, and the `ai_calls` row has no article slug. The sharing reader's own tree is
  unchanged, and two concurrent requests do not leak either context.
- A due re-think over 20 cards does not run; the /admin button runs it.
- The page still makes one request, the same signed in and out.
- Below eight listed cards, no pills.
- The site account cannot sign in (the provisioning script's own check).

## Stages (when built)

1. The site account (constants module, local seed, the provisioning script and its check), the
   public deps for the coordinator, and the triggers, with tests.
2. The wire, the withholding rule and the page, with tests; the /admin button; privacy.md,
   shelf-terms.md and public-shelf.md.
3. GPT Sol code review, gates, push to `dev`. Running the provisioning script on production is
   Greg's, or done once he says so.

About a day and a half.

## What the review changed

GPT Sol's plan review ([its answer](261008j-public-shelf-topic-pills-plan-review-sol.md); the first
attempt returned only a summary because the prompt asked a read-only reviewer to write a file, and
was re-run): no P0, five P1, four P2. All taken.

| Finding | What changed |
|---|---|
| Averaging a rebuild over the shares that cause it does not meet a bar that is per regeneration; one 45-article run was already over it | Full re-thinks are automatic only up to 20 articles; past that, a button on /admin. The question no longer says "well under half a cent" without the size. |
| Cutting an un-shared article's memberships leaves labels that may have been worded from it | Any article missing from the listing withholds the whole set until the rebuild; archive and delete are triggers too. |
| The coordinator counts exact-copy works, and fills hashes the site account cannot fill | The unit is a listed card, and the public deps say so. |
| The defence list missed the public import graph, the owner-context import ban and the server-only id | Added; one closed query feeds both, so there is no second ownerless read. |
| Running "as the site" needs both the owner scope and the spend scope, and a refresh deferred past the handler escapes the spend collector | Both scopes named; awaited after the answer, before the handler returns. |
| P2: "at most $1 a day" counted runs as if they were money | Restated for the cut-off: about 8¢ a day. |
| P2: "cannot sign in" was asserted, and the account would show in reader counts | Designed, and checked by the script; left out of counts, labelled on costs. |
| P2: measured and extrapolated figures were mixed | The investigation and the table above say which is which. |
| P2: the button was rejected for a wrong reason, because it can live on /admin | Corrected, and the button is now part of the design. |

## What was done in this session

Measured the cost (the investigation, and its script
`evals/shelf-topic-clusters/public-shelf-cost.ts`), wrote this plan, had it reviewed, recorded
Greg's answer in `q-deh67j` and asked `q-p5h2a7`. Nothing that touches a defence was built.

## As built, 2026-10-09

Everything in § The design, with these differences, each for a reason:

| Planned | Built | Why |
|---|---|---|
| The site account made once by a provisioning script, banned through the Auth admin API | **A migration**, `drizzle/20261009022454_site_account.sql`: one `auth.users` row, no password, no identity, `site@spideryarn.invalid`, `banned_until` 2999 (not `infinity`, which GoTrue may not scan), the four token columns `''`. Additive, `on conflict do nothing` | The Overseer's brief: no hand-written production writes; the Overseer applies migrations with the deploy. Checked locally: password sign-in refused (`invalid_credentials`), the GoTrue admin listing still answers 200. `tests/public-shelf-topics-pg.test.ts` pins the row's columns |
| The coordinator "gets public deps" | `ShelfTopicSetDeps.due`, a `DuePolicy` (`rethinkUpTo`, `rethinkWhenGone`) read by `whatIsDue`; a reader's shelf leaves it out. `src/public-shelf-topics.ts` holds the public deps (`AUTOMATIC` = 20 and gone-forces-rethink; `BY_HAND` = a reader's own cap) | The cap and the un-share rule are the only two decisions that differ; everything else (claim, allowance, back-off, drain) is shared |
| The site tree read inside `src/store/public-library.ts` | **Its own file**, `src/store/public-topic-tree.ts`, the only file `tests/public-imports.test.ts` § `ALLOWED_IN` lets name `shelf_topic_sets` | `tests/owner-isolation.test.ts` holds the listing file to naming no owner at all, and this read is by a (fixed) owner |
| Withholding and the wire's projection | `src/public-library-topics.ts`, pure, imports only types | So it can be tested without a database and sits in the public graph |
| "/admin says when one is due" | A panel on the `/admin` index (`AdminPublicTopics.tsx`): one sentence of status, **Rebuild shown only when a rebuild is due**, and Refresh. `GET /api/admin/public-shelf-topics`, `POST …/rebuild` (claims before answering 202, awaits the work after) | A button that would do nothing is a button that looks broken |
| The page "draws the same row of pills" | The row only (`PublicShelfTopics.tsx`): the same `TermChip`, counts and AND narrowing, the reader row's Clear and "All N topics"; no "More detail", no pills on the cards, no `?topics=` | Simplest version first; the row is what Greg asked for |
| Left out of reader counts; labelled on costs | `mergeUsers` drops the site id; `/api/admin/costs` sends `the site` as its label | — |

**Tests.** Red first, watched failing: `whatIsDue` with the policy (`tests/shelf-topic-sets.test.ts`),
the withholding projection (`tests/public-library-topics.test.ts`), the route-level suite
(`tests/public-shelf-topics-pg.test.ts`: 5 of 7 red before the triggers existed), the article id
never on the wire (`tests/owner-isolation.test.ts`, red with the id leaked on purpose), and the site
account out of /admin's readers (`tests/billing-admin-plan.test.ts`). The page's pill tests
(`tests/public-shelf-page.test.tsx` § the topic pills) and the admin sentence
(`tests/admin-public-topics.test.ts`) were written after their components. **Not written:** a
separate test that two concurrent requests do not leak either owner context; the scopes are nested
`AsyncLocalStorage` runs, and the route suite asserts the sharing readers have no tree and no spend
of this kind.

**Production.** Nothing was written to production by hand. The migration goes out with the next
deploy, which only the Overseer runs; until it is applied the triggers find no site account and
the refresh logs an error and does nothing, and the page sends no topics.

### Built-code review, 2026-10-09

Fixed two defects reproduced red first in `tests/shelf-topic-sets.test.ts`:

- A public rebuild passed previous labels into the naming prompt even after an article was
  withdrawn. It now clears all previous labels in that case, including when the removed article
  was unplaced; reader label continuity remains unchanged.
  [The provenance failure](../postmortems/261009c-rebuilt-labels-can-retain-withdrawn-input.md).
- An un-share during a live rethink could leave the just-written tree stale indefinitely.
  The public wrapper now reconciles once after work completes, within the same site scopes and
  request collector and with a separate allowance. The drain skips a public tree with withdrawn
  input. Further changes during that bounded follow-up, backoff or allowance refusal still wait
  for another trigger. [The lost trigger](../postmortems/261009d-a-live-claim-can-lose-a-removal-trigger.md).

GPT Sol (high), verdict *ship after fixes*. Its sandbox could not reach Docker, so the Postgres
suites were run afterwards, outside it, on its fixes: `tests/public-shelf-topics-pg.test.ts`,
`tests/owner-isolation.test.ts`, `tests/shelf-topics-route.test.ts` and
`tests/shelf-topic-sets-pg.test.ts`, 94 passed. One finding left as it is:

- **`scripts/share-local-articles.ts`** calls the store directly, so a share made by that
  local helper waits for the next trigger. Local only; MCP goes through the routes.

The browser check (a Sonnet subagent, Playwright, signed out, 1280 and 390 wide) passed: one
request, pills narrow by AND and Clear restores, no horizontal scroll, no console errors. It found
the pill's card saying *"your articles"* to a stranger; now *"the shared articles"*.
