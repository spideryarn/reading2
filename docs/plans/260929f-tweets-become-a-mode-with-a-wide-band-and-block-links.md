# Tweets become a mode, with a wide band and a link from each post to its passage

Status: **built**, on `dev` 2026-09-29, not deployed. Feedback SPIDERYARN-READING2-5A (report `spya-v6rjvy`).

> In the past, we'd set up the tweet thread mode as kind of its own page, but actually I'm realizing
> that it would work to have it as a normal mode with its own left-hand column alongside the text.
> So let's do that. So instead of it having its own page, it's just going to be a normal mode with a
> left-hand column. It could be quite a wide left-hand column if that will help to make it be
> readable. And let's also add block links for each tweet item to relevant place in the text for
> that tweet item, so that if I'm reading the tweet item, I can see where in the text it came from.
> And if you can see any other minor ways to improve the interface, feel free to, yeah, make small
> further improvements.
>
> — Greg, 2026-09-29, from `/read/<slug>/tweets`

## History

- [260825g](260825g-tweet-thread-page.md) built the thread as a page of its own at
  `/read/<slug>/tweets` (Greg, 2026-08-25: *"which also needs its own `/read/[slug]/tweets/` url"*).
- [260915e](260915e-tweets-page-starts-writing-when-opened.md) made that page write the thread on
  arrival (`useAutoRunOnArrival`), since a path, unlike `?mode=`, is intent.
- 260929b moved the standing "Write it again" into Metadata's *Re-run AI processing*.

This plan reverses the first decision on Greg's word: the page becomes a mode, `?mode=tweets`.

## What changes

### A. Each post names the passages it came from (prompt + schema — the hard-to-reverse part)

The stored thread has no block ids today: `Tweet` is `{ text, chars }`, and the prompt is sent
`articleText` — the article with ids deliberately stripped. There is no honest way to recover the
source afterwards (a lexical match of a paraphrase against paragraphs is a guess, and a guess drawn
as a link is the "confident claim with no path back" anti-goal wearing a link). So:

- **Prompt `tweets/5`**: send `articleWithIds` (evidence blocks only, as now), and ask for
  `{"tweets":[{"text":"…","blocks":["spya-…", …]}]}` — **one to three ids per post**, the passages
  the post is drawn from, in article order. The existing rules (voice, caveats, no numbering) stay.
- **`Tweet` gains `blocks?: BlockId[]`.** Absent = written before `tweets/5` (every thread stored
  today). Present = the ids that survived validation, possibly empty.
- **Validation, in `buildThread`**: keep an id only if it is one of the evidence blocks sent; dedupe;
  cap at 3; count what was dropped and log the count (never the text). **A post is never dropped
  for losing its ids** — the file's rule is that nothing the model wrote is silently removed; a
  post with no surviving id simply draws no link.
- **Tolerant parse**: an element that is a bare string (the old shape) is accepted as a post with
  `blocks: []`, so a model slipping back to the old shape costs links, not the thread.
