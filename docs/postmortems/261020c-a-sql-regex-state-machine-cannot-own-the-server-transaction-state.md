# A SQL regex state machine cannot own the server transaction state

The view-as database wrapper tracked whether a checked-out PostgreSQL client was in a transaction
by matching the SQL text it sent. A comment-prefixed `COMMIT`, or `PREPARE TRANSACTION` whether it
succeeded or failed, ended the server transaction without changing the wrapper's boolean. The next
statement was sent bare and could autocommit a real write. `COMMIT AND CHAIN` and `ROLLBACK AND
CHAIN` exposed the converse gap: the wrapper knew a new transaction existed but had not pinned its
inherited read-only mode with a first query, so it could still be changed to read-write. Nothing
reached a reader: review found the escapes in commit `e8180d86d` before the feature was landed.

## What happened

`END_STATEMENT` accepted whitespace before `COMMIT` but not PostgreSQL comments. PostgreSQL treats
`/* harmless */ COMMIT` and `-- note\nROLLBACK` as ordinary transaction ends; the wrapper did not.
`PREPARE TRANSACTION` was not classed as an end at all, although success detaches the transaction
and failure cancels it. In each case `inTransaction` stayed true, so the next query bypassed the
per-statement read-only transaction and ran on an idle connection. A line comment ending with a
lone carriage return was another spelling of the same escape.

The first repair then found its own lexical boundary: treating every backslash in a quoted SQL
literal as an escape can skip the real closing quote when `standard_conforming_strings` is on, and
`U&"..."` can spell a blocked function name without its plain identifier appearing in the text.
SQL-level prepared statements, cursors, `LOAD`, `EXPLAIN ANALYZE EXECUTE`, and node-postgres named
queries also leave session state or execute a body the guard cannot inspect.

The same audit found a second wrong premise in the documentation: PostgreSQL `READ ONLY` prevents
persistent table and sequence writes, but permits session settings, notifications, advisory locks
and some privileged external effects. It was a strong database guard described as a complete
side-effect sandbox.

## The class: a client-side grammar shadow owns protocol state

The boolean duplicated state PostgreSQL already owns, while its transitions were inferred from a
strict subset of PostgreSQL's lexical grammar. Every unrecognised spelling was therefore not just a
parser miss but an authority inversion: the server moved and the client continued from an invented
state.

## Why nothing went red

The tests used bare `BEGIN`, `COMMIT`, savepoints and `SET TRANSACTION READ WRITE`; code and tests
shared the regex's spelling assumptions. Extended protocol correctly stopped multiple statements,
and read-only mode correctly refused ordinary inserts, so both strong controls passed around the
state-desynchronisation gap. Commit `e8180d86d` introduced the wrapper, its tests and the overbroad
security sentence together.

Regression cases for nested leading comments, CR-terminated line comments, chained transactions,
two-phase prepare and known read-only side effects were written before the fix. This sandbox could
not connect to the local PostgreSQL socket (`EPERM`), so their runtime red/green remains to be
observed where the database is available; the failure is established by the wrapper's branch and
PostgreSQL's transaction semantics rather than by a local run here. Driver-boundary unit tests for
the string/identifier scanner and session-state commands were observed red before their fixes and
green afterwards.

## What would have caught it, ranked by ease against value

1. **Adversarial spellings of every state transition** — added: CR- and LF-terminated line
   comments, nested block comments, `PREPARE TRANSACTION`, and `COMMIT`/`ROLLBACK AND CHAIN`.
2. **Destroy a client released while the wrapper still believes it is in a transaction** — done.
   A failed cleanup cannot return a possibly live transaction to the pool.
3. **Read PostgreSQL's ReadyForQuery status after every statement** — the best long-term state
   source, but node-postgres exposes it only through private internals today; depending on those is
   another silent compatibility boundary.
4. **A separate least-privilege connection plus restrictions on session/external primitives** —
   strongest and still proposed. A SELECT-only table role alone does not forbid `NOTIFY`, session
   advisory locks or every extension function.
5. **A complete SQL parser as the security boundary** — rejected. It would still classify commands
   rather than learn the server's actual state, and extensions keep the side-effect set open.

## The long-term fix

The shipped fix tokenises PostgreSQL leading words with line and nested block comments, refuses
two-phase transactions before execution, changes state only after a successful end, and pins the
new snapshot after `AND CHAIN`. It explicitly refuses known session and external-effect forms,
named driver prepared statements, ambiguous backslash literals and Unicode-escaped identifiers;
bound values do not pass through that scanner. The documentation now states the narrower database
guarantee. The right eventual boundary is a purpose-built restricted database capability combined
with server transaction status, not a larger list of SQL strings.

## The thing I would tell myself

I knew the regex was not a SQL parser and accepted that because PostgreSQL was enforcing read-only.
I missed that the regex was not merely refusing SQL; it decided whether PostgreSQL would be asked to
enforce read-only on the *next* statement.
