/**
 * **Who else is inside a database, named — and never what they are running.**
 *
 * One column list, shared by the two places that ask the question, because they
 * are asking it for different reasons and must not drift apart:
 *
 * - [`private-db-global.ts`](../setup/private-db-global.ts) samples the *private*
 *   database at teardown, where a single row is a **verdict**: nobody but this
 *   run should ever have been in there;
 * - [`shared-db.ts`](../setup/shared-db.ts) samples the *shared* `postgres` when
 *   a shared-lane test fails, where the rows are **evidence and nothing more** —
 *   the shared database is never empty, and its floor moves on its own.
 *
 * ## `query` is not in the column list, and that is deliberate
 *
 * GPT Sol's finding on T-E, 2026-09-04, and it is this repo's own logging rule
 * arriving somewhere nobody thought of it: `pg_stat_activity.query` is the last
 * statement a session ran, and on this box that is routinely an `insert` or an
 * `update` carrying **article prose**, and could as easily carry a token or a
 * password. docs/project/logging.md — *never log anything sensitive or any
 * article prose*. The probes written earlier that day selected `query` without
 * thinking about it.
 *
 * `wait_event` is the substitute, and it is enough for the question a reader
 * actually has: a session blocked on a lock is `Lock`-something, an idle pool is
 * `ClientRead`.
 *
 * ## Why `application_name` and not `usename`
 *
 * Sol again: `usename = postgres` is incidental configuration — it is what the
 * local stack happens to hand everybody, it already needs a `pg_net` exception,
 * and it separates nothing. A name a connection gives itself does. See
 * [`src/db/client.ts`](../../src/db/client.ts) § `applicationName`, which is why
 * the app's own pool is no longer anonymous.
 */

/**
 * One row of `pg_stat_activity`, minus anything that could carry prose.
 *
 * A `type` rather than an `interface` on purpose: only a type alias gets an
 * implicit index signature, and without one it does not satisfy `pg`'s
 * `QueryResultRow` constraint on `query<R>`.
 */
export type DbSession = {
  pid: number;
  /** Empty string when the connection never named itself. */
  application_name: string;
  usename: string | null;
  state: string | null;
  backend_start: Date | null;
  query_start: Date | null;
  wait_event: string | null;
  /**
   * `client backend` for somebody who connected, and something else — `autovacuum
   * worker`, `walwriter` — for one of Postgres's own.
   *
   * **Not decoration.** A freshly restored database gets autovacuumed, and an
   * autovacuum worker inside it has a null `usename`, an empty
   * `application_name` and `datname` set, so it reads exactly like an anonymous
   * stranger. Watched happening on 2026-09-04: the first POLLUTED report to
   * name a real intruder named an autovacuum worker beside it. Anything that
   * decides *who* is inside a database has to read this column first.
   */
  backend_type: string | null;
};

/**
 * Anything with a `query` method — a `Client`, a `Pool`, a `PoolClient`. Typed
 * structurally so that a caller can hand over whichever it already has open,
 * and so that this module imports nothing from `pg` at all.
 */
export interface Queryable {
  query<R extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
}

/**
 * Every session inside `datname` other than the caller's own backend.
 *
 * `pid <> pg_backend_pid()` is what makes "other than mine" true of the
 * connection this query arrives on, which is the one the caller is holding.
 */
export async function sessionsIn(db: Queryable, datname: string): Promise<DbSession[]> {
  const r = await db.query<DbSession>(
    `select pid, application_name, usename, state, backend_start, query_start,
            wait_event, backend_type
       from pg_stat_activity
      where datname = $1 and pid <> pg_backend_pid()
      order by backend_start`,
    [datname],
  );
  return r.rows;
}

/** `2026-09-04T05:59:37Z`, or `—` for a session that has never run a statement. */
function when(at: Date | null): string {
  return at ? at.toISOString().replace(/\.\d+Z$/, "Z") : "—";
}

/** One session on one line, in the order a reader wants to read it. */
export function describeSession(s: DbSession): string {
  const name = s.application_name === "" ? "(no application_name)" : s.application_name;
  const kind = isClient(s) ? "" : `  [${s.backend_type ?? "unknown backend"}]`;
  return (
    `pid ${s.pid}  ${name}${kind}  user=${s.usename ?? "?"}  state=${s.state ?? "?"}` +
    `  since=${when(s.backend_start)}  last-statement=${when(s.query_start)}` +
    `  wait=${s.wait_event ?? "none"}`
  );
}

/**
 * Somebody connected, as opposed to one of Postgres's own workers. See
 * `DbSession.backend_type` for why nothing may be accused without asking this
 * first.
 */
export function isClient(s: DbSession): boolean {
  return s.backend_type === "client backend";
}

/** Sessions this codebase named after itself — see `src/db/client.ts`. */
export function isSpideryarn(s: DbSession): boolean {
  return s.application_name.startsWith("spideryarn");
}

/**
 * Blank-named sessions that are *probably* somebody's application code.
 *
 * **`usename` is a caption here and nowhere else.** Sol's rule — that
 * `usename = postgres` is the wrong discriminator, being incidental
 * configuration that already needs a `pg_net` exception — is about the
 * **verdict**, and the verdict in `private-db-global.ts` reads no user at all.
 * What it is good for is *reading* an anonymous row in the shared database: the
 * Supabase platform connects as `supabase_storage_admin`, `supabase_admin` and
 * friends, so a blank-named session that is *also* `postgres` is the one that
 * looks like a peer's dev server. Measured 2026-09-04: the shared `postgres`
 * carries a permanently idle blank-named `supabase_storage_admin` session, which
 * a name-only rule would have accused.
 *
 * Still a guess, which is why the caller labels the group *unattributed probable
 * application sessions* rather than naming anybody.
 */
export function isUnattributedApp(s: DbSession): boolean {
  return s.application_name.trim() === "" && s.usename === "postgres";
}

/** What to call a session in a summary line when it never named itself. */
export function sessionLabel(s: DbSession): string {
  if (s.application_name.trim() !== "") return s.application_name;
  return `(unnamed, user=${s.usename ?? "?"})`;
}