- **Cache and fingerprint follow the renderer** — the FAQ/timeline precedent:
  `ARTICLE_RENDERER.tweets` becomes `"ids"` (tweets stops sharing a cached prefix with arc and
  glossary and starts sharing ideas/faq's; one write either way, since tweets runs alone on demand),
  and the thread's `sourceHash` and the step's `stamp` use `articleWithIdsFingerprint`, because the
  prompt now carries the URL line and the ids.
- **`isStale` becomes version-aware**: a thread whose version is before `tweets/5` is compared with
  `articleFingerprint`, as it was written; a newer one with `articleWithIdsFingerprint`. Without
  this every existing thread would suddenly announce *"describes an older version of the article"*,
  which is false. (The prompt bump itself marks them *outdated*, which by 260929c is not announced.)
- **Public DTO** carries `blocks` too — ids of a public article's own blocks, as every other public
  artefact already does.

**Existing threads get no links until rewritten.** The band says so in one muted line when *no* post
has `blocks` — *"Written before posts linked back to the text. Re-run Thread in Metadata to get the
links."* — with Metadata as a link. Not a banner, not a button: 260929b put re-runs in Metadata, and
260929c said an older prompt is not announced; this line is about a visible missing feature, not
about the prompt. (Simpler alternative passed over: say nothing. Rejected because Greg's own thread
would then show no links with no hint why.)

### B. Tweets is a mode with a wide band

Per [mode.md](../project/mode.md), both halves:

- `tweets` joins `MODES` and every total table: `MODE_LABEL` ("Tweets"), `OWNER_MODE_NOTE`,
  `MODE_CATALOG` (the `NOT_A_MODE.tweets` card moves here; aliases `thread`, `twitter`, `x`,
  `social`; `experimental: false`, as the page is today), `MODES_UI`, `POLICY`
  (`{kind:"artefact", key:"tweets"}`), `MODE_TARGET` (`fixed`, `tweets`), `modeBand()`,
  `MODE_CONTAINMENT` (`contained`, with `WITNESS` rows), `selectPassages` (`NO_FOUND`, the FAQ
  group), and the test tables `BAND_SAYS`, `SPENDS`, `DRAWS`, `GENERATES`, `ALWAYS_FREE`, `named`,
  the passages-it-marks list and `dock-mode-order`.
- **Band components** in `src/web/modes/tweets/TweetsMode.tsx`: `TweetsBand` (owner, uses a new
  `useTweets` hook) and `VisitorTweetsBand` (payload only), both drawing one `TweetsPanel` through
  `ModeSurface` with an `access` union. `useTweets` is Tweets.tsx's load/queue logic lifted out,
  shaped like `useFaq`: `useOrderedRead`, `useStepJob(slug,"tweets",…)`, and **`useAutoRun`** (the
  press rule) instead of `useAutoRunOnArrival`.
- **Wide band**: `BandShape` gains `"wide"`, used by Tweets: the band may grow to `WIDE_IDEAL`
  (34rem, 544px — a prose column's measure, since posts are set in the prose face) while the prose
  keeps `PROSE_MIN`; below that it shrinks exactly as the standard band does (`MODE_MIN` floor, then
  the covering band on a phone). One line in `bandWidth`, one in Reader's `bandShape`. At a
  1440px window that is ~544px against the standard 400px.
- **Per-post block links**: each post's foot draws `BlockRef` for each of its `blocks` (the one block
  link: real `<a href>`, left-click jumps and flashes the paragraph, hover card with the passage),
  beside `n/total`, the character count and Copy.
- **The old URL redirects**: `settleAddress` gains `liftLegacyTweets`, modelled on
  `liftLegacyAbout`: `/read/<slug>/tweets?…` → `/read/<slug>?…&mode=tweets`, replacing history.
  `tweets` leaves `ARTICLE_VIEWS`, `VIEW_SEGMENT`, `VIEW_LABEL` and `parseRoute`'s view pattern
  (after the lift, so an old link lands on the mode rather than not-found).
- **Removed**: the Tweets page (`Tweets` in Tweets.tsx's page chrome, `VisitorTweetsPage`), the
  Dock's loose `DockLink` and `NOT_A_MODE.tweets`, the command bar's Tweets *page* row (the mode row
  replaces it, `generates` from `modeGenerates`), the hand-added `SHARED_TWEETS` row in
  `shared-inventory.ts` (the mode sweep lists it now — else it double-lists), and
  `useAutoRunOnArrival` if it has no other caller. `VisitorPage`, `VisitorNotice` and `notBuiltGap`
  go if they lose their last caller.
- Tweets.tsx keeps its pure exports (`threadMarkdown`, `CopyButton` etc.) or they move with the
  panel; tests import from wherever they land.

### C. Small interface improvements (Greg's licence, kept small)

- The band has no title row repeating the mode name (mode.md rule); the head row is the counts
  line and *Copy the thread* — kept, as it is not the mode's name.
- Posts get a little more air in the wider band and drop the heavy card border for a hairline
  separator, so fifteen posts read as a list rather than fifteen boxes (the page's own "what this
  refuses to look like" said *a numbered list of short paragraphs*).
- The per-post number becomes the post's lead (`3/12` before the text, muted), so the reader can say
  which post they are on while reading down the column, rather than finding it in the footer.

Anything bigger is out of scope and goes in the debrief as a suggestion.

## Assumptions (Greg can overturn any of these)

1. **Bar position**: Tweets goes in the overview run, after Summary —
   `structure, summary, tweets, diagram`. A thread is a compressed retelling like Summary. Other
   sessions are reordering the bar today; I place it by the current order and merge `origin/dev`
   often.
2. **Not behind the experimental switch**, as the page was not.
3. ~~**Opening the mode writes the thread on a press, not on arrival**~~ — **reversed after review; see below.** The same rule as every other
   mode. So an old `/tweets` link, now a `?mode=tweets` address, shows the band's button rather than
   spending (the 260915e arrival behaviour goes, because `?mode=` is query state and `last-view`
   restores it). Pressing Tweets in the bar still writes it with no second click.
4. **1–3 ids per post.** More makes a row of chips nobody reads; one would miss a post that joins two
   passages.
5. **Wide = 34rem ideal.** Tunable in one constant after the browser check.

## Stages

1. **Artefact (A)**: `src/tweets.ts` prompt/parse/validate, `Tweet.blocks`, `ARTICLE_RENDERER`,
   fingerprint + stamp, version-aware `isStale`, DTO; unit tests for validation (unknown ids dropped,
   a post keeps its text when all ids go, bare-string element tolerated), `isStale` for an old and a
   new thread, the prompt pinned. Gates, GPT Sol code review, commit.
2. **Mode (B + C)**: the mode, the band, the wide shape, the redirect, the visitor band, the
   removals, every table and test the compiler and the suite name, docs (reading-view-overview line,
   the stale page descriptions listed by the inventory). Gates, GPT Sol code review, commit.
3. **Browser check** (Sonnet subagent, desktop and phone width) on a local article with a real
   `tweets/5` thread: the band, its width, the block links jumping and flashing, the old URL
   redirecting, the old-thread line. Feedback note in `docs/user-feedback/`, plan status, push to
   `dev`, remove the worktree.

## GPT Sol's plan review, and what changed

[260929f-tweets-become-a-mode-plan-review-sol.md](260929f-tweets-become-a-mode-plan-review-sol.md).
Verdict *revise before building*; all seven findings taken except the last:

1. **Postgres omitted the URL** the new fingerprint hashes — `loadTweets` and Metadata's check would
   have called every new thread stale. The tweets projection is now `CITED_FINGERPRINT_COLUMNS` and
   both read `citedMetaFingerprintOf`.
2. **Old threads: stale vs outdated made explicit.** Acceptance: an unmoved `tweets/4` thread reads
   `stale: false`; the pipeline stamp calls it not-done (prompt changed — outdated, unannounced); a
   `tweets/5` thread is current in both. The fingerprint family is keyed on the **parsed** version
   (`sentIds`: `tweets/10` ≥ 5), not on the posts carrying `blocks`.
3. **The redirect only ran at boot.** `liftedTweetsHref` is also applied in `navigate()` and in
   `useRoute` (Back/Forward onto the old path), and the lift runs before `liftLegacyAbout`, replacing
   any (encoded) `mode` key.
4. **Assumption 3 reversed: Tweets still writes on arrival.** Greg's 2026-09-12 *"when opened"* was
   not revoked by *"a normal mode"*, so `useTweets` keeps `useAutoRunOnArrival`, and `tweets` joins
   last-view's `NEEDS_AN_EXPLICIT_PRESS` so a shelf restore cannot spend. `MODE_TARGET.tweets` stays
   `fixed` (a press does lead to a call, and the command bar's `generates` reads it); its token is
   never claimed and waits harmlessly.
5. The unchecked residue is named in the stage 2 test sweep.
6. **The wide ideal is in rem** — `wideIdeal(rootFontPx)`, 34rem.
7. *Defer the wide band until 400px is shown cramped* — **not taken**: Greg invited it in so many
   words, and it is one branch in `bandWidth`. The browser check judges it.

Also found while building: `shared-inventory.ts` hand-added a Tweets row beside the `MODES` sweep,
which would have listed it twice; the row and `SHARED_TWEETS` are gone. Moving tweets to the `ids`
renderer took it out of arc's cache group, leaving arc with no same-group partner (tweets now shares
with ideas/faq); the cache-group tests were re-pointed. Stages 1 and 2 were built as one, with one
code review, since the redirect and the fingerprint had to land together.

The reading-view-overview rule *"arriving at one does not"* now has an exception (Tweets). That
sentence is a rule in an entry-point doc, so it is left for Greg to approve a wording; the Tweets
line under *The modes in the band* says it.

## As built: the code review and the browser check

- **GPT Sol's code review**
  ([260929f-tweets-become-a-mode-code-review-sol.md](260929f-tweets-become-a-mode-code-review-sol.md))
  fixed two must-fixes itself: the thread was not inside a scroller, and `navigate()` could keep a
  stale hash on an old link. Its hash fix compared the hash on *every* navigation; narrowed to lifted
  links only. Its two reported items (a surface-shape pin for the band; present-tense comments still
  naming the tweets page) were done in a follow-up commit.
- **A press arms nothing.** The first build left `MODE_TARGET.tweets` `fixed`, which minted a token
  no `useAutoRun` claims, and the sweep in `every-mode-draws-its-surface` counts an unclaimed token as
  a spend still owed. A fourth `ModeActivation` kind, `arrival`, says what is true: the band starts
  itself, a press arms nothing, and `modeGenerates` stays true.
- **Browser check** (Sonnet, Playwright, "Life is Short"; shots in [260929f-shots/](260929f-shots/)):
  the band measured 544px at 1440 and 1100px, the prose beside it at 544px, no sideways scroll; an
  old thread showed the Metadata line, and a re-run wrote six linked posts in ~13s; four of five
  first links landed on the matching paragraph (the fifth on a related one), each jump flashed the
  paragraph; the old address with `#hash` and with `?at=` landed on the mode.
- **Left for Greg:** on a phone the covering band hides the paragraph a link scrolls to. That is
  every band's behaviour (the covering design leaves the way back to the Dock — TermJump.tsx says so),
  so changing it is an app-wide product call, not this plan's. The browser agent also suggested
  larger passage chips than `BlockRef`'s six-character ids; that is the shared component, so also
  not here.

## Done looks like

`/read/<slug>?mode=tweets` shows the thread in a wide left band beside the prose; each post links to
its passages and a click jumps there and flashes it; `/read/<slug>/tweets` lands there; a visitor on a
public article sees the stored thread in the same band; `npm test` and `npm run typecheck` green.
