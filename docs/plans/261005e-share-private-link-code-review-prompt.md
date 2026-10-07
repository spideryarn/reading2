# Code review, security first: the private share link (plan 261005e, stage 1)

You are reviewing built code, and you may fix what you find. This feature lets a stranger with a
secret link read one reader's **private** article without signing in. A mistake here publishes
somebody's private reading. Review it as an attacker would.

## What it is for

A reader presses *Create a link* on an article they own and gets
`/read/<slug>?key=<22 base64url chars>`. Anyone holding it can read that article, read-only, with no
AI, until the owner presses *Turn off*. It is not listed anywhere. The plan, with Greg's decision and
the earlier plan review, is
`docs/plans/261005e-share-an-article-with-some-people-a-private-link-first.md` (§ Stage 1 only;
stages 2 and 3 are written up and deliberately not built).

## The candidate

Worktree `/var/tmp/spideryarn-worktrees/share-private-link`, branch `worktree-share-private-link`.
Three commits; the tree is clean apart from this prompt:

- `e095fad5c` and `37262a17b`: the server half
- `01446fe4b`: the browser half, the pages and the docs

List the changed paths with `git show --stat --format= e095fad5c 37262a17b 01446fe4b`. Do **not**
diff against `origin/dev` or a merge base: a merge of dev sits between the commits and would show
other people's work. Read the files themselves; do not expect the diff pasted here.

Start with these, which does not limit scope:

- `src/share-key.ts`, `src/store/link-shared-slug.ts`, `src/store/public-access.ts`
- `src/store/public-reader.ts` (every query and the three loaders)
- `src/public/routes.ts`, `src/public/page.ts`, `src/public/dto.ts`, and the transport in
  `src/routes.ts` and `src/vercel.ts` that hands the key over
- `src/store/pg-share-link.ts` and the three `share-link` rows in `src/routes.ts`
- `src/store/export-bundle.ts`, the feedback path (`src/routes.ts` § `feedbackWhere`,
  `src/feedback.ts`, `src/feedback-notice.ts`, `src/web/FeedbackButton.tsx`)
- `src/web/public-api.ts`, `src/web/rehost.ts`, `src/web/article/access.ts`,
  `src/web/useShareKey.ts`, `src/web/lib/api.ts` (§ `NEVER_KEPT`)
