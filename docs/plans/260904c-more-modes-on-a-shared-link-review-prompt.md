# Review this plan before it is built

You are reviewing a plan for the Spideryarn codebase (repo root is the current directory). Read
`docs/plans/260904c-more-modes-on-a-shared-link.md` in full, then read the code and docs it cites.
Be specific and adversarial; check claims against the source rather than accepting them.

## Essential background, in this order

1. `docs/plans/260827ai-public-read-only-access.md` — the feature's own plan, especially its
   decisions table and § "What we are deliberately not doing".
2. `docs/project/security-map.md` — § "The unauthenticated namespace, and the tripwire under it"
   and § "The allowlist has two failure directions, and only one of them is loud".
3. `src/public/dto.ts`, `src/public/routes.ts`, `src/store/public-reader.ts`, `src/store/pg.ts`
   (§ `shareableArtefacts`), `src/web/visitor.ts`, `src/web/reader-capability.ts`,
   `src/web/shared-inventory.ts`, `src/messages.ts` (§ `ALWAYS_SHARED` / `NEVER_SHARED`).
4. `src/db/schema.ts` — the `comments`, `chat_threads`, `chat_messages` and `search_runs` tables.

## What the plan does

An owner can mark an article Public-readable; a signed-out visitor reads it through the single
route `GET /api/public/article/:slug`. Today they get the text, tree, arc, glossary, ideas, quotes
and tweet thread. The plan adds: timeline (a stored artefact), the free diagram picture, and
**read-only views of the owner's own comments, chat conversations and saved meaning-searches**.
A visitor still creates nothing and spends nothing.

## The questions I most want answered

1. **The architectural call.** The plan puts comments, chat transcripts and saved search runs into
   the single article payload rather than adding public routes per collection. Reason given: a
   second request reintroduces the four-state `PublicArtefactRead<T>` and the `availability-unknown`
   gap that slice 1b deliberately deleted. Counter-arguments the plan acknowledges: unbounded row
   counts, the 4.5 MB Vercel response cap, extra queries and latency on every public page load even
   for a visitor who never opens chat. **Is this the right call? If not, what is the cheapest shape
   that does not reintroduce the deleted states?** Note the plan's stated constraint: the user
   explicitly asked for the *simpler* version of anything that would otherwise be substantial.

2. **The allowlists.** Stages 3, 4 and 5 each list the columns that cross and the columns that do
   not. Go through `src/db/schema.ts` and tell me every column I have failed to classify, and every
   one I classified wrongly. In particular: should `chat_messages.passages`, `.stance`,
   `.tools`, `.citations` and `comments.answer`/`.citations` really cross? Is there anything in
   `hits` (`search_runs`) or `tools` that carries a URL, a model name, a cost or a reader's words
   that the plan has not noticed?

3. **The union surgery.** The plan adds `VisitorPolicy` member `owners-work` and `VisitorGap`
   member `none-yet`, and *deletes* `readers-own` because its only producer goes. Is that right, or
   is `readers-own` still the correct sentence for something? Are the three total records
   (`POLICY`, `FIXED_BY_AN_ACCOUNT`, `visitorSentence`) genuinely enough to make every omission a
   compile error?

4. **The retroactive exposure.** Deploying this publishes comments and chat on articles that are
   *already* marked public, whose owners agreed to an inventory that said comments were never
   shared. The plan flags it and asks the user whether anything beyond changed copy is needed.
   What would you do, and is there a cheap technical option (e.g. gating the wider inventory on a
   per-article re-confirmation) that is better than a notice?

5. **The diagram gating.** Stage 2 disables three hooks, pins `?diagram=` to `force`, and drops the
   paid chips. Read `src/web/DiagramPanel.tsx` and tell me whether there is a fourth way a visitor
   could cause a paid request, or a state where `force` draws wrongly without embeddings.

6. **What is missing entirely.** Which files, tests, docs or failure modes does the plan not
   mention that it should? Be concrete: name the file.

## What good looks like

Rank your findings: blocking, worth doing, and optional. For each, say what you checked and where.
If you think a stage should be cut or reordered, say so plainly. If the whole approach is wrong,
say that first.
