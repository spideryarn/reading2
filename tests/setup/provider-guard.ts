/**
 * **A test may not spend money** — the machinery. The one line that switches it
 * on is [`no-provider-calls.ts`](no-provider-calls.ts) next door, which
 * [`vitest.config.ts`](../../vitest.config.ts) loads into every test file.
 *
 * ## Why this exists
 *
 * `tests/referee-mirror-route.test.ts` carried a header saying that its two
 * live cases could not reach a model because *"`OPENROUTER_API_KEY` is absent
 * under vitest"*. It is not absent. The code under test calls `loadEnvLocal()`,
 * `.env.local` holds the real key, and `.env.local` beats the inherited
 * environment by design (src/env.ts § *`.env.local` beats what the shell
 * inherited*). On 2026-08-31 an agent mutated the early return that was
 * actually keeping those two cases free, and both of them made a real
 * OpenRouter call, got an empty answer back, and **asserted their way to green
 * over the top of it**. The only symptom was ten extra seconds.
 *
 * That is [silent-success](../../docs/reusable/silent-success.md) in its purest
 * form: the natural check — *the suite is green* — cannot tell a call that was
 * never made from one that was made and came back empty. Nothing in the repo
 * measured the thing that separates them, which is whether a request left.
 *
 * [`tests/no-undeclared-spend.test.ts`](../no-undeclared-spend.test.ts) does not
 * cover this and was never meant to: it asks which *source* files have the
 * capability to spend and insists each is declared. A test that reaches a
 * perfectly well-declared seam passes it cleanly. That gate is about
 * accounting; this one is about the suite.
 *
 * ## What it does
 *
 * `installProviderGuard()` wraps `globalThis.fetch` once. A request whose
 * hostname is one of [`PROVIDER_HOSTS`](../../src/spend-declarations.ts) is
 * **refused before it is sent** — the wrapper throws instead of delegating, so
 * no bytes and no credential leave the machine. Everything else (a local
 * Supabase, a fixture server, `127.0.0.1`) is passed straight through
 * untouched: this is not an offline switch, and a guard that took the whole
 * network away would be switched off within the week.
 *
 * ## The five things worth knowing
 *
 * **A test that stubs `fetch` itself wins for the length of its own test, and
 * that is correct.** `vi.stubGlobal("fetch", …)` replaces this wrapper, which is
 * what the dozens of tests that already do it need. It is usually a *stronger*
 * guarantee than this one — a stub that returns a canned body cannot reach
 * anything — but not inherently: a stub is free to delegate to `undici.fetch`,
 * to `node:http`, or to a transport it captured itself, and none of those is
 * guarded. We cannot tell those apart from outside, so we do not pretend to.
 *
 * **The wrapper is remembered by identity, and put back after every test.**
 * `providerGuardInstalled()` compares `globalThis.fetch` against the function
 * this module installed. It used to read a boolean, which meant a test could
 * assign over the global, leave the boolean standing, and have the guard report
 * itself installed while being gone — with re-installation a no-op, because it
 * checked that same boolean (GPT Sol, 2026-09-01). `restoreFetchAfterTest()`
 * puts back whatever `globalThis.fetch` was when the test began, so a test that
 * swaps it out no longer costs the rest of the file its guard. It restores and
 * does not fail; the reasoning is at that function.
 *
 * **Refusing is not enough on its own.** A refusal is an exception, and a test
 * can pass by swallowing an exception — which is the same bug wearing a
 * different coat, because the code under test may well catch a network error
 * and report "the model did not answer". So every refusal is also *recorded*,
 * and `assertNoRefusedProviderCalls()` runs after every test, failing it if
 * anything was refused, whatever the test itself concluded. The record is the
 * measurement; the throw is only what stops the money.
 *
 * **The opt-out is a function call, not a flag.** `allowRealProviderCalls()` is
 * greppable, takes a reason, and prints it — so a run that really does spend
 * money says so in its own output. There is no environment variable, because a
 * variable set in a shell profile silently exempts every run on that machine,
 * which is the failure this whole file is about.
 *
 * **This module installs nothing when imported**, and that separation is the
 * whole reason it is a second file. The first draft installed the guard as an
 * import side effect, and its own "is the guard loaded?" test then passed with
 * `setupFiles` deleted from the config — because importing the module to ask
 * the question was what installed the thing being asked about. A check that
 * cannot fail is the bug this directory exists to prevent, so the switch lives
 * in `no-provider-calls.ts` and nothing else calls it.
 *
 * ## Not covered — this is a tripwire, not a boundary
 *
 * Four things walk straight past it, and calling it a safeguard would be the
 * same kind of sentence as the one in the postmortem:
 *
 * - **`node:http`, `node:net`, or an HTTP client that does not go through the
 *   `fetch` global** — `undici.fetch` included.
 * - **A subprocess.** `execFileSync("curl", …)` is not our `fetch`.
 * - **Whatever a stub does.** For the length of the test that installed it, the
 *   stub is the transport and we are not in the way.
 * - **A provider host that is not in `PROVIDER_HOSTS`.** Only this one is
 *   narrowed: `tests/no-provider-calls-guard.test.ts` scans the source for
 *   absolute URLs whose *path* is one a provider charges for and insists the
 *   host is refused. It catches a new provider written down as a literal; it
 *   cannot see one that arrives as a dependency's default base URL, which is how
 *   two of the four registered hosts would arrive.
 *
 * A real boundary would mean denying non-local sockets below `fetch` — an
 * `undici` global dispatcher, or Node's network permission model — with an
 * allow-list for the local Supabase and every fixture server so the suite still
 * runs, plus a separate audit of subprocesses. Nobody has costed that. Like
 * `tests/no-undeclared-spend.test.ts`, this catches somebody in a hurry, and
 * somebody in a hurry is what happened.
 *
 * The wording of the refusal is developer-facing, so
 * [copy.md](../../docs/project/copy.md) does not apply: that doc is explicitly
 * about the words *the reader* sees. What does carry over is its spirit — say
 * what happened, and say what to do next.
 *
 * See [testing.md § Nothing under `tests/` may call a paid
 * provider](../../docs/project/testing.md#nothing-under-tests-may-call-a-paid-provider)
 * and the postmortem it links.
 */

