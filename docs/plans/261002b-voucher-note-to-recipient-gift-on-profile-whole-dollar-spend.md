# 261002b — a note to the voucher's recipient, gifts on /profile, whole-dollar spend

Three suggestions from Greg, filed on 2026-10-01 and dispatched by the Overseer on 2026-10-02 with no
Sentry mirror. They touch the same two pages (the voucher admin, the reader's plan), so they are one
plan with three stages.

> In the gift vouchers page, you've got a private note field, which is great. Can you also add a
> note for them so that I can add a sentence or two that they will see? So I might say, oh, it was
> great to meet you earlier today, blah, blah, blah.
>
> And can you also give a small indication of what the gift voucher email that gets sent will look
> like and where my "note for them" would go?
>
> — Greg, 2026-10-01 (`spya-hc5q0e`)

> If a user has received a gift voucher, then make that a bit more visible in the profile, a little
> bit like you do already on the logged in homepage.
>
> Make sure there are tooltips and stuff in both cases that are linked to the pricing page and
> explain the model and when the monthly limits will reset and what they'll reset to. Just generally
> make sure that as much as possible it's clear to the user where they stand and how it works and
> what will change.
>
> Maybe make these be reusable UI components across both these places. Use your judgment.
>
> — Greg, 2026-10-01 (`spya-x9taw3`)

> For the spend column on https://www.spideryarn.com/admin/users , round to integer dollars (with
> exact figure as tooltip)
>
> — Greg, 2026-10-01 (`spya-cm0qa7`)

