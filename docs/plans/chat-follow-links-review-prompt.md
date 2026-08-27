# Review this plan before it is built

You are reviewing a plan for the Spideryarn repo (an AI-assisted reading app, TypeScript + ESM,
React client, Node server on Vercel, OpenRouter as the model gateway). Read-only review: do not edit
files. Be concrete and rank findings by how much damage they would do.

## The plan

Read `docs/plans/chat-follow-links.md` in full. That is the thing under review.

The one-line summary: chat already has a `read_web_page` tool, but the model never sees any of the
article's hyperlinks (the prompt carries `block.text`, the hrefs are in `block.html`), so it has a
fetching tool and no addresses. The plan adds a seventh tool, `article_links(query?)`, that lists the
article's own links.

## Context you will need

- `src/chat-tools.ts` — the six existing tools, `runTool`, `describeCall`, `untrusted`, the caps,
  and `readWebPage` in particular. Its header states three rules a new tool has to obey.
- `src/converse.ts` — the tool loop, the system prompt, the per-turn deadline, the round cap, and
  the last round where tools are withheld.
- `src/article-prompt.ts` — `articleWithIds`, which is why the model cannot see an href today, and
  `cachedText`/`underCacheFloor`, which is what the "do not put hrefs in the prompt" argument turns
  on.
- `src/types.ts` — `Block` (note `html`), `Meta` (note optional `url`), `ToolRun`.
- `src/urls.ts` — `isWebUrl`, `hostOf`. No imports, deliberately.
- `src/blocks.ts` — how in-article anchors were rewritten to `#spya-…` at ingest, and what that
  did and did not repair.
- `src/web/ChatPanel.tsx` § `ToolStrip` and `ToolIcon` — where a tool row is drawn.
- `docs/project/chat-tools.md` — especially § Still open (the exfiltration channel and the
  proposed allowlist), § What is logged, and § The bug that shaped the literal search.
- `docs/project/links.md` — the hover-card feature over the same hyperlinks, including a measured
  table of what a browser can and cannot fetch, and what is deliberately not built.
- `docs/project/security.md` § Chat tools.
- `docs/reusable/silent-success.md` — the failure pattern this codebase cares most about.
- `tests/chat-tools.test.ts` — the style the new tests should match.

## What I most want you to attack

1. **Does this make the exfiltration channel worse?** `read_web_page` can already be argued into
   fetching an attacker's URL by an injected page; the query-length cap bounds the payload. Handing
   the model a clean inventory of this article's outbound links is new information in the
   conversation. Is there a shape where `article_links` makes an injection *easier* or more
   valuable, and is the plan wrong to treat it as neutral?
2. **The in-article anchor row.** Anchors are listed as `block spya-… , in this article` so the
   model does not fetch them. Is that enough to stop the model constructing
   `https://<article url>#spya-…` and fetching *that*? What should the row say instead? Note
   `src/blocks.ts` says a long-way-round self-link was deliberately not repaired at ingest, so a
   fully-qualified self-link with a fragment can exist in `block.html` as an ordinary external URL.
3. **Whether the tool descriptions will actually be obeyed.** The file's stated worst failure is not
   a broken tool but a model that calls three tools to answer a question the article already
   answered. Seven tools is one more surface for that. Is `article_links` likely to be called when
   it should not be, and what wording would prevent it? Should it be merged into an existing tool
   instead of standing alone?
4. **The parse.** One JSDOM, `innerHTML` set per block. Is that safe (script execution, resource
   loading, `<base>` in a block) and is it actually faster than the alternatives? jsdom's default is
   no script execution and no external resource loading — confirm that holds for `innerHTML`
   assignment, and say if there is a cheaper correct parse.
5. **Dedup, ordering and caps.** Keyed on href-plus-text, document order, 40 rows. On the noema
   article that is 71 links truncated to 40 with a stated total. Is 40 the right number, is document
   order the right order, and does the substring query argument have a failure the plan has missed?
6. **Anything the plan asserts without evidence**, and anything that will look obviously wrong in
   six months.

## What is not in scope

The allowlist for `read_web_page` (named as future work), semantic library search, and the
reasoning-block replay question — all recorded in `docs/project/chat-tools.md` § Still open.

## Output

Ranked findings, each with: what breaks, how, and the smallest change that fixes it. Say plainly if
you think the whole tool is the wrong shape. If you think the plan is right, say which parts you
checked rather than only that you agree.