import { PROVIDER_HOSTS } from "../../src/spend-declarations.js";

/** One refused request, kept so a swallowed refusal still reddens the test. */
export interface RefusedProviderCall {
  readonly host: string;
  readonly method: string;
  readonly url: string;
}

/**
 * Guard state, hung off `globalThis` rather than held in a module variable.
 *
 * A setup file and a test file are separate entries into the module graph, and
 * "vitest gives them the same module instance" is exactly the kind of thing
 * that is true until a config option changes it — at which point
 * `takeRefusedProviderCalls()` would read an empty array that is not the one
 * being written to, and report *no calls* for a run full of them. A global key
 * cannot go wrong that way.
 */
interface GuardState {
  /**
   * **The exact function we put in `globalThis.fetch`**, not a flag saying we
   * once did. A boolean was the first version and it was wrong in the quiet
   * direction: a test that assigns `globalThis.fetch = …` removes the wrapper
   * and cannot remove the boolean, so `providerGuardInstalled()` answered
   * *yes* for a guard that was gone, and re-installing was a no-op because it
   * checked the same boolean. GPT Sol, 2026-09-01.
   */
  wrapper: typeof fetch | null;
  /** What `globalThis.fetch` was when the current test started. See below. */
  baseline: typeof fetch | null;
  allowed: string | null;
  refusals: RefusedProviderCall[];
}

const KEY = "__spideryarnNoProviderCalls" as const;

function state(): GuardState {
  const g = globalThis as unknown as Record<string, GuardState | undefined>;
  const existing = g[KEY];
  if (existing) return existing;
  const fresh: GuardState = { wrapper: null, baseline: null, allowed: null, refusals: [] };
  g[KEY] = fresh;
  return fresh;
}

/** The hostname a provider request is going to, or `null` for anything else. */
export function providerHostOf(input: unknown): string | null {
  let raw: string;
  if (typeof input === "string") raw = input;
  else if (input instanceof URL) raw = input.href;
  else if (typeof Request !== "undefined" && input instanceof Request) raw = input.url;
  else if (
    input &&
    typeof input === "object" &&
    typeof (input as { url?: unknown }).url === "string"
  ) {
    /* Duck-typed as well as `instanceof`: a test may hand `fetch` a
       `Request`-shaped object from a different realm, and `instanceof` is false
       across realms. Failing open there would be the quiet direction. */
    raw = (input as { url: string }).url;
  } else return null;

  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    /* A relative URL — `fetch("/api/articles")` under jsdom. Nothing paid is
       reachable relative to a test's own origin. */
    return null;
  }
  for (const provider of PROVIDER_HOSTS) {
    /* Hostname equality or a dotted suffix, never `includes`: a substring match
       would pass `openrouter.ai.evil.example` and fail nothing. */
    if (host === provider || host.endsWith(`.${provider}`)) return provider;
  }
  return null;
}

