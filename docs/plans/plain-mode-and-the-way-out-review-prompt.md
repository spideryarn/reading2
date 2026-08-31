# Review: Plain mode, the way out of a mode, and the way to the original

You are reviewing a **plan**, not built code. Be adversarial and concrete. For each finding, name
the file and the specific mechanism, say what input or sequence produces the wrong behaviour, and
say what the fix is. Rank by severity. Say plainly if something is fine — do not manufacture
findings.

The plan is `docs/plans/plain-mode-and-the-way-out.md` in this repo. **Read it first**, then read
the code it names. Everything below is context you will want while reading it.

## The repo

Spideryarn: an AI-assisted reading app. TypeScript + ESM, React client under `src/web/`, a Node
server in `src/routes.ts`, two interchangeable stores (filesystem for a laptop, Postgres/Supabase
for production, selected by `SPIDERYARN_STORE`). The reading view has three regions: a **spine**
(left rail), the **prose**, and between them a **band** that whichever "mode" is on takes over.
There are nine modes today (`src/modes.ts`); `hierarchy` is the default and is the one with no band
— it shows the granularity-zoom gist columns, which is the feature the whole app exists for.

`AGENTS.md` / `CLAUDE.md` at the root has the working rules. The ones that bear on this review:

- **A check you have never seen fail is not evidence.** The commonest bug class here is something
  reporting success while doing nothing, with the obvious check agreeing because it shares an
  assumption with the code (`docs/reusable/silent-success.md`).
- **View state lives in the URL**, not `useState` or `localStorage` (`docs/project/url-state.md`).
- Text is addressed by stable block id, never by offset (`docs/project/block-ids.md`).
- Every doc under `docs/project/` has exactly one owner doc, enforced by `tests/doc-links.test.ts`.

## What Greg asked for, and what he decided

Quoted in full at the top of the plan. His four decisions: the mode is called **Plain**; **Plain
becomes the default**; the controls bar's exit becomes an **× icon**; and the broken
`GET /api/source/:slug` gets **fixed rather than worked around**.

## The specific questions

1. **`bandOpen` vs `inMode`.** The plan keeps `inMode = mode !== "hierarchy"` (it drives the
   granularity pills and forces the prose on) and adds `bandOpen = inMode && mode !== "plain"` (it
   drives `fitView({modeBand})` and which panel renders). Read `src/web/App.tsx` around lines
   1160–1260 and 2230–2400, and `src/web/layout.ts` (`fitView`, `fitMode`, `proseVisible`). Is
   there any *third* consumer of `inMode` that wants `bandOpen` instead, or vice versa? Note the
   history: `proseVisible` exists because that exact rule was silently two rules and produced an
   empty table beside a chat panel. Is the pair genuinely two questions, or is this the same mistake
   in a new shape?

2. **Plain via `chosen: []`.** The plan does not touch `layout.ts` at all: Plain is
   `fitView({modeBand: false, chosen: [], showText: true})`. Read `fitView`'s non-mode arm. Does
   `chosen: []` really produce spine + prose and nothing else, or does the "honour a manual choice
   exactly" path do something else with an empty array? What happens to `?cols=` a reader had set
   before entering Plain — does it survive the trip, and should it? What does the `fit`/`auto`
   affordance in the controls bar (App.tsx ~1912) say in Plain mode, and is that honest?

3. **Moving `DEFAULT_MODE`.** Read `src/web/params.ts` § `modeParam`, `src/modes.ts`,
   `src/web/Dock.tsx` § `withMode`, `src/title-text.ts`, `src/web/page-title.ts` and
   `src/vercel.ts` § `readMode`. The plan claims the only regression is that legacy `?mode=toc`
   links stop landing on the hierarchy, fixed by an explicit alias. **Find the ones it missed.**
   Specifically: does anything else depend on `DEFAULT_MODE` being the mode with the gist columns —
   the shared-link `<title>` composed by the serverless function, `withMode`'s omit-the-default
   rule, `carriedSearch`, the Dock's off-reading-view link arm, `tests/page-head.test.ts`,
   `tests/public-read-rewrite.test.ts`? Is an alias map the right shape, or should `toc` simply
   become a real (hidden) member of `MODES`?

4. **`visitorGap` and `markedModes`.** `src/web/visitor.ts` is deliberately fail-closed: a mode not
   named in it is owners-only, and the last mode that assumed otherwise shipped dimmed for every
   visitor while its plan claimed it was free. Plain reaches no artefact at all. Is `return null`
   for `plain` right, and is there anywhere else a new mode has to be named by hand that the plan
   has not listed? Sweep for it rather than trusting the plan's list.

