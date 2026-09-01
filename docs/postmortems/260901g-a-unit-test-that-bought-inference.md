# A unit test that bought inference

Two cases in `tests/referee-mirror-route.test.ts` made real, paid OpenRouter calls and passed. The
file's own header said they could not, and gave the reason: *"`OPENROUTER_API_KEY` is absent under
vitest, so the run throws `NOT_CONFIGURED`"*. The key is not absent. It never was.

A small amount of real credit was spent on 2026-09-01 finding this out, on calls nobody read the
output of.

**Introduced:** the capability in [`3060972`](../../src/env.ts) (2026-08-25), the commit that added
`src/env.ts` and the habit of a stage calling `loadEnvLocal()` at call time; the false sentence in
`8577a6f` (2026-09-01), repeated in `9f9c474`. The absence of any guard dates to `c928843`
(2026-08-24), the first vitest config — which is still the honest answer to *which commit*, because
nothing between then and now was wrong so much as unprotected.
**Found:** by an agent who mutated the early return in `mirrorStream` to see whether the tests could
tell. They could not: both went green, and the file took ten seconds longer.
**Fixed:** a file-scoped `fetch` spy in that one test (2026-09-01), then this — a guard for the
class.

## What happened

`mirrorStream` calls `loadEnvLocal()` immediately after the guard that was actually keeping those
two cases free. `.env.local` on a developer's machine holds the real key, and **`.env.local` beats
the inherited environment on purpose** — [env.ts § `.env.local` beats what the shell
inherited](../../src/env.ts), decided in `f2462c3` after a whole afternoon went on a shell profile
exporting a different account's key.

So the sentence in the header had the world exactly backwards. Under vitest the key is not missing;
it is the *most* reliably present it ever is, because `.env.local` outranks whatever the shell had.
The only thing standing between that test file and the OpenRouter API was a two-line early return in
production code, which is not a property of the test at all.

Delete the early return and the tests still pass. They assert that the stream ends in a `done` frame
carrying no remarks, and a model asked for remarks about nothing returns none. **A `done` with an
empty list looks identical whether it was free or paid.**

## The real cause

Not the wrong sentence, and not the missing stub. The cause is that
**"this test does not spend money" was a claim about code somewhere else, and nothing measured it.**

Three separate things had to stay true for that claim to hold, and the test file owned none of them:
an early return in `src/referee-mirror.ts`, the precedence rule in `src/env.ts`, and the contents of
a gitignored file on one machine. Any of the three could change without anyone touching `tests/`.

It is [silent-success](../../docs/reusable/silent-success.md) in the purest form the repo has
collected: *success is the absence of something* — no request, no error, no cost — and absence is
what a working test and a broken guard both produce. The natural check, **the suite is green**,
shares the bug's assumption exactly. It cannot tell a call that was never made from one that was
made and came back empty, and the only signal it did emit was ten seconds of wall clock, which
nobody reads.

**Why `tests/no-undeclared-spend.test.ts` did not cover it, and was never going to.** That gate asks
which *source* files have the capability to spend and insists each one is a seam or a declared
bypass. `src/referee-mirror.ts` is neither a bypass nor undeclared — it is on the allow-list for a
good reason, because it makes its call through `openRouterStream` like everything else. A test that
drives a properly-declared, properly-metered seam passes that gate cleanly, and should. It is about
accounting. Nothing was about the suite.

## The fix that is right for the long term

Not another stub, and not a stern sentence in `testing.md`. **Make the default path refuse, and
record the refusal**, so that the safety of a test stops depending on a paragraph somebody wrote
about it. Not *impossible* — that word was in the first draft of this section and it is wrong, in
the same direction as the header sentence that started all this. See the fourth point below.

[`tests/setup/no-provider-calls.ts`](../../tests/setup/no-provider-calls.ts) is loaded by
`vitest.config.ts` into every test file. It wraps `globalThis.fetch` and refuses — before the request
is sent — anything addressed to a host in `PROVIDER_HOSTS`, which now lives in
[`src/spend-declarations.ts`](../../src/spend-declarations.ts) as one list read by both this guard
and the capability scan. Everything else goes through untouched; a guard that took the whole network
away would be switched off within the week.

Five decisions in it are worth more than the wrapper:

