# Review the built Stage 3a — the ownerless public listing

The code review after building. **This is the security-sensitive stage of the job**, so weight it
accordingly: a hole here is a stranger reading somebody's private article.

Plan: `docs/plans/260904b-pricing-page-and-public-showcase.md`, § "What the review changed" items 3,
5 and 6, and § "Stage 3a". Your earlier reviews: `…-review-sol.md` (the plan),
`…-stage1-code-review-sol.md`, `…-stage2-code-review-sol.md` — all findings from those are fixed and
committed.

The scoped diff, with the four wholly new files appended in full, is at
`/tmp/claude-1000/-home-greg-code-spideryarn2/32ac35d1-d07c-4611-81e5-f1113e41b6a9/scratchpad/stage3a.diff`.

Read at least: `src/store/public-library.ts`, `src/public-library-types.ts`,
`src/store/public-slug.ts`, `src/public/route-names.ts`, `src/public/routes.ts`,
`src/public/page.ts`, `src/web/router.ts`, `src/web/public-api.ts`, `src/ingest.ts`,
`src/store/pg-revisions.ts` (`lockOrCreateArticle`), `tests/owner-isolation.test.ts`,
`tests/reserved-article-address.test.ts`, `tests/fixture-ids.test.ts`.

## What was built

A closed listing query in its own file, a slugless `/api/public/library` route added by turning
`PublicRouteName` into a discriminated union (`kind: "slug" | "collection"`), `/read/public` matched
before `/read/:slug` on both the client and the edge, a reservation of that name at
`lockOrCreateArticle`, and a new "ownerless enumeration" section in the owner-isolation guard.

The query:

```
select slug, public_at, title, <h1-fallback> as heading_title, root_gist, site_name, word_count
from articles inner join article_revisions on id = current_revision_id
where visibility = 'public' and tree is not null
  and exists (select 1 from revision_blocks where revision_id = …)
order by public_at desc nulls last, slug asc
limit $n            -- 200, fetched as LIMIT+1 so the answer carries `truncated`
```

There is deliberately **no exported "visibility is public" predicate** — the clause is inline in one
function, which is the difference the plan asked for between a closed query and a reusable one.

I verified the guard myself by injecting `eq(articles.ownerId, …)` into the query: five assertions
went red across the static, generated-SQL and real-database layers, and green again on restore.

## What I want you to attack

1. **Can anything reach a private article through this?** Read `public-library.ts` as an attacker.
   The readability bar, the join to `article_revisions` via `current_revision_id`, the `exists`
   subquery on `revision_blocks` — is any of it reachable in a state where `visibility` is not
   `'public'`, or where the revision joined is not the one whose blocks were counted? Is there a
   TOCTOU between the bar and what a reader then fetches by slug?
2. **The projection.** Seven named columns. `heading_title` is an `<h1>` fallback computed in SQL —
   does it draw from anything that could carry private prose? Is `root_gist` model-written text that
   was generated with knowledge of the owner's profile, and if so does publishing it in a *listing*
   differ from publishing it on the article page, which already does?
3. **The discriminated route union.** Does the closed room stay closed? Check that an unknown path
   or wrong method still terminates inside `/api/public/` and cannot fall through to the
   authenticated table; that the `never` arm is real; and that the three sweeps genuinely cover both
   kinds rather than appearing to. The agent claims the malformed-slug sweep would have handed back
   the same constant six times and looked like coverage — check that reasoning.
4. **The reservation of `public`.** It refuses at `lockOrCreateArticle` rather than in `isSlug`,
   because `isSlug` is asked on every read and refusing there would make an existing row holding the
   name unreadable and unrepairable. Is the chosen seam actually the only creation path? Consider
   `POST /api/jobs`'s adopted branch, uploads, retries, the CLI pipeline, and import. And do the
   client and the edge genuinely agree — one serving 404 where the other serves 200 is the failure
   shape.
5. **The new guard.** It is the thing standing between a future listing query and a leak. What can
   it not see? Specifically: does the import-graph walk actually cover the route's real reachable
   set; would it catch a *second* ownerless enumeration added elsewhere in `src/store/`; and does
   the generated-SQL assertion target the builder the route calls rather than a nearby one?
6. **`limit`/`truncated`.** 200 with no cursor. Is `truncated` honest, and is an unbounded-in-
   practice public endpoint a denial-of-service or cost concern given the namespace has no rate
   limit (Cluster C/S4 of `260902j` are still open)?
7. **Anything the tests do not cover, and any claim in the stage-3a plan text that is not true of
   the code.**

Known and deliberately outstanding, do not report as new: the sharing consent copy has not landed
(`src/messages.ts` was fenced while another session held it), so `SHARING_ON` still promises
reachability-by-link while the listing makes articles discoverable. `/read/public` parses to a route
kind that both the client and the edge answer 404 for today; stage 3b turns it on.

Rank by severity, be concrete, and run a test file yourself — a finding you reproduced outranks one
you reasoned to.
