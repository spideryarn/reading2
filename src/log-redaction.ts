/**
 * The redaction list, on its own so that a test can import it rather than read it.
 *
 * **Why this is a module and not just a constant in [`src/log.ts`](log.ts).**
 * `tests/log.test.ts` builds a fixture carrying a sentinel at every configured
 * path, so that adding a path to the list immediately gets it exercised. To do
 * that it needs the list. The first version got it by parsing the array out of
 * `src/log.ts` with a regex, which worked and was fragile in a way that fails
 * quiet: a single-quoted entry, an entry spread in from another constant, an
 * entry built by an expression, or a `"double-quoted word"` inside a block
 * comment would each change the parsed list without changing anything red.
 *
 * The alternative to parsing was exporting `REDACT` from `src/log.ts`, and the
 * objection to that was real — a module's public surface should not grow a
 * member that exists only for a test. A separate private module answers both:
 * `src/log.ts` exports exactly what it exported before, and the test imports a
 * value instead of guessing at text.
 *
 * Nothing else should import this. It is the logger's configuration and the
 * test's subject, and that is the whole audience.
 *
 * See [logging.md § What never reaches a log](../docs/project/logging.md).
 */

/**
 * Keys whose values never reach stdout.
 *
 * **Path-based, and that is the whole limitation.** `fast-redact` matches the
 * *position* of a key, so a secret that arrives somewhere not listed here goes
 * straight out — an API key inside an error message, a token in a URL's query
 * string, a bound query parameter at `params[3]` with no key name to match on.
 * The list is a floor, not a guarantee. The guarantee is the habit: put values
 * in the object, and keep the message string free of anything you would mind
 * reading in a log.
 *
 * `url` is *not* redacted, and that is a decision rather than an oversight:
 * an article URL is the single most useful field when a fetch fails, and this
 * is a one-reader beta. It is worth knowing that the log is therefore a reading
 * history — see logging.md § What a URL gives away.
 *
 * **Deleting a line from here is a test failure**, on purpose:
 * `tests/log.test.ts` keeps its own hand-written copy of this list and compares
 * the two. Adding a line is a test failure too, until you add it there as well.
 * That is not an accident to tidy up — see the comment on `REQUIRED_PATHS` in
 * that file for why the duplication is the point.
 */
export const REDACT = [
  "apiKey",
  "api_key",
  "authorization",
  "cookie",
  "password",
  "token",
  "access_token",
  "refresh_token",
  "email",
  "user.email",
  "headers.authorization",
  "headers.cookie",
  "req.headers.authorization",
  "req.headers.cookie",
  "OPENROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
  "DATABASE_URL",
  // The bound values of a database query, once Drizzle is wired up. They are
  // article text, URLs and comment bodies, and they arrive positionally — so
  // this redacts the array wholesale, which is the only thing a path-based
  // redactor can do about it. docs/plans/260825f-postgres-migration.md.
  "params",
];
