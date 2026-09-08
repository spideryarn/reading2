# Review this plan before it is built

You are reviewing a plan doc in the Spideryarn repo (an AI-assisted reading app). Read it at
`docs/plans/260908a-the-monkeys-illustration-did-not-load.md` in this worktree.

## What the plan is

A reader (an admin) reported "The illustration of the smoking & drinking monkeys doesn't load/show".
The plan is the diagnosis, plus a decision **not** to build a code fix because the fix already
shipped, plus two named remainders left for the human owner.

## What I want from you

Be adversarial about the **conclusion**, not just the prose. In rough order of what would change what
happens next:

1. **Is the diagnosis actually established, or does it merely fit?** The claim is: the publisher
   (`asteriskmag.com`) serves its AVIF `<source>` variants as `content-type: text/plain` with
   `x-content-type-options: nosniff`, Chrome refuses them, and `<picture>` gives no fallback to the
   `<img>` beneath. Is that mechanism right about how browsers behave? Is there a cheaper explanation
   the evidence also fits that I have talked myself past? The evidence I have is in the plan: the
   production runtime log timeline, the deployed commit at the time, the code at that commit, the
   curl headers, and a local re-ingest that reproduces the markup and the manifest hashes.

2. **Is "already fixed, ship nothing" the right call?** Push on it. The brief I was given said: it is
   a bug from an admin, so once you know what is wrong you *build* the fix rather than debating
   whether it is worth doing. I concluded there was nothing left to build that was not a product
   trade. Say if you think that is a dodge, and name what you would have built.

3. **The two deferred items.** (a) we store the publisher's 300px thumbnail and delete the 600–1920px
   candidates, so the reading view's enlarge gesture has nothing to enlarge; (b) an image we hold no
   copy of, inside a `<picture>` with a poisoned `<source>`, is still blank with no fallback. Are
   these correctly characterised? Is either one actually cheap enough that deferring it is wrong? Is
   there a third remainder I have missed?

4. **Anything factually wrong**, especially numbers, file references and claims about what the code
   does. Check them against the repo rather than taking them from the plan.

## Ground rules

- Read the repo. Files worth opening: `src/web/rehost.ts` (`rehostImages`, `swapImages`,
  `assetsToDraw`), `src/assets.ts` (`imageSourcesIn`, `imageSourceOf`, `sniffImage`, `assetIndex`),
  `src/collect-assets.ts` (`imageUrlsIn`, `collectAssets`, the limits), `src/web/article/access.ts`
  (`resolveAccess`), `docs/project/article-images.md`,
  `docs/plans/260829b-hosting-the-articles-images.md` and its `-review-sol.md`.
- `git show 84521f3b:src/web/rehost.ts` is the code as production ran it at the time of the report.
- Check each claim yourself; do not assume the plan is right about the code.
- Answer in prose, findings first, most important first. Say plainly if you would not sign this off.
