# Contributing

**The whole of it is in [README.md § Contributing](README.md#contributing)** — one copy, because two
files saying the same thing is one file and a liability. This one exists only because GitHub shows
it to you at the moment you open a pull request, which is the moment the third point below matters.

The short version:

1. **The most useful contribution is a well-described bug report or feature request**, through the
   Feedback button in the app. Those feed straight into the product-building pipeline.
2. **If you want to write code, get in touch first** — <hello@spideryarn.com>. Setup is
   [docs/project/setup-dev.md](docs/project/setup-dev.md); how the system works is
   [docs/tutorials/architecture.html](docs/tutorials/architecture.html).
3. **A pull request must include the prompts and conversation with the agents that helped build it**,
   in the PR description or as a file under `docs/plans/`. The diff says what changed; the
   conversation says what you were trying to do and what you ruled out, and that is the part a
   reviewer actually needs.

**One thing that looks alarming and is not.** `tests/deploy-checks.test.ts` and
`tests/no-secrets-in-bundle.test.ts` contain a realistic-looking `sb_secret_…` string. It is the
positive test case for our own leaked-key detector — a detector nobody has watched catch anything
is not a detector — so it has to look real, and automated secret scanners may well flag it. It
grants nothing: it is the Supabase CLI's local-stack key, identical on every install on earth and
only reachable on loopback.

Note that [`LICENSE`](LICENSE) covers this project's own code and documentation, and not the
third-party documents kept as test inputs under `evals/` and `tests/fixtures/`.