1. **Refusing is not enough.** A refusal is an exception and an exception can be swallowed — most
   obviously by the code under test, which quite reasonably catches a network failure and reports
   *"the model did not answer"*. That test would then be green for the same reason as before. So
   every refusal is **recorded**, and an `afterEach` fails the test if anything was refused during
   it, whatever the test itself concluded. The record is the measurement; the throw only stops the
   money.
2. **The opt-out is a function call with a reason**, `allowRealProviderCalls("…")`, and it prints.
   Not an environment variable: one exported in a shell profile exempts every run on that machine and
   says nothing, which is the same shape as the bug.
3. **The guard installs from one four-line file that nothing else imports.** The first draft
   installed itself as an import side effect — and its own *"is the guard loaded?"* test then passed
   with `setupFiles` deleted from the config, because importing the module to ask the question was
   what installed the thing being asked about. That is the bug class reappearing inside its own fix,
   twenty minutes later, and it is the reason the machinery sits in
   [`provider-guard.ts`](../../tests/setup/provider-guard.ts) and the switch sits next door.
4. **The wrapper is held by identity, not by a flag.** The first version answered *"am I
   installed?"* from a boolean, and a boolean cannot be removed by `globalThis.fetch = …`. So a test
   that assigned over the global left the guard reporting itself installed while it was gone, and
   re-installing was a no-op because it checked the same boolean. Found by GPT Sol on 2026-09-01,
   reproduced by a throwaway test that replaced the global and then watched `providerGuardInstalled()`
   answer `true` while a paid URL sailed through to the replacement. The guard now compares
   identity, and an `afterEach` puts back whatever `globalThis.fetch` was when the test began — so
   one test swapping it out no longer costs the rest of the file its guard. It **restores and does
   not fail**: by then the request, if there was one, has gone, so failing would be a guess dressed
   up as a measurement, and it would redden the dozens of files that legitimately stub `fetch` for
   their whole length. This is the second time the bug class has reappeared inside its own fix.
5. **It is a tripwire, not a boundary**, and says so — `node:http`, `undici` used directly, a
   subprocess, whatever a stub does while it is installed, or a provider nobody has heard of all walk
   past. The same admission `no-undeclared-spend` makes about itself. The last of those is narrowed
   but not closed: the guard's own test scans the source for absolute URLs whose path is one a
   provider charges for and insists the host is refused, which catches a new provider written down as
   a literal and cannot see one that arrives as a dependency's default base URL — which is how
   `api.anthropic.com` and `api.voyageai.com` would arrive, neither appearing in any source file. A
   real boundary would mean denying non-local sockets below `fetch` plus an allow-list for the local
   Supabase and every fixture server, and a separate audit of subprocesses. Nobody has costed it.

## What would have caught the whole class

**Nothing that reads code.** The false header was reviewed, plausible, and specific. A second reader
would have agreed with it, because it is the kind of sentence you have no reason to doubt — and
[silent-success](../../docs/reusable/silent-success.md) has that as its own entry: *the agreeing is
what stopped the checking*.

What would have caught it, in order of what each buys:

- **The mutation that found it.** Break the thing that is supposedly making this safe, and require
  the alarm. It took one edit and a re-run, and it is the only technique here that works on a claim
  about somebody else's file.
- **Asserting on a spy rather than on the absence of an error.** `expect(fetchSpy).not.toHaveBeenCalled()`
  is a fact about something that happened. "It did not throw `NOT_CONFIGURED`" is a fact about
  something that did not, and those are different kinds of evidence.
- **The guard**, which is the only one of the three that covers tests nobody has written yet — and
  the reason it is worth more than either is that it makes the safe behaviour the default rather
  than something each author has to remember.

Measured on 2026-09-01, after the one known offender had already been repaired: **no test file in
the suite reaches a provider.** The full run is clean through the guard. That number is the point —
the guard is not cleaning up a mess, it is holding a property that was true by luck and is now held
by a tripwire in the default path. Not *by construction*: the list above says what still walks past.

Related: [testing.md § Nothing under `tests/` may call a paid
provider](../project/testing.md#nothing-under-tests-may-call-a-paid-provider),
[260828g-ai-spend-outside-the-gateway.md](../plans/260828g-ai-spend-outside-the-gateway.md) (the
accounting half), [silent-success.md](../reusable/silent-success.md).
