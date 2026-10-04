# A safe query does not prove a safe production script

Caught in review, before the registry backfill was run against production. The affected stage was
introduced by `af716df39`; no production data was changed by this review. Findings and verification
are in [the stage 2 review](../plans/261004h-year-visitor-backfill-code-review-2-sol.md).

The root-cause pass was delegated to a separate agent. Four boundaries were weaker than the
SQL update itself:

- **An endpoint mistaken for a database identity.** Host, port and database were compared, but
  Supabase's shared pooler routes projects by username. Tests compared different database names,
  repeating the implementation's assumption about what distinguishes databases.
- **A safe row lock mistaken for a safe lock order.** Each article was protected, but an editable
  plan chose the order in which locks were retained. App sweeps use actual slugs in `C` order;
  opposite orders can deadlock. A single-article publication race cannot detect this class.
- **A promise catch mistaken for all error handling.** Swallowing rollback errors preserved a
  completed plan only if execution reached rollback. An idle `pg` client emits a fatal `error`
  event independently of any query promise; without a listener it can terminate the process first.
- **Whitespace mistaken for a boundary between independent evidence.** PDF orientation groups
  were separated by a newline, but the arXiv matcher explicitly permits whitespace after its label.
  Sideways fragments were also joined without checking their positions. False candidates can be
  manufactured even though registry title and author checks still guard the eventual facts.

The class is **checking a safe operation while leaving its surrounding boundaries untested**.
The fix is to represent and test those boundaries directly: tenant-aware targets with explicit
connection fields, actual database lock order, an idle-error listener, and nonmatching PDF region
separators with geometric checks for fragmented stamps. Those fixes are in the working tree; this
review does not commit them. Postgres execution remains the author's gate.

What would have caught it, ranked by ease against value:

1. Cheap offline counterexamples: two tenants at one endpoint, an idle `error` event, and an
   arXiv label and digits in independent regions. Added, observed failing before the fixes, then
   passing. These defend the boundaries, rather than the implementation's chosen representation.
2. One real database overlap in opposite proposed article order. Added for the author to run,
   together with a draft-in-flight case. Observe actual blocking PIDs rather than assuming elapsed
   time establishes a lock wait. These cost a database run, but establish the concurrency contract.
3. Cryptographically attest every plan or introduce a second environment and a new pooling layer:
   rejected. The plan is deliberately a reviewed instruction file; signatures would not fix tenant
   identity, lock order, event handling or PDF reconstruction. A staging copy would also not expose
   the omitted shared-pooler username without the counterexample.

I would test the surrounding boundaries before trusting the update's null guards. A protected
statement is only one part of a production script, and the cheapest counterexamples here needed
neither network access nor a production database.

Up: [Postmortems](../project/postmortems.md)