5. **The bar-hiding rule.** The plan adds `:not(:has(.mode-band))` to the
   `:root[data-bars="hidden"]` block in `src/web/styles.css` § a small device, so the top and bottom
   bars stay put while a mode band is open. Read that block, `watchBarVisibility` in
   `src/web/scroll.ts`, and the `:focus-within` guard nearby. Does the selector actually match (the
   band is a deep descendant; `:root:has(.install-hint)` is precedent)? Does it break the
   `--bar-bottom` / `--dock-bottom` contract that four other elements read? Is there a state where
   the bars now stay hidden *and* the band is open, or flicker as the band mounts?

6. **The × and where it lands.** It navigates to `DEFAULT_MODE`, which after change 3 is Plain. Is
   "close the band" → "go to Plain" the right semantics, given the reader may have arrived from
   Hierarchy and will lose their gist columns from view? The plan rejects remembering the previous
   band-less mode in a ref. Argue the other side if you think it is wrong.

7. **The source icon.** Read `src/web/Masthead.tsx` (§ `SeeTheOriginal`), `src/web/SourceLink.tsx`,
   and `src/web/PublicChrome.tsx`. The plan puts an `ExternalLink` (for `meta.url`) or a
   `SourceLink` (owner-only, for an uploaded PDF) in the sticky `.controls` bar. Does adding an
   element to that bar have consequences — it is measured by `stickyOffset()` in
   `src/web/scroll.ts`, and every deep link and arrow jump lands relative to it. Is the owner gate
   (`onRenamed !== undefined` as the stand-in for "is this mine") reachable in `App.tsx` at that
   point, or does it need `reader-capability.ts`? Is `meta.url` safe to render as an `href` — where
   does it come from and is it sanitised (`javascript:` etc.)?

8. **The `sendSource` fix (§ 5 of the plan) — the most important question.** Read
   `src/routes.ts` § `sendSource`, `src/store/pg.ts` (§ `REVISION_READ_POLICY` and
   `REVISION_PROJECTIONS`), `src/store/artifacts-pg.ts` (§ `readRaw`, `sourceRowFor`),
   `src/store/blobs.ts`, `src/store/blobs-supabase.ts`, `src/source.ts` (§ `canonicalKey`), and
   `src/store/contracts.ts`.
   - Is a new `source` revision reader the right seam, or is there an existing read that already
     carries these columns and should be extended instead?
   - `canonicalKey(storedSha256, kind)` — is `storedSha256` (`raw_source_sha256`) reliably the key
     the bytes are under, for **both** acquisition paths (an uploaded PDF promoted from staging in
     `src/pipeline.ts` ~line 990, and a fetched document via `writeRaw`/`storeRawSource`)? Is it
     ever equal-but-for-the-wrong-reason to `Meta.rawSha256`, such that a future change would
     diverge them silently?
   - The plan's legacy fallback (no `storedSha256` → read the filesystem) — is that a trap? Under
     what conditions does a production request take it, and what does the reader see?
   - **Authorisation.** The route currently does `await shelfStore.read(slug)` purely as an
     ownership question and discards the answer; it was authenticated-but-not-authorised until
     2026-08-27. Does routing the bytes through a content-addressed blob store reintroduce anything
     — e.g. can a caller who owns article A cause bytes belonging to article B to be served, given
     the key is a hash and objects are deduplicated across readers?
   - What should the response be when the blob store is up but the object is missing, versus when
     the blob store itself fails? The plan says 404 and 5xx respectively. Is that right, and does
     the current error plumbing in `routes.ts` actually produce it?

9. **Anything the plan does not mention at all.** Tests that sweep `MODES` and will now fail or,
   worse, silently pass; docs under `docs/project/` that this makes untrue
   (`reading-view-overview.md`, `url-state.md`, `keyboard.md`, `touch.md`, `page-titles.md`); the
   keyboard `nextModeIndex` walk in `Dock.tsx`; `chat-handoff.ts`; the `?text=` and `?spine=`
   interactions with a mode that has no band but also no columns.

## What a good answer looks like

Severity-ranked findings, each with the file, the mechanism, the failure sequence, and the fix. If
the plan is right about something, say so in one line rather than restating it. If you think the
whole shape of a change is wrong, say that first and argue it.