function methodOf(input: unknown, init: unknown): string {
  const fromInit = (init as { method?: unknown } | undefined)?.method;
  if (typeof fromInit === "string") return fromInit.toUpperCase();
  const fromInput = (input as { method?: unknown } | null)?.method;
  if (typeof fromInput === "string") return fromInput.toUpperCase();
  return "GET";
}

function urlOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  const url = (input as { url?: unknown } | null)?.url;
  return typeof url === "string" ? url : String(input);
}

function refusal(host: string, method: string, url: string): Error {
  return new Error(
    [
      `Refused: this test tried to call a paid provider — ${method} ${url}`,
      "",
      `Nothing under tests/ may reach ${host}. The request was stopped before it`,
      "was sent, so no money was spent and no credential left the machine.",
      "",
      "Why you are seeing this: OPENROUTER_API_KEY is NOT absent under vitest.",
      "The code under test loads .env.local, which holds the real key and beats",
      "the inherited environment on purpose (src/env.ts). So a test that reaches",
      "a model call reaches a real one.",
      "",
      "The fix is one of:",
      "  • stub the network for the code under test —",
      '      const fetchSpy = vi.fn(async () => { throw new Error("no model call expected") });',
      '      vi.stubGlobal("fetch", fetchSpy);',
      "    then assert on fetchSpy, so 'no model was asked' is a fact you measured",
      "    rather than an error you did not see (tests/explain.test.ts does this);",
      "  • pass the seam the code under test already accepts — most modules here",
      "    take their transport as an argument for exactly this reason;",
      "  • or, if this test genuinely must spend money, say so out loud:",
      '      import { allowRealProviderCalls } from "./setup/provider-guard.js";',
      '      allowRealProviderCalls("why this one has to be live");',
      "",
      "Guard: tests/setup/provider-guard.ts — docs/project/testing.md",
    ].join("\n"),
  );
}

/**
 * **Let this test file call a provider for real, and say why.**
 *
 * Deliberately loud and deliberately awkward. Call it at the top of a test file
 * or in a `beforeAll`; it holds for that file only, because each file gets its
 * own environment. The reason is printed, so the run's own output records that
 * money was spent and on whose say-so.
 *
 * `grep -rn allowRealProviderCalls tests/` is the audit, and as of 2026-09-01 it
 * returns only this file and the guard's own test.
 */
export function allowRealProviderCalls(reason: string): void {
  if (!reason.trim()) {
    throw new Error(
      "allowRealProviderCalls() needs a reason. A live call with no stated reason is the thing this guard exists to stop.",
    );
  }
  state().allowed = reason;
  console.warn(`[provider-guard] LIVE PROVIDER CALLS ALLOWED for this file: ${reason}`);
}

/**
 * **Every provider request refused since the last time this was called**, and
 * clears the record.
 *
 * Two callers, and they are different questions. The guard's own test calls it
 * to *assert a refusal happened* — and clearing is what stops the after-each
 * backstop failing the very test that proved the backstop works. Everything
 * else should never need it.
 */
export function takeRefusedProviderCalls(): RefusedProviderCall[] {
  const s = state();
  const taken = s.refusals;
  s.refusals = [];
  return taken;
}

/**
 * **Whether the wrapper is in place *right now*.**
 *
 * Identity, not history: the question is whether the function sitting in
 * `globalThis.fetch` this instant is the one we installed. The first version
 * asked a boolean, which meant it kept saying *yes* after a test assigned over
 * the global — the guard reporting itself installed while being gone, which is
 * the same shape as the bug this whole directory is about.
 *
 * Only `no-provider-calls.ts` can make this true, and only `vitest.config.ts`
 * loads that — so a test asserting this is asserting that the config still
 * carries the guard, which is exactly what nothing checked before.
 *
 * It is legitimately `false` inside a test that has stubbed `fetch`, which is
 * the common case and not a fault. See `restoreFetchAfterTest()`.
 */
export function providerGuardInstalled(): boolean {
  const { wrapper } = state();
  return wrapper !== null && globalThis.fetch === wrapper;
}

