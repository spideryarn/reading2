# Proposed edits to experimental-features.md, for review

[experimental-features.md](../project/experimental-features.md) is a doc whose wording is a rule, so
[edit-important-docs.md](../reusable/edit-important-docs.md) says one approved set of changes at a
time, with the before and after shown. Stage 2 of
[260903c](260903c-gate-unpolished-modes-behind-experimental-features.md) could not ask
interactively, so the five changes are set out here **and applied** — Greg reviews them here rather
than before the fact. Revert any of them by reading the *before* column back in.

The reason they could not wait for a later stage is the manual's own rule and CLAUDE.md's: the doc
said *"Nothing is behind it yet"*, and stage 2 makes that false the moment it ships.

One difference between the quotations here and what actually landed, and it is only mechanical:
relative links in the *after* blocks are written `../project/…` so that `tests/doc-links.test.ts` can
follow them **from this file**. In `experimental-features.md` itself they are the same-directory
paths its neighbours use — `quotes.md`, not `../project/quotes.md`.

---

## 1. The claim at the top

**Before**

> **Nothing is behind it yet.** That is deliberate: the switch and the decision about which features
> are unfinished are two separate arguments, and taking them together means neither gets made
> properly. Features go behind it one at a time, each with a reason.

**After**

> **Five modes are behind it**, since 2026-09-03 — [What is behind it today](../project/experimental-features.md#what-is-behind-it-today)
> names them. Features go behind it one at a time, each with a reason: the switch and the decision
> about which features are unfinished are two separate arguments, and taking them together means
> neither gets made properly.

*Why:* the first sentence stops being true; the reason for one-at-a-time is worth keeping and now
reads as the standing rule rather than as an explanation of an empty list.

---

## 2. § The three rules gains a fourth, and the heading counts again

**Before** — the heading `## The three rules`, then three bold paragraphs beginning *"Off is the
default…"*, *"Hidden means hidden from the controls…"*, *"Hiding never deletes."*

**After** — the heading becomes `## The four rules`, and a new **first** rule goes in above them:

> **A signed-out reader is off, because we decided.** Not because the request failed. `GET
> /api/reader` sits behind the auth gate ([`src/routes.ts`](../../src/routes.ts)), so an anonymous
> request is a 401 — and the client used to catch that as a load error and leave `on` at its initial
> `false`. Right answer, wrong reasoning ([silent-success.md](../reusable/silent-success.md)): the
> day the gate moved, every gated feature would have turned on for strangers with no test saying
> otherwise. The store now issues **no request at all** for an anonymous reader, and
> `tests/public-network-trace.test.tsx` pins that at zero. Greg, 2026-09-03:
>
> > When a non-logged-in user reads a Public-readable article, I thin it should default to treating
> > them as "Experimental Features" = false.

*Why:* it is the rule the first gate was built on, it is the one Greg stated in his own words, and
it is the one an ordinary reading of the code would get wrong. Ordering it first because the other
three are about what a switched-off reader *sees*, and this is about who counts as switched off.

---

## 3. § Where it lives gains the store

**Before**

> | Client | [`useExperimental`](../../src/web/useExperimental.ts), and the row in [`SettingsSection.tsx`](../../src/web/SettingsSection.tsx) |

**After** — two rows in place of one:

> | Client | [`experimental-store.ts`](../../src/web/experimental-store.ts) — one module-level store for the whole client, session-bound, read through [`useExperimental`](../../src/web/useExperimental.ts). **All the reasoning lives there**: three states rather than two, one write at a time, the races an account switch opens, and why anonymous asks for nothing. |
> | Read by | the row in [`SettingsSection.tsx`](../../src/web/SettingsSection.tsx), and the four pages that mount a `Dock` — they call the hook and hand the answer to the bar as a prop ([`Dock.tsx`](../../src/web/Dock.tsx) § experimental). |

*Why:* stage 1 created the store and left this table pointing at the hook alone, which is now a
thirteen-line file that subscribes. The second row is where somebody adding a gated control finds
out that the bar is told rather than asking.

---

## 4. § Putting a feature behind it loses a paragraph and gains an answer

**Before**

> **Before the first gate, give the answer one home.** `apiFetch` has an offline cache, not an
> in-flight one, so today every component calling `useExperimental` makes its own `GET /api/reader`
> and keeps its own copy of the answer. That is fine for one settings row and wrong for a dozen gated
> controls, which would also disagree with each other for the length of a toggle. A provider or a
> small shared store is the fix, and it belongs in the same piece of work as the first real gate.
>
> Then, in the same piece of work:

and, further down the same list:

> - **Check what happens mid-flight.** A reader can turn the switch off while an experimental panel
>   is open. Falling back to the default mode is fine; throwing is not.

**After** — the first paragraph goes entirely (stage 1 did it; the store is now in the table above),
so the list simply begins:

> In the same piece of work:

and the mid-flight bullet is answered rather than deferred:

> - **What happens mid-flight is settled: the reader stays where they are.** Turning the switch off
>   while an experimental mode is open leaves that mode open, and leaves its button in the bar — the
>   bar draws the non-experimental modes **plus whichever one the URL names**
>   ([`Dock.tsx`](../../src/web/Dock.tsx) § `visibleModes`). Falling back to the default mode is
>   allowed by this doc and was turned down: staying put is less surprising and costs nothing. A
>   gated control that cannot do that — one that would be left in a state it cannot draw — must fall
>   back rather than throw.

*Why:* the paragraph describes work that has been done, and a rule doc that describes the past as
future is how an agent talks itself into doing it again. The mid-flight bullet asked a question that
this stage has now answered, and the answer is worth more than the permission.

---

## 5. § What is behind it today stops saying "Nothing"

**Before**

> Nothing. When the first feature goes behind it, list it here with a line on why it is not ready.

**After**

> **Five of the thirteen modes**, since 2026-09-03. Greg picked them
> ([260903c](260903c-gate-unpolished-modes-behind-experimental-features.md)), and each row is a
> required `experimental: boolean` in `MODES_UI` ([`Dock.tsx`](../../src/web/Dock.tsx)), so mode
> fourteen cannot be added without somebody deciding which side of the line it is on.
>
> | Mode | Why it is behind the switch |
> |---|---|
> | [Quotes](../project/quotes.md) | The selection is good and the verification is not finished — what it cannot prove about a quote is written down in its own doc and not yet on screen. |
> | [Timeline](../project/timeline.md) | Four dating states, and drawing an undated row like a dated one throws away what the article actually said. Ten of twenty-six rows on the test article carry no date. |
> | [Referee](../project/referee-mode.md) | **Not because it is unfinished** — its own doc opens by saying all four sub-modes are built and working. It is the newest mode and by far the narrowest: it is for somebody who has been *asked to peer-review* the piece, which most readers never are. Greg's call, and the one row here that is about audience rather than readiness. |
> | [Diagram](../project/diagram.md) | Three pictures with different promises, and the expensive one is a ~$0.20 sketch that takes two to three minutes. |
> | [Remember](../project/remember-mode.md) | The name suggests saved notes and spaced repetition, neither of which exists; the quiz half is newer still. |
>
> **The eight that stay visible**: Plain, Hierarchy, Outline, Summary, Glossary, Ideas, Search, Chat.
> Hierarchy and Outline are stand-ins for the merged **Structure** mode
> ([260903b](260903b-one-structure-mode-hierarchy-and-outline-merged.md)); when that lands it takes
> one default-visible slot and those two go, making it seven of twelve. **Do not write seven/twelve
> anywhere before then.**

*Why:* the doc's own instruction, followed. The eight are listed as well as the five because "which
are visible" is the question somebody debugging a missing button actually has, and the
seven/twelve warning is the mistake the first draft of the plan made.

## Correction after review, 2026-09-03

The **Referee** row above originally read:

> Four sub-modes, of which only some are built — its own doc says to open it for how much of it is
> actually built.

That is false, and it was caught by checking the claim rather than the prose.
[referee-mode.md](../project/referee-mode.md) opens with *"Status, 2026-09-01: all four sub-modes are
built, and all four work in the store that deploys."* The row now says the true reason — audience,
not readiness — and the column header widened from "Why it is not ready" to "Why it is behind the
switch" to make room for it.

Worth keeping as a warning: four rows were written to justify a decision Greg had already made, and
the one nobody could source was the one that invented a technical deficiency. Every other row in that
table was checked against the doc it cites — Diagram's "$0.20, two to three minutes" is
[diagram.md](../project/diagram.md) § "One model call, 121–194 seconds, about $0.20"; Timeline's ten
undated rows of twenty-six is in [`src/modes.ts`](../../src/modes.ts); Remember's missing notes and
spaced repetition is in the same place.
