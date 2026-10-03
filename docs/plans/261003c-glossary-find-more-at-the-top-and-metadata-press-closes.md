# 261003c: Glossary's Find more at the top of the column; a press on Metadata, on Metadata, goes back

Two of Greg's reports from 2026-10-02, both on
`/read/entropy-26-00481-with-cover-from-taylor-beck-spya-naz564`, both about one control.

## 1. spya-s660yh — Find more, at the top of the Glossary column

> There used to be a Find More button in Glossary mode. Add it back, at the top of the column
>
> — Greg, 2026-10-02

### Why he could not see it

It was never removed. `Foot` in `src/web/GlossaryPanel.tsx` still draws *Find more*, pinned
under the list — **unless the list is outdated**, when `more={!owner.outdated}` hides it. That
rule is plan 260929c (SPIDERYARN-READING2-55), and it was on purpose: on a list written by an
older prompt, `existingFor` (src/glossary.ts) refuses to append, so the run behind a button saying
"more" would **replace** the list — dropping every term the model did not find again. Greg's
article's glossary is `glossary/4`; the current prompt is `glossary/7` (read from production,
read-only, 2026-10-03). So on this article the button was hidden, and it is hidden on every
article whose glossary predates `glossary/7` — probably most of the shelf.

Today's Glossary work (261002c Hide / Dig deeper; 261002f added terms) did not touch it.

### Does the reason still hold?

Yes. `existingFor` still refuses a list from another prompt version, so a press on an outdated
list still rewrites. And not only then: it also rewrites when the article has moved (`stale`), and
when a list written for a profile is pressed after the reader has changed **or cleared** that
profile — the cleared case being one `profileChanged` deliberately does not count (GPT Sol, P1).

What a rewrite keeps: terms the reader added (`glossary_lookups.added_name`, outside the
document). When the article has not changed, entry ids are inherited by name (`idsByTerm`, which
predates 260929c — Sol, P2), so a `?term=` link, a *Dig deeper* answer or a hide on a term the new
run finds again carries over. What it loses: any model-found term the new run does not find
again, along with whatever was attached to it (Sol, P1).

### What we build

One row at the **top** of the column — first thing in the band's body, above *Look up a term* —
for the owner, whenever their glossary has arrived. The foot goes: one button in one place.

- One press, always `owner.more(owner.profiled)`, as the foot sent. **Its label is decided by
  what that press will do**, which the server now says: `GET /api/glossary/:slug` returns
  `panelRun: "append" | "rewrite"`, from `panelRunKind` in src/glossary.ts — `existingFor`'s
  three tests (source, prompt version, profile) applied to *this press's* profile (the list's
  own setting; today's profile if it was written for one). The route computes it beside
  `profileChanged`, from the same profile read.
- **Appends:** **Find more**, as it always was.
- **Rewrites:** **Find terms again**, with a tooltip that says so plainly — *writes a fresh list
  rather than adding to this one, so some terms here may not come back; terms you added are kept*.
  No banner: Greg's *"it's not worth bugging the user about it"* (55) is about a nag, and a label
  on a button he asked for is not one.
- A running job, the progress and Cancel, and a failure message all move with it, exactly as
  `Foot` drew them.
- **The stale banner keeps its sentence and loses its own *Find them again* button** — two buttons
  drawing one job's progress was the duplicate Sol's P2 named. The top row is the one run control.

**The simpler option passed over:** show plain *Find more* on every list, outdated or not. One
fewer branch, but it is exactly the bug 3f4c83524 and 260929c fixed — "Find more terms was one
landing away from meaning replace the glossary". **The other option passed over:** make a Find
more on an outdated list append across prompt versions. That changes `existingFor`'s contract
(provenance stamped on a merged list from two prompts) and is not a small fix.

Visitor: unchanged, no button (the endpoint is owner-only).

## 2. spya-bpczdx — Metadata, pressed on Metadata, goes back

> Tapping on Metadata mode in bottom bar when active should close it
>
> — Greg, 2026-10-02

261002g made a second press on the band you are in close it (`modePress`). Metadata is not a
band — it is a page, `/read/<slug>/metadata`, reached by `DockLink` with
`href={readHref(slug, search, "metadata")}` — so it missed that. On the metadata page the link
points at itself.

### What we build

On the metadata page the Metadata button's href becomes the **article** with the same carried
query string: `readHref(slug, search, "article")`. `search` is `carriedSearch(location.search)`,
which already holds `?mode=`, `?margin=` and `?at=` — so the reader lands back where they were,
in the mode they came from. It stays drawn as current (`aria-current="page"`, `.on`), as an
active mode's button does. ⌘-Enter does the same on the metadata page (it was disabled there
because "there is nothing to toggle back to", plan 260929g assumption 3 — there is now). The
tooltip's chord sentence changes to say it toggles.

**The simpler option passed over:** `history.back()`. It is the reader's real previous page only
when they came from the article; arriving from a pasted link or the shelf it would leave the
site. The carried query string is the same place, deterministically.

Applies to the visitor's public metadata page too, which mounts the same bar.

## What review changed

GPT Sol's plan review (`261003c-plan-review-sol.md`): P1 the label must follow the real
append/rewrite decision, not `outdated` alone → `panelRun` from the server. P1 the tooltip must
not promise what survives → it says some terms may go. P2 the stale banner's duplicate button →
removed. P2 id inheritance predates 260929c → corrected above. P2 `carriedSearch` keeps an
encoded `%70anel=` → predates this work and is not touched; noted here.

## Tests (seen red first)

- Glossary: on an outdated owner list, the top row offers *Find terms again*; on a current one,
  *Find more*; the row is above *Look up a term*; no foot button.
- Dock: on `view="metadata"` the Metadata link's href is the article with the carried search;
  on the article view it is still the metadata page.

## Docs

`docs/project/glossary.md`, `docs/project/url-state.md` if it lists the link, the Help page's
modes text, feedback notes for both reports.

## Code review

GPT Sol's code review (`261003c-code-review-sol.md`) found no P0/P1 and fixed two P2s inside the
stage: the run row now passes `owner.stalled` (the stale banner had carried the stalled warning),
and a failed job is drawn by `JobProgress` with its own Retry policy rather than a fresh paid run
under every failure. Postmortem:
[261003a](../postmortems/261003a-consolidating-duplicate-controls-keeps-the-survivors-omissions.md).
It also added `panelRun` assertions to `tests/route-profile-concurrency.test.ts`, including the
cleared-profile case. The Help page's "without adding it to the list" (stale since 261002f) is
corrected. Left as is: `carriedSearch` keeping an encoded `%70anel=`, which predates this work.

## Browser check

Playwright on the box, 1400px and 390px, at 1e42388eb (before the code review's two fixes,
which do not change the idle row). The run row is the column's first row on both widths, clear of
the (i); one button, none in the foot. Both labels seen locally and each matched `panelRun`:
*Find more* on `fowler-phrenology` (`append`), *Find terms again* on `smart-spya-fq4q5h`
(`rewrite`, profile changed), and on most other local lists. Metadata pressed on Metadata, and
Ctrl-Enter there, returned to `/read/fowler-phrenology?mode=glossary&at=spya-ntpaad` with the
band open and, on the phone, that block at the top. No page errors. Shots in `261003c-shots/`.
