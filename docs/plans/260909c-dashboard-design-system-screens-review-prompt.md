# Review prompt: what each screen of the fleet dashboard is for, and what should change

**You cannot see the screenshots** — you have no image input. So this prompt carries a written
description of every screen, taken off the rendered pixels by someone who looked at them, plus the
measurements. The PNGs are in the tree at
`docs/plans/260909c-dashboard-design-system-screenshots/before/` if you want to check a file exists,
but do not try to read them.

## The candidate

Repository: `/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system`, revision
**`5b3efeb3`**. **Do not change any file.**

Read:

1. `docs/reusable/design-a-screen.md` — the checklist this work is being done against. It is new; a
   view on whether it is any good is welcome but is not the main question.
2. `docs/plans/260909c-dashboard-design-system-research-a-reusable-ui-ux-prompt-then-apply-it-usage-limits-first.md`
   §§ "What the page measures", "Reading the Usage tab off the pixels", "Box health is the model".
3. `tools/fleet/web/src/UsagePanel.tsx`, `HealthPanel.tsx`, `AttentionPanel.tsx`, `SessionsPanel.tsx`,
   `ui.tsx`, `tailwind.css`, `Header.tsx`, `Dock.tsx`.
4. `docs/project/overseer-direction.md` §§ "Attention, and who the Overseer is really watching",
   "Three surfaces, not one page", "Push almost nothing".

## Who reads this page and what they want from it

One person — the owner of the box — on a phone at 390px as often as at a 1280px desk, deciding what
to do about ~18 running coding-agent sessions. No other users. His words, 2026-09-09:

> The main thing I really want from this web dashboard interface is to have a very easy way to see
> answers to questions like: Is anything needed from me? Is anything blocked? Where do things
> stand? And right now, it is very hard to see those things!

and, about one tab specifically:

> the Usage Limits tab UI is horrible. It's really hard to scan.

## The question to answer for every screen

The one he asked for, verbatim:

> what are the main purposes/intent/questions that the user might have, and how can we make that
> more visible

So for **each** of the nine screens below, give me:

- **(a)** the ranked questions its reader actually arrives with, in the reader's words not the
  system's;
- **(b)** which of his three questions it should be helping answer, and whether it does;
- **(c)** the ranked changes — highest value first, with a rough cost — that would make (a) more
  visible;
- **(d)** anything the screen currently says that should be **removed or demoted**, which is the
  half that usually goes unsaid. Apply the ten-second test from `design-a-screen.md`: a caveat stays
  on screen only if it changes what the reader does in the next ten seconds.

## The measurements

At 390px wide, all tabs, no horizontal overflow anywhere:

| Tab | height | interactive elements | font sizes | text colours |
|---|---|---|---|---|
| Deploys | 8,839px | 151 | 5 | 4 |
| Recent messages | 6,932px | 34 | 5 | 6 |
| Sessions | 3,529px | 93 | 6 | 5 |
| Overseer | 3,182px | 26 | 5 | 6 |
| Usage limits | 1,922px | 17 | 7 | 6 |
| Box health | 1,525px | 22 | 6 | 7 |
| Queued ideas | 1,149px | 18 | 5 | 5 |
| Readiness | 872px | 12 | 6 | 6 |

Repo-wide, over `tools/fleet/web/src/` (you can re-run these):

- `text-[12px]` ×156, `text-[13px]` ×149, `text-[11px]` ×41, `text-[10px]` ×3, `text-[14px]` ×2,
  `text-[15px]` ×2, `text-[17px]` ×1, `text-[22px]` ×1. Two weights: `font-medium` ×85,
  `font-semibold` ×49.
- `text-ink-faint` ×177, `text-ink-soft` ×129, `text-ink` ×69.

## The screens, as rendered

**Persistent chrome, on every tab.** A three-line header: `Fleet · 18 sessions · 7 working · 11
quiet · collected 6s ago`; then `Overseer: Overseer`; then, wrapped over two lines at 390px, *"this
device's clock is 5m ahead of the box's — the times here are corrected for it"*. Below the fold, a
fixed bottom bar of nine icon buttons, the active one showing its label.

**1 · Sessions** (the landing tab). A red-edged card: `AT LEAST 1 WAITING ON YOU · SCANNED 23S AGO`,
then in faint 12px *"1 of 18 could not be judged, so there may be more."* Then one attention card —
a `TECHNICAL` label top-left, `waiting 2h` top-right, the session name bold, two lines of the
agent's own sentence, a disclosure *"inferred from its last turn — show the last 24 lines of its
screen"*, and `needs a screen`. Then a **New session** card with a button and two lines of prose
about `gjd-remote`. Then `18 SESSIONS` with an `Order` dropdown, then `WORKING · 7`, then the cards.

Each session card is four lines: a green `WORKING` pill with `up 36s` right-aligned; the name in
bold 13px; `spideryarn/reading2`; and a monospace id trio `feed-clickable · $2712 · %2715`. **Lines
three and four are identical or near-identical on all 18 cards.** The fold falls on the second
`WORKING` card.

**2 · Usage limits.** One card, twelve paragraphs, no internal structure. Bold 15px headline *"This
page cannot tell how much headroom this account has."* and a purple `UNKNOWN` pill — the only strong
element. Then, all at 12–13px in one of two greys: the account line; *"Reading taken 2m 20s ago —
2026-09-09 05:51 UTC · 06:51 London · 08:51 Athens. The Overseer wrote the checkpoint carrying it 5s
ago — 2026-09-09 05:53 UTC · 06:53 London · 08:53 Athens."*; three bullets, one of which runs to
**eleven lines** about a `seven_day` contradiction; an 11px uppercase faint heading `REJECTIONS
SEEN`; four more paragraphs; the coverage line; an 11px uppercase faint heading `CACHED HEADROOM`;
a `cached 6h 3m ago` line with all three zones; then four list rows of which **one** carries a
number — `seven_day 58%` — and three say a percentage cannot be shown. Then a separate `The last 24
hours` block: a full-width SVG with a 100/50/0 axis carrying one short green segment, and beneath it
a rejection strip — and then the same three "cannot be checked for validity" sentences **printed a
second time, word for word**.

