# "2 accounts", one row: what was ruled out, and a count taken off the table

Greg, 2026-09-03:

> In https://www.spideryarn.com/admin/users , it says "2 accounts", but only lists one!

and, asked how many accounts he expected:

> Whatever is the right answer! In this case, I think the right answer is 1 (greg@gregdetre.com).
> But whatever the answer is, the number of rows and the number in the text above should match! And
> also indicate if a row is an admin user or not.

## What the evidence says, and what it does not

The number and the table are drawn from one array in one render of
[`AdminPage.tsx`](../../src/web/AdminPage.tsx) — `users.length` for the words, `sorted` for the
rows, where `sorted` is the table's row model with the unsortable rows moved to the bottom. So the
first job was to find out how those two can disagree. Four measurements, none of which reproduced
it:

- **A real browser, on the local stack, eight times.** Initial load, three reloads, three presses of
  Refresh: `"10 accounts"` above ten `<tr>`, every time, no row of zero height, none with
  `offsetParent === null`, no console warning, ten distinct ids in the response.
- **React does not drop a row with a duplicate or missing key.** Measured rather than assumed, at
  mount *and* on an update: three rows with two identical keys render three `<tr>`. So a duplicate
  account id — the obvious mechanism, and the one that would explain a shortfall of exactly one —
  does not produce this.
- **TanStack's row models do not deduplicate.** `getCoreRowModel` pushes every row into `rows` and
  keys `rowsById` beside it; `getSortedRowModel` copies and sorts. Neither consults the other. Read
  in `node_modules`, not inferred.
- **Production is running this exact code.** `main-BpxfKpeI.js` off spideryarn.com contains
  ``e.length===1?`1 account`:`${e.length} accounts` `` beside the same `getRowModel().rows` and the
  same `sinkLast`. Not an older build, not a stale chunk.

**So no path was found by which the deployed page could print a number larger than the rows it
draws** — not through React, TanStack, `sinkLast`, the memoisation, the CSS, or the server, and GPT
Sol went looking for one too and came back with none. There is no production database access from
this box and no Vercel credential, and Greg asked us to reason it out rather than fetch the
response, **so this plan does not claim a root cause.** What is written down is what was ruled out,
so that the next person does not rule it out again.

An earlier draft named a cause — two accounts holding one address, one person read as two — and
Sol was right to knock it down: Supabase links a verified OAuth identity to the existing account on
that address, and the two ids in `ADMIN_USER_IDS` are one laptop and one production project, not
two accounts in one project. Two rows on one address remain *possible* (SSO, the admin API, old
data) and they are worth a rendering test, but they are not a diagnosis and this document does not
offer one.

## What changes

Three things, smallest first.

1. **The count counts the rows the table is drawn from.** `sorted.length`, not `users.length`.
   Today those are provably equal, so this changes no pixel — what it removes is the second number,
   and with it any divergence between the list and the row model.
2. **The assertion lives a step nearer the rows.** `sorted.length` is what is *handed to* the
   renderer, not what the DOM ends up holding, so a test reads the number back out of the rendered
   words and compares it with the `<tr>` count. **That is structure, not visibility** — neither the
   change nor the test can rule out a row that renders and cannot be seen, and neither claims to.
3. **The administrator's own row says so.** `isAdmin(row.id)` — the id list the `/api/admin` gate
   itself compares against, already in the browser bundle — draws a small `admin` marker. Greg's
   explicit ask. Positive only: no marker means not an administrator, which is what an absent badge
   conventionally means.

   **It goes under the address, not beside it, and it is a tinted word rather than a bordered
   pill** — both decided by measuring rather than by taste, in a real browser at 1280 and 390.
   Beside the address, at 390px, the pill took the whole of the fluid column: the email span was
   squeezed to zero width and the administrator's own address became the one address on the page
   that could not be read. The column collapses like that because it is `w-full max-w-0` and the
   table scrolls sideways; anything that will not shrink wins it. Moved below, the border and
   padding then made that row 58px against every other row's 53px, and the uppercase tracking still
   overhung the column edge by 5px — so the border and the capitals went too.

And one repair found on the way, fixed on its own merits rather than as an explanation of anything:

4. **`email unconfirmed` was hidden when an account had no linked provider.** The whole sub-line
   under the address sat behind `providers.length > 0`, so an account with neither drew nothing at
   all — the row that most needs a word under it. The gate becomes "has this line anything to say".

### What was designed and then removed, and why

A **shortfall message**: `accountsLabel(drawn, received)` printing *"1 of 2 accounts — 1 not
drawn"* in red whenever the list was longer than the table. It was written, tested and taken out
again after Sol's review, and the finding is worth keeping because it is a good one:

