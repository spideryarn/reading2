# Your earlier feedback: a second tab in the Feedback dialog

Sentry SPIDERYARN-READING2-3R, a suggestion from an admin (Greg), 2026-09-12 10:45Z, filed from
`/read/temporal-context-reinstatement-spya-dhqkf9` on build `d358f773`.

> In the feedback dialog box, it would be nice to have a tab showing previous feedback that this
> user has provided, just as a kind of list. I mean, it would be amazing if we could indicate which
> ones have been acted on, but I suspect that will involve access to the database that you
> currently don't have. So do the simplest thing first.
>
> — Greg, 2026-09-12

Parent: [feedback.md](../project/feedback.md). Ending, if it lands: **shipped**.

## What we are building

The Feedback dialog gets two tabs in its header: **Write** (everything it has today, unchanged) and
**Earlier** (the signed-in reader's own previous reports, newest first — the date, whether they said
problem or suggestion, and what they wrote).

```
┌ Feedback ─────────────────────── ✕ ┐
│ [ Write ]  [ Earlier ]              │
├─────────────────────────────────────┤
│ 12 Sep 2026 · Suggestion            │
│ In the feedback dialog box, it      │
│ would be nice to have a tab …       │
│ ─────────────────────────────────── │
│ 9 Sep 2026                          │
│ The shelf takes a long time to …    │
├─────────────────────────────────────┤
│                             [Close] │
└─────────────────────────────────────┘
```

**Not built: whether each one was acted on** — Greg names it as the harder later step. § Deferred
says what it would take.

## Design

### Server: one owner-scoped read, the shape every other one has

- **`FeedbackStore.listMine(limit)`** in [`src/store/pg-feedback.ts`](../../src/store/pg-feedback.ts):
  `where owner_id = currentOwnerId()`, `order by created_at desc, id desc`, `limit + 1` rows so the
  answer can say whether there were more. It selects **only** `id`, `created_at`, `kind`, `body` —
  not the reporter email, the URL, the diagnostics blob, or the screenshot. The owner is never an
  argument, exactly like `submit` and `read`, so a caller cannot ask for somebody else's list.
- **`GET /api/feedback`** beside the existing `POST`, behind the same gate: `{ reports, more }`,
  `Cache-Control: private, no-store` said explicitly as `/api/admin/feedback` does.
- **The cap is a constant, 50**, with `more: true` when the reader has filed more than that. No
  paging: a reader with fifty reports is Greg, and he has `/admin/feedback`. The dialog says
  "Showing your 50 most recent" when `more` is true, so the truncation is never silent.

**This does not change a defence.** Owner scoping in this app is the `owner_id = currentOwnerId()`
predicate in each store query, with the owner set only from the gate's `VerifiedUser`
([security-map.md](../project/security-map.md)); this adds one more query of that exact shape, on a
table that already has two. No RLS, auth, gate or admin change. If review finds otherwise, stop and
write it up for Greg.

**Why these four fields and not the URL.** The URL can carry `?q=`/`?find=` and an `/add/<url>`
with a credential in it ([feedback.md § The one rule](../project/feedback.md#the-one-rule)). It is
the reader's own, so showing it is not a leak, but a list whose job is "what did I say" does not
need it, and a field not sent is one nobody has to argue about. Named as a later addition.

### Client: two tabs, and the draft never unmounts

- A `view: "write" | "earlier"` state in `FeedbackDialog`, reset to `"write"` each time the dialog
  opens — pressing Feedback is a request to write.
- **The Write panel is hidden, not unmounted**, when Earlier is showing (`hidden` on its scroll
  area and its action row). The draft already lives in the dialog's state, but the textarea, the
  dictation hook's ref and the file input do not survive an unmount cleanly, and this dialog's whole
  history is draft-loss bugs (`discard`'s header). Hiding is one attribute and cannot lose anything.
- **⌘/Ctrl+Enter sends only from Write.** From Earlier it does nothing — a keystroke should not file
  a report the reader cannot see.
- **Earlier fetches each time it is opened**, so a report filed a minute ago is there. Three
  states: loading (the house spinner), failed (a sentence with a bracketed code, in
  `src/messages.ts`, and a Try again), and the list — or, empty, "You haven't sent us any feedback
  yet." A generation counter drops an answer that arrives after the reader has switched away and
  back, the same pattern `shotGeneration` uses.
- Tabs are `role="tablist"`/`role="tab"`/`aria-selected`/`role="tabpanel"`, with Left/Right arrows
  between the two — the ARIA tabs pattern, two buttons' worth of it.
- The thank-you panel after a send is unchanged and has no tabs; a report just filed shows up in
  Earlier the next time the dialog is opened.
- Body text is rendered as text with `white-space: pre-wrap`, never as HTML. Long bodies are shown
  whole: the reader wrote them, and a clamp would need an expander.

### Where each fact goes

- [feedback.md](../project/feedback.md): a section, *Your earlier reports*, and a row in *Where the
  code is*.
- [privacy.md](../project/privacy.md): nothing changes about what is collected or who sees it; a
  reader reading back their own rows is not a new flow. Checked, not edited, unless it lists the
  reader's access to their data.

## Stages

1. **Server** — `listMine`, the route, the contract row. Tests first, watched red:
   `tests/feedback-store.test.ts` (two owners: each sees only their own; newest first; `more` at
   the cap; no screenshot bytes or email in the rows), `tests/feedback-route.test.ts` (the GET hands
   back exactly the four fields per row even when the store row carries more; `no-store`),
   `tests/authenticated-api-route-contract.test.ts` (`GET` added to the `/api/feedback` row and the
   counts moved by one). Done = those green, typecheck clean.
2. **Dialog** — the tabs, the three states, the guards above. Tests first in
   `tests/feedback-dialog.test.tsx`: switching tabs keeps the draft; Earlier renders the list, the
   empty sentence and the failure; ⌘Enter from Earlier sends nothing; reopening lands on Write; a
   late answer from an earlier fetch is dropped. Then CSS, the doc, and a real browser (Playwright
   on the box, in a subagent). Done = green, screenshots of both tabs at desktop and phone width.

Each stage: GPT Sol code review (workspace-write), then commit. Full suite once at the end through
`scripts/tmux-job.ts`, load permitting.

## Deferred: showing which reports were acted on

The facts exist, but not in the row the reader's list comes from:

- whether a report ended **shipped**, **declined** or **awaiting Greg** is written by the agent that
  handled it, into `docs/user-feedback/<note>.md` and into the Sentry issue's status;
- the only link from a row to that issue is `feedback.sentry_event_id`.

So the options, roughly in order of cost:

1. **A `status` column plus a one-line note on `feedback`, set by Greg on `/admin/feedback`.**
   One migration, one admin-only PATCH, and the reader's list shows it. Manual, but correct, and it
   does not need an agent to hold production credentials.
2. **The feedback sweep writes the same column** through that admin endpoint, from the note it
   already writes. Needs an admin credential for the sweep, which today it does not have — Greg's
   guess in the report is right about that.
3. **Read Sentry's issue status at request time.** Couples a reader-facing page to a third party's
   API and its rate limits; no.

Option 1 is the natural next step and is Greg's to ask for.

## The simpler options passed over

- **A link to a page (`/profile/feedback`) instead of a tab.** A whole page and a route for a list of
  a few items; Greg asked for a tab, and the dialog is where a reader thinks about feedback.
- **No list cap, no `more`.** Unbounded rows into a dialog; a cap costs one constant and keeps it
  honest.
- **Unmounting the Write panel** — simpler JSX, but see above.

## Log

- 2026-09-16: plan written.
