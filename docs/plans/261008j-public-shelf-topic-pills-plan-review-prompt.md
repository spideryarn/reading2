# Plan review: topic pills on the public shelf, automatic, billed to the site

You are reviewing a PLAN (read-only). Nothing is built; the build waits for Greg because it edits listed security defences.

Read:
- docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md (the plan)
- docs/investigations/261008a-public-shelf-topic-rethink-cost.md and evals/shelf-topic-clusters/results/261008-public-shelf-cost.json and the script evals/shelf-topic-clusters/public-shelf-cost.ts (the cost evidence)
- docs/user-feedback/questions/q-deh67j.md (the question Greg answered; his reply is quoted in the plan)
- docs/project/security-map.md (especially the public listing and the /read/public page sections), docs/project/public-shelf.md, docs/project/shelf-terms.md § Topics a model names
- src/shelf-topic-sets.ts, src/store/pg-shelf-terms.ts, src/store/public-library.ts, src/public-library-types.ts, src/web/PublicLibraryPage.tsx, the visibility route in src/routes.ts (search "/visibility$"), src/owner.ts

Greg's bar: automatic regeneration billed to a site account if it costs half a cent or less and we are confident; otherwise an admin-only regenerate button. Use judgment.

Questions to answer:
1. Is the cost evidence sound and is the conclusion (automatic is within Greg's bar) honest? Anything the measurement misses (e.g. the eight-article minimum, failure retries, the widening pass, prompt-version bumps re-thinking the site tree, archive/delete not triggering)?
2. Is the design right? In particular: reusing shelf_topic_sets with a SITE_OWNER_ID auth user (FKs from ai_calls, shelf_topic_sets, rate_limit_events to auth.users); running under the site owner context inside the owner's PUT visibility request; the abuse bound; read-time cutting of memberships to listed cards; how the route gets article ids without putting them on the wire.
3. Is the list of defences edited complete and correct? Anything missed (e.g. the anonymous-region guard, the public import graph inventory, caching headers on /api/public/library, the ownerless enumeration count)?
4. Is there a simpler design that meets Greg's bar with fewer defence edits?
5. Anything wrong or misleading in what will be put to Greg?

The sandbox is read-only: do not try to write any file. Put the whole review in your final answer: P0/P1/P2 findings, each with evidence (file:line) and the concrete change you would make to the plan, then a one-line VERDICT at the end.