Every timestamp on this tab is printed in three zones (UTC · London · Athens). The owner moves
between London and Athens, so the zones are deliberate.

**3 · Box health** — the best of the eight. An `OK` pill card, then `THE NUMBERS`: a two-column grid
of five **stat cards**, each an 11px uppercase faint label, a ~22px bold tone-coloured value (`4.0`,
`60%`, `38%`, `52%`, `0%`) and a 12px line of evidence (*0.3× of 16 cores*, *18 GiB of 31 GiB
available*). Then `THE LAST 24 HOURS`: a break strip, prose about gaps, and four labelled sparkline
rows with `now 60% · low 36% at 01:40 AM` beside each, and a legend. Then a disclosure, then an
`Act on the box` card. **This is the only tab where the number that matters is the biggest thing in
its box, and the only place the 22px size is used at all.**

**4 · Readiness** — the second best. A purple-washed card with a **coloured, larger** headline *"we
do not know"* beside a monospace commit pill `E52AD4CA`, `as of 06:58 AM, 1 min ago`, one sentence
of what that means, and two bulleted reasons. Then `THE LAST DAY`: five rows (`test`, `typecheck`,
`check`, `lint`, `build`), each a label, a sparkline box of tall and short marks, and a right-aligned
verdict (`pass 01:47 AM`, `nothing ran`, `running 06:58 AM`). Then `THE TREE`: three label/value
rows including `dev → main: 323 commits not deployed`.

**5 · Overseer.** A wall of prose. *"Supervision is running."* bold, then two lines of clocks, then
a grey line of `schema 2 · pid 3444983 · 360 ticks · last tick 4s ago · started 2h 2m ago · instance
f09dcb03-…`; then a paragraph about the scheduler being off and which rules would have run; then *"18
sessions in the Overseer's register — the longest-waiting 8, as history rather than as a claim about
the rows on the Sessions tab"*, then eight monospace lines like `shell:false ≥11m sh-260908-232139
$2517`; then a footnote about `≥`. **Then the entire Usage limits card again, verbatim**, so the
reader meets the same twelve paragraphs on two tabs with nothing distinguishing the copies.

**6 · Recent messages.** Heading `RECENT MESSAGES ?`, a text filter, `Hide tool calls`, `Read again`,
a `Last 50` dropdown — then **fifteen identical grey pills** in a wrapped block (`typed at the pane`,
`the agent`, `another agent`, `machinery`, `a compaction summary`, `an injected reminder`, `an API
error`, `Claude Code itself`, `an unknown speaker`, then one per session name), filling most of the
first screenful before a single message. Then a red-edged card *"This may not be the last 50
messages."* with two lines of explanation and a disclosure *"6 of 18 sessions had no readable
transcript"*. Then message rows: session name, `THE AGENT` in green caps, a **raw ISO timestamp**
`2026-09-09T05:53:55.955Z`, then either the text or *"No words in this turn — it only called
tools."* followed by monospace command lines.

**7 · Deploys** — 8,839px and 151 interactive elements. Every release fully expanded: a bold
headline, then multi-paragraph changelog prose with five or six inline commit-hash links per
paragraph, repeated per release with no collapse. (Another session owns this tab and is already
reworking it; I am not asking you to design it, only to say whether its shape belongs in the same
system.)

**8 · Queued ideas.** The calmest screen. One card per idea: a purple `PROPOSAL` pill, a bold title,
one line of grey prose, a monospace id top-right. Every card carries the identical pill, so nothing
separates priority or age.

**9 · Session detail** (reached by tapping a session). At 390px the attention card, the *New
session* card and the `18 SESSIONS / Order` header **all stay above it**, so the thing you tapped
starts about half a screen down — and when the attention card is about the same session you just
tapped, the two disagree in view of each other.

## What I already intend to do, so you can attack it rather than repeat it

- Add a **type scale** and an **emphasis rule** on top of the existing tokens, and generalise Box
  health's stat card into a shared primitive.
- Build a **landing surface** that answers his three questions in one screenful, before restyling
  Usage limits.
- Restyle Usage limits into stat-card form: the verdict, then the headroom number, then the
  evidence, with the provenance demoted but not deleted.

## Severity scale and format

`P0` misleading or unsafe · `P1` materially wrong · `P2` worth fixing · `P3` taste. Give every
finding an ID and name the screen. **Rank your recommendations across all nine screens at the end**:
if I can only do three things, which three?

## My suspicions, last, so they do not steer you

- I think the single highest-value change is not on the Usage tab at all: it is that **two of four
  lines on every session card are constant across all 18 rows**, so the list is 18 rows of the same
  two facts.
- I think the three-zone timestamps and the clock-skew banner are a large, permanent tax paid on
  every screen for facts that change nothing the reader does in the next ten seconds — but they were
  deliberate, so I want an argument rather than a preference.
- I suspect `UsagePanel` cannot be fixed by restyling, because its honesty is expressed **as
  prose**, and turning prose into a stat card risks deleting the distinctions the prose exists to
  make. If you think that is right, say what the honest stat-card form of "an expired window has no
  number" actually looks like.