Background: [261001m](261001m-gift-vouchers-for-free-articles.md) (vouchers),
[261001p](261001p-voucher-emails-to-recipient-and-creator.md) (their emails, an outbox rendered and
frozen inside the event's transaction), [261002a-fb99](261002a-fb99-voucher-email-for-existing-user.md)
(the existing-reader wording, landed on dev before this started).

## Stage 1 — a note to the recipient, and a sketch of the email

**Data.** A new nullable column `billing_vouchers.recipient_note`, `≤ 500` characters by a check
constraint, beside the private `note`. Parsed the way `note` is (trimmed, blank is null, length
checked) on `POST` and `PATCH /api/admin/vouchers`; it rides the wire as `recipientNote`. A replayed
create compares it too, so the same id with a different note is a `conflict`, not a `replayed`.
Additive migration only.

**The email.** Both audiences (invite and existing reader) carry the note, **directly under the
heading and before anything we wrote**, as a quoted block: a left rule in the HTML, the lines as
they are in the text part. It is the first thing the recipient reads and is plainly a person
talking, which is what *"it was great to meet you earlier today"* wants. No label: the email is
already from Spideryarn and Greg can sign it. Never in the subject. *(Changed after review, F4: it
was labelled "A note from the person who gave you this gift:", in both parts. Changed back on
2026-10-02, after Greg answered Q-voucher-note-label: "Maybe just italicise the note from me, and
add a tooltip or something in the interface to remind me to sign my name". So the label is gone,
the note is in italics in the HTML and on its own lines in the text part, and the create form on
`/admin/vouchers` has a line under the box: "Sign it yourself, e.g. '— Greg'".)*

**It is untrusted on render** ([security-map.md](../project/security-map.md)): text written by one
party and drawn in a stranger's mail client. The HTML part escapes `& < > " '` and turns newlines
into `<br>`; nothing else of the note reaches markup. The text part takes it as is (it is text). A
test puts `<a href=…>` and `<script>` in a note and checks the HTML carries them escaped and the
subject not at all.

**Frozen, like the rest.** The email is rendered when it is queued, so **editing the note does not
re-send** and does not change an email already queued. A re-address (which already sends a fresh
email) renders with the note as it stands after the patch. The admin page says this beside the field
when editing.

**The sketch.** A small mock of the email under the create form, updating as Greg types: the
subject, the heading, his note in place (or a dim *"your note to them goes here"*), then one line
standing in for the body and the button — *"…then a short paragraph on what Spideryarn is and how
to collect the articles, and a Sign in button"*. The subject and heading come from one function in
`src/admin-vouchers.ts` (already a browser-importable flat module) that the server's renderer now
also calls, so the sketch's wording cannot drift from the email's. **The body is described rather
than quoted**, deliberately: quoting it would need the whole renderer in the browser (it depends on
the billing arithmetic and the URL constants), and a summary that names the parts is what *"a small
indication"* asks for.

**Simpler option passed over:** a full-fidelity preview — the real HTML in a sandboxed iframe, via a
preview endpoint. More true, but a new admin route and a request per keystroke for what Greg called
*a small indication*. If he wants the exact email, that is the next step.

The privacy page's Resend line gains *"with a short note from whoever gave it, if they wrote one"*.

## Stage 2 — gifts and "how this works" on /profile and the homepage, as shared components

Today the homepage's free-allowance box has a gift notice, a gift icon on the count and a collapsed
*How free articles work*; `/profile`'s plan card (BillingSection) has the headline and detail line
only, and mentions gifts only as *"(3 free + 20 from a gift)"* inside the headline.

New `src/web/PlanHelp.tsx`, three components used by both pages:

1. **`GiftList`** — each gift with its article count and the date it was added, and what it is
   doing: *counting now* on Free, *waiting until you are on the Free plan* on a paid plan. On
   `/profile` it is a highlighted panel like the homepage's notice; on the homepage it stays inside
   the collapsed section, as now (the fresh-claim notice above the count stays where it is).
2. **`PlanInfo`** — a small (i) beside the plan headline: **a link to `/pricing`** whose hover/focus
   tooltip says the one thing a reader most needs — what the allowance is, whether and when it
   resets, and to what. Free: *"3 articles for the life of the account (3 free + 20 from a gift).
   It does not reset each month."* Paid: *"20 articles a month. It starts again on 3 Nov, back to
   20; unused ones do not carry over."* Ending: the date and that it then goes back to the free
   allowance. A tap on a phone follows the link.
3. **`HowYourPlanWorks`** — the collapsed explainer, written per plan kind (it is the homepage's
   *How free articles work* moved into the shared component, plus a paid version: monthly, resets on
   the renewal date to the tier's allowance, no rollover, public counts half, reading never limited,
   cancelling returns to the lifetime free allowance), with a link to Pricing.

The tooltip and explainer sentences are functions in `src/billing-plan.ts` beside `describePlan`
(tested without a DOM, one source for both pages).

**Two server additions, both to `GET /api/billing/usage`'s paid arm:**

- **`gifts` on the paid arm too.** Today it is on the Free arms only, so a subscriber who was given
  a voucher sees nothing anywhere; Greg asked for gifts to be visible on the profile. Absent when
  none, as on the Free arms.
- **`periodAllowance`**, the tier's own per-month number (the `billing_tiers` row). `limit` can be a
  prorated figure after a mid-month switch, so *"back to 20"* has to come from the row, not from
  `limit`. *(Changed after review, F5: no fallback to `limit`; null when the tier row is not found,
  and the copy then names no number.)*

**Simpler option passed over:** text-only tooltips with no shared components, i.e. one more
paragraph on each page. Greg asked for reusable components, and the two pages already say the same
facts in two hand-kept places (the homepage's bullets and the pricing FAQ).

## Stage 3 — whole dollars on /admin/users

The Spend cell shows `$3` instead of `$3.1416`; the exact figure (today's `formatSpendNanos`) moves
into the cell's tooltip with the call count and period. A non-zero amount under 50 cents shows
**`<$1`**, not `$0`, because `$0` with a currency sign reads as free, which is the reason the column
refused `$0.0000` in the first place. No calls stays an em dash. Sorting is unchanged (by nanos).

## Tests

- Store/route: recipient note round-trips create, patch, list; blank is null; 501 characters is a
  400; a replay with a different note is a conflict.
- Email: the note appears in both audiences' text and HTML, escaped in HTML, never in the subject;
  no note means no empty block; the claimed notice never carries it.
- Plan copy: tooltip and explainer sentences per plan kind (free, gifted free, lapsed, paid
  renewing, paid ending, paid with a waiting gift).
- Components: profile draws `GiftList` when gifts exist and nothing about gifts when none.
- Spend: `$3`, `<$1`, em dash, exact figure in `title`.

Then a browser check (Sonnet subagent) of `/admin/vouchers`, `/profile` and the homepage.

## Plan review (GPT Sol, 2026-10-02)

Prompt: [261002b-voucher-plan-review-prompt.md](261002b-voucher-plan-review-prompt.md); answer:
[261002b-voucher-plan-review-sol.md](261002b-voucher-plan-review-sol.md). *"The three-stage approach holds … It
should not be built unchanged."* Every finding taken:

1. **P1 — an ending plan must not suggest a fresh free allowance.** Articles added while subscribed
   count against the lifetime free allowance, so the ending copy says so, not "goes back to the free
   allowance" alone.
2. **P2 — trials.** A trial is a paid arm whose renewal is not established, so the paid arm carries
   whether it is a trial, and a trial's copy promises no reset.
3. **P2 — the re-address renders the note as it stands after the patch**: the stored note, read
   under the voucher lock, overridden by the patch's. Built that way and tested (an edit alone sends
   nothing; a later re-address carries the saved note; both at once carry the new one).
4. **P2 — provenance and control characters.** The note is labelled in both parts (no longer,
   since 2026-10-02: Greg signs it instead; see **The email** above); `noteText`
   (src/email.ts, beside `oneLine`) turns CR, CRLF and the Unicode separators into one newline and
   every other control character into a space, on the way in and again at render. Tested with NUL,
   CR, U+2028/9 and tab.
5. **P2 — `periodAllowance` has no fallback to `limit`**, which may be prorated.
6. **P3 — the gifted example's headline number**: the tooltip says 23, made of 3 + 20.

Also adopted: the $0.499999999 / $0.50 boundary is pinned in the spend test.

## Code review (GPT Sol, 2026-10-02)

Prompt: [261002b-voucher-code-review-prompt.md](261002b-voucher-code-review-prompt.md); answer:
[261002b-voucher-code-review-sol.md](261002b-voucher-code-review-sol.md). (The review files carry a
`voucher` prefix because three other pieces of work were also named 261002b that day.) Sol fixed
five findings in place:

- trial and scheduled-ending copy that over-promised;
- the recipient-note limit checked on both the raw and the cleaned text, in code points;
- the paid wire shape in `billing-usage-route`;
- a short accessible name and a 40px touch target on the (i);
- more regressions for control characters and for the frozen outbox.

Its sandbox could not reach Postgres, so the three database-backed files were run afterwards
outside it: all green.

## Verification

- **Touched suites:** 283/283 pass.
- **Full suite:** 16 reds in 9 files, sorted one by one:
  - two guards that wanted a line for the new code: the two note textareas are `newline` boxes,
    and `<$1` is an admin-only figure. Both were added.
  - five files that need a build to inspect, green after `npm run build` and `npm run build:fleet`;
  - two contention flakes, green when run alone.
- **Browser** (Sonnet subagent, Playwright): `/admin/vouchers` (note, sketch, edit, 390px), and a
  claimed gift on `/profile` and the shelf (tooltip on hover and focus) are checked. On
  `/admin/users`, `<$1` and the em dash are checked. `$N` was not checked, because no local account
  spends a dollar; the unit tests cover it.
- **Merging dev** collided with `20261002100053_job_dismissed_at` at journal index 115. Neither
  migration is in production, and only this one was applied to the shared local database. They
  touch disjoint tables, so they were merged per database.md § Repairing a fork: both kept, in
  `when` order (this one 115, `job_dismissed_at` 116), with that migration's snapshot rebuilt onto
  this one's. `db:chain` is clean, and `db:generate` finds no schema changes.