> `sorted.length` is the number of rows *supplied to* the renderer, not the number "actually
> drawn". … It cannot detect a React reconciliation failure, CSS-hidden row, rendering exception, or
> anything else that could explain the reported observation. Its deliberately unreachable pure-
> function test proves invented wording, not the reported invariant.

Which is exactly right: it was a guard that named the reported bug and could not have caught it,
carrying an unreachable branch and a test of its own prose. The honest version of the same intent is
item 2 — an assertion against the DOM, where the rows actually are.

## The simpler option, and why not

**Change only the count and stop.** It is one word of diff and it satisfies the letter of "the two
numbers must match". Rejected because it leaves Greg exactly where he started — a page saying two
where he believes one — and because he asked for the admin marker in the same breath.

**Carry the Auth service's own `x-total-count` through to the browser and print "1 of 2 accounts".**
This is the version that would expose a *server-side* drop: `accountFrom` drops soft-deleted
accounts and `mergeUsers` drops accounts with no email address, and both are invisible today —
`listAccounts`' shortfall check deliberately counts arrivals *before* those filters, so a dropped
account leaves no trace anywhere. Deferred, and Sol sharpened why it should not simply be built
later either: `x-total-count` **includes** soft-deleted accounts, which this page has decided are
not accounts, so *"1 of 2"* could mean "one account and one deleted record" — a worse answer than
today's. If completeness is ever shown it wants an explicit breakdown (shown, deleted, no address),
not one ambiguous denominator. Either way it is a different bug from the one reported: it makes both
numbers smaller together rather than making them disagree.

## Tests

All in [`tests/admin-page.test.tsx`](../../tests/admin-page.test.tsx). Three of the four were
watched going red against the code before the change — though only for their *marker* assertions,
which is worth being precise about: the two-rows-on-one-address case had its row count and its
count label pass on the old code too, because those were never broken.

- **The number in the words is parsed back off the page and compared with the `<tr>` count** — the
  invariant Greg asked for, checked in the one place that can see rows. On the Alice/Bob pair, whose
  missing sign-up date is what `sinkLast` reorders.
- **The admin marker**: exactly one on the administrator's row, none on anybody else's, and the
  marked row is the expected one. Matched on the marker's exact text, because one fixture address is
  `dev-admin@spideryarn.local` and a substring test would have passed on the address.
- **Two accounts on one address**: two rows, a count of two, one marker. A rendering case, not a
  claim about production.
- **The unconfirmed note**, with its control: drawn for an account with no providers and no
  confirmation, and *not* drawn for one with no providers that is confirmed. Sol asked for the
  second half; without it, "always say it" would have passed.

A browser pass at 1280 and 390 checked the rest: the count and the `<tr>` count agree at both
widths, one marker and only one, the unconfirmed note on exactly the four local accounts whose
`email_confirmed_at` is null (cross-checked against the database rather than against the page), and
a clean console. It is also what found the 390px placement bug above, which no test in this repo
could have.

## Reviews

GPT Sol reviewed this plan before it was built (`gpt-5.6-sol`, high effort, 2026-09-03) and returned
**not ready**, correctly. Four of its findings changed the work: the shortfall guard came out
(above), the duplicate-address story stopped being a diagnosis, the `x-total-count` deferral gained
its real reason, and the marker's tooltip and comment stopped mis-stating why `ADMIN_USER_IDS` has
two entries. One finding is corrected in words rather than in behaviour: `mergeUsers`' comment said
an account with no address "owns nothing", which does not follow on an Auth project shared with an
older app — the comment now says so, the filter is unchanged, because what to show for an account
nobody can sign in as is a product decision rather than a bug.

It reviewed the built code too and **found no runtime defect** — the remaining findings were about
what the writing claimed, and all five were applied: the privacy inventory in
[admin.md](../project/admin.md) now names admin-page access as one of the account facts on show
(it is a fact, even though no new data crosses the wire); both documents stopped implying the
symptom is now impossible, when what the change removes is a *source-level* divergence and the test
sees structure rather than visibility; the `mergeUsers` comment was corrected properly rather than
half-way; and two test comments that still carried the discarded feature's reasoning were cut.

## Not in scope

No pagination, no writes, no new column, and nothing that names an article. **No new data crosses
the wire and no reading is exposed**: the marker is `isAdmin` of an id the row already carried. It
is still one more account fact on the page, so the exact inventory in
[admin.md](../project/admin.md) § What it deliberately does not show has been extended to name it
rather than left to imply otherwise — Sol's first finding on the built code.
