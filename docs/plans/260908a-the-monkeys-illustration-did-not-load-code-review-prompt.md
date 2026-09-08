# Review the built code

> **Kept as sent, and it describes code that no longer exists.** The answer
> ([-code-review-sol.md](260908a-the-monkeys-illustration-did-not-load-code-review-sol.md)) refused to
> sign off point 3 below: keeping the publisher's `srcset` was the same bug one level down, because a
> `srcset` with `w` descriptors removes `src` from the candidate set rather than ranking above it.
> `unverified` now keeps the `src` alone. The plan § *And `srcset` had to go too* has the measurement.

Second review of the work in `docs/plans/260908a-the-monkeys-illustration-did-not-load.md`. You
reviewed the plan; this is the code that came out of it, and this review is weighted higher than the
first because a plan-stage review cannot see what was actually written.

The scoped diff is in `code-diff.txt` in this worktree (`src/web/rehost.ts` and
`tests/rehost.test.ts`). Read the whole of `src/web/rehost.ts`, not just the diff.

## What changed and why

**Your finding 1 was taken.** You pointed out that we can hold a stored copy and still fail to
deliver it: `imageSources` absorbs the individual failure, the second draw rebuilds from the original
publisher markup, and that restores the poisoned `<source>` — the same blank figure, permanently.

The fix is a third `ImagePlacement` case, `unverified`:

- `rehostImages`' second-draw callback returns `UNVERIFIED` instead of `null` when the URL was in
  `wanted.images` (i.e. we meant to serve it) but `got` has no blob for it.
- `swapImages` handles `unverified` by dropping only the `<source>` elements and leaving `src`,
  `srcset` and `sizes` exactly as the publisher wrote them.
- `dropSources` is factored out and returns whether it removed anything, so `unverified` marks the
  block `changed` only when there really was a `<picture>` — preserving `rebuild`'s promise that an
  article nothing happened to comes back as the very same block objects.

I did **not** take your preferred fix — the `error`-driven fallback on the injected `<img>` — and the
plan says why: it is imperative DOM state on elements React re-renders from `block.html`, which is the
hazard stage E was restructured to avoid. It is written up as the right answer for the remaining case
(an image we hold *no* copy of), needing its own plan. Tell me if you think that reasoning is wrong.

Your other corrections were applied to the plan: ORB rather than a decode refusal (re-measured —
`net::ERR_BLOCKED_BY_ORB`), the "38 minutes" timing, "alongside" not "instead of", `budget`/
`out-of-time` as reasons on a `failed` entry, all three figures' AVIFs checked rather than inferred,
and the AVIF option restated as needing candidate selection rather than magic bytes alone.

## What I want from you

1. **Is `unverified` correct, and is it correct on every path?** Consider in particular: the first
   draw (`WAITING`) is unchanged and still strips everything — is that still right? Does `unverified`
   interact badly with `rehostBlockHtml`'s other callers, with the `&amp;` URL-keying rule, with the
   dedupe of one image used twice, with PDF figures in the same block, or with the public/visitor
   footing? Can it fire when it should not, or fail to fire when it should?

2. **Does it keep the invariants the file states about itself?** Especially: not one character of
   rendered text moves; the same block object comes back when nothing changed; and the removals that
   "close the leak" cannot drift apart between branches.

3. **Is the trade right?** On a delivery failure we now hand the reader the publisher's `src` +
   `srcset` without their `<source>`, which loses them an AVIF/WebP and costs bytes. Is there a case
   where that is worse than the blank box it replaces?

4. **The tests.** Two are new. Are they testing the thing, or are they theatre? Would either pass with
   the guard removed? (I checked the `<source>` guard by deleting it and watching both go red, but
   check my reasoning rather than my report.)

5. Anything else wrong, in the code or in the plan as it now stands.

## Ground rules

- Read the repo and check each claim yourself; do not take this prompt's description as accurate.
- `npm test` and `npm run typecheck` are being run separately; you do not need to run them, and the
  box is under heavy load, so please do not.
- Answer in prose, most important first. Say plainly if you would not sign this off.
