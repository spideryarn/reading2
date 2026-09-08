# The feedback box zoom was fixed ten minutes before I started

**Status:** the report is answered; nothing of mine shipped for it. 2026-09-08.

Dispatched for `SPIDERYARN-READING2-2H` — Greg, from an iPhone, 2026-09-07 17:44 UTC:

> The Feedback dialog on an iPhone seems to get weirdly zoomed in when I click in and out of the
> Feedback text box.

**It was already fixed.** Commit [`31b200cd`](#the-commit-that-had-already-done-it), *"A floor for a
control a finger has to hit, and a field iOS must not zoom into"*, landed on `dev` at **03:55** on
2026-09-08.

The timing is worth stating exactly, because it is what made the duplication easy rather than
careless. This session's opening snapshot of the tree was `4bf4a337`, committed at **03:41** — the
fix did not exist yet. It landed fourteen minutes later, while the session was reading docs, and
arrived in this worktree at about **04:06** in `npm run worktree:setup`'s own merge: *"merged
origin/dev (73bc0da1) — 25 commits this worktree did not have"*. So the code was on disk, and the
plan to write it again was drafted about four minutes after that.

This doc is therefore not a plan. It is the verification that the report is genuinely answered, the
one gap that verification turned up, and the reason a fresh session could not see that the work was
done.

## The diagnosis, which was right

iOS Safari zooms the page when it focuses a form control whose computed `font-size` is under 16px,
and does not zoom back out on blur. `.fb-input` in `styles/feedback.css` was `0.82rem` — 13.12px on
a 16px root — and so was every other hand-styled field in the app.

The fix is **not** a viewport-meta change. `maximum-scale=1` or `user-scalable=no` would suppress
the symptom by taking pinch-zoom away from every reader on every page, on an app whose main object
is a column of prose people zoom into. `index.html` deliberately carries neither, and
`styles/narrow-window.css` says so where the real fix lives.

## The commit that had already done it

`31b200cd` came from a **different report** — `SPIDERYARN-READING2-2J`, the glossary's order button
on a touch device — whose session found the same class on the way past and closed it properly:

```css
@media (any-pointer: coarse) {
  :root input:is(:not([type]), [type="text"], [type="search"], [type="email"],
                 [type="password"], [type="url"], [type="tel"], [type="number"]),
  :root textarea:not([hidden]) { font-size: 1rem; }
}
```

with `tw:any-pointer-coarse:text-base` at the call sites of the four fields the utilities layer puts
out of that rule's reach. It has a GPT Sol review (its comments cite F1, F3 and F6), a 340-line
`tests/touch-controls.test.ts` that computes real CSS specificity, a plan doc and a postmortem.

It is better than what this session was about to write, in two specific ways worth recording because
both were live mistakes in the draft:

- **A positive list of input types, not a blanket `input`.** A blanket rule reaches
  `type="file"` — the feedback dialog's own screenshot picker, whose 0.72rem is deliberate and which
  raises no keyboard and no zoom. That was Sol's F3 against the earlier version, and this session's
  draft had reintroduced it.
- **`:root` for specificity, rather than a new cascade layer.** The draft proposed
  `@layer theme, base, app, touch-floors, utilities` so that one rule could beat every component's
  own size while still losing to `tw:text-2xl` on the title editor. That works — it was measured, see
  below — but it is a structural change to a four-layer statement with a long comment explaining
  itself, in exchange for what `:root` already buys.

## Verifying that the report is actually answered

A fix that exists is not a fix that works, and this one had **shipped applying to nothing twice**
already (its own commit message says so: bare `textarea` lost to `.chat-input` on specificity, then
the replacement lost to `.remember .chat-input`). Both times the suite was green. So this was
measured rather than read.

Real headless Chrome on the box, 390×844, `deviceScaleFactor: 3`, `isMobile` and `hasTouch`, iOS
Safari UA, signed in as `dev-admin@spideryarn.local` against a local dev server, sweeping
`getComputedStyle(el).fontSize` over every text-entry control reachable on the sign-in page, the
shelf, `/profile` and the reading view.

`matchMedia("(any-pointer: coarse)").matches === true` under that emulation, so the readings reflect
the rule firing rather than a coincidence. `html` and `body` are both 16px, so 1rem is 16px.

**Twelve controls across six routes, every one at exactly 16.00px** — including
`.fb-input.fb-body`, the control the reader complained about, measured both focused and unfocused;
and including the four Tailwind-classed fields (sign-in email and password, the shelf's add-URL box
and its search box), which the `-2J` note had listed as still outstanding and which are not.

**A screenshot would have proved nothing here.** Desktop Chrome does not reproduce the zoom at all,
so a picture of the dialog would have looked correct whatever the font size was. The number is the
evidence — [silent-success.md](../reusable/silent-success.md).

### The cascade probe

Before finding the existing fix, this session put the proposed layer design into real Chrome on a
static page rather than reasoning about the cascade spec. Kept because the numbers outlived the
design that prompted them:

- Playwright's `isMobile: true, hasTouch: true` really does make Chrome report `any-pointer: coarse`
  **and** `pointer: coarse` — so touch emulation is a valid way to test either query;
- a layer between `app` and `utilities` beats `.fb-input` (0,1,0) and `.remember .chat-input` (0,2,0)
  and still loses to `utilities`, so the design would have worked;
- **`font-size` changes a control's intrinsic height, for some controls.** Raising 13.3px → 16px
  leaves `checkbox`, `radio` and `range` unchanged, and grows a `select` 19 → 21px and a `date`
  input 21.3 → 25px. A draft of this doc asserted the opposite and was wrong. It is what makes the
  `select` question below cost something rather than nothing.

## The one gap: `<select>`

The chat composer's stance picker (`ChatPanel.tsx`, Balanced/Respond/Socratic/Signposts) measures
**13.28px**. `<select>` is named nowhere in the rule, nowhere in its prose, and nowhere in either the
plan or the postmortem behind `31b200cd` — so it is unconsidered rather than deliberately excluded.
`.chat-live-mic select` and `.chat-stance select` (`mode-band.css`) are `0.83rem`; `.place-pick
select` (`dialogs.css`) is `0.81rem`. There are four or five native selects in the app.

**Whether it matters cannot be established here.** There is no iOS device on this box and Chromium
does not reproduce the zoom at all, so the premise — that iOS zooms on `<select>` focus the same way
it does on a text input — is reasoned, not measured. The shipped rule's own framing is *"a positive
list of the types that raise a keyboard"*, and a `<select>` on iOS raises a wheel picker rather than
a keyboard, so the exclusion may be right for a reason nobody wrote down. Against that, the two
selects concerned sit in the mode band, which `narrow-window.css` documents as the tightest row in
the app, and the change would cost 2px of height there.

Put to GPT Sol and to Fable, with the motive declared: the session's own job had evaporated, and a
one-line contribution is more satisfying than writing "nothing to do". See § What was decided.

## What was decided

**Added, as `:root select:not([hidden])`.** Both reviewers said add it, and the factual question was
answered better than expected.

**GPT Sol answered Q1 from WebKit's source rather than from the recipe**, which is what turned a
"widely copied snippet" into evidence. `WKContentViewInteraction.mm` comments that a non-text control
such as a `<select>` *"can be zoomed immediately"* on focus and then calls the same focused-element
zoom path a text input takes — **the wheel picker changes the timing, not whether it zooms** — and
`WKWebViewIOS.mm` computes the target scale as `16 / nodeFontSize`, which at 13.28px is **1.20×**.
Confidence ~95%, and labelled *reasoned* rather than *established* because nobody ran that Safari
build. It also drew a boundary this session had not: **the scaling is gated to WebKit's small-screen
idiom**, so it is an iPhone claim and not an iPad one. The rule is load-bearing on a phone and merely
harmless on a tablet, and that is now written where somebody would otherwise cite it wrongly.

Sol independently derived the same selector, and for the same reason (its F4): a bare `:root select`
is (0,1,1) and **ties** with `.chat-live-mic select`, `.chat-stance select` and `.place-pick select`,
winning today only because `narrow-window.css` is imported later — the exact source-order dependence
that made this rule ship applying to nothing twice. `:not([hidden])` takes it to (0,2,1) and wins
outright. Its F5 added one thing this session had got right by accident rather than by decision:
**do not exclude `:disabled`**, because a control changes disabled state and the type would jump size
as it did.

**Sol's F6 found a real gap in the test work**, and it is fixed: the third assertion in that
`describe` — *"no coarse-pointer rule puts a field back under 1rem"* — matched `input` and `textarea`
and would have ignored a future `@media (any-pointer: coarse) { .chat-stance select { font-size:
0.8rem } }` entirely. `\bselect\b` is in its pattern now.

**Fable arbitrated the scoping**, and its argument is the one that decides this shape of question
generally: *an unverifiable premise is weighed by prior × cost-if-wrong on each side ×
reversibility*. High prior, one line to revert, and a sticky 1.2× zoom if it is real. It also noticed
that this is [the postmortem's own class recurring](../postmortems/260908a-a-rule-written-to-the-width-of-the-complaint.md)
— a rule written to the width of the complaint, one notch wider — so adding `select` is finishing the
fix rather than extending it. Both reviewers were told the session had a motive (its own job had
evaporated, and a one-line contribution is more satisfying than "nothing to do") and asked to weigh
that against it. Both did, and both still said add it.

### Three mutations, because a test that was never red proves nothing

Each new assertion was watched fail before it was trusted:

| Mutation | What went red |
|---|---|
| the `select` half deleted from the rule | *"and a `select` half: expected false to be true"*, and the specificity check |
| weakened to a bare `:root select` | *"the select half (`:root select`, 1,1) must out-specify `.chat-live-mic select` (1,1)"* — the **tie** is caught, which is the subtle one |
| a coarse-pointer rule added putting a select back to 0.8rem | the offender named: `mode-band.css: .chat-stance select → font-size: 0.8rem` |

## The thing worth changing

**`gjd-remote ls` is the claim register, and it cannot see a report that was fixed by somebody
else's session.** `feedback-reports.md` § A report dispatched is still `unresolved` is built entirely
around *"a session named `fb<short-id>` means that report has an agent"* — which is the right guard
against two sessions taking the same report, and no guard at all against the case here: `-2J`'s
session fixed `-2H`'s bug on the way past, under its own name, and then finished. Sentry still said
`-2H` was unresolved, because it was; nothing had claimed it, because nothing had.

The cheap check that would have caught it costs one command, before writing anything:

```
git log --since=<the report's First Seen> --oneline origin/dev
```

Twenty-five commits, one of them titled *"…and a field iOS must not zoom into"*. This session ran
`worktree:setup`, read *"merged origin/dev (73bc0da1) — 25 commits this worktree did not have"*, and
did not look at what they were.

It is not being written into `feedback-reports.md` here, because another session
(`feedback-reports-md-admin-trust`) is editing that file right now and CLAUDE.md asks for one
approved set at a time on a doc whose wording is a rule. It is raised for Greg instead.

**A near-miss rather than a near-hit is the reason to write it down.** Nothing was lost — the
duplicate was reverted before it was committed, and the only cost was this session's time. But the
draft was one commit away from landing a second, differently-shaped rule for the same bug, in a
different file, with its own test and its own long comment: two mechanisms where one was wanted,
which is the failure `CLAUDE.md` § Prefer simple over easy names outright.