/**
 * **The backstop.** A refusal is an exception, and an exception can be
 * swallowed — by the test, or by the production code it is driving, which quite
 * reasonably catches a network failure and carries on. Without this, a test
 * that called out and then reported "the model returned nothing" would still be
 * green, which is where this all started.
 *
 * A named export rather than an inline hook body, so that
 * `tests/no-provider-calls-guard.test.ts` can watch it throw. A hook can only be
 * proved by a test it would fail, and a test cannot assert its own failure.
 */
export function assertNoRefusedProviderCalls(): void {
  const refused = takeRefusedProviderCalls();
  if (refused.length === 0) return;
  const lines = refused.map((r) => `  ${r.method} ${r.url}`).join("\n");
  throw new Error(
    `This test tried to call a paid provider ${refused.length} time(s) and the guard refused it:\n${lines}\n\n` +
      "The test did not fail on its own, which means something swallowed the refusal —\n" +
      "so it would have passed just the same on a machine where the call went through.\n" +
      "See tests/setup/provider-guard.ts for what to do about it.",
  );
}

/** Wrap `globalThis.fetch`. Idempotent, and called from exactly one place. */
export function installProviderGuard(): void {
  const s = state();
  if (s.wrapper) return;
  const real = globalThis.fetch;
  if (typeof real !== "function") return;

  const guarded: typeof fetch = (input, init) => {
    const host = providerHostOf(input);
    if (host && !s.allowed) {
      const method = methodOf(input, init);
      const url = urlOf(input);
      s.refusals.push({ host, method, url });
      /* Thrown, not returned as a rejected promise, and before `real` is
         touched: the request never exists. Synchronous on purpose — a rejected
         promise nobody awaits is a warning on stderr, and this has to be loud. */
      throw refusal(host, method, url);
    }
    return real(input as RequestInfo | URL, init as RequestInit | undefined);
  };
  Object.defineProperty(guarded, "name", { value: "fetch" });
  globalThis.fetch = guarded;
  s.wrapper = guarded;
}

/**
 * **Remember what `globalThis.fetch` was when this test started.** Runs as the
 * first `beforeEach` of every file, because the setup file registers its hooks
 * before any test file registers its own.
 */
export function noteFetchBeforeTest(): void {
  state().baseline = globalThis.fetch;
}

/**
 * **Put back whatever `globalThis.fetch` was when the test started**, if the
 * test changed it and did not change it back. Runs as the last `afterEach` of
 * every file.
 *
 * ## Why restore, and why not also fail
 *
 * The choice was: restore the guard, fail the test that left the global
 * replaced, or both. It restores, and it never fails, for two reasons.
 *
 * **Failing would redden legitimate tests by the dozen.** Stubbing `fetch` is
 * the normal way to test anything that talks to a server here, and plenty of
 * files stub once in a `beforeAll` or at module scope and never unstub —
 * `tests/chat-anchor-route.test.ts`, `tests/feedback-button-visibility.test.tsx`
 * and `tests/quiz-mark-route.test.ts` among them. A guard that fails those is a
 * guard somebody deletes, which is the same reason it does not take the whole
 * network away.
 *
 * **And failing would be a claim about a window that has already closed.** By
 * the time this runs, whatever the test was going to send has been sent. We
 * cannot tell a stub that answered everything locally from one that delegated
 * to `undici` — Sol's point, and it is right — so a failure here would be a
 * guess dressed up as a measurement. The one thing that genuinely changes an
 * outcome is putting the wrapper back for the tests that come *after*, and that
 * is the hole that was actually open: before this, one test swapping the global
 * left every later test in the file unguarded, and
 * `tests/no-provider-calls-guard.test.ts` now watches exactly that.
 *
 * ## Why the baseline rather than the wrapper
 *
 * Restoring *the wrapper* would break every file that installs a stub before
 * its first test and expects it to last: from the second test on, their fake
 * transport would be gone and their provider URLs would be refused, which is a
 * false alarm — no money could have left, the stub had it. Restoring **the
 * value the test began with** leaves an inherited stub exactly where the file
 * put it, and undoes only what the test itself did.
 */
export function restoreFetchAfterTest(): void {
  const s = state();
  if (!s.baseline) return;
  if (globalThis.fetch === s.baseline) return;
  globalThis.fetch = s.baseline;
}
