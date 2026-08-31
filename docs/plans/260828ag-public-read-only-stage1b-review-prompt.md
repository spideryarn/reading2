# Review request: the client half of public read-only access

You are reviewing **code that has just been written**, not a plan. Weight this higher than a
plan-stage review: a plan review cannot find a hook that mounts on a path nobody expected.

Spideryarn is TypeScript + ESM, React on the client, Drizzle ORM over Supabase Postgres, on Vercel.
You have already given design input on this feature and reviewed its **server** half, and both were
adopted. This is the other half.

## Read, in this order

1. `docs/plans/260827ai-public-read-only-access.md` — the plan. Greg's eight decisions are settled.
2. `docs/plans/260828h-public-read-only-stage1-input-sol.md` — your own design input. **Answer 8 is about
   this code**: you predicted the capability seam would take three times as long as it looks, because
   a hook cannot be skipped conditionally inside one component. Judge whether what was built
   discharges that.
3. `docs/plans/260828t-public-read-only-stage1a-review-sol.md` — your review of the server half.
4. `docs/reusable/silent-success.md` — the house rule, and note its fourth corollary was written
   today out of this work.
5. `src/public-types.ts` — the wire contract the client is held to.

## The scope under review

The client half of slice 1a, at HEAD. Review these files:

```
src/web/App.tsx  src/web/AccessSharing.tsx  src/web/PublicChrome.tsx  src/web/PublicPages.tsx
src/web/public-api.ts  src/web/reader-capability.ts  src/web/visitor.ts  src/web/Dock.tsx
src/web/Masthead.tsx  src/web/Metadata.tsx  src/messages.ts
tests/public-network-trace.test.tsx  tests/public-client-fetch.test.ts  tests/access-sharing.test.tsx
tests/visitor-gaps.test.ts  tests/metadata-sharing-card.test.tsx  tests/client-imports.test.ts
```

**Out of scope and not findings:** the server half (already reviewed and fixed); public endpoints for
glossary, summaries, ideas and tweets, which are slice 1b; link previews, `X-Robots-Tag`, canonical
tags, caching beyond `no-store`; and the known mobile-masthead limitation below 900px, which is a
pre-existing design constraint and Greg's decision.

## What I want from you

Numbered findings, each with a severity — **blocker / should-fix / consider** — and a concrete
change. Cite file and line. If it is wrong in its bones, say so first and plainly.

Push hardest on these:

1. **Is the capability seam real, or a convention?** The claim is that public mode means `useComments`,
   `useChatAnchors`, `useGlossaryRead`, every `useJobs` consumer, the record-open POST and the
   annotation component are **never mounted**, not mounted-and-disabled. Find any path — a route, a
   URL parameter, a re-render, an error boundary, a suspense fallback — where a private hook can
   mount for a visitor. The discriminated union's visitor arm is said to have no `comments` field at
   all; check that is true and that nothing reads around it.

2. **Can a visitor cause any request outside `/api/public/`, or any POST?** The acceptance test is a
   network trace. Tell me what that trace cannot see — a request issued after the assertion, from a
   timer, from an event handler, from a retry, or by a component only reachable through a state the
   test never enters.

3. **The tests: which would pass against broken code?** This is what I care about most. For each,
   name the mutation to the source it would **not** catch. Two were already found this way today —
   a control that mounted the wrong state because a default parameter swallowed `undefined`, and a
   heading fix that had no test until the author went looking.

4. **The four visitor sentences.** Are they genuinely four states, or does one collapse into another
   under some real condition? Is any of them reachable when it is false — e.g. "nobody has built one"
   shown for something that exists but is not carried?

5. **The sharing card.** It writes visibility. What happens on a failed write, a slow write, a
   double-click, a stale prop, a 501 from the filesystem store, a 404 mid-session? The rule it must
   never break: a check that failed is drawn as *"we could not check"*, never as *"not shared"* —
   being confidently wrong there publishes somebody's article.

6. **Anything the plan, my briefs, or the browser pass missed.**

## The state of the tree, measured

- `npm run typecheck`: clean across all three projects, 577 files.
- `npm test`: 4800 of 4801 pass; the one failure is another lane's fixture leaking between suites and
  passes in isolation.
- A browser pass found four silent gaps, all now fixed; its findings are in the plan under
  § The browser pass.
- Several other agents have uncommitted work in this tree. Anything outside the file list is not this
  review's business.
