# A rendering override becomes an unrequested persistence command

Found reviewing [261003i stage B](../plans/261003i-quick-search-eval-thorough-replaces-quick-colour-key-and-no-wash.md),
introduced by `bddc97fbc`. Root cause independently checked in a subagent.

[`useSearch.ts`](../../src/web/useSearch.ts)'s `chosen` map deliberately remembers this
tab's last colour to protect its display from late streamed snapshots. The new same-ID
`begin` branch treated every mismatch with that map as an unsaved choice. After this tab
picked 2 and another picked 5, a quick revision or retry reporting 5 silently PATCHed 2
back. A presentation override had become permission for a fresh persistence command.

The regression tests in [`use-search.test.ts`](../../tests/use-search.test.ts),
“does not write an old tab choice back”, failed for both revision and retry:
`begin silently overwrote the other tab's colour: expected … a length of 1 but got 2`.
Existing tests covered local display precedence, ordered PATCHes and revisions separately;
none varied the server colour between attempts and counted the new writes.

The fix keeps the enduring display override and tracks inherited colours awaiting their
first acknowledged row separately. That intent survives a failure before `begin`, is
consumed at `begin`, and is dropped on deletion or departure. A renamed row still uses
the existing transfer path. This separation is also the long-term fix: display precedence
cannot tell whether a persistence command remains outstanding.

Countermeasures, ranked by ease against value:

1. **Assert writes independently of paint**, including a newer server value and a new
   unpersisted local value. Added revision/retry regressions and a pre-begin failure/retry
   positive control; they distinguish historical preference from outstanding intent.
2. **Keep presentation and pending commands in separate state.** Implemented here with
   a one-time pending set rather than inferring intent from a value mismatch.
3. **Server colour versions/conflict resolution** — rejected for this stage. They change
   wider multi-tab policy; the defect is a write the reader never requested.

Up: [Postmortems](../project/postmortems.md).
