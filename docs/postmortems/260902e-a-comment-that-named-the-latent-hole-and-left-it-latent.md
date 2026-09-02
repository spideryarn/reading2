# A comment that named the latent hole, and left it latent

`PATCH /api/chat/:slug/:threadId` answered a body of bare JSON `null` with a **500**. Renaming a
chat thread destructured `readBody`'s result without first checking it was an object; `null` is a
valid JSON body, destructuring it throws a `TypeError`, and the generic handler turns that into a
server fault.

A malformed request reported as "this app is broken" is the one thing validation must never do. It
is also the shape a client bug takes, so it would have arrived in Sentry as our fault and been
debugged as one.

## The class

**Prose that names a defect in the places it has *not* been fixed, and is then the only thing
enforcing itself** — [written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md).

A near relative of the class that dominates this repo's postmortems, but with its own sting: this
was not an unknown hole. Somebody found it, fixed the route in front of them, wrote down in the
route beside it that the same hole was latent elsewhere, and shipped. The sentence was correct on
the day it was written and every day after, and being correct is exactly why nothing happened: a
comment that accurately describes a bug looks like a bug that has been dealt with.

## The real cause

Two commits, six days apart, neither wrong on its own:

- `bf5a91e`, 2026-08-25 — added the chat rename route with the unguarded destructure.
- `e3b0e31`, 2026-08-27 — fixed the same shape on the search PATCH after a GPT Sol review, and left
  the comment: *"the same hole is latent in the other PATCH routes here."*

The second commit is where the defect became known and stayed unfixed. Its author had the whole
genre in front of them — the routes are within forty lines of each other — and fixed one member of
it. The criterion PATCH later copied the guard, and `patchShelf` and `patchReader` each grew their
own; the chat route never did.

**Grepping the genre gives a different shape from the one the comment described.** It is not "a hole
in the other PATCH routes". Of seven PATCH routes: four carried a hand-written copy of the identical
four-line check, one needed it and had none, and two use `fields()`, which coerces a non-object to
`{}` and is deliberately a different contract. So the tree held one live 500 *and* a four-way
duplication of the fix — and the comment's own wording, by describing a hole rather than a missing
shared guard, pointed at the smaller of the two problems.

Found on 2026-09-02 by GPT Sol reviewing an unrelated rework plan, not by any check.

## The fix that is right for the long term

One `objectBody()` in `src/routes.ts`, beside `fields()`, throwing 400. All five sites use it. It
sits next to `fields` on purpose: the two are the same test with different answers, and the choice
between them — coerce, or refuse — is the thing a route author actually has to make.

Landed in `3fe721c`, red test first: `null` gave 500, while `[]`, `"3"` and `7` already gave 400, so
the test states the class and one member of it was failing.

## What would have caught the class

Ranked by ease × value.

1. **Cheap, high value — a route test for the malformed-body class, once, over every route that
   takes a body.** The search PATCH had exactly this test (`routes.test.ts`) and it protected
   precisely one route. A table-driven case that sends `null`, `[]`, `"3"` and `7` to every
   body-taking route and requires 4xx would have caught this the day it was written, and catches the
   next one for free. **This is the recommendation worth acting on** — the guard is now shared, but
   nothing stops a new route destructuring `readBody` directly.
2. **Cheap, medium value — a lint or AST gate on `(await readBody(req)) as` and direct destructuring
   of `readBody`.** The repo already has AST gates for the spend ledger, so the machinery exists.
   Narrower than (1) and easier to satisfy without fixing anything, but it fails at the exact line.
3. **Free, medium value — when a fix comes with a comment saying the same bug exists elsewhere,
   that sentence is a work item, not documentation.** Either fix the others in the same commit or
   open something that can go stale loudly. A comment cannot.
4. **Moderate, medium value — make the type refuse it.** `readBody` returns `unknown`; if it
   returned a `JsonValue` union, destructuring without narrowing would not compile. Larger blast
   radius, 24 call sites, and worth considering only if this recurs.

The general lesson, which is (3) restated and is why this file exists: **the moment you write "the
same problem exists over there", you have done the hard part — finding it — and stopped one step
short.** Grep the genre and finish, or accept that the sentence is the whole fix and it will not
hold.