- `src/web/PrivateLink.tsx`, `src/web/AccessSharing.tsx`, `src/web/PublicChrome.tsx`
- `drizzle/20261005184047_article_share_link.sql`
- The guards that were edited: `tests/owner-isolation.test.ts` (a fourth sanctioned slug leaf, and
  `share-key.js` added to the anonymous region's pinned import list), `tests/public-imports.test.ts`,
  `tests/client-imports.test.ts` (`share-key.js` added to `SHARED`),
  `tests/share-link-token-stays-home.test.ts`
- `docs/project/security-map.md` (new rows and subsection), and the other docs in `01446fe4b`

Background you should read: `docs/project/security-map.md` § The unauthenticated namespace, and
`AGENTS.md`.

## The guarantees, stated at their true strength. Is each statement accurate?

1. A private article is readable through the public doors (`/api/public/article/:slug`,
   `/api/public/asset/:slug/:hash.:ext`, the HTML `/read/:slug`) **only** when the request carries a
   key equal to that article's current `share_token`, compared in the SQL `where` of each query. A
   missing, empty, malformed, wrong, revoked or other-article's key gets a response identical to an
   absent article's.
2. A key opens its one article and nothing else of the owner's: no other article, no listing, no
   referee comment, no unfinished model call, no profile, no owner-only field. The public DTO
   allowlist is unchanged except for `sharedBy`.
3. `/api/public/library` and the showcase can never contain an article that is only link-shared.
4. *Turn off* stops the old key on the next request; creating again mints a new 128-bit key from
   `crypto.randomBytes` and the old one stays dead.
5. The key leaves our server only in the owner's own `GET/POST /api/article/:slug/share-link`
   response. It is not in any other owner payload, the public payload, the reader's export, the
   admin views, the audit table, our request log, an error message, a Sentry event or tag, a
   feedback report or its email, the offline (IndexedDB) store, or the remembered-view store.
6. Only the owner can read, create or turn off a link, and creating requires the rights tick and
   refuses a minimal-processing paper.
7. A person with the link can start nothing that spends money and can write nothing.
8. A public article behaves exactly as before whatever key is sent, and says `sharedBy: "public"`.
9. The HTML page for a right key on a private article is a 200 with no article title, description
   or `og:` metadata.
10. The migration is additive only and safe to apply to production before the code that reads it.
11. Billing is unchanged: a link-shared article counts at the private rate.
12. The words on the page are true: the notice a visitor sees, the card's sentences, and what
    `/privacy`, `/features/public-readable-sharing` and `/help` now promise.

## What you may do

You are write-capable (`workspace-write`). **Fix what is inside this stage, narrowly, and write the
failing test first.** Report, do not fix, anything wider. Do not commit. Do not touch `drizzle/` (if
the schema is wrong, report it). Do not attribute any sentence to Greg: his only words on this are
the ones quoted in the plan's § What Greg decided, and none may be added or reworded.

One known gap you should fix if you agree with it: the owner's masthead mark and shelf badge still
say *"Only you can read this"* over an article with a private link on, because they read
`Article.visibility` alone. The honest fix is a boolean on the owner's payload meaning "a private
link is on" (never the key), read by those marks. If you judge it too wide to do safely here,
say so and leave it.

Your sandbox has no network and no Postgres. Tests named `*-pg.test.ts`, `asset-route`,
`public-visibility-pg` and `feedback-route` need a database and are **mine to run**; say which ones
you want run and what you expect. Tests that need nothing outside the tree you can run yourself,
one file at a time, for example:

```
npx vitest run tests/share-key.test.ts
npx vitest run tests/public-dispatch.test.ts
npx vitest run tests/owner-isolation.test.ts
```

(If vitest refuses to start for lack of memory, that is the box, not the code: say so and carry on
by reading.)

## Evidence so far

- Server: 16 targeted files, 716 of 717 passed; the one failure was a route-count canary, since
  raised from 112 to 115 guards for the three new verbs.
- Browser half: 33 files, 731 tests passed, and a further 6 whole-app files, 228 passed. Typecheck
  green on all four projects at `01446fe4b`'s parent plus the browser half.
- **Not run: the full suite, `npm run check`, a build, a real browser.** The box is overloaded and
  full suites are barred today.
- The server tests were written alongside the code, not before it, so I mutated the finished code:
  the predicate ignoring the key, the export keeping the token, and feedback keeping the key. 17
  tests went red across `owner-isolation`, `share-link-pg`, `store-export-bundle`, `feedback-route`
  and `public-reads`, each mutation caught by at least one. The code is restored. Not mutated:
  *Turn off* leaving the token, the page handler, the empty-key guard, and anything in the browser
  half beyond what its builder did.

## How to report

Severity by consequence: **P0** data loss, exploitable security, wrong charging; **P1** user-visible
wrong behaviour or a contract violated; **P2** design or maintainability risk; **P3** prose. Mark
each finding **established** (a failing run, or an exact reachable source path) or **reasoned**.
Give every finding an ID, `C1`, `C2`, …. For each: what, where (file and line), how an attacker or
reader reaches it, and whether you fixed it (with the test that was red first). End with a verdict
on each of the twelve statements (accurate / not accurate / could not check), a list of the files
you changed, and the database tests you want me to run.

## My own suspicions, last, and worth less than your own pass

Spend most of the run elsewhere. These are only where I would look second:

- Whole-row reads of `articles` in `src/store/pg.ts`, `pg-revisions.ts`, `pg-shelf.ts` and
  `article-rows.ts` hold the token in memory; is any of them serialised to a response, a log line or
  the admin page? The static test pinning this uses a narrow regex.
- `publicBlocksQuery` takes no access value and reads by a revision id returned by a guarded
  query. Is there any path where that id is not the one just authorised?
- Anything that caches a public response or an asset at the edge or in the browser so that *Turn
  off* does not take effect on the next request.
- The key in a URL the app itself builds or sends somewhere: sign-in return (`/login?next=`),
  `og:url`, canonical links, analytics, client-side error reporting, `console` output.
- A signed-in non-owner holding a key: the client asks the owner route first, gets a 404, then asks
  the public route. Does anything along that path send the key with credentials?
- The audit table's CHECK `(event = 'created') = rights_confirmed`, and `on delete set null`.
