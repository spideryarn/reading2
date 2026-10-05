# No Home icon beside the logo, and a first-open default of Summary and Marginalia

Two reports from Greg, both filed from the Feedback button on 2026-10-04, relayed by the Overseer.

**spya-gqj660**, on `/changelog`:

> We don't need a Home icon on /changelog, because we have the logo right next to it. Look for
> anywhere else that has a superfluous link back to home at the top and remove that too.

**spya-ax5tmm**, on an article:

> When I open an article for the first time, default to Summary/Briefer in left-hand (if there's
> room) and (if there's even more room) Marginalia mode in right-hand

The Overseer's bounds on the second, relaying Greg: it applies only to an article's first open with
no mode in the URL; it respects window width the way the bottom bar already decides room; it does
not override a reader's later choice. And: prefer the simplest version that gets most of the value.

## Stage 1 — the Home icon

**What is there.** `BackLink` (`src/web/BackLink.tsx`) draws an icon link above a page's heading.
Five pages use its `icon="home"` variant, a house that goes to `/`: `/changelog`, `/privacy`,
`/contact`, `/opensource`, `/help`. On every one of them `App.tsx` also draws `HomeLogo`, the fixed
corner wordmark, which goes to the same place. Two more pages draw an *arrow* to `/` under the same
corner logo: `/profile` ("Back to your library") and the admin pages whose `Shell` takes the default
`back` (`AdminPage.tsx`).

**What changes** (revised after GPT Sol's plan review, F2: signed out, `App.tsx` returns those five
pages with no `HomeLogo`, so there the house is the only way home and stays).

- On the five house pages the Home link is drawn only where there is no corner logo, which is the
  signed-out shell. The rule lives in one place rather than in five pages; the implementer picks the
  smallest existing seam for "is the corner logo here" (the auth state the app already holds).
  The house variant, its import and its test stay.
- Remove the link from `/profile` (signed-in only), and from an admin `Shell` whose back link is the
  default (the library). An admin page that passes its own `back` (to the admin home) keeps it:
  that one is not a way home.
- The `BackLink` header comment and `docs/project/icons.md` / `changelog.md` are brought into line.
- A test, seen red first: signed in, none of the five pages draws the Home link; signed out, each
  still does.

**Left alone, on purpose.** The arrow above an article's title (`Masthead.tsx`, "Back to your
library"). The logo there is in the bottom bar, not beside it, and the comment in that file argues
it is not a duplicate. It goes to Greg as a question rather than being removed on a guess.

**The simpler option passed over:** removing only `/changelog`'s. He asked for the others in the
same sentence.

**Done when:** no shell draws both the corner logo and a link home above the heading; the heading
does not sit under the corner logo at phone, iPad or desktop width; tests and typecheck green.

## Stage 2 — the first-open default

**What is there.** `src/web/last-view.ts` already decides which address a reader arrives at. It
keeps a copy of an article's query string in `localStorage` under the slug, and on a **bare**
address (one carrying none of the article's parameters) puts it back, in a layout effect, before
anything paints. A link that says anything always wins. When the view is empty (plain, at the top)
the key is **removed**.

**What changes.** One more case in the same decision: a bare address **and nothing stored for this
slug** is a first open, and arrives at the default instead.

- `firstOpenSearch(windowWidth, rootFontPx)` — pure, in `last-view.ts`:
  - `""` when a band would cover the prose: `bandCoversProse(windowWidth)` (`layout.ts`);
  - `"?mode=summary"` when the band fits beside the prose;
  - `"?mode=summary&margin=1"` when the notes also fit beside Summary's band:
    `notesFit({ windowWidth, bandShape: "roomy", rootFontPx }, true).both` (`marginalia/press.ts`).
  These are the same two functions the reading view and the Marginalia button use, so the default
  can never open a column the layout would then refuse to draw. `?summary=` is left absent, which
  is Brief.
- The arrival decision becomes: state on the address → leave it; something stored → restore it, as
  today; nothing stored → the first-open default.
- **"Nothing stored" has to mean "never opened here"**, and today it does not: a reader who goes
  back to Plain at the top has their key removed, so the next open would look like a first one and
  the default would override their choice. So `writeLastView` stores the empty string instead of
  removing the key. `restoredHref` already treats `""` as "nothing to restore", so restores are
  unchanged; only `null` (no key) is a first open.
- Signed-in readers only; a signed-out visitor on a public article keeps arriving on the article
  itself. Reason: a stranger's first sight of the product should be the article, and whether they
  should land on a summary is a product call Greg has not made. (Where "signed in" comes from
  changed in the second revision below: the experimental store's snapshot, not a `readerId` prop.)

**Revised after GPT Sol's plan review:**

- **F1 — a storage failure is not a first open.** `readLastView` returns `null` when storage throws
  as well as when the key is missing, and writes swallow failures; with storage blocked every open
  would be a "first" one and the default would override a later choice of Plain on every visit. So
  the read distinguishes *failed* from *read, and no key*, and the default is applied only after a
  first-open marker has been written successfully. If either fails the address is left alone.
- **F3 — the same measurements the reader uses**, not raw `innerWidth`: `pageWidth()` less
  `horizontalInset(safeAreaInsets())` and the validated root font size (`src/web/reader/measure.ts`).
  Computed once per arrival; resizing afterwards follows the layout and never reapplies the default.
- **F4 — the boundaries**, with the rail on: below 700 usable px the article alone; 700–899 Summary
  alone; from 900 Summary and Marginalia. An iPad in landscape (1024) therefore gets both. Tests
  sit just below and at each boundary.

**Revised again, 2026-10-05, when the build found Marginalia is behind the experimental switch**
(`src/mode-catalog.ts`, `experimental: true`; Summary is not). Putting an experimental column in
front of every signed-in reader is not what was asked and not ours to decide, so:

- **Marginalia joins the default only for a reader whose experimental switch is on.** Everybody else
  who is signed in gets Summary alone, however wide the window. `firstOpenSearch` takes a third
  argument, `marginalia: boolean`.
- **So the default waits for the switch's answer.** The switch's state is in
  `experimental-store.ts` (`loaded`, `on`, `signedIn`); it is already known on an arrival from the
  shelf, and arrives a moment after the page on a cold load. The restore stays where it is (a layout
  effect, on mount). The first-open default is one layout effect keyed on the slug and `loaded`:
  on mount it reads the storage and, on a clean read with no key, writes the marker and notes the
  slug as *pending*; once `loaded` is true (the same commit, from the shelf) it applies the default
  if the slug is still pending, the address still carries no article state and still names this
  article, and then clears *pending*. A reader who has already scrolled or pressed something by
  then has state on the address and is left alone. `signedIn` comes from the same snapshot, so no
  `readerId` is passed in.
- On a cold load the band can therefore appear a moment after the article does. Accepted for v1:
  it happens once per article, and only when the address was typed or pasted bare.
- A switch that never loads (offline with nothing cached, a failed request) means no default.

**Arriving in Summary spends nothing** (`docs/project/summaries.md`: "arriving … spends nothing";
with none stored the owner sees an empty state and **Write it**). `margin=1` draws only what is
already in the payload. So the default starts no model call. The thread view is not involved.

**What "first open" means here, and its limits.** First open *in this browser*, because that is
what the existing memory is. Two consequences, both accepted for v1:

- An article opened before on another device gets the default once on this one.
- An article already on this browser that was last left in Plain at the top has no key today, so it
  gets the default once after this ships. An article with any remembered view is untouched.

**Simpler options passed over.** None is simpler than this; the heavier ones are:

- *Ask the server whether the article was ever opened* (the shelf has an `opens` count). True across
  devices, but the decision would move from before the first paint to after the article loads, and
  it needs the count on the article payload. Deferred; a question for Greg below.
- *Only default to Summary when one is stored.* Needs the payload too, for the same cost.

**Docs in the same stage:** `url-state.md` § Reopening an article where you left it, a line in
`summaries.md` and `marginalia.md`, and `/help` if it describes how an article opens.

**Tests, red first** (`tests/last-view.test.ts`): the three widths; a link with state wins; a stored
`""` is not a first open; signed out gets no default; leaving for Plain then reopening stays Plain.

**Done when:** a never-opened article opens in Summary + Marginalia from 900 usable px, Summary alone
from 700 to 899 (an iPad in portrait, 820), the article alone on a phone; pressing Plain, leaving and coming back stays
Plain; a pasted `?at=` link is left exactly as sent.

## Questions for Greg (not blocking)

- **Q-masthead-arrow** — should the back arrow above an article's title go too?
- **Q-first-open-no-summary** — on an article with no summary written, the default opens Summary's
  empty state with *Write it*. Keep that, or default only when a summary exists?
- **Q-first-open-visitors** — should signed-out readers of a public article get the default too?
- **Q-first-open-across-devices** — is "first open in this browser" enough, or should it be first
  open ever (server-side)?
- **Q-marginalia-switch** — Marginalia is behind the experimental switch, so a reader with the
  switch off gets Summary only. Take Marginalia out from behind the switch, or leave it?

## Log

- 2026-10-05 — plan written.
- 2026-10-05 — GPT Sol's plan review
  ([261005a-home-icon-and-first-open-plan-review-sol.md](261005a-home-icon-and-first-open-plan-review-sol.md)):
  F1 (P1), F2, F3 (P2), F4 (P3), all accepted and written in above. Its own test run did not start
  (`.vite-temp` could not be created in its sandbox), so its checks were by reading and a /tmp probe.
- 2026-10-05 — stage 1 built. The seam is a context, `SignedInShell` in `BackLink.tsx`, provided
  once in `App.tsx` around the signed-in pages; `HomeLink` in the same file draws the house only
  outside it, and the five pages call that. `/profile` lost its arrow; the admin `Shell` draws a
  back link only when given one, and gained `--safe-top` in its top padding so the index heading
  clears the corner logo under a notch. `icons.md` and `changelog.md` said nothing about the house,
  so the doc change is one sentence in `website-text.md`. New test, red first:
  `tests/home-link-only-without-the-corner-logo.test.tsx`. Heading clearance is argued from the
  stylesheet (heading at 3.5rem, logo 2.75rem tall), not yet looked at in a browser.
- 2026-10-05 — the build stopped stage 2 on finding Marginalia behind the experimental switch; the
  section "Revised again" above is the answer.
- 2026-10-05 — stage 2 built as revised. In `last-view.ts`: `readLastView` returns
  stored / none / failed; `writeLastView` stores `""` and returns whether it wrote;
  `firstOpenSearch(width, rootPx, marginalia)`, `claimFirstOpen` (bare address, clean read, no key,
  marker written) and `firstOpenHref` (signed in, room, address still bare, still this article's
  reading view). `useLastView` claims in the existing restore effect, from the same one read, and
  applies in a second layout effect keyed on the slug and the experimental store's snapshot.
  `reader/measure.ts` exports the two reads its hooks made (`usableWidth`, `rootFontPx`). The
  metadata page gets no default (not in the plan above; the default is a view of the article).
  Tests in `tests/last-view.test.ts`, red first. Docs: `url-state.md`, a line each in
  `summaries.md` and `marginalia.md`, and one sentence in Help's "links" topic. The two effects are
  rendered in `tests/first-open-default-wiring.test.tsx` (written after the code; one mutation seen
  red). The tests that boot the whole app never meet the default, because their jsdom has no
  `localStorage`. Nothing has been checked in a browser.
- 2026-10-05 — committed as `815a2608e`, then GPT Sol's code review
  ([261005a-home-icon-and-first-open-code-review-sol.md](261005a-home-icon-and-first-open-code-review-sol.md)),
  which fixed what it found: **F5 (P1)** a bare visit to an article's Metadata page wrote the
  first-open marker and got no default, so the article's own first open was used up; the claim, the
  default and the save are now scoped to the view as well as the slug (`useLastView(slug, view)`),
  with a postmortem,
  [261005a](../postmortems/261005a-a-downstream-guard-cannot-protect-an-upstream-first-open-marker.md).
  **F6 (P3)** the docs and Help overstated when the default appears; reworded. Its fixes were read,
  the gates re-run, and one mutation (dropping the view check on the claim) seen red.
- 2026-10-05 — browser check, Sonnet with Playwright on the box, local dev, on `815a2608e` (before
  F5's fix, which changes nothing it looked at). Signed in at 390, 820 and 1280: no link home above
  the heading on the five pages, `/profile` or `/admin`; the heading 12px clear of the corner logo
  (4px on `/admin`); *Back to Admin* kept. Signed out: the house is there on all five. First open:
  1440 with the switch on gives Summary and Marginalia, with it off Summary alone; 1024 both; 820
  Summary alone; 390 the article alone; Plain then reopen stays Plain with `""` stored; a `?at=`
  link is left as sent; a signed-out reader of a public article gets nothing added. No pop-in was
  seen on a cold load. With no summary written the band says nobody has asked for one yet. Shots:
  `261005a-shot-*.png`. Not checked: a real iPad or phone, Safari, the light appearance.
