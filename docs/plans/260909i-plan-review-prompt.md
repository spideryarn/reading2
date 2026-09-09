# Plan review: 260909i, a team box for a separate product, one Overseer that carries each person's authority

Read-only. Review the plan at
`docs/plans/260909i-a-team-box-for-a-separate-product-one-overseer-that-carries-each-person-s-authority.md`
in `/home/greg/code/spideryarn2` at revision `7e6cd14a`. Change nothing; start no session.

The plan is a **design**, not code, and it is held: Greg has said not to implement until the
Overseer dispatches it, and it depends on `docs/plans/260909h-…` (the extraction of the Overseer,
dashboard and `gjd-remote` into their own repo) landing first. So review the *design* and the
*stages*, and say what would go wrong when it is built.

Context to read first:

- The research it came from, with GPT 6 Astra's review folded in:
  `docs/research/260909b-a-shared-team-box-with-one-overseer-several-people-and-several-claude-accounts.md`
  and `docs/plans/260909b-team-box-review-astra.md`.
- `docs/project/overseer.md` — the runbook and its four gates, which the plan extends to several
  people.
- `docs/project/overseer-direction.md` § Access, § The backlog (A5, A7, A12), § Appendix.
- `docs/plans/260909g-…` — the accounts registry the plan extends with an `owner`.
- `tools/fleet/wire.ts` (`Speaker`, `QueueActor`, `DecisionWireActor`), `tools/fleet/routes-steer.ts`,
  `tools/fleet/routes-new.ts`, `tools/fleet/queue.ts`, `scripts/overseer-queue.ts` — where a
  `Person` would have to go.

What we most want checked:

1. **The authority model** (§ The authority model). Is "the Overseer carries the asker's authority
   plus a uniform operator list; product authority is never its own; a refusal becomes a proposal
   in the owner's inbox" actually sufficient, and is it checkable by a program? Find the request
   that slips between the three classes (owner / operator / product), or the case where the
   Overseer is asked something that is *both* operator and owner. Find what happens to a task whose
   owner has left, or is asleep for a week.
2. **Does it really settle "one Overseer vs one per person"**, or is there shared state (its
   conversational context, its decision log, its pause/resume bookkeeping) that leaks one person's
   intent into another's?
3. **Accounts**: with "only the owner steers the owner's agents", is "personal accounts, chosen by
   the task owner" complete? What about the Overseer's own sessions, hand-over mid-task, a helper,
   Codex review runs, a resumed session?
4. **Identity via `Tailscale-User-Login`**: what does the plan assume about Tailscale that it has
   not verified? What about the `gjd-remote` route with `PermitUserEnvironment`?
5. **The stages**: are they in the right order, is any one of them secretly two, and is Stage 3
   ("one function classifying an action") honest about its size?
6. **What it passed over**: is the simpler option (see-all steer-all with a stamp) actually
   simpler once the Overseer is involved, as the plan claims?

Rank findings P0/P1/P2. Be concrete: name the file or the sentence. Say what you did not verify.
