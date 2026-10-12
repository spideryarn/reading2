# Search: one *meaning* matcher, quick first and then thorough

Report `spya-sy4rn0` (SPIDERYARN-READING2-HW), an admin suggestion, queue item `qi-247szfem`.
Up: [search.md](../project/search.md)

> In search mode, it looks like we have something that checks for exact string match, and then a
> quick mode, and then a meaning mode, which is effectively the thorough version of quick. Let's
> collapse those latter two so that really you just have the string matching version and then the
> meaning version. And let's, as an experiment for the meaning version, maybe it does a quick
> version asap and then replaces it with a thorough version as soon after as it can.
>
> — Greg, 2026-10-12

## What is there now

Search's matcher toggle has three buttons: **words · quick · meaning**.

- *quick* searches as you pause typing (Jev, about a second), keeps one saved row per typing
  session, and since 2026-10-04 starts the thorough (meaning) search for the same words by itself
  once the quick answer has settled, then swaps it in for the quick row
  ([search.md § A quick search starts the thorough one by itself](../project/search.md#a-quick-search-starts-the-thorough-one-by-itself),
  [`auto-thorough.ts`](../../src/web/modes/search/auto-thorough.ts)).
- *meaning* is the manual thorough search: nothing until **find**, then one model call.

So the second half of Greg's ask, "a quick version asap and then replace it with a thorough version",
is already what *quick* does. What is left is the toggle.

## The change

**Two buttons, words · meaning, and *meaning* is what *quick* was.** In the code:

- `MATCHERS` becomes `["words", "meaning"]` ([`params.ts`](../../src/web/params.ts)). The parser
  still accepts `quick` and reads it as `meaning`, so an old pasted link, bookmark, browser history
  entry or chat card's *Open in Search* link (`search-hrefs.ts`, now written as `match=meaning`)
  keeps working. (The remembered last view never replays search parameters — they are in
  `NEVER_REMEMBERED` — so it needs nothing.) Nothing rewrites the URL; the next matcher write
  writes `meaning`.
- **The bar's handoff** (`useBarHandoff` in `SearchMode.tsx`: the bottom bar's quick-search box,
  ⚡, `/`, and the command bar's *Quick search “X”* row) registers with, and switches to, `meaning`.
  One behaviour changes with it: a handoff into a band already open on meaning used to push
  `match=quick`, so Back returned to the meaning view; now there is nothing to switch, so nothing
  is pushed. From words it still pushes; into a band that just mounted it still replaces.
- **The box's ask-without-a-session path stays, as a fallback.** In production the owner always
  passes the typing session, so Enter and *find* flush into it; the path that calls `onAsk`
  directly is reached only by a panel with no session (the panel tests), and it now asks `quick`,
  never `meaning`. Making `typing` required would remove it, at the cost of rewriting every panel
  test's owner; not worth it in this change. The `sourceId` arm of `onAsk` is the row's
  *thorough* button and is unchanged.
- The matcher no longer equals the run's kind. A helper, `kindFor(matcher)`, says the meaning
  matcher asks a `quick` run; every `matcher === "quick"` in `SearchPanel.tsx` and
  `SearchMode.tsx` becomes `matcher === "meaning"`.
- The *quick* button goes. The *meaning* button keeps its icon; its title and the box's placeholder
  say what it now does: "a fast first pass at once, then a thorough one".
- **No server change, and no change to stored runs.** `search_runs.kind` stays `'quick' | 'meaning'`:
  a row is still asked as quick and replaced by a meaning row. Rows keep their *quick* tag while
  they are the first pass, and the manual **thorough** button stays on a quick row (for when the
  automatic one failed, and for quick rows made elsewhere, such as chat's).

### What it costs, named

Opening Search lands on *meaning* (the default since 2026-08-26). Until now that matcher spent
nothing until **find** was pressed. From now on it runs a quick search at each pause (one or more
Jev calls, one per chunk of the article), and **every quick answer left settled, or submitted with
Enter or *find*, buys a thorough search**. That was about $0.06 per provider call in the
2026-10-04 sample. So several long pauses in one typing session can buy several thorough
searches, and one already begun for words since abandoned cannot be cancelled. That was already
true of *quick*; what changes is that it is now the default. Greg's words ask for exactly this,
and call it an experiment. The guards that bound it are unchanged: one thorough search per settled
quick answer and words, none while the box holds unasked edits, no automatic retry.

What is given up: **a meaning search with no quick first pass.** Nobody can now ask the thorough
search without a quick search first, which is a fraction of a cent. Not worth a third button.

**What keeps the name "Quick search"**: the bottom bar's box, its ⚡, and the command bar's *Quick
search “X”* row. They are the quick way in from anywhere in the article, and what they start is
still a quick search first. Chat's quick-search card stays as it is (below). Renaming them is
left for Greg to ask for, not slipped in here.

## The simpler options passed over

- **Leave the code alone and only hide the *meaning* button.** Smaller diff, but `?match=meaning`
  links (the default in every URL written since August) would then open a matcher with no button
  lit, and the code would go on carrying a matcher nobody can reach.
- **Relabel the quick button "meaning", and parse old `match=meaning` as the quick matcher**
  (GPT Sol's F6). That needs no `kindFor` and touches the handoff's history less. But the matcher
  on screen would still be written `match=quick` in every new URL, forever, and the matcher's name
  would go on being confused with the stored run's kind. Folding into `meaning` costs a few more
  lines and leaves the URL saying what the screen says.

## The held chat item (`qi-dhy8q2nq`)

It does **not** fall out of this. That item asks for chat's in-place quick searches to start the
thorough search too, and for one search client shared by Search mode and chat. Auto-thorough lives
in Search mode's band, keyed to its typing session; this change renames which button that band is
on and nothing else. The item stays held, and its note gets a line saying so.

## Stages

1. **The fold** — params, panel, band, hrefs; tests updated (`url-state`, the quick-search panel,
   as-you-type, auto-thorough, dock and command-bar history tests, the chat card's href). A test
   that `?match=quick` parses to `meaning`, seen red first.
2. **Words** — search.md (the table, § Quick search's framing, § The URL),
   reading-view-overview.md's line for search.md, url-state.md's matcher list, keyboard.md's `/`,
   the Help page's search section (and the generated Help corpus), and anything else that tells a
   reader to "choose quick".

Sol reviewed the plan (read-only; BUILD WITH CHANGES, six findings, all taken:
[plan review](261012e-search-meaning-is-quick-then-thorough-one-toggle-plan-review-sol.md)), and
reviewed the code with fixes:
[code review](261012e-search-meaning-is-quick-then-thorough-one-toggle-code-review-sol.md),
LAND WITH FIXES. F1: *find* is now disabled, with its title saying why, for an exact repeat while
either the quick or the thorough half is out, except to submit the open session's own row. F2:
comments and docs that still said three matchers. F3, left as a known gap: a second quick row in
the two seconds between a blurred quick answer and the thorough search starting
([search.md § What is still open](../project/search.md#what-is-still-open)).

## Results

The two guards the rewritten tests carry — no search sent before the saved list's opening read
answers, and no exact repeat while running — were each checked by breaking them on purpose
(`quick-session.ts` ignoring `loaded`; `start` without `isRunning`) and watching the tests go red.
