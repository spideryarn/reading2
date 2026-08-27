# Review the built code, not the plan

You are reviewing code in the Spideryarn repo (AI-assisted reading app, TypeScript + ESM, React
client, Node server on Vercel, OpenRouter as the model gateway). Read-only: do not edit files. Be
concrete, rank by damage, and say plainly when something is fine.

**Weight this pass higher than a plan review.** You already reviewed the plan
(`docs/plans/chat-follow-links-review-sol.md`) and every one of your eight findings was acted on.
What a plan review structurally cannot catch is what the code actually does — an off-by-one in a
budget loop, a guard that reads well and does not hold, a test that would pass against the bug.

## What was built

A seventh chat tool, `article_links`, plus a new refusal inside `read_web_page`.

Read in this order:

1. `docs/plans/chat-follow-links.md` — the plan as it now stands, rewritten after your review. Its
   § "Two halves to the anchor rule", § "The trust boundary" and § "The query argument" are where
   your findings landed.
2. The scoped diff of `src/chat-tools.ts`, `src/web/ChatPanel.tsx` and `tests/chat-tools.test.ts`,
   supplied alongside this prompt at review time (`git diff -- <those three>`). Those three files are
   the whole of the change.
3. `src/chat-tools.ts` in full, as it now is on disk.
4. `docs/project/chat-tools.md` § "The links the prompt does not carry", § Security, § What is
   logged — the doc as updated.

## What changed in response to each of your eight findings

So you can check the fix rather than re-derive the problem:

1. **Injection surface.** Rows are now wrapped in `untrusted("article links", …)`; the heading and
   the tool's own instructions stay *outside* the fence; a sentence names the publisher as the author
   of what is inside; the tool description no longer says "then read_web_page it" and instead says
   listing a link is not a reason to fetch it.
2. **Row count is not an output cap.** Added `LINKS_CHARS = 4_000`, enforced in the row loop
   alongside `MAX_LINKS`, breaking only between whole rows. A URL longer than `MAX_URL_CHARS` is
   named, not printed.
3. **Anchors need enforcement.** `readWebPage` now refuses when
   `urlKey(url) === urlKey(ctx.meta.url)`. `articleLinks` also classifies a fully-qualified
   same-article URL as internal by the same key, and resolves its fragment. `decodeURIComponent` is
   wrapped in `fragmentOf`.
4. **Dedup lost locations; query too narrow.** `ArticleLink.blockId` became `blockIds: string[]`,
   collecting every block a link appears in. The query now matches block ids too, and runs a second
   pass with non-alphanumerics stripped from both sides so `washington post` finds
   `washingtonpost.com`.
5. **Description invites overuse.** Rewritten close to your suggested wording.
6. **The corpus numbers were a grep.** Re-measured by running the extractor: 61 distinct for noema,
   not 71. Your `data-note` explanation was verified independently (10 such occurrences) and is now
   in the plan and in a test.
7. **jsdom.** Switched to an inert `<template>` and `template.content`; hrefs read via
   `getAttribute`, never `a.href`; the performance claim in the comment was corrected to say it
   avoids 141 jsdom *documents*, not 141 parses.
8. **Checks that cannot fail.** Every new guard was switched off in turn and the suite watched go
   red, then switched back — seven mutations, each producing at least one failure. The browser pass
   now reads the actual SVG rather than asserting an icon exists, and includes two negative prompts.

## What I most want you to attack

1. **The budget loop in `readArticleLinks`.** Walk it. Is the accounting right, can it emit zero rows
   when it should emit one, does `shown.length > 0` do what it looks like, and does the "partial"
   sentence tell the truth in every path — including when the *character* cap rather than the row cap
   is what stopped it? Is `LINKS_CHARS * 2` in the test a meaningful bound or a tautology?
2. **`urlKey` as the same-article test.** Read `urlKey` and `normaliseUrl` in `src/ingest.ts`. Does
   the refusal hold for every shape a model could construct — protocol-relative, an added trailing
   slash, a different case host, an added `?utm_*`, an added port, `http` against `https`? And does
   it ever *over*-refuse: is there a genuinely different page it would call the same article?
3. **`articleLinks` correctness.** The dedup key mixes a URL and a `#targetBlockId`; can two
   genuinely different links collide on it? Does `blockIds` order match document order in every case?
   Is the `template.innerHTML` reset per block actually clearing state? What does `textContent` do
   with nested markup we might not want (a footnote superscript inside the link text)?
4. **Whether the fence is placed correctly.** The delimiter escaping in `untrusted()` — can a link's
   *text* still break out, given it is clipped at 80 characters and whitespace-collapsed first?
5. **The tests.** Which of them would still pass against a plausible bug? I care more about a test
   that cannot fail than about a missing test. Point at any assertion that is checking the test's own
   fixture rather than the code.
6. **Anything in the diff that is worse than what it replaced**, and anything the doc now claims that
   the code does not do.

## Not in scope

The `read_web_page` allowlist (deferred, with its own entry in
`docs/project/chat-tools.md` § Still open), semantic library search, and reasoning-block replay.
Also: `npm test` currently has 14 failing files across the repo from another agent's in-flight edit
to `src/ai-call.ts` (`response.headers.get` on a stubbed fetch). That is not this change; ignore it.

## Output

Ranked findings: what breaks, how, and the smallest fix. If a section is sound, say which parts you
actually checked.
