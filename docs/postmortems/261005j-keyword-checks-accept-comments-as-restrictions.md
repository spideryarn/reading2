# Keyword checks accept comments as restrictions

Up: [postmortems.md](../project/postmortems.md)

Found while reviewing the author-facing search-engine claims in
[link previews and SEO](../plans/261005f-link-previews-and-seo-for-shared-links.md).
This is a pre-existing deployment-check weakness, reported for a separate fix. The stage's copy
now describes only the response status and plain-text checks it can honestly promise.

[`verifyRobots`](../../scripts/deploy.ts:1539) checks `/disallow/i` against the whole response body.
It treats a comment mentioning a restriction as proof that a restriction exists. A control removed
both actual `Disallow:` directives from today's `public/robots.txt` in memory; the keyword test
still returned true because comments contained that word. A separate review agent confirmed the
cause and used read-only blame to identify its introduction: commit
`3b22e5b7d8aecc47d3670f09a23d4e99a09ae317`, 2026-08-27,
“Ship what is committed, and make the deployment prove it is that.”

The class is **semantic validation replaced by keyword presence**. The checker sees characters;
the crawler sees uncommented directives grouped by user agent. Those are different questions.

The long-term fix is to parse the rules and verify the restrictions in each intended group.
[`judgeRobotsTxt`](../../scripts/check-public-shell.ts) already does that for the expanded policy,
but deployment does not invoke it. That integration remains outside this stage; narrowing the
published sentence does not repair the deployment guard.

What would have caught the class, ranked by ease against value:

1. **Remove real directives while retaining comments.** Cheap, and the in-memory control exposed
   the false success. A regression test for a deployment fix should include this case.
2. **Reuse the existing directive parser in deployment verification.** More valuable than another
   keyword check, because it verifies the intended groups and allowances as well as presence.
3. **Use an anchored regex over uncommented lines.** A small immediate fix, but rejected as the
   final design: one restriction in the wrong group would still satisfy it. **Done the same day**,
   as `hasDisallowAll` in `scripts/deploy-checks.ts`, with the control above as its test. The
   second item is still the real fix and is still not built.
