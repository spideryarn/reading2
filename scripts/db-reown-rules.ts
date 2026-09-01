/**
 * The one decision in `npm run db:reown` worth testing on its own: **is the
 * thing at `DATABASE_URL` this repo's own local Docker stack?**
 *
 * Pure, no network, no filesystem — so `tests/db-reown-rules.test.ts` can drive
 * every hostile case without a Postgres running, and so this file can be
 * imported without doing anything. `scripts/db-reown.ts` does its work at import
 * time; a test that imported *that* would re-own a database rather than read a
 * rule. `scripts/seed-accounts.ts` and `scripts/gjd-remote-env.ts` were split out
 * of their scripts for exactly this reason, and this is the third.
 *
 * ## Why a loopback address is not the answer
 *
 * `isLocalDatabaseUrl` (src/db/ssl.ts) proves the endpoint is `localhost` or
 * `127.0.0.1`. An `ssh -L 54362:remote:5432` satisfies it exactly as the real
 * container does, and a `.env.local` that has drifted onto another project
 * satisfies it too if that project is reachable on a loopback port. Every check
 * that reads `DATABASE_URL` agrees with every other one no matter what is on the
 * far end — the shape docs/reusable/silent-success.md is about.
 *
 * So this asks a **different source**: `supabase status -o env`, which reads the
 * Docker containers belonging to this repo's `project_id`. A tunnel cannot make
 * the CLI describe itself, and the old app's stack on 54342 answers with its own
 * port rather than ours. GPT Sol raised the tunnel case against the built code,
 * 2026-09-01, having run it.
 *
 * What this still cannot catch: a remote database tunnelled onto the exact port
 * the CLI reports *while the CLI is also running*. That is two coincidences and
 * a deliberate act, and nothing available at this layer can see through it. The
 * honest claim is the one `assertPushableName` makes — a fence against an
 * accident, not against an operator.
 */

/** host:port, with the three spellings of loopback folded together. */
export function endpointOf(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    /* `refuseNonLocalSeed` accepts `localhost`, `127.0.0.1` and `[::1]` as the
       same machine — they are — while the CLI always prints `127.0.0.1`. A
       literal string comparison would refuse an ordinary `.env.local`. The
       **port** is what carries the meaning, since that is what tells our stack
       from the old app's on 54342, and it is compared exactly. */
    const host = u.hostname === "localhost" || u.hostname === "[::1]" ? "127.0.0.1" : u.hostname;
    return `${host}:${u.port}`;
  } catch {
    return undefined;
  }
}

/**
 * The refusal, or `undefined` to proceed.
 *
 * `status` is the parsed output of `supabase status -o env` — `parseStatusEnv`
 * in scripts/seed-accounts.ts, one parser rather than two, because two parsers
 * is how a comparison quietly stops comparing anything.
 *
 * Neither URL is ever printed with its password: `redact` is the caller's
 * `withoutPassword`, handed in so this file needs no import to stay pure.
 */
export function refuseUnlessOurDatabase(
  url: string,
  status: Map<string, string>,
  redact: (u: string) => string | undefined,
): string | undefined {
  const theirs = status.get("DB_URL");
  if (!theirs) {
    return (
      "`supabase status` did not report a DB_URL for this repo's stack.\n" +
      "  Run: npm run db:start — see docs/project/supabase-local.md.\n" +
      "  Refusing rather than trusting DATABASE_URL, which is the value in doubt."
    );
  }
  const mine = endpointOf(url);
  const stack = endpointOf(theirs);
  if (!mine || !stack || mine !== stack) {
    return (
      `DATABASE_URL is ${redact(url) ?? "(unparsable)"}, but this repo's local stack is at ` +
      `${redact(theirs) ?? "(unparsable)"}.\n` +
      "  Something other than this stack is answering on that address — a forwarded port,\n" +
      "  or a .env.local that has drifted. Refusing to rewrite ownership in it."
    );
  }
  return undefined;
}
